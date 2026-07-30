import {
  React,
  useAppState,
  useNavigation,
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuContent,
  NavigationMenuTrigger,
  NavigationMenuLink,
  navigationMenuTriggerStyle,
  Item,
  ItemMedia,
  ItemContent,
  ItemActions,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
  ItemDescription,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  Button,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Icons,
  cn,
} from "@exepad/sdk";

interface FileItem {
  id: string;
  name: string;
  type: "folder" | "document" | "image" | "spreadsheet" | "presentation";
  size?: string;
  modified: string;
  shared?: boolean;
  starred?: boolean;
}

interface FolderData {
  files: FileItem[];
}

const FILE_ICON_MAP: Record<string, keyof typeof Icons> = {
  folder: "Folder",
  document: "FileText",
  image: "Image",
  spreadsheet: "Sheet",
  presentation: "Presentation",
};

const FILE_COLOR_MAP: Record<string, string> = {
  folder: "text-blue-500",
  document: "text-red-500",
  image: "text-green-500",
  spreadsheet: "text-emerald-600",
  presentation: "text-orange-500",
};

const FOLDER_TREE: Record<string, FolderData> = {
  Home: {
    files: [
      { id: "f1", name: "Documents", type: "folder", modified: "Mar 10, 2026" },
      { id: "f2", name: "Images", type: "folder", modified: "Mar 8, 2026" },
      { id: "f3", name: "Downloads", type: "folder", modified: "Mar 12, 2026" },
      { id: "f4", name: "readme.txt", type: "document", size: "2.4 KB", modified: "Mar 5, 2026" },
      { id: "f5", name: "notes.txt", type: "document", size: "1.1 KB", modified: "Feb 28, 2026" },
    ],
  },
  Documents: {
    files: [
      { id: "d1", name: "Projects", type: "folder", modified: "Mar 9, 2026" },
      { id: "d2", name: "Reports", type: "folder", modified: "Mar 7, 2026" },
      { id: "d3", name: "resume.pdf", type: "document", size: "245 KB", modified: "Mar 1, 2026", starred: true },
      { id: "d4", name: "cover-letter.docx", type: "document", size: "18 KB", modified: "Feb 25, 2026" },
      { id: "d5", name: "budget-2026.xlsx", type: "spreadsheet", size: "156 KB", modified: "Mar 3, 2026", shared: true },
    ],
  },
  Projects: {
    files: [
      { id: "p1", name: "Design", type: "folder", modified: "Mar 8, 2026" },
      { id: "p2", name: "Engineering", type: "folder", modified: "Mar 6, 2026" },
      { id: "p3", name: "project-plan.xlsx", type: "spreadsheet", size: "89 KB", modified: "Mar 4, 2026", shared: true },
      { id: "p4", name: "meeting-notes.docx", type: "document", size: "34 KB", modified: "Mar 2, 2026" },
    ],
  },
  Design: {
    files: [
      { id: "ds1", name: "wireframes.fig", type: "image", size: "12.4 MB", modified: "Mar 7, 2026", starred: true },
      { id: "ds2", name: "brand-guidelines.pdf", type: "document", size: "3.8 MB", modified: "Mar 5, 2026", shared: true },
      { id: "ds3", name: "presentation-q1.pptx", type: "presentation", size: "8.2 MB", modified: "Mar 3, 2026" },
      { id: "ds4", name: "mockup-v2.png", type: "image", size: "1.7 MB", modified: "Mar 1, 2026" },
      { id: "ds5", name: "color-palette.svg", type: "image", size: "24 KB", modified: "Feb 28, 2026" },
      { id: "ds6", name: "icon-set.zip", type: "document", size: "5.1 MB", modified: "Feb 20, 2026" },
    ],
  },
  Engineering: {
    files: [
      { id: "e1", name: "architecture.md", type: "document", size: "15 KB", modified: "Mar 6, 2026", starred: true },
      { id: "e2", name: "api-spec.yaml", type: "document", size: "42 KB", modified: "Mar 4, 2026", shared: true },
      { id: "e3", name: "database-schema.sql", type: "document", size: "8 KB", modified: "Mar 2, 2026" },
    ],
  },
  Reports: {
    files: [
      { id: "r1", name: "q1-report.pdf", type: "document", size: "1.2 MB", modified: "Mar 7, 2026" },
      { id: "r2", name: "analytics-feb.xlsx", type: "spreadsheet", size: "340 KB", modified: "Mar 1, 2026", shared: true },
      { id: "r3", name: "annual-review.pptx", type: "presentation", size: "4.5 MB", modified: "Feb 15, 2026" },
    ],
  },
  Images: {
    files: [
      { id: "i1", name: "photo-001.jpg", type: "image", size: "3.2 MB", modified: "Mar 8, 2026" },
      { id: "i2", name: "screenshot.png", type: "image", size: "890 KB", modified: "Mar 6, 2026" },
      { id: "i3", name: "banner.svg", type: "image", size: "45 KB", modified: "Mar 4, 2026" },
    ],
  },
  Downloads: {
    files: [
      { id: "dl1", name: "installer.dmg", type: "document", size: "125 MB", modified: "Mar 12, 2026" },
      { id: "dl2", name: "dataset.csv", type: "spreadsheet", size: "22 MB", modified: "Mar 10, 2026" },
    ],
  },
};

