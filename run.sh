#!/usr/bin/env bash
#
# Exepad — one command to run the whole rig.
#
#   ./run.sh            Build + run the single self-hosted container (docker compose)
#   ./run.sh local      Run the full stack from source (no docker): Node runtime + Python agent
#   ./run.sh trust      Install a local CA so this host's browsers trust the HTTPS cert
#   ./run.sh stop       Stop the docker container
#   ./run.sh --help
#
# You get the builder at https://localhost (both container and local serve HTTPS on
# :443 by default; local also keeps plain HTTP on :8090 so it can coexist with a
# Docker run of Exepad, which serves :8080). Put your LLM key in a .env file
# next to this script first:
#
#   echo "EXEPAD_LLM_API_KEY=your-key-here" > .env
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# ── pretty output ────────────────────────────────────────────────────────────
if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; D=$'\033[2m'; N=$'\033[0m'; else B= G= Y= R= D= N=; fi
say()  { printf '%s\n' "${B}[exepad]${N} $*"; }
ok()   { printf '%s\n' "${G}[exepad]${N} $*"; }
warn() { printf '%s\n' "${Y}[exepad]${N} $*" >&2; }
die()  { printf '%s\n' "${R}[exepad] $*${N}" >&2; exit 1; }

# ── load .env (LLM key etc.) ─────────────────────────────────────────────────
if [ -f "$ROOT/.env" ]; then
  set -a; . "$ROOT/.env"; set +a
fi

usage() {
  sed -n '3,17p' "$ROOT/run.sh" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

# ── shared: generate + persist per-instance secrets ──────────────────────────
# Mirrors docker/entrypoint.sh so the local and container runs behave the same:
# secrets are generated once and reused forever (rotating EXEPAD_SESSION_SECRET
# would invalidate every live session + preview token).
bootstrap_secrets() {
  local data_dir="$1" secrets_file
  secrets_file="$data_dir/secrets/env.sh"
  mkdir -p "$data_dir"/{secrets,apps,storage,buckets,uploads,agent}

  local gen='head -c 32 /dev/urandom | od -An -tx1 | tr -d " \n"'
  # shellcheck disable=SC1090
  [ -f "$secrets_file" ] && . "$secrets_file"

  : "${EXEPAD_SESSION_SECRET:=$(eval "$gen")}"
  : "${DEPLOY_SECRET:=$(eval "$gen")}"
  : "${USER_WORKER_SERVICE_TOKEN:=$(eval "$gen")}"
  : "${PLATFORM_INTERNAL_SECRET:=$(eval "$gen")}"
  # First-run setup token (see print_setup_token). Persisted like every other
  # secret — regenerating it per restart would lock out a half-finished setup.
  : "${EXEPAD_SETUP_TOKEN:=$(eval "$gen")}"
  # Shared secret for the worker→agent /agent/* proxy (worker stamps
  # X-Exepad-Internal-Secret, agent verifies). Without it the agent fails closed
  # and the local build UI would reject every /r request.
  : "${EXEPAD_AGENT_INTERNAL_SECRET:=$(eval "$gen")}"
  export EXEPAD_SESSION_SECRET DEPLOY_SECRET USER_WORKER_SERVICE_TOKEN PLATFORM_INTERNAL_SECRET EXEPAD_SETUP_TOKEN EXEPAD_AGENT_INTERNAL_SECRET
  export PLATFORM_BRIDGE_SECRET="${PLATFORM_BRIDGE_SECRET:-$EXEPAD_SESSION_SECRET}"

  ( umask 077; cat > "$secrets_file" <<EOF
export EXEPAD_SESSION_SECRET='$EXEPAD_SESSION_SECRET'
export DEPLOY_SECRET='$DEPLOY_SECRET'
export USER_WORKER_SERVICE_TOKEN='$USER_WORKER_SERVICE_TOKEN'
export PLATFORM_INTERNAL_SECRET='$PLATFORM_INTERNAL_SECRET'
export EXEPAD_SETUP_TOKEN='$EXEPAD_SETUP_TOKEN'
export EXEPAD_AGENT_INTERNAL_SECRET='$EXEPAD_AGENT_INTERNAL_SECRET'
EOF
  )
}

# ── shared: first-run setup token (mirrors docker/entrypoint.sh) ─────────────
# Until an operator account exists, /auth/setup creates the first admin — and the
# runtime binds every interface, so on a LAN whoever hits it first would win. So
# setup requires the token bootstrap_secrets minted (printed here). Seed the admin
# non-interactively with EXEPAD_ADMIN_EMAIL + EXEPAD_ADMIN_PASSWORD to skip the
# browser flow, or set EXEPAD_ALLOW_OPEN_SETUP=1 to allow tokenless setup on a
# purely local box. (Once an admin exists, /auth/setup is closed and it is inert.)
print_setup_token() {
  if [ -n "${EXEPAD_ADMIN_EMAIL:-}" ] && [ -n "${EXEPAD_ADMIN_PASSWORD:-}" ]; then
    return 0 # admin seeded from env — setup is closed, no token needed
  fi
  case "${EXEPAD_ALLOW_OPEN_SETUP:-}" in
    1|true|TRUE|yes|YES|on|ON)
      warn "EXEPAD_ALLOW_OPEN_SETUP is set — first-run setup is OPEN (no token). Do NOT expose this instance to untrusted networks until you have completed setup."
      return 0
      ;;
  esac
  say "first-run setup token → ${B}${EXEPAD_SETUP_TOKEN:-}${N}  ${D}(enter it on the setup screen to create your operator account)${N}"
}

