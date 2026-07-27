import { useModel } from "@exepad/sdk";

export default function OrdersList() {
  const { data } = useModel("orders");
  return <pre>{JSON.stringify(data)}</pre>;
}
