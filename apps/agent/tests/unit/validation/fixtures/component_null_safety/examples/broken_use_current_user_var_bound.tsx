import { useCurrentUser } from "@exepad/sdk";

export default function UserMenu() {
  const user = useCurrentUser();
  return (
    <button>
      {user.email.split("@")[0]}
    </button>
  );
}
