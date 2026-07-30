import {
  React,
  useModel,
  useAppState,
  useTheme,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Checkbox,
  Input,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Icons,
  cn,
} from "@exepad/sdk";
import * as TanStackTableM from "@exepad/ext-tanstack-table";

interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  status: "in-stock" | "low-stock" | "out-of-stock";
  sku: string;
  rating: number;
}

const CATEGORIES = ["Electronics", "Clothing", "Home", "Sports", "Books", "Toys"];
const STATUSES: Product["status"][] = ["in-stock", "low-stock", "out-of-stock"];

function generateProducts(count: number): Product[] {
  const names = [
    "Wireless Headphones", "Running Shoes", "Desk Lamp", "Yoga Mat", "Novel Collection",
    "Building Blocks", "Bluetooth Speaker", "Winter Jacket", "Coffee Maker", "Tennis Racket",
    "Science Book", "Board Game", "Smart Watch", "Hiking Boots", "Air Purifier",
    "Dumbbells", "Poetry Anthology", "Puzzle Set", "Tablet Stand", "Rain Coat",
    "Blender", "Soccer Ball", "History Book", "Card Game", "USB Hub",
    "Sneakers", "Toaster", "Jump Rope", "Cookbook", "Action Figure",
  ];
  return names.slice(0, count).map((name, i) => ({
    id: `prod-${i + 1}`,
    name,
    category: CATEGORIES[i % CATEGORIES.length],
    price: Math.round((9.99 + i * 7.5) * 100) / 100,
    stock: i % 5 === 0 ? 0 : i % 3 === 0 ? 3 : 25 + i * 4,
    status: i % 5 === 0 ? "out-of-stock" : i % 3 === 0 ? "low-stock" : "in-stock",
    sku: `SKU-${String(1000 + i)}`,
    rating: Math.round((3 + (i % 20) / 10) * 10) / 10,
  }));
}

const DEMO_PRODUCTS = generateProducts(30);

