import { useApp } from "@exepad/sdk";

export default function Header() {
  const { userName } = useApp();
  return <header>{userName.toUpperCase()}</header>;
}
