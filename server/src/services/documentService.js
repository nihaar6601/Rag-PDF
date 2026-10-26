import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { config } from '../config.js';
import { documentStore } from './documentStore.js';
import { bm25Index } from './bm25Service.js';
import { addChunksToVectorStore, deleteDocumentVectors } from './vectorStoreService.js';
import { logger } from './logger.js';

export async function processPdfDocument({ documentId, filePath, filename, onProgress }) {
  const updateStage = async (stage, progress = 0) => {
    documentStore.updateDocument(documentId, {
      status: stage === 'ready' ? 'ready' : stage === 'failed' ? 'failed' : 'preparing',
      stage,
      progress,
    });
    if (typeof onProgress === 'function') {
      try {
        await onProgress({ stage, progress });
      } catch (e) {
        // Ignore progress hook errors
      }
    }
  };

  try {
    // 1. Text extraction
    await updateStage('extracting', 15);
    logger.info(`Extracting text from ${filename} (${filePath})`);
    const loader = new PDFLoader(filePath);
    const docs = await loader.load();

    if (!docs || !docs.length) {
      throw new Error('This PDF has no readable text or is empty.');
    }

    const pageCount = docs.length;

    // 2. Chunking
    await updateStage('chunking', 40);
    logger.info(`Splitting ${docs.length} page(s) into chunks for ${filename}`);
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: config.CHUNK_SIZE,
      chunkOverlap: config.CHUNK_OVERLAP,
    });
    const splitDocs = await splitter.splitDocuments(docs);

    if (!splitDocs || !splitDocs.length) {
      throw new Error('Failed to create text chunks from PDF.');
    }

    // Format chunks with complete metadata
    const chunks = splitDocs.map((doc, index) => {
      const pageNumber =
        doc.metadata?.loc?.pageNumber ||
        doc.metadata?.loc?.lines?.from ||
        doc.metadata?.page ||
        1;

      return {
        chunk_id: `${documentId}_chunk_${index}`,
        document_id: documentId,
        document_name: filename,
        page_number: typeof pageNumber === 'number' ? pageNumber : 1,
        text: doc.pageContent,
      };
    });

    // 3. Save to DocumentStore and BM25 Index
    documentStore.saveChunks(chunks);
    bm25Index.build(documentStore.getChunks());

    // 4. Embedding & Indexing in Vector Store
    await updateStage('embedding', 65);
    logger.info(`Generating embeddings and indexing ${chunks.length} chunks for ${filename}`);

    await updateStage('indexing', 85);
    await addChunksToVectorStore(chunks);

    // 5. Ready
    await updateStage('ready', 100);
    documentStore.updateDocument(documentId, {
      status: 'ready',
      stage: 'ready',
      progress: 100,
      chunkCount: chunks.length,
      pageCount,
      error: null,
    });

    logger.info(`Document ${filename} successfully processed and indexed into multi-doc RAG system.`);
    return {
      documentId,
      filename,
      pageCount,
      chunkCount: chunks.length,
    };
  } catch (err) {
    logger.error(`Error processing document ${filename}:`, err);
    documentStore.updateDocument(documentId, {
      status: 'failed',
      stage: 'failed',
      error: err.message || 'Processing failed.',
    });
    throw err;
  }
}

export async function deleteDocument(documentId) {
  logger.info(`Deleting document ${documentId}`);
  // 1. Delete vector points from Qdrant
  await deleteDocumentVectors(documentId);

  // 2. Delete file & chunks from DocumentStore
  const success = documentStore.deleteDocument(documentId);

  // 3. Rebuild BM25 index with remaining chunks
  bm25Index.build(documentStore.getChunks());

  return success;
}
