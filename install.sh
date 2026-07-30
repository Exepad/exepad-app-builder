#!/usr/bin/env bash
# exepad install.sh — single-command installer for the self-hosted Exepad studio.
#
#   curl -fsSL https://get.exepad.com | bash
#   curl -fsSL https://get.exepad.com | bash -s -- --version 0.3.0 --llm-key sk-...
#
# This is the Node-less front door for Linux servers AND macOS (it is also the
# script inside the one-click bundles — see packaging/one-click/). On public
# releases with Node >=18 present it delegates to the canonical
# `npx exepad-app-builder up` (single source of truth); otherwise it runs an
# embedded bootstrap that produces the SAME docker-compose.yml / .env /
# .exepad-version marker. Distinct from ./run.sh (that builds from source for dev).
#
# Verify before piping to a shell:  curl -fsSL https://get.exepad.com -o install.sh
#
# The image is public — no `docker login` needed. Override it with
# EXEPAD_IMAGE=<your-registry/image> if you host your own mirror.
set -euo pipefail

# ----- defaults (CI rewrites EXEPAD_DEFAULT_VERSION to the released tag) ---------
EXEPAD_DEFAULT_VERSION="latest"
# Release channel, rewritten by CI: "public" | "private" | "dev" (repo default).
# Gates the npx delegation — the npm launcher exists ONLY for public releases;
# on dev/private builds `npx exepad-app-builder` would 404 (or worse, execute a
# name-squatted package), so those channels always use the embedded bootstrap.
EXEPAD_RELEASE_CHANNEL="dev"
IMAGE_REPO="${EXEPAD_IMAGE:-ghcr.io/exepad/exepad-app-builder}"
OS_NAME="$(uname -s)"
DATA_VOLUME="exepad-data"
CONTAINER_NAME="exepad"
MIN_RAM_GB=2

VERSION="${EXEPAD_VERSION:-$EXEPAD_DEFAULT_VERSION}"
DIR="${EXEPAD_HOME:-$HOME/.exepad}"
PORT="8080"
DOMAIN=""
ACME_EMAIL=""
LLM_KEY=""
ADMIN_EMAIL=""
ADMIN_PASSWORD=""
FORCE=0
DRY_RUN=0
NO_NODE=0
ASSUME_YES=0
# Docker Engine auto-install gate. Default: offer it (with consent). Set
# EXEPAD_DOCKER_INSTALL=false (or --no-docker-install) to never touch Docker;
# EXEPAD_DOCKER_INSTALL=always to skip the consent prompt (headless provisioning).
NO_DOCKER_INSTALL=0
case "${EXEPAD_DOCKER_INSTALL:-}" in
  false|FALSE|no|NO|0) NO_DOCKER_INSTALL=1 ;;
esac
# Oldest Docker Engine major we accept (Compose v2 plugin + BuildKit era).
MIN_DOCKER_MAJOR=20

say()  { printf '%s\n' "$*"; }
warn() { printf '! %s\n' "$*" >&2; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }
run()  { if [ "$DRY_RUN" -eq 1 ]; then printf '  → would run: %s\n' "$*"; else "$@"; fi; }
write_file() {
  # write_file <path> <<<content via stdin>
  if [ "$DRY_RUN" -eq 1 ]; then printf '  → would write: %s\n' "$1"; cat >/dev/null; else cat >"$1"; fi
}

# Merge KEY=VALUE updates into an existing .env (preserving operator-added lines)
# and override only the managed keys. Prints the merged content to stdout. Mirrors
# the canonical CLI's mergeEnv so the two front doors don't diverge (the old code
# rewrote ONLY the new values, silently dropping everything the operator had added).
env_merge() {
  local path="$1"; shift
  local kv key line skip
  if [ -f "$path" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      skip=0
      for kv in "$@"; do
        key="${kv%%=*}"
        case "$line" in "$key="*) skip=1; break;; esac
      done
      [ "$skip" -eq 0 ] && printf '%s\n' "$line"
    done < "$path"
  else
    printf '# Exepad operator config (managed by install.sh).\n'
    printf '# Safe to edit. Platform secrets are generated inside /data, never here.\n'
  fi
  for kv in "$@"; do printf '%s\n' "$kv"; done
}

# Drop a single key from an .env, leaving everything else byte-for-byte.
env_strip() {
  local path="$1" key="$2" line
  [ -f "$path" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in "$key="*) ;; *) printf '%s\n' "$line";; esac
  done < "$path"
}

