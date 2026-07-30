#!/usr/bin/env bash
# trust-caddy-ca.sh — make https://localhost a GREEN PADLOCK in this host's
# browsers when running the container (`./run.sh`).
#
# In container mode the in-image Caddy terminates TLS with its own INTERNAL CA for
# localhost / LAN / bare-IP hosts — no public CA can ever sign those (PKI, not an
# Exepad gap). That CA is minted once and PERSISTED on the /data volume (see
# docker/Caddyfile `storage`), so it's stable across restarts. The one irreducible
# step is TRUSTING that CA on this machine — a host-side action a container can't
# do, but this host-native launcher can. This script installs the CA into:
#
#   • the browser NSS stores (Chrome/Chromium ~/.pki/nssdb + Firefox profiles) —
#     USER-LEVEL, no sudo. This is what stops NET::ERR_CERT_AUTHORITY_INVALID.
#   • the system store (/usr/local/share/ca-certificates + update-ca-certificates)
#     — best-effort sudo, so curl/openssl/other tools trust it too.
#
# Idempotent: re-runs are no-ops (it compares the installed CA to the live one and
# skips unchanged) so it can run on every `./run.sh` without re-prompting for sudo.
# Graceful: no certutil / no sudo / container not up yet → it degrades to the
# self-signed floor with a clear hint instead of failing the launch.
#
# Usage: trust-caddy-ca.sh [CONTAINER_NAME]
set -uo pipefail

CONTAINER="${1:-}"
CA_NICK="Exepad Local CA (Caddy)"
SYS_DEST="/usr/local/share/ca-certificates/exepad-local-ca.crt"
TMP_CA="$(mktemp)"; trap 'rm -f "$TMP_CA"' EXIT

log()  { printf '[exepad] %s\n' "$*" >&2; }
warn() { printf '[exepad] \033[33m%s\033[0m\n' "$*" >&2; }

# HTTPS off entirely → nothing to trust.
case "${EXEPAD_HTTPS_DISABLE:-0}" in 1|true|yes|on|TRUE|YES|ON) exit 0 ;; esac
# In-image Caddy off (operator fronts their own TLS) → not ours to trust.
case "${EXEPAD_TLS_FRONTED:-0}" in 1|true|yes|on|TRUE|YES|ON) exit 0 ;; esac

command -v docker >/dev/null 2>&1 || exit 0

# ── Locate the running container ────────────────────────────────────────────────
if [ -z "$CONTAINER" ]; then
  CONTAINER="$(docker ps --filter 'ancestor=exepad:latest' --format '{{.Names}}' 2>/dev/null | head -1)"
  [ -n "$CONTAINER" ] || CONTAINER="$(docker ps --filter 'name=exepad' --format '{{.Names}}' 2>/dev/null | head -1)"
fi
[ -n "$CONTAINER" ] || { warn "no running exepad container yet — skipping local-CA trust (run \`./run.sh trust\` once it's up)."; exit 0; }

# ── Read Caddy's internal-CA ROOT out of the container ──────────────────────────
# The entrypoint exports it to /data/exepad-local-ca.crt (minted lazily on the
# first HTTPS request; wait briefly). Fall back to the raw pki path.
for _ in $(seq 1 30); do
  if docker exec "$CONTAINER" cat /data/exepad-local-ca.crt > "$TMP_CA" 2>/dev/null && [ -s "$TMP_CA" ]; then break; fi
  docker exec "$CONTAINER" cat /data/caddy/pki/authorities/local/root.crt > "$TMP_CA" 2>/dev/null || true
  [ -s "$TMP_CA" ] && break
  sleep 1
done
[ -s "$TMP_CA" ] || { warn "couldn't read the container's local CA (Caddy may still be starting) — re-run \`./run.sh trust\`."; exit 0; }
# Sanity: is it actually a CA cert?
openssl x509 -in "$TMP_CA" -noout >/dev/null 2>&1 || { warn "the exported local CA looks malformed — skipping trust."; exit 0; }
FPR="$(openssl x509 -in "$TMP_CA" -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2)"

