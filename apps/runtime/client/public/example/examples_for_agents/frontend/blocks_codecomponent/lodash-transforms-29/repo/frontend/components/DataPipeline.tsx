import {
  React,
  useAppState,
  _,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Badge,
  Button,
  Input,
  Icons,
  cn,
} from "@exepad/sdk";

interface Employee {
  id: number;
  name: string;
  dept: string;
  salary: number;
  joined: string;
  rating: number;
}

const RAW_DATA: Employee[] = [
  { id: 1, name: "Alice Chen", dept: "Engineering", salary: 125000, joined: "2021-03-15", rating: 4.8 },
  { id: 2, name: "Bob Martinez", dept: "Marketing", salary: 85000, joined: "2020-07-22", rating: 3.9 },
  { id: 3, name: "Carol Smith", dept: "Engineering", salary: 135000, joined: "2019-01-10", rating: 4.5 },
  { id: 4, name: "Dave Johnson", dept: "Design", salary: 95000, joined: "2022-05-01", rating: 4.2 },
  { id: 5, name: "Eve Williams", dept: "Marketing", salary: 78000, joined: "2023-02-14", rating: 3.1 },
  { id: 6, name: "Frank Brown", dept: "Engineering", salary: 145000, joined: "2018-11-30", rating: 4.9 },
  { id: 7, name: "Grace Lee", dept: "Design", salary: 105000, joined: "2021-08-19", rating: 4.6 },
  { id: 8, name: "Hank Davis", dept: "Sales", salary: 72000, joined: "2022-12-05", rating: 3.5 },
  { id: 9, name: "Ivy Taylor", dept: "Engineering", salary: 115000, joined: "2020-04-18", rating: 4.3 },
  { id: 10, name: "Jack Wilson", dept: "Sales", salary: 68000, joined: "2023-06-20", rating: 2.8 },
  { id: 11, name: "Karen Moore", dept: "Marketing", salary: 92000, joined: "2019-09-12", rating: 4.1 },
  { id: 12, name: "Leo Garcia", dept: "Design", salary: 88000, joined: "2021-11-25", rating: 3.7 },
  { id: 13, name: "Mia Anderson", dept: "Engineering", salary: 130000, joined: "2020-02-08", rating: 4.7 },
  { id: 14, name: "Nick Thomas", dept: "Sales", salary: 75000, joined: "2022-08-15", rating: 3.3 },
  { id: 15, name: "Olivia Jackson", dept: "Marketing", salary: 88000, joined: "2021-06-30", rating: 4.0 },
  { id: 16, name: "Pete White", dept: "Engineering", salary: 140000, joined: "2018-05-22", rating: 4.4 },
  { id: 17, name: "Quinn Harris", dept: "Design", salary: 98000, joined: "2023-01-09", rating: 3.8 },
  { id: 18, name: "Rita Clark", dept: "Sales", salary: 71000, joined: "2022-03-17", rating: 3.0 },
  { id: 19, name: "Sam Lewis", dept: "Marketing", salary: 82000, joined: "2020-10-04", rating: 3.6 },
  { id: 20, name: "Tina Robinson", dept: "Engineering", salary: 128000, joined: "2019-07-28", rating: 4.6 },
];

