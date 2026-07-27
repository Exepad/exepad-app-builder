#!/usr/bin/env bash
#
# Self-hosted Exepad container entrypoint.
#
#   1. Bootstrap (and persist) per-instance secrets under /data/secrets.
#   2. Start the in-image Caddy (default): it terminates TLS on :80 + the studio /
#      apps HTTPS ports and reverse-proxies to the runtime on 127.0.0.1:8080.
#      EXEPAD_HTTPS_DISABLE=1 skips it — e.g. behind your own TLS proxy, or when
#      the deployment publishes :8080 itself.
#   3. Start the Python agent on the internal loopback port (8081).
#   4. Start the Node runtime on :8080 — plain HTTP for Caddy to proxy. Should the
#      image ever lack the caddy binary, the runtime instead terminates TLS itself,
#      serving a per-instance self-signed cert it auto-mints into /data/certs on
#      first boot (server/self-signed-cert.ts).
#
# Caddy is the public listener in the default configuration; the runtime is the
# only HTTP application process and reverse-proxies /agent/* to the agent. If any
# supervised process exits, the container exits so the orchestrator
# (Docker/Compose restart policy) can recycle it.
#
set -euo pipefail

DATA_DIR="${EXEPAD_DATA_DIR:-/data}"
SECRETS_DIR="$DATA_DIR/secrets"
SECRETS_FILE="$SECRETS_DIR/env.sh"

mkdir -p "$DATA_DIR" "$SECRETS_DIR" "$DATA_DIR/agent"

gen() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

# Load any previously-persisted secrets (lowest precedence). An explicit `-e`
# override on `docker run` always wins because it is already in the environment.
# shellcheck disable=SC1090
[ -f "$SECRETS_FILE" ] && . "$SECRETS_FILE"

# For each managed secret: keep an existing value (env override or persisted),
# otherwise generate one. NEVER regenerate an existing secret — rotating
# EXEPAD_SESSION_SECRET would invalidate every live session + preview token.
: "${EXEPAD_SESSION_SECRET:=$(gen)}"
: "${DEPLOY_SECRET:=$(gen)}"
: "${USER_WORKER_SERVICE_TOKEN:=$(gen)}"
: "${PLATFORM_INTERNAL_SECRET:=$(gen)}"
: "${EXEPAD_SETUP_TOKEN:=$(gen)}"
# Shared secret the worker stamps on every /agent/* proxy request (header
# X-Exepad-Internal-Secret) and the Python agent verifies. Exported to BOTH the
# worker and the agent child processes below so the agent can fail closed on
# unauthenticated callers without breaking the legitimate in-container build path.
: "${EXEPAD_AGENT_INTERNAL_SECRET:=$(gen)}"
export EXEPAD_SESSION_SECRET DEPLOY_SECRET USER_WORKER_SERVICE_TOKEN PLATFORM_INTERNAL_SECRET EXEPAD_SETUP_TOKEN EXEPAD_AGENT_INTERNAL_SECRET

# The SPA session cookie + app preview tokens are signed with this; alias it to
# the session secret so it is stable across restarts.
export PLATFORM_BRIDGE_SECRET="${PLATFORM_BRIDGE_SECRET:-$EXEPAD_SESSION_SECRET}"

# Re-persist (idempotent) so the next restart reuses identical values.
umask 077
cat > "$SECRETS_FILE" <<EOF
export EXEPAD_SESSION_SECRET='$EXEPAD_SESSION_SECRET'
export DEPLOY_SECRET='$DEPLOY_SECRET'
export USER_WORKER_SERVICE_TOKEN='$USER_WORKER_SERVICE_TOKEN'
export PLATFORM_INTERNAL_SECRET='$PLATFORM_INTERNAL_SECRET'
export EXEPAD_SETUP_TOKEN='$EXEPAD_SETUP_TOKEN'
export EXEPAD_AGENT_INTERNAL_SECRET='$EXEPAD_AGENT_INTERNAL_SECRET'
EOF

