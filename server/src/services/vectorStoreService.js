import { QdrantVectorStore } from '@langchain/qdrant';
import { Document } from '@langchain/core/documents';
import { config } from '../config.js';
import { embeddings } from './embeddingService.js';
import { logger } from './logger.js';

let vectorStoreInstance = null;

export async function getVectorStore() {
  if (!vectorStoreInstance) {
    const storeOptions = {
      url: config.QDRANT.url,
      collectionName: config.QDRANT.collectionName,
    };
    try {
      vectorStoreInstance = await QdrantVectorStore.fromExistingCollection(
        embeddings,
        storeOptions
      );
    } catch {
      // If collection doesn't exist yet, create it with a dummy or initialization
      vectorStoreInstance = new QdrantVectorStore(embeddings, storeOptions);
      await vectorStoreInstance.ensureCollection();
    }
  }
  return vectorStoreInstance;
}

export async function addChunksToVectorStore(chunks) {
  if (!chunks || !chunks.length) return;
  const vectorStore = await getVectorStore();

  const documents = chunks.map(
    (chunk) =>
      new Document({
        pageContent: chunk.text,
        metadata: {
          document_id: chunk.document_id,
          document_name: chunk.document_name,
          page_number: chunk.page_number,
          chunk_id: chunk.chunk_id,
        },
      })
  );

  await vectorStore.addDocuments(documents);
  logger.info(`Added ${documents.length} chunks to Qdrant collection '${config.QDRANT.collectionName}'`);
}

export async function searchVectorStore(query, { topK = config.VECTOR_TOP_K, documentIds = null } = {}) {
  try {
    const vectorStore = await getVectorStore();

    let filter = undefined;
    if (documentIds && documentIds.length > 0) {
      if (documentIds.length === 1) {
        filter = {
          must: [
            {
              key: 'metadata.document_id',
              match: { value: documentIds[0] },
            },
          ],
        };
      } else {
        filter = {
          must: [
            {
              key: 'metadata.document_id',
              match: { any: documentIds },
            },
          ],
        };
      }
    }

    const resultsWithScore = await vectorStore.similaritySearchWithScore(query, topK, filter);

    return resultsWithScore.map(([doc, score], index) => {
      // In Qdrant / Langchain with cosine distance, score is typically cosine similarity (0 to 1)
      const normalizedScore = Math.min(1.0, Math.max(0.0, typeof score === 'number' ? score : 0.5));
      return {
        chunk_id: doc.metadata?.chunk_id || `chunk_${index}`,
        document_id: doc.metadata?.document_id || '',
        document_name: doc.metadata?.document_name || '',
        page_number: doc.metadata?.page_number || 1,
        text: doc.pageContent,
        score: normalizedScore,
        rawVectorScore: score,
        vectorRank: index + 1,
        source: 'vector',
      };
    });
  } catch (error) {
    logger.error('Error during vector search:', error);
    return [];
  }
}

export async function deleteDocumentVectors(documentId) {
  try {
    const vectorStore = await getVectorStore();
    if (vectorStore.client && typeof vectorStore.client.delete === 'function') {
      await vectorStore.client.delete(config.QDRANT.collectionName, {
        wait: true,
        filter: {
          must: [
            {
              key: 'metadata.document_id',
              match: { value: documentId },
            },
          ],
        },
      });
      logger.info(`Deleted vectors in Qdrant for documentId '${documentId}'`);
      return true;
    }
  } catch (err) {
    logger.warn(`Could not delete vectors for documentId '${documentId}':`, err.message);
  }
  return false;
}
