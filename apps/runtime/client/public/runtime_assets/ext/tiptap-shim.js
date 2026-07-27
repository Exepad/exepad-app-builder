/**
 * TipTap extension shim (dev mode)
 *
 * The TipTap ecosystem splits across multiple packages:
 *   - @tiptap/core: Editor class, Extension/Node/Mark base classes
 *   - @tiptap/react: useEditor, EditorContent (React bindings)
 *   - @tiptap/starter-kit: StarterKit (bundles common extensions)
 *   - @tiptap/extension-*: individual extensions (Placeholder, Link, etc.)
 *
 * All packages share @tiptap/core as a common dependency. Each package
 * uses ?external=@tiptap/core so they resolve it via the import map
 * to the same module instance, avoiding "Schema is missing its top
 * node type ('doc')" errors from duplicate Extension class hierarchies.
 */
export * from '@tiptap/core';
export * from 'https://esm.sh/@tiptap/react@3?external=react,react-dom,@tiptap/core';
export * from 'https://esm.sh/@tiptap/starter-kit@3?external=@tiptap/core';
export * from 'https://esm.sh/@tiptap/extension-placeholder@3?external=@tiptap/core';
export * from 'https://esm.sh/@tiptap/extension-link@3?external=@tiptap/core';