# First-run setup hardening. Until an operator account exists, /auth/setup
# creates the first admin — and on a network-reachable instance whoever hits it
# first would win. So setup requires the token below (printed once here). Seed
# the admin non-interactively with EXEPAD_ADMIN_EMAIL + EXEPAD_ADMIN_PASSWORD to
# skip the browser flow, or set EXEPAD_ALLOW_OPEN_SETUP=1 to allow tokenless
# setup on a purely local instance. (Once an admin exists, /auth/setup is closed
# and this token is inert.)
if [ -n "${EXEPAD_ADMIN_EMAIL:-}" ] && [ -n "${EXEPAD_ADMIN_PASSWORD:-}" ]; then
  : # admin seeded from env — setup is closed, no token prompt needed
else
  case "${EXEPAD_ALLOW_OPEN_SETUP:-}" in
    1|true|TRUE|yes|YES|on|ON)
      echo "[exepad] WARNING: EXEPAD_ALLOW_OPEN_SETUP is set — first-run setup is OPEN (no token). Do NOT expose this instance to untrusted networks until you have completed setup." >&2
      ;;
    *)
      echo "[exepad] ============================================================" >&2
      echo "[exepad]  FIRST-RUN SETUP TOKEN (enter it on the setup screen to" >&2
      echo "[exepad]  create your operator account):" >&2
      echo "[exepad]      ${EXEPAD_SETUP_TOKEN}" >&2
      echo "[exepad]  (Seed the admin non-interactively instead with" >&2
      echo "[exepad]   EXEPAD_ADMIN_EMAIL + EXEPAD_ADMIN_PASSWORD.)" >&2
      echo "[exepad] ============================================================" >&2
      ;;
  esac
fi

# Wiring + defaults (all overridable via -e).
export ENVIRONMENT="${ENVIRONMENT:-selfhost}"
export EXEPAD_DATA_DIR="$DATA_DIR"
export EXEPAD_CLIENT_DIST="${EXEPAD_CLIENT_DIST:-/app/client/dist}"
export EXEPAD_AGENT_URL="${EXEPAD_AGENT_URL:-http://127.0.0.1:${AGENT_PORT:-8081}}"
export PORT="${PORT:-8080}"

if [ -z "${EXEPAD_LLM_API_KEY:-}" ] && [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "[exepad] WARNING: no EXEPAD_LLM_API_KEY / GEMINI_API_KEY set — agent builds will fail until an LLM key is provided." >&2
fi

# The agent's build pipeline shells out to these standalone binaries (baked into
# the image by the Dockerfile). If an image somehow lacks them, builds would fail
# at compile time — surface it loudly at boot rather than mid-build. The CSS gate
# now hard-fails without tailwindcss (no more silently shipping unstyled apps).
for bin in tailwindcss esbuild; do
  command -v "$bin" >/dev/null 2>&1 \
    || echo "[exepad] WARNING: '$bin' not found on PATH — agent CSS/TSX compile will fail. (Expected baked into the image.)" >&2
done

# Dashboard thumbnails need the Chromium bundle baked at PLAYWRIGHT_BROWSERS_PATH.
# The "server-lite" image variant (built with EXEPAD_LITE=1) omits it (~1 GB
# smaller), so force the maintenance cron's screenshots OFF when no browser is
# present — otherwise every cron tick would spawn a child that crashes on launch.
# Detection over the dir (not a build flag) also heals any image that lost the
# bundle. Thumbnails are a nicety; everything else is unaffected.
_pw_browsers="${PLAYWRIGHT_BROWSERS_PATH:-/app/pw-browsers}"
if [ ! -d "$_pw_browsers" ] || [ -z "$(ls -A "$_pw_browsers" 2>/dev/null)" ]; then
  export EXEPAD_THUMBNAILS_ENABLED=0
  echo "[exepad] note: no Chromium bundle in this image (server-lite) — dashboard thumbnails disabled." >&2
fi

# cloudflared is OPTIONAL — only the one-click "Share live URL" feature needs it,
# spawned on demand by the Node server. Its absence is NOT a build defect, so keep
# this a soft note separate from the hard compile-gate loop above.
command -v cloudflared >/dev/null 2>&1 \
  || echo "[exepad] note: 'cloudflared' not on PATH — the one-click 'Share live URL' feature is unavailable; all other functionality is unaffected." >&2

# openssl mints the built-in HTTPS cert. Absent → the runtime degrades to
# HTTP-only (it logs this); a soft note here, since the image bakes openssl in.
command -v openssl >/dev/null 2>&1 \
  || echo "[exepad] note: 'openssl' not on PATH — built-in HTTPS can't self-sign a cert; the runtime will serve plain HTTP. (Expected baked into the image.)" >&2

# --- Caddy (in-image TLS terminator) ---
# Built-in HTTPS with zero extra packages/sidecars: Caddy terminates TLS on 80/443
# and reverse-proxies to the Node runtime on 127.0.0.1:8080 (browser-trusted
# Let's Encrypt for this box's <ip>.sslip.io / verified domains; internal CA for
# localhost/LAN — see /etc/caddy/Caddyfile). When Caddy fronts TLS the Node
# process serves plain HTTP and must NOT also self-sign in-process, so we mark the
# runtime as proxy-fronted (it then issues Secure cookies off Caddy's
# X-Forwarded-Proto). Set EXEPAD_HTTPS_DISABLE=1 to skip Caddy entirely and serve
# plain HTTP on 8080 (e.g. behind your own TLS proxy).
# Detect the public IP (unless the operator pinned EXEPAD_PUBLIC_IP) + derive the
# sslip hostname, so Caddy can funnel bare-IP visitors to the browser-trusted
# <dashed-ip>.sslip.io host (a bare IP can't get a trusted cert). Best-effort:
# the NIC inside a container is usually a private bridge address, so ask an
# outbound echo; a failure just leaves the IP->sslip redirect an inert no-op.
# This makes up to three outbound calls to third-party IP-echo services on every
# boot. Set EXEPAD_DISABLE_IP_ECHO=1 (or EXEPAD_NO_OUTBOUND=1) to skip it — e.g.
# in air-gapped/egress-restricted deployments, or when you pin EXEPAD_PUBLIC_IP.
_ip_echo_disabled=0
case "${EXEPAD_DISABLE_IP_ECHO:-}${EXEPAD_NO_OUTBOUND:-}" in
  *1*|*true*|*TRUE*|*yes*|*YES*|*on*|*ON*) _ip_echo_disabled=1 ;;
