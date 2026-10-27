# 📄 PDF Chat & Hybrid RAG

A full-stack, backend-focused **multi-document Retrieval-Augmented Generation (RAG)** application. Upload PDFs, index their contents, and ask questions across one or several documents. The backend combines **semantic vector search and BM25 keyword retrieval**, reranks relevant passages, and uses an LLM to generate document-grounded answers with source references.

## 🚀 Features

- **Multi-PDF workspace:** Upload multiple PDFs, list and delete documents, and search across all or selected files.
- **Asynchronous ingestion:** BullMQ jobs backed by Valkey (Redis-compatible), with upload progress and status polling.
- **PDF parsing and chunking:** LangChain PDFLoader and RecursiveCharacterTextSplitter, with page and document metadata.
- **Local embeddings:** Hugging Face Transformers (`Xenova/all-MiniLM-L6-v2` by default).
- **Vector search:** Qdrant stores embedded PDF chunks and supports document-scoped semantic retrieval.
- **Hybrid retrieval:** Combine Qdrant similarity search with an in-memory BM25 keyword index.
- **Multi-document retrieval:** Per-document retrieval and diversity-aware reranking help support comparisons.
- **Custom reranking:** Weighted relevance scores using vector similarity, BM25, term coverage, phrase matching, and overlap.
- **Conversational query rewriting:** Uses recent chat history to clarify follow-up questions for retrieval.
- **Evidence-aware answers:** Heuristic retrieval-confidence labels, grounded prompting, and document/page source references.
- **Frontend workspace:** Next.js UI with drag-and-drop PDF uploads, processing status, document selection, Markdown chat responses, and expandable evidence.

## 🏗️ Architecture

The system has **two separate pipelines**: document ingestion and question answering.

```text
                         Next.js / React frontend
                                    |
                            Express REST API
                                    |
                 +------------------+------------------+
                 |                                     |
             PDF upload                           Chat request
                 |                                     |
          Multer saves file                   Query rewriting
                 |                                     |
          BullMQ + Valkey                  Hybrid retrieval
                 |                         /           \
           Worker / fallback           Qdrant         BM25
                 |                    vector search  keyword search
            PDF extraction                  \           /
                 |                         Merge + deduplicate
           Text chunking                            |
                 |                           Custom reranking
          +------+-------+                          |
          |              |                    Confidence scoring
     JSON chunk store  Hugging Face                     |
          |           embeddings                 Grounded prompt
     BM25 index           |                             |
                       Qdrant                      Groq LLM
                                                       |
                                                Answer + sources
                                                       |
                                                    Frontend
```

**Note:** The API currently imports `worker.js`, so starting the backend also starts a BullMQ worker **in the same process**. A separate worker script is available, but is not required for the default local setup. If queue insertion fails, the upload endpoint falls back to processing the PDF in-process.

## 🔄 How It Works

### 1. PDF ingestion

1. The frontend submits a PDF to `POST /upload/pdf` as multipart form data (field name: `pdf`).
2. Multer checks the upload and saves the file locally (default maximum: **10 MB per PDF**).
3. The backend creates document metadata and enqueues a BullMQ job.
4. The worker calls `processPdfDocument()`:
   - Extracts text using LangChain's `PDFLoader`.
   - Splits text into overlapping chunks (defaults: **1,000 characters**, **200-character overlap**).
   - Attaches document ID, filename, page number, and chunk ID.
   - Saves chunks in local JSON storage and rebuilds the BM25 index.
   - Generates embeddings and indexes chunks in Qdrant.
5. Processing status moves through extraction, chunking, embedding/indexing, and ready/failed stages. The frontend polls for progress.

### 2. Chat and retrieval

