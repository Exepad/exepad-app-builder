import { useApp } from "@exepad/sdk";

export default function ProfilePage() {
  const profile = useApp((s) => s.profile);
  return (
    <div>
      <h1>{profile?.name}</h1>
      <p>{profile?.email}</p>
    </div>
  );
}
