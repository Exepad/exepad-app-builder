#!/usr/bin/env bash
# Assembles the one-click installer bundles from the CURRENT install.sh /
# install.ps1. The release workflow pins version + channel into those two
# files FIRST, then calls this; packaging-ci runs it unpinned as a rehearsal
# so bundle assembly can never drift from what the release job does.
#
#   packaging/one-click/build-bundles.sh [outdir]     (default: dist/installers)
#
# Produces, each with a .sha256 alongside:
#   Exepad-Installer-Windows.zip    install.ps1 + "Install Exepad.bat" + README.txt
#   Exepad-Installer-macOS.zip      install.sh + "Install Exepad.command" + README.txt
#   Exepad-Installer-Linux.tar.gz   install.sh + README.txt
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root

OUT="${1:-dist/installers}"
SRC="packaging/one-click"

rm -rf "$OUT"
mkdir -p "$OUT/win" "$OUT/mac" "$OUT/linux"

# Windows files are stored CRLF byte-for-byte (.gitattributes marks them -text).
cp install.ps1 "$SRC/windows/Install Exepad.bat" "$SRC/windows/README.txt" "$OUT/win/"
cp install.sh "$SRC/macos/Install Exepad.command" "$SRC/macos/README.txt" "$OUT/mac/"
cp install.sh "$SRC/linux/README.txt" "$OUT/linux/"
# Exec bits ride the zip's central directory; macOS Archive Utility restores them.
chmod +x "$OUT/mac/Install Exepad.command" "$OUT/mac/install.sh" "$OUT/linux/install.sh"

( cd "$OUT/win" && zip -q -X ../Exepad-Installer-Windows.zip -- * )
( cd "$OUT/mac" && zip -q -X ../Exepad-Installer-macOS.zip -- * )
tar -czf "$OUT/Exepad-Installer-Linux.tar.gz" -C "$OUT/linux" install.sh README.txt

(
  cd "$OUT"
  for a in Exepad-Installer-Windows.zip Exepad-Installer-macOS.zip Exepad-Installer-Linux.tar.gz; do
    # sha256sum on GNU/Linux (CI); shasum -a 256 on macOS/BSD (same output format).
    if command -v sha256sum >/dev/null 2>&1; then
      sha256sum "$a" > "$a.sha256"
    else
      shasum -a 256 "$a" > "$a.sha256"
    fi
  done
)

rm -rf "$OUT/win" "$OUT/mac" "$OUT/linux"
echo "one-click bundles:"
ls -l "$OUT"
