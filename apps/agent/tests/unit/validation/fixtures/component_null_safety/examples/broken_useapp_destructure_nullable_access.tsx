import { useApp } from "@exepad/sdk";

export default function ProfileCard() {
  const { profile } = useApp();
  return (
    <article>
      <h1>{profile.name}</h1>
      <p>{profile.email}</p>
    </article>
  );
}
