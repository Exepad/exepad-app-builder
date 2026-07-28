import { useApp } from "@exepad/sdk";

export default function StatusBanner() {
  const userName = useApp((s) => s.userName);
  return (
    <div>
      <p>{userName.length > 0 ? userName : "Guest"}</p>
    </div>
  );
}
