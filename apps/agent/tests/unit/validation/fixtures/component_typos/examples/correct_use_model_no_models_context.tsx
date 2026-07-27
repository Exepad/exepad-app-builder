// No models in FixContext => useModel typo branch is skipped entirely.
import { useModel } from "@exepad/sdk";

export default function OrphanList() {
  const { data } = useModel("oders");
  return <pre>{JSON.stringify(data)}</pre>;
}
