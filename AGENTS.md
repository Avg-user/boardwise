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
- **Local services**: `docker-compose.yml` runs Postgres 17 with pgvector (`pgvector/pgvector:pg17-trixie`), Redis 7, and `speech` (voice dictation with faster-whisper, built from `speech/`).

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
    hr/              companies, anonymous incident reports, dashboard aggregates, job offer review
    knowledge/       province law references for RAG: chunks, embeddings, cross-reference graph
    speech/          dictation tickets for the speech service (no models)
speech/              speech service (docker): WebSocket dictation with faster-whisper; streaming.py, server.py, tickets.py
frontend/            React app; /api is proxied to Django on :8000, /speech to the speech service on :9100
```

## Commands

```bash
docker compose up -d                                   # Postgres + Redis + speech (Docker Desktop must be running)
docker compose up -d --build speech                    # after changing speech/
docker compose run --rm --no-deps speech python -m unittest tests   # speech service tests

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
Demo logins (password `demo1234`): `victim`, `hr`, `lawfirm`, plus firms `prairielaw`, `justiceco` (verified) and `newfirm` (unverified, so not listed). The seeded case belongs to `victim`, has timeline entries, tasks and a conversation, and is shared with `lawfirm` through an accepted match request. `hr` manages the verified company "Northwind Logistics" (sample reports and one reviewed job offer); `victim` works there with reporting turned on.

Swagger UI: `/api/docs/` · OpenAPI schema: `/api/schema/` (lock these down before deploying).

### Auth
- DRF token auth (header `Authorization: Token <key>`) plus session auth.
- `POST /api/auth/register/` `{username, password, role, preferred_language}` → `{token, user}` (same as login). Uses Django's password validators.
- `POST /api/auth/login/` → `{token, user}`. The `user` object includes `role`, which the frontend uses to route.
- `POST /api/auth/logout/` deletes the token.
- `GET/PATCH /api/auth/me/` (PATCH can change only `preferred_language`).

### Models
- `cases`:
  - `Case` (owner, title, status). `Case.objects.accessible_by(user)` and `case.can_access(user)` are the single source of truth for access. `__str__` returns only the ID.
  - `CaseShare` (case, grantee, granted_at, revoked_at). Only one active share per case and grantee. `revoke()` sets `revoked_at`; records are never deleted.
  - `TimelineEntry` (occurred_at, title, description, source manual/ai/document, optional document, optional `conversation`). `conversation` is one-to-one and read-only in the API: the server sets it (see Chat).
- `documents.Document`:
  - Fields: file, original_name, content_type, extracted_text, status pending/processing/done/failed.
  - Files are stored in `PRIVATE_MEDIA_ROOT` (`backend/private_media/`, gitignored). Encryption is still a TODO.