warn_if_no_llm_key() {
  if [ -z "${EXEPAD_LLM_API_KEY:-}" ] && [ -z "${GEMINI_API_KEY:-}" ]; then
    warn "No EXEPAD_LLM_API_KEY / GEMINI_API_KEY set — login works, but app builds will fail until you add one to .env"
  fi
}

# ── shared: reap stale servers holding our ports ─────────────────────────────
# A previous `./run.sh local` that was SIGKILLed — or whose parent shell died
# before the EXIT trap fired — can leave the Node runtime (:8090) and/or the
# uvicorn agent (:8081) bound, so the next start dies with EADDRINUSE. These
# helpers find and stop whatever is LISTENing on our exact ports.

# Echo the PID(s) LISTENing on a TCP port (empty if none). Uses whichever of
# lsof / fuser / ss is present (lsof covers both Linux and macOS).
listeners_on_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
  elif command -v fuser >/dev/null 2>&1; then
    fuser "$port"/tcp 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$' || true
  elif command -v ss >/dev/null 2>&1; then
    ss -ltnH "( sport = :$port )" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true
  fi
}

# True if the PID looks like one of OUR processes (Node runtime / uvicorn agent).
# Best-effort identity guard so `free_stale_ports` never SIGKILLs an unrelated
# service that merely happens to hold one of our ports. Only verifiable via Linux
# /proc; elsewhere (macOS) we can't introspect, so assume ours to preserve the
# prior reap behavior.
pid_is_ours() {
  local pid="$1" cmd
  [ -r "/proc/$pid/cmdline" ] || return 0
  cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)"
  case "$cmd" in
    *server.mjs*|*uvicorn*|*agent_api*|*"node "*|*/node) return 0 ;;
    *) return 1 ;;
  esac
}

# Echo only the LISTENer PIDs on a port that look like OURS (see pid_is_ours).
our_listeners_on_port() {
  local port="$1" pid ours=""
  for pid in $(listeners_on_port "$port"); do
    if pid_is_ours "$pid"; then ours="$ours $pid"; fi
  done
  echo $ours | tr -s ' ' '\n' | grep -E '^[0-9]+$' || true
}

# SIGTERM (then SIGKILL) our own stale Node/agent processes LISTENing on the given
# ports. Never touches a foreign listener that merely shares a port number; if one
# is squatting our port we warn and let the real bind fail (rather than SIGKILL an
# innocent process). Dies only if OUR straggler genuinely can't be reaped.
free_stale_ports() {
  local port pids _
  for port in "$@"; do
    [ -n "$(listeners_on_port "$port")" ] || continue
    pids="$(our_listeners_on_port "$port")"
    if [ -z "$pids" ]; then
      warn "port $port is held by a non-exepad process — leaving it alone (the bind may fail)."
      continue
    fi
    # shellcheck disable=SC2086
    warn "port $port in use by pid(s) $(echo $pids) — stopping stale process …"
    # shellcheck disable=SC2086
    kill -TERM $pids 2>/dev/null || true
    for _ in {1..15}; do
      [ -n "$(our_listeners_on_port "$port")" ] || break
      sleep 0.2
    done
    pids="$(our_listeners_on_port "$port")"
    if [ -n "$pids" ]; then
      # shellcheck disable=SC2086
      kill -KILL $pids 2>/dev/null || true
      sleep 0.3
    fi
    [ -z "$(our_listeners_on_port "$port")" ] || die "port $port is still in use by an exepad process — stop it and retry."
    ok "freed stale port $port"
  done
}

