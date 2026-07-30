Exepad - install (Linux)
========================

From this package:

  bash install.sh

That's it. The installer:
  - offers to install Docker Engine (via Docker's official get.docker.com
    script) if it's missing - it asks first,
  - asks for the email and password you want and creates your operator
    account (your typing is hidden for the password; Enter at the email
    prompt skips it),
  - starts the studio at http://localhost:8080 - just log in.

Answering the account prompt is worth it: until an account exists, the studio
offers to create one to anyone who can reach this host.

Servers and unattended installs pass it as flags instead:
  bash install.sh --yes --admin-email you@example.com --admin-password '<secret>'
Either way the installer waits for the account to exist, then removes the
password from .env - it is hashed into the data volume by then.

Skipped it? First-run setup is left open and tokenless, so claim it promptly.
To require a one-time setup token, put EXEPAD_ALLOW_OPEN_SETUP=0 in
~/.exepad/.env and re-run - the installer never overwrites a setting you put
there yourself.

Your AI provider key is set in the studio, under Settings - the installer
never asks for it.

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
Node 18+ users also get the operator CLI:  npx exepad-app-builder status | stop | start | update | backup

Your data lives in the Docker volume "exepad-data" - reinstalling or
updating never touches it.
