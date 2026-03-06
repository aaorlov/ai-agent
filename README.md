# AI Agent API

Python API for an AI agent with **FastAPI**, **Pydantic**, and **LangGraph**. Exposes a chat API over SSE with a human-in-the-loop workflow (plan → propose → apply).

## Stack

- **Python 3.13+**
- **FastAPI** – web framework
- **Pydantic** – validation and settings
- **LangGraph** – agent graph (plan / propose / apply with interrupts)
- **sse-starlette** – Server-Sent Events
- **Docker** – run the app in a container

## Quick start

### Local (no Docker)

```bash
# Create venv and install
python3 -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt

# Run
uvicorn app.main:app --reload --port 8000
```

- API: http://localhost:8000  
- Docs: http://localhost:8000/docs  
- Health: http://localhost:8000/health  

### Docker

```bash
# Build and run (production-style)
docker compose up --build

# Or with custom port
PORT=3000 docker compose up --build
```

### Docker (development)

Run with code mounted and auto-reload so changes apply without rebuilding:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

- `./app` is mounted into the container; editing code triggers uvicorn `--reload`.
- `ENV=dev` is set automatically.
- API: http://localhost:8000 — Docs: http://localhost:8000/docs

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `ENV`    | `dev`   | `dev` \| `prod` \| `test` |
| `PORT`   | `8000`  | Server port |

Optional: create a `.env` file in the project root (loaded in dev).

## Endpoints

- `GET /` – API info and endpoint list
- `GET /health` – basic health
- `GET /health/detailed` – health with checks
- `POST /chat` – SSE chat stream (Vercel AI SDK–style messages, optional `threadId`, approve/reject via message parts)
- `GET /docs` – Swagger UI
- `GET /openapi.json` – OpenAPI schema

## Project layout

```
app/
  main.py           # FastAPI app
  config.py         # Pydantic settings
  agent.py          # LangGraph graphs
  common/           # Enums, utils
  modules/
    chat/           # Chat routes, schemas, SSE
    health/         # Health routes
```
