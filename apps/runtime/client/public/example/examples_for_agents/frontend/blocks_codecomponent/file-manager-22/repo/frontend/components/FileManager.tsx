import {
  React,
  useArrayState,
  useAppState,
  toast,
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ButtonGroup,
  ButtonGroupSeparator,
  ButtonGroupText,
  Toggle,
  Button,
  Badge,
  Card,
  CardContent,
  Icons,
  cn,
} from "@exepad/sdk";

interface FileItem {
  id: string;
  name: string;
  type: "folder" | "file";
  extension?: string;
  size?: string;
  modified: string;
  hidden?: boolean;
}

const INITIAL_FILES: FileItem[] = [
  { id: "1", name: "Documents", type: "folder", modified: "2025-03-10" },
  { id: "2", name: "Photos", type: "folder", modified: "2025-03-08" },
  { id: "3", name: "Downloads", type: "folder", modified: "2025-03-12" },
  { id: "4", name: ".config", type: "folder", modified: "2025-02-20", hidden: true },
  { id: "5", name: "report.pdf", type: "file", extension: "pdf", size: "2.4 MB", modified: "2025-03-11" },
  { id: "6", name: "presentation.pptx", type: "file", extension: "pptx", size: "8.1 MB", modified: "2025-03-09" },
  { id: "7", name: "budget.xlsx", type: "file", extension: "xlsx", size: "156 KB", modified: "2025-03-07" },
  { id: "8", name: "notes.md", type: "file", extension: "md", size: "12 KB", modified: "2025-03-12" },
  { id: "9", name: "app.tsx", type: "file", extension: "tsx", size: "4.2 KB", modified: "2025-03-11" },
  { id: "10", name: ".env", type: "file", extension: "env", size: "1 KB", modified: "2025-01-15", hidden: true },
  { id: "11", name: "screenshot.png", type: "file", extension: "png", size: "1.8 MB", modified: "2025-03-06" },
  { id: "12", name: "backup.zip", type: "file", extension: "zip", size: "45 MB", modified: "2025-02-28" },
];

function getFileIcon(file: FileItem): string {
  if (file.type === "folder") return "Folder";
  const ext = file.extension || "";
  if (["png", "jpg", "jpeg", "gif", "svg"].includes(ext)) return "Image";
  if (["pdf"].includes(ext)) return "FileText";
  if (["xlsx", "csv"].includes(ext)) return "Sheet";
  if (["pptx"].includes(ext)) return "Presentation";
  if (["md", "txt"].includes(ext)) return "FileText";
  if (["tsx", "ts", "js", "jsx"].includes(ext)) return "FileCode";
  if (["zip", "tar", "gz"].includes(ext)) return "Archive";
  if (["env"].includes(ext)) return "FileLock";
  return "File";
}

const ICON_MAP: Record<string, any> = {
  Folder: Icons.Folder,
  Image: Icons.Image,
  FileText: Icons.FileText,
  Sheet: Icons.Sheet,
  Presentation: Icons.Presentation,
  FileCode: Icons.FileCode2,
  Archive: Icons.Archive,
  FileLock: Icons.FileLock2,
  File: Icons.File,
};

