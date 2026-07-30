import {
  React,
  useAppState,
  useArrayState,
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  Calendar,
  Button,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Icons,
  cn,
} from "@exepad/sdk";

interface DataRow {
  id: string;
  name: string;
  category: string;
  status: string;
  date: string;
  amount: number;
}

interface ActiveFilter {
  key: string;
  label: string;
  value: string;
}

const DEMO_DATA: DataRow[] = [
  { id: "1", name: "Project Alpha", category: "engineering", status: "active", date: "2025-03-01", amount: 12500 },
  { id: "2", name: "Marketing Q1", category: "marketing", status: "completed", date: "2025-02-15", amount: 8300 },
  { id: "3", name: "Design System", category: "design", status: "active", date: "2025-03-05", amount: 4200 },
  { id: "4", name: "Sales Pipeline", category: "sales", status: "paused", date: "2025-01-20", amount: 15800 },
  { id: "5", name: "Data Migration", category: "engineering", status: "active", date: "2025-03-10", amount: 22000 },
  { id: "6", name: "Brand Refresh", category: "design", status: "completed", date: "2025-02-28", amount: 6700 },
  { id: "7", name: "Customer Research", category: "marketing", status: "active", date: "2025-03-08", amount: 3100 },
  { id: "8", name: "API Integration", category: "engineering", status: "paused", date: "2025-02-10", amount: 18500 },
];

const CATEGORIES = ["engineering", "marketing", "design", "sales"];
const STATUSES = ["active", "completed", "paused"];

const VISIBLE_COLUMNS_DEFAULT: Record<string, boolean> = {
  name: true,
  category: true,
  status: true,
  date: true,
  amount: true,
};

