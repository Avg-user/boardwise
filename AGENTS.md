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
- **Local services**: `docker-compose.yml` runs Postgres 17 and Redis 7.

## Layout

```
backend/
  config/            settings.py, urls.py, celery.py
  apps/
    accounts/        custom User model (role, preferred_language)
    cases/           cases, timeline entries, CaseShare (access grants)
    documents/       uploads and extracted text
    chat/            conversations, messages, llm.py
    tasks/           checklist items
    lawfirms/        firm profiles, matchmaking
    hr/              anonymous reports, dashboard aggregates
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

## Rules

### Privacy and access
- The victim owns every case. HR boards and law firms may access a case **only** through a `CaseShare` grant from the victim. Every view, serializer, consumer and Celery task that touches case data must enforce this.
- Never expose another user's identity in HR features. Aggregates must respect a minimum group size before being shown.
- Don't log message content, document text or personal data. Log IDs instead.
- Uploaded files go to encrypted storage; never serve them from a public URL.

### AI
- Call LLMs only through `apps/chat/llm.py`. Do not call OpenRouter or model providers from anywhere else, and never from the frontend.
- Keep `provider.data_collection = "deny"` on every request.
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