# ----- claiming the instance during install -------------------------------------
# Seeding EXEPAD_ADMIN_EMAIL/PASSWORD makes the container create the operator
# account at boot, which CLOSES first-run setup (seedAdminFromEnv is idempotent
# and no-ops once a user exists). No unclaimed window for anyone to race for, no
# token to copy, and the first visit is an ordinary login.
#
# This is not the AI-key prompt coming back: that was CONFIGURATION, changeable
# later, and Settings is the right home for it. This is OWNERSHIP, which has to
# be settled before somebody else settles it.
#
# seedAdminFromEnv calls createUser directly and enforces NO minimum length —
# unlike POST /auth/setup, which requires 8. Without the check below the seeded
# path would be quietly weaker than the form it replaces.
valid_operator_email()    { printf '%s' "$1" | grep -Eq '^[^@[:space:]]+@[^@[:space:]]+$'; }
valid_operator_password() { [ "${#1}" -ge 8 ]; }

# Sets ADMIN_EMAIL/ADMIN_PASSWORD when the user supplies them. Silent no-op on
# every non-interactive path — it must never block an unattended install.
maybe_ask_for_account() {
  [ "$DRY_RUN" -eq 1 ] && return 0
  [ "$ASSUME_YES" -eq 1 ] && return 0
  [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ] && return 0
  # Re-run over an existing install: the question was settled the first time.
  [ -n "$(deployed_tag)" ] && return 0
  # No terminal to type into (piped, CI, a service unit): never block.
  { : > /dev/tty; } 2>/dev/null || return 0

  local email password
  say ""
  say "Create your operator account now, so nobody else can claim this studio."
  say "  Press Enter at the email prompt to skip and create it in the browser."
  # `_`, not a named variable: the loop only BOUNDS the retries, nothing reads
  # the counter. A named one trips shellcheck's SC2034 at warning level, which
  # packaging-ci treats as fatal.
  for _ in 1 2 3; do
    printf '%s' "[exepad]   Email: " > /dev/tty
    read -r email < /dev/tty || return 0
    [ -z "$email" ] && return 0
    if ! valid_operator_email "$email"; then
      warn "  That does not look like an email address."
      continue
    fi
    # Said BEFORE the masked prompt — after is too late for someone already
    # wondering whether the installer has frozen.
    say "  Now the password. Your typing will NOT be shown - that is normal."
    printf '%s' "[exepad]   Password (at least 8 characters): " > /dev/tty
    read -rs password < /dev/tty || return 0
    printf '\n' > /dev/tty
    if ! valid_operator_password "$password"; then
      warn "  Too short - at least 8 characters."
      continue
    fi
    ADMIN_EMAIL="$email"
    ADMIN_PASSWORD="$password"
    SEEDED_EMAIL="$email"
    return 0
  done
  warn "  Skipping account creation - you can do it in the browser."
}

# Poll until the studio reports setup is closed, i.e. the seed actually landed.
wait_setup_complete() {
  local port="$1" try
  try=0
  while [ "$try" -lt 45 ]; do
    try=$((try + 1))
    if curl -fsS --max-time 5 "http://localhost:${port}/auth/status" 2>/dev/null \
         | grep -q '"needsSetup":false'; then
      return 0
    fi
    sleep 2
  done
  return 1
}

usage() {
  cat <<EOF
exepad installer

  --version <ver>      Studio version (default: $EXEPAD_DEFAULT_VERSION). Pin X.Y.Z for reproducibility.
  --dir <path>         Install dir (default: \$EXEPAD_HOME or ~/.exepad)
  --port <n>           Host port (default: 8080; ignored when --domain is set)
  --domain <host>      Serve HTTPS on a domain via a Caddy sidecar (auto Let's Encrypt)
  --acme-email <email> ACME contact for Let's Encrypt (recommended with --domain)
  --llm-key <key>      Seed EXEPAD_LLM_API_KEY
  --admin-email <e>    Seed operator account (with --admin-password)
  --admin-password <p>
  --force              Allow downgrade / unsupported arch (back up first!)
  --dry-run            Print actions, change nothing
  --yes                Non-interactive (also consents to the Docker auto-install)
  --no-docker-install  Never install Docker (fail with instructions if missing)
  --no-node            Skip npx delegation; use the embedded bootstrap
  -h, --help

If Docker is missing: on Linux the installer offers to install Docker Engine
via Docker's official https://get.docker.com script (root; asks first — or
--yes / EXEPAD_DOCKER_INSTALL=always for headless runs;
EXEPAD_DOCKER_INSTALL=false to never). On macOS it points you at Docker
Desktop / OrbStack (no unattended install exists there). Windows: use
install.ps1 instead.
EOF
}

# ----- arg parsing --------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="${2:?--version needs a value}"; shift 2;;
    --dir) DIR="${2:?}"; shift 2;;
    --port) PORT="${2:?}"; shift 2;;
    --domain) DOMAIN="${2:?}"; shift 2;;
    --acme-email) ACME_EMAIL="${2:?}"; shift 2;;
    --llm-key) LLM_KEY="${2:?}"; shift 2;;
    --admin-email) ADMIN_EMAIL="${2:?}"; shift 2;;
    --admin-password) ADMIN_PASSWORD="${2:?}"; shift 2;;
    --force) FORCE=1; shift;;
    --dry-run) DRY_RUN=1; shift;;
    --yes|-y) ASSUME_YES=1; shift;;
    --no-docker-install) NO_DOCKER_INSTALL=1; shift;;
    --no-node) NO_NODE=1; shift;;
    -h|--help) usage; exit 0;;
    *) die "unknown option: $1 (see --help)";;
  esac
