import { useModel } from "@exepad/sdk";

export default function OrdersList() {
  const { data } = useModel("oders");
  return <pre>{JSON.stringify(data)}</pre>;
}
