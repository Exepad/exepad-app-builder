#!/usr/bin/env node
/**
 * Fake `cloudflared` for tests, injected via EXEPAD_CLOUDFLARED_BIN.
 *
 * Mimics the real binary's observable contract: it is invoked as
 * `tunnel --no-autoupdate --url http://127.0.0.1:<port>`, prints a
 * `*.trycloudflare.com` URL banner to STDERR after a short delay (to exercise
 * the async-arrival path), then sleeps until SIGTERM/SIGINT.
 *
 * Modes (via env):
 *   MOCK_CF_FAIL=1   → exit non-zero immediately, never print a URL (start error).
 *   MOCK_CF_NOURL=1  → run but never print a URL (readiness timeout).
 */
const args = process.argv.slice(2);
const urlIdx = args.indexOf('--url');
const target = urlIdx >= 0 ? args[urlIdx + 1] : '';

if (process.env.MOCK_CF_FAIL === '1') {
  process.stderr.write('ERR failed to request quick Tunnel\n');
  process.exit(1);
}

// Echo what we were pointed at so a test can assert the listener-port handoff.
process.stderr.write(`INF Requesting new quick Tunnel on trycloudflare.com... url=${target}\n`);

if (process.env.MOCK_CF_NOURL !== '1') {
  setTimeout(() => {
    process.stderr.write(
      '2026-06-16 INF +--------------------------------------------------------+\n' +
        '2026-06-16 INF |  https://test-tunnel-abc.trycloudflare.com             |\n' +
        '2026-06-16 INF +--------------------------------------------------------+\n',
    );
  }, 120);
}

const stay = () => {};
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
// Keep the process alive until signalled.
setInterval(stay, 1 << 30);
