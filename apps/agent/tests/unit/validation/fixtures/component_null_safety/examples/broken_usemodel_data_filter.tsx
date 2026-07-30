import { useModel } from "@exepad/sdk";

export default function ActiveOrders() {
  const { data } = useModel("orders");
  const active = data.filter((o) => o.status === "active");
  return <span>{active.length} active</span>;
}
