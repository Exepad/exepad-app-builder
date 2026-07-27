// useNavigation is in the hardcoded SDK_EXPORTS list — function-call
// usage without import should trigger the missing-import auto-add.
import { React } from "@exepad/sdk";

export default function NavLink() {
  const navigate = useNavigation();
  return <button onClick={() => navigate("/about")}>About</button>;
}
