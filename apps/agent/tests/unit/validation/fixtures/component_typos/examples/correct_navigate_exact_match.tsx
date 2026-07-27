import { useNavigate } from "@exepad/sdk";

export default function NavMenu() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/products")}>Products</button>;
}