const STATUS_BADGE: Record<string, string> = {
  "in-stock": "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  "low-stock": "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  "out-of-stock": "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

function HeadlessDataTable() {
  const { resolvedTheme } = useTheme();
  const [globalFilter, setGlobalFilter] = useAppState<string>("tableGlobalFilter", "");
  const [pageIndex, setPageIndex] = useAppState<number>("tablePageIndex", 0);

  const [sorting, setSorting] = React.useState<TanStackTable.SortingState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<TanStackTable.VisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState<Record<string, boolean>>({});

  const columns: TanStackTable.ColumnDef<Product, any>[] = React.useMemo(
    () => [
      {
        id: "select",
        header: ({ table }: { table: TanStackTable.Table<Product> }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected()}
            onCheckedChange={(value: boolean) => table.toggleAllPageRowsSelected(!!value)}
            aria-label="Select all"
          />
        ),
        cell: ({ row }: { row: TanStackTable.Row<Product> }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value: boolean) => row.toggleSelected(!!value)}
            aria-label="Select row"
          />
        ),
        enableSorting: false,
        enableHiding: false,
        size: 40,
      },
      {
        accessorKey: "name",
        header: "Product Name",
        cell: ({ row }: { row: TanStackTable.Row<Product> }) => (
          <span className="font-medium">{row.getValue("name") as string}</span>
        ),
      },
      {
        accessorKey: "sku",
        header: "SKU",
      },
      {
        accessorKey: "category",
        header: "Category",
        cell: ({ row }: { row: TanStackTable.Row<Product> }) => (
          <Badge variant="outline">{row.getValue("category") as string}</Badge>
        ),
      },
      {
        accessorKey: "price",
        header: "Price",
        cell: ({ row }: { row: TanStackTable.Row<Product> }) => (
          <span>${(row.getValue("price") as number).toFixed(2)}</span>
        ),
      },
      {
        accessorKey: "stock",
        header: "Stock",
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }: { row: TanStackTable.Row<Product> }) => {
          const status = row.getValue("status") as string;
          return (
            <Badge className={cn("text-xs", STATUS_BADGE[status])}>
              {status.replace("-", " ")}
            </Badge>
          );
        },
      },
      {
        accessorKey: "rating",
        header: "Rating",
        cell: ({ row }: { row: TanStackTable.Row<Product> }) => {
          const rating = row.getValue("rating") as number;
          return (
            <span className="flex items-center gap-1">
              <Icons.Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
              {rating}
            </span>
          );
        },
      },
    ],
    []
  );

  const table = TanStackTable.useReactTable({
    data: DEMO_PRODUCTS,
    columns,
    state: {
      sorting,
      globalFilter: globalFilter ?? "",
      columnVisibility,
      rowSelection,
      pagination: { pageIndex: pageIndex ?? 0, pageSize: 10 },
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: (val: string) => setGlobalFilter(val),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: (updater: any) => {
      const newState = typeof updater === "function" ? updater({ pageIndex: pageIndex ?? 0, pageSize: 10 }) : updater;
      setPageIndex(newState.pageIndex);
    },
    getCoreRowModel: TanStackTable.getCoreRowModel(),
    getSortedRowModel: TanStackTable.getSortedRowModel(),
    getFilteredRowModel: TanStackTable.getFilteredRowModel(),
    getPaginationRowModel: TanStackTable.getPaginationRowModel(),
  });

  const selectedCount = Object.keys(rowSelection).filter((k) => rowSelection[k]).length;
  const totalPages = table.getPageCount();
  const currentPage = table.getState().pagination.pageIndex;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <CardTitle className="flex items-center gap-2">
              <Icons.Package className="h-5 w-5 text-primary" />
              Products
            </CardTitle>
            {selectedCount > 0 && (
              <Badge variant="secondary">{selectedCount} selected</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Icons.Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search products..."
                className="pl-8 w-[200px] md:w-[260px]"
                value={globalFilter ?? ""}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setGlobalFilter(e.target.value)
                }
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Icons.SlidersHorizontal className="h-4 w-4 mr-1" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {table
                  .getAllColumns()
                  .filter((col) => col.getCanHide())
                  .map((col) => (
                    <DropdownMenuCheckboxItem
                      key={col.id}
                      className="capitalize"
                      checked={col.getIsVisible()}
                      onCheckedChange={(value: boolean) => col.toggleVisibility(!!value)}
                    >
                      {col.id}
                    </DropdownMenuCheckboxItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      className={cn(
                        header.column.getCanSort() && "cursor-pointer select-none"
                      )}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <span className="flex items-center gap-1">
                        {header.isPlaceholder
                          ? null
                          : TanStackTable.flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                        {header.column.getIsSorted() === "asc" && (
                          <Icons.ChevronUp className="h-3.5 w-3.5" />
                        )}
                        {header.column.getIsSorted() === "desc" && (
                          <Icons.ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </span>
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                    className={cn(row.getIsSelected() && "bg-muted/50")}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {TanStackTable.flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No results found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between mt-4 flex-wrap gap-2">
          <span className="text-sm text-muted-foreground">
            Page {currentPage + 1} of {totalPages} ({table.getFilteredRowModel().rows.length} rows)
          </span>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => table.previousPage()}
                  className={cn(!table.getCanPreviousPage() && "pointer-events-none opacity-50")}
                />
              </PaginationItem>
              {Array.from({ length: totalPages }, (_, i) => (
                <PaginationItem key={i}>
                  <PaginationLink
                    isActive={currentPage === i}
                    onClick={() => table.setPageIndex(i)}
                  >
                    {i + 1}
                  </PaginationLink>
                </PaginationItem>
              ))}
              <PaginationItem>
                <PaginationNext
                  onClick={() => table.nextPage()}
                  className={cn(!table.getCanNextPage() && "pointer-events-none opacity-50")}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      </CardContent>
    </Card>
  );
}

export default HeadlessDataTable;
