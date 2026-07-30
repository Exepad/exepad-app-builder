import { describe, it, expect } from 'vitest';
import { parseCli } from './args';

describe('parseCli', () => {
  it('extracts command + string/boolean flags', () => {
    const p = parseCli(['up', '--to', '1.4.2', '--dry-run', '--port', '9000']);
    expect(p.command).toBe('up');
    expect(p.flags.to).toBe('1.4.2');
    expect(p.flags['dry-run']).toBe(true);
    expect(p.flags.port).toBe('9000');
  });
  it('supports short flags', () => {
    const p = parseCli(['logs', '-f']);
    expect(p.command).toBe('logs');
    expect(p.flags.follow).toBe(true);
  });
  it('throws on unknown options', () => {
    expect(() => parseCli(['up', '--nope'])).toThrow();
  });
  it('empty argv yields empty command', () => {
    expect(parseCli([]).command).toBe('');
  });
});
