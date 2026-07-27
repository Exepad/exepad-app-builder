import { useHandler } from "@exepad/sdk";

export default function CreateOrderButton() {
  const create = useHandler("createOrder");
  return <button onClick={() => create({})}>Create</button>;
}
