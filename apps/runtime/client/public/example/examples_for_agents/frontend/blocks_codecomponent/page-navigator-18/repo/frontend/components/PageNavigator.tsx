import {
  React,
  useNavigation,
  useAppState,
  toast,
  Menubar,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarCheckboxItem,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Button,
  Badge,
  Icons,
  cn,
} from "@exepad/sdk";

interface PageInfo {
  id: string;
  title: string;
  slug: string;
  description: string;
  icon: keyof typeof Icons;
}

const PAGES: PageInfo[] = [
  {
    id: "page-home",
    title: "Home",
    slug: "/",
    description: "Landing page with hero section and feature highlights.",
    icon: "Home",
  },
  {
    id: "page-dashboard",
    title: "Dashboard",
    slug: "/dashboard",
    description: "Analytics overview with charts and key metrics.",
    icon: "LayoutDashboard",
  },
  {
    id: "page-settings",
    title: "Settings",
    slug: "/settings",
    description: "User preferences, theme, and account configuration.",
    icon: "Settings",
  },
  {
    id: "page-docs",
    title: "Documentation",
    slug: "/docs",
    description: "API reference and integration guides.",
    icon: "BookOpen",
  },
];

function PageNavigator() {
  const navigation = useNavigation();
  const [currentPage, setCurrentPage] = useAppState<string>("navCurrentPage", "Home");
  const [sidebarVisible, setSidebarVisible] = useAppState<boolean>("navSidebarVisible", true);
  const [zoomLevel, setZoomLevel] = useAppState<string>("navZoomLevel", "100");
  const [lastAction, setLastAction] = useAppState<string>("navLastAction", "None");

  const currentPageTitle = currentPage ?? "Home";

  const handleNavigate = (slug: string) => {
    if (navigation && navigation.navigateTo) {
      navigation.navigateTo(slug);
    }
    const page = PAGES.find((p) => p.slug === slug);
    if (page) {
      setCurrentPage(page.title);
    }
    setLastAction(`Navigated to ${slug}`);
  };

  const handleAction = () => {
    toast("Action Executed: The inline action was triggered successfully.");
    setLastAction("Executed inline toast action");
  };

  const handleEvent = (eventName: string) => {
    toast(`Event triggered: ${eventName}`);
    setLastAction(`Triggered: ${eventName}`);
  };

  return (
    <div className="space-y-6">
      {/* Menubar */}
      <Menubar className="rounded-md border">
        <MenubarMenu>
          <MenubarTrigger className="font-medium">File</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onClick={() => setLastAction("New Page")}>
              <Icons.FilePlus className="mr-2 h-4 w-4" />
              New Page
              <MenubarShortcut>Ctrl+N</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={() => setLastAction("Save")}>
              <Icons.Save className="mr-2 h-4 w-4" />
              Save
              <MenubarShortcut>Ctrl+S</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarSub>
              <MenubarSubTrigger>
                <Icons.Download className="mr-2 h-4 w-4" />
                Export
              </MenubarSubTrigger>
              <MenubarSubContent>
                <MenubarItem onClick={() => setLastAction("Export as PDF")}>
                  PDF Document
                </MenubarItem>
                <MenubarItem onClick={() => setLastAction("Export as HTML")}>
                  HTML File
                </MenubarItem>
                <MenubarItem onClick={() => setLastAction("Export as JSON")}>
                  JSON Config
                </MenubarItem>
              </MenubarSubContent>
            </MenubarSub>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className="font-medium">Edit</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onClick={() => setLastAction("Undo")}>
              <Icons.Undo className="mr-2 h-4 w-4" />
              Undo
              <MenubarShortcut>Ctrl+Z</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={() => setLastAction("Redo")}>
              <Icons.Redo className="mr-2 h-4 w-4" />
              Redo
              <MenubarShortcut>Ctrl+Y</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onClick={() => setLastAction("Cut")}>
              <Icons.Scissors className="mr-2 h-4 w-4" />
              Cut
              <MenubarShortcut>Ctrl+X</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={() => setLastAction("Copy")}>
              <Icons.Copy className="mr-2 h-4 w-4" />
              Copy
              <MenubarShortcut>Ctrl+C</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={() => setLastAction("Paste")}>
              <Icons.Clipboard className="mr-2 h-4 w-4" />
              Paste
              <MenubarShortcut>Ctrl+V</MenubarShortcut>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className="font-medium">View</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onClick={() => setLastAction("Zoom In")}>
              <Icons.ZoomIn className="mr-2 h-4 w-4" />
              Zoom In
              <MenubarShortcut>Ctrl++</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={() => setLastAction("Zoom Out")}>
              <Icons.ZoomOut className="mr-2 h-4 w-4" />
              Zoom Out
              <MenubarShortcut>Ctrl+-</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarCheckboxItem
              checked={sidebarVisible ?? true}
              onCheckedChange={(val: boolean) => setSidebarVisible(val)}
            >
              Show Sidebar
            </MenubarCheckboxItem>
            <MenubarSeparator />
            <MenubarRadioGroup
              value={zoomLevel || "100"}
              onValueChange={(val: string) => setZoomLevel(val)}
            >
              <MenubarRadioItem value="75">75%</MenubarRadioItem>
              <MenubarRadioItem value="100">100%</MenubarRadioItem>
              <MenubarRadioItem value="125">125%</MenubarRadioItem>
              <MenubarRadioItem value="150">150%</MenubarRadioItem>
            </MenubarRadioGroup>
            <MenubarSeparator />
            <MenubarItem onClick={() => setLastAction("Full Screen")}>
              <Icons.Maximize className="mr-2 h-4 w-4" />
              Full Screen
              <MenubarShortcut>F11</MenubarShortcut>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>

      {/* Current Page Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Current Page</CardTitle>
              <CardDescription>
                Current page tracked via useAppState
              </CardDescription>
            </div>
            <Badge variant="default" className="text-sm">
              {currentPageTitle}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Button
              variant="outline"
              className="justify-start"
              onClick={() => handleNavigate("/")}
            >
              <Icons.ArrowLeft className="mr-2 h-4 w-4" />
              Go Home
            </Button>
            <Button
              variant="outline"
              className="justify-start"
              onClick={handleAction}
            >
              <Icons.Zap className="mr-2 h-4 w-4" />
              Execute Action
            </Button>
            <Button
              variant="outline"
              className="justify-start"
              onClick={() => handleEvent("refreshData")}
            >
              <Icons.Send className="mr-2 h-4 w-4" />
              Trigger Event
            </Button>
          </div>
        </CardContent>
        <CardFooter className="text-sm text-muted-foreground">
          <Icons.Activity className="mr-2 h-4 w-4" />
          Last action: {lastAction || "None"}
          {sidebarVisible !== undefined && (
            <span className="ml-4">
              | Sidebar: {sidebarVisible ? "Visible" : "Hidden"} | Zoom: {zoomLevel || "100"}%
            </span>
          )}
        </CardFooter>
      </Card>

      {/* Page Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {PAGES.map((page) => {
          const PageIcon = Icons[page.icon] as React.ComponentType<{ className?: string }>;
          const isCurrent = currentPageTitle.toLowerCase() === page.title.toLowerCase();

          return (
            <Card
              key={page.id}
              className={cn(
                "cursor-pointer transition-all hover:shadow-md hover:border-primary/50",
                isCurrent && "border-primary ring-1 ring-primary/20"
              )}
              onClick={() => handleNavigate(page.slug)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-lg",
                        isCurrent
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {PageIcon && <PageIcon className="h-5 w-5" />}
                    </div>
                    <div>
                      <CardTitle className="text-base">{page.title}</CardTitle>
                      <p className="text-xs text-muted-foreground">{page.slug}</p>
                    </div>
                  </div>
                  {isCurrent && (
                    <Badge variant="secondary" className="text-xs">
                      <Icons.Check className="mr-1 h-3 w-3" />
                      Active
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm text-muted-foreground">{page.description}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default PageNavigator;
