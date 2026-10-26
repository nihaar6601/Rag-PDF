import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { BM25Index, tokenize } from '../src/services/bm25Service.js';
import { rerankCandidates } from '../src/services/rerankingService.js';
import { calculateConfidence, isSummarizationQuery } from '../src/services/confidenceService.js';
import { buildSystemPrompt, generateAnswer } from '../src/services/llmService.js';
import { isStandaloneQuery } from '../src/services/queryRewriteService.js';

describe('Multi-Document Hybrid RAG Test Suite', () => {
  const sampleChunks = [
    {
      chunk_id: 'doc1_chunk_0',
      document_id: 'doc1',
      document_name: 'annual_report_2025.pdf',
      page_number: 1,
      text: 'In fiscal year 2025, total revenue reached $150 million, representing a 12% growth in cloud software services.',
    },
    {
      chunk_id: 'doc1_chunk_1',
      document_id: 'doc1',
      document_name: 'annual_report_2025.pdf',
      page_number: 2,
      text: 'Operating expenses for 2025 were $95 million, primarily driven by investments in research and development.',
    },
    {
      chunk_id: 'doc2_chunk_0',
      document_id: 'doc2',
      document_name: 'annual_report_2026.pdf',
      page_number: 1,
      text: 'For fiscal year 2026, total revenue expanded to $185 million, accelerated by new enterprise AI products.',
    },
    {
      chunk_id: 'doc2_chunk_1',
      document_id: 'doc2',
      document_name: 'annual_report_2026.pdf',
      page_number: 2,
      text: 'In 2026, operating margin improved to 38%, while operating expenses totaled $110 million.',
    },
    {
      chunk_id: 'doc3_chunk_0',
      document_id: 'doc3',
      document_name: 'employee_handbook.pdf',
      page_number: 1,
      text: 'Standard vacation policy allows employees twenty days of paid leave per calendar year.',
    },
  ];

  let bm25;

  beforeEach(() => {
    bm25 = new BM25Index();
    bm25.build(sampleChunks);
  });

  describe('1. BM25 Keyword Search & Multi-Document Filtering', () => {
    it('tokenizes text and ignores common stopwords', () => {
      const tokens = tokenize('The total revenue in fiscal year 2025 was about 150 million');
      assert.ok(tokens.includes('total'));
      assert.ok(tokens.includes('revenue'));
      assert.ok(tokens.includes('2025'));
      assert.ok(!tokens.includes('the'));
      assert.ok(!tokens.includes('in'));
      assert.ok(!tokens.includes('was'));
    });

    it('retrieves relevant chunks across all documents when no filter is applied', () => {
      const results = bm25.search('revenue growth', { topK: 5 });
      assert.ok(results.length >= 2);
      const docIds = results.map((r) => r.document_id);
      assert.ok(docIds.includes('doc1'));
      assert.ok(docIds.includes('doc2'));
    });

    it('strictly filters retrieval to selected document_id', () => {
      const results = bm25.search('revenue', { topK: 5, documentIds: ['doc1'] });
      assert.ok(results.length > 0);
      for (const res of results) {
        assert.equal(res.document_id, 'doc1', `Expected doc1 but got ${res.document_id}`);
      }
    });

    it('filters retrieval to multiple selected document_ids and excludes unselected', () => {
      const results = bm25.search('operating expenses', {
        topK: 5,
        documentIds: ['doc1', 'doc2'],
      });
      assert.ok(results.length >= 2);
      for (const res of results) {
        assert.ok(
          res.document_id === 'doc1' || res.document_id === 'doc2',
          `Unexpected doc: ${res.document_id}`
        );
        assert.notEqual(res.document_id, 'doc3');
      }
    });
  });

  describe('2. Hybrid Retrieval Merging & Deduplication', () => {
    it('deduplicates identical chunks from vector and keyword search with overlap flag', () => {
      // Simulate vector search output
      const vectorResults = [
        {
          chunk_id: 'doc1_chunk_0',
          document_id: 'doc1',
          document_name: 'annual_report_2025.pdf',
          page_number: 1,
          text: sampleChunks[0].text,
          score: 0.88,
          vectorRank: 1,
        },
        {
          chunk_id: 'doc2_chunk_0',
          document_id: 'doc2',
          document_name: 'annual_report_2026.pdf',
          page_number: 1,
          text: sampleChunks[2].text,
          score: 0.82,
          vectorRank: 2,
        },
      ];

      // Simulate keyword search output (doc1_chunk_0 appears in both; doc1_chunk_1 only in keyword)
      const keywordResults = [
        {
          chunk_id: 'doc1_chunk_0',
          document_id: 'doc1',
          document_name: 'annual_report_2025.pdf',
          page_number: 1,
          text: sampleChunks[0].text,
          score: 0.95,
          keywordRank: 1,
        },
        {
          chunk_id: 'doc1_chunk_1',
          document_id: 'doc1',
          document_name: 'annual_report_2025.pdf',
          page_number: 2,
          text: sampleChunks[1].text,
          score: 0.70,
          keywordRank: 2,
        },
      ];

      // Merge logic identical to hybridRetrievalService
      const candidateMap = new Map();
      const RRF_K = 60;

      vectorResults.forEach((v) => {
        candidateMap.set(v.chunk_id, {
          ...v,
          vectorScore: v.score,
          keywordScore: 0,
          foundInVector: true,
          foundInKeyword: false,
          overlap: false,
          rrfScore: 1 / (RRF_K + v.vectorRank),
        });
      });

      keywordResults.forEach((k) => {
        if (candidateMap.has(k.chunk_id)) {
          const item = candidateMap.get(k.chunk_id);
          item.keywordScore = k.score;
          item.foundInKeyword = true;
          item.overlap = true;
          item.rrfScore += 1 / (RRF_K + k.keywordRank);
        } else {
          candidateMap.set(k.chunk_id, {
            ...k,
            vectorScore: 0,
            keywordScore: k.score,
            foundInVector: false,
            foundInKeyword: true,
            overlap: false,
            rrfScore: 1 / (RRF_K + k.keywordRank),
          });
        }
      });

      const merged = Array.from(candidateMap.values());

      // 3 unique chunks total (not 4)
      assert.equal(merged.length, 3, 'Should remove duplicates by chunk_id');

      const overlappingChunk = merged.find((c) => c.chunk_id === 'doc1_chunk_0');
      assert.ok(overlappingChunk, 'Overlapping chunk must exist');
      assert.equal(overlappingChunk.overlap, true);
      assert.equal(overlappingChunk.foundInVector, true);
      assert.equal(overlappingChunk.foundInKeyword, true);
      assert.ok(overlappingChunk.rrfScore > (1 / 61), 'RRF score should be boosted by dual appearance');
    });
  });

  describe('3. Reranking Flow & Score Calibration', () => {
    it('reranks candidates by relevance and places most relevant chunk at the top', () => {
      const candidates = [
        {
          chunk_id: 'chunk_weak',
          document_id: 'doc1',
          document_name: 'annual_report_2025.pdf',
          page_number: 2,
          text: 'Operating expenses for 2025 were $95 million.',
          vectorScore: 0.40,
          keywordScore: 0.30,
          overlap: false,
        },
        {
          chunk_id: 'chunk_strong',
          document_id: 'doc1',
          document_name: 'annual_report_2025.pdf',
          page_number: 1,
          text: 'In fiscal year 2025, total revenue reached $150 million, representing a 12% growth.',
          vectorScore: 0.90,
          keywordScore: 0.95,
          overlap: true,
        },
      ];

      const reranked = rerankCandidates('What was the total revenue in 2025?', candidates, {
        topK: 2,
      });

      assert.equal(reranked.length, 2);
      assert.equal(reranked[0].chunk_id, 'chunk_strong');
      assert.ok(reranked[0].score > reranked[1].score);
      assert.ok(reranked[0].score >= 0.70, 'Strong chunk score should be high');
    });

    it('respects topK parameter and cuts off excess candidates', () => {
      const candidates = sampleChunks.map((c, i) => ({
        ...c,
        vectorScore: 0.5 + i * 0.05,
        keywordScore: 0.5 + i * 0.05,
        overlap: i % 2 === 0,
      }));

      const top2 = rerankCandidates('revenue', candidates, { topK: 2 });
      assert.equal(top2.length, 2);
    });
  });

  describe('4. Confidence Calculation & Low Confidence Handling', () => {
    it('calculates High confidence when top chunk relevance is strong with keyword/vector consensus', () => {
      const topChunks = [
        { chunk_id: 'c1', score: 0.92, overlap: true, vectorScore: 0.90, keywordScore: 0.95 },
        { chunk_id: 'c2', score: 0.85, overlap: true, vectorScore: 0.80, keywordScore: 0.85 },
        { chunk_id: 'c3', score: 0.78, overlap: false, vectorScore: 0.75, keywordScore: 0.60 },
      ];
      const result = calculateConfidence({ query: 'What was the total revenue?', topChunks });
      assert.equal(result.confidence, 'high');
      assert.ok(result.confidenceScore >= 0.70);
    });

    it('calculates Medium confidence for moderate relevance scores', () => {
      const topChunks = [
        { chunk_id: 'c1', score: 0.58, overlap: false, vectorScore: 0.60, keywordScore: 0.50 },
        { chunk_id: 'c2', score: 0.50, overlap: false, vectorScore: 0.52, keywordScore: 0.45 },
      ];
      const result = calculateConfidence({ query: 'What is the operating expense?', topChunks });
      assert.equal(result.confidence, 'medium');
      assert.ok(result.confidenceScore >= 0.45 && result.confidenceScore < 0.70);
    });

    it('calculates Low confidence when scores are weak', () => {
      const topChunks = [
        { chunk_id: 'c1', score: 0.32, overlap: false, vectorScore: 0.35, keywordScore: 0.20 },
        { chunk_id: 'c2', score: 0.25, overlap: false, vectorScore: 0.28, keywordScore: 0.15 },
      ];
      const result = calculateConfidence({ query: 'What was the policy change in 1996?', topChunks, keywordResults: [{ chunk_id: 'x', score: 0.1 }] });
      assert.equal(result.confidence, 'low');
      assert.ok(result.confidenceScore < 0.45);
    });

    it('returns Low confidence when topChunks is empty', () => {
      const result = calculateConfidence({ query: 'Revenue?', topChunks: [] });
      assert.equal(result.confidence, 'low');
      assert.equal(result.confidenceScore, 0);
    });

    it('calculates at least Medium confidence for summarization queries even with low per-chunk scores', () => {
      // Simulates "Summarize this document" — BM25 returns 0, vector scores are moderate
      const topChunks = [
        { chunk_id: 'c1', score: 0.18, overlap: false, vectorScore: 0.45, keywordScore: 0 },
        { chunk_id: 'c2', score: 0.16, overlap: false, vectorScore: 0.42, keywordScore: 0 },
        { chunk_id: 'c3', score: 0.17, overlap: false, vectorScore: 0.40, keywordScore: 0 },
      ];
      const mergedCandidates = [...topChunks];
      const result = calculateConfidence({
        query: 'Provide a detailed summary of this document highlighting the core themes and takeaways.',
        topChunks,
        mergedCandidates,
        keywordResults: [],
      });
      assert.ok(result.signals.isSummarization === true, 'Should detect summarization intent');
      assert.ok(result.confidence === 'medium' || result.confidence === 'high', 'Summarization should yield at least Medium confidence');
      assert.ok(result.confidenceScore >= 0.45, `Expected >= 0.45 but got ${result.confidenceScore}`);
    });

    it('includes strict low-confidence warning in system prompt when confidence is low', () => {      const prompt = buildSystemPrompt(
        [
          {
            chunk_id: 'c1',
            document_name: 'test.pdf',
            page_number: 1,
            text: 'Some marginally relevant text',
          },
        ],
        'low'
      );

      assert.ok(prompt.includes('confidence for this query is LOW'));
      assert.ok(
        prompt.includes(
          'I could not find enough information in the uploaded documents to answer this confidently'
        )
      );
    });

    it('returns standard insufficient evidence answer when retrieved chunks are empty', async () => {
      const result = await generateAnswer({
        userQuery: 'What was the revenue?',
        retrievedChunks: [],
        confidenceLevel: 'low',
      });

      assert.equal(
        result.answer,
        'I could not find enough information in the uploaded documents to answer this confidently.'
      );
      assert.equal(result.sources.length, 0);
    });
  });

  describe('5. Source Tracking Metadata Format', () => {
    it('formats source chunks with complete document name, page number, chunk id, text, and score', async () => {
      const chunks = [
        {
          chunk_id: 'doc1_chunk_0',
          document_id: 'doc1',
          document_name: 'annual_report_2025.pdf',
          page_number: 8,
          text: 'Revenue was $150M.',
          score: 0.94,
        },
      ];

      const { sources } = await generateAnswer({
        userQuery: 'Revenue in 2025?',
        retrievedChunks: chunks,
        confidenceLevel: 'high',
      });

      assert.equal(sources.length, 1);
      const s = sources[0];
      assert.equal(s.documentId, 'doc1');
      assert.equal(s.documentName, 'annual_report_2025.pdf');
      assert.equal(s.pageNumber, 8);
      assert.equal(s.chunkId, 'doc1_chunk_0');
      assert.equal(s.text, 'Revenue was $150M.');
      assert.equal(s.score, 0.94);
    });
  });

  describe('6. Document Comparison Retrieval Balancing', () => {
    it('ensures balanced representation of both selected documents when comparing', () => {
      // Suppose doc1 has 3 high scoring chunks and doc2 has 2 moderately high scoring chunks
      const pool = [
        {
          chunk_id: 'doc1_c1',
          document_id: 'doc1',
          document_name: 'annual_report_2025.pdf',
          page_number: 1,
          text: '2025 revenue was $150M.',
          vectorScore: 0.95,
          keywordScore: 0.90,
          overlap: true,
        },
        {
          chunk_id: 'doc1_c2',
          document_id: 'doc1',
          document_name: 'annual_report_2025.pdf',
          page_number: 2,
          text: '2025 margins were 30%.',
          vectorScore: 0.90,
          keywordScore: 0.85,
          overlap: true,
        },
        {
          chunk_id: 'doc1_c3',
          document_id: 'doc1',
          document_name: 'annual_report_2025.pdf',
          page_number: 3,
          text: '2025 R&D was $20M.',
          vectorScore: 0.88,
          keywordScore: 0.80,
          overlap: false,
        },
        {
          chunk_id: 'doc2_c1',
          document_id: 'doc2',
          document_name: 'annual_report_2026.pdf',
          page_number: 1,
          text: '2026 revenue was $185M.',
          vectorScore: 0.85,
          keywordScore: 0.82,
          overlap: true,
        },
      ];

      // If document diversity is enforced for ['doc1', 'doc2'] with topK = 2:
      const reranked = rerankCandidates('Compare revenue between 2025 and 2026', pool, {
        topK: 2,
        selectedDocumentIds: ['doc1', 'doc2'],
      });

      assert.equal(reranked.length, 2);
      const docsInTop2 = reranked.map((c) => c.document_id);
      assert.ok(
        docsInTop2.includes('doc1') && docsInTop2.includes('doc2'),
        'Top chunks must include representation from both selected documents'
      );
    });
  });

  describe('7. Query Rewriting Classifier', () => {
    it('identifies standalone queries that do not need rewriting', () => {
      assert.equal(isStandaloneQuery('What was the total revenue in fiscal year 2025?'), true);
      assert.equal(isStandaloneQuery('Compare annual revenue between report 2025 and report 2026'), true);
    });

    it('identifies conversational follow-ups that need rewriting', () => {
      assert.equal(isStandaloneQuery('What about 2026?'), false);
      assert.equal(isStandaloneQuery('Why did it change?'), false);
      assert.equal(isStandaloneQuery('And for these?'), false);
    });
  });
});
