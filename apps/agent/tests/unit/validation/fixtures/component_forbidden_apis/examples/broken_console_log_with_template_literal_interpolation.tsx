export default function UserBadge({ user }) {
  console.log(`user=${user.id} role=${user.role}`);
  return <span>{user.name}</span>;
}