function FileManager() {
  const { items: files, set: setFiles } = useArrayState<FileItem>("managerFiles", INITIAL_FILES);
  const [viewMode, setViewMode] = useAppState<"grid" | "list" | "details">(
    "viewMode",
    "grid"
  );
  const [selectedIds, setSelectedIds] = useAppState<string[]>("selectedIds", []);
  const [showHidden, setShowHidden] = useAppState<boolean>("showHidden", false);
  const [sortAsc, setSortAsc] = useAppState<boolean>("sortAsc", true);
  const [clipboard, setClipboard] = useAppState<{ action: "copy" | "cut"; ids: string[] } | null>(
    "clipboard",
    null
  );

  const allFiles = files ?? INITIAL_FILES;
  const view = viewMode ?? "grid";
  const selected = selectedIds ?? [];
  const hidden = showHidden ?? false;
  const asc = sortAsc ?? true;
  const clip = clipboard ?? null;

  // Filter and sort
  let visibleFiles = hidden
    ? allFiles
    : allFiles.filter((f: FileItem) => !f.hidden);

  visibleFiles = [...visibleFiles].sort((a, b) => {
    // Folders first
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    const cmp = a.name.localeCompare(b.name);
    return asc ? cmp : -cmp;
  });

  const handleSelect = (id: string, shiftKey: boolean) => {
    if (shiftKey) {
      if (selected.includes(id)) {
        setSelectedIds(selected.filter((s: string) => s !== id));
      } else {
        setSelectedIds([...selected, id]);
      }
    } else {
      setSelectedIds([id]);
    }
  };

  const handleCopy = (ids: string[]) => {
    setClipboard({ action: "copy", ids });
    toast(`Copied ${ids.length} item${ids.length !== 1 ? "s" : ""}`);
  };

  const handleCut = (ids: string[]) => {
    setClipboard({ action: "cut", ids });
    toast(`Cut ${ids.length} item${ids.length !== 1 ? "s" : ""}`);
  };

  const handlePaste = () => {
    if (!clip) return;
    toast(`Pasted ${clip.ids.length} item${clip.ids.length !== 1 ? "s" : ""}`);
    if (clip.action === "cut") {
      setClipboard(null);
    }
  };

  const handleDelete = (ids: string[]) => {
    setFiles(allFiles.filter((f: FileItem) => !ids.includes(f.id)));
    setSelectedIds(selected.filter((s: string) => !ids.includes(s)));
    toast(`Deleted ${ids.length} item${ids.length !== 1 ? "s" : ""}`);
  };

  const handleRename = (id: string) => {
    const file = allFiles.find((f: FileItem) => f.id === id);
    toast(`Rename: ${file?.name ?? id}`);
  };

  const renderFileItem = (file: FileItem) => {
    const iconName = getFileIcon(file);
    const IconComp = ICON_MAP[iconName] || Icons.File;
    const isSelected = selected.includes(file.id);
    const isCut = clip?.action === "cut" && clip.ids.includes(file.id);

    return (
      <ContextMenu key={file.id}>
        <ContextMenuTrigger asChild>
          {view === "grid" ? (
            <div
              className={cn(
                "flex flex-col items-center gap-2 p-4 rounded-lg cursor-pointer transition-all border",
                isSelected
                  ? "bg-primary/10 border-primary/30 ring-1 ring-primary/20"
                  : "bg-card border-transparent hover:bg-muted/50 hover:border-border",
                isCut && "opacity-50",
                file.hidden && "opacity-70"
              )}
              onClick={(e: React.MouseEvent) => handleSelect(file.id, e.shiftKey)}
            >
              <IconComp
                className={cn(
                  "h-10 w-10",
                  file.type === "folder"
                    ? "text-primary"
                    : "text-muted-foreground"
                )}
              />
              <span className="text-xs font-medium text-center truncate w-full">
                {file.name}
              </span>
              {file.size && (
                <span className="text-[10px] text-muted-foreground">
                  {file.size}
                </span>
              )}
            </div>
          ) : view === "list" ? (
            <div
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors",
                isSelected ? "bg-primary/10" : "hover:bg-muted/50",
                isCut && "opacity-50"
              )}
              onClick={(e: React.MouseEvent) => handleSelect(file.id, e.shiftKey)}
            >
              <IconComp
                className={cn(
                  "h-5 w-5 shrink-0",
                  file.type === "folder"
                    ? "text-primary"
                    : "text-muted-foreground"
                )}
              />
              <span className="text-sm font-medium flex-1 truncate">
                {file.name}
              </span>
              {file.size && (
                <span className="text-xs text-muted-foreground shrink-0">
                  {file.size}
                </span>
              )}
            </div>
          ) : (
            <tr
              className={cn(
                "border-b cursor-pointer transition-colors",
                isSelected ? "bg-primary/10" : "hover:bg-muted/30",
                isCut && "opacity-50"
              )}
              onClick={(e: React.MouseEvent) => handleSelect(file.id, e.shiftKey)}
            >
              <td className="p-2">
                <div className="flex items-center gap-2">
                  <IconComp
                    className={cn(
                      "h-4 w-4 shrink-0",
                      file.type === "folder"
                        ? "text-primary"
                        : "text-muted-foreground"
                    )}
                  />
                  <span className="text-sm font-medium truncate">
                    {file.name}
                  </span>
                  {file.hidden && (
                    <Badge variant="outline" className="text-[10px] px-1 h-4">
                      hidden
                    </Badge>
                  )}
                </div>
              </td>
              <td className="p-2 text-sm text-muted-foreground">
                {file.type === "folder" ? "Folder" : (file.extension || "").toUpperCase()}
              </td>
              <td className="p-2 text-sm text-muted-foreground text-right">
                {file.size || "--"}
              </td>
              <td className="p-2 text-sm text-muted-foreground">{file.modified}</td>
            </tr>
          )}
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuItem onClick={() => toast(`Opened "${file.name}"`)}>
            <Icons.ExternalLink className="mr-2 h-4 w-4" />
            Open
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Icons.AppWindow className="mr-2 h-4 w-4" />
              Open With
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem onClick={() => toast(`Opening "${file.name}" in Editor`)}>
                <Icons.Code className="mr-2 h-4 w-4" />
                Editor
              </ContextMenuItem>
              <ContextMenuItem onClick={() => toast(`Opening "${file.name}" in Preview`)}>
                <Icons.Eye className="mr-2 h-4 w-4" />
                Preview
              </ContextMenuItem>
              <ContextMenuItem onClick={() => toast(`Opening "${file.name}" in Terminal`)}>
                <Icons.Terminal className="mr-2 h-4 w-4" />
                Terminal
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => handleCut([file.id])}>
            <Icons.Scissors className="mr-2 h-4 w-4" />
            Cut
            <ContextMenuShortcut>Ctrl+X</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onClick={() => handleCopy([file.id])}>
            <Icons.Copy className="mr-2 h-4 w-4" />
            Copy
            <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onClick={handlePaste} disabled={!clip}>
            <Icons.Clipboard className="mr-2 h-4 w-4" />
            Paste
            <ContextMenuShortcut>Ctrl+V</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => handleRename(file.id)}>
            <Icons.Pencil className="mr-2 h-4 w-4" />
            Rename
          </ContextMenuItem>
          <ContextMenuItem
            className="text-destructive"
            onClick={() => handleDelete([file.id])}
          >
            <Icons.Trash className="mr-2 h-4 w-4" />
            Delete
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => toast(`Properties: ${file.name}`)}>
            <Icons.Info className="mr-2 h-4 w-4" />
            Properties
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6 space-y-4">
          {/* Toolbar */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Icons.HardDrive className="h-5 w-5" />
                File Manager
              </h2>
              <Badge variant="secondary" className="text-xs">
                {visibleFiles.length} items
              </Badge>
              {selected.length > 0 && (
                <Badge variant="outline" className="text-xs">
                  {selected.length} selected
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* View mode buttons */}
              <ButtonGroup>
                <Button
                  variant={view === "grid" ? "default" : "outline"}
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setViewMode("grid")}
                >
                  <Icons.LayoutGrid className="h-4 w-4" />
                </Button>
                <Button
                  variant={view === "list" ? "default" : "outline"}
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setViewMode("list")}
                >
                  <Icons.List className="h-4 w-4" />
                </Button>
                <Button
                  variant={view === "details" ? "default" : "outline"}
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setViewMode("details")}
                >
                  <Icons.Table className="h-4 w-4" />
                </Button>
                <ButtonGroupSeparator />
                <ButtonGroupText className="text-xs text-muted-foreground px-2">
                  View
                </ButtonGroupText>
              </ButtonGroup>

              {/* Toggle buttons */}
              <Toggle
                pressed={hidden}
                onPressedChange={(val: boolean) => setShowHidden(val)}
                size="sm"
                aria-label="Show hidden files"
                className="h-8"
              >
                <Icons.EyeOff className="h-4 w-4 mr-1" />
                <span className="text-xs">Hidden</span>
              </Toggle>

              <Toggle
                pressed={!asc}
                onPressedChange={(val: boolean) => setSortAsc(!val)}
                size="sm"
                aria-label="Sort order"
                className="h-8"
              >
                {asc ? (
                  <Icons.ArrowUpAZ className="h-4 w-4 mr-1" />
                ) : (
                  <Icons.ArrowDownAZ className="h-4 w-4 mr-1" />
                )}
                <span className="text-xs">Sort</span>
              </Toggle>

              {/* Bulk actions */}
              {selected.length > 1 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() => handleCopy(selected)}
                  >
                    <Icons.Copy className="h-3 w-3 mr-1" />
                    Copy ({selected.length})
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-8"
                    onClick={() => handleDelete(selected)}
                  >
                    <Icons.Trash className="h-3 w-3 mr-1" />
                    Delete
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* File grid/list/details */}
          {view === "grid" && (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {visibleFiles.map((file: FileItem) => renderFileItem(file))}
            </div>
          )}

          {view === "list" && (
            <div className="space-y-0.5">
              {visibleFiles.map((file: FileItem) => renderFileItem(file))}
            </div>
          )}

          {view === "details" && (
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 font-medium">Name</th>
                    <th className="text-left p-2 font-medium">Type</th>
                    <th className="text-right p-2 font-medium">Size</th>
                    <th className="text-left p-2 font-medium">Modified</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleFiles.map((file: FileItem) => renderFileItem(file))}
                </tbody>
              </table>
            </div>
          )}

          {/* Status bar */}
          <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
            <span>
              {visibleFiles.length} items
              {!hidden &&
                allFiles.some((f: FileItem) => f.hidden) &&
                ` (${allFiles.filter((f: FileItem) => f.hidden).length} hidden)`}
            </span>
            <div className="flex items-center gap-3">
              {clip && (
                <span className="flex items-center gap-1">
                  <Icons.Clipboard className="h-3 w-3" />
                  {clip.ids.length} item{clip.ids.length !== 1 ? "s" : ""} in clipboard (
                  {clip.action})
                </span>
              )}
              <span>Right-click for actions</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default FileManager;
