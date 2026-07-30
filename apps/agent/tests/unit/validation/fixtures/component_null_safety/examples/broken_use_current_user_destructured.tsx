import { useCurrentUser } from "@exepad/sdk";

export default function GreetingBar() {
  const { email } = useCurrentUser();
  return <p>Logged in as {email.toLowerCase()}</p>;
}
