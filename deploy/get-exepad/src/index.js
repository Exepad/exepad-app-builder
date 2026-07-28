/**
 * get.exepad.com — the installer front door.
 *
 *   /                  302 → releases/latest/download/install.sh   (curl … | bash)
 *   /install.ps1       302 → releases/latest/download/install.ps1  (irm … | iex)
 *   /install.sh        302 → the same install.sh, for people who guess the path
 *   /<asset>.sha256    302 → the matching checksum asset
 *
 * Everything resolves through `releases/latest`, which always points at the
 * newest NON-PRERELEASE release — so this is deployed once and never touched
 * per release. It also means every path here 404s until a stable tag exists;
 * `releases/latest` deliberately skips prereleases.
 *
 * 302 and not 301: the target moves with every release, and a 301 would be
 * cached by browsers and proxies against a URL that is meant to change.
 */
const BASE = 'https://github.com/Exepad/exepad-app-builder/releases/latest/download';

const ASSETS = new Set([
  'install.sh',
  'install.ps1',
  'install.sh.sha256',
  'install.ps1.sha256',
]);

export default {
  fetch(request) {
    const { pathname } = new URL(request.url);
    const name = pathname.replace(/^\/+/, '').replace(/\/+$/, '');

    // Bare host, or anything unrecognised, is the shell installer — that is what
    // `curl -fsSL https://get.exepad.com | bash` asks for, and a 404 there would
    // be a worse failure than serving the thing they almost certainly wanted.
    const target = ASSETS.has(name) ? `${BASE}/${name}` : `${BASE}/install.sh`;

    return new Response(null, {
      status: 302,
      headers: {
        Location: target,
        // This URL's meaning changes at every release; never let it be cached.
        'Cache-Control': 'no-store',
      },
    });
  },
};
