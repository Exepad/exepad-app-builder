import { useHandler, useModel, useNavigate } from "@exepad/sdk";

export default function Clean({ setState }: { setState: (k: string, v: unknown) => void }) {
  const { data } = useModel("orders");
  const create = useHandler("createOrder");
  const navigate = useNavigate();
  return (
    <div>
      <button onClick={() => setState("selectedItem", data[0])}>Pick</button>
      <button onClick={() => create({})}>New</button>
      <button onClick={() => navigate("/products")}>Products</button>
    </div>
  );
}
