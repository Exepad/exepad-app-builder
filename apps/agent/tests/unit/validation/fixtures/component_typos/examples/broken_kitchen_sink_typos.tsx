import { useHandler, useModel, useNavigate } from "@exepad/sdk";

export default function MultiTypo({ setState }: { setState: (k: string, v: unknown) => void }) {
  const { data } = useModel("oders");
  const create = useHandler("creatOrder");
  const navigate = useNavigate();
  return (
    <div>
      <button onClick={() => setState("selctedItem", data[0])}>Pick</button>
      <button onClick={() => create({})}>New</button>
      <button onClick={() => navigate("/produkts")}>Products</button>
    </div>
  );
}
