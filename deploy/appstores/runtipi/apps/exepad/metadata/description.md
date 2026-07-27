# Exepad

Open-source, self-hosted AI app builder. Describe what you want, an AI agent
plans and builds it, and it's compiled, deployed, and served — all inside one
container on your own machine.

- **Prompt → full-stack app** — real React frontend + auto-CRUD SQLite backend
- **Bring your own LLM** — Gemini, Anthropic, OpenAI, OpenRouter, or a local
  model via Ollama
- **Your data stays home** — everything lives in the app's data directory

**Requirements:** ≥ 2 GB RAM (builds peak at 2–3 GB), a persistent data
directory (local disk — SQLite), exactly one instance.

On first run, create your operator account (a one-time setup token is printed
to the app logs) and paste your LLM key in the in-app **Settings** page.
