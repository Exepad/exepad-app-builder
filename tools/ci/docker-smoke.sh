#!/usr/bin/env bash
#
# Boot a built Exepad image with a throwaway data dir and assert the shipped
# product actually comes up. Run it by hand against a locally built (or pulled)
# image — no CI workflow invokes it today. Requires the image to already exist
# locally.
#
#   tools/ci/docker-smoke.sh <image-ref>
#
# Boots plain HTTP on :8080 (no Caddy/ACME, no outbound IP echo) with open setup
# so the smoke needs no secrets, no LLM key, and no network egress. Probes
# /auth/status (the first-run gate) and asserts it reports a fresh instance.
set -euo pipefail

IMAGE="${1:-exepad-smoke:ci}"
NAME="exepad-smoke-$$"
PORT="${SMOKE_PORT:-8080}"
DATA_DIR="$(mktemp -d)"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$DATA_DIR" || true
}
trap cleanup EXIT

echo "[smoke] booting $IMAGE (data dir: $DATA_DIR, port: $PORT)"
docker run -d --name "$NAME" \
  -p "127.0.0.1:${PORT}:8080" \
  -e EXEPAD_HTTPS_DISABLE=1 \
  -e EXEPAD_DISABLE_IP_ECHO=1 \
  -e EXEPAD_ALLOW_OPEN_SETUP=1 \
  -v "$DATA_DIR:/data" \
  "$IMAGE" >/dev/null

# Wait for the runtime to answer /auth/status (up to ~90s).
status_json=""
for i in $(seq 1 90); do
  if ! docker ps --format '{{.Names}}' | grep -q "^${NAME}$"; then
    echo "[smoke] FAIL: container exited during boot — logs:"; docker logs "$NAME" | tail -80
    exit 1
  fi
  status_json="$(curl -fsS "http://127.0.0.1:${PORT}/auth/status" 2>/dev/null || true)"
  if [ -n "$status_json" ]; then
    echo "[smoke] /auth/status responded after ${i}s: $status_json"
    break
  fi
  sleep 1
done

if [ -z "$status_json" ]; then
  echo "[smoke] FAIL: /auth/status never responded — logs:"; docker logs "$NAME" | tail -80
  exit 1
fi

# The first-run gate must report a fresh, un-claimed instance.
echo "$status_json" | grep -q '"needsSetup":true' || {
  echo "[smoke] FAIL: /auth/status did not report needsSetup=true: $status_json"
  docker logs "$NAME" | tail -80
  exit 1
}

# The SPA shell must also serve.
curl -fsS "http://127.0.0.1:${PORT}/" -o /dev/null || {
  echo "[smoke] FAIL: SPA root did not serve"; docker logs "$NAME" | tail -80; exit 1
}

echo "[smoke] OK — container boots and serves /auth/status + SPA root."
