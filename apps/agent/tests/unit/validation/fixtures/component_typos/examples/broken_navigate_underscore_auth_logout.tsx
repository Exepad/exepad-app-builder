import { navigate } from "@exepad/sdk";

// Reproduces the SettingsContent bug from the MovieVault run (2026-05-07):
// LLM hallucinated a Django-shaped logout path. The forbidden_apis fixer
// rewrites window.location to navigate(...) but preserves the path; the
// typos fixer must then normalise the auth-shaped path to /logout BEFORE
// the no-match fallback silently rewrites it to "/" (= dashboard).
export default function SignOutButton() {
  return <button onClick={() => navigate("/_auth/logout")}>Sign out</button>;
}
