# Getting Started

This guide walks you through running the Exepad Agent **on its own**, for agent
development. If you just want to use the product, run the container — the agent
ships inside it and needs no separate setup. See the root
[`README.md`](../../../../README.md).

To run the agent alongside the runtime from source (the usual dev rig), use
`./run.sh local` at the repo root; it starts the runtime and the agent together.
The rest of this page is for working on the agent in isolation.

---

## Prerequisites

- **Python 3.12** (required — the project uses 3.12-specific features)
- **pip** or **uv** — for dependency management
- **An LLM API key** — any vendor (see the LLM Provider section of [Configuration](09_configuration.md)). Only the `vertex` provider needs the Google Cloud SDK and a GCP project.

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/Exepad/exepad-app-builder.git
cd exepad-app-builder/apps/agent
```

### 2. Create a virtual environment

```bash
python3.12 -m venv .venv
source .venv/bin/activate
```

### 3. Install dependencies

```bash
# Production + dev dependencies
make install

# Or manually:
pip install -r requirements.txt
pip install -r requirements-dev.txt
```

### 4. (Vertex provider only) Authenticate with Google Cloud

Skip this unless you set `EXEPAD_LLM_PROVIDER=vertex`.

```bash
gcloud auth application-default login
gcloud config set project <your-gcp-project>
```

## Environment Setup

### Copy the example environment file

```bash
cp env.example .env
```

### Configure `.env`

The `.env` file contains the LLM provider, agent model assignments, and content
handling settings. At minimum, point it at a model you can call:

```bash
# Native Gemini (the default provider)
GEMINI_API_KEY="..."

# — or any other vendor via LiteLLM —
# EXEPAD_LLM_PROVIDER="anthropic"
# EXEPAD_LLM_API_KEY="sk-..."
# EXEPAD_LLM_MODEL_DEFAULT="claude-sonnet-4-5"

# Per-agent overrides are optional. All agents default to
# gemini-3-flash-preview except BackendHandlerBuilder, which defaults to
# gemini-3.1-pro-preview. See env.example for the full list.
CREATOR_MODEL="gemini-3-flash-preview"
COMPONENT_BUILDER_MODEL="gemini-3-flash-preview"
```

### Local overrides with `.env.local`

For local development secrets that should never be committed:

```bash
# .env.local (gitignored)
SESSION_SERVICE_URI="sqlite+aiosqlite:///./agent_data.db"
PEXELS_API_KEY="your-pexels-key"
```

`.env.local` takes precedence over `.env` for overlapping keys.

## Running Locally

### Development server (with auto-reload)

```bash
make run
# or directly:
uvicorn agent_api:app --host 0.0.0.0 --port 8080 --reload
```

### Production mode (no reload)

```bash
make run-prod
# or:
uvicorn agent_api:app --host 0.0.0.0 --port 8080
```

The server starts at `http://localhost:8080`.

## Verifying the Setup

### Health check

```bash
curl http://localhost:8080/health
```

Expected response:

```json
{
  "environment": "development",
  "session_service": "ok",
  "artifact_service": "ok",
  "status": "ok"
}
```

### Quick code quality check

```bash
make check
```

This runs format checking, linting, and unit tests.

### Run unit tests

```bash
make test-unit
```

## Session Storage

| Mode | Storage | Setup |
|------|---------|-------|
| **Development** | In-Memory | No config needed (default) |
| **Development + DB** | SQLite via `aiosqlite` | Set `SESSION_SERVICE_URI` in `.env.local` |
| **Container** | In-Memory | The entrypoint does **not** set `SESSION_SERVICE_URI`, so sessions are lost on restart |
| **Test** | In-Memory | Automatic when `IS_TEST=true` |

Artifacts are always held in ADK's in-memory artifact service; the runtime
worker pulls them over `GET /artifacts/{session}` once a run completes.

## Next Steps

- Read the [Architecture](03_architecture.md) overview to understand the system design
- Explore the [Agent System](04_agent-system.md) to learn about the active agents and builders
- Check the [API Reference](08_api-reference.md) to understand the HTTP interface
- Run the [Testing](12_testing.md) guide to verify everything works