const PATH_PARENTS: Record<string, string[]> = {
  Home: [],
  Documents: ["Home"],
  Images: ["Home"],
  Downloads: ["Home"],
  Projects: ["Home", "Documents"],
  Reports: ["Home", "Documents"],
  Design: ["Home", "Documents", "Projects"],
  Engineering: ["Home", "Documents", "Projects"],
};

const SECTIONS = ["All Files", "Recent", "Shared", "Trash"] as const;

const QUICK_ACCESS: Record<string, { name: string; icon: keyof typeof Icons; description: string }[]> = {
  "All Files": [
    { name: "Documents", icon: "FileText", description: "Word docs, PDFs, text files" },
    { name: "Images", icon: "Image", description: "Photos, screenshots, graphics" },
    { name: "Spreadsheets", icon: "Sheet", description: "Excel, CSV, data files" },
    { name: "Presentations", icon: "Presentation", description: "Slides and decks" },
  ],
  Recent: [
    { name: "Today", icon: "Clock", description: "Files modified today" },
    { name: "This Week", icon: "Calendar", description: "Files from this week" },
    { name: "This Month", icon: "CalendarDays", description: "Files from this month" },
  ],
  Shared: [
    { name: "Shared with Me", icon: "Users", description: "Files others shared" },
    { name: "Shared by Me", icon: "Share2", description: "Files you shared" },
  ],
};