function DataFilterBar() {
  const [searchQuery, setSearchQuery] = useAppState<string>("filterSearch", "");
  const [sortDir, setSortDir] = useAppState<string>("sortDir", "asc");
  const [visibleCols, setVisibleCols] = useAppState<Record<string, boolean>>(
    "visibleCols",
    VISIBLE_COLUMNS_DEFAULT
  );
  const { items: activeFilters, set: setActiveFilters } = useArrayState<ActiveFilter>(
    "activeFilters",
    []
  );
  const { items: selectedItems, set: setSelectedItems } = useArrayState<string>(
    "selectedItems",
    []
  );
  const [dateRange, setDateRange] = useAppState<{ from?: string; to?: string }>(
    "dateRange",
    {}
  );

  const filters = activeFilters ?? [];
  const selected = selectedItems ?? [];
  const cols = visibleCols ?? VISIBLE_COLUMNS_DEFAULT;
  const search = searchQuery ?? "";
  const sort = sortDir ?? "asc";
  const dates = dateRange ?? {};

  const addFilter = (key: string, label: string, value: string) => {
    const existing = filters.find(
      (f: ActiveFilter) => f.key === key && f.value === value
    );
    if (!existing) {
      setActiveFilters([...filters, { key, label, value }]);
    }
  };

  const removeFilter = (key: string, value: string) => {
    setActiveFilters(
      filters.filter((f: ActiveFilter) => !(f.key === key && f.value === value))
    );
  };

  const clearAllFilters = () => {
    setActiveFilters([]);
    setSearchQuery("");
    setDateRange({});
  };

  const toggleColumnVisibility = (col: string) => {
    setVisibleCols({ ...cols, [col]: !cols[col] });
  };

  const toggleSelect = (id: string, shiftKey: boolean) => {
    if (selected.includes(id)) {
      setSelectedItems(selected.filter((s: string) => s !== id));
    } else {
      if (shiftKey) {
        setSelectedItems([...selected, id]);
      } else {
        setSelectedItems([id]);
      }
    }
  };

  // Apply filters to data
  let filteredData = DEMO_DATA.filter((row) => {
    if (search && !row.name.toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    for (const f of filters) {
      if (f.key === "category" && row.category !== f.value) return false;
      if (f.key === "status" && row.status !== f.value) return false;
    }
    if (dates.from && row.date < dates.from) return false;
    if (dates.to && row.date > dates.to) return false;
    return true;
  });

  // Sort
  filteredData = [...filteredData].sort((a, b) => {
    const cmp = a.name.localeCompare(b.name);
    return sort === "asc" ? cmp : -cmp;
  });

  const statusColors: Record<string, string> = {
    active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
    completed: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
    paused: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Icons.Filter className="h-5 w-5" />
            Data Explorer
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <Icons.Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search projects..."
                value={search}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setSearchQuery(e.target.value)
                }
                className="pl-9"
              />
            </div>

            {/* Date range picker via Popover */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  <Icons.Calendar className="mr-2 h-4 w-4" />
                  {dates.from
                    ? `${dates.from}${dates.to ? " - " + dates.to : ""}`
                    : "Date Range"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  onSelect={(date: Date | undefined) => {
                    if (!date) return;
                    const iso = date.toISOString().split("T")[0];
                    if (!dates.from || dates.to) {
                      setDateRange({ from: iso });
                    } else {
                      if (iso < dates.from) {
                        setDateRange({ from: iso, to: dates.from });
                      } else {
                        setDateRange({ ...dates, to: iso });
                      }
                    }
                  }}
                />
              </PopoverContent>
            </Popover>

            {/* Column visibility + Sort dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="relative">
                  <Icons.SlidersHorizontal className="mr-2 h-4 w-4" />
                  View
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Visible Columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {Object.keys(cols).map((col) => (
                  <DropdownMenuCheckboxItem
                    key={col}
                    checked={cols[col]}
                    onCheckedChange={() => toggleColumnVisibility(col)}
                    className="capitalize"
                  >
                    {col}
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Sort Direction</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={sort}
                  onValueChange={(val: string) => setSortDir(val)}
                >
                  <DropdownMenuRadioItem value="asc">
                    Ascending
                    <DropdownMenuShortcut>A-Z</DropdownMenuShortcut>
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="desc">
                    Descending
                    <DropdownMenuShortcut>Z-A</DropdownMenuShortcut>
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Category filter with sub-menus */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="relative">
                  <Icons.Tag className="mr-2 h-4 w-4" />
                  Filters
                  {filters.length > 0 && (
                    <Badge
                      variant="secondary"
                      className="ml-2 h-5 min-w-[20px] text-[10px] px-1.5 rounded-full"
                    >
                      {filters.length}
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Filter by</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Icons.Folder className="mr-2 h-4 w-4" />
                    Category
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {CATEGORIES.map((cat) => (
                      <DropdownMenuItem
                        key={cat}
                        onClick={() => addFilter("category", "Category", cat)}
                        className="capitalize"
                      >
                        {cat}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Icons.CircleDot className="mr-2 h-4 w-4" />
                    Status
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {STATUSES.map((st) => (
                      <DropdownMenuItem
                        key={st}
                        onClick={() => addFilter("status", "Status", st)}
                        className="capitalize"
                      >
                        {st}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onClick={clearAllFilters}
                    disabled={filters.length === 0 && !search && !dates.from}
                  >
                    <Icons.X className="mr-2 h-4 w-4" />
                    Clear all filters
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Active filter badges */}
          {filters.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {filters.map((f: ActiveFilter, idx: number) => (
                <Badge
                  key={`${f.key}-${f.value}-${idx}`}
                  variant="secondary"
                  className="cursor-pointer hover:bg-destructive/10 transition-colors gap-1 capitalize"
                  onClick={() => removeFilter(f.key, f.value)}
                >
                  {f.label}: {f.value}
                  <Icons.X className="h-3 w-3 ml-1" />
                </Badge>
              ))}
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={clearAllFilters}>
                Clear all
              </Button>
            </div>
          )}

          {/* Data table */}
          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  {cols.name && (
                    <th className="text-left p-3 font-medium">Name</th>
                  )}
                  {cols.category && (
                    <th className="text-left p-3 font-medium">Category</th>
                  )}
                  {cols.status && (
                    <th className="text-left p-3 font-medium">Status</th>
                  )}
                  {cols.date && (
                    <th className="text-left p-3 font-medium">Date</th>
                  )}
                  {cols.amount && (
                    <th className="text-right p-3 font-medium">Amount</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredData.length === 0 ? (
                  <tr>
                    <td
                      colSpan={Object.values(cols).filter(Boolean).length}
                      className="text-center py-8 text-muted-foreground"
                    >
                      No results found. Try adjusting your filters.
                    </td>
                  </tr>
                ) : (
                  filteredData.map((row) => (
                    <ContextMenu key={row.id}>
                      <ContextMenuTrigger asChild>
                        <tr
                          className={cn(
                            "border-b transition-colors cursor-pointer",
                            selected.includes(row.id)
                              ? "bg-primary/10"
                              : "hover:bg-muted/30"
                          )}
                          onClick={(e: React.MouseEvent) =>
                            toggleSelect(row.id, e.shiftKey)
                          }
                        >
                          {cols.name && (
                            <td className="p-3 font-medium">{row.name}</td>
                          )}
                          {cols.category && (
                            <td className="p-3 capitalize">{row.category}</td>
                          )}
                          {cols.status && (
                            <td className="p-3">
                              <Badge
                                className={cn(
                                  "text-xs capitalize",
                                  statusColors[row.status]
                                )}
                              >
                                {row.status}
                              </Badge>
                            </td>
                          )}
                          {cols.date && <td className="p-3">{row.date}</td>}
                          {cols.amount && (
                            <td className="p-3 text-right font-mono">
                              ${row.amount.toLocaleString()}
                            </td>
                          )}
                        </tr>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-48">
                        <ContextMenuItem
                          onClick={() => addFilter("category", "Category", row.category)}
                        >
                          <Icons.Filter className="mr-2 h-4 w-4" />
                          Filter by category
                        </ContextMenuItem>
                        <ContextMenuItem
                          onClick={() => addFilter("status", "Status", row.status)}
                        >
                          <Icons.CircleDot className="mr-2 h-4 w-4" />
                          Filter by status
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem>
                          <Icons.Copy className="mr-2 h-4 w-4" />
                          Copy row
                        </ContextMenuItem>
                        <ContextMenuItem>
                          <Icons.Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem className="text-destructive">
                          <Icons.Trash className="mr-2 h-4 w-4" />
                          Delete
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Footer info */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {filteredData.length} of {DEMO_DATA.length} results
              {selected.length > 0 && ` | ${selected.length} selected`}
            </span>
            <span>
              Right-click rows for quick actions
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default DataFilterBar;
