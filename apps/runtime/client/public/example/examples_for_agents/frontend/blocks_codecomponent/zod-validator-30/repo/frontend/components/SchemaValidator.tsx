import {
  React,
  useAppState,
  toast,
  z,
  useForm,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Checkbox,
  Button,
  Label,
  Alert,
  AlertTitle,
  AlertDescription,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  Badge,
  Separator,
  Icons,
  cn,
} from "@exepad/sdk";

type FieldType = "string" | "number" | "boolean" | "email" | "url" | "enum" | "array";

interface SchemaField {
  id: string;
  name: string;
  type: FieldType;
  required: boolean;
  min: string;
  max: string;
  enumValues: string;
  customMessage: string;
}

interface ValidationError {
  path: string;
  message: string;
}

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: "string", label: "String" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Boolean" },
  { value: "email", label: "Email" },
  { value: "url", label: "URL" },
  { value: "enum", label: "Enum" },
  { value: "array", label: "Array (strings)" },
];

const DEFAULT_FIELDS: SchemaField[] = [
  { id: "f1", name: "username", type: "string", required: true, min: "3", max: "20", enumValues: "", customMessage: "Username must be 3-20 characters" },
  { id: "f2", name: "email", type: "email", required: true, min: "", max: "", enumValues: "", customMessage: "" },
  { id: "f3", name: "age", type: "number", required: true, min: "18", max: "120", enumValues: "", customMessage: "Must be at least 18" },
  { id: "f4", name: "website", type: "url", required: false, min: "", max: "", enumValues: "", customMessage: "" },
  { id: "f5", name: "role", type: "enum", required: true, min: "", max: "", enumValues: "admin,editor,viewer", customMessage: "" },
  { id: "f6", name: "acceptTerms", type: "boolean", required: true, min: "", max: "", enumValues: "", customMessage: "You must accept the terms" },
];

function buildZodSchema(fields: SchemaField[]) {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of fields) {
    let schema: z.ZodTypeAny;
    const msg = field.customMessage || undefined;

    switch (field.type) {
      case "string": {
        let s = z.string({ required_error: msg });
        if (field.min) s = s.min(parseInt(field.min, 10), msg);
        if (field.max) s = s.max(parseInt(field.max, 10), msg);
        schema = s;
        break;
      }
      case "number": {
        let n = z.coerce.number({ required_error: msg });
        if (field.min) n = n.min(parseInt(field.min, 10), msg);
        if (field.max) n = n.max(parseInt(field.max, 10), msg);
        schema = n;
        break;
      }
      case "boolean":
        schema = z.boolean({ required_error: msg });
        break;
      case "email":
        schema = z.string({ required_error: msg }).email(msg || "Invalid email address");
        break;
      case "url":
        schema = z.string({ required_error: msg }).url(msg || "Invalid URL");
        break;
      case "enum": {
        const values = field.enumValues
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);
        if (values.length >= 2) {
          schema = z.enum([values[0], ...values.slice(1)] as [string, ...string[]], {
            required_error: msg,
          });
        } else {
          schema = z.string({ required_error: msg });
        }
        break;
      }
      case "array":
        schema = z.array(z.string()).min(1, msg || "At least one item required");
        break;
      default:
        schema = z.string();
    }

    if (!field.required && field.type !== "boolean") {
      schema = schema.optional();
    }

    shape[field.name] = schema;
  }

  return z.object(shape);
}

function generateSchemaCode(fields: SchemaField[]): string {
  const lines = fields.map((field) => {
    let line = `  ${field.name}: z`;
    switch (field.type) {
      case "string":
        line += ".string()";
        if (field.min) line += `.min(${field.min})`;
        if (field.max) line += `.max(${field.max})`;
        break;
      case "number":
        line += ".coerce.number()";
        if (field.min) line += `.min(${field.min})`;
        if (field.max) line += `.max(${field.max})`;
        break;
      case "boolean":
        line += ".boolean()";
        break;
      case "email":
        line += '.string().email()';
        break;
      case "url":
        line += '.string().url()';
        break;
      case "enum": {
        const vals = field.enumValues.split(",").map((v) => `"${v.trim()}"`).join(", ");
        line += `.enum([${vals}])`;
        break;
      }
      case "array":
        line += ".array(z.string()).min(1)";
        break;
    }
    if (!field.required && field.type !== "boolean") line += ".optional()";
    return line + ",";
  });
  return `const schema = z.object({\n${lines.join("\n")}\n});`;
}

let nextId = 100;