1. The frontend submits a question, optional selected document IDs, and recent chat history to `POST /chat`.
2. The query-rewriting service optionally resolves ambiguous conversational follow-ups.
3. **Hybrid search** retrieves both semantic matches from Qdrant and keyword matches from BM25.
4. Results are merged by chunk ID. When multiple documents are selected, retrieval also searches each selected document to improve coverage.
5. A **rule-based reranker** scores candidate passages and selects the top chunks (four by default).
6. The confidence service assigns a **low / medium / high retrieval-evidence heuristic**, with separate handling for summary-style questions.
7. The Groq-hosted model receives the question, recent conversation, and retrieved passages in a document-grounded prompt.
8. The API returns the answer, source passages, confidence details, and retrieval statistics.

**Important:** Confidence is a heuristic about retrieval evidence, **not** a verified probability that the generated answer is correct. The reranker uses manually weighted features rather than a trained cross-encoder. Reciprocal Rank Fusion (RRF) scores are computed during retrieval merging, but the final reranker uses its own weighted score.

## 🧰 Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS, Clerk integration |
| API | Node.js, Express |
| Uploads | Multer |
| Background jobs | BullMQ |
| Queue backend | Valkey (Redis-compatible) |
| PDF loading and splitting | LangChain |
| Embeddings | Hugging Face Transformers, `Xenova/all-MiniLM-L6-v2` |
| Semantic vector store | Qdrant |
| Keyword retrieval | Custom BM25 implementation |
| Answer generation | Groq SDK; configurable model (default `openai/gpt-oss-20b`) |
| Document metadata and chunks | Local JSON files |
| Testing | Node.js built-in test runner |

## 📂 Backend Layout

```text
server/
├── index.js                          # Express API, upload handling, RAG orchestration
├── worker.js                         # BullMQ job consumer
├── src/
│   ├── config.js                     # Environment configuration and defaults
│   └── services/
│       ├── documentService.js        # PDF extraction, chunking, indexing, deletion
│       ├── documentStore.js          # Local JSON document/chunk persistence
│       ├── embeddingService.js       # Hugging Face embedding model
│       ├── vectorStoreService.js     # Qdrant indexing/search/deletion
│       ├── bm25Service.js            # Keyword index and BM25 search
│       ├── hybridRetrievalService.js # Merge vector and BM25 retrieval
│       ├── rerankingService.js       # Candidate relevance scoring
│       ├── confidenceService.js      # Retrieval-evidence heuristics
│       ├── queryRewriteService.js    # Conversational query rewriting
│       ├── llmService.js             # Grounded prompts and Groq completions
│       └── logger.js                 # Console logs and retrieval traces
├── data/
│   ├── documents.json                # Document metadata
│   └── chunks.json                   # Extracted chunks
├── scripts/evaluate.js               # Synthetic retrieval benchmark
└── test/rag.test.js                  # Automated component tests
```

## ⚙️ Run Locally

**Prerequisites:** Node.js, pnpm, Docker with Docker Compose, and a Groq API key for generated LLM answers.

### 1. Clone

```bash
git clone https://github.com/nihaar6601/Rag-PDF.git
cd Rag-PDF
```

### 2. Start Valkey and Qdrant

Run this **from the repository root**, where `docker-compose.yml` lives:

```bash
docker compose up -d
```

The compose file exposes:
- **Valkey:** `localhost:6379`
- **Qdrant:** `http://localhost:6333`

### 3. Configure and start the backend

```bash
cd server
pnpm install
```

Create `server/.env`:

```env
GROQ_API_KEY=your_groq_api_key
# Optional overrides:
# PORT=8000
# REDIS_HOST=localhost
# REDIS_PORT=6379
# QDRANT_URL=http://localhost:6333
# QDRANT_COLLECTION=langchainjs-testing
# GROQ_MODEL=openai/gpt-oss-20b
# CHUNK_SIZE=1000
# CHUNK_OVERLAP=200
# VECTOR_TOP_K=6
# KEYWORD_TOP_K=6
# RERANKER_TOP_K=4
```

Start the backend:

```bash
pnpm dev
```

