import {
  React,
  useModel,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Checkbox,
  Badge,
  Icons,
  cn,
  toast,
} from "@exepad/sdk";

const COUNTRIES = ["US", "GB", "DE", "CA", "AU", "FR", "BR", "JP", "IN", "NL"];
const CITIES = ["New York", "London", "Berlin", "Toronto", "Sydney", "Paris", "Sao Paulo", "Tokyo", "Mumbai", "Amsterdam"];
const PAGES = ["/", "/pricing", "/features", "/blog/ai-trends", "/docs/quickstart", "/about", "/contact", "/signup", "/api-reference", "/changelog"];
const REFERRERS = ["google.com", "twitter.com", "linkedin.com", "reddit.com", null, null, null, "facebook.com", "bing.com", null];
const AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) Safari/605",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3) Mobile Safari",
  "Mozilla/5.0 (Linux; Android 14) Chrome/122 Mobile",
  null,
];

const DEMO_PAGE_VIEWS = Array.from({ length: 50 }, (_, i) => {
  const day = (i % 28) + 1;
  const ci = i % COUNTRIES.length;
  return {
    id: i + 1,
    page_url: PAGES[i % PAGES.length],
    referrer: REFERRERS[i % REFERRERS.length],
    session_id: `sess-${String(1000 + i).slice(1)}-${Math.random().toString(36).slice(2, 6)}`,
    user_agent: AGENTS[i % AGENTS.length],
    country: COUNTRIES[ci],
    city: CITIES[ci],
    timestamp: `2026-02-${String(day).padStart(2, "0")}T${String(8 + (i % 14)).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}:00Z`,
  };
});

interface ColumnDef {
  key: string;
  label: string;
  width?: string;
}

const DATASETS: Record<string, { label: string; columns: ColumnDef[] }> = {
  page_views: {
    label: "Page Views",
    columns: [
      { key: "id", label: "ID", width: "60px" },
      { key: "page_url", label: "Page URL" },
      { key: "referrer", label: "Referrer" },
      { key: "session_id", label: "Session ID" },
      { key: "country", label: "Country", width: "80px" },
      { key: "city", label: "City" },
      { key: "timestamp", label: "Timestamp" },
    ],
  },
  events: {
    label: "Events",
    columns: [
      { key: "id", label: "ID", width: "60px" },
      { key: "event_name", label: "Event Name" },
      { key: "session_id", label: "Session ID" },
      { key: "user_id_ref", label: "User ID" },
      { key: "timestamp", label: "Timestamp" },
    ],
  },
  revenue_entries: {
    label: "Revenue",
    columns: [
      { key: "id", label: "ID", width: "60px" },
      { key: "amount", label: "Amount" },
      { key: "currency", label: "Currency", width: "80px" },
      { key: "product", label: "Product" },
      { key: "category", label: "Category" },
      { key: "date", label: "Date" },
    ],
  },
  user_sessions: {
    label: "Sessions",
    columns: [
      { key: "id", label: "ID", width: "60px" },
      { key: "session_id", label: "Session ID" },
      { key: "pages_viewed", label: "Pages Viewed", width: "100px" },
      { key: "country", label: "Country", width: "80px" },
      { key: "device_type", label: "Device", width: "90px" },
      { key: "start_time", label: "Start Time" },
    ],
  },
};