esac
if [ -z "${EXEPAD_PUBLIC_IP:-}" ] && [ "$_ip_echo_disabled" = "0" ]; then
  for echo_url in https://api.ipify.org https://checkip.amazonaws.com https://icanhazip.com; do
    _ip="$(curl -fsS --max-time 4 "$echo_url" 2>/dev/null | tr -d '[:space:]' || true)"
    case "$_ip" in *.*.*.*) EXEPAD_PUBLIC_IP="$_ip"; break ;; esac
  done
fi
export EXEPAD_PUBLIC_IP
if printf '%s' "${EXEPAD_PUBLIC_IP:-}" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
  export EXEPAD_SSLIP_HOST="$(printf '%s' "$EXEPAD_PUBLIC_IP" | tr '.' '-').sslip.io"
  echo "[exepad] public IP ${EXEPAD_PUBLIC_IP} -> trusted host https://${EXEPAD_SSLIP_HOST}" >&2
fi

# Caddy's data (ACME certs + the internal CA that signs localhost/LAN) lives on
# the mounted /data volume (see the Caddyfile `storage` block) so the internal CA
# root is STABLE across container recreates — trust it once, stay trusted.
export EXEPAD_CADDY_DATA="${EXEPAD_CADDY_DATA:-$DATA_DIR/caddy}"

