/**
 * Coupling guard: every relative-date token form the agent's seed prompt
 * teaches the LLM to emit MUST be parseable by `expandTokens`.
 *
 * Producer side: `seed_data_builder_instruction_provider` in
 * apps/agent/main_agent/.../seed_data_builder.py — defines the grammar
 * the LLM is told to use.
 *
 * Consumer side: `expandTokens` in src/seed/relative-dates.ts — the deploy
 * pipeline's substitution function.
 *
 * If a future PR adds a new token form to the prompt without teaching the
 * consumer how to parse it (or vice versa — drops a form from the parser
 * while the prompt still teaches it), the two ends diverge and seeded D1
 * rows get literal placeholder strings — see the tfluo79j incident
 * (2026-05-08) for the production blast radius of that class of bug.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { expandTokens } from '../src/seed/relative-dates';


const PROMPT_PATH = resolve(
  __dirname,
  '../../../apps/agent/main_agent/agents/orchestrator/app_types/shared/builders/backend_builders/seed_data_builder.py',
);

// Anchor — value irrelevant; we only check that parse succeeds and the
// output differs from the input (i.e. substitution actually fired).
const NOW = new Date('2026-05-08T12:00:00.000Z');

// Match every `__TODAY__...` / `__NOW__...` literal token the prompt
// mentions. Either a bare keyword (`__TODAY__`, `__NOW__`) or a full
// offset form with real digits + unit (`__TODAY__-7d`, `__NOW__+5d`).
//
// The prompt also contains meta-syntax like `__TODAY__-Nd` to teach the
// LLM the *grammar* — that's not a real token and must NOT match here, so
// the offset group requires `\d+` (at least one digit) and a known unit.
// Unit alternatives are listed longest-first (`mo` before `m`) so the
// regex doesn't eat the `m` of `mo` and leave `o` dangling.
const TOKEN_RE = /__(?:TODAY|NOW)__(?:[-+]\d+(?:mo|d|w|h|m))?/g;


describe('agent ↔ deploy-utils token contract', () => {
  it('seed_data_builder.py exists at the expected path', () => {
    // If this fails, someone moved the agent file. Update PROMPT_PATH or
    // accept that the contract test no longer covers the moved producer.
    const stat = readFileSync(PROMPT_PATH, 'utf-8');
    expect(stat).toContain('SeedDataBuilder');
  });

  it('every token form taught in the prompt parses without throwing', () => {
    const prompt = readFileSync(PROMPT_PATH, 'utf-8');
    const tokens = Array.from(new Set(prompt.match(TOKEN_RE) ?? []));

    // Sanity check — if this falls to zero, the prompt was rewritten and
    // either no longer teaches relative tokens (consumer code can be
    // deleted) or the regex above no longer matches (broaden it).
    expect(tokens.length).toBeGreaterThan(0);

    const failures: { token: string; error: string }[] = [];
    for (const token of tokens) {
      try {
        const out = expandTokens(token, NOW);
        // Bare keywords like __TODAY__ should expand to a different string.
        // If `out === token`, the parser silently passed through — which
        // is the exact failure mode that broke tfluo79j.
        if (typeof out !== 'string' || out === token) {
          failures.push({ token, error: `not substituted (output=${JSON.stringify(out)})` });
        }
      } catch (e) {
        failures.push({ token, error: e instanceof Error ? e.message : String(e) });
      }
    }

    // Friendly failure: list every token the prompt teaches but the parser
    // can't handle, so the fixer knows exactly what to add.
    expect(failures, `Producer/consumer drift: agent prompt teaches tokens the deploy-utils parser does not support.\nFailures:\n${failures.map((f) => `  ${f.token} → ${f.error}`).join('\n')}`).toEqual([]);
  });

  it('parser accepts the documented unit set (d, w, mo, h, m)', () => {
    // Belt-and-suspenders: even if the prompt's regex match misses a unit
    // because of formatting, lock the unit set explicitly. If a unit is
    // dropped on either side this catches it.
    expect(expandTokens('__TODAY__-7d', NOW)).toBe('2026-05-01');
    expect(expandTokens('__TODAY__-2w', NOW)).toBe('2026-04-24');
    expect(expandTokens('__TODAY__+1mo', NOW)).toBe('2026-06-08');
    expect(typeof expandTokens('__NOW__-2h', NOW)).toBe('string');
    expect(typeof expandTokens('__NOW__-30m', NOW)).toBe('string');
  });
});