function DataExplorer() {
  const pageViewsModel = useModel("page_views");
  const pageViews = (pageViewsModel?.data as any[] | null) ?? DEMO_PAGE_VIEWS;

  const [dataset, setDataset] = React.useState("page_views");
  const [sortKey, setSortKey] = React.useState("id");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc");
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(10);
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [visibleCols, setVisibleCols] = React.useState<Record<string, boolean>>({});

  const currentDataset = DATASETS[dataset];
  const columns = currentDataset?.columns ?? [];

  // Use page_views demo data for all datasets (simplified for demo)
  const rawData = (pageViews ?? DEMO_PAGE_VIEWS) as Record<string, unknown>[];

  // Initialize visible columns when dataset changes
  React.useEffect(() => {
    const vis: Record<string, boolean> = {};
    columns.forEach((c) => { vis[c.key] = true; });
    setVisibleCols(vis);
    setFilters({});
    setPage(0);
    setSortKey("id");
    setSortDir("asc");
  }, [dataset]);

  const activeColumns = columns.filter((c) => visibleCols[c.key] !== false);

  // Filter data
  const filteredData = rawData.filter((row) => {
    return Object.entries(filters).every(([key, val]) => {
      if (!val) return true;
      const cellVal = String(row[key] ?? "").toLowerCase();
      return cellVal.includes(val.toLowerCase());
    });
  });

  // Sort data
  const sortedData = [...filteredData].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    if (typeof aVal === "number" && typeof bVal === "number") {
      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    }
    const cmp = String(aVal).localeCompare(String(bVal));
    return sortDir === "asc" ? cmp : -cmp;
  });

  const totalRows = sortedData.length;
  const totalPages = Math.ceil(totalRows / pageSize);
  const pagedData = sortedData.slice(page * pageSize, (page + 1) * pageSize);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(0);
  };

  const handleFilterChange = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(0);
  };

  const handleToggleColumn = (key: string, checked: boolean) => {
    setVisibleCols((prev) => ({ ...prev, [key]: checked }));
  };

  const handleExportCSV = () => {
    toast(`Exported ${totalRows} rows as CSV`);
  };

  const startRow = page * pageSize + 1;
  const endRow = Math.min((page + 1) * pageSize, totalRows);

  return (
    <div className="p-6 space-y-6">
      {/* Controls Row */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Dataset</Label>
              <Select value={dataset} onValueChange={(v: string) => setDataset(v)}>
                <SelectTrigger className="w-[180px] h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DATASETS).map(([key, ds]) => (
                    <SelectItem key={key} value={key}>{ds.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Page Size</Label>
              <Select value={String(pageSize)} onValueChange={(v: string) => { setPageSize(Number(v)); setPage(0); }}>
                <SelectTrigger className="w-[80px] h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1" />

            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={handleExportCSV}>
              <Icons.Download className="h-3.5 w-3.5" />
              Export CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Column Visibility */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm">Column Visibility</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="flex flex-wrap gap-3">
            {columns.map((col) => (
              <div key={col.key} className="flex items-center gap-1.5">
                <Checkbox
                  id={`col-${col.key}`}
                  checked={visibleCols[col.key] !== false}
                  onCheckedChange={(checked: boolean) => handleToggleColumn(col.key, !!checked)}
                />
                <Label htmlFor={`col-${col.key}`} className="text-xs cursor-pointer">{col.label}</Label>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Data Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="data-table w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {activeColumns.map((col) => (
                  <th
                    key={col.key}
                    className="p-2.5 text-left font-medium text-xs"
                    style={{ width: col.width }}
                    onClick={() => handleSort(col.key)}
                  >
                    <div className="flex items-center gap-1">
                      <span>{col.label}</span>
                      {sortKey === col.key && (
                        sortDir === "asc"
                          ? <Icons.ChevronUp className="h-3 w-3" />
                          : <Icons.ChevronDown className="h-3 w-3" />
                      )}
                    </div>
                  </th>
                ))}
              </tr>
              {/* Filter Row */}
              <tr className="border-b border-border bg-muted/30">
                {activeColumns.map((col) => (
                  <th key={`filter-${col.key}`} className="p-1.5">
                    <Input
                      placeholder={`Filter...`}
                      value={filters[col.key] || ""}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        handleFilterChange(col.key, e.target.value)
                      }
                      className="h-6 text-xs px-1.5"
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedData.length === 0 ? (
                <tr>
                  <td colSpan={activeColumns.length} className="p-8 text-center text-muted-foreground">
                    No data matches your filters
                  </td>
                </tr>
              ) : (
                pagedData.map((row, ri) => (
                  <tr key={ri} className="border-b border-border hover:bg-muted/30 transition-colors">
                    {activeColumns.map((col) => {
                      const val = row[col.key];
                      return (
                        <td key={col.key} className="p-2.5 text-xs max-w-[200px] truncate">
                          {val == null ? (
                            <span className="text-muted-foreground italic">null</span>
                          ) : (
                            String(val)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {totalRows > 0 ? startRow : 0}–{endRow} of {totalRows} rows
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
            className="h-8"
          >
            <Icons.ChevronLeft className="h-4 w-4 mr-1" />
            Prev
          </Button>
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const p = page < 3 ? i : page - 2 + i;
              if (p >= totalPages) return null;
              return (
                <Button
                  key={p}
                  variant={p === page ? "default" : "ghost"}
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => setPage(p)}
                >
                  {p + 1}
                </Button>
              );
            })}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(page + 1)}
            className="h-8"
          >
            Next
            <Icons.ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default DataExplorer;
