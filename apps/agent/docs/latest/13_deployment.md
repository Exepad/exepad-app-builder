# Deployment Guide

The agent does not deploy standalone. It ships **inside the single self-hosted
Exepad container**: the root [`Dockerfile`](../../../../Dockerfile) builds the
Python 3.12 agent (deps from `apps/agent/requirements.lock`), and the
container's entrypoint runs it on **internal port 8081**, reverse-proxied by
the Node runtime worker at `/agent/*`. There is no separate agent service to
provision, scale, or authenticate.

- **Install/run the product:** root [`INSTALL.md`](../../../../INSTALL.md) and
  [`docs/install/`](../../../../docs/install/README.md).
- **Container architecture (what runs where):**
  [`docs/latest/10-deployment.md`](../../../../docs/latest/10-deployment.md).
- **Releases** (image tags, versioning, publish workflow):
  [`RELEASING.md`](../../../../RELEASING.md).
- **Agent-local development** (run from source next to the runtime):
  `./run.sh local` at the repo root, or see
  [`apps/agent/CLAUDE.md`](../../CLAUDE.md).

Configuration reaches the agent through environment variables set by the
container entrypoint (LLM provider/key from the operator's `.env` or the
in-app Settings); session state lives in SQLite under the `/data` volume.

> A few code paths still branch on `ENVIRONMENT=production` for a managed GCP
> deployment (Cloud Logging, IAM caller verification on `/r`). The container
> sets `ENVIRONMENT=selfhost`, so none of them are active in the shipped
> product — logging goes to stdout and there is no IAM check.
