import { BM25Index } from '../src/services/bm25Service.js';
import { rerankCandidates } from '../src/services/rerankingService.js';

// Corpus of evaluation documents representing real multi-document RAG domain
const EVALUATION_CORPUS = [
  // Document 1: 2025 Annual Financial Report
  {
    chunk_id: 'fin2025_p1_c1',
    document_id: 'doc_fin2025',
    document_name: 'annual_report_2025.pdf',
    page_number: 1,
    text: 'Financial Highlights 2025: Total revenue reached $150 million, up 12% year-over-year. Subscription revenue was $115 million.',
  },
  {
    chunk_id: 'fin2025_p3_c2',
    document_id: 'doc_fin2025',
    document_name: 'annual_report_2025.pdf',
    page_number: 3,
    text: 'Operational Performance 2025: Operating income reached $45 million, while total operating expenses were $95 million.',
  },
  {
    chunk_id: 'fin2025_p8_c3',
    document_id: 'doc_fin2025',
    document_name: 'annual_report_2025.pdf',
    page_number: 8,
    text: 'Capital Allocation: Capital expenditures in 2025 were $18 million, primarily allocated to cloud data center expansion in North America.',
  },

  // Document 2: 2026 Annual Financial Report
  {
    chunk_id: 'fin2026_p1_c1',
    document_id: 'doc_fin2026',
    document_name: 'annual_report_2026.pdf',
    page_number: 1,
    text: 'Executive Summary 2026: Total annual revenue expanded to $185 million, driven by a 45% surge in enterprise generative AI contracts.',
  },
  {
    chunk_id: 'fin2026_p4_c2',
    document_id: 'doc_fin2026',
    document_name: 'annual_report_2026.pdf',
    page_number: 4,
    text: 'Profitability 2026: Operating margin expanded to 38%. Research and Development expenditures were $35 million.',
  },
  {
    chunk_id: 'fin2026_p7_c3',
    document_id: 'doc_fin2026',
    document_name: 'annual_report_2026.pdf',
    page_number: 7,
    text: 'Workforce and Organization: Headcount increased to 1,250 full-time employees across offices in New York, London, and Tokyo.',
  },

  // Document 3: Security & Compliance Policy
  {
    chunk_id: 'sec_p2_c1',
    document_id: 'doc_sec2026',
    document_name: 'security_policy_v3.pdf',
    page_number: 2,
    text: 'Data Retention Schedule: Customer session logs must be retained for 90 days. Backups are encrypted with AES-256 and stored offsite.',
  },
  {
    chunk_id: 'sec_p5_c2',
    document_id: 'doc_sec2026',
    document_name: 'security_policy_v3.pdf',
    page_number: 5,
    text: 'Incident Response Protocol: Any potential PII exposure must be reported to the Data Protection Officer within 24 hours of discovery.',
  },

  // Document 4: Human Resources & Leave Policy
  {
    chunk_id: 'hr_p1_c1',
    document_id: 'doc_hr2026',
    document_name: 'employee_handbook.pdf',
    page_number: 1,
    text: 'Paid Time Off Policy: All permanent employees are entitled to 20 days paid vacation, 10 days sick leave, and 12 public holidays annually.',
  },
  {
    chunk_id: 'hr_p3_c2',
    document_id: 'doc_hr2026',
    document_name: 'employee_handbook.pdf',
    page_number: 3,
    text: 'Remote Work Guidelines: Staff may work remotely up to three days per week with departmental manager approval.',
  },
  // Challenging Distractor Chunks (High semantic overlap across years/clauses)
  {
    chunk_id: 'fin2024_p1_c1',
    document_id: 'doc_fin2024',
    document_name: 'annual_report_2024.pdf',
    page_number: 1,
    text: 'Financial Overview 2024: Total annual revenue was $130 million, with cloud services growing steadily throughout the fiscal year.',
  },
  {
    chunk_id: 'sec_p1_c1',
    document_id: 'doc_sec2026',
    document_name: 'security_policy_v3.pdf',
    page_number: 1,
    text: 'General Retention: Standard non-sensitive operational records are archived annually before scheduled disposal.',
  },
];

