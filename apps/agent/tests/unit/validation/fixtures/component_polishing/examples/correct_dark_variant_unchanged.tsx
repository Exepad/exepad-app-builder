// Variant-prefixed classes use the muted shade ON a dark background
// where it has good contrast. The fixer must NOT rewrite these — that
// would make the dark-mode contrast WORSE.
export default function ThemedLabel() {
  return (
    <div>
      <p className="text-on-surface dark:text-gray-400">Body</p>
      <p className="hover:text-slate-300">Hover muted</p>
      <p className="md:text-zinc-400">Responsive muted</p>
    </div>
  );
}
