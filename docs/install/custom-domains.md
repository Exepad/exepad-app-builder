# Custom domains + automatic HTTPS

Point your own domain (or a bare public IP) at a self-hosted Exepad instance and
serve it over **automatic, browser-trusted HTTPS** — added from the UI, no env
edit and no restart per domain.

This is the self-serve layer on top of the bundled Caddy sidecar: you register a
domain in **Studio → Settings → Custom domains**, prove you own it with a DNS
record, and Caddy obtains a Let's Encrypt certificate on the first HTTPS request.

> **HTTPS is the zero-config default — one self-contained image, no sidecar, no
> extra packages.** A plain `docker compose up` (or even `docker run`) already
> serves HTTPS: the image runs **Caddy in-process** as the TLS terminator and
> issues certs automatically — Caddy's internal CA for `localhost` / LAN / a bare
> IP (encrypted, one-time browser warning), and a **browser-trusted Let's Encrypt**
> cert for this box's own `<dashed-ip>.sslip.io` hostname on a publicly reachable
> box (no domain to buy, no warning). `./run.sh local` (from source, no Docker)
> serves an auto-minted in-process self-signed cert instead — on `:443`, falling
> back to `:8443` when the privileged port can't be bound. The
> section below adds your **own** domain on top — a friendlier address with its
> own browser-trusted cert. Opt out of all of it with `EXEPAD_HTTPS_DISABLE=1`
> (e.g. when you front your own TLS proxy).

---

## 1. Bring the instance up with automatic TLS

> Most operators don't need this section: the default `docker compose up` already
> does on-demand HTTPS via the in-image Caddy. Use `docker-compose.ondemand.yml`
> only to run TLS in a **separate** Caddy sidecar (it sets `EXEPAD_HTTPS_DISABLE=1`
> so the in-image Caddy stands down):

```bash
EXEPAD_ACME_EMAIL=ops@acme.com \
EXEPAD_PUBLIC_IP=203.0.113.10 \
  docker compose -f docker-compose.yml -f docker-compose.ondemand.yml up --build
```

**Every env var here is optional** — the defaults auto-configure:

| Env var | Purpose | Default |
|---|---|---|
| `EXEPAD_ACME_EMAIL` | Let's Encrypt account contact (expiry notices only). | none — Caddy issues fine without it |
| `EXEPAD_PUBLIC_IP` | The box's public A-record IP shown as the DNS target. | **auto-detected** (egress IP) |
| `EXEPAD_PUBLIC_HOST` | A stable hostname to CNAME to (overrides the IP). | none |
| `EXEPAD_ONDEMAND_TLS_ASK_KEY` | Shared key for the Caddy `ask` endpoint (defence-in-depth). | none |
| `EXEPAD_HSTS` | `1` opts **all** secure responses into HSTS. | off — see §6 |

So the minimal "fully automatic" launch is just:

```bash
docker compose -f docker-compose.yml -f docker-compose.ondemand.yml up --build
```

The panel **auto-detects your public IP** (so the DNS target shows with no config)
and reports **HTTPS status** live. This publishes Caddy on `:80`/`:443`, keeps the
app on the internal network only, and persists the ACME account + issued certs in
the `caddy-data` volume so restarts don't re-issue (and burn rate limits).

Already behind your **own** reverse proxy (nginx/Traefik/Coolify/cloud LB)? You
don't need the Caddy sidecar — terminate TLS there, forward `Host` +
`X-Forwarded-Proto: https`, set `EXEPAD_PUBLIC_IP`/`EXEPAD_PUBLIC_HOST` for the
DNS hint, and still register domains in the UI (host→app routing + dynamic CORS
read the same registry).

---

## 2. Add a domain (UI)

**Studio → Settings → Custom domains → + Add domain**

1. **What** — choose *a domain I own* or *a public IP*, and what it serves:
   - **The whole studio** — builder + every app under `/a/{id}/`.
   - **One app at the root** — the picked app is served at the host root (`/`).
   - **Per-app subdomain (wildcard)** — `*.apps.example.com`; each `{app}.apps…`
     serves that app. Wildcards require DNS-01 (§5).
2. **How** — the TLS strategy (§4).
3. **Verify** — create the shown DNS records, then click **Verify**. On success
   the domain goes **Active** and Caddy issues the cert on the first HTTPS hit.

---

## 3. What the URL looks like

| Goal | Maps to | You configure | Resulting URL |
|---|---|---|---|
| One app as a product site | Single app at root | `app.acme.com` → *Invoices* | `https://app.acme.com/` |
| Builder on your domain | Whole studio | `studio.acme.com` | `https://studio.acme.com/` → `…/a/{id}/` |
| A subdomain per app | Wildcard (DNS-01) | `*.apps.acme.com` | `https://invoices.apps.acme.com/` |
| Public box, no domain | IP → sslip.io | IP `203.0.113.10` | `https://203-0-113-10.sslip.io/` |
| Public box, raw IP cert | IP (experimental) | IP `203.0.113.10` | `https://203.0.113.10/` |
| LAN / today's default | — | nothing | `https://<host>/a/{appId}/` |

---

## 4. TLS modes