# ── shared: read an operator-saved setting from meta.sqlite ───────────────────
# The Settings UI persists runtime knobs (e.g. the studio port, net.http_port /
# net.https_port) into meta.sqlite's `settings` store, and those OVERRIDE the
# process env at boot (see apps/runtime/worker/src/lib/net-config.ts). run.sh sets
# up the URL it prints, the HTTP→HTTPS redirect port, the CORS allowlist and the
# privileged-port capability BEFORE the runtime boots, so it must consult the SAME
# saved value or it would disagree with what the runtime actually binds. Reads are
# best-effort: a missing/locked DB or absent key yields empty (the caller falls
# back to its env/default), and we never fail the launch over it.
stored_setting() {
  local key="$1" db="${EXEPAD_META_DB:-${EXEPAD_DATA_DIR:-$ROOT/.exepad-data}/meta.sqlite}"
  [ -f "$db" ] || return 0
  node -e '
    try {
      const path = require.resolve("better-sqlite3", { paths: [process.argv[3]] });
      const db = new (require(path))(process.argv[1], { readonly: true, fileMustExist: true });
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(process.argv[2]);
      if (row && row.value != null && String(row.value).length) process.stdout.write(String(row.value));
    } catch (_) { /* no DB / no table / no key → empty, caller uses its default */ }
  ' "$db" "$key" "$ROOT/apps/runtime/worker/node_modules" 2>/dev/null
}

# Like stored_setting, but returns a saved PORT only if the runtime could actually
# serve a browser on it: an integer in 1–65535 that browsers don't block (6000=X11,
# 22=SSH, …). A saved value that fails this is IGNORED (empty output + a warning) so
# run.sh falls back to its default exactly as the runtime's effectivePort() does —
# keeping the printed URL / redirect / cap in lock-step and never launching behind an
# unreachable port. Mirrors BROWSER_UNSAFE_PORTS in net-config.ts.
stored_port() {
  local key="$1" raw ok; raw="$(stored_setting "$key")"
  [ -n "$raw" ] || return 0
  ok="$(node -e '
    const n = Number(String(process.argv[1]).trim());
    const UNSAFE = new Set([1,7,9,11,13,15,17,19,20,21,22,23,25,37,42,43,53,69,77,79,87,95,101,102,103,104,109,110,111,113,115,117,119,123,135,137,139,143,161,179,389,427,465,512,513,514,515,526,530,531,532,540,548,554,556,563,587,601,636,989,990,993,995,1719,1720,1723,2049,3659,4045,5060,5061,6000,6566,6665,6666,6667,6668,6669,6697,10080]);
    if (Number.isInteger(n) && n >= 1 && n <= 65535 && !UNSAFE.has(n)) process.stdout.write(String(n));
  ' "$raw" 2>/dev/null)"
  if [ -n "$ok" ]; then
    printf '%s' "$ok"
  else
    warn "ignoring saved port '$raw' ($key) — out of range or blocked by browsers (e.g. 6000=X11). Using the default; change it in Settings → Server & network."
  fi
}

# ── shared: ensure the standalone build binaries the agent shells out to ──────
# The agent's validation pipeline runs `tailwindcss` (CSS compile) and `esbuild`
# (TSX syntax). The container bakes these in; run-from-source needs them on the
# PATH (cmd_local puts node_modules/.bin first). esbuild arrives via pnpm, but
# the standalone tailwindcss binary + the tw-animate-css package do not — so
# fetch them once. Without tailwindcss the agent now FAILS the CSS compile gate
# loudly (it used to silently ship raw, unstyled theme.css). Versions mirror the
# Dockerfile.
TAILWIND_VERSION="v4.1.18"
TW_ANIMATE_VERSION="1.4.0"
ensure_build_binaries() {
  local bindir="$ROOT/node_modules/.bin"
  mkdir -p "$bindir"

  if ! command -v tailwindcss >/dev/null 2>&1 && [ ! -x "$bindir/tailwindcss" ]; then
    local os arch
    case "$(uname -s)" in
      Linux)  os=linux ;;
      Darwin) os=macos ;;
      *) die "tailwindcss not found and auto-install unsupported on $(uname -s). Install tailwindcss $TAILWIND_VERSION onto your PATH." ;;
    esac
    case "$(uname -m)" in
      x86_64|amd64)  arch=x64 ;;
      arm64|aarch64) arch=arm64 ;;
      *) die "tailwindcss not found and auto-install unsupported on arch $(uname -m). Install tailwindcss $TAILWIND_VERSION onto your PATH." ;;
    esac
    local asset="tailwindcss-${os}-${arch}"
    say "installing standalone tailwindcss $TAILWIND_VERSION ($asset) → node_modules/.bin …"
    command -v curl >/dev/null 2>&1 || die "curl is required to fetch the tailwindcss binary."
    curl -fsSL -o "$bindir/tailwindcss" \
      "https://github.com/tailwindlabs/tailwindcss/releases/download/${TAILWIND_VERSION}/${asset}" \
      || die "failed to download tailwindcss ($asset). Without it the agent fails the CSS compile gate. Install it manually onto PATH."
    chmod +x "$bindir/tailwindcss"
    ok "tailwindcss installed"
  fi

  if [ ! -d "$ROOT/node_modules/tw-animate-css" ]; then
    say "installing tw-animate-css $TW_ANIMATE_VERSION (so @import \"tw-animate-css\" resolves) …"
    command -v curl >/dev/null 2>&1 || die "curl is required to fetch tw-animate-css."
    mkdir -p "$ROOT/node_modules/tw-animate-css"
    curl -fsSL "https://registry.npmjs.org/tw-animate-css/-/tw-animate-css-${TW_ANIMATE_VERSION}.tgz" \
      | tar xz --strip-components=1 -C "$ROOT/node_modules/tw-animate-css" \
      || die "failed to download tw-animate-css (the Tailwind compile needs it to resolve @import \"tw-animate-css\")."
  fi

  # cloudflared powers the OPTIONAL "Share a secure link" quick tunnel (works
  # behind NAT with no port forwarding). Best-effort: the feature degrades to an
  # install hint if this is absent, so never `die` here. Linux only auto-fetches
  # (a raw binary); on macOS install with `brew install cloudflared`.
  if ! command -v cloudflared >/dev/null 2>&1 && [ ! -x "$bindir/cloudflared" ]; then
    local cfarch=""
    if [ "$(uname -s)" = "Linux" ]; then
      case "$(uname -m)" in
        x86_64|amd64)  cfarch=amd64 ;;
        arm64|aarch64) cfarch=arm64 ;;
      esac
    fi
    if [ -n "$cfarch" ] && command -v curl >/dev/null 2>&1; then
      say "installing cloudflared (optional — powers the 'Share a secure link' tunnel) …"
      if curl -fsSL -o "$bindir/cloudflared" \
        "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${cfarch}"; then
        chmod +x "$bindir/cloudflared"
        ok "cloudflared installed"
      else
        rm -f "$bindir/cloudflared"
        warn "could not fetch cloudflared — the 'Share a secure link' option will show an install hint until it's on PATH."
      fi
    fi
  fi
}

