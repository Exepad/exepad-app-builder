import { useApp } from "@exepad/sdk";

export default function Dashboard() {
  const { profile, filters, tags } = useApp();
  return (
    <div>
      <h1>{profile.name}</h1>
      <p>Filter: {filters.region}</p>
      <span>Tag: {tags.join(", ")}</span>
    </div>
  );
}
