export default function ItemPicker({ setState }: { setState: (k: string, v: unknown) => void }) {
  return <button onClick={() => setState("selctedItem", "abc")}>Pick</button>;
}
