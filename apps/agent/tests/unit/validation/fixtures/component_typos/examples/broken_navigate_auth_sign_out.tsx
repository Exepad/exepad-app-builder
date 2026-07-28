import { navigate } from "@exepad/sdk";

// Variant: nested auth namespace + hyphenated `sign-out`.
export default function SignOutButton() {
  return <button onClick={() => navigate("/auth/sign-out")}>Sign out</button>;
}
