import { parseArgs } from 'node:util';

export interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

const OPTIONS = {
  'dry-run': { type: 'boolean' },
  force: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  yes: { type: 'boolean', short: 'y' },
  follow: { type: 'boolean', short: 'f' },
  dir: { type: 'string' },
  to: { type: 'string' },
  'image-tag': { type: 'string' },
  channel: { type: 'string' },
  port: { type: 'string' },
  domain: { type: 'string' },
  'acme-email': { type: 'string' },
  tls: { type: 'string' },
  'dns-provider': { type: 'string' },
  'dns-token': { type: 'string' },
  'llm-key': { type: 'string' },
  'llm-provider': { type: 'string' },
  'llm-model': { type: 'string' },
  'admin-email': { type: 'string' },
  'admin-password': { type: 'string' },
  out: { type: 'string' },
  // `exepad backup --no-stop`: hot snapshot without quiescing the container.
  'no-stop': { type: 'boolean' },
  // `exepad update --no-backup`: skip the automatic pre-update safety snapshot.
  'no-backup': { type: 'boolean' },
} as const;

/** Parse argv (without node/script) into a command + flags. Throws on unknown options. */
export function parseCli(argv: string[]): ParsedArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    options: OPTIONS,
    allowPositionals: true,
    strict: true,
  });
  return {
    command: positionals[0] ?? '',
    positionals: positionals.slice(1),
    flags: values as Record<string, string | boolean>,
  };
}
