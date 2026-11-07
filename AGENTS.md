# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project

Boardwise is a platform for people experiencing workplace harassment. It has three user roles:

- **Victim**: talks to an AI assistant, uploads documents, builds an incident timeline, tracks next steps.
- **HR board**: receives anonymous reports, sees aggregate stats and red flags.
- **Law firm**: has a profile with expertise and case stats; victims can choose to contact them.

The data is highly sensitive. Treat privacy as a hard requirement, not a feature.

## Stack

- **Backend**: Django 6 + Django REST Framework, Channels (WebSocket streaming), Celery + Redis (background jobs), PostgreSQL.
- **Frontend**: React + Vite + TypeScript, TanStack Query, React Router, i18next.
- **AI**: OpenRouter through the `openai` SDK. All LLM calls go through `backend/apps/chat/llm.py`.
- **Local services**: `docker-compose.yml` runs Postgres 17 with pgvector (`pgvector/pgvector:pg17-trixie`) and Redis 7.

## Layout

```
backend/
  config/            settings.py, urls.py, celery.py
  apps/
    accounts/        custom User model (role, preferred_language)
    cases/           cases, timeline entries, CaseShare (access grants)
    documents/       uploads and extracted text
    chat/            conversations, messages, llm.py, prompts.py, crisis.py
  prompts/           system.md + provinces/<CODE>.md (LLM prompt text)
    tasks/           checklist items
    lawfirms/        firm profiles, matchmaking
    hr/              anonymous reports, dashboard aggregates
    knowledge/       province law references for RAG: chunks, embeddings, cross-reference graph
frontend/            React app; /api is proxied to Django on :8000
```

## Commands

```bash
docker compose up -d                                   # Postgres + Redis (Docker Desktop must be running)

cd backend
.venv/bin/python manage.py runserver                   # API on :8000
.venv/bin/python manage.py makemigrations && .venv/bin/python manage.py migrate
.venv/bin/python manage.py test                        # backend tests
.venv/bin/python manage.py check
.venv/bin/celery -A config worker -l info              # background worker

cd frontend
npm run dev                                            # :5173
npm run build                                          # type-check + build
npm run lint
```

Configuration comes from the root `.env` (copy `.env.example`). Never commit `.env`.

## Current state (what exists today)

### Running locally
```bash
docker compose up -d db redis                          # from repo root
cd backend
.venv/bin/pip install -r requirements.txt
.venv/bin/python manage.py migrate
.venv/bin/python manage.py ingest_laws                 # load prompts/provinces/ into the knowledge base
.venv/bin/python manage.py seed_demo                   # add --reset to rebuild; refuses unless DEBUG=True
.venv/bin/python manage.py runserver
```
Demo logins (password `demo1234`): `victim`, `hr`, `lawfirm`. The seeded case belongs to `victim`, has timeline entries, tasks and a conversation, and is shared with `lawfirm`.

Swagger UI: `/api/docs/` · OpenAPI schema: `/api/schema/` (lock these down before deploying).

### Auth
- DRF token auth (header `Authorization: Token <key>`) plus session auth.
- `POST /api/auth/login/` → `{token, user}`. The `user` object includes `role`, which the frontend uses to route.
- `POST /api/auth/logout/` deletes the token.
- `GET/PATCH /api/auth/me/` (PATCH can change only `preferred_language`).

### Models
- `cases`:
  - `Case` (owner, title, status). `Case.objects.accessible_by(user)` and `case.can_access(user)` are the single source of truth for access. `__str__` returns only the ID.
  - `CaseShare` (case, grantee, granted_at, revoked_at). Only one active share per case and grantee. `revoke()` sets `revoked_at`; records are never deleted.
  - `TimelineEntry` (occurred_at, title, description, source manual/ai/document, optional document).
- `documents.Document`:
  - Fields: file, original_name, content_type, extracted_text, status pending/processing/done/failed.
  - Files are stored in `PRIVATE_MEDIA_ROOT` (`backend/private_media/`, gitignored). Encryption is still a TODO.
- `chat`: `Conversation(case)` and `Message(role, content, flagged_crisis)`.
- `tasks.Task` (title, notes, due_date, done, created_by_ai).
- `knowledge` (public law text, no user data):
  - `LawSource` (province, slug, title, source_url, content_hash).
  - `LawChunk` (one section; section_ref, heading breadcrumb, text, `embedding` pgvector, `search_vector`).
  - `LawReference` (graph edge between chunks, e.g. "subject to section 23").
- `lawfirms` and `hr` have no models yet.

### Endpoints
All endpoints require authentication.
- `/api/cases/`:
  - List shows only cases the user can access. Only victims can create.
  - Responses include `is_owner` so the UI can hide edit controls.
- Endpoints under `/api/cases/<case_pk>/`:
  - `timeline/`, `tasks/`: full CRUD.
  - `documents/`:
    - Multipart upload (20 MB limit).
    - `download/` action, which checks permission first.
    - The detail response includes `extracted_text`.
  - `conversations/`: has a `messages/` action (GET history, POST to send; see Chat below).
  - `shares/`:
    - Owner only.
    - Grant by `grantee` username; the grantee must be an HR or law-firm user.
    - DELETE revokes the share and keeps the record.
