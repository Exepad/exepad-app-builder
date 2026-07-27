import { useHandler } from "@exepad/sdk";

export default function CreateOrderButton() {
  const create = useHandler("creatOrder");
  return <button onClick={() => create({})}>Create</button>;
}