The API defaults to **http://localhost:8000**. The worker is initialized automatically by `index.js`. The separate `pnpm dev:worker` command is optional and starts an additional job consumer.

Without `GROQ_API_KEY`, the backend can return retrieved excerpts in offline mode instead of a generated LLM answer.

### 4. Start the frontend

Open a second terminal from the repository root:

```bash
cd client
pnpm install
```

For a non-default backend address, create `client/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Then run:

```bash
pnpm dev
```

Open **http://localhost:3000**. The frontend includes Clerk integration; depending on your auth setup, Clerk environment configuration may also be needed.

## 📡 API Reference

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/upload/pdf` | Upload PDF (`multipart/form-data`, field `pdf`) |
| `GET` | `/documents` | List document metadata and statuses |
| `GET` | `/documents/:id` | Get one document |
| `DELETE` | `/documents/:id` | Delete a document and associated data |
| `GET` | `/jobs/:id` | Get queue/document processing status |
| `POST` | `/chat` | Ask a question with optional document filters and history |
| `GET` | `/chat?message=...` | Ask a question with query parameters |
| `GET` | `/` | Service status and retrieval configuration |

### Upload example

```bash
curl -X POST http://localhost:8000/upload/pdf \
  -F "pdf=@example.pdf"
```

Example response (IDs and size vary):

```json
{
  "jobId": "1",
  "documentId": "doc_123_example",
  "filename": "example.pdf",
  "size": 12345,
  "maxFileSizeBytes": 10485760
}
```

The upload response confirms acceptance, **not** that indexing has finished. Poll `GET /jobs/:id` or check `GET /documents/:id`.

### Chat example

```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Compare the key findings in these documents",
    "documentIds": ["doc_123", "doc_456"],
    "history": []
  }'
```

Response structure (illustrative):

```json
{
  "message": "Grounded answer...",
  "answer": "Grounded answer...",
  "confidence": "medium",
  "confidenceScore": 0.62,
  "confidenceReasons": [],
  "sources": [
    {
      "documentId": "doc_123",
      "documentName": "example.pdf",
      "pageNumber": 2,
      "chunkId": "doc_123_chunk_0",
      "text": "Relevant excerpt...",
      "score": 0.81
    }
  ],
  "retrieval": {
    "queryUsed": "Compare the key findings in these documents",
    "vectorHits": 6,
    "keywordHits": 6,
    "mergedCandidates": 9,
    "topChunksRetrieved": 4
  }
}
```

Omit `documentIds` or supply `null` to search across all indexed documents.

## 🧪 Tests and Evaluation

From `server/`:

```bash
pnpm test
pnpm evaluate
```

The test suite checks individual retrieval and answer-generation components. The evaluation script uses a **synthetic benchmark** with simulated vector similarity, Hit@K, and Mean Reciprocal Rank (MRR). It is not a full live-Qdrant end-to-end performance benchmark.

## ⚠️ Current Limitations

- Metadata and extracted chunks are stored in local JSON files; multi-instance persistence and consistency require further work.
- The default backend starts a BullMQ worker in-process, rather than providing independently deployed worker infrastructure.
- Retrieval-confidence scoring is heuristic, and the LLM's statements are not independently fact-checked.
- Long-document summaries are constrained by the number of retrieved passages.
- Authentication, access isolation, and production hardening should be reviewed before supporting multiple untrusted users.

## 🔮 Potential Improvements

- Stream LLM responses to the frontend.
- Use WebSockets or server-sent events for progress updates instead of polling.
- Move document metadata to a transactional database and add user-level isolation.
- Deploy and scale workers separately from the API.
- Add cross-encoder reranking and larger-context summarization strategies.
- Add live retrieval benchmarks, answer-quality evaluation, and better observability.
- Cache suitable retrieval results and improve retry/idempotency handling.

## 📜 License

The server package currently declares `ISC` in its `package.json`. Add a repository-level `LICENSE` file if you want to publish an explicit project-wide license.
