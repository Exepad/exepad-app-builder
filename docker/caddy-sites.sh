#!/usr/bin/env bash
#
# Generate the Caddy HTTPS listener block(s) that the baked Caddyfile imports, and
# (with --reload) gracefully reload Caddy. Called by docker/entrypoint.sh at boot and
# by acme.sh's --reloadcmd after it issues/renews the trusted bare-IP certificate.
#
# Emits into $EXEPAD_CADDY_SITES:
#   :<appsPort>   { import https_front }          # on-demand catch-all (apps)
#   :<studioPort> { import https_front }          # on-demand catch-all (studio, if != apps)
#   <ip>:<port>   { tls <cert> <key>; import https_body }
#       one per distinct front port, ONLY when "direct IP access" is on AND acme.sh has a
#       trusted Let's Encrypt cert for the box's public IP — so the raw IP is served
#       browser-trusted. Without the cert (or IP access off) the IP just falls through to
#       the on-demand catch-all (Caddy internal CA → one-time warning), degrading cleanly.
set -eu

SITES="${EXEPAD_CADDY_SITES:-/data/caddy-sites.caddy}"
APPS="${EXEPAD_APPS_PORT:-443}"
STUDIO="${EXEPAD_STUDIO_PORT:-$APPS}"
IP="${EXEPAD_PUBLIC_IP:-}"
CERT_DIR="${EXEPAD_IP_CERT_DIR:-${EXEPAD_DATA_DIR:-/data}/acme/ip}"

_ip_cert_ready() {
  [ -n "${EXEPAD_ALLOW_IP_ACCESS:-}" ] && [ -n "$IP" ] \
    && [ -s "$CERT_DIR/fullchain.pem" ] && [ -s "$CERT_DIR/key.pem" ]
}

# The IP block covers each DISTINCT front port so the raw IP is trusted on whichever it's
# reached; the runtime then canonically redirects it to its home port over the trusted cert.
_ip_block() {
  printf '%s:%s {\n\ttls %s %s\n\timport https_body\n}\n' "$IP" "$1" "$CERT_DIR/fullchain.pem" "$CERT_DIR/key.pem"
}

{
  printf ':%s {\n\timport https_front\n}\n' "$APPS"
  [ "$STUDIO" != "$APPS" ] && printf ':%s {\n\timport https_front\n}\n' "$STUDIO"
  if _ip_cert_ready; then
    _ip_block "$APPS"
    [ "$STUDIO" != "$APPS" ] && _ip_block "$STUDIO"
  fi
} > "$SITES"

if [ "${1:-}" = "--reload" ]; then
  caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile 2>/dev/null \
    || echo "[exepad] caddy reload failed — the IP cert applies on the next restart." >&2
fi
