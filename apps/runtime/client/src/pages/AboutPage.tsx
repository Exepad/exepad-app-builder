import { HelpPageLayout, HelpSection } from '@/components/studio/HelpPageLayout';

/**
 * Source offer at the foot of the studio About page, `/help/about` (AGPL-3.0
 * section 13): anyone who modifies Exepad and serves it over a network must
 * offer *their* users *their* Corresponding Source, so the version, commit, and
 * repository URL are all overridable at build time (Vite env vars, e.g.
 * `VITE_EXEPAD_SOURCE_URL=… pnpm build:client`, or the matching
 * `--build-arg EXEPAD_SOURCE_URL=…` on the container path, which the Dockerfile
 * re-exports as the VITE_* variables the SPA build reads). Unset, they describe
 * this upstream build.
 *
 * This page is operator-only — it renders inside StudioShell, which bounces
 * anonymous visitors to /login. The offer that reaches an *app's* users is the
 * unauthenticated `GET /source` route plus the `<link rel="license">` the worker
 * injects into every served page (`worker/src/lib/source-offer.ts`).
 *
 * The default URL below is the SPA's copy of the one in
 * `worker/src/lib/source-offer.ts` — the client/worker boundary rules out a
 * shared constant, so a fork that hardcodes a new upstream edits both.
 *
 * An unstamped build reports `dev` rather than a version read from
 * package.json: a source offer whose job is naming the source a binary was
 * built from must not name a release the binary did not come from.
 */
const SOURCE_VERSION = import.meta.env.VITE_EXEPAD_VERSION || 'dev';
const SOURCE_COMMIT = import.meta.env.VITE_EXEPAD_COMMIT || '';
const SOURCE_URL =
  import.meta.env.VITE_EXEPAD_SOURCE_URL ||
  'https://github.com/Exepad/exepad-app-builder';

export default function AboutPage() {
  return (
    <HelpPageLayout
      title="About"
      description="What Exepad is, and where this instance’s docs and source live."
    >
      <p className="text-base font-medium text-foreground">
        Exepad turns a plain-language description into a real, full-stack
        application — interface, database, forms, and authentication — and runs
        it on the server you installed it on.
      </p>

      <HelpSection heading="This instance is yours">
        <p>
          You are running your own Exepad server. The apps you build, their
          databases, their uploaded files, and the accounts that sign in to them
          all live in this instance’s data directory. Your prompts and generated
          code go to the LLM provider you configure under Settings, and nowhere
          else.
        </p>
        <p className="mt-2">
          Three other things reach the internet by default, none of them carrying
          your data: a public-IP lookup at boot (so HTTPS can name this box), a
          Let’s Encrypt certificate request for that hostname, and a version
          check against the GitHub releases API when you open Settings. Set{" "}
          <code>EXEPAD_NO_OUTBOUND=1</code> to switch all three off.
        </p>
      </HelpSection>

      <HelpSection heading="Ways to build">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <span className="font-medium text-foreground">Prompt</span> — describe
            your app in plain language and iterate by chatting with the agent.
          </li>
          <li>
            <span className="font-medium text-foreground">Import a file</span> —
            turn Excel, CSV, PDF, Word, PowerPoint, or image uploads into a working
            application.
          </li>
          <li>
            <span className="font-medium text-foreground">REST API &amp; MCP</span>{' '}
            — create and drive apps programmatically, or connect AI agents through
            the Model Context Protocol.
          </li>
        </ul>
      </HelpSection>

      <HelpSection heading="Docs and source">
        <p>
          Installing, upgrading, and backing up this server are covered by the
          documentation that ships with the source:{' '}
          <code className="font-mono text-foreground">README.md</code> and{' '}
          <code className="font-mono text-foreground">INSTALL.md</code> at the
          repository root, with the architecture notes under{' '}
          <code className="font-mono text-foreground">docs/</code>. Exepad is
          free software under the AGPL-3.0 — the version this instance was built
          from, and a link to its complete corresponding source, are below.
        </p>
      </HelpSection>

      <div className="flex items-center justify-between gap-2 border-t pt-4 text-xs">
        <span className="font-medium text-foreground">Exepad</span>
        <span>
          {SOURCE_VERSION === 'dev' ? 'dev build' : `v${SOURCE_VERSION}`}
          {SOURCE_COMMIT && ` (${SOURCE_COMMIT.slice(0, 7)})`} — AGPL-3.0 —{' '}
          <a
            href={SOURCE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Source
          </a>
        </span>
      </div>
    </HelpPageLayout>
  );
}
