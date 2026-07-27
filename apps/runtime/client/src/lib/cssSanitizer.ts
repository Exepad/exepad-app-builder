/**
 * Shared CSS sanitizer for any code path that injects a string into a live
 * `<style>` element via `dangerouslySetInnerHTML`.
 *
 * Setting innerHTML on a <style> element parses its content as RAWTEXT, so a
 * `</style>` sequence in attacker/untrusted CSS closes the element early and
 * lets the remainder be parsed as live HTML (e.g. `</style><img src=x
 * onerror=...>` or `<iframe>` phishing overlays). Both HeadTagsRenderer (inline
 * <style> tags) and DynamicFontLoader (remote @font-face CSS fetched from a
 * config-specified, agent-injectable URL) share this sink, so they share one
 * sanitizer to avoid one path drifting behind the other.
 */
export function sanitizeCss(value: string): string {
  // Block HTML tag injection / the </style> RAWTEXT breakout.
  let safe = value.replace(/<script[\s>]/gi, '<!-- blocked -->');
  safe = safe.replace(/<\/style>/gi, '');
  // Block expression() (legacy IE CSS expressions).
  safe = safe.replace(/expression\s*\(/gi, '');
  // Block -moz-binding and behavior (legacy injection vectors).
  safe = safe.replace(/-moz-binding\s*:/gi, '');
  safe = safe.replace(/behavior\s*:/gi, '');
  // Block javascript: and data: inside url().
  safe = safe.replace(/url\s*\(\s*['"]?\s*javascript:/gi, 'url(blocked:');
  safe = safe.replace(/url\s*\(\s*['"]?\s*data:/gi, 'url(blocked:');
  return safe;
}