// Evaluation dataset containing precise questions, target chunk, and document
const EVALUATION_BENCHMARK = [
  {
    query: 'What was the total revenue in fiscal year 2025?',
    targetChunkId: 'fin2025_p1_c1',
    targetDocId: 'doc_fin2025',
  },
  {
    query: 'How much did total revenue expand to in 2026?',
    targetChunkId: 'fin2026_p1_c1',
    targetDocId: 'doc_fin2026',
  },
  {
    query: 'What was the operating expense for 2025?',
    targetChunkId: 'fin2025_p3_c2',
    targetDocId: 'doc_fin2025',
  },
  {
    query: 'What was the operating margin percentage in 2026?',
    targetChunkId: 'fin2026_p4_c2',
    targetDocId: 'doc_fin2026',
  },
  {
    query: 'What were the capital expenditures for cloud data center expansion?',
    targetChunkId: 'fin2025_p8_c3',
    targetDocId: 'doc_fin2025',
  },
  {
    query: 'How many full-time employees were reported in 2026 headcount?',
    targetChunkId: 'fin2026_p7_c3',
    targetDocId: 'doc_fin2026',
  },
  {
    query: 'How long must customer session logs be retained?',
    targetChunkId: 'sec_p2_c1',
    targetDocId: 'doc_sec2026',
  },
  {
    query: 'Within what timeframe must potential PII exposure be reported to the DPO?',
    targetChunkId: 'sec_p5_c2',
    targetDocId: 'doc_sec2026',
  },
  {
    query: 'How many days of paid vacation leave are permanent employees entitled to?',
    targetChunkId: 'hr_p1_c1',
    targetDocId: 'doc_hr2026',
  },
  {
    query: 'How many days per week are staff allowed to work remotely?',
    targetChunkId: 'hr_p3_c2',
    targetDocId: 'doc_hr2026',
  },
  {
    query: 'What was total revenue in 2024?',
    targetChunkId: 'fin2024_p1_c1',
    targetDocId: 'doc_fin2024',
  },
  {
    query: 'AES-256 backup encryption retention schedule',
    targetChunkId: 'sec_p2_c1',
    targetDocId: 'doc_sec2026',
  },
];

// Simple token similarity vector simulation (Jaccard + soft word embeddings overlap)
function simulateVectorSearch(query, corpus, topK = 6) {
  const qWords = new Set(query.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/));
  const results = corpus.map((chunk) => {
    const cWords = new Set(chunk.text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/));
    let intersection = 0;
    for (const w of qWords) {
      if (cWords.has(w)) intersection++;
    }
    const union = new Set([...qWords, ...cWords]).size;
    const jaccard = union > 0 ? intersection / union : 0;
    // Add semantic term proximity
    const score = Math.min(1.0, jaccard * 2.2);
    return {
      ...chunk,
      score: parseFloat(score.toFixed(4)),
      source: 'vector',
    };
  });

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK).map((r, i) => ({ ...r, vectorRank: i + 1 }));
}

function evaluatePipeline(pipelineName, retrievalFn) {
  let hitAt1 = 0;
  let hitAt3 = 0;
  let hitAt5 = 0;
  let reciprocalRankSum = 0;

  for (const item of EVALUATION_BENCHMARK) {
    const retrievedChunks = retrievalFn(item.query);
    const chunkIds = retrievedChunks.map((c) => c.chunk_id);

    const rankIndex = chunkIds.indexOf(item.targetChunkId);
    if (rankIndex !== -1) {
      const rank = rankIndex + 1;
      if (rank <= 1) hitAt1++;
      if (rank <= 3) hitAt3++;
      if (rank <= 5) hitAt5++;
      reciprocalRankSum += 1 / rank;
    }
  }

  const N = EVALUATION_BENCHMARK.length;
  return {
    pipelineName,
    hitAt1Rate: ((hitAt1 / N) * 100).toFixed(1) + '%',
    hitAt3Rate: ((hitAt3 / N) * 100).toFixed(1) + '%',
    hitAt5Rate: ((hitAt5 / N) * 100).toFixed(1) + '%',
    mrr: (reciprocalRankSum / N).toFixed(3),
  };
}

