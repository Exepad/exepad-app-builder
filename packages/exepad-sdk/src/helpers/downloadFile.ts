/**
 * Trigger a browser download for a generated blob of content.
 *
 * The motivating bug: agents trying to ship CSV / JSON / SVG exports
 * reached for ``document.createElement('a').click()`` to drive the
 * download. That's forbidden in Code Focus (DOM access without refs),
 * so the agent fell back to a `toast()` saying "in a production
 * environment this would download" — a stub that ships as a feature
 * but does nothing. Sanctioning the helper here closes the gap.
 *
 * @example
 *   import { downloadFile } from "@exepad/sdk";
 *   downloadFile("report.csv", "name,age\nAlice,30\n", "text/csv");
 *
 *   // Or with a Blob (binary content):
 *   downloadFile("chart.svg", svgBlob, "image/svg+xml");
 */
export function downloadFile(
  filename: string,
  contents: string | Blob,
  mimeType: string,
): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;

  const blob = contents instanceof Blob ? contents : new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);

  // Use an in-DOM anchor that we immediately remove. Browsers require the
  // anchor be document-attached for the click() to fire in some legacy
  // engines; we clean up synchronously after.
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Defer revocation so the browser's download stream finishes reading
  // the URL. 30s is the practical safe-side default for large blobs.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Trigger a CSV download from an array of row objects. Keys of the
 * first row become the column headers. Values are CSV-escaped (quoted
 * with internal quotes doubled) so commas and newlines in values don't
 * break the file.
 *
 * @example
 *   downloadCsv("users.csv", [
 *     { id: 1, name: "Alice", note: "Hi, friend" },
 *     { id: 2, name: "Bob",   note: "Plain"      },
 *   ]);
 *
 * If ``rows`` is empty, the function is a no-op (no zero-row CSV files).
 */
export function downloadCsv(
  filename: string,
  rows: ReadonlyArray<Record<string, unknown>>,
): void {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (val: unknown): string => {
    const s = val == null ? '' : String(val);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines: string[] = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escape((row as Record<string, unknown>)[h])).join(','));
  }
  // Prepend a UTF-8 BOM so Excel opens the file without garbling
  // non-ASCII characters — common ask the agent shouldn't have to remember.
  const body = '﻿' + lines.join('\r\n');
  downloadFile(filename, body, 'text/csv;charset=utf-8');
}