function DataPipeline() {
  const [searchQuery, setSearchQuery] = useAppState<string>("pipelineSearch", "");
  const [activeStep, setActiveStep] = useAppState<string | null>("activeStep", null);

  const query = searchQuery ?? "";

  const debouncedFilter = React.useMemo(() => {
    return _.debounce((val: string) => setSearchQuery(val), 300);
  }, [setSearchQuery]);

  React.useEffect(() => {
    return () => {
      debouncedFilter.cancel();
    };
  }, [debouncedFilter]);

  const filteredData = React.useMemo(() => {
    if (!query) return RAW_DATA;
    const q = query.toLowerCase();
    return RAW_DATA.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.dept.toLowerCase().includes(q)
    );
  }, [query]);

  // Step 1: groupBy
  const grouped = React.useMemo(() => _.groupBy(filteredData, "dept"), [filteredData]);

  // Step 2: sortBy salary
  const sorted = React.useMemo(() => _.sortBy(filteredData, "salary"), [filteredData]);

  // Step 3: filter rating > 3
  const highRated = React.useMemo(
    () => _.filter(filteredData, (e) => e.rating > 3),
    [filteredData]
  );

  // Step 4: map transform
  const mapped = React.useMemo(
    () =>
      _.map(filteredData, (e) => ({
        label: `${e.name} (${e.dept})`,
        salary: `$${e.salary.toLocaleString()}`,
        rating: e.rating,
      })),
    [filteredData]
  );

  // Step 5: reduce — avg salary per dept
  const avgByDept = React.useMemo(() => {
    const groups = _.groupBy(filteredData, "dept");
    return _.mapValues(groups, (employees) => ({
      count: employees.length,
      avgSalary: Math.round(_.meanBy(employees, "salary")),
      avgRating: Number(_.meanBy(employees, "rating").toFixed(2)),
      totalSalary: _.sumBy(employees, "salary"),
    }));
  }, [filteredData]);

  // Step 6: uniqBy dept
  const uniqueDepts = React.useMemo(
    () => _.uniqBy(filteredData, "dept"),
    [filteredData]
  );

  // Step 7: chunk
  const chunked = React.useMemo(
    () => _.chunk(filteredData, 5),
    [filteredData]
  );

  const formatCurrency = (val: number) => `$${val.toLocaleString()}`;

  return (
    <div className="space-y-6">
      {/* Search */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icons.Database className="h-5 w-5" />
            Data Transformation Pipeline
          </CardTitle>
          <CardDescription>
            Interactive visualization of lodash transformations on employee data.
            Each step shows input, transformation, and output.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Icons.Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search employees by name or department (debounced)..."
              defaultValue={query}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                debouncedFilter(e.target.value)
              }
              className="max-w-md"
            />
            <Badge variant="secondary">{filteredData.length} records</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Raw Data Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Raw Data</CardTitle>
          <CardDescription>
            {filteredData.length} employee records
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-64 overflow-auto border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Dept</TableHead>
                  <TableHead className="text-right">Salary</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Rating</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredData.map((emp) => (
                  <TableRow key={emp.id}>
                    <TableCell className="text-muted-foreground">{emp.id}</TableCell>
                    <TableCell className="font-medium">{emp.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{emp.dept}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(emp.salary)}</TableCell>
                    <TableCell className="text-muted-foreground">{emp.joined}</TableCell>
                    <TableCell className="text-right">
                      <span className={cn(emp.rating > 4 ? "text-green-600" : emp.rating > 3 ? "text-yellow-600" : "text-red-600")}>
                        {emp.rating}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Transformation Steps */}
      <Accordion
        type="single"
        collapsible
        value={activeStep ?? undefined}
        onValueChange={(val: string) => setActiveStep(val || null)}
      >
        {/* Step 1: groupBy */}
        <AccordionItem value="step-1">
          <AccordionTrigger>
            <div className="flex items-center gap-3">
              <Badge>Step 1</Badge>
              <code className="text-sm font-mono">_.groupBy(data, "dept")</code>
              <Badge variant="secondary">{Object.keys(grouped).length} groups</Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              {Object.entries(grouped).map(([dept, employees]) => (
                <Card key={dept}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Badge>{dept}</Badge>
                      <span className="text-muted-foreground font-normal">
                        {(employees as Employee[]).length} employees
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1 text-sm">
                      {(employees as Employee[]).map((e) => (
                        <li key={e.id} className="flex justify-between">
                          <span>{e.name}</span>
                          <span className="text-muted-foreground">{formatCurrency(e.salary)}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Step 2: sortBy */}
        <AccordionItem value="step-2">
          <AccordionTrigger>
            <div className="flex items-center gap-3">
              <Badge>Step 2</Badge>
              <code className="text-sm font-mono">_.sortBy(data, "salary")</code>
              <Badge variant="secondary">ascending order</Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="border rounded-lg overflow-auto max-h-64 pt-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rank</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Dept</TableHead>
                    <TableHead className="text-right">Salary</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((emp, idx) => (
                    <TableRow key={emp.id}>
                      <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="font-medium">{emp.name}</TableCell>
                      <TableCell><Badge variant="outline">{emp.dept}</Badge></TableCell>
                      <TableCell className="text-right">{formatCurrency(emp.salary)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Step 3: filter */}
        <AccordionItem value="step-3">
          <AccordionTrigger>
            <div className="flex items-center gap-3">
              <Badge>Step 3</Badge>
              <code className="text-sm font-mono">_.filter(data, e =&gt; e.rating &gt; 3)</code>
              <Badge variant="secondary">
                {highRated.length} / {filteredData.length} pass
              </Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="border rounded-lg overflow-auto max-h-64 pt-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Dept</TableHead>
                    <TableHead className="text-right">Rating</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {highRated.map((emp) => (
                    <TableRow key={emp.id}>
                      <TableCell className="font-medium">{emp.name}</TableCell>
                      <TableCell><Badge variant="outline">{emp.dept}</Badge></TableCell>
                      <TableCell className="text-right text-green-600">{emp.rating}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          <Icons.Check className="h-3 w-3 mr-1" />
                          Pass
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Step 4: map */}
        <AccordionItem value="step-4">
          <AccordionTrigger>
            <div className="flex items-center gap-3">
              <Badge>Step 4</Badge>
              <code className="text-sm font-mono">_.map(data, e =&gt; label + salary)</code>
              <Badge variant="secondary">{mapped.length} items</Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="border rounded-lg overflow-auto max-h-64 pt-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead className="text-right">Salary</TableHead>
                    <TableHead className="text-right">Rating</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mapped.map((item, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{item.label}</TableCell>
                      <TableCell className="text-right">{item.salary}</TableCell>
                      <TableCell className="text-right">{item.rating}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Step 5: reduce / aggregate */}
        <AccordionItem value="step-5">
          <AccordionTrigger>
            <div className="flex items-center gap-3">
              <Badge>Step 5</Badge>
              <code className="text-sm font-mono">_.groupBy + _.meanBy + _.sumBy</code>
              <Badge variant="secondary">aggregated stats</Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              {Object.entries(avgByDept).map(([dept, stats]) => (
                <Card key={dept}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{dept}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Employees:</span>{" "}
                        <span className="font-medium">{stats.count}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Avg Salary:</span>{" "}
                        <span className="font-medium">{formatCurrency(stats.avgSalary)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Avg Rating:</span>{" "}
                        <span className="font-medium">{stats.avgRating}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Total Salary:</span>{" "}
                        <span className="font-medium">{formatCurrency(stats.totalSalary)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Step 6: uniqBy */}
        <AccordionItem value="step-6">
          <AccordionTrigger>
            <div className="flex items-center gap-3">
              <Badge>Step 6</Badge>
              <code className="text-sm font-mono">_.uniqBy(data, "dept")</code>
              <Badge variant="secondary">{uniqueDepts.length} unique depts</Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-wrap gap-3 pt-2">
              {uniqueDepts.map((emp) => (
                <Card key={emp.id} className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Badge>{emp.dept}</Badge>
                    <span className="text-sm text-muted-foreground">
                      first: {emp.name}
                    </span>
                  </div>
                </Card>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Step 7: chunk */}
        <AccordionItem value="step-7">
          <AccordionTrigger>
            <div className="flex items-center gap-3">
              <Badge>Step 7</Badge>
              <code className="text-sm font-mono">_.chunk(data, 5)</code>
              <Badge variant="secondary">{chunked.length} chunks</Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              {chunked.map((chunk, ci) => (
                <Card key={ci}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">
                      Chunk {ci + 1}
                      <Badge variant="secondary" className="ml-2">
                        {chunk.length} items
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {chunk.map((emp) => (
                        <Badge key={emp.id} variant="outline">
                          {emp.name}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

export default DataPipeline;