done

# Allow secrets via the environment so they stay OFF argv (visible in `ps` and
# shell history). An explicit --flag still wins.
LLM_KEY="${LLM_KEY:-${EXEPAD_LLM_API_KEY:-}}"
ADMIN_EMAIL="${ADMIN_EMAIL:-${EXEPAD_ADMIN_EMAIL:-}}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-${EXEPAD_ADMIN_PASSWORD:-}}"
# Set once the .env is written; drives the "add your key in Settings" next step.
NEEDS_KEY=0
# Set when this run defaults first-run setup to tokenless.
OPEN_SETUP=0
# Email of an operator account seeded by this run (empty when none was).
SEEDED_EMAIL=""
# Set once the seeded account is confirmed to exist.
SEEDED_OK=0

is_semver() { printf '%s' "$1" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+([-+].*)?$'; }

# ----- Docker auto-install (the get.docker.com pattern: Coolify/CasaOS/Runtipi) --
docker_major() {
  # "Docker version 27.0.1, build abc" → 27. Echoes 0 when unparsable.
  docker --version 2>/dev/null | sed -nE 's/^Docker version ([0-9]+)\..*/\1/p' | head -1 | grep -E '^[0-9]+$' || echo 0
}

# macOS has no get.docker.com path (Docker Engine needs a Linux kernel; the
# desktop runtimes bundle their own VM). Detect-and-instruct, never install.
darwin_docker_instruct() {
  warn "Docker is not installed (or not running)."
  say  ""
  say  "Exepad runs as a Docker container. On macOS install ONE of:"
  say  "  1. Docker Desktop  https://www.docker.com/products/docker-desktop/   (most common)"
  say  "  2. OrbStack        https://orbstack.dev                              (lighter/faster)"
  say  ""
  say  "Then start it (whale/orb icon in the menu bar, wait for it to say the"
  say  "engine is running) and re-run this installer."
  if [ "$DRY_RUN" -eq 1 ]; then
    say "  → dry-run: would offer to open the download page (Docker is required for a real run)."
    return 0
  fi
  if [ "$ASSUME_YES" -ne 1 ] && { : > /dev/tty; } 2>/dev/null; then
    printf '%s' "[exepad] Open the Docker Desktop download page now? [Y/n] " > /dev/tty
    _ans=""; read -r _ans < /dev/tty || true
    case "$_ans" in
      n|N|no|NO) : ;;
      *) open "https://www.docker.com/products/docker-desktop/" >/dev/null 2>&1 || true ;;
    esac
  fi
  die "install a Docker runtime, then re-run this installer"
}

install_docker() {
  if [ "$OS_NAME" = "Darwin" ]; then
    darwin_docker_instruct   # dies with instructions (returns only on --dry-run)
    return 0                 # never fall through to the Linux get.docker.com path
  fi
  if [ "$NO_DOCKER_INSTALL" -eq 1 ]; then
    say "  Docker is required. Install it, then re-run:  curl -fsSL https://get.docker.com | sh"
    die "docker not found (auto-install disabled via --no-docker-install / EXEPAD_DOCKER_INSTALL=false)"
  fi
  if command -v podman >/dev/null 2>&1; then
    warn "Podman detected — this installer's embedded path drives Docker."
    if [ "$EXEPAD_RELEASE_CHANNEL" = "public" ]; then
      say "  Prefer Podman? Use the runtime-neutral CLI instead:  npx exepad-app-builder up"
    else
      say "  Prefer Podman? Build the runtime-neutral CLI from the repo (packages/exepad-cli)."
    fi
    say  "  Or continue below to install Docker alongside it."
  fi
  # Consent. Under `curl | bash` stdin IS the script, so prompt via /dev/tty.
  # Never silently pipe a root install script without a yes. ({ : > /dev/tty; }
  # actually OPENS the tty — `[ -r /dev/tty ]` can pass on hosts with no usable
  # controlling terminal.)
  if [ "$ASSUME_YES" -ne 1 ] && [ "${EXEPAD_DOCKER_INSTALL:-}" != "always" ]; then
    if { : > /dev/tty; } 2>/dev/null; then
      printf '%s' "[exepad] Docker not found. Install Docker Engine now via get.docker.com (runs as root)? [y/N] " > /dev/tty
      _ans=""; read -r _ans < /dev/tty || true
      case "$_ans" in
        y|Y|yes|YES) : ;;
        *) die "docker is required — install it yourself (curl -fsSL https://get.docker.com | sh) and re-run";;
      esac
    else
      say "  No TTY available for a consent prompt."
      say "  Re-run with --yes (or EXEPAD_DOCKER_INSTALL=always) to auto-install Docker,"
      say "  or install it yourself:  curl -fsSL https://get.docker.com | sh"
      die "docker not found"
    fi
  fi
  SUDO=""
  if [ "$(id -u)" -ne 0 ]; then
    command -v sudo >/dev/null 2>&1 || die "installing Docker needs root — re-run as root (or install sudo)"
    SUDO="sudo"
  fi
  say "Installing Docker Engine via Docker's official script (https://get.docker.com)…"
  if [ "$DRY_RUN" -eq 1 ]; then
    say "  → would run: curl -fsSL https://get.docker.com | ${SUDO:+$SUDO }sh"
    return 0
  fi
  curl -fsSL https://get.docker.com | $SUDO sh || die "Docker install failed — see the output above"
  command -v docker >/dev/null 2>&1 || die "Docker installed but 'docker' is not on PATH — open a new shell and re-run"
  # get.docker.com enables + starts the service on systemd distros; nudge if not.
  docker info >/dev/null 2>&1 || $SUDO systemctl start docker 2>/dev/null || true
  # get.docker.com does NOT grant the invoking user socket access. If the daemon
  # answers root but not us, say exactly what to do rather than failing cryptically
  # on the first compose call below.
  if [ -n "$SUDO" ] && ! docker info >/dev/null 2>&1 && $SUDO docker info >/dev/null 2>&1; then
    warn "Docker is installed and running, but user '$(id -un)' cannot reach the socket yet."
    say  "  Grant access:   sudo usermod -aG docker $(id -un)"
    say  "  then log out/in (or run \`newgrp docker\`) and re-run this installer."
    exit 0   # idempotent: re-running picks up exactly where we left off
  fi
  say "Docker Engine installed."
}