# A container CANNOT install a CA into the host's browser trust store (that's a
# host-side action). Public boxes don't need it — Caddy auto-gets a browser-trusted
# Let's Encrypt cert for this box's <ip>.sslip.io / verified domains. For a purely
# LOCAL/LAN box the one irreducible step is trusting Caddy's internal CA on your
# machine, so we export that root to a predictable path on the mounted volume and
# print the one-liner. Runs in the background: the internal CA is minted lazily on
# the first localhost/LAN HTTPS request, so we warm one up, then export the root.
export_local_ca() {
  local root="$EXEPAD_CADDY_DATA/pki/authorities/local/root.crt"
  local dest="$DATA_DIR/exepad-local-ca.crt"
  local i
  for i in $(seq 1 30); do
    # Warm-up: force Caddy to mint its internal CA now (loopback is always
    # authorized by the ask endpoint) so the root exists without a real visitor.
    # Retried each poll — Caddy may not be listening the instant this job starts.
    # Hit the STUDIO port (localhost is a studio host); it defaults to 443 but the
    # operator may have moved it, so never assume the implicit :443.
    [ -f "$root" ] || curl -ksS --max-time 5 -H 'Host: localhost' "https://127.0.0.1:${EXEPAD_STUDIO_PORT:-443}/" >/dev/null 2>&1 || true
    if [ -f "$root" ]; then
      cp -f "$root" "$dest" 2>/dev/null || true
      echo "[exepad] local CA exported → <your data volume>/exepad-local-ca.crt" >&2
      echo "[exepad] Public box? Nothing to do — open https://${EXEPAD_SSLIP_HOST:-<ip>.sslip.io} (already browser-trusted)." >&2
      echo "[exepad] LAN/localhost only? For a green padlock in your BROWSER (Chrome uses" >&2
      echo "[exepad]   its own NSS store, so update-ca-certificates alone isn't enough) run" >&2
      echo "[exepad]   on the HOST:  ./run.sh trust   (installs this CA into your browser +" >&2
      echo "[exepad]   system trust; ./run.sh already does it automatically)." >&2
      return 0
    fi
    sleep 2
  done
}

# Resolve the studio's public front ports from the settings store so the "Server &
# network" UI can MOVE them with no docker-compose / .env edit — the in-image Caddy
# (host networking) binds whatever is saved, and a change applies on the next restart.
#
# TWO independent ports (mirrors net-config.ts effectiveAppsPort/effectiveStudioPort):
#   - APPS port   (net.apps_port)   — every published app subdomain (default 443 →
#                                     clean per-app URLs). Legacy net.https_port (which
#                                     used to move the whole front) seeds it so existing
#                                     installs keep their port after upgrade.
#   - STUDIO port (net.studio_port) — the admin studio; defaults to the apps port (one
#                                     unified listener), set distinct to split it out.
# Precedence per key: store > env seed > default; browser-blocked ports are ignored
# (auto-heal). The HTTP :80 listener stays fixed (ACME HTTP-01 is only served on :80).
_stored_port() {
  # $1 = settings key. Echoes the stored value iff it's a browser-usable port.
  local key="$1"
  local db="${EXEPAD_META_DB:-$DATA_DIR/meta.sqlite}"
  [ -f "$db" ] || return 0
  node -e '
    try {
      const p = require.resolve("better-sqlite3", { paths: ["/app/node_modules"] });
      const db = new (require(p))(process.argv[1], { readonly: true, fileMustExist: true });
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(process.argv[2]);
      const n = row && row.value != null ? Number(String(row.value).trim()) : NaN;
      const UNSAFE = new Set([1,7,9,11,13,15,17,19,20,21,22,23,25,37,42,43,53,69,77,79,87,95,101,102,103,104,109,110,111,113,115,117,119,123,135,137,139,143,161,179,389,427,465,512,513,514,515,526,530,531,532,540,548,554,556,563,587,601,636,989,990,993,995,1719,1720,1723,2049,3659,4045,5060,5061,6000,6566,6665,6666,6667,6668,6669,6697,10080]);
      if (Number.isInteger(n) && n >= 1 && n <= 65535 && !UNSAFE.has(n)) process.stdout.write(String(n));
    } catch (_) { /* no DB / no key → empty, caller uses the default */ }
  ' "$db" "$key" 2>/dev/null
}
# Validate a RESOLVED front port: echo it iff it's a browser-usable TCP port that does
# not collide with a FIXED in-container listener — :80 (the baked ACME + HTTP→HTTPS
# block; a second :80 site block makes Caddy refuse the whole config), the Node runtime
# ($PORT, default 8080), or the agent ($AGENT_PORT, default 8081). Otherwise echo the
# fallback ($2). This heals a bad ENV-seeded port the same way _stored_port heals a bad
# stored one, so Caddy never tries to bind an out-of-range / browser-blocked / duplicate
# / reserved port and crash-loop the container (with no in-UI path to recover).
_safe_port() {
  node -e '
    const n = Number(String(process.argv[1] || "").trim());
    const reserved = new Set([80, Number(process.argv[3]) || 8080, Number(process.argv[4]) || 8081]);
    const UNSAFE = new Set([1,7,9,11,13,15,17,19,20,21,22,23,25,37,42,43,53,69,77,79,87,95,101,102,103,104,109,110,111,113,115,117,119,123,135,137,139,143,161,179,389,427,465,512,513,514,515,526,530,531,532,540,548,554,556,563,587,601,636,989,990,993,995,1719,1720,1723,2049,3659,4045,5060,5061,6000,6566,6665,6666,6667,6668,6669,6697,10080]);
    const ok = Number.isInteger(n) && n >= 1 && n <= 65535 && !UNSAFE.has(n) && !reserved.has(n);
    process.stdout.write(ok ? String(n) : String(process.argv[2]));
  ' "$1" "$2" "${PORT:-8080}" "${AGENT_PORT:-8081}" 2>/dev/null || printf '%s' "$2"
}
# Echo a raw settings value (any key) from meta.sqlite, or nothing if absent.
_stored_setting() {
  local key="$1"
  local db="${EXEPAD_META_DB:-$DATA_DIR/meta.sqlite}"
  [ -f "$db" ] || return 0
  node -e '
    try {
      const p = require.resolve("better-sqlite3", { paths: ["/app/node_modules"] });
      const db = new (require(p))(process.argv[1], { readonly: true, fileMustExist: true });
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(process.argv[2]);
      if (row && row.value != null) process.stdout.write(String(row.value));
    } catch (_) { /* no DB / no key → empty */ }
  ' "$db" "$key" 2>/dev/null
}
# APPS front port: net.apps_port → legacy net.https_port → env seed → 443, then sanitized.
_apps_port="$(_stored_port net.apps_port)"
[ -n "$_apps_port" ] || _apps_port="$(_stored_port net.https_port)"
export EXEPAD_APPS_PORT="$(_safe_port "${_apps_port:-${EXEPAD_APPS_PORT:-${EXEPAD_HTTPS_PORT:-443}}}" 443)"
# STUDIO front port: net.studio_port → env seed → the apps port (unified default), sanitized.
# A bad/reserved studio port falls back to the apps port → one unified listener.
_studio_port="$(_stored_port net.studio_port)"
export EXEPAD_STUDIO_PORT="$(_safe_port "${_studio_port:-${EXEPAD_STUDIO_PORT:-$EXEPAD_APPS_PORT}}" "$EXEPAD_APPS_PORT")"
# Back-compat: EXEPAD_HTTPS_PORT keeps meaning "the public/apps front port" — the
# runtime's /api/network readout and run.sh's redirect logic still read it.
export EXEPAD_HTTPS_PORT="$EXEPAD_APPS_PORT"

