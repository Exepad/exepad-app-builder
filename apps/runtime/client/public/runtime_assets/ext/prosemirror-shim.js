/**
 * ProseMirror extension shim (dev mode)
 *
 * The ProseMirror ecosystem is split into many small packages:
 *   - prosemirror-model: Schema, Node, Mark, Fragment
 *   - prosemirror-transform: Transform, Step (used by state & view)
 *   - prosemirror-state: EditorState, Plugin, Transaction
 *   - prosemirror-view: EditorView, Decoration
 *   - prosemirror-history: history(), undo, redo
 *   - prosemirror-keymap: keymap()
 *   - prosemirror-commands: baseKeymap, toggleMark, setBlockType, etc.
 *
 * These share prosemirror-model, prosemirror-transform, and
 * prosemirror-state as common dependencies. Each package uses
 * ?external= to resolve shared deps via the import map, ensuring
 * a single Schema/EditorState instance across all packages.
 */
export * from 'prosemirror-model';
export * from 'prosemirror-state';
export * from 'prosemirror-view';
export * from 'prosemirror-history';
export * from 'prosemirror-keymap';
export * from 'prosemirror-commands';
