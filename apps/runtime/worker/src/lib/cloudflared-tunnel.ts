/**
 * Cloudflare Quick Tunnel primitives (`*.trycloudflare.com`).
 *
 * The generic, target-agnostic plumbing shared by the two tunnel control planes:
 *   - routes/publish.ts       → tunnels ONE published app (a restricted listener)
 *   - routes/quick-access.ts  → tunnels the WHOLE studio (the loopback HTTP port)
 *
 * A quick tunnel needs NO Cloudflare account: `cloudflared tunnel --url
 * http://127.0.0.1:<port>` dials outbound and Cloudflare hands back an anonymous
 * random URL that dies with the process. This module only knows how to spawn one,
 * capture its URL, and kill it — WHAT sits behind the port (and the isolation /
 * security posture of that target) is the caller's responsibility.
 */
import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Extract the `https://<random>.trycloudflare.com` URL cloudflared prints to its
 * banner. Pure + exported so it is unit-tested in isolation. Guards against the
 * `api.trycloudflare.com` control-endpoint decoy and strips ANSI colour codes.
 */
const TUNNEL_URL_RE = /https:\/\/(?!api\.)[a-z0-9][a-z0-9-]*\.trycloudflare\.com/i;
export function extractTunnelUrl(line: string): string | null {
  // eslint-disable-next-line no-control-regex
  const stripped = line.replace(/\x1b\[[0-9;]*m/g, '');
  const m = stripped.match(TUNNEL_URL_RE);
  return m ? m[0] : null;
}

export interface SpawnedTunnel {
  child: ChildProcess;
  /** Resolves with the public URL once cloudflared reports it, else rejects. */
  urlReady: Promise<string>;
}

/**
 * Spawn `cloudflared` pointed at a loopback port and resolve its public URL. The
 * caller owns the returned child (see {@link killChild}). Reads the URL off the
 * banner cloudflared writes to STDERR, buffering across chunk boundaries so a URL
 * split mid-line still matches; times out (default 30s) if it never connects.
 */
export function spawnCloudflared(port: number): SpawnedTunnel {
  const bin = process.env.EXEPAD_CLOUDFLARED_BIN || 'cloudflared';
  const child = spawn(
    bin,
    ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`],
    { stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
  );

  const urlReady = new Promise<string>((resolve, reject) => {
    let settled = false;
    const timeoutMs = Number(process.env.EXEPAD_TUNNEL_READY_TIMEOUT_MS || 30_000);
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('tunnel did not connect within timeout'));
    }, timeoutMs);
    timer.unref?.();

    let buf = '';
    const onData = (chunk: Buffer): void => {
      if (settled) return;
      buf += chunk.toString('utf8');
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        const url = extractTunnelUrl(line);
        if (url) {
          settled = true;
          clearTimeout(timer);
          resolve(url);
          return;
        }
      }
      const partial = extractTunnelUrl(buf);
      if (partial) {
        settled = true;
        clearTimeout(timer);
        resolve(partial);
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const msg = (err as NodeJS.ErrnoException).code === 'ENOENT'
        ? "cloudflared binary not found — this feature requires cloudflared on PATH"
        : err.message;
      reject(new Error(msg));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`cloudflared exited (code ${code ?? 'unknown'}) before reporting a URL`));
    });
  });

  return { child, urlReady };
}

/** Graceful SIGTERM → SIGKILL-after-grace; resolves on child close. Idempotent. */
export function killChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const killer: ReturnType<typeof setTimeout> = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }, 5_000);
    killer.unref?.();
    child.once('close', () => {
      clearTimeout(killer);
      resolve();
    });
    try {
      child.kill('SIGTERM');
    } catch {
      clearTimeout(killer);
      resolve();
    }
  });
}