# ----- preflight ----------------------------------------------------------------
preflight() {
  if ! command -v docker >/dev/null 2>&1; then
    warn "Docker not found."
    install_docker
    # Dry-run can't actually install; skip the checks that need a real docker.
    if [ "$DRY_RUN" -eq 1 ] && ! command -v docker >/dev/null 2>&1; then
      say "  (dry-run: skipping the remaining preflight — Docker was not actually installed)"
      return 0
    fi
  fi

  # Version gate (gate, not pin — a hard pin rots; see packaging-decision-v2).
  _maj="$(docker_major)"
  if [ "${_maj:-0}" -lt "$MIN_DOCKER_MAJOR" ]; then
    if [ "$FORCE" -eq 1 ]; then
      warn "Docker major $_maj < $MIN_DOCKER_MAJOR — old engine; --force given, continuing."
    else
      die "Docker $_maj is too old (need >= $MIN_DOCKER_MAJOR for the Compose v2 plugin). Upgrade Docker (get.docker.com) or pass --force."
    fi
  fi

  # Compose v2 is a CLI *plugin*, not the standalone `docker-compose` binary, and
  # it is genuinely absent on a common macOS setup: `brew install docker` ships
  # the CLI alone, and Homebrew's separate docker-compose formula is not
  # registered as a plugin — so `docker compose` fails while `docker-compose`
  # works. Bare "plugin is required" leaves that user with nothing to act on, so
  # say what to run. (Docker Desktop and OrbStack both bundle it already.)
  if ! docker compose version >/dev/null 2>&1; then
    warn "Docker Compose v2 plugin is required (got legacy/none)."
    if [ "$OS_NAME" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
      say ""
      say "  Homebrew's docker formula does not include it. Add it with:"
      say "    brew install docker-compose"
      say "    mkdir -p ~/.docker/cli-plugins"
      say "    ln -sfn \"\$(brew --prefix)/opt/docker-compose/bin/docker-compose\" ~/.docker/cli-plugins/docker-compose"
      say ""
      say "  Then re-run this installer. (Docker Desktop and OrbStack ship it already.)"
    else
      say ""
      say "  Install the plugin (Debian/Ubuntu: 'docker-compose-plugin'), or reinstall"
      say "  Docker from https://get.docker.com which includes it, then re-run."
    fi
    die "Docker Compose v2 plugin not found"
  fi
  if ! docker info >/dev/null 2>&1; then
    if [ "$OS_NAME" = "Darwin" ]; then
      warn "Docker is installed but its engine is not running."
      say  "  Start Docker Desktop / OrbStack (menu-bar icon), wait for the engine, re-run."
      die  "docker daemon not reachable"
    fi
    # Distinguish "daemon down" from "daemon fine, user lacks socket access".
    if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1; then
      warn "Docker runs as root but user '$(id -un)' cannot reach the socket (not in the 'docker' group)."
      say  "  Fix:  sudo usermod -aG docker $(id -un)   then log out/in and re-run."
      die  "docker daemon not reachable as the current user"
    fi
    die "Docker daemon not reachable — start Docker and retry."
  fi

  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64|aarch64|arm64) : ;;
    *) if [ "$FORCE" -eq 1 ]; then warn "arch $arch unsupported (image targets amd64/arm64); --force given, continuing."
       else die "arch $arch not supported (image targets amd64/arm64). Re-run with --force to try anyway."; fi;;
  esac

  ram_gb=""
  if [ "$OS_NAME" = "Darwin" ]; then
    mem_bytes="$(sysctl -n hw.memsize 2>/dev/null || echo 0)"
    if [ "${mem_bytes:-0}" -gt 0 ] 2>/dev/null; then ram_gb=$(( mem_bytes / 1073741824 )); fi
  elif command -v free >/dev/null 2>&1; then
    ram_gb=$(free -g | awk '/^Mem:/{print $2}')
  fi
  if [ -n "$ram_gb" ] && [ "$ram_gb" -lt "$MIN_RAM_GB" ] 2>/dev/null; then
    warn "Host has ${ram_gb}GB RAM; builds peak at 2-3GB."
  fi
  return 0   # never let a falsy trailing test trip `set -e`
}