| Mode | When | Ports / requirements |
|---|---|---|
| **auto** (HTTP-01/TLS-ALPN-01) | A public domain | Inbound `:80` + `:443` reachable. |
| **dns** (DNS-01) | Behind NAT, or a **wildcard** | A DNS-provider API token on the Caddy sidecar; no open ports. |
| **sslip** | A public IP, no domain | Serves at `<dashed-ip>.sslip.io` with a normal trusted cert. |
| **ip** (experimental) | A public IP, browser-trusted cert for the **bare IP** | Static public IP + `:80`/`:443`; cert renews ~every 6 days. May be unavailable depending on the bundled Caddy's ACME-profile support. |
| **byoc** | Air-gapped / corporate CA | You supply the cert; not browser-trusted unless the CA root is installed on clients. |

**Bare IP, be realistic:** a browser-trusted cert for a raw IP is limited.
**sslip.io is the recommended default** — the hostname DNS-resolves to your exact
IP and gets a standard Let's Encrypt cert. The bare-IP `ip` mode uses Let's
Encrypt's short-lived IP certificates and is opt-in/experimental.

---

## 5. Behind NAT / wildcard (DNS-01)

HTTP-01 / TLS-ALPN-01 need an inbound connection and **cannot** issue wildcards.
For a box behind NAT (or where inbound `:80` is blocked), or a
`*.apps.example.com` wildcard, use **DNS-01** — it proves control via a DNS TXT
record the provider plugin creates, so no inbound port is needed for *issuance*.

**Turnkey (no CLI).** A bundled override builds a Caddy image with the curated
`caddy-dns` plugins and issues on-demand certificates over DNS-01:

```bash
cp caddy.env.example caddy.env   # set EXEPAD_DNS_PROVIDER + EXEPAD_DNS_TOKEN
docker compose -f docker-compose.yml -f docker-compose.ondemand-dns.yml up --build
```

- The DNS API token lives in `caddy.env` (gitignored) and is mounted into the
  **Caddy sidecar only** — it never reaches the app container.
- Single-token providers supported out of the box: **Cloudflare, DigitalOcean,
  Gandi, Hetzner, Linode, Vultr, DuckDNS, deSEC**. (Multi-credential providers —
  route53, Azure, Google Cloud DNS, Namecheap — need a hand-edited
  `Caddyfile.ondemand-dns`, or use BYOC.)
- The first `--build` runs xcaddy (compiles Caddy from source) — a few minutes, once.

Then register your domain in **Studio → Settings → Custom domains** (the
*Home / office (behind a router)* topology → mode **DNS-01**).

**Wildcards.** On-demand TLS issues one cert per SNI, so it can't issue a
wildcard. Uncomment the `*.apps.example.com` block in `Caddyfile.ondemand-dns`,
set your zone, then register the wildcard in the UI (the *subdomain per app*
topology). The global DNS-01 issuer already applies to it.

> Prefer a single fixed domain, generated for you? The `exepad` CLI's `--tls dns`
> (`packages/exepad-cli`) emits an equivalent per-domain Caddy + compose setup.

---

## 6. HSTS (off by default)

HSTS is intentionally **not** sent by default: a self-signed/LAN cert plus HSTS
hard-pins browsers to HTTPS and would brick later plain-HTTP access, and HSTS is
ignored on a bare IP anyway. Enable it only for a **stable public domain**:

- Per-domain — the **Enable HSTS** button on an active domain.
- Globally — `EXEPAD_HSTS=1` (every secure response).

⚠️ If you later lose the certificate, an HSTS-pinned browser will refuse to
connect. Leave it off unless you're sure.

---

## 7. How it works (for operators debugging)

- **Registry:** `registered_domains` in `meta.sqlite` (one row per host;
  `app_id` NULL = whole studio, set = single app at root).
- **Issuance gate:** Caddy's on-demand TLS calls
  `GET /internal/tls/authorize?domain=<sni>` before obtaining a cert; the worker
  returns `200` only for an **active** (operator-verified) registered domain.
  This allowlist is what keeps issuance inside Let's Encrypt's rate limits — an
  attacker sending bogus SNIs is refused.
- **Verify-then-issue:** a real domain becomes active only after its TXT
  challenge (`_exepad-challenge.<domain>` = `exepad-verify=<token>`) passes, so
  Caddy never attempts ACME for a host you don't control.
- **Routing + CORS:** active domains drive host→app routing and the dynamic CORS
  allowlist live — no restart. Verified domains are allowed for credentialed
  `/api` calls automatically.

## 8. Troubleshooting

| Symptom | Likely cause |
|---|---|
| “Serving over plain HTTP” banner | No TLS terminator in front — start with the on-demand compose (above) or your own reverse proxy. (The banner turns green once the studio is reached over HTTPS.) |
| DNS target shows “could not auto-detect a public IP” | The box has no outbound access, or is on a private network/NAT. Set `EXEPAD_PUBLIC_HOST`/`EXEPAD_PUBLIC_IP`, or use DNS-01. |
| Verify keeps failing | TXT record not propagated yet (wait a few minutes), or wrong value — recheck the record shown in the UI. |
| Domain verified but cert errors | DNS A/AAAA doesn't actually point at the box, or `:80`/`:443` not reachable (use DNS-01 if behind NAT). |
| App renders blank on a custom domain | Make sure the domain maps to a **single app** (served at root) — whole-studio hosts serve apps under `/a/{id}/`. |
| Login drops on the custom domain | Cookies need HTTPS — ensure Caddy/your proxy forwards `X-Forwarded-Proto: https` (or set `EXEPAD_COOKIE_SECURE=1`). |
