import { config } from '../config.js';
import { tokenize } from './bm25Service.js';
import { logger } from './logger.js';

function computeQueryCoverage(queryTokens, text) {
  if (!queryTokens.length || !text) return 0;
  const lowerText = text.toLowerCase();
  let matched = 0;
  for (const token of queryTokens) {
    if (lowerText.includes(token)) {
      matched++;
    }
  }
  return matched / queryTokens.length;
}

function computePhraseBonus(query, text) {
  if (!query || !text) return 0;
  const cleanQ = query.toLowerCase().trim();
  const cleanT = text.toLowerCase();

  // Full query exact match
  if (cleanQ.length > 5 && cleanT.includes(cleanQ)) {
    return 1.0;
  }

  // Bigram phrase matches
  const words = cleanQ.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    let bigramMatches = 0;
    const totalBigrams = words.length - 1;
    for (let i = 0; i < totalBigrams; i++) {
      const bigram = `${words[i]} ${words[i + 1]}`;
      if (cleanT.includes(bigram)) {
        bigramMatches++;
      }
    }
    return bigramMatches / totalBigrams;
  }

  return 0;
}

export function rerankCandidates(
  query,
  candidates,
  {
    topK = config.RERANKER_TOP_K,
    minRelevanceScore = 0.15,
    selectedDocumentIds = null,
  } = {}
) {
  if (!candidates || !candidates.length) {
    return [];
  }

  const queryTokens = tokenize(query);

  const scoredCandidates = candidates.map((cand) => {
    const vScore = cand.vectorScore || 0;
    const kScore = cand.keywordScore || 0;
    const coverage = computeQueryCoverage(queryTokens, cand.text);
    const phraseBonus = computePhraseBonus(query, cand.text);
    const overlapBonus = cand.overlap ? 1.0 : 0.0;

    // Weighted composite relevance score (normalized to [0, 1])
    // Vector similarity: 0.40, BM25: 0.25, Query term coverage: 0.15, Phrase match: 0.10, Overlap: 0.10
    const score = Math.min(
      1.0,
      Math.max(
        0.0,
        0.40 * vScore +
          0.25 * kScore +
          0.15 * coverage +
          0.10 * phraseBonus +
          0.10 * overlapBonus
      )
    );

    return {
      ...cand,
      score: parseFloat(score.toFixed(4)),
      coverageScore: parseFloat(coverage.toFixed(4)),
      phraseBonus: parseFloat(phraseBonus.toFixed(4)),
    };
  });

  // Sort descending by score
  scoredCandidates.sort((a, b) => b.score - a.score);

  // Filter out completely irrelevant chunks below minRelevanceScore
  const filtered = scoredCandidates.filter((c) => c.score >= minRelevanceScore);
  const pool = filtered.length > 0 ? filtered : scoredCandidates.slice(0, 1);

  // If comparing multiple selected documents, ensure document diversity in top chunks
  if (selectedDocumentIds && selectedDocumentIds.length > 1) {
    const selected = [];
    const seenDocs = new Set();
    const remaining = [];

    // First pass: pick best chunk for each selected document
    for (const item of pool) {
      if (selectedDocumentIds.includes(item.document_id) && !seenDocs.has(item.document_id)) {
        selected.push(item);
        seenDocs.add(item.document_id);
      } else {
        remaining.push(item);
      }
    }

    // Second pass: fill remaining capacity up to topK by highest score
    while (selected.length < topK && remaining.length > 0) {
      selected.push(remaining.shift());
    }

    selected.sort((a, b) => b.score - a.score);
    return selected.slice(0, topK);
  }

  return pool.slice(0, topK);
}