# ----- downgrade guard (embedded path) ------------------------------------------
deployed_tag() {
  [ -f "$DIR/.exepad-version" ] || return 0
  { grep -Eo '"tag"[[:space:]]*:[[:space:]]*"[^"]+"' "$DIR/.exepad-version" 2>/dev/null \
    | head -1 | sed -E 's/.*"tag"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'; } || true
}

guard_downgrade() {
  local deployed="$1" target="$2"
  [ -z "$deployed" ] && return 0
  if is_semver "$deployed" && is_semver "$target"; then
    if [ "$deployed" != "$target" ]; then
      local lower
      lower=$(printf '%s\n%s\n' "$deployed" "$target" | sort -V | head -1)
      if [ "$lower" = "$target" ]; then
        if [ "$FORCE" -eq 1 ]; then
          warn "Forcing downgrade $deployed → $target. Ensure you have a backup."
        else
          warn "Refusing downgrade $deployed → $target."
          say  "  Migrations run forward only; an older image on newer /data can break."
          say  "  Back up first, then re-run with --force."
          exit 1
        fi
      fi
    fi
  elif [ -n "$deployed" ]; then
    warn "Target \"$target\" is a moving tag; cannot verify downgrade safety."
  fi
  return 0
}

# ----- delegate to the canonical CLI when Node is available ---------------------
# Delegation is an OPTIMISATION, not a requirement: the npm launcher and the
# embedded bootstrap below emit the same docker-compose.yml, .env and version
# marker, and both end at the same image. So an unreachable launcher has to fall
# THROUGH to the bootstrap rather than abort the install. npm being down, npm
# rate-limiting the box, a yanked version, an air-gapped mirror, or a release
# whose npm job failed after the image had already published are all outside the
# user's control — and each one used to kill `curl … | bash` outright for anyone
# who happened to have Node installed, on a machine where the fallback two lines
# below would have worked perfectly.
maybe_delegate_to_npx() {
  # Public releases only: the npm launcher is not published for dev/private
  # builds, so delegation would 404 — or run a name-squatted package.
  [ "$EXEPAD_RELEASE_CHANNEL" = "public" ] || return 0
  [ "$NO_NODE" -eq 1 ] && return 0
  command -v node >/dev/null 2>&1 || return 0
  local major
  major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  [ "${major:-0}" -ge 18 ] || return 0

  local pkgspec="exepad-app-builder"
  is_semver "$VERSION" && pkgspec="exepad-app-builder@$VERSION"

  # Resolve-and-run probe, deliberately a real invocation rather than `npm view`:
  # it proves the launcher both downloads AND executes on THIS Node before we
  # hand it the install, and it warms the npx cache so the run below is local.
  # Splitting it this way keeps the two failure modes distinguishable — a probe
  # failure means "no usable launcher" and falls through, while a failure of the
  # real run below is a genuine install failure and still exits non-zero.
  if [ "$DRY_RUN" -eq 0 ] && ! npx -y "$pkgspec" --version >/dev/null 2>&1; then
    warn "npm launcher ($pkgspec) is unavailable — continuing with the built-in installer."
    say  "  Same outcome: identical docker-compose.yml, .env and container."
    return 0
  fi

  say "Node $(node -v) detected — delegating to the canonical CLI (npx exepad-app-builder)…"
  set -- exepad up --to "$VERSION" --dir "$DIR" --port "$PORT" --yes
  [ -n "$LLM_KEY" ] && set -- "$@" --llm-key "$LLM_KEY"
  [ -n "$ADMIN_EMAIL" ] && set -- "$@" --admin-email "$ADMIN_EMAIL"
  [ -n "$ADMIN_PASSWORD" ] && set -- "$@" --admin-password "$ADMIN_PASSWORD"
  [ -n "$DOMAIN" ] && set -- "$@" --domain "$DOMAIN"
  [ -n "$ACME_EMAIL" ] && set -- "$@" --acme-email "$ACME_EMAIL"
  [ "$FORCE" -eq 1 ] && set -- "$@" --force
  [ "$DRY_RUN" -eq 1 ] && set -- "$@" --dry-run
  run npx -y "$pkgspec" "${@:2}"
  exit $?
}