- Access behaviour, enforced in `apps/cases/permissions.py` (`CaseScopedMixin`):
  - Strangers get **404**, not 403.
  - Grantees are read-only: a write gets 403.

### Chat
- `GET/POST /api/cases/<case_pk>/conversations/<id>/messages/`. POST `{content, province?}` is owner-only and synchronous:
  - Crisis check first (`apps/chat/crisis.py`). If flagged, it saves both messages with `flagged_crisis=True`, replies with crisis resources and **skips the model**.
  - Otherwise it builds the prompt (`apps/chat/prompts.py`): `system.md` + the law reference, then calls `llm.chat()` and saves both messages. A model failure returns 502 and keeps the user message.
  - Retrieval may call the embedding model, so it **must stay after** the crisis check.

### Law reference RAG (`apps/knowledge`)
- Source docs: `backend/prompts/provinces/<CODE>.md` and `<CODE>/*.md` (Markdown). Only `AB.md` exists so far.
- `manage.py ingest_laws [--province AB] [--no-embed] [--async-embed]`. It is idempotent (skips unchanged content via `content_hash`).
  - Splits by headings, one chunk per section (`chunker.py`); long sections split on paragraphs.
  - Parses cross-references with regex into `LawReference` edges (`references.py`). No LLM is used to build the graph.
  - Embeds via `llm.embed()` (same `data_collection` policy). If embedding fails, chunks are still saved.
- Retrieval (`retrieval.py`):
  - Hybrid search filtered by province: Postgres full-text + pgvector cosine, merged with reciprocal rank fusion. Returns the top `RAG_TOP_K`.
  - Then expands one hop along reference edges.
  - Falls back to full-text only when there are no embeddings or embedding fails.
- If a province has no ingested chunks, the whole `<CODE>.md` file is used instead.
- `llm.py` sends `provider.data_collection = settings.OPENROUTER_DATA_COLLECTION` (default `deny`). `.env.example` sets `allow` **for dev only** so the free model works. **Switch back to `deny` before real user data.**
- Chat env vars: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_DATA_COLLECTION` (`deny`|`allow`), `OPENROUTER_MAX_RETRIES` (default 4; the SDK retries 429/5xx), `CHAT_DEFAULT_PROVINCE` (default `AB`), `CHAT_HISTORY_LIMIT` (default 40; crisis-flagged messages are never sent to the model), `EMBEDDING_MODEL` (default `openai/text-embedding-3-small`; empty = full-text only), `RAG_TOP_K` (6), `RAG_SEARCH_CONFIG` (`english`).

### Tests
`apps/accounts/tests.py`, `apps/cases/tests.py`, `apps/cases/test_api.py` (access and share rules), `apps/chat/tests.py` (crisis check, prompt building, `data_collection`, send-endpoint permissions), `apps/knowledge/tests.py` (chunking, references, retrieval, fallback). 52 tests in total. Chat tests mock `llm.chat`; tests must never call the real model.

### Not built yet
- WebSocket streaming for chat (the send endpoint is synchronous for now). Proposed message format:
  - `client → {type:"message", content}`
  - `server → crisis | token(delta) | done(message_id) | error`
- Celery tasks for document extraction and timeline generation (`TODO(llm)` in `documents/views.py`).
- Law firm profiles and directory (`/api/lawfirms/`).
- HR: anonymous reports and a dashboard that applies a minimum group size.
- Encrypted file storage.
- RAG follow-ups: PDF/HTML ingestion for full statutes, a per-province eval set (question → expected section), an HNSW index once the corpus grows, and a French search config for QC.

## Rules

### Privacy and access
- The victim owns every case. HR boards and law firms may access a case **only** through a `CaseShare` grant from the victim. Every view, serializer, consumer and Celery task that touches case data must enforce this.
- Never expose another user's identity in HR features. Aggregates must respect a minimum group size before being shown.
- Don't log message content, document text or personal data. Log IDs instead.
- Uploaded files go to encrypted storage; never serve them from a public URL.

### AI
- Call LLMs only through `apps/chat/llm.py`. Do not call OpenRouter or model providers from anywhere else, and never from the frontend.
- Keep `provider.data_collection = "deny"` on every request outside local dev (controlled by `OPENROUTER_DATA_COLLECTION`).
- The assistant must be clearly identified as AI to users. It must not present itself as a human, and must not give legal advice; it organizes information and points people to professionals.
- If a message suggests someone is in danger, show crisis resources before any model call.
- Slow AI work (document extraction, timeline generation) runs in Celery, not in the request.

### Code
- New Django apps live under `backend/apps/` and use `name = "apps.<app>"` in `apps.py`.
- Use the custom user model via `settings.AUTH_USER_MODEL` or `get_user_model()`, never `django.contrib.auth.models.User`.
- API endpoints use DRF and require authentication by default.
- Read settings from environment variables; don't hard-code secrets or URLs.
- Frontend text goes through i18next (`t("...")`) so it can be translated.
- Add tests for permission logic, especially anything involving `CaseShare`.
- Add new Python dependencies to `backend/requirements.txt`.

### Git
- Work on feature branches (`feat/...`, `fix/...`), not `main`.
- Commit migrations together with the model changes that produced them.
