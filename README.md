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

## References
The assistant answers from these Alberta laws. They are official King's Printer office consolidations, stored in `backend/prompts/provinces/AB/` and loaded with `manage.py ingest_laws`. Current versions are published by [Alberta King's Printer](https://kings-printer.alberta.ca/).

| Law | Citation | Consolidation | File |
|---|---|---|---|
| Employment Standards Code | RSA 2000, c E-9 | current as of November 26, 2025 | `Employment Standards Code.pdf` |
| Occupational Health and Safety Act | SA 2020, c O-2.2 | text converted to Markdown | `OHS Act.md` |
| Occupational Health and Safety Code | Alta Reg 191/2021 (amendments up to Alta Reg 210/2024) | current as of March 31, 2025 | `Occupational Health and Safety Code.pdf` |
| Alberta Human Rights Act | RSA 2000, c A-25.5 | current as of April 1, 2023 | `Alberta Human Rights Act.pdf` |
| Workers' Compensation Act | RSA 2000, c W-15 | current as of December 18, 2025 | `Workers Compensation Act.pdf` |

`backend/prompts/provinces/AB.md` is a plain-language summary of Alberta employment standards, drawn from [alberta.ca](https://www.alberta.ca/employment-standards). Contact numbers in `backend/prompts/contacts/AB.md` were checked against official Government of Alberta pages.

Boardwise provides general information, not legal advice. Laws change, so check the current consolidation.
