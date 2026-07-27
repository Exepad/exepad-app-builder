# Security Policy

## Reporting a Vulnerability

Please report security vulnerabilities **privately** — do not open a public
GitHub issue for a security report.

Two private channels are available:

- **Email:** info@exepad.com
- **GitHub private security advisories:** open a report from the repository's
  **Security** tab → **Advisories** → **Report a vulnerability**. This keeps the
  report private to the maintainers until a fix is published.

Please include enough detail to reproduce the issue: affected version/commit,
environment, a proof-of-concept or steps, and the impact you observed. We aim to
acknowledge reports promptly and will coordinate a disclosure timeline with you.

## Supported Versions

Only the **latest released version line** receives security fixes. There is no
back-porting to older releases — upgrade to the newest release to stay patched.

## Scope

Exepad is a **single-tenant, self-hosted** product. The operator runs their own
instance and is trusted; the instance in turn **trusts the apps its own operator
generates**. Understanding this trust boundary is essential to reading what is
and isn't a vulnerability.

**In scope** (please report):

- Flaws that let one signed-in end user read or modify another user's data
  within a generated app (broken `owner_id` scoping, auth/session bypass).
- Operator-authentication or platform-session weaknesses (login, cookies,
  deploy secrets, API keys).
- Injection, path traversal, SSRF, or similar flaws in the runtime worker,
  gateway, deploy pipeline, or app-backend that an unprivileged remote user can
  reach.
- Secret disclosure (leaking generated secrets, tokens, or LLM keys).

**Out of scope** (by design — not vulnerabilities):

- **Escaping the generated-handler sandbox.** Generated handlers run in a
  `node:vm` scope that is a **soft boundary** enforcing the generation-time
  validators — it is **not** a hard sandbox against deliberately malicious code.
  Because the operator is expected to trust the code they generate, breaking out
  of `node:vm` is not treated as a vulnerability.
- **Running untrusted or prompt-injected generated apps.** If you feed the
  builder adversarial prompts and run the resulting app, any resulting behavior
  is the operator's responsibility. Do not run generated apps you have not
  reviewed.
- **Exposing a shared, multi-tenant instance to untrusted prompt authors.**
  Exepad is not hardened for this; letting untrusted third parties generate and
  run code on a shared instance is an unsupported deployment, not a supported
  configuration whose weaknesses are in scope.

If you are unsure whether something is in scope, report it privately and we will
help triage.