# ── dashboard-thumbnail browser (maintenance cron) ───────────────────────────
# The maintenance cron screenshots each app's preview into a dashboard thumbnail
# via the worker's playwright-core (apps/runtime/worker/src/server/screenshot-worker.ts).
# playwright-core has NO postinstall browser download — the Dockerfile installs
# Chromium explicitly, but a from-source `./run.sh local` otherwise has none, so
# the cron logs "browserType.launch: Executable doesn't exist at
# .../chrome-headless-shell" and EVERY app card falls back to the placeholder
# icon. Install it via the worker's OWN playwright-core CLI so the browser
# revision always matches that exact version (a different Playwright's browser —
# e.g. one an IDE/MCP installed — is the wrong revision and won't satisfy the
# launch; that is the usual cause of the missing thumbnails). The install command
# validates the exact required revision and is a fast no-op when present (no
# network). Best-effort: thumbnails are non-essential, so a failure must NEVER
# block the rig. Skip when thumbnails or maintenance are disabled.
# <!-- added 2026-06-28: from-source rigs never installed the thumbnail browser -->
ensure_thumbnail_browser() {
  case "${EXEPAD_THUMBNAILS_ENABLED:-1}" in 0|false|FALSE|no|NO|off|OFF) return 0 ;; esac
  case "${EXEPAD_MAINTENANCE_ENABLED:-1}" in 0|false|FALSE|no|NO|off|OFF) return 0 ;; esac
  local pw_cli="$ROOT/apps/runtime/worker/node_modules/playwright-core/cli.js"
  [ -f "$pw_cli" ] || { warn "playwright-core not found — dashboard thumbnails will show placeholder icons."; return 0; }
  say "ensuring Chromium for dashboard thumbnails (playwright-core; one-time download if missing) …"
  node "$pw_cli" install chromium \
    || warn "couldn't install Chromium for thumbnails — app cards will show placeholder icons (the cron logs \"Executable doesn't exist\"). Install manually: node apps/runtime/worker/node_modules/playwright-core/cli.js install chromium"
}

# ── docker mode (the shipped product) ────────────────────────────────────────
cmd_docker() {
  command -v docker >/dev/null 2>&1 || die "docker not found. Install Docker, or run from source: ./run.sh local"
  if ! docker info >/dev/null 2>&1; then
    die "can't talk to the Docker daemon (is it running? do you have permission?). To run without Docker: ./run.sh local"
  fi
  warn_if_no_llm_key
  local COMPOSE="docker compose"
  docker compose version >/dev/null 2>&1 || COMPOSE="docker-compose"
  say "building + starting the container …"
  # Build + start DETACHED so we can install the local CA into this host's trust
  # store before handing the terminal to the log stream. (`up -d` still streams the
  # build output; only the run is detached.)
  $COMPOSE up -d --build || die "container failed to start (see the output above)."
  # Green-padlock https://localhost: trust the container's persisted internal CA so
  # browsers stop showing NET::ERR_CERT_AUTHORITY_INVALID. Idempotent + best-effort
  # (browser NSS needs no sudo; the system store prompts once, then never again).
  bash "$ROOT/scripts/trust-caddy-ca.sh" || true
  ok "rig up → ${B}https://localhost${N}  ${D}(also http://127.0.0.1:8080 · Ctrl-C to stop)${N}"
  # Attach to the running container's logs; Ctrl-C stops it (same UX as before).
  exec $COMPOSE up
}

