import { config } from '../config.js';

// Query patterns that are structural/meta in nature — not factual lookups
const SUMMARIZATION_PATTERNS = [
  /\bsummar/i,
  /\boverview\b/i,
  /\bkey\s+takeaway/i,
  /\bkey\s+finding/i,
  /\bmain\s+(point|topic|theme|finding|idea)/i,
  /\bwhat\s+(does|is)\s+this\s+(document|letter|report|file)/i,
  /\bwhat\s+(is\s+this\s+about|are\s+the\s+(main|key))/i,
  /\bexplain\s+(this|the\s+(document|letter|report))/i,
  /\btell\s+me\s+about\s+this/i,
  /\bhighlight(ing)?\s+(the\s+)?(core|key|main|important)/i,
  /\bcompare\b/i,
  /\bcontrast\b/i,
];

export function isSummarizationQuery(query) {
  return SUMMARIZATION_PATTERNS.some((pattern) => pattern.test(query));
}

export function calculateConfidence({
  query = '',
  topChunks = [],
  vectorResults = [],
  keywordResults = [],
  mergedCandidates = [],
} = {}) {
  const reasons = [];

  if (!topChunks || topChunks.length === 0) {
    return {
      confidence: 'low',
      confidenceScore: 0,
      reasons: ['No matching document chunks found'],
      signals: {
        topScore: 0,
        averageTopScore: 0,
        overlapCount: 0,
        supportingChunksCount: 0,
        isSummarization: false,
      },
    };
  }

  const summarization = isSummarizationQuery(query);

  const s1 = topChunks[0].score || 0;
  const top3 = topChunks.slice(0, 3);
  const avgTop = top3.reduce((acc, c) => acc + (c.score || 0), 0) / top3.length;
  const overlapCount = top3.filter((c) => c.overlap).length;
  const supportingChunksCount = topChunks.filter(
    (c) => (c.score || 0) >= config.CONFIDENCE.mediumThreshold
  ).length;

  // ------------ Summarization Mode ------------
  // When the query is a structural meta-query (summarize, compare, overview etc.),
  // the retrieval scores are inherently lower because the query words don't appear
  // in the document text. Confidence should instead be based on:
  // - How many chunks were retrieved (document coverage)
  // - The vector similarity of those chunks (semantic relevance)
  // - Whether ANY content was found at all
  if (summarization) {
    // Document coverage: how many unique chunks were surfaced relative to what was available
    const totalCandidates = mergedCandidates.length;
    const chunkCoverage = totalCandidates > 0 ? Math.min(1.0, topChunks.length / Math.max(totalCandidates, 1)) : 0;

    // Average raw vector similarity across all top chunks (before composite reranking penalty)
    const avgVectorScore =
      topChunks.reduce((acc, c) => acc + (c.vectorScore || c.score || 0), 0) /
      topChunks.length;

    // Base: 50% average vector similarity + 30% document coverage + 20% chunk count depth
    const chunkDepthBonus = Math.min(0.20, (topChunks.length / 5) * 0.20);
    let rawConfidence = 0.50 * avgVectorScore + 0.30 * chunkCoverage + chunkDepthBonus;

    // If we retrieved chunks from the document at all, apply a minimum floor
    if (topChunks.length >= 1 && avgVectorScore > 0.20) {
      rawConfidence = Math.max(rawConfidence, 0.50); // at least Medium for summarization with evidence
      reasons.push('Summarization query: confidence based on document coverage and retrieval breadth');
    }

    if (topChunks.length >= 3) {
      rawConfidence = Math.max(rawConfidence, 0.68);
      reasons.push('Sufficient document chunks retrieved to support a comprehensive summary');
    }

    const confidenceScore = parseFloat(Math.min(1.0, Math.max(0.0, rawConfidence)).toFixed(4));
    let confidence = 'low';
    if (confidenceScore >= config.CONFIDENCE.highThreshold) {
      confidence = 'high';
    } else if (confidenceScore >= config.CONFIDENCE.mediumThreshold) {
      confidence = 'medium';
    }

    return {
      confidence,
      confidenceScore,
      reasons,
      signals: {
        topScore: s1,
        averageTopScore: parseFloat(avgTop.toFixed(4)),
        avgVectorScore: parseFloat(avgVectorScore.toFixed(4)),
        overlapCount,
        supportingChunksCount,
        isSummarization: true,
        chunkCoverage: parseFloat(chunkCoverage.toFixed(4)),
      },
    };
  }

  // ------------ Standard Factual Query Mode ------------
  // Base score: 60% top chunk relevance + 40% top chunks mean relevance
  let rawConfidence = 0.60 * s1 + 0.40 * avgTop;

  // Hybrid search overlap bonus (both vector & keyword search agreed)
  if (overlapCount >= 2) {
    rawConfidence += 0.10;
    reasons.push('Multiple top chunks verified by both vector and keyword search');
  } else if (overlapCount === 1) {
    rawConfidence += 0.05;
    reasons.push('Top chunk verified by both vector and keyword search');
  }

  // Penalize only if BM25 had results but found nothing (genuine evidence gap)
  // Do NOT penalize if BM25 simply returned 0 results for a generic query
  const bm25HadResults = keywordResults && keywordResults.length > 0;
  if (supportingChunksCount >= 3) {
    rawConfidence += 0.05;
    reasons.push('Multiple high-relevance chunks support this answer');
  } else if (supportingChunksCount <= 1 && topChunks.length > 1 && bm25HadResults) {
    rawConfidence -= 0.05;
    reasons.push('Limited secondary evidence across document chunks');
  }

  const confidenceScore = parseFloat(Math.min(1.0, Math.max(0.0, rawConfidence)).toFixed(4));

  let confidence = 'low';
  if (confidenceScore >= config.CONFIDENCE.highThreshold) {
    confidence = 'high';
  } else if (confidenceScore >= config.CONFIDENCE.mediumThreshold) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  return {
    confidence,
    confidenceScore,
    reasons,
    signals: {
      topScore: s1,
      averageTopScore: parseFloat(avgTop.toFixed(4)),
      overlapCount,
      supportingChunksCount,
      isSummarization: false,
    },
  };
}
