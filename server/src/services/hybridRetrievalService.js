import { config } from '../config.js';
import { searchVectorStore } from './vectorStoreService.js';
import { bm25Index } from './bm25Service.js';
import { logger } from './logger.js';

const RRF_K = 60;

export async function hybridRetrieve(
  query,
  {
    documentIds = null,
    vectorTopK = config.VECTOR_TOP_K,
    keywordTopK = config.KEYWORD_TOP_K,
    perDocTopK = config.COMPARISON_PER_DOC_TOP_K,
    isComparison = false,
  } = {}
) {
  let vectorResults = [];
  let keywordResults = [];

  const isMultiDoc = Array.isArray(documentIds) && documentIds.length > 1;

  if (isMultiDoc && (isComparison || documentIds.length >= 2)) {
    // Balanced per-document retrieval to ensure no document starves the other
    logger.info(`Performing balanced multi-document retrieval for ${documentIds.length} documents`);

    const perDocPromises = documentIds.map(async (docId) => {
      const [vRes, kRes] = await Promise.all([
        searchVectorStore(query, { topK: perDocTopK, documentIds: [docId] }),
        Promise.resolve(bm25Index.search(query, { topK: perDocTopK, documentIds: [docId] })),
      ]);
      return { vRes, kRes };
    });

    const perDocOutputs = await Promise.all(perDocPromises);
    for (const out of perDocOutputs) {
      vectorResults.push(...out.vRes);
      keywordResults.push(...out.kRes);
    }

    // Also run overall query across all selected docs to catch best global matches
    const [globalVec, globalKw] = await Promise.all([
      searchVectorStore(query, { topK: vectorTopK, documentIds }),
      Promise.resolve(bm25Index.search(query, { topK: keywordTopK, documentIds })),
    ]);
    vectorResults.push(...globalVec);
    keywordResults.push(...globalKw);
  } else {
    // Single-doc or all-docs standard hybrid retrieval
    const [vecRes, kwRes] = await Promise.all([
      searchVectorStore(query, { topK: vectorTopK, documentIds }),
      Promise.resolve(bm25Index.search(query, { topK: keywordTopK, documentIds })),
    ]);
    vectorResults = vecRes;
    keywordResults = kwRes;
  }

  // Merge and deduplicate by chunk_id
  const candidateMap = new Map();

  // Index vector results
  vectorResults.forEach((item, index) => {
    if (!item.chunk_id) return;
    const vRank = item.vectorRank || index + 1;
    candidateMap.set(item.chunk_id, {
      chunk_id: item.chunk_id,
      document_id: item.document_id,
      document_name: item.document_name,
      page_number: item.page_number,
      text: item.text,
      vectorScore: item.score ?? 0,
      vectorRank: vRank,
      keywordScore: 0,
      keywordRank: null,
      foundInVector: true,
      foundInKeyword: false,
      overlap: false,
      rrfScore: 1 / (RRF_K + vRank),
    });
  });

  // Merge keyword results
  keywordResults.forEach((item, index) => {
    if (!item.chunk_id) return;
    const kRank = item.keywordRank || index + 1;
    if (candidateMap.has(item.chunk_id)) {
      const existing = candidateMap.get(item.chunk_id);
      existing.keywordScore = item.score ?? 0;
      existing.keywordRank = kRank;
      existing.foundInKeyword = true;
      existing.overlap = true;
      existing.rrfScore += 1 / (RRF_K + kRank);
    } else {
      candidateMap.set(item.chunk_id, {
        chunk_id: item.chunk_id,
        document_id: item.document_id,
        document_name: item.document_name,
        page_number: item.page_number,
        text: item.text,
        vectorScore: 0,
        vectorRank: null,
        keywordScore: item.score ?? 0,
        keywordRank: kRank,
        foundInVector: false,
        foundInKeyword: true,
        overlap: false,
        rrfScore: 1 / (RRF_K + kRank),
      });
    }
  });

  const mergedCandidates = Array.from(candidateMap.values());
  const overlapCount = mergedCandidates.filter((c) => c.overlap).length;

  logger.info(
    `Hybrid retrieval merged ${mergedCandidates.length} unique candidates (Vector: ${vectorResults.length}, BM25: ${keywordResults.length}, Overlap: ${overlapCount})`
  );

  return {
    mergedCandidates,
    vectorResults,
    keywordResults,
    overlapCount,
  };
}
