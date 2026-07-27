import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router";

import { AppSidebar } from "@/components/studio/AppSidebar";
import { Logo } from "@/components/studio/Logo";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { authMe } from "@/services/StudioStream";

export interface StudioOutletContext {
  email: string;
}

/**
 * Sidebar shell that wraps the operator dashboard pages (/apps, /settings).
 * Centralizes the auth guard that each page used to duplicate and exposes the
 * operator email to children via Outlet context.
 *
 * The Studio builder (/studio) and /login stay full-bleed (outside this shell).
 */
export default function StudioShell() {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const user = await authMe();
      if (cancelled) return;
      if (!user) {
        navigate("/login", { replace: true });
        return;
      }
      setEmail(user.email);
      setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (checking || !email) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading…</div>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar email={email} />
      <SidebarInset>
        {/* Mobile-only bar: on mobile the sidebar is a sheet, so it needs a
            visible trigger. On desktop the sidebar header trigger + rail handle
            collapse, so no top toolbar is rendered. */}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 md:hidden">
          <SidebarTrigger />
          <Logo size="sm" />
        </header>
        <div className="flex-1 overflow-y-auto">
          <Outlet context={{ email } satisfies StudioOutletContext} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
