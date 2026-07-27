# Licensing

Exepad is licensed under the **GNU Affero General Public License, version 3**
([`LICENSE`](LICENSE)). This page explains what that means in practice, and
states two things the licence text alone does not.

---

## The short version

| You | What applies |
|---|---|
| Run Exepad, modified or not, for yourself or your company | Nothing to do. Use it. |
| Build apps with Exepad and ship them to customers | **The apps are yours.** No obligation. See below. |
| Modify Exepad itself and run it as a service others use | Offer those users the source of your modified Exepad (AGPL §13). |
| Redistribute Exepad, modified or not | Ship it under AGPL-3.0 with the source. |
| Cannot comply with AGPL for policy reasons | Talk to us about a commercial licence. |
| Fork it and ship your own build | Fine — rename the product. The Exepad name and logo are reserved under §7(e); see [`TRADEMARK.md`](TRADEMARK.md). |

---

## Applications you build with Exepad are yours

**Exepad LLC claims no ownership of, and no copyright interest in, the
applications you build with Exepad** — including code the agent generates on
your instance at your direction. They are your work. You own them, you license
them however you like, and you owe nothing to this project for them.

This is not merely our policy; it also reflects how the software is built. A
generated application is compiled as a **separate module that contains none of
Exepad's source code**. The bundler marks the Exepad SDK and React as *external*
([`packages/deploy-utils/src/bundle/components.ts`](packages/deploy-utils/src/bundle/components.ts)),
so the compiled artifact keeps a bare `import … from "@exepad/sdk"` reference,
which the host runtime resolves at load time through an import map
([`apps/runtime/client/index.html`](apps/runtime/client/index.html)). Your app
*calls* Exepad. It does not *contain* Exepad.

Exporting a project is the exception, and it puts three kinds of Exepad code in
your download so the result builds and runs without an Exepad instance:

- **`vendor/exepad-sdk/`** — a built copy of the SDK;
- **`server/start.mjs`** — a built copy of the app backend, when your app has one;
- **the project scaffolding** — `src/exepad-host.ts`, `src/App.tsx`,
  `src/main.tsx`, `src/components-manifest.ts`, the Vite config, `index.html`
  and `index.css`.

The SDK and the backend bundle are Exepad's code and each ships with the licence
notice beside it. The scaffolding carries none — it is generated for you to
build on, and you may modify and license it as your own. **None of the three
pulls your application under AGPL.** The permission below says all of this
explicitly.

The other export — the run-ready **deployable bundle** — is different. It packs
the entire Exepad runtime (`app/server.mjs` plus the compiled studio) as object
code, and that is conveying Exepad itself: it ships under plain AGPL-3.0, with
`LICENSE` and `NOTICE` at its root. The permission below does not extend to it.
Only the app data inside it is yours.

Whether calling a library across that kind of boundary creates a "combined work"
is a question reasonable lawyers answer differently. Rather than leave you to
rely on our reading of it, we remove the question with an explicit grant:

### Additional permission under GNU AGPL version 3, section 7

> As an additional permission under section 7 of the GNU Affero General Public
> License version 3, Exepad LLC grants you permission to develop, run, convey,
> publicly perform and make available over a network any **Application**, and to
> license that Application under terms of your choosing.
>
> **"Application"** means software authored by you, or generated on an Exepad
> instance at your direction, which is loaded and executed as a guest
> application by Exepad or by an exported Exepad project, and which interfaces
> with Exepad through the Exepad SDK (`@exepad/sdk`), the application
> configuration schema, or the documented component and handler interfaces.
>
> This permission extends to conveying, together with your Application, the
> **Exported Components** that Exepad's own project-export ("eject") produces:
> an unmodified copy of the Exepad SDK, the built standalone backend bundle, and
> the project scaffolding it generates. You may do so without your Application
> becoming subject to the GNU Affero General Public License.
>
> Exepad LLC further grants you permission to **modify the generated project
> scaffolding and to license your modified version under terms of your choosing**
> — it is emitted for you to build upon. The SDK and the backend bundle remain
> licensed under AGPL-3.0 and must be conveyed with their licence notice intact;
> this permission lets you *ship* them alongside your Application without
> relicensing your own work, and does not relicense theirs.
>
> This additional permission applies to the Application and the Exported
> Components only. It does not permit conveying Exepad itself, or any modified
> version of the Exepad platform, the Exepad SDK or the backend bundle, under
> terms other than the GNU Affero General Public License version 3.

In plain terms: **the interface is a permitted boundary.** Build on it, keep
your code closed, sell it. The only thing AGPL asks is that changes *to Exepad
itself* stay open.

---

## What AGPL actually requires

The obligation is narrower than most people assume. It is triggered by
**modifying and then conveying or network-serving Exepad**, not by using it.

**You owe nothing when you:**

- run Exepad — unmodified or modified — for yourself, your team or your company,
  however many people use the instance internally;
- build applications with it and publish them, however commercial;
- modify it privately and never let anyone outside use that modified version.

**You owe source when you:**

- modify Exepad and let others interact with *your modified Exepad* over a
  network (§13) — you must offer those users the corresponding source of your
  modifications, under AGPL-3.0. This means the studio itself, not the apps
  built with it;
- distribute Exepad, modified or not (§4–6) — ship it under AGPL-3.0.

"Corresponding source" means your modifications to Exepad, not your
infrastructure, your data, your API keys or your users' applications.

### The offer is already built in

Exepad serves its own §13 offer, so a fork is compliant by default rather than
by remembering to be. Three surfaces carry it: `GET /source` redirects to the
source repository, a `<link rel="license">` is emitted into every served page,
and the studio's About page shows the running version, commit and a source link.

All three read one value, so **a fork repoints them in one place** — no patching
source. Set `EXEPAD_SOURCE_URL` at build time (a Docker build arg, wired through
`docker-compose.yml`) to bake it into the studio bundle, and as an environment
variable to repoint the server side at runtime. Leave it unset and it names this
upstream repository.

---

## Commercial licensing

If your organisation's policy prohibits AGPL software, Exepad LLC — as the
copyright holder — can license the project under separate commercial terms.
Contributors grant the rights that make this possible
([`CONTRIBUTING.md`](CONTRIBUTING.md#license-of-contributions)), and the
AGPL-3.0 grant is irrevocable, so this option never removes anything from the
open-source project.

Enquiries: **info@exepad.com**.

---

## Third-party code

Components from other projects that are included in this source tree are listed
with their licences in [`NOTICE`](NOTICE). Dependencies installed from npm and
PyPI are not vendored here; they carry their own licences and are declared in
the package manifests.

---

*This page describes the licence terms and is written to be read, not to replace
them. Where it differs from [`LICENSE`](LICENSE), the licence text governs. If
you need certainty for your own situation, ask your own lawyer.*
