import {
  React,
  useModel,
  useNavigation,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Input,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Icons,
  cn,
  toast,
} from "@exepad/sdk";

const DEMO_SUBMISSIONS = [
  { id: 1, form_type: "contact", submitted_by: "alice@example.com", status: "reviewed", created_at: "2026-03-25T10:30:00Z", data: '{"name":"Alice Johnson","subject":"General","priority":"Normal"}' },
  { id: 2, form_type: "registration", submitted_by: "bob@company.com", status: "pending", created_at: "2026-03-26T14:15:00Z", data: '{"firstName":"Bob","lastName":"Smith","company":"TechCorp"}' },
  { id: 3, form_type: "feedback", submitted_by: "carol@example.com", status: "reviewed", created_at: "2026-03-26T16:45:00Z", data: '{"rating":5,"category":"Product"}' },
  { id: 4, form_type: "contact", submitted_by: "david@startup.io", status: "pending", created_at: "2026-03-27T09:00:00Z", data: '{"name":"David Lee","subject":"Partnership","priority":"High"}' },
  { id: 5, form_type: "registration", submitted_by: "emma@design.co", status: "reviewed", created_at: "2026-03-27T11:20:00Z", data: '{"firstName":"Emma","lastName":"Wilson","company":"DesignCo"}' },
  { id: 6, form_type: "feedback", submitted_by: "frank@example.com", status: "archived", created_at: "2026-03-24T08:00:00Z", data: '{"rating":3,"category":"Support"}' },
  { id: 7, form_type: "contact", submitted_by: "grace@enterprise.com", status: "pending", created_at: "2026-03-28T07:30:00Z", data: '{"name":"Grace Kim","subject":"Sales","priority":"High"}' },
  { id: 8, form_type: "feedback", submitted_by: "henry@example.com", status: "pending", created_at: "2026-03-28T08:45:00Z", data: '{"rating":4,"category":"Feature"}' },
  { id: 9, form_type: "registration", submitted_by: "ivy@analytics.com", status: "reviewed", created_at: "2026-03-27T15:00:00Z", data: '{"firstName":"Ivy","lastName":"Chen","company":"DataAnalytics Inc"}' },
  { id: 10, form_type: "contact", submitted_by: "jack@freelance.dev", status: "archived", created_at: "2026-03-23T12:00:00Z", data: '{"name":"Jack Turner","subject":"Support","priority":"Low"}' },
  { id: 11, form_type: "feedback", submitted_by: "karen@tech.co", status: "pending", created_at: "2026-03-28T09:15:00Z", data: '{"rating":5,"category":"Product"}' },
  { id: 12, form_type: "registration", submitted_by: "leo@startup.io", status: "pending", created_at: "2026-03-28T10:00:00Z", data: '{"firstName":"Leo","lastName":"Martinez","company":"StartupIO"}' },
];

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  reviewed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  archived: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300",
};

const TYPE_COLORS: Record<string, string> = {
  contact: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  registration: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  feedback: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
};

const PAGE_SIZE = 8;

function SubmissionsList() {
  const navigation = useNavigation();
  const submissionsModel = useModel("submissions");
  const submissions = (submissionsModel?.data as any[] | null) ?? DEMO_SUBMISSIONS;

  const [typeFilter, setTypeFilter] = React.useState("all");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);

  const filtered = submissions.filter((sub) => {
    if (typeFilter !== "all" && sub.form_type !== typeFilter) return false;
    if (statusFilter !== "all" && sub.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !(sub.submitted_by || "").toLowerCase().includes(q) &&
        !(sub.form_type || "").toLowerCase().includes(q) &&
        !(sub.data || "").toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const getPreview = (dataStr: string) => {
    try {
      const obj = JSON.parse(dataStr);
      if (obj.name) return obj.name;
      if (obj.firstName) return `${obj.firstName} ${obj.lastName || ""}`.trim();
      if (obj.rating) return `Rating: ${obj.rating}/5`;
      return "—";
    } catch {
      return "—";
    }
  };

  return (
    <div className="p-6 space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base">All Submissions</CardTitle>
            <Badge variant="secondary">{filtered.length} results</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-wrap gap-3">
            <div className="w-40">
              <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1); }}>
                <SelectTrigger><SelectValue placeholder="All Types" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="contact">Contact</SelectItem>
                  <SelectItem value="registration">Registration</SelectItem>
                  <SelectItem value="feedback">Feedback</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-40">
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
                <SelectTrigger><SelectValue placeholder="All Statuses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="reviewed">Reviewed</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <Input
                placeholder="Search submissions..."
                value={search}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setSearch(e.target.value); setPage(1); }}
                className="w-full"
              />
            </div>
          </div>

          {/* Table */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">ID</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Preview</TableHead>
                <TableHead>Submitted By</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.map((sub) => (
                <TableRow key={sub.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">#{sub.id}</TableCell>
                  <TableCell>
                    <Badge className={cn("text-xs capitalize", TYPE_COLORS[sub.form_type] || "")}>
                      {sub.form_type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm max-w-[200px] truncate">{getPreview(sub.data || "{}")}</TableCell>
                  <TableCell className="text-sm">{sub.submitted_by}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {sub.created_at ? new Date(sub.created_at).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge className={cn("text-xs capitalize", STATUS_COLORS[sub.status] || "")}>
                      {sub.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm">
                      <Icons.Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {paginated.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No submissions found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <Icons.ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <Icons.ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default SubmissionsList;
