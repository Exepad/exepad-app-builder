import {
  React,
  useAppState,
  useTheme,
  toast,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Badge,
  Textarea,
  Input,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Icons,
  cn,
} from "@exepad/sdk";
import * as Mermaid from "@exepad/ext-mermaid";
import * as KaTeX from "@exepad/ext-katex";

const DIAGRAM_PRESETS: Record<string, { label: string; code: string }> = {
  flowchart: {
    label: "Flowchart",
    code: `flowchart TD
    A[Start] --> B{Is valid?}
    B -->|Yes| C[Process Data]
    B -->|No| D[Show Error]
    C --> E[Transform]
    E --> F[Save to DB]
    F --> G[Send Response]
    D --> H[Log Error]
    H --> I[Return 400]
    G --> J[End]
    I --> J`,
  },
  sequence: {
    label: "Sequence Diagram",
    code: `sequenceDiagram
    participant U as User
    participant F as Frontend
    participant A as API Gateway
    participant S as Service
    participant D as Database

    U->>F: Click Submit
    F->>A: POST /api/data
    A->>A: Validate Token
    A->>S: Forward Request
    S->>D: INSERT record
    D-->>S: OK
    S-->>A: 201 Created
    A-->>F: Response
    F-->>U: Show Success`,
  },
  classDiagram: {
    label: "Class Diagram",
    code: `classDiagram
    class User {
        +String id
        +String name
        +String email
        +login()
        +logout()
    }
    class Order {
        +String id
        +Date createdAt
        +Float total
        +addItem()
        +removeItem()
        +checkout()
    }
    class Product {
        +String id
        +String name
        +Float price
        +Int stock
        +updateStock()
    }
    class OrderItem {
        +String id
        +Int quantity
        +Float subtotal
    }
    User "1" --> "*" Order : places
    Order "1" --> "*" OrderItem : contains
    OrderItem "*" --> "1" Product : references`,
  },
  erDiagram: {
    label: "ER Diagram",
    code: `erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains
    PRODUCT ||--o{ LINE_ITEM : "ordered in"
    CUSTOMER {
        string id PK
        string name
        string email
    }
    ORDER {
        string id PK
        date created_at
        string status
    }
    LINE_ITEM {
        string id PK
        int quantity
        float price
    }
    PRODUCT {
        string id PK
        string name
        float unit_price
    }`,
  },
};

const MATH_PRESETS: { label: string; formula: string }[] = [
  { label: "Quadratic Formula", formula: "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}" },
  { label: "Euler's Identity", formula: "e^{i\\pi} + 1 = 0" },
  { label: "Bayes' Theorem", formula: "P(A|B) = \\frac{P(B|A) \\cdot P(A)}{P(B)}" },
  { label: "Taylor Series", formula: "f(x) = \\sum_{n=0}^{\\infty} \\frac{f^{(n)}(a)}{n!}(x-a)^n" },
  { label: "Fourier Transform", formula: "\\hat{f}(\\xi) = \\int_{-\\infty}^{\\infty} f(x) e^{-2\\pi i x \\xi} dx" },
];

