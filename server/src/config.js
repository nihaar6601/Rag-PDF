import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Server
  PORT: parseInt(process.env.PORT || '8000', 10),
  MAX_FILE_SIZE_BYTES: parseInt(process.env.MAX_FILE_SIZE_BYTES || String(10 * 1024 * 1024), 10),
  UPLOADS_DIR: path.join(process.cwd(), 'uploads'),
  DATA_DIR: path.join(process.cwd(), 'data'),

  // Services
  REDIS: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
  QDRANT: {
    url: process.env.QDRANT_URL || 'http://localhost:6333',
    collectionName: process.env.QDRANT_COLLECTION || 'langchainjs-testing',
  },
  GROQ: {
    apiKey: process.env.GROQ_API_KEY || '',
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
  },

  // Document Chunking
  CHUNK_SIZE: parseInt(process.env.CHUNK_SIZE || '1000', 10),
  CHUNK_OVERLAP: parseInt(process.env.CHUNK_OVERLAP || '200', 10),

  // Embedding
  EMBEDDING_MODEL: process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2',

  // Retrieval Top-K Values
  VECTOR_TOP_K: parseInt(process.env.VECTOR_TOP_K || '6', 10),
  KEYWORD_TOP_K: parseInt(process.env.KEYWORD_TOP_K || '6', 10),
  RERANKER_TOP_K: parseInt(process.env.RERANKER_TOP_K || '4', 10),
  COMPARISON_PER_DOC_TOP_K: parseInt(process.env.COMPARISON_PER_DOC_TOP_K || '3', 10),

  // BM25 Tuning
  BM25: {
    k1: parseFloat(process.env.BM25_K1 || '1.2'),
    b: parseFloat(process.env.BM25_B || '0.75'),
  },

  // Confidence Scoring Thresholds
  CONFIDENCE: {
    highThreshold: parseFloat(process.env.CONFIDENCE_HIGH_THRESHOLD || '0.70'),
    mediumThreshold: parseFloat(process.env.CONFIDENCE_MEDIUM_THRESHOLD || '0.45'),
  },

  // Query Rewriting
  ENABLE_QUERY_REWRITE: process.env.ENABLE_QUERY_REWRITE !== 'false',
};