function DocumentBrowser() {
  const navigation = useNavigation();
  const [currentPath, setCurrentPath] = useAppState<string[]>("browserPath", ["Home"]);
  const [activeSection, setActiveSection] = useAppState<string>("activeSection", "All Files");

  const path = currentPath ?? ["Home"];
  const section = activeSection ?? "All Files";
  const currentFolder = path[path.length - 1];
  const folderData = FOLDER_TREE[currentFolder] || { files: [] };

  const fullPath = [
    ...(PATH_PARENTS[currentFolder] || []),
    currentFolder,
  ];

  const navigateToFolder = (folderName: string) => {
    const parentPath = PATH_PARENTS[folderName] || [];
    setCurrentPath([...parentPath, folderName]);
  };

  const handleBreadcrumbClick = (index: number) => {
    const targetFolder = fullPath[index];
    navigateToFolder(targetFolder);
  };

  const handleFileClick = (file: FileItem) => {
    if (file.type === "folder") {
      navigateToFolder(file.name);
    }
  };

  const getFileIcon = (type: string) => {
    const iconName = FILE_ICON_MAP[type] || "File";
    return Icons[iconName] as React.ComponentType<{ className?: string }>;
  };

  const showEllipsis = fullPath.length > 3;
  const visibleStart = showEllipsis ? [fullPath[0]] : fullPath.slice(0, -1);
  const hiddenItems = showEllipsis ? fullPath.slice(1, -2) : [];
  const visibleEnd = showEllipsis ? fullPath.slice(-2) : [];
  const breadcrumbItems = showEllipsis
    ? [...visibleStart, "...", ...visibleEnd]
    : fullPath;

  const folders = folderData.files.filter((f) => f.type === "folder");
  const files = folderData.files.filter((f) => f.type !== "folder");

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <NavigationMenu>
          <NavigationMenuList>
            {SECTIONS.map((sec) => {
              const quickItems = QUICK_ACCESS[sec];
              if (!quickItems) {
                return (
                  <NavigationMenuItem key={sec}>
                    <NavigationMenuLink
                      className={cn(
                        navigationMenuTriggerStyle(),
                        section === sec && "bg-accent text-accent-foreground"
                      )}
                      onClick={() => setActiveSection(sec)}
                    >
                      {sec}
                    </NavigationMenuLink>
                  </NavigationMenuItem>
                );
              }
              return (
                <NavigationMenuItem key={sec}>
                  <NavigationMenuTrigger
                    className={cn(
                      section === sec && "bg-accent text-accent-foreground"
                    )}
                    onClick={() => setActiveSection(sec)}
                  >
                    {sec}
                  </NavigationMenuTrigger>
                  <NavigationMenuContent>
                    <div className="grid w-[400px] gap-3 p-4 md:w-[500px] md:grid-cols-2">
                      {quickItems.map((item) => {
                        const QIcon = Icons[item.icon] as React.ComponentType<{
                          className?: string;
                        }>;
                        return (
                          <NavigationMenuLink
                            key={item.name}
                            className="block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-hidden transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground cursor-pointer"
                          >
                            <div className="flex items-center gap-2">
                              {QIcon && (
                                <QIcon className="h-4 w-4 text-muted-foreground" />
                              )}
                              <div className="text-sm font-medium leading-none">
                                {item.name}
                              </div>
                            </div>
                            <p className="line-clamp-2 text-sm leading-snug text-muted-foreground">
                              {item.description}
                            </p>
                          </NavigationMenuLink>
                        );
                      })}
                    </div>
                  </NavigationMenuContent>
                </NavigationMenuItem>
              );
            })}
          </NavigationMenuList>
        </NavigationMenu>

        <Breadcrumb>
          <BreadcrumbList>
            {breadcrumbItems.map((item, index) => {
              if (item === "...") {
                return (
                  <React.Fragment key="ellipsis">
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <DropdownMenu>
                        <DropdownMenuTrigger className="flex items-center gap-1">
                          <BreadcrumbEllipsis />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          {hiddenItems.map((hidden) => (
                            <DropdownMenuItem
                              key={hidden}
                              onClick={() => navigateToFolder(hidden)}
                            >
                              {hidden}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </BreadcrumbItem>
                  </React.Fragment>
                );
              }

              const isLast =
                index === breadcrumbItems.length - 1;
              const actualIndex = showEllipsis
                ? item === fullPath[0]
                  ? 0
                  : fullPath.indexOf(item)
                : index;

              return (
                <React.Fragment key={item}>
                  {index > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbItem>
                    {isLast ? (
                      <BreadcrumbPage>{item}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink
                        onClick={() => handleBreadcrumbClick(actualIndex)}
                        className="cursor-pointer"
                      >
                        {item}
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                </React.Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">
              {currentFolder}
              <Badge variant="secondary" className="ml-2 text-xs">
                {folderData.files.length} items
              </Badge>
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm">
                <Icons.Upload className="h-4 w-4 mr-1" />
                Upload
              </Button>
              <Button variant="outline" size="sm">
                <Icons.FolderPlus className="h-4 w-4 mr-1" />
                New Folder
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {folders.length > 0 && (
              <ItemGroup>
                {folders.map((file) => {
                  const FileIcon = getFileIcon(file.type);
                  const colorClass = FILE_COLOR_MAP[file.type] || "text-muted-foreground";
                  return (
                    <Item
                      key={file.id}
                      className="cursor-pointer hover:bg-accent/50 rounded-md transition-colors"
                      onClick={() => handleFileClick(file)}
                    >
                      <ItemMedia>
                        <FileIcon className={cn("h-8 w-8", colorClass)} />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle className="font-medium">
                          {file.name}
                        </ItemTitle>
                        <ItemDescription>
                          Modified {file.modified}
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions>
                        <Icons.ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </ItemActions>
                    </Item>
                  );
                })}
              </ItemGroup>
            )}

            {folders.length > 0 && files.length > 0 && <ItemSeparator />}

            {files.length > 0 && (
              <ItemGroup>
                {files.map((file) => {
                  const FileIcon = getFileIcon(file.type);
                  const colorClass = FILE_COLOR_MAP[file.type] || "text-muted-foreground";
                  return (
                    <Item key={file.id} className="rounded-md">
                      <ItemMedia>
                        <FileIcon className={cn("h-8 w-8", colorClass)} />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle className="font-medium">
                          {file.name}
                          {file.starred && (
                            <Icons.Star className="inline h-3 w-3 ml-1 text-yellow-500 fill-yellow-500" />
                          )}
                          {file.shared && (
                            <Badge variant="outline" className="ml-2 text-[10px] px-1 py-0">
                              Shared
                            </Badge>
                          )}
                        </ItemTitle>
                        <ItemDescription>
                          {file.size} &middot; Modified {file.modified}
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <Icons.Download className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <Icons.Share2 className="h-4 w-4" />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <Icons.MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem>
                              <Icons.Pencil className="h-4 w-4 mr-2" /> Rename
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                              <Icons.Copy className="h-4 w-4 mr-2" /> Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                              <Icons.FolderInput className="h-4 w-4 mr-2" /> Move to
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive">
                              <Icons.Trash2 className="h-4 w-4 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </ItemActions>
                    </Item>
                  );
                })}
              </ItemGroup>
            )}

            {folderData.files.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Icons.FolderOpen className="h-12 w-12 mb-3" />
                <p className="text-sm font-medium">This folder is empty</p>
                <p className="text-xs mt-1">Upload files or create a new folder to get started</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default DocumentBrowser;
