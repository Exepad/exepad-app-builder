#!/usr/bin/env bash
# exepad install.sh — single-command installer for the self-hosted Exepad studio.
#
#   curl -fsSL https://get.exepad.com | bash
#   curl -fsSL https://get.exepad.com | bash -s -- --version 0.3.0 --llm-key sk-...
#
# This is the Node-less front door for Linux servers AND macOS (it is also the
# script inside the one-click bundles — see packaging/one-click/). On public
# releases with Node >=18 present it delegates to the canonical
# `npx exepad up` (single source of truth); otherwise it runs an
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
# on dev/private builds `npx exepad` would 404 (or worse, execute a
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
      say "  Prefer Podman? Use the runtime-neutral CLI instead:  npx exepad up"
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

  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 plugin is required (got legacy/none)."
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
maybe_delegate_to_npx() {
  # Public releases only: the npm launcher is not published for dev/private
  # builds, so delegation would 404 — or run a name-squatted package.
  [ "$EXEPAD_RELEASE_CHANNEL" = "public" ] || return 0
  [ "$NO_NODE" -eq 1 ] && return 0
  command -v node >/dev/null 2>&1 || return 0
  local major
  major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  [ "${major:-0}" -ge 18 ] || return 0

  say "Node $(node -v) detected — delegating to the canonical CLI (npx exepad)…"
  set -- exepad up --to "$VERSION" --dir "$DIR" --port "$PORT" --yes
  [ -n "$LLM_KEY" ] && set -- "$@" --llm-key "$LLM_KEY"
  [ -n "$ADMIN_EMAIL" ] && set -- "$@" --admin-email "$ADMIN_EMAIL"
  [ -n "$ADMIN_PASSWORD" ] && set -- "$@" --admin-password "$ADMIN_PASSWORD"
  [ -n "$DOMAIN" ] && set -- "$@" --domain "$DOMAIN"
  [ -n "$ACME_EMAIL" ] && set -- "$@" --acme-email "$ACME_EMAIL"
  [ "$FORCE" -eq 1 ] && set -- "$@" --force
  [ "$DRY_RUN" -eq 1 ] && set -- "$@" --dry-run
  local pkgspec="exepad"
  is_semver "$VERSION" && pkgspec="exepad@$VERSION"
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

  # One-click UX: offer to take the LLM key up front (TTY only; Enter skips —
  # it can always be added later in the studio's Settings). Mirrors install.ps1.
  if [ -z "$LLM_KEY" ] && [ "$ASSUME_YES" -ne 1 ] && [ "$DRY_RUN" -ne 1 ] \
     && ! grep -q '^EXEPAD_LLM_API_KEY=' "$DIR/.env" 2>/dev/null \
     && { : > /dev/tty; } 2>/dev/null; then
    printf '%s' "[exepad] LLM API key (EXEPAD_LLM_API_KEY) — press Enter to set it later in Settings: " > /dev/tty
    # -s: don't echo the secret (the one-click wrappers keep the window open).
    read -rs LLM_KEY < /dev/tty || true
    printf '\n' > /dev/tty
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
    case "$_env_merged" in
      *EXEPAD_LLM_API_KEY=*) : ;;
      *) [ -z "$LLM_KEY" ] && warn "No LLM key set — builds fail until you add EXEPAD_LLM_API_KEY (edit .env or /settings)." ;;
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
  say "  data volume: $DATA_VOLUME  (back up: docker run --rm -v $DATA_VOLUME:/data:ro -v \"\$PWD\":/b alpine tar czf /b/exepad.tgz -C /data .)"
}

main() {
  preflight
  maybe_delegate_to_npx   # exits if it delegates
  embedded_install
}

main