# ----- embedded bootstrap (Node-less fallback; mirrors the CLI output) ----------
image_ref() {
  case "$VERSION" in
    @sha256:*) printf '%s%s' "$IMAGE_REPO" "$VERSION";;
    sha256:*)  printf '%s@%s' "$IMAGE_REPO" "$VERSION";;
    *)         printf '%s:%s' "$IMAGE_REPO" "$VERSION";;
  esac
}

embedded_install() {
  is_semver "$VERSION" || warn "\"$VERSION\" is a moving tag — not reproducible. Pin --version X.Y.Z for production."
  guard_downgrade "$(deployed_tag)" "$VERSION"

  # NO interactive key prompt here, deliberately — see the matching note in
  # install.ps1. Configuration, the AI provider key above all, belongs in the
  # studio's Settings UI: one place to set it, validate it and rotate it. The
  # prompt this replaces had to hide the typing (it is a secret), which made a
  # healthy install look hung at the worst possible moment. --llm-key and
  # EXEPAD_LLM_API_KEY remain, for unattended installs with no UI to go to.

  # Ownership IS asked for, though — claiming the instance up front beats every
  # way of guarding an unclaimed one.
  maybe_ask_for_account
  # Seeded from flags/env rather than the prompt: same confirm-then-strip
  # treatment below, since an unattended install has even less reason to leave a
  # plaintext admin password lying in .env.
  if [ -z "$SEEDED_EMAIL" ] && [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
    SEEDED_EMAIL="$ADMIN_EMAIL"
  fi

  run mkdir -p "$DIR"

  if [ -n "$DOMAIN" ]; then
    write_file "$DIR/docker-compose.yml" <<EOF
# Generated by exepad install.sh. Managed file. Pinned ref — never floats :latest.
# HTTPS for $DOMAIN via Caddy (automatic Let's Encrypt). The studio is internal-only.
# Persistent state lives in the named volume "$DATA_VOLUME" (/data), NOT in this directory.
services:
  $CONTAINER_NAME:
    image: $(image_ref)
    container_name: $CONTAINER_NAME
    restart: unless-stopped
    env_file:
      - .env
    expose:
      - "8080"
    volumes:
      - $DATA_VOLUME:/data
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
  caddy:
    image: caddy:2-alpine
    container_name: ${CONTAINER_NAME}-caddy
    restart: unless-stopped
    depends_on:
      - $CONTAINER_NAME
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
volumes:
  $DATA_VOLUME:
    name: $DATA_VOLUME  # literal name (backup/docs mount it directly)
  caddy-data:
  caddy-config:
EOF
    {
      [ -n "$ACME_EMAIL" ] && printf '{\n\temail %s\n}\n\n' "$ACME_EMAIL"
      printf '%s {\n\treverse_proxy %s:8080\n}\n' "$DOMAIN" "$CONTAINER_NAME"
    } | write_file "$DIR/Caddyfile"
  else
    write_file "$DIR/docker-compose.yml" <<EOF
# Generated by exepad install.sh. Managed file. Pinned ref — never floats :latest.
# The studio serves plain HTTP on :$PORT for local/LAN use — do not expose it straight
# to the internet. For browser-trusted HTTPS rerun with --domain <your-domain>.
# Persistent state lives in the named volume "$DATA_VOLUME" (/data), NOT in this directory.
services:
  $CONTAINER_NAME:
    image: $(image_ref)
    container_name: $CONTAINER_NAME
    restart: unless-stopped
    env_file:
      - .env
    environment:
      # Publishing the studio's PLAIN-HTTP port as the front door means the in-image
      # Caddy must stay OFF. Left on, the entrypoint marks session cookies Secure
      # (EXEPAD_COOKIE_SECURE=1) while terminating TLS on a container port this file
      # never publishes — the browser then REFUSES to store the cookie over
      # http://<lan-ip>:$PORT and login silently fails everywhere except localhost
      # (which browsers treat as a secure context). Mirrors the exepad CLI's
      # non-domain compose and deploy/docker-compose.yml. Behind a TLS-terminating
      # proxy the runtime reads X-Forwarded-Proto and issues Secure cookies again.
      - EXEPAD_HTTPS_DISABLE=1
    ports:
      - "$PORT:8080"
    volumes:
      - $DATA_VOLUME:/data
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
volumes:
  $DATA_VOLUME:
    name: $DATA_VOLUME  # literal name (backup/docs mount it directly)
EOF
  fi

  # Collect the managed .env updates, then MERGE (never clobber) into any existing
  # .env and keep the file owner-only (0600): it holds the LLM key + admin password,
  # which under the default umask 022 would otherwise land world-readable (0644).
  local -a env_updates=()
  # Tokenless first-run setup — see the matching note in install.ps1. The setup
  # token proves "I can read this host's logs", which for the desktop case means
  # making someone dig through `docker logs` to prove they own the machine they
  # are sitting at. The installers default it off and the studio then hides the
  # field. The trade: until you complete the setup form, anyone who can reach
  # this host on the published port can complete it instead of you — so finish
  # setup right after installing.
  #
  # Only a DEFAULT: an explicit EXEPAD_ALLOW_OPEN_SETUP already in .env is left
  # alone, so `EXEPAD_ALLOW_OPEN_SETUP=0` puts the token back for good.
  # OPEN_SETUP means "open setup is IN EFFECT", not "this run added it" — a
  # re-run over an .env that already carries the flag must reach the same
  # conclusion, or it skips the "create your account" hint and goes looking for
  # a token that was never minted.
  if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
    # A seeded admin closes setup, so open setup is moot. Deliberately NOT
    # written: if the seed were to fail, its absence leaves the token guard
    # standing rather than the instance wide open — the right way round for a
    # failure nobody is watching for.
    OPEN_SETUP=0
  elif ! grep -q '^EXEPAD_ALLOW_OPEN_SETUP=' "$DIR/.env" 2>/dev/null; then
    env_updates+=("EXEPAD_ALLOW_OPEN_SETUP=1")
    OPEN_SETUP=1
  elif grep -qiE '^EXEPAD_ALLOW_OPEN_SETUP=[[:space:]]*(1|true|yes|on)[[:space:]]*$' "$DIR/.env" 2>/dev/null; then
    OPEN_SETUP=1
  fi
  [ -n "$LLM_KEY" ] && env_updates+=("EXEPAD_LLM_API_KEY=$LLM_KEY")
  [ -n "$ADMIN_EMAIL" ] && env_updates+=("EXEPAD_ADMIN_EMAIL=$ADMIN_EMAIL")
  [ -n "$ADMIN_PASSWORD" ] && env_updates+=("EXEPAD_ADMIN_PASSWORD=$ADMIN_PASSWORD")
  if [ -n "$DOMAIN" ]; then
    env_updates+=("EXEPAD_COOKIE_SECURE=1")
    env_updates+=("EXEPAD_ALLOWED_ORIGINS=https://$DOMAIN")
  fi
  if [ ! -f "$DIR/.env" ] || [ "${#env_updates[@]}" -gt 0 ]; then
    local _env_merged
    _env_merged="$(env_merge "$DIR/.env" ${env_updates[@]+"${env_updates[@]}"})"
    # umask 077 so creation is 0600 with no world-readable window; chmod fixes an
    # already-existing 0644 file (umask only applies at creation).
    ( umask 077; printf '%s\n' "$_env_merged" | write_file "$DIR/.env" )
    run chmod 600 "$DIR/.env"
    # Not a warning: with nothing asking for a key, having none yet is the
    # NORMAL state after an interactive install, and a yellow flag before the
    # pull would make every healthy install look defective. It is a next step,
    # so it is said once at the end — see the summary below.
    case "$_env_merged" in
      *EXEPAD_LLM_API_KEY=*) NEEDS_KEY=0 ;;
      *) NEEDS_KEY=1 ;;
    esac
  fi

  say ""
  say "Pulling $(image_ref) …"
  # --project-directory avoids a cd into a dir that --dry-run never created.
  run docker compose --project-directory "$DIR" -f "$DIR/docker-compose.yml" pull
  run docker compose --project-directory "$DIR" -f "$DIR/docker-compose.yml" up -d

  {
    printf '{\n'
    printf '  "image": "%s",\n' "$IMAGE_REPO"
    printf '  "tag": "%s",\n' "$VERSION"
    printf '  "launcher": "install.sh",\n'
    printf '  "hostPort": %s,\n' "$PORT"
    printf '  "engine": "docker",\n'
    [ -n "$DOMAIN" ] && printf '  "domain": "%s",\n' "$DOMAIN"
    printf '  "updatedAt": "%s"\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '}\n'
  } | write_file "$DIR/.exepad-version"

  # The seeded password has done its job the moment the account exists — it is
  # hashed into /data and seedAdminFromEnv no-ops from here on. Leaving the
  # plaintext in .env forever buys nothing, so confirm the account landed and
  # then take it back out. Only AFTER confirming: stripping a password whose
  # seed silently failed would strand the user with no account and no seed.
  if [ -n "$SEEDED_EMAIL" ] && [ "$DRY_RUN" -ne 1 ]; then
    say ""
    say "  Creating your operator account…"
    if wait_setup_complete "$PORT"; then
      _stripped="$(env_strip "$DIR/.env" EXEPAD_ADMIN_PASSWORD)"
      ( umask 077; printf '%s\n' "$_stripped" | write_file "$DIR/.env" )
      run chmod 600 "$DIR/.env"
      SEEDED_OK=1
    else
      warn "  Could not confirm the account was created within 90s."
      say  "  The password stays in .env so the next start can retry the seed."
      say  "  If the studio asks you to create an account, just create it there."
    fi
  fi

  say ""
  if [ -n "$DOMAIN" ]; then
    say "Exepad $VERSION is up → https://$DOMAIN"
    say "  HTTPS via Caddy (Let's Encrypt). Point $DOMAIN DNS at this host and open :80/:443."
  else
    say "Exepad $VERSION is up → http://localhost:$PORT"
    say "  Plain HTTP (no TLS) — also reachable from your LAN at http://<this-host>:$PORT."
    say "  For browser-trusted HTTPS on a real domain, re-run with --domain <your-domain>."
  fi
  say "  install dir: $DIR"
  # Point at the CLI rather than printing a raw tar: /data is WAL-mode SQLite, so
  # archiving it hot can yield a torn copy that only fails at restore time.
  # `exepad backup` stops the container first; the bare one-liner does not.
  say "  data volume: $DATA_VOLUME  (back up: npx exepad-app-builder backup — stops the container first for a consistent snapshot)"
  print_setup_token
  say ""
  if [ "$SEEDED_OK" -eq 1 ]; then
    say "  Log in as $SEEDED_EMAIL — your account is already created,"
    say "  and this instance can no longer be claimed by anyone else."
  elif [ "${OPEN_SETUP:-0}" -eq 1 ] && { [ -z "$ADMIN_EMAIL" ] || [ -z "$ADMIN_PASSWORD" ]; }; then
    # Worth one line: the account is unclaimed until they fill the form, and on
    # a reachable host someone else could fill it first.
    say "  Next: open it and create your operator account — do this now, while"
    say "  nobody else can reach the port first."
  fi
  if [ "${NEEDS_KEY:-0}" -eq 1 ]; then
    say "  Then add your AI provider key in the studio — Settings → AI provider."
    say "  Builds need it; everything else works without it."
  fi
}

