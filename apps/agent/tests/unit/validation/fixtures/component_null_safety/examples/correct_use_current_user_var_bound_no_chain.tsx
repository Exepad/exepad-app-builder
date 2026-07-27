import { useCurrentUser } from "@exepad/sdk";

export default function UserGreeting() {
  const user = useCurrentUser();
  return <p>{user.email}</p>;
}