# Direct-IP access toggle (net.allow_ip_access). OFF (default): a bare-IP visitor is
# bounced to this box's browser-trusted <dashed-ip>.sslip.io host (the @bare_ip matcher
# in the Caddyfile is the real public IP). ON: serve the studio on the raw IP directly —
# needed on a LAN / air-gapped box where <ip>.sslip.io can't resolve — by pointing the
# matcher at a sentinel that never matches any Host, so the redirect never fires (the
# on-demand-TLS ask already authorizes this box's own public IP → Caddy's internal-CA
# cert, i.e. a one-time browser warning). EXEPAD_ALLOW_IP_ACCESS is exported so the
# /api/network readout can show the running state + flag a pending restart.
_allow_ip="$(_stored_setting net.allow_ip_access)"
[ -n "$_allow_ip" ] || _allow_ip="${EXEPAD_ALLOW_IP_ACCESS:-}"
case "$_allow_ip" in
  1|true|TRUE|yes|YES|on|ON)
    export EXEPAD_ALLOW_IP_ACCESS=1
    export EXEPAD_SSLIP_REDIRECT_IP="0.0.0.0" # matches nothing → no sslip redirect
    ;;
  *)
    export EXEPAD_ALLOW_IP_ACCESS=""
    export EXEPAD_SSLIP_REDIRECT_IP="${EXEPAD_PUBLIC_IP:-0.0.0.0}"
    ;;
