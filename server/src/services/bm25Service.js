import { config } from '../config.js';
import { documentStore } from './documentStore.js';

const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'as',
  'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can',
  'did', 'do', 'does', 'doing', 'don', 'down', 'during', 'each', 'few', 'for', 'from', 'further',
  'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his',
  'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'just', 'me', 'more', 'most', 'my',
  'myself', 'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our',
  'ours', 'ourselves', 'out', 'over', 'own', 's', 'same', 'she', 'should', 'so', 'some', 'such',
  't', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these',
  'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we',
  'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with', 'you',
  'your', 'yours', 'yourself', 'yourselves'
]);

export function tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export class BM25Index {
  constructor(options = {}) {
    this.k1 = options.k1 ?? config.BM25.k1;
    this.b = options.b ?? config.BM25.b;
    this.corpus = []; // Array of { chunk_id, document_id, document_name, page_number, text, tokens, length }
    this.docFreq = new Map(); // term -> count of docs containing term
    this.avgDocLength = 0;
    this.docCount = 0;
  }

  build(chunks) {
    this.corpus = [];
    this.docFreq.clear();
    let totalLength = 0;

    for (const chunk of chunks) {
      const tokens = tokenize(chunk.text);
      const docEntry = {
        chunk_id: chunk.chunk_id,
        document_id: chunk.document_id,
        document_name: chunk.document_name,
        page_number: chunk.page_number,
        text: chunk.text,
        tokens,
        length: tokens.length,
        termFreqs: new Map(),
      };

      for (const t of tokens) {
        docEntry.termFreqs.set(t, (docEntry.termFreqs.get(t) || 0) + 1);
      }

      for (const t of docEntry.termFreqs.keys()) {
        this.docFreq.set(t, (this.docFreq.get(t) || 0) + 1);
      }

      totalLength += docEntry.length;
      this.corpus.push(docEntry);
    }

    this.docCount = this.corpus.length;
    this.avgDocLength = this.docCount > 0 ? totalLength / this.docCount : 0;
  }

  search(query, { topK = config.KEYWORD_TOP_K, documentIds = null } = {}) {
    if (!this.corpus.length) {
      // Lazy load from documentStore
      const existing = documentStore.getChunks();
      if (existing.length) {
        this.build(existing);
      }
    }

    const queryTokens = tokenize(query);
    if (!queryTokens.length || !this.corpus.length) {
      return [];
    }

    const allowedDocs = documentIds?.length ? new Set(documentIds) : null;
    const scores = [];

    for (const doc of this.corpus) {
      if (allowedDocs && !allowedDocs.has(doc.document_id)) {
        continue;
      }

      let score = 0;
      let matchedTerms = 0;

      for (const token of queryTokens) {
        const tf = doc.termFreqs.get(token) || 0;
        if (tf === 0) continue;

        matchedTerms++;
        const df = this.docFreq.get(token) || 1;
        // Robertson-Spärck Jones IDF
        const idf = Math.log(1 + (this.docCount - df + 0.5) / (df + 0.5));
        const num = tf * (this.k1 + 1);
        const denom = tf + this.k1 * (1 - this.b + this.b * (doc.length / (this.avgDocLength || 1)));
        score += idf * (num / denom);
      }

      if (score > 0) {
        scores.push({
          chunk_id: doc.chunk_id,
          document_id: doc.document_id,
          document_name: doc.document_name,
          page_number: doc.page_number,
          text: doc.text,
          rawScore: score,
          matchedTerms,
          termCoverage: matchedTerms / queryTokens.length,
        });
      }
    }

    if (!scores.length) return [];

    scores.sort((a, b) => b.rawScore - a.rawScore);
    const topResults = scores.slice(0, topK);

    // Normalize scores to [0, 1] relative to the top raw score
    const maxScore = topResults[0].rawScore;
    return topResults.map((item, index) => ({
      ...item,
      score: maxScore > 0 ? Math.min(1.0, Math.max(0.0, item.rawScore / maxScore)) : 0,
      keywordRank: index + 1,
      source: 'keyword',
    }));
  }
}

export const bm25Index = new BM25Index();
