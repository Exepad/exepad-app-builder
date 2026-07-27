/**
 * Slate extension shim (dev mode)
 *
 * The Slate ecosystem splits into two packages:
 *   - slate: core APIs (createEditor, Editor, Transforms, Node, etc.)
 *   - slate-react: React bindings (Slate, Editable, withReact, etc.)
 *
 * Production CDN bundles both into one file. In dev mode we use esm.sh,
 * which can only serve one package per URL. This shim re-exports both.
 *
 * CRITICAL: slate-react must use ?external=slate so it imports slate
 * via bare specifier -> resolved by the import map -> same module instance
 * as our direct re-export. Without this, two copies of slate load and
 * editor validation fails with "[Slate] editor is invalid!".
 */
export * from 'slate';
export * from 'https://esm.sh/slate-react@0.110.2?external=react,react-dom,slate';
