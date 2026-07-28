# `get.exepad.com` — the installer front door

The hostname behind the two one-liners in the README:

```bash
curl -fsSL https://get.exepad.com | bash                                  # macOS/Linux
powershell -ExecutionPolicy Bypass -c "irm https://get.exepad.com/install.ps1 | iex"
```

It is a Cloudflare Worker that 302s to the current release's assets:

| Path | → |
|---|---|
| `/`, and anything unrecognised | `releases/latest/download/install.sh` |
| `/install.sh` | `releases/latest/download/install.sh` |
| `/install.ps1` | `releases/latest/download/install.ps1` |
| `/install.sh.sha256`, `/install.ps1.sha256` | the matching checksums |

Everything resolves through **`releases/latest`**, which GitHub points at the
newest non-prerelease. So this is deployed once and needs no attention per
release — and it also means every path 404s until a stable tag exists, because
`releases/latest` deliberately skips prereleases.

## Why a Worker and not a DNS record

A DNS record cannot do this: DNS maps names to addresses and has no concept of
paths or redirects. The alternative would be a Cloudflare **Redirect Rule**, but
that needs a token with `Zone → DNS → Edit` to create the proxied hostname, and
`wrangler login` grants only `zone (read)`. A Worker with `custom_domain = true`
creates and owns its DNS record through the Workers API instead, which the
wrangler OAuth token *does* cover.

## Deploy

```bash
cd deploy/get-exepad
node test.mjs          # redirect-target assertions, no network
npx wrangler deploy
```

A freshly created custom domain can return **HTTP 500 (Cloudflare error 1104)**
for up to a minute while it propagates. It clears on its own; re-request before
concluding anything is wrong.

## Verify

```bash
curl -sS -o /dev/null -w '%{http_code} -> %{redirect_url}\n' https://get.exepad.com/
curl -fsSL https://get.exepad.com | head -3    # MUST start with #!/usr/bin/env bash
```

The second check is the one that matters. A misrouted redirect landing on a
GitHub HTML page still returns 200, and `curl … | bash` would pipe that HTML
straight into a shell.
