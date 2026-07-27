// @vitest-environment node
/**
 * app-name.ts — the display-name helpers that decide what the dashboard card
 * shows. These are the core of the "show the app name, not the prompt" fix:
 *
 *   - deriveAppName: the prompt-derived PLACEHOLDER (shown while a build runs and
 *     kept as a fallback). Must prefer a quoted name and strip build verbs.
 *   - isGenericAppName: the guard that stops a sync from regressing apps.name to
 *     "New App"/"Untitled"/the agent's other placeholders.
 *   - displayNameFromConfig: pulls the real name out of the assembled config with
 *     the name → frontend.appName → frontend.metadata.title precedence, rejecting
 *     generics so the caller keeps the existing name instead.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveAppName,
  isGenericAppName,
  displayNameFromConfig,
  GENERIC_AGENT_APP_NAME,
} from '../../../../worker/src/lib/app-name';

describe('deriveAppName', () => {
  it('prefers a double-quoted name from the prompt', () => {
    expect(deriveAppName('Build "Momentum", a single-page habit tracker')).toBe('Momentum');
    expect(deriveAppName('Make me “Lumina” — a studio site')).toBe('Lumina');
  });

  it('does not treat apostrophes as a quoted name', () => {
    // A contraction must not be mistaken for a quoted span.
    expect(deriveAppName("Build an app that tracks who's on call")).not.toBe('s on call');
  });

  it('strips a leading build instruction', () => {
    expect(deriveAppName('Create an expense tracker for freelancers')).toBe(
      'expense tracker for freelancers',
    );
    expect(deriveAppName('Build a CRM')).toBe('CRM');
    expect(deriveAppName('please generate the booking system')).toBe('booking system');
  });

  it('caps at the first few words and 80 chars', () => {
    const long = 'Build an app for ' + 'word '.repeat(40);
    expect(deriveAppName(long).length).toBeLessThanOrEqual(80);
    expect(deriveAppName('build a one two three four five six seven').split(' ').length).toBeLessThanOrEqual(6);
  });

  it('falls back to Untitled App for an empty prompt', () => {
    expect(deriveAppName('')).toBe('Untitled App');
    expect(deriveAppName('   ')).toBe('Untitled App');
  });
});

describe('isGenericAppName', () => {
  it('flags the agent placeholders case-insensitively', () => {
    for (const n of ['New App', 'my app', 'UNTITLED', 'Untitled App', 'app', '', '  ']) {
      expect(isGenericAppName(n)).toBe(true);
    }
  });

  it('treats the agent seed name as generic so we never persist it', () => {
    expect(isGenericAppName(GENERIC_AGENT_APP_NAME)).toBe(true);
  });

  it('does not flag a real brand name', () => {
    for (const n of ['Lumina', 'Momentum', 'CRM', 'Habit Tracker']) {
      expect(isGenericAppName(n)).toBe(false);
    }
  });
});

describe('displayNameFromConfig', () => {
  it('returns the top-level name (the canonical app name)', () => {
    expect(displayNameFromConfig({ name: 'Lumina' })).toBe('Lumina');
  });

  it('prefers name over the frontend title surfaces', () => {
    const config = {
      name: 'Lumina',
      frontend: { appName: 'Other', metadata: { title: 'Lumina — Where vision meets motion' } },
    };
    expect(displayNameFromConfig(config)).toBe('Lumina');
  });

  it('falls back to frontend.appName then metadata.title when name is generic', () => {
    expect(
      displayNameFromConfig({ name: 'New App', frontend: { appName: 'Lumina' } }),
    ).toBe('Lumina');
    expect(
      displayNameFromConfig({
        name: 'Untitled',
        frontend: { metadata: { title: 'Lumina' } },
      }),
    ).toBe('Lumina');
  });

  it('returns null when every candidate is generic (caller keeps existing name)', () => {
    expect(displayNameFromConfig({ name: 'New App', frontend: { appName: 'Untitled' } })).toBeNull();
  });

  it('returns null for missing/non-object configs', () => {
    expect(displayNameFromConfig(null)).toBeNull();
    expect(displayNameFromConfig(undefined)).toBeNull();
    expect(displayNameFromConfig('Lumina')).toBeNull();
    expect(displayNameFromConfig({})).toBeNull();
  });

  it('trims and caps the chosen name at 80 chars', () => {
    expect(displayNameFromConfig({ name: '  Lumina  ' })).toBe('Lumina');
    const long = 'A'.repeat(120);
    expect(displayNameFromConfig({ name: long })?.length).toBe(80);
  });
});
