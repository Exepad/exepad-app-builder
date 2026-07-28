import { useCurrentUser } from "@exepad/sdk";

export default function UserBadge() {
  const { email } = useCurrentUser();
  return <span>{email?.toLowerCase()}</span>;
}