cmd_stop() {
  # Bring the container down (docker mode) — tolerate docker being absent so a
  # local-only user can still use `stop` to clean stale servers.
  if docker compose version >/dev/null 2>&1; then docker compose down || true
  elif command -v docker-compose >/dev/null 2>&1; then docker-compose down || true; fi
  # …then reap any stragglers a crashed `./run.sh local` left on our ports. Use the
  # SAME values cmd_local binds — including any operator-saved port override (so a
  # UI-changed port is still reaped) — plus the :8443 privileged-port fallback. NOT
  # :8080, so stop never touches an unrelated service there.
  local _http _https
  _http="$(stored_port net.http_port)"
  _https="$(stored_port net.https_port)"
  free_stale_ports \
    "${_http:-${PORT:-8090}}" \
    "${AGENT_PORT:-8081}" \
    "${_https:-${EXEPAD_HTTPS_PORT:-443}}" \
    8443
  ok "stopped."
}

# ── local mode (run from source, no docker) ──────────────────────────────────
cmd_local() {
  local data_dir="${EXEPAD_DATA_DIR:-$ROOT/.exepad-data}"
  export EXEPAD_DATA_DIR="$data_dir"
  export ENVIRONMENT="${ENVIRONMENT:-selfhost}"
  export EXEPAD_CLIENT_DIST="${EXEPAD_CLIENT_DIST:-$ROOT/apps/runtime/client/dist}"
  # Local default is :8090 (not :8080) so this rig coexists with a Docker run of
  # Exepad, which serves :8080. Precedence mirrors the
  # runtime's effectiveHttpPort(): an operator-saved override (Settings UI →
  # net.http_port) wins over a CLI PORT= wins over the :8090 default, so what we
  # print/redirect matches what the runtime binds.
  local _stored_http; _stored_http="$(stored_port net.http_port)"
  export PORT="${_stored_http:-${PORT:-8090}}"
  export AGENT_PORT="${AGENT_PORT:-8081}"
  export EXEPAD_AGENT_URL="${EXEPAD_AGENT_URL:-http://127.0.0.1:$AGENT_PORT}"
  # Agent-side diagnostic probes (Surveyor runtime probes, default-off) target the
  # runtime worker; pin it to OUR port so they don't hit :8080 (a Docker run) now
  # that the runtime moved off 8080.
  export EXEPAD_RUNTIME_BASE="${EXEPAD_RUNTIME_BASE:-http://127.0.0.1:$PORT}"
  # Standalone esbuild/tailwindcss the agent's validation pipeline shells out to.
  export PATH="$ROOT/node_modules/.bin:$PATH"

  # HTTPS by default (zero-config): the runtime serves TLS in-process and
  # auto-mints a per-instance self-signed cert into the data dir on first boot
  # (apps/runtime/worker/src/server/self-signed-cert.ts) — no mkcert, no sudo, no
  # reverse proxy, IN ADDITION to http on $PORT. Opt out with
  # EXEPAD_HTTPS_DISABLE=1; choose the port with EXEPAD_HTTPS_PORT (binding 443
  # needs privilege). If you set up your OWN cert pair at ./certs (e.g. mkcert for
  # a browser-trusted LAN cert), it's used instead of the self-signed one.
  local https_url=""
  if [ "${EXEPAD_HTTPS_DISABLE:-0}" != "1" ]; then
    # Built-in browser-trusted HTTPS: on first launch this bootstraps a local CA
    # (mkcert) into this host's trust store and issues certs/{cert,key}.pem, so the
    # padlock is green with no warning — one sudo prompt the first time, then a
    # fast no-op. Degrades to the self-signed floor when non-interactive or offline.
    # Skip with EXEPAD_TRUST_HTTPS=0 to keep the plain self-signed cert.
    if [ "${EXEPAD_TRUST_HTTPS:-1}" != "0" ] && [ -f "$ROOT/scripts/ensure-trusted-https.sh" ]; then
      bash "$ROOT/scripts/ensure-trusted-https.sh" "$ROOT" || true
    fi
    if [ -f "$ROOT/certs/cert.pem" ] && [ -f "$ROOT/certs/key.pem" ]; then
      export EXEPAD_TLS_CERT_FILE="${EXEPAD_TLS_CERT_FILE:-$ROOT/certs/cert.pem}"
      export EXEPAD_TLS_KEY_FILE="${EXEPAD_TLS_KEY_FILE:-$ROOT/certs/key.pem}"
    fi
    # HTTPS on :443 by default so the studio URL is portless (https://localhost),
    # matching the container (Caddy fronts 443). Binding a privileged port (<1024)
    # needs cap_net_bind_service on the node binary; we grant it once (one sudo) and,
    # if that's not possible, transparently fall back to :8443. Override the port
    # with EXEPAD_HTTPS_PORT=… or from the Settings UI (net.https_port) — either an
    # explicit env value OR a saved override is "pinned" (never auto-demoted), and
    # the saved override wins so the URL/redirect/CORS below match what boots.
    local _https_port_pinned=0
    [ -n "${EXEPAD_HTTPS_PORT:-}" ] && _https_port_pinned=1
    local _stored_https; _stored_https="$(stored_port net.https_port)"
    if [ -n "$_stored_https" ]; then
      EXEPAD_HTTPS_PORT="$_stored_https"
      _https_port_pinned=1
    fi
    export EXEPAD_HTTPS_PORT="${EXEPAD_HTTPS_PORT:-443}"

    # Standard ports (<1024) can't be bound by node running as you. Grant the
    # capability once on the (real) node binary; if it can't be granted and we're on
    # the DEFAULT port, drop to :8443 so the runtime and the URL printed below agree.
    # An explicitly-pinned privileged port is left as-is (runtime still EACCES-falls
    # back to :8443, but we honor the operator's intent and just warn).
    if [ "$EXEPAD_HTTPS_PORT" -lt 1024 ]; then
      local _node_real; _node_real="$(asdf which node 2>/dev/null || command -v node)"
      # getcap/setcap usually live in /usr/sbin, which isn't on a normal user's PATH
      # — resolve absolute paths so the capability check + grant don't silently no-op.
      local _getcap _setcap
      _getcap="$(command -v getcap 2>/dev/null || for p in /usr/sbin/getcap /sbin/getcap; do [ -x "$p" ] && echo "$p" && break; done)"
      _setcap="$(command -v setcap 2>/dev/null || for p in /usr/sbin/setcap /sbin/setcap; do [ -x "$p" ] && echo "$p" && break; done)"
      if [ -n "$_node_real" ] && [ -n "$_getcap" ] && ! "$_getcap" "$_node_real" 2>/dev/null | grep -q cap_net_bind_service; then
        if [ -n "$_setcap" ] && { sudo -n true 2>/dev/null || [ -t 0 ]; }; then
          say "granting node the privileged-port bind capability (one-time sudo) for https on :$EXEPAD_HTTPS_PORT …"
          sudo "$_setcap" 'cap_net_bind_service=+ep' "$_node_real" 2>/dev/null || true
        fi
        if ! "$_getcap" "$_node_real" 2>/dev/null | grep -q cap_net_bind_service; then
          if [ "$_https_port_pinned" = "0" ]; then
            warn "couldn't grant node the privileged-port capability — serving https on :8443 instead of :$EXEPAD_HTTPS_PORT."
            warn "  for a portless https://localhost, grant it once: sudo setcap 'cap_net_bind_service=+ep' $_node_real"
            export EXEPAD_HTTPS_PORT=8443
          else
            warn "https port $EXEPAD_HTTPS_PORT is privileged and node lacks the bind capability — the runtime will fall back to :8443."
            warn "  grant it once: sudo setcap 'cap_net_bind_service=+ep' $_node_real"
          fi
        fi
      fi
    fi

    # Redirect plain-HTTP LAN visitors to HTTPS (loopback stays http for the
    # in-process cron/healthcheck — see index.ts). Targets the resolved TLS port.
    export EXEPAD_HTTPS_REDIRECT_PORT="${EXEPAD_HTTPS_REDIRECT_PORT:-$EXEPAD_HTTPS_PORT}"
    # TLS terminates in-process (no X-Forwarded-Proto to infer from) -> force
    # Secure cookies so the platform-session/preview cookies are issued correctly.
    export EXEPAD_COOKIE_SECURE="${EXEPAD_COOKIE_SECURE:-1}"

    # A portless URL when on :443, else an explicit :port suffix.
    local _port_suffix=":$EXEPAD_HTTPS_PORT"
    [ "$EXEPAD_HTTPS_PORT" = "443" ] && _port_suffix=""

    # Belt-and-suspenders CORS allowlist for the https origins (the SPA is
    # same-origin, so this only matters for any future cross-origin caller).
    local _lan_ip _host_name
    _lan_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    _host_name="$(hostname 2>/dev/null)"
    if [ -z "${EXEPAD_ALLOWED_ORIGINS:-}" ]; then
      local _origins="https://localhost$_port_suffix"
      [ -n "$_lan_ip" ] && _origins="$_origins,https://$_lan_ip$_port_suffix"
      [ -n "$_host_name" ] && _origins="$_origins,https://$_host_name.local$_port_suffix"
      export EXEPAD_ALLOWED_ORIGINS="$_origins"
    fi
    https_url="https://${_lan_ip:-localhost}$_port_suffix"
  fi

  # 1. Resolve Python (prefer the agent venv).
  local PY="$ROOT/apps/agent/.venv/bin/python"
  [ -x "$PY" ] || PY="$(command -v python3 || true)"
  [ -n "$PY" ] || die "python3 not found."
  if ! ( cd "$ROOT/apps/agent" && "$PY" -c 'import uvicorn' ) >/dev/null 2>&1; then
    die "agent Python deps missing. Set them up:
    cd apps/agent && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt"
  fi

  # 2. Node deps + build (turbo caches, so repeat runs are fast).
  command -v pnpm >/dev/null 2>&1 || die "pnpm not found (npm i -g pnpm@9)."
  [ -d "$ROOT/node_modules" ] || { say "installing workspace deps …"; pnpm install; }
  if [ "${SKIP_BUILD:-0}" != "1" ]; then
    # The browser SDK bundle (client/public/runtime_assets/dist/exepad-sdk*.js) is
    # what EVERY agent-generated component imports at runtime. turbo.json's
    # "@exepad/runtime-client#build" now depends on "@exepad/sdk#build", but that
    # edge only ORDERS the two tasks — it does not force the emitting build: the
    # SDK's vite build writes the bundle OUTSIDE the package's turbo-tracked
    # dist/** outputs, so a turbo cache HIT restores nothing there and the
    # runtime build proceeds with whatever (if anything) is on disk. On a fresh
    # clone (or after a clean) that leaves the served dist without
    # exepad-sdk.js → the static server returns index.html
    # for that path → "Expected a JavaScript module but server responded with
    # MIME type text/html" → every component fails (module_eval_failed) and the
    # page shows "This section isn't available right now." Build the SDK FIRST so
    # the runtime-client build copies it (public → dist) + the re-sync below keeps
    # it fresh. Force a real build when the bundle is absent, since a cache hit
    # would skip the vite step that emits it.
    # Completeness check: the entry monolith exepad-sdk.js STATICALLY imports a hashed
    # ./index-*.js (which dynamic-imports the icon chunks), and the six split chunks
    # (core/charts/motion/forms/overlays/icons) back the @exepad/sdk/* subpaths that
    # components import. If ANY are missing the bundle is dead, so a guard that keys only
    # on the entry file would take the cached (non-emitting) path and never repair a
    # partial dir. Force a real build whenever the public set is absent OR incomplete.
    local _sdk_pub="$ROOT/apps/runtime/client/public/runtime_assets/dist" _sdk_ok=1
    [ -f "$_sdk_pub/exepad-sdk.js" ] || _sdk_ok=0
    ls "$_sdk_pub"/index-*.js >/dev/null 2>&1 || _sdk_ok=0
    for _c in core charts motion forms overlays icons; do
      [ -f "$_sdk_pub/exepad-sdk-$_c.js" ] || _sdk_ok=0
    done
    if [ "$_sdk_ok" = "1" ]; then
      say "building browser SDK bundle (served to generated components) …"
      pnpm exec turbo run build --filter=@exepad/sdk \
        || die "browser SDK build failed — generated apps won't render without runtime_assets/dist/exepad-sdk.js"
    else
      say "browser SDK bundle missing/incomplete — building it (turbo --force; bundle lives outside tracked dist/ outputs) …"
      pnpm exec turbo run build --filter=@exepad/sdk --force \
        || die "browser SDK build failed — generated apps won't render without runtime_assets/dist/exepad-sdk.js"
    fi
    say "building runtime (SPA + bundled server) …"
    pnpm exec turbo run build --filter=@exepad/runtime-client --filter=@exepad/runtime-worker
    # The eject-built SDK (React-external) is vendored into the downloadable
    # "Buildable project" source export. It is NOT part of the default build, so
    # build it explicitly — without it that export ships SDK-less and won't build.
    say "building eject SDK (for the source export) …"
    pnpm --filter @exepad/sdk run build:eject || warn "build:eject failed — the 'Buildable project' export will ship without a vendored SDK."

    # Mirror the ENTIRE freshly-built SDK chunk set into the SERVED client dist — NOT
    # just the fixed-name bundles. runtime-client does not depend on @exepad/sdk, so on a
    # warm runtime-client cache its build CACHE-HITS and restores the OLD dist/**, never
    # re-copying what the SDK build just wrote to public. The monolith exepad-sdk.js
    # STATICALLY imports a HASHED ./index-<hash>.js (which dynamic-imports hashed icon
    # chunks); copying only exepad-sdk*.js (the prior behavior) would leave the new
    # monolith pointing at an index-<newhash>.js ABSENT from dist → the static server
    # returns index.html for it → "Expected a JavaScript module … MIME type text/html" →
    # SDK dead → every component fails. Copy the whole dir so the served set always
    # matches the freshly-built monolith (stale old-named chunks left behind are unused,
    # harmless).
    sdk_src="$ROOT/apps/runtime/client/public/runtime_assets/dist"
    sdk_dst="$EXEPAD_CLIENT_DIST/runtime_assets/dist"
    if [ -d "$sdk_src" ]; then
      mkdir -p "$sdk_dst"
      cp -rf "$sdk_src"/. "$sdk_dst"/
      say "synced browser SDK bundle (full chunk set) into served client dist"
    fi
  fi
  [ -f "$ROOT/apps/runtime/worker/dist/server.mjs" ] || die "server bundle missing — run without SKIP_BUILD=1."
  [ -f "$EXEPAD_CLIENT_DIST/index.html" ] || warn "client dist not found at $EXEPAD_CLIENT_DIST — SPA may 404."

  ensure_build_binaries
  ensure_thumbnail_browser
  bootstrap_secrets "$data_dir"
  warn_if_no_llm_key

  # Point the runtime at the fetched cloudflared (powers the "Share live URL"
  # quick tunnel) if one landed in node_modules/.bin. It's also on PATH via the
  # export above, but pinning the absolute path is robust to PATH ordering.
  if [ -z "${EXEPAD_CLOUDFLARED_BIN:-}" ] && [ -x "$ROOT/node_modules/.bin/cloudflared" ]; then
    export EXEPAD_CLOUDFLARED_BIN="$ROOT/node_modules/.bin/cloudflared"
  fi

  # 3. Reap any stale agent/runtime a previous crashed run left bound to our
  #    ports — otherwise the binds below die with EADDRINUSE.
  free_stale_ports "$AGENT_PORT" "$PORT" ${EXEPAD_HTTPS_PORT:+$EXEPAD_HTTPS_PORT}

  # 4. Start agent (internal) + runtime (public); tear both down together.
  say "starting agent on :$AGENT_PORT …"
  ( cd "$ROOT/apps/agent" && exec "$PY" -m uvicorn agent_api:app --host 127.0.0.1 --port "$AGENT_PORT" ) &
  local AGENT_PID=$!

  say "starting runtime on :$PORT …"
  ( cd "$ROOT" && exec node "$ROOT/apps/runtime/worker/dist/server.mjs" ) &
  local NODE_PID=$!

  # ``${VAR:-}`` guards: cleanup runs from both the TERM/INT and EXIT traps, and
  # the EXIT trap can fire after these ``local`` vars have left scope — under
  # ``set -u`` an unguarded reference then crashes with "AGENT_PID: unbound
  # variable" during an otherwise-clean shutdown.
  cleanup() { kill -TERM "${AGENT_PID:-}" "${NODE_PID:-}" 2>/dev/null || true; }
  trap cleanup INT TERM EXIT

  if [ -n "$https_url" ]; then
    ok "rig up → ${B}${https_url}${N}  ${D}(also http://localhost:$PORT · agent :$AGENT_PORT · data $data_dir · Ctrl-C to stop)${N}"
  else
    ok "rig up → ${B}http://localhost:$PORT${N}  ${D}(agent :$AGENT_PORT · data $data_dir · Ctrl-C to stop)${N}"
  fi
  print_setup_token
  wait -n "$AGENT_PID" "$NODE_PID" || true
  warn "a process exited — shutting the rig down."
  cleanup
  wait 2>/dev/null || true
}

case "${1:-docker}" in
  ""|docker)        cmd_docker ;;
  local|--local)    cmd_local ;;
  trust)
    # Container running? trust ITS internal CA (the docker path — browser NSS +
    # system store). Otherwise set up a browser-trusted cert for the from-source
    # (`./run.sh local`) path via mkcert.
    if command -v docker >/dev/null 2>&1 && docker ps --filter name=exepad --format '{{.Names}}' 2>/dev/null | grep -q .; then
      bash "$ROOT/scripts/trust-caddy-ca.sh"
    else
      bash "$ROOT/scripts/ensure-trusted-https.sh" "$ROOT"
    fi
    ;;
  stop|down)        cmd_stop ;;
  -h|--help|help)   usage 0 ;;
  *)                warn "unknown command: $1"; usage 1 ;;
esac