export function runEvaluation() {
  const bm25 = new BM25Index();
  bm25.build(EVALUATION_CORPUS);

  // 1. Pipeline A: Simple Vector Retrieval
  const pipelineA = (query) => {
    return simulateVectorSearch(query, EVALUATION_CORPUS, 5);
  };

  // 2. Pipeline B: Hybrid Retrieval (Vector + BM25)
  const pipelineB = (query) => {
    const vecResults = simulateVectorSearch(query, EVALUATION_CORPUS, 5);
    const kwResults = bm25.search(query, { topK: 5 });

    const map = new Map();
    const RRF_K = 60;

    vecResults.forEach((v) => {
      map.set(v.chunk_id, {
        ...v,
        vectorScore: v.score,
        keywordScore: 0,
        foundInVector: true,
        foundInKeyword: false,
        overlap: false,
        rrfScore: 1 / (RRF_K + v.vectorRank),
      });
    });

    kwResults.forEach((k) => {
      if (map.has(k.chunk_id)) {
        const item = map.get(k.chunk_id);
        item.keywordScore = k.score;
        item.foundInKeyword = true;
        item.overlap = true;
        item.rrfScore += 1 / (RRF_K + k.keywordRank);
      } else {
        map.set(k.chunk_id, {
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

    const merged = Array.from(map.values());
    merged.sort((a, b) => b.rrfScore - a.rrfScore);
    return merged.slice(0, 5);
  };

  // 3. Pipeline C: Hybrid Retrieval + Reranking
  const pipelineC = (query) => {
    const vecResults = simulateVectorSearch(query, EVALUATION_CORPUS, 6);
    const kwResults = bm25.search(query, { topK: 6 });

    const map = new Map();
    const RRF_K = 60;

    vecResults.forEach((v) => {
      map.set(v.chunk_id, {
        ...v,
        vectorScore: v.score,
        keywordScore: 0,
        foundInVector: true,
        foundInKeyword: false,
        overlap: false,
        rrfScore: 1 / (RRF_K + v.vectorRank),
      });
    });

    kwResults.forEach((k) => {
      if (map.has(k.chunk_id)) {
        const item = map.get(k.chunk_id);
        item.keywordScore = k.score;
        item.foundInKeyword = true;
        item.overlap = true;
        item.rrfScore += 1 / (RRF_K + k.keywordRank);
      } else {
        map.set(k.chunk_id, {
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

    const candidates = Array.from(map.values());
    return rerankCandidates(query, candidates, { topK: 5 });
  };

  const results = [
    evaluatePipeline('1. Simple Vector Search', pipelineA),
    evaluatePipeline('2. Hybrid Retrieval (Vector + BM25)', pipelineB),
    evaluatePipeline('3. Hybrid Retrieval + Reranking', pipelineC),
  ];

  console.log('\n========================================================================================');
  console.log('                          RETRIEVAL EVALUATION BENCHMARK REPORT                         ');
  console.log('========================================================================================');
  console.log(`Corpus Size:      ${EVALUATION_CORPUS.length} chunks across 4 multi-format PDF documents`);
  console.log(`Benchmark Size:   ${EVALUATION_BENCHMARK.length} diverse factual & comparative queries\n`);

  console.log(
    'Pipeline'.padEnd(38) +
      'Hit@1'.padEnd(12) +
      'Hit@3'.padEnd(12) +
      'Hit@5'.padEnd(12) +
      'MRR'.padEnd(10)
  );
  console.log('-'.repeat(88));

  for (const r of results) {
    console.log(
      r.pipelineName.padEnd(38) +
        r.hitAt1Rate.padEnd(12) +
        r.hitAt3Rate.padEnd(12) +
        r.hitAt5Rate.padEnd(12) +
        r.mrr.padEnd(10)
    );
  }
  console.log('========================================================================================\n');

  return results;
}

if (process.argv[1] && process.argv[1].endsWith('evaluate.js')) {
  runEvaluation();
}
