// Cross-branch fixture: useApp destructure + useModel data guard +
// useCurrentUser destructured field + broken optional chain — all in
// one component. Each fix message must fire and the second pass must
// be a complete no-op.
import { useApp, useModel, useCurrentUser } from "@exepad/sdk";

export default function Dashboard() {
  const { profile } = useApp();
  const { data } = useModel("orders");
  const { email } = useCurrentUser();
  return (
    <div>
      <h1>{profile.name}</h1>
      <p>{email.toLowerCase()}</p>
      <ul>
        {data.map((o) => (
          <li key={o.id}>
            <span>{o.tags?.[0].toUpperCase()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
