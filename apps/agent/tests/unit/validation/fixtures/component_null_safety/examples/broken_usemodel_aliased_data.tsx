import { useModel } from "@exepad/sdk";

export default function ItemsGrid() {
  const { data: items } = useModel("inventory");
  items.forEach((i) => console.log(i.name));
  return (
    <ul>
      {items.map((i) => (
        <li key={i.id}>{i.name}</li>
      ))}
    </ul>
  );
}