function TechnicalDiagramViewer() {
  const theme = useTheme();
  const [diagramCode, setDiagramCode] = useAppState<string>(
    "diagramCode",
    DIAGRAM_PRESETS.flowchart.code
  );
  const [mathFormula, setMathFormula] = useAppState<string>(
    "mathFormula",
    MATH_PRESETS[0].formula
  );
  const [activePreset, setActivePreset] = useAppState<string>("activePreset", "flowchart");
  const [activeTab, setActiveTab] = useAppState<string>("activeTab", "diagram");

  const isDark = theme.resolvedTheme === "dark";
  const mermaidRef = React.useRef<HTMLDivElement>(null);
  const katexRef = React.useRef<HTMLDivElement>(null);

  const currentCode = diagramCode ?? DIAGRAM_PRESETS.flowchart.code;
  const currentFormula = mathFormula ?? MATH_PRESETS[0].formula;
  const currentPreset = activePreset ?? "flowchart";
  const currentTab = activeTab ?? "diagram";

  // Render Mermaid diagram
  React.useEffect(() => {
    if (!mermaidRef.current || currentTab !== "diagram") return;

    const renderDiagram = async () => {
      try {
        Mermaid.default.initialize({
          startOnLoad: false,
          theme: isDark ? "dark" : "default",
          securityLevel: "loose",
        });

        mermaidRef.current!.innerHTML = "";
        const { svg } = await Mermaid.default.render(
          "mermaid-diagram-" + Date.now(),
          currentCode
        );
        if (mermaidRef.current) {
          mermaidRef.current.innerHTML = svg;
        }
      } catch (err: any) {
        if (mermaidRef.current) {
          mermaidRef.current.innerHTML = `<div class="text-destructive text-sm p-4">Diagram syntax error: ${err.message || "Invalid syntax"}</div>`;
        }
      }
    };

    renderDiagram();
  }, [currentCode, isDark, currentTab]);

  // Render KaTeX formula
  React.useEffect(() => {
    if (!katexRef.current) return;

    try {
      katexRef.current.innerHTML = KaTeX.renderToString(currentFormula, {
        displayMode: true,
        throwOnError: false,
        trust: true,
      });
    } catch {
      katexRef.current.innerHTML =
        '<span class="text-destructive text-sm">Invalid LaTeX formula</span>';
    }
  }, [currentFormula]);

  const handlePresetChange = (preset: string) => {
    setActivePreset(preset);
    if (DIAGRAM_PRESETS[preset]) {
      setDiagramCode(DIAGRAM_PRESETS[preset].code);
    }
  };

  const handleCopySvg = () => {
    if (!mermaidRef.current) return;
    const svg = mermaidRef.current.querySelector("svg");
    if (svg) {
      const svgData = new XMLSerializer().serializeToString(svg);
      navigator.clipboard.writeText(svgData).then(() => {
        toast("SVG copied to clipboard!");
      });
    }
  };

  const handleMathPreset = (formula: string) => {
    setMathFormula(formula);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Left Panel - Editor */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Icons.Edit3 className="h-4 w-4" />
              Editor
            </CardTitle>
            <Select value={currentPreset} onValueChange={handlePresetChange}>
              <SelectTrigger className="w-40 h-8">
                <SelectValue placeholder="Choose preset" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(DIAGRAM_PRESETS).map(([key, preset]) => (
                  <SelectItem key={key} value={key}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">
              Mermaid Diagram Code
            </Label>
            <Textarea
              value={currentCode}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setDiagramCode(e.target.value)
              }
              className="min-h-[250px] font-mono text-sm resize-y"
              placeholder="Enter Mermaid diagram code..."
            />
          </div>

          <div className="border-t pt-4 space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">
              LaTeX Formula
            </Label>
            <Input
              value={currentFormula}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setMathFormula(e.target.value)
              }
              className="font-mono text-sm"
              placeholder="Enter LaTeX formula..."
            />
            <div className="flex flex-wrap gap-1">
              {MATH_PRESETS.map((preset) => (
                <Badge
                  key={preset.label}
                  variant="outline"
                  className="text-xs cursor-pointer hover:bg-muted"
                  onClick={() => handleMathPreset(preset.formula)}
                >
                  {preset.label}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Right Panel - Preview */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Icons.Eye className="h-4 w-4" />
              Preview
            </CardTitle>
            <div className="flex items-center gap-2">
              <Tabs value={currentTab} onValueChange={(v: string) => setActiveTab(v)}>
                <TabsList className="h-8">
                  <TabsTrigger value="diagram" className="text-xs px-3">
                    Diagram
                  </TabsTrigger>
                  <TabsTrigger value="math" className="text-xs px-3">
                    Math
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopySvg}
                className="h-8"
              >
                <Icons.Copy className="mr-1 h-3 w-3" />
                Copy SVG
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {currentTab === "diagram" ? (
            <div
              ref={mermaidRef}
              className={cn(
                "min-h-[300px] rounded-lg border p-4 overflow-auto flex items-center justify-center",
                isDark ? "bg-slate-900/50" : "bg-slate-50"
              )}
            />
          ) : (
            <div className="space-y-4">
              <div
                ref={katexRef}
                className={cn(
                  "min-h-[120px] rounded-lg border p-6 overflow-auto flex items-center justify-center text-2xl",
                  isDark ? "bg-slate-900/50" : "bg-slate-50"
                )}
              />
              <div className="rounded-lg border p-3 bg-muted/30">
                <p className="text-xs text-muted-foreground mb-1">Raw LaTeX:</p>
                <code className="text-xs font-mono break-all">{currentFormula}</code>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 mt-4 pt-3 border-t">
            <Badge variant="secondary" className="text-xs">
              <Icons.FileCode className="mr-1 h-3 w-3" />
              Mermaid
            </Badge>
            <Badge variant="secondary" className="text-xs">
              <Icons.Sigma className="mr-1 h-3 w-3" />
              KaTeX
            </Badge>
            <span className="text-xs text-muted-foreground ml-auto">
              Live preview updates as you type
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default TechnicalDiagramViewer;
