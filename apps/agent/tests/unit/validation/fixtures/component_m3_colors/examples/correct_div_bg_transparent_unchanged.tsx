// bg-transparent on a non-header/nav element is intentional (lets the
// page background show through) — fixer must NOT rewrite.
export default function TransparentCard() {
  return (
    <div className="bg-transparent p-4">
      <p>Floating content</p>
    </div>
  );
}