esac
# Where the entrypoint writes the generated Caddy HTTPS listener block(s). /etc/caddy
# is root-owned (read-only at runtime), so use the writable data volume; the baked
# Caddyfile imports this path.
export EXEPAD_CADDY_SITES="${EXEPAD_CADDY_SITES:-$DATA_DIR/caddy-sites.caddy}"
# acme.sh state for the trusted bare-IP cert: the HTTP-01 webroot Caddy's :80 serves,
# and where the installed cert lands for Caddy's <ip> block (both on the /data volume).
export EXEPAD_ACME_WEBROOT="${EXEPAD_ACME_WEBROOT:-$DATA_DIR/acme/webroot}"
export EXEPAD_IP_CERT_DIR="${EXEPAD_IP_CERT_DIR:-$DATA_DIR/acme/ip}"

# Obtain + maintain a browser-TRUSTED Let's Encrypt certificate for the bare PUBLIC IP so
# "direct IP access" can serve the raw IP with no warning. Caddy can't request IP certs
# itself yet (caddyserver/caddy#7399), so acme.sh does it: Let's Encrypt's 6-day
# "shortlived" profile with an IP identifier, validated over HTTP-01 through Caddy's :80
# webroot (Caddy owns the ports, so standalone/tls-alpn can't bind). On success it installs
# the cert and reload-regenerates the Caddy sites file (adding the trusted <ip> block); a
# --cron loop renews it (LE caps IP certs at ~6.6 days, so --days 3 + a 6h poll keeps it
# fresh). Best-effort: any failure just leaves the IP on Caddy's internal CA (the existing
# one-time warning) and the trusted <ip>.sslip.io link still works. State lives on /data
# (--config-home/--cert-home); the acme.sh install itself is the read-only image copy.
_ip_cert_daemon() {
  local ip="$EXEPAD_PUBLIC_IP"
  local acme="acme.sh --home /usr/local/lib/acme.sh --config-home $DATA_DIR/acme --cert-home $DATA_DIR/acme/certs"
  mkdir -p "$EXEPAD_ACME_WEBROOT/.well-known/acme-challenge" "$EXEPAD_IP_CERT_DIR" "$DATA_DIR/acme/certs" 2>/dev/null || true
  # Give Caddy a moment to bind :80 so the HTTP-01 webroot is reachable.
  sleep 8
  if [ ! -s "$EXEPAD_IP_CERT_DIR/fullchain.pem" ]; then
    if $acme --issue -d "$ip" --webroot "$EXEPAD_ACME_WEBROOT" --server letsencrypt \
         --certificate-profile shortlived --days 3 --keylength ec-256 >&2; then
      if $acme --install-cert -d "$ip" --ecc \
           --fullchain-file "$EXEPAD_IP_CERT_DIR/fullchain.pem" \
           --key-file "$EXEPAD_IP_CERT_DIR/key.pem" \
           --reloadcmd "exepad-caddy-sites --reload" >&2; then
        exepad-caddy-sites --reload
        echo "[exepad] trusted Let's Encrypt cert obtained for ${ip} — direct IP access is now browser-trusted." >&2
      fi
    else
      echo "[exepad] note: couldn't obtain a public cert for ${ip} (is port 80 reachable from the internet?). The raw IP stays on the internal-CA cert (one-time warning); the trusted ${EXEPAD_SSLIP_HOST:-<ip>.sslip.io} link still works." >&2
    fi
  fi
  # Renewal loop: acme.sh --cron re-issues certs inside their --days window and runs the
  # stored reloadcmd (regenerate sites + graceful caddy reload). 6h is well inside 6.6 days.
  while true; do
    sleep 21600
    $acme --cron >&2 2>&1 || true
  done
}

