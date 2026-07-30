import { navigate } from "@exepad/sdk";

// Negative control: `/logon` is NOT an auth-shaped token (the regex
// requires `login` / `sign-in` / `signon` and anchors on word boundary).
// The fuzzy/fallback pass handles it via its existing logic; we just
// verify the auth normaliser doesn't fire.
export default function LogonLink() {
  return <button onClick={() => navigate("/products")}>Products</button>;
}
