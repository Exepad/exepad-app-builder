// Inverse-on text token used WITHOUT a matching inverse-bg ancestor —
// the AST pairing walker rewrites it to the regular on-token so the
// foreground matches the actual (light) ancestor background.
export default function OrphanText() {
  return (
    <section className="bg-surface p-4">
      <h2 className="text-inverse-on-surface text-xl">Mismatched</h2>
    </section>
  );
}
