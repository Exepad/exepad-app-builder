import { useNavigate } from "@exepad/sdk";

export default function NavMenu() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/produkts")}>Products</button>;
}
