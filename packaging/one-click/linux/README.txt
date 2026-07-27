Exepad - install (Linux)
========================

From this package:

  bash install.sh

That's it. The installer:
  - offers to install Docker Engine (via Docker's official get.docker.com
    script) if it's missing - it asks first,
  - asks for your LLM API key (Enter to skip; add it later in Settings),
  - starts the studio at http://localhost:8080.

Non-interactive/servers:  bash install.sh --yes --port 8080
All options:              bash install.sh --help
HTTPS on a domain:        bash install.sh --domain studio.example.com

Requirements
------------
- x86_64 or arm64, 2 GB+ RAM (builds peak at 2-3 GB)
- Docker Engine 20+ (auto-installed with your consent if missing)


Manage it later
---------------
Re-run install.sh any time to update to this package's version.
Node 18+ users also get the operator CLI:  npx exepad status | stop | start | update | backup

Your data lives in the Docker volume "exepad-data" - reinstalling or
updating never touches it.
