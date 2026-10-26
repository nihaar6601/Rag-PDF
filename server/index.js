import fs from 'fs';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { Queue } from 'bullmq';
import { config } from './src/config.js';
import { documentStore } from './src/services/documentStore.js';
import { processPdfDocument, deleteDocument } from './src/services/documentService.js';
import { hybridRetrieve } from './src/services/hybridRetrievalService.js';
import { rerankCandidates } from './src/services/rerankingService.js';
import { calculateConfidence } from './src/services/confidenceService.js';
import { rewriteQueryIfNeeded } from './src/services/queryRewriteService.js';
import { generateAnswer } from './src/services/llmService.js';
import { logger } from './src/services/logger.js';
import { bm25Index } from './src/services/bm25Service.js';

// Auto-run the worker in-process so uploads NEVER stall if dev:worker is omitted
import './worker.js';

fs.mkdirSync(config.UPLOADS_DIR, { recursive: true });

// Initialize BM25 index with stored chunks if available
const existingChunks = documentStore.getChunks();
if (existingChunks.length) {
  bm25Index.build(existingChunks);
  logger.info(`Loaded ${existingChunks.length} chunks into BM25 index on startup`);
}

// Auto-heal any interrupted documents from previous sessions on startup
setTimeout(async () => {
  try {
    const pendingDocs = documentStore
      .getAllDocuments()
      .filter((d) => d.status === 'preparing' || d.stage === 'uploading');
    for (const doc of pendingDocs) {
      if (doc.path && fs.existsSync(doc.path)) {
        logger.info(`Auto-healing pending document: ${doc.name} (${doc.id})`);
        processPdfDocument({
          documentId: doc.id,
          filePath: doc.path,
          filename: doc.name,
        }).catch((e) => logger.warn(`Failed auto-healing document ${doc.id}:`, e.message));
      }
    }
  } catch (e) {
    logger.warn('Auto-heal check failed:', e.message);
  }
}, 1000);

const queue = new Queue('file-upload-queue', {
  connection: config.REDIS,
});

function isPdfFile(file) {
  const name = (file.originalname || '').toLowerCase();
  return file.mimetype === 'application/pdf' || name.endsWith('.pdf');
}

const storage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, config.UPLOADS_DIR);
  },
  filename: function (_req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.MAX_FILE_SIZE_BYTES },
  fileFilter: function (_req, file, cb) {
    if (!isPdfFile(file)) {
      cb(Object.assign(new Error('Only PDF files are allowed.'), { code: 'LIMIT_FILE_TYPE' }));
      return;
    }
    cb(null, true);
  },
});

const app = express();
app.use(cors());
app.use(express.json());

function parseJobPayload(data) {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return {};
    }
  }
  return data || {};
}

function mapQueueState(state) {
  if (state === 'completed') return 'ready';
  if (state === 'failed') return 'failed';
  return 'preparing';
}

// --------------------- DOCUMENT API ---------------------

app.post('/upload/pdf', (req, res) => {
  upload.single('pdf')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: `That PDF is too large. The limit is ${config.MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB.`,
        });
      }
      if (err.code === 'LIMIT_FILE_TYPE') {
        return res.status(400).json({ error: 'Please choose a PDF file.' });
      }
      return res.status(400).json({ error: err.message || 'Upload failed.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Please choose a PDF file.' });
    }

    const documentId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // Register document in store with initial 'extracting' stage (not uploading)
    documentStore.saveDocument({
      id: documentId,
      name: req.file.originalname,
      filename: req.file.originalname,
      path: req.file.path,
      size: req.file.size,
      status: 'preparing',
      stage: 'extracting',
      progress: 15,
    });

    let jobId = `job_${Date.now()}`;

    try {
      const job = await queue.add('file-ready', {
        documentId,
        filename: req.file.originalname,
        destination: req.file.destination,
        path: req.file.path,
        size: req.file.size,
      });

      jobId = job.id;
      documentStore.updateDocument(documentId, { jobId: job.id, stage: 'extracting' });
    } catch (queueError) {
      logger.warn('Redis queue add unavailable, using in-process processor:', queueError.message);
      // Direct in-process fallback so uploads never hang even without Redis
      processPdfDocument({
        documentId,
        filePath: req.file.path,
        filename: req.file.originalname,
      }).catch((e) => logger.error(`In-process processing failed for ${documentId}:`, e));
    }

    return res.json({
      jobId,
      documentId,
      filename: req.file.originalname,
      size: req.file.size,
      maxFileSizeBytes: config.MAX_FILE_SIZE_BYTES,
    });
  });
});

app.get('/documents', (_req, res) => {
  const documents = documentStore.getAllDocuments();
  return res.json({ documents });
});

app.get('/documents/:id', (req, res) => {
  const document = documentStore.getDocument(req.params.id);
  if (!document) {
    return res.status(404).json({ error: 'Document not found.' });
  }
  return res.json({ document });
});

app.delete('/documents/:id', async (req, res) => {
  try {
    const success = await deleteDocument(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Document not found or already deleted.' });
    }
    return res.json({ success: true, documentId: req.params.id });
  } catch (error) {
    logger.error('Failed to delete document:', error);
    return res.status(500).json({ error: 'Could not delete document.' });
  }
});

