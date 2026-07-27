import { navigate } from "@exepad/sdk";

// Symmetric: auth-shaped login path normalises to canonical /login.
export default function SignInLink() {
  return <button onClick={() => navigate("/_auth/sign-in")}>Sign in</button>;
}
