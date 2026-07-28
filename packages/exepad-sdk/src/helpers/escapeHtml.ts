/**
 * Escape HTML special characters to prevent XSS when injecting user data into innerHTML.
 * Required for all dynamic values in Code Focus CodeComponents (Shadow DOM).
 *
 * @example
 * ```tsx
 * import { escapeHtml } from '@exepad/sdk';
 * container.innerHTML = notes.map(n =>
 *   `<h4>${escapeHtml(n.title)}</h4><p>${escapeHtml(n.content)}</p>`
 * ).join('');
 * ```
 */
export function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