app.get('/jobs/:id', async (req, res) => {
  try {
    const allDocs = documentStore.getAllDocuments();
    const doc =
      allDocs.find((d) => d.jobId === req.params.id || d.id === req.params.id) ||
      documentStore.getDocument(req.params.id);

    let state = 'waiting';
    let failedReason = null;
    let payload = {};

    try {
      const job = await queue.getJob(req.params.id);
      if (job) {
        state = await job.getState();
        failedReason = job.failedReason;
        payload = parseJobPayload(job.data);
      }
    } catch {
      // Redis lookup optional
    }

    if (!doc && state === 'waiting' && !payload.filename) {
      return res.status(404).json({ error: 'That upload could not be found.' });
    }

    const status =
      doc?.status ||
      (state === 'completed' ? 'ready' : state === 'failed' ? 'failed' : 'preparing');
    const stage = doc?.stage || (status === 'ready' ? 'ready' : 'extracting');

    return res.json({
      jobId: req.params.id,
      documentId: doc?.id || payload.documentId || null,
      status,
      stage,
      progress: doc?.progress || (status === 'ready' ? 100 : 25),
      queueState: state,
      filename: doc?.name || payload.filename || null,
      size: doc?.size || payload.size || null,
      error: doc?.error || failedReason || null,
    });
  } catch (error) {
    logger.error('Error fetching job status:', error);
    return res.status(500).json({ error: 'Could not check document status.' });
  }
});

// --------------------- CHAT / RAG API ---------------------

async function handleChatRequest(req, res) {
  const userQuery =
    typeof req.body?.message === 'string'
      ? req.body.message.trim()
      : typeof req.query?.message === 'string'
      ? req.query.message.trim()
      : '';

  if (!userQuery) {
    return res.status(400).json({ error: 'Please enter a question.' });
  }

  // Parse document filters
  let rawDocIds = req.body?.documentIds ?? req.query?.documentIds;
  let documentIds = null;
  if (Array.isArray(rawDocIds)) {
    documentIds = rawDocIds.filter((id) => typeof id === 'string' && id.trim().length > 0);
  } else if (typeof rawDocIds === 'string' && rawDocIds.trim().length > 0 && rawDocIds !== 'all') {
    documentIds = rawDocIds.split(',').map((id) => id.trim()).filter(Boolean);
  }

  // History for conversational context
  const history = Array.isArray(req.body?.history) ? req.body.history : [];

  try {
    // 1. Query Rewriting (if follow-up question in conversation)
    const rewrittenQuery = await rewriteQueryIfNeeded(userQuery, history);
    const searchQuery = rewrittenQuery || userQuery;

    // 2. Hybrid Retrieval (Vector + BM25 with multi-doc balancing)
    const { mergedCandidates, vectorResults, keywordResults } = await hybridRetrieve(
      searchQuery,
      {
        documentIds: documentIds && documentIds.length > 0 ? documentIds : null,
        vectorTopK: config.VECTOR_TOP_K,
        keywordTopK: config.KEYWORD_TOP_K,
        perDocTopK: config.COMPARISON_PER_DOC_TOP_K,
      }
    );

    // 3. Reranking
    const topChunks = rerankCandidates(searchQuery, mergedCandidates, {
      topK: config.RERANKER_TOP_K,
      selectedDocumentIds: documentIds,
    });

    // 4. Confidence Calculation
    const confidenceResult = calculateConfidence({
      query: userQuery,
      topChunks,
      vectorResults,
      keywordResults,
      mergedCandidates,
    });

    // 5. LLM Answer Generation with Grounded Prompt
    const { answer, sources } = await generateAnswer({
      userQuery,
      retrievedChunks: topChunks,
      confidenceLevel: confidenceResult.confidence,
      history,
    });

    // 6. Logging
    logger.queryTrace({
      originalQuery: userQuery,
      rewrittenQuery,
      selectedDocumentIds: documentIds,
      vectorResults,
      keywordResults,
      mergedCandidates,
      rerankedChunks: topChunks,
      confidenceResult,
      sources,
      llmResponse: answer,
    });

    return res.json({
      message: answer,
      answer,
      confidence: confidenceResult.confidence,
      confidenceScore: confidenceResult.confidenceScore,
      confidenceReasons: confidenceResult.reasons,
      sources,
      retrieval: {
        queryUsed: searchQuery,
        vectorHits: vectorResults.length,
        keywordHits: keywordResults.length,
        mergedCandidates: mergedCandidates.length,
        topChunksRetrieved: topChunks.length,
      },
    });
  } catch (error) {
    logger.error('Error handling chat request:', error);
    return res.status(500).json({
      error: 'Could not answer that question right now. Try again in a moment.',
    });
  }
}

app.post('/chat', handleChatRequest);
app.get('/chat', handleChatRequest);

app.get('/', (_req, res) => {
  return res.json({
    status: 'All Good!',
    service: 'Multi-Document Hybrid RAG Server',
    maxFileSizeBytes: config.MAX_FILE_SIZE_BYTES,
    config: {
      vectorTopK: config.VECTOR_TOP_K,
      keywordTopK: config.KEYWORD_TOP_K,
      rerankerTopK: config.RERANKER_TOP_K,
      confidenceThresholds: config.CONFIDENCE,
    },
  });
});

app.listen(config.PORT, () => {
  logger.info(`Server started on PORT:${config.PORT}`);
});

export default app;
