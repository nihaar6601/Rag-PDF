import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { Queue } from 'bullmq';
import Groq from 'groq-sdk';
import { pipeline } from '@huggingface/transformers';
import { QdrantVectorStore } from '@langchain/qdrant';
import dotenv from 'dotenv';

dotenv.config();

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const redisConnection = { host: 'localhost', port: 6379 };

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const queue = new Queue('file-upload-queue', {
  connection: redisConnection,
});

function isPdfFile(file) {
  const name = (file.originalname || '').toLowerCase();
  return file.mimetype === 'application/pdf' || name.endsWith('.pdf');
}

const storage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (_req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
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

app.post('/upload/pdf', (req, res) => {
  upload.single('pdf')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: `That PDF is too large. The limit is ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB.`,
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

    try {
      const job = await queue.add('file-ready', {
        filename: req.file.originalname,
        destination: req.file.destination,
        path: req.file.path,
        size: req.file.size,
      });

      return res.json({
        jobId: job.id,
        filename: req.file.originalname,
        size: req.file.size,
        maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
      });
    } catch (queueError) {
      console.error(queueError);
      return res.status(500).json({
        error: 'The file was received, but it could not be queued for processing.',
      });
    }
  });
});

app.get('/jobs/:id', async (req, res) => {
  try {
    const job = await queue.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'That upload could not be found.' });
    }

    const state = await job.getState();
    const payload = parseJobPayload(job.data);

    return res.json({
      jobId: job.id,
      status: mapQueueState(state),
      queueState: state,
      filename: payload.filename || null,
      size: payload.size || null,
      error: state === 'failed' ? job.failedReason || 'Processing failed.' : null,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Could not check document status.' });
  }
});

const extractor = await pipeline(
  'feature-extraction',
  'Xenova/all-MiniLM-L6-v2'
);

const client = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

app.get('/chat', async (req, res) => {
  const userQuery = typeof req.query.message === 'string' ? req.query.message.trim() : '';

  if (!userQuery) {
    return res.status(400).json({ error: 'Please enter a question.' });
  }

  try {
    const embeddings = {
      embedDocuments: async (texts) => {
        const output = await extractor(texts, {
          pooling: 'mean',
          normalize: true,
        });
        return output.tolist();
      },
      embedQuery: async (text) => {
        const output = await extractor(text, {
          pooling: 'mean',
          normalize: true,
        });
        return output.tolist()[0];
      },
    };

    const vectorStore = await QdrantVectorStore.fromExistingCollection(
      embeddings,
      {
        url: 'http://localhost:6333',
        collectionName: 'langchainjs-testing',
      }
    );
    const ret = vectorStore.asRetriever({
      k: 2,
    });
    const result = await ret.invoke(userQuery);

    const SYSTEM_PROMPT = `
    You are a helpful assistant who answers the user query based on the available context from uploaded PDF files.
    If the context is not enough, say you could not find that in the uploaded documents.
    Context:
    ${JSON.stringify(result)}
    `;

    const chatResult = await client.chat.completions.create({
      model: 'openai/gpt-oss-20b',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userQuery },
      ],
    });

    return res.json({
      message: chatResult.choices[0].message.content,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: 'Could not answer that question right now. Try again in a moment.',
    });
  }
});

app.get('/', (_req, res) => {
  return res.json({ status: 'All Good!', maxFileSizeBytes: MAX_FILE_SIZE_BYTES });
});

app.listen(8000, () => console.log(`Server started on PORT:${8000}`));
