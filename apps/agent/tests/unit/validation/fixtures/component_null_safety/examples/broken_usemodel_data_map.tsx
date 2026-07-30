import { useModel } from "@exepad/sdk";

export default function ProductsList() {
  const { data } = useModel("products");
  return (
    <ul>
      {data.map((p) => (
        <li key={p.id}>{p.name}</li>
      ))}
    </ul>
  );
}
