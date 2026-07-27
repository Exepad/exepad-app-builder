import { Icons, LightDOMContainer, navigate, React } from "@exepad/sdk";

// Harvested from session-20260414T104520-93b15d (customer onboarding
// tracker).  Exercises the sidebar skill pattern where the background
// comes from a CSS variable in an inline style={{}} prop, NOT a
// className.  The walker recognizes this as an own_bg_token so children
// stay silent; without this handling every sidebar would become a
// false-positive class of its own.
export default function MainSidebar() {
  return (
    <LightDOMContainer>
      <aside
        className="fixed inset-y-0 left-0 w-64 p-6 hidden lg:flex flex-col"
        style={{
          backgroundColor: "var(--color-sidebar, var(--color-primary))",
          color: "var(--color-sidebar-foreground, var(--color-on-primary))",
        }}
      >
        <div className="flex items-center gap-3 mb-10">
          <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center">
            <Icons.Sparkles className="w-5 h-5 text-on-secondary" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-widest text-on-primary opacity-70">
              Onboarding
            </p>
            <p className="text-lg font-semibold text-on-primary">
              Customer Tracker
            </p>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-3 px-4 py-3 rounded-xl text-on-primary font-medium"
          >
            <Icons.LayoutDashboard className="w-4 h-4" />
            Dashboard
          </button>
          <button
            onClick={() => navigate("/accounts")}
            className="flex items-center gap-3 px-4 py-3 rounded-xl text-on-primary font-medium"
          >
            <Icons.Users className="w-4 h-4" />
            Accounts
          </button>
        </nav>
      </aside>
    </LightDOMContainer>
  );
}
