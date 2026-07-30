export default function DebugPanel({ items }) {
  return (
    <div>
      {(console.log("rendering items", items), null)}
      <span>{items.length} items</span>
    </div>
  );
}
