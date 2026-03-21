# 📄 PDF Chat & Vector Search AI

A backend-heavy AI system that allows users to upload PDF files, store their vector embeddings, and ask questions via a chat interface. The system retrieves relevant content from PDFs and uses an LLM to generate answers.

---

## 🚀 Features

* 📂 Upload PDF files and process them asynchronously
* 🧠 Generate embeddings using HuggingFace Transformers
* 📦 Store vectors in Qdrant vector database
* ⚡ Background processing using BullMQ
* 💾 Redis/Valkey for queue management
* 🤖 LLM-powered chat over PDF content
* 📊 Two-panel UI (Upload + Chat)

---

## 🏗️ Architecture

```text
Frontend (Next.js / React)
        ↓
Express Backend (API Layer)
        ↓
BullMQ Queue → Redis (Valkey)
        ↓
Worker (PDF processing)
        ↓
Qdrant Vector DB
        ↓
LLM (Groq / Qwen)
        ↓
Response to Frontend Chat
```

---

## 📌 Workflow

### 1. PDF Upload

1. User uploads PDF from UI
2. Backend pushes job to BullMQ queue
3. Worker processes PDF:

   * Loads PDF
   * Splits into chunks
   * Generates embeddings
   * Stores embeddings in Qdrant

---

### 2. Chat Query

1. User asks a question
2. Backend retrieves relevant chunks from Qdrant
3. LLM receives context + user query
4. LLM generates answer
5. Response sent to frontend

---

## 🧰 Tech Stack

* **Backend**: Node.js, Express
* **Queue**: BullMQ
* **Cache / Queue Backend**: Valkey (Redis-compatible)
* **Vector DB**: Qdrant
* **LLM**: Groq (Qwen model)
* **Embeddings**: HuggingFace Transformers (`all-MiniLM-L6-v2`)
* **File Upload**: Multer
* **Frontend**: Next.js

---

## ⚙️ Setup Instructions

### 1. Clone the repo

```bash
git clone https://github.com/nihaar6601/Rag-PDF.git
```

---

### 2. Install dependencies

```bash
cd server
pnpm install
```

---

### 3. Setup environment variables

Create `.env` file in `server/`:

```env
GROQ_API_KEY=your_api_key
```

---

### 4. Start services using Docker

```bash
docker compose up -d
```

This will start:

* Valkey (Redis-compatible server)
* Qdrant (vector database)

---

### 5. Start backend server

```bash
pnpm dev
```

---

### 6. Start worker (separate terminal)

```bash
pnpm run dev:worker.js
```

---

## 📡 API Endpoints

### POST `/upload/pdf`

Uploads a PDF file.

Form Data:

```
pdf: <file>
```

Response:

```json
{
  "message": "uploaded"
}
```

---

### GET `/chat?message=your_query`

Query the uploaded PDFs.

Response:

```json
{
  "message": "LLM generated answer"
}
```

---

## 🧠 Key Concepts Demonstrated

* Background job processing using BullMQ
* PDF parsing and chunking
* Embedding generation and vector storage
* Vector search using Qdrant
* LLM reasoning over retrieved context
* Async and scalable backend architecture

---

## 📊 Redis Key Structure

```text
bull:file-upload-queue:*   → BullMQ job data
```

---

## 🗃️ Qdrant Usage

* Stores vector embeddings of PDF chunks
* Used for similarity search during chat queries

---

## 🖼️ Frontend Layout

```
+--------------------+------------------------+
| File Upload Panel  | Chat Panel             |
|  - Upload PDF      |  - Ask questions       |
|  - Processing      |  - LLM Responses       |
+--------------------+------------------------+
```

---

## 🔮 Future Improvements

* Streaming responses from LLM
* WebSocket-based real-time updates
* Multi-PDF support
* Caching frequently asked queries
* UI enhancements

---

## 🙌 Learnings

This project demonstrates real-world backend patterns used in:

* AI-powered document systems
* vector search pipelines
* asynchronous job processing
* scalable backend architectures

---

## 📜 License

MIT License
