import { describe, it, expect } from 'vitest';
import { escapeHtml } from './escapeHtml';

/**
 * escapeHtml is the XSS guard for dynamic values injected into innerHTML by
 * Code Focus components. It ships into every generated app, so its escaping must
 * be airtight: all five HTML-significant characters, ampersand-first ordering
 * (no double-escaping artifacts), and a safe '' for non-string/empty inputs.
 */
describe('escapeHtml', () => {
  it('escapes all five HTML-significant characters', () => {
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#039;');
  });

  it('neutralizes a script-injection payload', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
    );
  });

  it('neutralizes an attribute-breakout payload', () => {
    // A value landing in an HTML attribute must not be able to close the quote
    // and add an event handler.
    expect(escapeHtml('" onmouseover="alert(1)')).toBe(
      '&quot; onmouseover=&quot;alert(1)',
    );
  });

  it('escapes ampersands first so escapes are not themselves double-escaped', () => {
    // If `<` were replaced before `&`, the result would be `&amp;lt;`.
    expect(escapeHtml('<')).toBe('&lt;');
    // A literal entity-looking string is escaped exactly once.
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
    expect(escapeHtml('a & b < c')).toBe('a &amp; b &lt; c');
  });

  it('returns an empty string for null, undefined and empty input', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml('')).toBe('');
  });

  it('leaves non-significant characters (incl. unicode) untouched', () => {
    expect(escapeHtml('Hello, 世界 — 123')).toBe('Hello, 世界 — 123');
  });

  it('is idempotent in the sense that re-escaping keeps growing the entity prefix (documents the contract)', () => {
    // escapeHtml is NOT idempotent (by design — it escapes the `&` it produced),
    // so callers must escape exactly once. This pins that behavior.
    const once = escapeHtml('<b>');
    expect(once).toBe('&lt;b&gt;');
    expect(escapeHtml(once)).toBe('&amp;lt;b&amp;gt;');
  });
});
