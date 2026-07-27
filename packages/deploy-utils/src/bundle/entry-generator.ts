/**
 * Entry Module Generator
 *
 * Generates the _entry.js module that wires handler imports to globalThis
 * and re-exports the worker template.
 */

/**
 * Generate the entry module source for a multi-module worker upload.
 *
 * Output example (2 handlers):
 * ```js
 * import handler_0 from './handlers/getDashboardStats.js';
 * import handler_1 from './handlers/processLoan.js';
 * globalThis.INJECTED_HANDLERS = { 'getDashboardStats': handler_0, 'processLoan': handler_1 };
 * export { default } from './template.js';
 * ```
 */
/**
 * Handler names flow from agent-produced config into this generated JS source
 * (an import specifier AND a single-quoted object key). A name containing a
 * quote, backtick, slash, or newline would break out of the string and inject
 * arbitrary code into the bundled `_entry.js` that runs in the handler VM. The
 * config schema does not constrain these, so validate here: plain identifiers
 * only.
 */
const HANDLER_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function generateEntryModule(handlerMethods: string[]): string {
  for (const name of handlerMethods) {
    if (typeof name !== 'string' || !HANDLER_NAME_PATTERN.test(name)) {
      throw new Error(
        `Illegal handler name ${JSON.stringify(name)}: must match ${HANDLER_NAME_PATTERN}`,
      );
    }
  }

  const lines: string[] = [];

  // Import each handler
  for (let i = 0; i < handlerMethods.length; i++) {
    lines.push(`import handler_${i} from './handlers/${handlerMethods[i]}.js';`);
  }

  // Wire handlers to globalThis
  const entries = handlerMethods
    .map((name, i) => `'${name}': handler_${i}`)
    .join(', ');
  lines.push(`globalThis.INJECTED_HANDLERS = { ${entries} };`);

  // Re-export worker template
  lines.push(`export { default } from './template.js';`);

  return lines.join('\n');
}
