#!/usr/bin/env bash
# ensure-trusted-https.sh — make `run.sh` serve BROWSER-TRUSTED HTTPS out of the
# box, with zero manual steps beyond (at most) one sudo password prompt the very
# first time.
#
# The self-signed floor (server/self-signed-cert.ts) already gives ENCRYPTED
# HTTPS with no setup, but browsers show a one-time trust warning on localhost /
# LAN / bare-IP addresses — no public CA will ever sign those (PKI, not an Exepad
# gap). The only way to a green padlock there is to install a local CA into THIS
# host's trust store, which is a host-side action a container can't do but a
# host-native launcher (run.sh) can. This script does exactly that, via mkcert:
#
#   1. If a trusted cert pair already exists at ./certs → no-op (fast warm path).
#   2. Otherwise bootstrap mkcert (download the static binary if missing),
#      `mkcert -install` the local CA into the system + browser (NSS) trust store,
#      then issue a leaf cert for localhost + every local/public address into
#      ./certs/{cert,key}.pem — which run.sh auto-serves.
#
# Idempotent + safe: it never clobbers an operator-supplied cert (only pairs it
# generated, tagged with certs/.exepad-mkcert), and it degrades gracefully to the
# self-signed floor when it can't get sudo (non-interactive) or reach the network.
#
# Usage: ensure-trusted-https.sh [ROOT]   (ROOT defaults to $PWD)
set -euo pipefail

ROOT="${1:-$PWD}"
CERT_DIR="$ROOT/certs"
CERT="$CERT_DIR/cert.pem"
KEY="$CERT_DIR/key.pem"
TAG="$CERT_DIR/.exepad-mkcert"   # marks a pair WE minted (safe to regenerate)

log()  { printf '[exepad] %s\n' "$*" >&2; }
warn() { printf '[exepad] \033[33m%s\033[0m\n' "$*" >&2; }

# Honour the global opt-out — nothing to do if HTTPS is off entirely.
case "${EXEPAD_HTTPS_DISABLE:-0}" in 1|true|yes|on|TRUE|YES|ON) exit 0 ;; esac

mkdir -p "$CERT_DIR"

# ── 1. Already trusted? (warm path — instant no-op) ─────────────────────────────
# `openssl verify` builds a chain to the host's default trust store; success means
# the leaf's issuing CA is already installed here, i.e. the browser will trust it.
if [ -f "$CERT" ] && [ -f "$KEY" ]; then
  if openssl verify "$CERT" >/dev/null 2>&1; then
    exit 0
  fi
  # An untrusted pair that WE did not mint is an operator's own cert — respect it.
  if [ ! -f "$TAG" ]; then
    warn "certs/ holds a cert this host doesn't trust and that Exepad didn't mint — leaving it untouched."
    warn "  (install its CA on this machine for a green padlock, or remove certs/ to let Exepad auto-trust.)"
    exit 0
  fi
fi

# ── 2. Bootstrap requires interactivity (mkcert -install needs sudo once) ────────
# In a non-interactive/CI context we can't prompt for a password. Rather than hang,
# fall back to the self-signed floor — the runtime still serves ENCRYPTED HTTPS.
if ! sudo -n true 2>/dev/null && [ ! -t 0 ]; then
  warn "no TTY and no passwordless sudo — skipping local CA trust; serving the self-signed floor."
  warn "  run \`./run.sh trust\` (or this script) in an interactive shell once for a browser-trusted padlock."
  exit 0
fi

# ── 3. Locate or fetch mkcert (static binary → ~/.local/bin, no package manager) ─
MKCERT="$(command -v mkcert 2>/dev/null || true)"
[ -n "$MKCERT" ] || { [ -x "$HOME/.local/bin/mkcert" ] && MKCERT="$HOME/.local/bin/mkcert"; }
if [ -z "$MKCERT" ]; then
  case "$(uname -m)" in
    x86_64)        march=amd64 ;;
    aarch64|arm64) march=arm64 ;;
    *) warn "unsupported arch $(uname -m) for mkcert auto-install — serving the self-signed floor."; exit 0 ;;
  esac
  ver=v1.4.4
  url="https://github.com/FiloSottile/mkcert/releases/download/${ver}/mkcert-${ver}-linux-${march}"
  mkdir -p "$HOME/.local/bin"
  log "fetching mkcert (${ver}) for browser-trusted local HTTPS …"
  if ! curl -fsSL -o "$HOME/.local/bin/mkcert" "$url" 2>/dev/null; then
    warn "couldn't download mkcert (offline?) — serving the self-signed floor; re-run with network for a trusted cert."
    exit 0
  fi
  chmod +x "$HOME/.local/bin/mkcert"
  MKCERT="$HOME/.local/bin/mkcert"
fi

# ── 4. certutil (libnss3-tools) makes Chrome/Firefox (NSS) trust the CA too ──────
# Best-effort: without it mkcert still installs into the system store (curl/openssl
# trust it); the browser NSS store just won't be updated. Try the common package
# managers, but never fail the launch over it.
if ! command -v certutil >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    log "installing libnss3-tools (certutil) so browsers trust the local CA …"
    sudo apt-get install -y libnss3-tools >/dev/null 2>&1 || warn "couldn't install libnss3-tools — browser (NSS) trust may need it; system trust still applies."
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y nss-tools >/dev/null 2>&1 || warn "couldn't install nss-tools — browser (NSS) trust may need it."
  elif command -v pacman >/dev/null 2>&1; then
    sudo pacman -S --noconfirm nss >/dev/null 2>&1 || warn "couldn't install nss — browser (NSS) trust may need it."
  fi
fi

# ── 5. Install the local CA into this host's trust store (the one sudo step) ─────
log "installing the local development CA into this host's trust store (mkcert) …"
if ! "$MKCERT" -install >&2; then
  warn "mkcert -install failed — serving the self-signed floor (encrypted, one-time browser warning)."
  exit 0
fi

# ── 6. Issue the leaf cert for every address this box answers on ─────────────────
names=(localhost 127.0.0.1 ::1)
# Every configured interface address (LAN IPs, etc.).
if command -v hostname >/dev/null 2>&1; then
  for ip in $(hostname -I 2>/dev/null); do names+=("$ip"); done
fi
# The public IP / hostname the box advertises, when known (set by run.sh / entrypoint).
[ -n "${EXEPAD_PUBLIC_IP:-}" ]   && names+=("$EXEPAD_PUBLIC_IP")
[ -n "${EXEPAD_PUBLIC_HOST:-}" ] && names+=("$EXEPAD_PUBLIC_HOST")
# De-dupe while preserving order.
uniq_names=(); for n in "${names[@]}"; do
  skip=""; for u in "${uniq_names[@]:-}"; do [ "$u" = "$n" ] && { skip=1; break; }; done
  [ -z "$skip" ] && uniq_names+=("$n")
done

log "issuing a browser-trusted cert for: ${uniq_names[*]}"
if "$MKCERT" -cert-file "$CERT" -key-file "$KEY" "${uniq_names[@]}" >&2; then
  : > "$TAG"
  log "browser-trusted HTTPS ready → run.sh will serve certs/cert.pem (green padlock, no warning)."
else
  warn "mkcert failed to issue the leaf cert — serving the self-signed floor."
fi
