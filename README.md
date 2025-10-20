# OneBox — Email ingestion, search, AI categorization, and RAG reply suggestions

This repository implements a backend-first prototype for realtime email ingestion using IMAP IDLE, full-text search with Elasticsearch, LLM-based categorization (Gemini-style API), vector search (Qdrant) for RAG, Slack/webhook integrations, and a minimal frontend demo.

Contents
- `src/` — TypeScript source
  - `src/imap/imapClient.ts` — IMAP IDLE client and initial sync
  - `src/index.ts` — IMAP startup & indexing pipeline
  - `src/indexers/elasticsearch.ts` — Elasticsearch client + index helpers
  - `src/ai/classifier.ts` — LLM-based category classifier (with backoff)
  - `src/ai/embeddings.ts` — embedding calls
  - `src/ai/qdrantClient.ts` — Qdrant REST helper
  - `src/ai/ingestProductData.ts` — ingest helper for product/context data
  - `src/ai/rag.ts` — RAG retrieval helper
  - `src/ai/generator.ts` — LLM text generation wrapper
  - `src/integrations/webhooks.ts` — Slack & generic webhook triggers
  - `src/server.ts` — Express API endpoints and static UI serve
  - `src/models/emailDocument.ts` — EmailDocument interface
- `public/index.html` — minimal single-file UI demo
- `docker-compose.yml` — Elasticsearch + Qdrant services (for local dev)
- `.env.example` — example environment variables

---

## Quickstart (local dev)
Prereqs
- Node.js (v18+ recommended)
- Docker Desktop (to run Elasticsearch and Qdrant locally)

1) Copy the example env and fill in credentials

```powershell
cd C:\path\to\reachinbox-onebox
copy .env.example .env
notepad .env
```

Fill required variables in `.env`: IMAP_HOST, IMAP_USER_1, IMAP_PASS_1, IMAP_USER_2, IMAP_PASS_2. Optionally set `ELASTICSEARCH_URL`, `QDRANT_URL`, `GEMINI_API_KEY`, `SLACK_WEBHOOK_URL`, `WEBHOOK_SITE_URL`.

2) Start local services (optional — required for ES/Qdrant-backed features)

```powershell
# from project root
docker compose up -d
# wait for services to become healthy (watch logs)
```

3) Install dependencies and run the server

```powershell
npm install
# Start server (API + static UI)
npm run start:server
# Start IMAP ingestion (in another terminal)
npm run start:imap
```

4) Open the demo UI

Open http://localhost:3000/ and use the search UI. The IMAP client will index new emails and the UI will show results including `aiCategory` tags.

---

## Environment variables (important)
- IMAP_HOST, IMAP_PORT, IMAP_TLS — IMAP server connection settings.
- IMAP_USER_1, IMAP_PASS_1, IMAP_USER_2, IMAP_PASS_2 — two test accounts to demo realtime ingest.
- IMAP_FOLDERS — comma-separated list of folders to sync (default: INBOX).
- ELASTICSEARCH_URL — e.g. `http://localhost:9200` (optional).
- ELASTICSEARCH_INDEX — index name (default `emails`).
- QDRANT_URL — e.g. `http://localhost:6333` (optional).
- QDRANT_COLLECTION — default `product_data`.
- GEMINI_API_KEY or GENERATIVE_AUTH_BEARER — credentials for the LLM/embedding API.
- GEMINI_MODEL / GEMINI_EMBEDDING_MODEL — model names.
- SLACK_WEBHOOK_URL — Slack incoming webhook for Interested notifications.
- WEBHOOK_SITE_URL — generic webhook endpoint (e.g., webhook.site URL).

---

## Architecture Overview

- IMAP ingestion:
  - `src/imap/imapClient.ts` uses `node-imap` to establish persistent IMAP connections and uses `IDLE` for real-time notifications. On initial connect it performs a 30-day initial sync (headers/bodystructure only) and then switches to IDLE.
  - A watchdog periodically re-issues keepalive/IDLE to avoid server-side timeouts.

- Indexing & Search:
  - Emails are parsed (headers + plaintext extracted) and mapped to the `EmailDocument` interface (`src/models/emailDocument.ts`).
  - `src/indexers/elasticsearch.ts` ensures the `emails` index exists and indexes documents with appropriate mappings: `subject` and `body` as `text`, `accountId` and `folder` as `keyword`.
  - Search API `/api/emails/search` (in `src/server.ts`) performs full-text search across `subject` and `body` with filters on `accountId`/`folder`.

- AI Categorization & RAG:
  - Classification: `src/ai/classifier.ts` calls the Gemini-like API using a tight system instruction and robust parsing/backoff to return one of the five labels. The result updates the ES document's `aiCategory`.
  - Embeddings & Vector DB: `src/ai/embeddings.ts` and `src/ai/qdrantClient.ts` support creating embeddings and storing/retrieving product/context data in Qdrant.
  - RAG: `POST /api/emails/:id/suggest-reply` retrieves nearest product/context chunks, assembles a prompt with system instruction, retrieved context, and the original email, then calls the generator (`src/ai/generator.ts`) to produce a suggested reply.

- Integrations & UI:
  - Slack/generic webhook triggers for emails classified as `Interested` (`src/integrations/webhooks.ts`).
  - Simple static UI at `/` (`public/index.html`) demonstrates search and AI tags. A suggest-reply API endpoint is implemented for UI integration.

---

## Feature Implementation Breakdown & Evaluation Mapping

The following maps the project files to evaluation criteria in your assignment:

- Real-Time Performance (mandatory: IMAP IDLE):
  - Implemented in `src/imap/imapClient.ts`. Uses `node-imap` and `IDLE`, plus a watchdog to reissue keepalives.

- Code Quality and Error Handling:
  - TypeScript throughout. Key files: `src/index.ts`, `src/server.ts`, `src/imap/imapClient.ts`. Error paths log errors and attempt reconnects. Consider adding `pino` or `winston` for structured logging (see notes below).

- Search Functionality:
  - Index mapping (keywords vs text) in `src/indexers/elasticsearch.ts`.
  - Search endpoint with `multi_match` + bool `filter` is in `src/server.ts`.

- AI Accuracy (Categorization):
  - `src/ai/classifier.ts` uses a tight system prompt and JSON parsing with validation. You should provide your Gemini schema/responseMimeType when integrating with the real API for increased reliability.

- RAG Implementation (bonus):
  - `src/ai/ingestProductData.ts`, `src/ai/qdrantClient.ts`, `src/ai/rag.ts` implement embedding ingestion and retrieval. `POST /api/emails/:id/suggest-reply` assembles prompt + contexts and generates a reply.

---

## Running & Testing tips
- To test IMAP flow without real accounts, use a test IMAP service or a local fake IMAP server. Keep in mind IMAP providers may enforce throttling or 2FA.
- To test webhooks use `https://webhook.site`.
- To validate AI flows without a real API key, stub `src/ai/*` calls or set `GENERATIVE_AUTH_BEARER` and `GEMINI_API_KEY` appropriately.

## Logging recommendation
- Add a structured logger (pino or winston). Example: replace console.log with pino and capture traces for reconnects, LLM errors, and ES failures.







