import {
  React,
  useModel,
  useHandler,
  useTheme,
  toast,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Badge,
  Input,
  Icons,
  cn,
} from "@exepad/sdk";
import * as AgGridM from "@exepad/ext-ag-grid";

interface Employee {
  id: number;
  name: string;
  email: string;
  department: string;
  salary: number;
  startDate: string;
  status: string;
}

const DEPARTMENTS = ["Engineering", "Marketing", "Sales", "HR", "Finance", "Operations"];
const STATUSES = ["Active", "On Leave", "Remote", "Contract"];
const FIRST_NAMES = ["James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael", "Linda", "David", "Elizabeth", "William", "Barbara", "Richard", "Susan", "Joseph", "Jessica", "Thomas", "Sarah", "Charles", "Karen", "Christopher", "Lisa", "Daniel", "Nancy", "Matthew", "Betty", "Anthony", "Margaret", "Mark", "Sandra", "Donald", "Ashley", "Steven", "Kimberly", "Paul", "Emily", "Andrew", "Donna", "Joshua", "Michelle", "Kenneth", "Carol", "Kevin", "Amanda", "Brian", "Dorothy", "George", "Melissa", "Timothy", "Deborah"];
const LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson", "White", "Harris"];

function generateEmployees(count: number): Employee[] {
  const employees: Employee[] = [];
  for (let i = 0; i < count; i++) {
    const fn = FIRST_NAMES[i % FIRST_NAMES.length];
    const ln = LAST_NAMES[i % LAST_NAMES.length];
    const dept = DEPARTMENTS[i % DEPARTMENTS.length];
    const year = 2018 + (i % 7);
    const month = (i % 12) + 1;
    employees.push({
      id: i + 1,
      name: `${fn} ${ln}`,
      email: `${fn.toLowerCase()}.${ln.toLowerCase()}@company.com`,
      department: dept,
      salary: 55000 + Math.floor((i * 1731) % 95000),
      startDate: `${year}-${String(month).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
      status: STATUSES[i % STATUSES.length],
    });
  }
  return employees;
}

const DEMO_EMPLOYEES = generateEmployees(50);

function EnterpriseDataGrid() {
  const theme = useTheme();
  const isDark = theme.resolvedTheme === "dark";
  // In a real app: const { data: employees } = useModel("employees");
  const updateEmployee = useHandler("updateEmployee");
  const gridRef = React.useRef<any>(null);
  const [quickFilter, setQuickFilter] = React.useState("");
  const [showFilters, setShowFilters] = React.useState(true);
  const [visibleColumns, setVisibleColumns] = React.useState<Record<string, boolean>>({
    name: true,
    email: true,
    department: true,
    salary: true,
    startDate: true,
    status: true,
  });

  const columnDefs = React.useMemo(
    () => [
      {
        field: "name",
        headerName: "Name",
        sortable: true,
        filter: showFilters,
        editable: true,
        minWidth: 160,
        hide: !visibleColumns.name,
      },
      {
        field: "email",
        headerName: "Email",
        sortable: true,
        filter: showFilters,
        editable: true,
        minWidth: 220,
        hide: !visibleColumns.email,
      },
      {
        field: "department",
        headerName: "Department",
        sortable: true,
        filter: showFilters,
        editable: true,
        minWidth: 140,
        hide: !visibleColumns.department,
        cellEditor: "agSelectCellEditor",
        cellEditorParams: { values: DEPARTMENTS },
      },
      {
        field: "salary",
        headerName: "Salary",
        sortable: true,
        filter: showFilters ? "agNumberColumnFilter" : false,
        editable: true,
        minWidth: 120,
        hide: !visibleColumns.salary,
        valueFormatter: (params: any) =>
          params.value != null ? `$${params.value.toLocaleString()}` : "",
      },
      {
        field: "startDate",
        headerName: "Start Date",
        sortable: true,
        filter: showFilters,
        editable: true,
        minWidth: 130,
        hide: !visibleColumns.startDate,
      },
      {
        field: "status",
        headerName: "Status",
        sortable: true,
        filter: showFilters,
        editable: true,
        minWidth: 120,
        hide: !visibleColumns.status,
        cellEditor: "agSelectCellEditor",
        cellEditorParams: { values: STATUSES },
        cellRenderer: (params: any) => {
          const colorMap: Record<string, string> = {
            Active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
            "On Leave": "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
            Remote: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
            Contract: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
          };
          return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colorMap[params.value] || ""}">${params.value}</span>`;
        },
      },
    ],
    [showFilters, visibleColumns]
  );

  const defaultColDef = React.useMemo(
    () => ({
      resizable: true,
      flex: 1,
    }),
    []
  );

  const onCellValueChanged = React.useCallback(
    (event: any) => {
      updateEmployee({ id: event.data.id, field: event.colDef.field, value: event.newValue });
      toast({
        title: "Employee Updated",
        description: `${event.data.name}'s ${event.colDef.headerName} has been updated.`,
      });
    },
    [updateEmployee]
  );

  const handleExport = () => {
    gridRef.current?.api?.exportDataAsCsv({ fileName: "employees.csv" });
    toast({ title: "Export Complete", description: "Employee data exported as CSV." });
  };

  const toggleColumn = (col: string) => {
    setVisibleColumns((prev) => ({ ...prev, [col]: !prev[col] }));
  };

  const themeClass = isDark ? "ag-theme-alpine-dark" : "ag-theme-alpine";

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <CardTitle className="flex items-center gap-2">
                <Icons.Table className="h-5 w-5" />
                Employee Directory
              </CardTitle>
              <Badge variant="secondary" className="text-xs">
                {DEMO_EMPLOYEES.length} records
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Icons.Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Quick filter..."
                  value={quickFilter}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setQuickFilter(e.target.value)
                  }
                  className="pl-8 h-8 w-48 text-sm"
                />
              </div>
              <Button
                variant={showFilters ? "secondary" : "outline"}
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
              >
                <Icons.Filter className="h-4 w-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Icons.Columns className="h-4 w-4 mr-1" />
                    Columns
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {Object.entries(visibleColumns).map(([col, visible]) => (
                    <DropdownMenuCheckboxItem
                      key={col}
                      checked={visible}
                      onCheckedChange={() => toggleColumn(col)}
                    >
                      {col.charAt(0).toUpperCase() + col.slice(1).replace(/([A-Z])/g, " $1")}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Icons.Download className="h-4 w-4 mr-1" />
                Export
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className={cn(themeClass, "rounded-lg overflow-hidden border")} style={{ height: 520, width: "100%" }}>
            <AgGrid.AgGridReact
              ref={gridRef}
              rowData={DEMO_EMPLOYEES}
              columnDefs={columnDefs}
              defaultColDef={defaultColDef}
              pagination={true}
              paginationPageSize={10}
              paginationPageSizeSelector={[10, 20, 50]}
              animateRows={true}
              onCellValueChanged={onCellValueChanged}
              quickFilterText={quickFilter}
              suppressMovableColumns={false}
              enableCellTextSelection={true}
              rowSelection="multiple"
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Double-click a cell to edit. Changes are saved automatically via the updateEmployee handler.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default EnterpriseDataGrid;
