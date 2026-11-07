# Boardwise

Django (backend) + React/Vite (frontend), Postgres + Redis via Docker.

## First-time setup
```bash
cp .env.example .env            # fill in secrets
docker compose up -d            # Postgres + Redis
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python manage.py migrate
.venv/bin/python manage.py createsuperuser
cd ../frontend && npm install
```

## Run (3 terminals)
```bash
cd backend && .venv/bin/python manage.py runserver        # http://localhost:8000
cd backend && .venv/bin/celery -A config worker -l info    # background jobs
cd frontend && npm run dev                                 # http://localhost:5173 (proxies /api)
```

Health check: http://localhost:8000/api/health/ — admin: http://localhost:8000/admin/

AI chat: set `OPENROUTER_API_KEY` in `.env`, then `POST /api/cases/<id>/conversations/<id>/messages/` with `{"content": "..."}` (try it in Swagger at /api/docs/). Load the province law references for retrieval with `python manage.py ingest_laws`.

## Layout
- `backend/config` — settings, urls, celery
- `backend/apps/` — accounts, cases, documents, chat, tasks, lawfirms, hr
- `frontend/` — React + TypeScript (TanStack Query, React Router, i18next)
