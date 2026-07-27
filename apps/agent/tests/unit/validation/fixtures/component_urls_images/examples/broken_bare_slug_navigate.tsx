import { useNavigate } from "@/sdk";

export default function NavMenu() {
  const navigate = useNavigate();
  return (
    <nav>
      <button onClick={() => navigate("products")}>Products</button>
      <button onClick={() => navigate("about")}>About</button>
    </nav>
  );
}
