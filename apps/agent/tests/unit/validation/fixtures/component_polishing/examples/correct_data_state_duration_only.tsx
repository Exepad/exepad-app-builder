// data-[state=...]:duration-N is the shadcn pattern — only triggers on
// state change, not on every render. Must be preserved.
export default function StateDrivenPanel() {
  return (
    <div className="animate-in fade-in data-[state=open]:duration-300 data-[state=closed]:duration-200 p-4">
      <h2>Panel</h2>
    </div>
  );
}
