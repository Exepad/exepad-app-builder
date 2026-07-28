import { useModel } from "@exepad/sdk";

export default function Catalog() {
  const { data } = useModel("books");
  return (
    <ul>
      {(data ?? []).map((b) => (
        <li key={b.id}>{b.title}</li>
      ))}
    </ul>
  );
}
