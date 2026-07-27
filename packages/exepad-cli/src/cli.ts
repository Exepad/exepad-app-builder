import { parseCli } from './args';
import { createRealContext } from './context';
import { LAUNCHER_VERSION, IMAGE_REPO } from './config';
import { deploy, down, stop, start, restart, logs, backup, restore, doctor, status } from './commands';

const HELP = `exepad — installer + operator CLI for the self-hosted Exepad studio

USAGE
  exepad <command> [options]

COMMANDS
  up            Install/start the studio (pull pinned image, write compose, up -d)
  update        Update to a newer version (backs up /data first; --no-backup to skip)
  stop          Pause the studio (graceful; container kept — resume with \`exepad start\`)
  start         Resume a stopped studio
  restart       Gracefully restart the studio
  down          Remove the studio container (data volume preserved; recreate with \`up\`)
  logs          Show container logs                (-f / --follow to stream)
  backup        Archive the data volume to a .tgz  (stops the container first for a
                  consistent SQLite snapshot; --no-stop for a hot at-your-own-risk copy)
  restore       Restore a backup archive into the data volume — the rollback path:
                  exepad restore <backup.tgz> [--to <version>]
  doctor        Check the container engine (Docker or Podman), arch, RAM, deployed version
  status        Print launcher + deployed version

VERSION SELECTION  (lockstep: default tag = this launcher's version, ${LAUNCHER_VERSION})
  --to <ver>            Target studio version, e.g. --to 1.4.2
  --image-tag <tag>     Advanced: exact tag or @sha256:<digest> (immutable)
  --channel <name>      Moving channel, e.g. --channel edge   (not reproducible)
  --force               Allow a downgrade / unsupported arch  (back up first!)
  --no-backup           update: skip the automatic pre-update /data snapshot

INSTALL OPTIONS (up)
  --port <n>            Host port (default 8080; ignored when --domain is set)
  --domain <host>      Serve HTTPS on a domain via a Caddy sidecar
  --acme-email <email>  ACME contact for Let's Encrypt (recommended with --domain)
  --tls <mode>          TLS strategy with --domain:
                          letsencrypt  HTTP-01, needs public DNS + inbound :80/:443 (default)
                          dns          DNS-01, works behind NAT (needs --dns-provider)
                          byoc         bring-your-own-cert (internal CA / IT-issued) in ./certs
  --dns-provider <p>    DNS-01 provider for --tls dns (cloudflare, digitalocean, …)
  --dns-token <token>   DNS API token for --tls dns (stored 0600 in caddy.env, Caddy-only — not .env)
  --llm-key <key>       Seed EXEPAD_LLM_API_KEY
  --llm-provider <p>    e.g. gemini | anthropic | openai | ollama
  --llm-model <m>       Seed EXEPAD_LLM_MODEL_DEFAULT
  --admin-email <e>     Seed the operator account (with --admin-password)
  --admin-password <p>

GLOBAL
  --dir <path>          Install dir (default $EXEPAD_HOME or ~/.exepad)
  --out <dir>           backup: destination directory (default <install-dir>/backups)
  --dry-run             Print what would happen; make no changes
  -y, --yes             Non-interactive (don't prompt)
  -v, --version         Print launcher version
  -h, --help            Show this help

Image: ${IMAGE_REPO}
`;

async function run(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseCli(argv);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n\nRun \`exepad --help\`.\n`);
    return 2;
  }

  const { command, flags } = parsed;

  if (flags.version === true && !command) {
    process.stdout.write(`${LAUNCHER_VERSION}\n`);
    return 0;
  }
  if (flags.help === true || command === 'help' || command === '') {
    process.stdout.write(HELP);
    return command === '' && flags.help !== true ? 1 : 0;
  }

  const ctx = createRealContext({
    dryRun: flags['dry-run'] === true,
    assumeYes: flags.yes === true,
  });

  switch (command) {
    case 'up':
      return deploy(ctx, flags, 'up');
    case 'update':
    case 'upgrade':
      return deploy(ctx, flags, 'update');
    // NOTE: stop ≠ down. stop = graceful pause (container kept, `start` resumes);
    // down = teardown (container removed, volume kept). stop used to alias down —
    // wrong semantics: "stop" must never destroy what it pauses.
    case 'stop':
      return stop(ctx, flags);
    case 'start':
      return start(ctx, flags);
    case 'restart':
      return restart(ctx, flags);
    case 'down':
      return down(ctx, flags);
    case 'logs':
      return logs(ctx, flags);
    case 'backup':
      return backup(ctx, flags);
    case 'restore':
      return restore(ctx, flags, parsed.positionals);
    case 'doctor':
      return doctor(ctx, flags);
    case 'status':
    case 'version':
      return status(ctx, flags);
    default:
      ctx.err(`Unknown command: ${command}\nRun \`exepad --help\`.`);
      return 2;
  }
}

run(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    process.stderr.write(`exepad: ${(e as Error).message}\n`);
    process.exitCode = 1;
  });
