import {
  ChevronsUpDown,
  Info,
  LogOut,
  UserRound,
} from "lucide-react";
import { useNavigate } from "react-router";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { ThemeMenuItem } from "@/components/studio/ThemeMenuItem";
import { logout } from "@/services/StudioStream";

/** Initials from an email local-part (e.g. "ada.lovelace@…" → "AL"). */
function initialsFromEmail(email: string): string {
  const local = email.split("@")[0] || email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  const chars =
    parts.length >= 2 ? parts[0][0] + parts[1][0] : local.slice(0, 2);
  return chars.toUpperCase().slice(0, 2) || "U";
}

/** A friendly display name from an email local-part. */
function nameFromEmail(email: string): string {
  const local = email.split("@")[0] || email;
  const words = local.split(/[._-]+/).filter(Boolean);
  return (
    words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || email
  );
}

/**
 * Operator menu for the sidebar footer. OSS has a single local operator (email
 * only — no name, no uploaded avatar, no billing), so this is a stripped-down
 * adaptation of the pro `nav-user.tsx`.
 */
export function NavUser({ email }: { email: string }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const navigate = useNavigate();
  const name = nameFromEmail(email);

  const goProfile = () => {
    setOpenMobile(false);
    navigate("/profile");
  };

  const goTo = (path: string) => {
    setOpenMobile(false);
    navigate(path);
  };

  const handleLogout = async () => {
    setOpenMobile(false);
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarFallback className="rounded-lg">
                  {initialsFromEmail(email)}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{name}</span>
                <span className="truncate text-xs">{email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarFallback className="rounded-lg">
                    {initialsFromEmail(email)}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{name}</span>
                  <span className="truncate text-xs">{email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer" onClick={goProfile}>
              <UserRound />
              Profile
            </DropdownMenuItem>
            <ThemeMenuItem />
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => goTo("/help/about")}
            >
              <Info />
              About
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer" onClick={handleLogout}>
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export default NavUser;
