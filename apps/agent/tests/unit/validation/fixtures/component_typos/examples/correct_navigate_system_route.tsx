import { useNavigate } from "@exepad/sdk";

export default function LogoutButton() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/logout")}>Sign out</button>;
}
