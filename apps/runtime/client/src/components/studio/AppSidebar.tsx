import * as React from "react";
import { Layers3, Settings } from "lucide-react";
import { Link, useLocation } from "react-router";

import { NavUser } from "@/components/studio/NavUser";
import { Logo } from "@/components/studio/Logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

type NavItem = {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Active when the current path starts with this prefix. */
  match: (pathname: string) => boolean;
};

const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: "Manage",
    items: [
      {
        title: "Apps",
        url: "/apps",
        icon: Layers3,
        match: (p) => p === "/apps" || p.startsWith("/apps"),
      },
    ],
  },
  {
    label: "Workspace",
    items: [
      {
        title: "Settings",
        url: "/settings",
        icon: Settings,
        match: (p) => p.startsWith("/settings"),
      },
    ],
  },
];

export function AppSidebar({
  email,
  ...props
}: { email: string } & React.ComponentProps<typeof Sidebar>) {
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <div className="flex h-12 items-center justify-between gap-2 px-1 group-data-[collapsible=icon]:justify-center">
          <Link
            to="/apps"
            onClick={() => setOpenMobile(false)}
            className="flex items-center group-data-[collapsible=icon]:hidden"
            aria-label="Exepad"
          >
            <Logo size="md" />
          </Link>
          <SidebarTrigger />
        </div>
      </SidebarHeader>

      <SidebarContent>
        {NAV.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={item.match(pathname)}
                      tooltip={item.title}
                    >
                      <Link to={item.url} onClick={() => setOpenMobile(false)}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <NavUser email={email} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

export default AppSidebar;
