export default function SlidePanel() {
  return (
    <aside
      className="animate-in slide-in-from-right p-4"
      style={{ animationDuration: "var(--animation-duration)" }}
    >
      <p>Side panel</p>
    </aside>
  );
}
