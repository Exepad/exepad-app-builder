#!/bin/bash
# Exepad one-click installer (macOS). Double-click me in Finder.
#
# Gatekeeper blocks the first launch of unsigned downloads ("Apple could not
# verify..."). One-time unblock:
#   macOS 15+:   double-click -> Done (not "Move to Trash") -> System Settings
#                -> Privacy & Security -> "Open Anyway" -> confirm.
#   macOS 13/14: right-click (Control-click) this file -> Open -> Open.
#
# I run the bundled install.sh, which detects your Docker runtime
# (Docker Desktop / OrbStack) and guides you through installing one if missing.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
echo
echo "  Exepad installer - progress appears below."
echo
if [ ! -f "$HERE/install.sh" ]; then
  echo "  install.sh was not found next to this file."
  echo "  Keep this file and install.sh together (extract the whole ZIP)."
  echo
  read -r -p "  Press Enter to close... " _ || true
  exit 1
fi
bash "$HERE/install.sh" "$@"
status=$?
echo
if [ "$status" -eq 0 ]; then
  # Only auto-open the default URL on a no-args run; with flags (--port,
  # --domain) the installer already printed the right URL.
  if [ $# -eq 0 ]; then
    echo "  Done. Opening http://localhost:8080 ..."
    open "http://localhost:8080" 2>/dev/null || true
  else
    echo "  Done. Open the URL printed above in your browser."
  fi
else
  echo "  The installer did not finish. Read the messages above, fix the issue"
  echo "  (usually: install or start Docker Desktop), then double-click this"
  echo "  file again."
fi
echo
read -r -p "  Press Enter to close this window... " _ || true
exit "$status"