# ── certutil (libnss3-tools) drives browser (NSS) trust ─────────────────────────
if ! command -v certutil >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    log "installing libnss3-tools (certutil) so browsers trust the local CA …"
    sudo apt-get install -y libnss3-tools >/dev/null 2>&1 || warn "couldn't install libnss3-tools; browser trust may be skipped."
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y nss-tools >/dev/null 2>&1 || true
  elif command -v pacman >/dev/null 2>&1; then
    sudo pacman -S --noconfirm nss >/dev/null 2>&1 || true
  fi
fi

changed=""

# ── Browser trust: NSS DBs (user-level, NO sudo) ────────────────────────────────
nss_has_fpr() { # nss_has_fpr <db> — true if our nick is present with the SAME cert
  local db="$1" cur
  cur="$(certutil -L -d "$db" -n "$CA_NICK" -a 2>/dev/null \
        | openssl x509 -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2)"
  [ -n "$cur" ] && [ "$cur" = "$FPR" ]
}
add_to_nss() { # add_to_nss <db>
  local db="$1"
  command -v certutil >/dev/null 2>&1 || return 1
  nss_has_fpr "$db" && return 2          # already current → no-op
  certutil -D -d "$db" -n "$CA_NICK" >/dev/null 2>&1 || true
  certutil -A -d "$db" -n "$CA_NICK" -t "C,," -i "$TMP_CA" >/dev/null 2>&1
}

# Chrome / Chromium (+ Electron apps): the shared per-user NSS db.
CHROME_DB="$HOME/.pki/nssdb"
mkdir -p "$CHROME_DB"
if command -v certutil >/dev/null 2>&1 && [ ! -f "$CHROME_DB/cert9.db" ]; then
  certutil -N --empty-password -d "sql:$CHROME_DB" >/dev/null 2>&1 || true
fi
add_to_nss "sql:$CHROME_DB"; rc=$?
[ "$rc" = 0 ] && { changed=1; log "trusted the local CA for Chrome/Chromium (~/.pki/nssdb)."; }

# Firefox (each profile has its own NSS db; covers apt + snap installs).
for prof in "$HOME"/.mozilla/firefox/*/ "$HOME"/snap/firefox/common/.mozilla/firefox/*/; do
  [ -d "$prof" ] || continue
  { [ -f "$prof/cert9.db" ] || [ -f "$prof/cert8.db" ]; } || continue
  add_to_nss "sql:$prof"; rc=$?
  [ "$rc" = 0 ] && { changed=1; log "trusted the local CA for Firefox ($(basename "$prof"))."; }
done

# ── System store (curl / openssl / other tools) — best-effort sudo ──────────────
# Skip the sudo entirely when the installed file already matches the live CA, so
# re-runs never re-prompt.
if command -v update-ca-certificates >/dev/null 2>&1; then
  if [ -f "$SYS_DEST" ] && cmp -s "$TMP_CA" "$SYS_DEST"; then
    :   # already installed + current
  elif sudo -n true 2>/dev/null || [ -t 0 ]; then
    if sudo cp "$TMP_CA" "$SYS_DEST" 2>/dev/null && sudo update-ca-certificates >/dev/null 2>&1; then
      changed=1; log "trusted the local CA in the system store."
    else
      warn "couldn't update the system store (sudo) — browsers are still covered via NSS above."
    fi
  else
    warn "system-store trust skipped (no sudo); browsers are covered via NSS. For curl/CLI trust run: ./run.sh trust"
  fi
fi

if [ -n "$changed" ]; then
  log "✅ https://localhost is now trusted here (CA ${FPR:-?}). RESTART your browser to pick it up."
elif command -v certutil >/dev/null 2>&1; then
  log "https://localhost already trusted here — nothing to do."
else
  warn "couldn't establish browser trust (certutil missing). Install it (apt install libnss3-tools) and run: ./run.sh trust"
fi