# ----- first-run setup token ----------------------------------------------------
# The container prints the token to STDERR once at boot, but every install path
# starts it DETACHED — so the banner goes straight to the logs and nobody sees
# it. The user then meets a setup screen demanding a token nothing has shown
# them, and the only way out was `docker logs … | grep`, which a one-click bundle
# user on macOS or Windows has no reason to know. The npm launcher already does
# this (printSetupToken in packages/exepad-cli); this is the same thing for every
# Node-less path — most server installs, ALL of the one-click bundles and the
# MSI, and now also any Node install where the npm launcher was unreachable.
#
# Best-effort by design: it must never fail an otherwise successful install.
print_setup_token() {
  [ "$DRY_RUN" -eq 1 ] && return 0
  # Seeded admin ⇒ setup is closed and no token is ever minted. Skip rather than
  # spend the retry budget waiting for a banner that will not appear.
  [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ] && return 0
  # Same reasoning for open setup: no token is minted. This function still earns
  # its keep for an operator who set EXEPAD_ALLOW_OPEN_SETUP=0 to put it back.
  [ "${OPEN_SETUP:-0}" -eq 1 ] && return 0
  # A confirmed seed closed setup, so any token in the logs is inert.
  [ "${SEEDED_OK:-0}" -eq 1 ] && return 0

  local logs token tries=0
  while [ "$tries" -lt 8 ]; do
    tries=$((tries + 1))
    logs="$(docker logs "$CONTAINER_NAME" 2>&1 || true)"
    # Tokenless setup was explicitly allowed — nothing to print.
    case "$logs" in *EXEPAD_ALLOW_OPEN_SETUP*) return 0;; esac
    # Anchor on the banner before matching, so an unrelated 64-hex string
    # elsewhere in the logs can never be presented as the setup token.
    #
    # The trailing `|| true` is load-bearing: this script runs under `set -euo
    # pipefail`, and on the first iteration of a COLD start the logs are still
    # empty, so grep exits 1, pipefail promotes that to the pipeline's status,
    # and the assignment would abort the whole install — precisely on the
    # first-run path this function exists to serve.
    token="$(printf '%s\n' "$logs" \
      | sed -n '/FIRST-RUN SETUP TOKEN/,$p' \
      | grep -Eo '[0-9a-f]{64}' | head -1 || true)"
    [ -n "$token" ] && break
    sleep 1
  done
  [ -n "$token" ] || return 0

  say ""
  say "  Setup token: $token"
  say "  Enter it on the first screen to create your operator account."
}

main() {
  preflight
  maybe_delegate_to_npx   # exits if it delegates
  embedded_install
}

main
