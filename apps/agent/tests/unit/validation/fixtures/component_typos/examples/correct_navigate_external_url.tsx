import { useNavigate } from "@exepad/sdk";

export default function ExternalNav() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("https://github.com/exepad")}>GitHub</button>;
}
