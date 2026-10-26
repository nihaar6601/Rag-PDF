import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

const DATA_DIR = config.DATA_DIR;
const DOCS_FILE = path.join(DATA_DIR, 'documents.json');
const CHUNKS_FILE = path.join(DATA_DIR, 'chunks.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readJsonFile(filePath, defaultValue = {}) {
  ensureDataDir();
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf8');
    return defaultValue;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
    return defaultValue;
  }
}

function writeJsonFile(filePath, data) {
  ensureDataDir();
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

class DocumentStore {
  constructor() {
    this.documents = readJsonFile(DOCS_FILE, {});
    this.chunks = readJsonFile(CHUNKS_FILE, {});
  }

  saveDocument(doc) {
    const now = new Date().toISOString();
    const document = {
      id: doc.id,
      name: doc.name || doc.filename,
      filename: doc.filename || doc.name,
      path: doc.path || '',
      size: doc.size || 0,
      status: doc.status || 'uploading',
      stage: doc.stage || 'uploading',
      progress: doc.progress || 0,
      error: doc.error || null,
      pageCount: doc.pageCount || 0,
      chunkCount: doc.chunkCount || 0,
      createdAt: doc.createdAt || now,
      updatedAt: now,
    };
    this.documents[document.id] = document;
    this.persistDocuments();
    return document;
  }

  updateDocument(id, updates) {
    if (!this.documents[id]) {
      return null;
    }
    this.documents[id] = {
      ...this.documents[id],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.persistDocuments();
    return this.documents[id];
  }

  getDocument(id) {
    return this.documents[id] || null;
  }

  getAllDocuments() {
    return Object.values(this.documents).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  deleteDocument(id) {
    const doc = this.documents[id];
    if (!doc) return false;

    // Delete associated uploaded file if exists
    if (doc.path && fs.existsSync(doc.path)) {
      try {
        fs.unlinkSync(doc.path);
      } catch (e) {
        console.warn(`Could not delete file ${doc.path}:`, e.message);
      }
    }

    delete this.documents[id];
    this.persistDocuments();

    // Delete chunks
    this.deleteChunksByDocumentId(id);
    return true;
  }

  saveChunks(chunkList) {
    for (const chunk of chunkList) {
      if (!chunk.chunk_id) continue;
      this.chunks[chunk.chunk_id] = {
        chunk_id: chunk.chunk_id,
        document_id: chunk.document_id,
        document_name: chunk.document_name,
        page_number: chunk.page_number,
        text: chunk.text,
      };
    }
    this.persistChunks();
  }

  getChunks(documentIds = null) {
    const allChunks = Object.values(this.chunks);
    if (!documentIds || !documentIds.length) {
      return allChunks;
    }
    const idSet = new Set(documentIds);
    return allChunks.filter((c) => idSet.has(c.document_id));
  }

  deleteChunksByDocumentId(documentId) {
    let deletedCount = 0;
    for (const [id, chunk] of Object.entries(this.chunks)) {
      if (chunk.document_id === documentId) {
        delete this.chunks[id];
        deletedCount++;
      }
    }
    if (deletedCount > 0) {
      this.persistChunks();
    }
    return deletedCount;
  }

  persistDocuments() {
    writeJsonFile(DOCS_FILE, this.documents);
  }

  persistChunks() {
    writeJsonFile(CHUNKS_FILE, this.chunks);
  }

  clear() {
    this.documents = {};
    this.chunks = {};
    this.persistDocuments();
    this.persistChunks();
  }
}

export const documentStore = new DocumentStore();
