import { Icons } from "@/sdk";

// Regression: app ``n1aloggh`` shipped ``Icons.ShieldIcon`` in
// SettingsContent. The validator's lucide catalog lists ``ShieldIcon``
// because lucide-react exports both ``Shield`` and ``ShieldIcon`` as
// aliases of the same component, but the SDK's runtime Proxy resolves
// PascalCase against ``dynamicIconImports`` keys (bare names only).
// ``ShieldIcon`` falls through to ``HelpCircle`` at render time. The
// fixer must strip the ``Icon`` suffix before any other resolution.
export default function AliasSuffixDemo() {
  return (
    <div className="flex items-center gap-2">
      <Icons.ShieldIcon className="h-5 w-5" />
      <span>Secured</span>
    </div>
  );
}