- `chat`: `Conversation(case, closed_at)` and `Message(role, content, flagged_crisis)`. The API returns `closed_at` and `timeline_entry` (its entry's id or null) on each conversation.
- `tasks.Task` (title, notes, due_date, done, created_by_ai).
- `knowledge` (public law text, no user data):
  - `LawSource` (province, slug, title, source_url, content_hash).
  - `LawChunk` (one section; section_ref, heading breadcrumb, text, `embedding` pgvector, `search_vector`).
  - `LawReference` (graph edge between chunks, e.g. "subject to section 23").
- `lawfirms`:
  - `LawFirmProfile` (one per law-firm user): about, practice areas, languages, provinces, fees (free consultation, hourly range, flat fee, contingency, sliding scale, legal aid), public contact, `law_society_number`, `is_verified`, `accepting_clients`. `LawFirmProfile.objects.listed()` = verified + accepting + has name and description.
  - `MatchRequest` (case, firm, worker's note, status pending/accepted/declined/withdrawn/ended, linked `CaseShare`).
- `hr`:
  - `Company` (name, province, city, `is_verified`). `Company.objects.listed()` = verified.
  - `HRMembership` (HR user → company; HR creates one with `PUT /api/hr/company/`, staff add more in the admin).
  - `WorkerMembership` (worker → company, `reporting_opt_in`, plus a per-month report counter for rate limiting).
  - `IncidentReport` (company, category, `occurred_month`, ongoing). **No user, no timestamp, UUID key**: reports can't be traced to anyone, even with database access. Don't add fields that could link them (user, created_at, IP, sequential IDs).
  - `JobOffer` (company, file in private storage or pasted text, province, status, summary, findings JSON).

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

### Law firm marketplace
- Firms sign up, then fill in `/api/lawfirms/me/` (GET, PUT creates, PATCH). Staff verify them in the Django admin (action "Mark as verified"). A firm can't verify itself, and changing `law_society_number` removes verification.
- Workers browse `GET /api/lawfirms/` (listed firms only; filters `area`, `language`, `free_consultation`, `q`). The public serializer never includes the law society number.
- A worker asks to connect: `POST /api/cases/<case_pk>/matches/ {firm, message}` (case owner only; listed firms only; one open request per case and firm). `DELETE` withdraws a pending request or ends an accepted one, which revokes the share.
- The firm sees `GET /api/lawfirms/me/requests/`: only the note and status. `case_id`/`case_title` appear only while an accepted share is active. `POST .../requests/<id>/accept/` creates the `CaseShare` (verified firms only); `decline/` doesn't.
- **A firm must never see case data before accepting.** Revoking a share through `shares/` also ends its match. Only the owner can list a case's matches, so firms never see which other firms were asked.

### Chat
- Chat sessions live on the server, so every device and API client sees the same thing (this used to be in each browser's localStorage, which made a second browser create duplicate entries):
  - Each chat is one timeline entry. The send endpoint creates it, in the same transaction, with the chat's first saved message (or the next one if the entry was deleted), using the optional `entry_title` and `entry_date` (the person's local date, within a day of the server's). Nothing is created when the model fails (502).
  - Only one chat per case is open: creating a conversation closes the others. `POST .../conversations/<id>/close/` (owner only, idempotent) closes one. A message to a closed chat gets **409** and nothing is saved; if the message looks like a crisis the 409 still carries `crisis_resources`.
  - Migration `cases/0004_link_chat_entries` linked existing chats to their generated entries, deleted the extra copies (generated title, no description only) and left the newest chat per case open.
- `GET/POST /api/cases/<case_pk>/conversations/<id>/messages/`. POST `{content, province?, language?, entry_title?, entry_date?}` is owner-only and synchronous. It returns `{user_message, reply}`:
  - Crisis check first (`apps/chat/crisis.py`, English and French). If flagged, it saves only the user message with `flagged_crisis=True` and returns `reply: null` plus a plain-text `crisis_resources`. It **skips the model**, and flagged messages are never sent to a model later. The frontend shows its own translated `CrisisBanner`.
  - Otherwise it builds the prompt (`apps/chat/prompts.py`): `system.md` + the law reference, then calls `llm.chat()` with `Write your reply in <language>` and saves both messages. A model failure or empty reply returns 502 and saves **nothing**, so the frontend can safely resend.
  - Retrieval may call the embedding model, so it **must stay after** the crisis check.
  - **Scope is strict**: the assistant only helps with workplace issues (rights, harassment, safety, documenting incidents, next steps, related support). Three layers, in `apps/chat/scope.py` and `prompts/system.md`:
    1. **Before the model**, `is_off_topic_request` refuses obvious requests for code or plain arithmetic with no model call. Messages that mention work (boss, pay, harassment and similar) always go through.
    2. **In the prompt**, the model is told to reply `[OFF_TOPIC]` for anything else off-topic.
    3. **After the model**, `is_off_topic` refuses replies with the marker, with code, or offering to write code. A capitalised "Code" (a law's name) and "code of …" never match.
    All three use the same fixed English/French refusal. The small model ignores layer 2 often, so don't remove 1 or 3.
    Workplace-law questions outside the reference (other provinces, OHS rules) are on-topic. If the model still answers `[OFF_TOPIC]` to a message `is_workplace_related` recognises, the view asks the model once more before refusing.
  - Replies are Markdown; the frontend renders them with `react-markdown` + `remark-gfm` (`components/case/Markdown.tsx`, no raw HTML).

### Law reference RAG (`apps/knowledge`)
- Source docs: `backend/prompts/provinces/<CODE>.md` (summary) and `<CODE>/*.md` / `<CODE>/*.pdf`. AB has the summary plus the King's Printer consolidations of the Employment Standards Code and the OHS Code (`AB/*.pdf`).
  - PDFs are converted by `pdf.py` (pypdf): it drops the table of contents, page headers and amendment-history lines, and emits `## Part` / `### Division` / `#### <section> <heading>` / `## Schedule N` Markdown. It only understands King's Printer consolidations and skips other PDFs with a warning.
- `manage.py ingest_laws [--province AB] [--no-embed] [--async-embed]`. It is idempotent (skips unchanged content via `content_hash`). Bump `INGEST_VERSION` in `ingest.py` when chunking or graph building changes, so everything is re-ingested.
  - Splits by headings, one chunk per section (`chunker.py`); long sections split on paragraphs, and very long paragraphs (lists, tables) on lines.
  - Parses cross-references ("section 23", "Schedule 3") with regex into `LawReference` edges (`references.py`), within the same document only. Schedules also link back to the sections in their "[See sections …]" note. No LLM is used to build the graph.
  - Embeds via `llm.embed()` (same `data_collection` policy). If embedding fails, chunks are still saved.
- Retrieval (`retrieval.py`):
  - Hybrid search filtered by province: Postgres full-text + pgvector cosine, merged with reciprocal rank fusion. Returns the top `RAG_TOP_K`.
  - Full-text weights each query term by its rarity in the province (IDF), so "noise" beats "health"/"safety" in an OHS question.
  - Then expands one hop along reference edges.
  - Falls back to full-text only when there are no embeddings or embedding fails.
- If a province has no ingested chunks, the whole `<CODE>.md` file is used instead.
- `llm.py` sends `provider.data_collection = settings.OPENROUTER_DATA_COLLECTION` (default `deny`). `.env.example` sets `allow` **for dev only** so the free model works. **Switch back to `deny` before real user data.**
- Chat env vars: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_DATA_COLLECTION` (`deny`|`allow`), `OPENROUTER_MAX_RETRIES` (default 4; the SDK retries 429/5xx), `CHAT_DEFAULT_PROVINCE` (default `AB`), `CHAT_HISTORY_LIMIT` (default 40; crisis-flagged messages are never sent to the model), `EMBEDDING_MODEL` (default `openai/text-embedding-3-small`; empty = full-text only), `RAG_TOP_K` (6), `RAG_SEARCH_CONFIG` (`english`).

### HR (`apps/hr`)
- **Companies**: HR creates its company (`GET/PUT/PATCH /api/hr/company/`). Staff verify it in the admin ("Mark as verified"). Renaming removes verification. Unverified companies aren't listed, can't receive reports, and their HR gets 403 on the dashboard and job offers.
- **Workers**: `GET /api/companies/?q=` lists verified companies. `GET/PUT/PATCH/DELETE /api/workplace/` sets the worker's company and `reporting_opt_in` (choosing a company never opts in; DELETE leaves and opts out). `POST /api/workplace/reports/ {category, occurred_month: "YYYY-MM", ongoing}` returns **204 with no body** and logs nothing. Needs a verified company and opt-in; at most `HR_REPORTS_PER_MONTH` (5) per worker per calendar month (429 after). Months can't be in the future or more than 24 months back. Leaving doesn't delete sent reports (they can't be found).
- **Dashboard**: `GET /api/hr/dashboard/` (`dashboard.py`): last 12 months by `occurred_month`, only the HR user's company. Nothing at all below `HR_MIN_GROUP_SIZE` (5, minimum 3) reports. Counts 1..k-1 come back as `null`; if a breakdown has exactly one hidden count, the next smallest is hidden too (no subtracting from the total). Months and categories are never crossed. Known limit: a live dashboard can still leak through changes over time (a count going up the day after someone reported).
- **Job offers**: `/api/hr/job-offers/` (list, create, retrieve, delete, `retry/`). Multipart `file` (PDF, DOCX, TXT/MD, 5 MB) or `text`. The review runs in Celery (`tasks.review_job_offer`, `offer_review.py`): extract text, retrieve law sections for a fixed list of topics plus the offer itself, then `llm.chat` with `prompts/job_offer_review.md`, which asks for JSON findings (`violation`/`concern`/`info` with quote and citation). A non-JSON reply is kept as the summary. The offer is wrapped in `<job_offer>` and the prompt says it's data, not instructions. The free reasoning model sometimes spends its whole 8192-token output budget thinking (always, on an 11-page contract in one go), so: the offer is split into parts of ~4,000 characters (`split_offer`, at most 8 parts), each part gets its own 8 law sections, each call uses `reasoning={"effort": "low"}` and is retried up to `JOB_OFFER_REVIEW_ATTEMPTS` (3) times when empty. `info` ("missing") findings are dropped for multi-part offers, since one part can't tell what's missing. Parts that never answer are listed in `parts_unchecked` with `failure="partial"` (status stays done), and Retry reruns the whole offer. Set `JOB_OFFER_MODEL` to use a different model for this only (the OpenRouter account's guardrail must allow it). If the queue is down the offer is marked failed, not left pending. Failed offers carry a `failure` reason: `no_text` (e.g. a scanned PDF, whose pages are images; there is no OCR yet), `unreadable`, `model` or `queue` (and `partial` on a done offer). The UI explains `no_text`/`unreadable` and only offers Retry for the others.
- Frontend: `/hr` (`HrHomePage`: company setup, dashboard charts, job offer check) and `/workplace` for workers (`WorkplacePage`).
- Env: `HR_MIN_GROUP_SIZE`, `HR_REPORTS_PER_MONTH`, `JOB_OFFER_MODEL`, `JOB_OFFER_REVIEW_ATTEMPTS`, `CELERY_TASK_ALWAYS_EAGER` (1 = run tasks in the request, so dev works without a worker).

### Voice dictation (`speech/` service + `apps/speech`)
- The chat box has a **Speak** button. While listening, the box is read-only: finished words show solid and the words still being recognised show grey. On **Stop** it becomes editable at once: the grey words go in, then the final text replaces them unless edited. **Send** while listening stops, waits up to 1 s, then sends.
- Dictated text is only a draft. It goes through the normal send path (crisis check, scope guard), so nothing reaches the LLM until the person presses Send.
- Flow:
  1. The browser asks for the mic first (the permission prompt can outlast a ticket).
  2. `POST /api/cases/<case_pk>/dictation-ticket/ {language}` returns `{ticket, url, expires_in}`. Owner only (`CaseScopedMixin`: strangers 404, grantees 403); 503 when `SPEECH_TICKET_SECRET` is empty, and the UI then hides the button.
  3. The browser opens `url?ticket=…` (`/speech/ws`; Vite proxies `/speech` to `127.0.0.1:9100`). The ticket is HMAC-signed with `SPEECH_TICKET_SECRET`, lasts 60 s, works once, and carries IDs only. `apps/speech/tickets.py` and `speech/tickets.py` implement the same format; keep them in sync.
  4. Audio: `frontend/public/pcm-worklet.js` resamples to 16 kHz mono 16-bit PCM in ~100 ms frames. It resamples itself because Firefox can't connect a mic to an `AudioContext` at another rate. Capture starts as soon as the mic opens; frames are held until the server is ready, so nothing said after "Listening" is lost.
  5. Protocol (documented in `speech/server.py`): `ready`, then `partial`/`final` text, `done` (`stopped`|`limit`) or `error` (`unauthorized`|`busy`|`failed`); the client sends `{type:"stop"}` to finish.
- `speech/streaming.py` re-transcribes the unfinished audio about once a second. Every segment but the last is final; the last becomes final when two passes in a row agree or the buffer reaches 8 s.
- Resource use: idle, the container uses ~0% CPU and ~40 MB. The model loads when a chat opens (`GET /speech/warm`) or on the first session, and unloads after `SPEECH_IDLE_UNLOAD_S` (120) without sessions or warm-ups. Compose caps it at `SPEECH_CPUS` (4); `SPEECH_THREADS` (4) must match. `SPEECH_MAX_SESSIONS` (2) bounds concurrency; extra sessions get `busy`.
- Privacy: audio and text are never stored, and transcript text is never logged (session, user and case IDs only). The model runs in the container; no audio leaves the machine. On a model load, faster-whisper only checks Hugging Face for model metadata.
- `faster-whisper==1.2.1` needs `av==16.1.0`: av 17+ removed an argument it uses.
- Env: `SPEECH_TICKET_SECRET` (Django and the container, from the root `.env`), `SPEECH_MODEL` (`base`; `tiny` is faster, `small` is too slow for live on CPU), `SPEECH_MAX_SESSIONS`, `SPEECH_IDLE_UNLOAD_S`, `DICTATION_MAX_SECONDS` (180), `SPEECH_CPUS`, `SPEECH_THREADS`, `SPEECH_TICKET_TTL` (60), `SPEECH_WS_URL` (`/speech/ws`). In production, route `/speech/` to the speech service with WebSocket upgrades and keep port 9100 private.

### Frontend look
- One stylesheet, `frontend/src/index.css`, built on tokens at the top: paper background, white cards (`--color-surface`) with hairline borders, ink actions (`--color-action`), safety yellow (`--color-primary`) only for marks and highlights. Partners swap `--color-brand`/`--color-action` (`data-theme="hr"` blue, `"firm"` gold). Dark mode redefines the same tokens.
- Buttons: `.button` (main action, one per area), `.button--secondary`, `.button--small`, `.button-quiet`, `.icon-button`. Cards: `.panel` and the card classes listed under "Cards".
- `components/Icon.tsx` (small hand-drawn line icons) and `components/ActionMenu.tsx` (a "⋯" button with secondary actions, e.g. rename/close an issue, download/close a chat). Prefer these to rows of text links.
- `GET /api/cases/` includes `timeline_count`, `tasks_total`, `tasks_done` and, for the owner only, `shared_count` (subqueries, so the shares join in `accessible_by` can't skew them).

### Tests
`apps/speech/tests.py` (ticket access rules and format), `speech/tests.py` (tickets, streaming, server protocol and limits, with a fake model; run in the container), `apps/accounts/tests.py`, `apps/cases/tests.py`, `apps/cases/test_api.py` (access and share rules), `apps/chat/tests.py` (crisis check, prompt building, `data_collection`, send-endpoint permissions), `apps/knowledge/tests.py` (chunking, references, retrieval, fallback), `apps/lawfirms/tests.py` (registration, profiles, directory, match flow and privacy), `apps/hr/tests.py` (suppression, company verification, workplace opt-in, unlinkable reports and rate limit, job offer access, review parsing and retries). Chat tests mock `llm.chat`; tests must never call the real model.

### Not built yet
- WebSocket streaming for chat. The frontend (`frontend/src/api/chat.ts`) calls the synchronous endpoint and passes the whole reply to `onDelta` once. Proposed message format:
  - `client → {type:"message", content}`
  - `server → crisis | token(delta) | done(message_id) | error`
- Celery tasks for document extraction and timeline generation (`TODO(llm)` in `documents/views.py`).
- Firm case statistics, and notifying firms and workers about new requests and answers.
- Encrypted file storage.
- RAG follow-ups: HTML ingestion, PDFs other than King's Printer consolidations, a per-province eval set (question → expected section), an HNSW index once the corpus grows, and a French search config for QC.

## Rules

### Privacy and access
- The victim owns every case. HR boards and law firms may access a case **only** through a `CaseShare` grant from the victim. Every view, serializer, consumer and Celery task that touches case data must enforce this.
- Never expose another user's identity in HR features. Aggregates must respect a minimum group size before being shown.
- Don't log message content, document text or personal data. Log IDs instead.
- Uploaded files go to encrypted storage; never serve them from a public URL.

### AI
- Call LLMs only through `apps/chat/llm.py`. Do not call OpenRouter or model providers from anywhere else, and never from the frontend.
- Speech-to-text runs locally in the `speech` container (faster-whisper), not through `llm.py`. Never send audio to a third-party service, and never store or log audio or transcripts.
- Keep `provider.data_collection = "deny"` on every request outside local dev (controlled by `OPENROUTER_DATA_COLLECTION`).
- The assistant answers only workplace-related questions; keep both scope layers (prompt rules + `scope.py` check) when changing prompts or models.
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