CADDY_PID=""
case "${EXEPAD_HTTPS_DISABLE:-0}" in
  1|true|TRUE|yes|YES|on|ON)
    echo "[exepad] EXEPAD_HTTPS_DISABLE set — serving plain HTTP on :${PORT}; front your own TLS proxy." >&2
    ;;
  *)
    if command -v caddy >/dev/null 2>&1; then
      export EXEPAD_TLS_FRONTED=1
      # NOTE: proxy-fronted means server/main.ts binds the plain-HTTP :8080 listener
      # on ALL interfaces by default (it narrows to 127.0.0.1 on its own only when it
      # terminates TLS in-process). On a bridge network that port stays inside the
      # container unless published. Under `network_mode: host` it would land on the
      # HOST's interfaces in cleartext beside Caddy's TLS front — so the host-networked
      # compose files set EXEPAD_HTTP_BIND=127.0.0.1. Caddy proxies to 127.0.0.1:8080,
      # so loopback is all it needs.
      # The in-image Caddy is OURS — it binds EXEPAD_HTTPS_PORT (from the settings
      # store) directly on the host under host networking. Flag it so the runtime
      # marks the Server & network port EDITABLE and a UI change actually moves the
      # served port on restart. An operator's OWN external proxy never sets this, so
      # its port stays read-only in the UI (their proxy owns it).
      export EXEPAD_MANAGED_TLS=1
      export EXEPAD_COOKIE_SECURE="${EXEPAD_COOKIE_SECURE:-1}"
      # Generate the HTTPS listener block(s) the baked Caddyfile imports: a `:PORT` on-demand
      # catch-all per distinct front port, plus a trusted `<ip>:PORT` block if acme.sh already
      # has a bare-IP cert on the /data volume (from a previous run). Shared with acme.sh's
      # reloadcmd so a freshly-issued cert regenerates the same file. Written to the writable
      # data volume (/etc/caddy is read-only for the non-root runtime user).
      exepad-caddy-sites
      ( exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile ) &
      CADDY_PID=$!
      if [ "${EXEPAD_STUDIO_PORT}" != "${EXEPAD_APPS_PORT}" ]; then
        echo "[exepad] HTTPS via in-image Caddy on :80 -> apps :${EXEPAD_APPS_PORT}, studio :${EXEPAD_STUDIO_PORT} -> runtime :${PORT}." >&2
      else
        echo "[exepad] HTTPS via in-image Caddy on :80/:${EXEPAD_APPS_PORT} -> runtime :${PORT}." >&2
      fi
      export_local_ca &
      # Trusted bare-IP cert: only when direct IP access is on, a public IP is known, and
      # outbound isn't disabled (ACME needs to reach Let's Encrypt). Best-effort background job.
      if [ -n "${EXEPAD_ALLOW_IP_ACCESS:-}" ] && [ -n "${EXEPAD_PUBLIC_IP:-}" ] && command -v acme.sh >/dev/null 2>&1; then
        case "${EXEPAD_NO_OUTBOUND:-}" in
          1|true|TRUE|yes|YES|on|ON) : ;; # egress-restricted → skip ACME
          *) _ip_cert_daemon & ;;
        esac
      fi
    else
      echo "[exepad] WARNING: caddy not found in image — falling back to the Node in-process TLS listener." >&2
    fi
    ;;
esac

# --- Python agent (internal loopback) ---
(
  cd /app/agent
  exec python -m uvicorn agent_api:app --host 127.0.0.1 --port "${AGENT_PORT:-8081}"
) &
AGENT_PID=$!

# --- Node runtime (behind Caddy on 8080) ---
(
  cd /app
  exec node server.mjs
) &
NODE_PID=$!

terminate() {
  kill -TERM "$AGENT_PID" "$NODE_PID" ${CADDY_PID:+$CADDY_PID} 2>/dev/null || true
}
trap terminate TERM INT

# Exit as soon as any supervised process dies (Docker's restart policy recycles).
# `|| STATUS=$?` is REQUIRED: under `set -e` a non-zero return from `wait -n` (a
# TERM-killed child on `docker stop` returns 143) would abort PID 1 immediately,
# skipping the graceful teardown below so the kernel SIGKILLs the children before
# the Node server can drain + TRUNCATE-checkpoint the SQLite WALs. Guard it so the
# `terminate`-then-`wait` drain window always runs (mirrors run.sh:398).
STATUS=0
wait -n "$AGENT_PID" "$NODE_PID" ${CADDY_PID:+$CADDY_PID} || STATUS=$?
echo "[exepad] a child process exited (status $STATUS) — shutting down." >&2
terminate
wait 2>/dev/null || true
exit "$STATUS"
