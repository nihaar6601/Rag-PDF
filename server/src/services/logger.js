export const logger = {
  info: (msg, data) => {
    if (data !== undefined) {
      console.log(`[INFO] ${msg}`, typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
    } else {
      console.log(`[INFO] ${msg}`);
    }
  },
  warn: (msg, data) => {
    if (data !== undefined) {
      console.warn(`[WARN] ${msg}`, data);
    } else {
      console.warn(`[WARN] ${msg}`);
    }
  },
  error: (msg, err) => {
    console.error(`[ERROR] ${msg}`, err);
  },
  queryTrace: ({
    originalQuery,
    rewrittenQuery,
    selectedDocumentIds,
    vectorResults = [],
    keywordResults = [],
    mergedCandidates = [],
    rerankedChunks = [],
    confidenceResult,
    sources = [],
    llmResponse,
  }) => {
    console.log('\n=================== [RAG QUERY TRACE] ===================');
    console.log(`Original Question:     ${originalQuery}`);
    if (rewrittenQuery && rewrittenQuery !== originalQuery) {
      console.log(`Rewritten Query:       ${rewrittenQuery}`);
    }
    console.log(`Document Scope:        ${selectedDocumentIds?.length ? selectedDocumentIds.join(', ') : 'ALL'}`);
    console.log(`Vector Hits:           ${vectorResults.length}`);
    console.log(`Keyword (BM25) Hits:   ${keywordResults.length}`);
    console.log(`Merged Candidates:     ${mergedCandidates.length}`);
    console.log(`Reranked Top Chunks:   ${rerankedChunks.length}`);
    rerankedChunks.forEach((c, idx) => {
      console.log(`  [${idx + 1}] Score: ${(c.score ?? 0).toFixed(4)} | Doc: ${c.document_name} (p.${c.page_number}) | Chunk: ${c.chunk_id}`);
    });
    console.log(`Confidence:            ${confidenceResult?.confidence?.toUpperCase()} (${(confidenceResult?.confidenceScore ?? 0).toFixed(4)})`);
    console.log(`Sources Selected:      ${sources.length} chunk(s) from [${[...new Set(sources.map((s) => s.documentName))].join(', ')}]`);
    console.log(`LLM Response Length:   ${llmResponse ? llmResponse.length : 0} chars`);
    console.log('=========================================================\n');
  },
};
