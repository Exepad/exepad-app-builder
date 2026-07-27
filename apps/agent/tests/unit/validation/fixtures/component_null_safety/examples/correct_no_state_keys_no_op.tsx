// No state_keys context => useApp/useModel rewrites cannot trigger.
// Also no useCurrentUser var-bound chains and no broken-?. patterns,
// so the fixer is a complete no-op on this input.
import { useApp } from "@exepad/sdk";

export default function StaticHeader() {
  const { siteName } = useApp();
  return <header>{siteName.toUpperCase()}</header>;
}