function SchemaValidator() {
  const [fields, setFields] = useAppState<SchemaField[]>("schemaFields", DEFAULT_FIELDS);
  const [errors, setErrors] = useAppState<ValidationError[]>("validationErrors", []);
  const [isValid, setIsValid] = useAppState<boolean | null>("validationResult", null);
  const [testData, setTestData] = React.useState<Record<string, string>>({});

  const activeFields = fields ?? DEFAULT_FIELDS;
  const activeErrors = errors ?? [];
  const validResult = isValid ?? null;

  // New field state
  const [newName, setNewName] = React.useState("");
  const [newType, setNewType] = React.useState<FieldType>("string");

  const handleAddField = () => {
    if (!newName.trim()) return;
    const field: SchemaField = {
      id: `f${++nextId}`,
      name: newName.trim().replace(/\s+/g, "_").toLowerCase(),
      type: newType,
      required: true,
      min: "",
      max: "",
      enumValues: newType === "enum" ? "option1,option2,option3" : "",
      customMessage: "",
    };
    setFields([...activeFields, field]);
    setNewName("");
    setNewType("string");
  };

  const handleRemoveField = (id: string) => {
    setFields(activeFields.filter((f) => f.id !== id));
  };

  const handleUpdateField = (id: string, key: keyof SchemaField, value: string | boolean) => {
    setFields(
      activeFields.map((f) =>
        f.id === id ? { ...f, [key]: value } : f
      )
    );
  };

  const handleTestDataChange = (name: string, value: string) => {
    setTestData((prev) => ({ ...prev, [name]: value }));
  };

  const handleValidate = () => {
    const schema = buildZodSchema(activeFields);
    const parsed: Record<string, unknown> = {};

    for (const field of activeFields) {
      const val = testData[field.name] ?? "";
      if (field.type === "boolean") {
        parsed[field.name] = val === "true";
      } else if (field.type === "number") {
        parsed[field.name] = val ? Number(val) : undefined;
      } else if (field.type === "array") {
        parsed[field.name] = val
          ? val.split(",").map((s) => s.trim())
          : [];
      } else {
        parsed[field.name] = val || undefined;
      }
    }

    const result = schema.safeParse(parsed);

    if (result.success) {
      setIsValid(true);
      setErrors([]);
      toast("Validation passed! All fields are valid.");
    } else {
      setIsValid(false);
      const errs: ValidationError[] = result.error.issues.map((issue) => ({
        path: issue.path.join(".") || "root",
        message: issue.message,
      }));
      setErrors(errs);
    }
  };

  const schemaCode = generateSchemaCode(activeFields);

  return (
    <div className="space-y-6">
      {/* Schema Definition */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icons.Shield className="h-5 w-5" />
            Schema Builder
          </CardTitle>
          <CardDescription>
            Define fields and constraints to build a Zod validation schema interactively.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {activeFields.map((field) => (
            <div
              key={field.id}
              className="flex flex-wrap items-start gap-3 p-3 border rounded-lg"
            >
              <div className="flex-1 min-w-[140px] space-y-1">
                <Label className="text-xs text-muted-foreground">Name</Label>
                <Input
                  value={field.name}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    handleUpdateField(field.id, "name", e.target.value)
                  }
                  className="h-8 text-sm"
                />
              </div>
              <div className="w-32 space-y-1">
                <Label className="text-xs text-muted-foreground">Type</Label>
                <Select
                  value={field.type}
                  onValueChange={(val: string) =>
                    handleUpdateField(field.id, "type", val)
                  }
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPES.map((ft) => (
                      <SelectItem key={ft.value} value={ft.value}>
                        {ft.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {(field.type === "string" || field.type === "number") && (
                <>
                  <div className="w-20 space-y-1">
                    <Label className="text-xs text-muted-foreground">Min</Label>
                    <Input
                      value={field.min}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        handleUpdateField(field.id, "min", e.target.value)
                      }
                      className="h-8 text-sm"
                      placeholder="—"
                    />
                  </div>
                  <div className="w-20 space-y-1">
                    <Label className="text-xs text-muted-foreground">Max</Label>
                    <Input
                      value={field.max}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        handleUpdateField(field.id, "max", e.target.value)
                      }
                      className="h-8 text-sm"
                      placeholder="—"
                    />
                  </div>
                </>
              )}
              {field.type === "enum" && (
                <div className="flex-1 min-w-[160px] space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Values (comma-separated)
                  </Label>
                  <Input
                    value={field.enumValues}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      handleUpdateField(field.id, "enumValues", e.target.value)
                    }
                    className="h-8 text-sm"
                    placeholder="opt1,opt2,opt3"
                  />
                </div>
              )}
              <div className="flex items-center gap-2 pt-5">
                <Checkbox
                  checked={field.required}
                  onCheckedChange={(checked: boolean) =>
                    handleUpdateField(field.id, "required", checked)
                  }
                />
                <Label className="text-xs">Required</Label>
              </div>
              <div className="pt-5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive"
                  onClick={() => handleRemoveField(field.id)}
                >
                  <Icons.Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}

          <Separator />

          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Field Name</Label>
              <Input
                value={newName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setNewName(e.target.value)
                }
                placeholder="new_field"
                className="h-8"
              />
            </div>
            <div className="w-32 space-y-1">
              <Label className="text-xs">Type</Label>
              <Select
                value={newType}
                onValueChange={(val: string) => setNewType(val as FieldType)}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((ft) => (
                    <SelectItem key={ft.value} value={ft.value}>
                      {ft.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={handleAddField} className="h-8">
              <Icons.Plus className="mr-1 h-3 w-3" />
              Add Field
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Schema Preview */}
      <Accordion type="single" collapsible>
        <AccordionItem value="schema-preview">
          <AccordionTrigger>
            <div className="flex items-center gap-2">
              <Icons.Code className="h-4 w-4" />
              Schema Preview
              <Badge variant="secondary">{activeFields.length} fields</Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <pre className="bg-muted p-4 rounded-lg text-sm font-mono overflow-x-auto whitespace-pre">
              {schemaCode}
            </pre>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="advanced">
          <AccordionTrigger>
            <div className="flex items-center gap-2">
              <Icons.Settings className="h-4 w-4" />
              Advanced Options
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-3 p-2">
              <div className="space-y-1">
                <Label className="text-sm font-medium">Custom Message per Field</Label>
                <p className="text-xs text-muted-foreground">
                  Set a custom error message for each field that overrides the default Zod messages.
                </p>
                <div className="space-y-2 mt-2">
                  {activeFields.map((field) => (
                    <div key={field.id} className="flex items-center gap-2">
                      <Badge variant="outline" className="min-w-[100px] justify-center">
                        {field.name}
                      </Badge>
                      <Input
                        value={field.customMessage}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          handleUpdateField(field.id, "customMessage", e.target.value)
                        }
                        placeholder="Custom error message..."
                        className="h-8 text-sm"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Test Data Panel */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icons.FlaskConical className="h-5 w-5" />
            Test Data
          </CardTitle>
          <CardDescription>
            Enter test values and validate against the schema above.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {activeFields.map((field) => (
              <div key={field.id} className="space-y-1">
                <Label className="text-sm flex items-center gap-1">
                  {field.name}
                  {field.required && (
                    <span className="text-destructive">*</span>
                  )}
                  <Badge variant="outline" className="text-[10px] ml-1">
                    {field.type}
                  </Badge>
                </Label>
                {field.type === "boolean" ? (
                  <Select
                    value={testData[field.name] ?? ""}
                    onValueChange={(val: string) =>
                      handleTestDataChange(field.name, val)
                    }
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">true</SelectItem>
                      <SelectItem value="false">false</SelectItem>
                    </SelectContent>
                  </Select>
                ) : field.type === "enum" ? (
                  <Select
                    value={testData[field.name] ?? ""}
                    onValueChange={(val: string) =>
                      handleTestDataChange(field.name, val)
                    }
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent>
                      {field.enumValues
                        .split(",")
                        .map((v) => v.trim())
                        .filter(Boolean)
                        .map((val) => (
                          <SelectItem key={val} value={val}>
                            {val}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={testData[field.name] ?? ""}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      handleTestDataChange(field.name, e.target.value)
                    }
                    placeholder={
                      field.type === "email"
                        ? "user@example.com"
                        : field.type === "url"
                        ? "https://..."
                        : field.type === "number"
                        ? "0"
                        : field.type === "array"
                        ? "item1, item2, item3"
                        : "..."
                    }
                    className="h-8"
                  />
                )}
              </div>
            ))}
          </div>

          <Separator />

          <div className="flex items-center gap-3">
            <Button onClick={handleValidate}>
              <Icons.CheckCircle className="mr-2 h-4 w-4" />
              Validate
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setTestData({});
                setErrors([]);
                setIsValid(null);
              }}
            >
              <Icons.RotateCcw className="mr-2 h-4 w-4" />
              Reset
            </Button>
            {validResult !== null && (
              <Badge variant={validResult ? "default" : "destructive"}>
                {validResult ? "PASS" : "FAIL"}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Validation Results */}
      {validResult === true && (
        <Alert>
          <Icons.CheckCircle className="h-4 w-4" />
          <AlertTitle>Validation Passed</AlertTitle>
          <AlertDescription>
            All {activeFields.length} fields passed validation successfully.
          </AlertDescription>
        </Alert>
      )}

      {validResult === false && activeErrors.length > 0 && (
        <Alert variant="destructive">
          <Icons.AlertCircle className="h-4 w-4" />
          <AlertTitle>
            Validation Failed — {activeErrors.length} error
            {activeErrors.length > 1 ? "s" : ""}
          </AlertTitle>
          <AlertDescription>
            <ul className="mt-2 space-y-1">
              {activeErrors.map((err, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <Badge variant="outline" className="shrink-0 mt-0.5">
                    {err.path}
                  </Badge>
                  <span>{err.message}</span>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export default SchemaValidator;
