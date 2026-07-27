// Already polished: no console.log, no cn(), no over-the-top hover
// overlay, no tiny font, no low-contrast classes, no animation+duration
// combination without an explicit transition.
export default function CleanPanel() {
  return (
    <section className="bg-surface text-on-surface p-4">
      <h1 className="text-2xl">Welcome</h1>
    </section>
  );
}
