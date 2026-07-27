# Exepad Trademark Policy

Exepad's **code** is open source under the AGPL-3.0. Exepad's **name and logo**
are also trademarks — they identify who made a thing, so using them as *your*
brand isn't something a code licence hands over. This page explains, in plain
terms, what you can do without asking.

Short version: **use the code freely, and don't confuse people about who built
what.** Forks are welcome; they just need their own product name.

## The marks

The following are trademarks of **Exepad LLC**, whether or not registered:

- The name **"Exepad"**, including spellings close enough to be confused with it.
- The **Exepad logo**, including the files in `.github/assets/`.

Exepad LLC's own domains are **exepad.com** and its subdomains (including
`get.exepad.com`, the install front door), and **exepad.app** and its
subdomains, which serve apps published on our hosted service. A domain
registration isn't itself a trademark — the mark is the Exepad name those
domains carry, which is why a lookalike domain is a naming question rather than
a separate right.

As permitted by **AGPL-3.0 section 7(e)**, Exepad LLC reserves these marks. The
AGPL grants you copyright and patent rights in the software; it does not grant
any trademark rights, and nothing in this policy adds restrictions to your AGPL
rights in the code itself.

> **About the logo files.** They stay in this repository and stay covered by the
> AGPL like every other file — you may copy, fork, and redistribute them. What
> this policy limits is *brand* use: presenting the logo as the mark of your own
> product or service. The copyright licence and the trademark are two separate
> things.

## What you may do — no permission needed

- **Run, self-host, modify, and redistribute the software**, for any purpose,
  commercial included. That's the AGPL, and this policy doesn't touch it.
- **Say what your thing is.** "Built with Exepad", "runs on Exepad",
  "compatible with Exepad", "an Exepad alternative" — accurate, descriptive
  references to the real project are fine.
- **Write about Exepad**: blog posts, tutorials, videos, talks, courses,
  comparisons, reviews — including critical ones.
- **Keep the branding on an unmodified redistribution.** If you mirror,
  package, or ship Exepad *as it is*, leaving the name and logo in place is
  exactly right — it's still Exepad.
- **Use the name in a community context** — a user group, a meetup, a
  conference talk title — as long as it's clear you don't speak for Exepad LLC.
- **Use the logo to link to us**, at its normal proportions and colours.

## What needs a different name

This is about the identity you present to users. Please pick your own name and
logo if you are:

- **Distributing a modified build under the Exepad name** — a fork, a patched
  image, or a repackaging with your own changes in it. Call it something else,
  and describe the lineage instead: "MyBuilder, a fork of Exepad" is good;
  "Exepad Plus" is not. (An *unmodified* mirror is fine as-is — see above.)
- **Offering a hosted or managed service under the Exepad name** — e.g.
  "ExepadCloud", "Exepad Hosting", "Exepad by \<company\>". "\<Your Name\>,
  hosted Exepad" describes the service accurately without claiming the brand.
- **Using the Exepad logo as the mark of your own product**, or as part of your
  own logo, app icon, or wordmark.
- **Taking a domain, social account, or company name that reads as official** —
  something a reasonable person would take for Exepad LLC itself, like an
  `exepad.com` lookalike or a bare `@exepad` handle. The problem is the
  confusion, not the letters.
- **Implying endorsement, affiliation, partnership, or official status** that
  doesn't exist.

Also: don't restyle the logo (recolour, distort, add elements) and then use the
result as a brand, and don't use the marks in a way that suggests Exepad LLC
vouches for your product's quality or security.

## Explicitly fine — you don't need to rename these

To be unambiguous, because these come up:

- **Descriptive names for unofficial work.** `exepad-plugin-stripe`,
  `awesome-exepad`, `exepad-templates`, an r/exepad community, a "\<City\>
  Exepad Users" group, an `@exepad_tips` account. Just make it clear it's
  unofficial where that isn't obvious from context.
- **Internal identifiers in a fork.** Redistributing a fork does **not** require
  renaming anything under the hood: the `@exepad/*` workspace package names, the
  `exepad` command your users type at a shell, `EXEPAD_*` environment variables,
  import specifiers, module and file paths, config keys, and table names can all
  stay exactly as they are. None of those is how anyone decides what to install,
  and renaming them would only break compatibility.

  The one name to change is the one you **publish to a shared public registry**,
  because that *is* how people decide: don't publish a fork to npm as `exepad`
  or under `@exepad/*`, and don't push its image to a registry path that reads
  as ours (`ghcr.io/exepad/…`). That's about taking *our* published names, not
  about the letters — a name of your own like `exepad-plugin-stripe` stays fine,
  per the bullet above. Publish under your own name — the command it
  installs can still be `exepad`, since a package's published name and the
  command it provides are set separately. Alongside that, the **product you put
  in front of users** needs its own name: the site, the install page, and the
  app's own UI.

## Asking

If you want to do something this policy doesn't clearly allow, or you think your
case is reasonable and we haven't thought of it, just ask — we're happy to grant
permission for sensible uses.

**info@exepad.com**

We may update this policy over time; we'll keep it in this file.

---

Copyright © 2026 Exepad LLC. "Exepad" and the Exepad logo are trademarks of
Exepad LLC.
