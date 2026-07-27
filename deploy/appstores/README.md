# Self-hosted app-store manifests

Thin wrappers around the published image (`ghcr.io/exepad/exepad-app-builder`) for
the self-host app-store ecosystems — the "get listed → install becomes one
click" channel. Every manifest is the same single container + one persistent
`/data` volume; none fork the architecture.

| Store | Files | How users get it | Submission |
|---|---|---|---|
| **Portainer** | [`portainer/templates.json`](./portainer/templates.json) | Settings → App Templates → point the URL at this raw file | none (self-hosted URL) |
| **CasaOS / ZimaOS** | [`casaos/Apps/exepad/`](./casaos/Apps/exepad/) | App Store → add this repo as a third-party source | optional PR to `IceWhaleTech/CasaOS-AppStore` (needs on-device test) |
| **Umbrel (community store)** | [`umbrel/`](./umbrel/) | App Store → Community App Stores → add this repo's URL | optional PR to `getumbrel/umbrel-apps` (official store) |
| **Runtipi** | [`runtipi/apps/exepad/`](./runtipi/apps/exepad/) | Settings → App Stores → add this repo | optional PR to the runtipi appstore repo |
| **Dokploy** | [`../dokploy/`](../dokploy/) | (blueprint) | PR to `Dokploy/templates` — no star gate |

## Status / caveats

- **Prepared, not yet live-tested.** Every manifest still needs a run on the
  target platform before submission. Store schemas evolve — validate each
  against the store's current CONTRIBUTING/schema at submission time.
- **Pin the image tag** to a released `X.Y.Z` before submitting anywhere;
  `:latest` is only a convenience default for add-by-URL installs.
- **Hard constraints carried by every manifest:** single instance (SQLite
  single-writer), persistent local-disk `/data` (no NFS/SMB), ≥ 2 GB RAM
  (builds peak 2–3 GB), LLM key required to build (settable post-install in
  `/settings`).
- Community-store variants (add-by-URL) have **no gatekeeping** — they work
  today. Official-store PRs are optional reach later.
- **Coolify** is deliberately absent: its official catalog requires ≥ 1,000
  GitHub stars. Coolify users can already deploy
  [`../docker-compose.yml`](../docker-compose.yml) as a custom Docker Compose
  resource.
