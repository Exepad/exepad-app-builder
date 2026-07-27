import { useCurrentUser } from "@exepad/sdk";

export default function AccountInfo() {
  const { id, email, name } = useCurrentUser();
  return (
    <div>
      <p>Hello, {name.split(" ")[0]}!</p>
      <p>Email: {email.toLowerCase()}</p>
      <small>ID: {id.slice(0, 8)}</small>
    </div>
  );
}
