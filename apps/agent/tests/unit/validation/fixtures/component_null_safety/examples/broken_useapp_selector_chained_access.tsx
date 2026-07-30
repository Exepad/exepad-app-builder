import { useApp } from "@exepad/sdk";

export default function AddressPanel() {
  const profile = useApp((s) => s.profile);
  return (
    <div>
      <h2>{profile.address.city}</h2>
      <p>{profile.address.street}</p>
    </div>
  );
}
