import {
  React,
  useForm,
  Controller,
  z,
  useAppState,
  toast,
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  Input,
  Textarea,
  Checkbox,
  RadioGroup,
  RadioGroupItem,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Progress,
  Badge,
  Icons,
  cn,
} from "@exepad/sdk";

const step1Schema = z.object({
  firstName: z.string().min(2, "First name must be at least 2 characters"),
  lastName: z.string().min(2, "Last name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  country: z.string().min(1, "Please select a country"),
});

const step2Schema = z.object({
  interests: z.array(z.string()).min(1, "Select at least one interest"),
  experience: z.enum(["beginner", "intermediate", "advanced"], {
    required_error: "Please select your experience level",
  }),
  bio: z.string().max(200, "Bio must be 200 characters or fewer").optional(),
});

type Step1Data = z.infer<typeof step1Schema>;
type Step2Data = z.infer<typeof step2Schema>;

const INTERESTS = [
  { id: "frontend", label: "Frontend Development" },
  { id: "backend", label: "Backend Development" },
  { id: "design", label: "UI/UX Design" },
  { id: "devops", label: "DevOps & Cloud" },
  { id: "mobile", label: "Mobile Development" },
  { id: "data", label: "Data Science" },
];

const COUNTRIES = [
  "United States",
  "United Kingdom",
  "Canada",
  "Germany",
  "France",
  "Australia",
  "Japan",
  "Brazil",
];

const EXPERIENCE_LEVELS = [
  { value: "beginner", label: "Beginner", description: "Less than 1 year" },
  { value: "intermediate", label: "Intermediate", description: "1-3 years" },
  { value: "advanced", label: "Advanced", description: "3+ years" },
];

function MultiStepForm() {
  const [currentStep, setCurrentStep] = useAppState<number>("formStep", 0);

  const [step1Data, setStep1Data] = React.useState<Step1Data>({
    firstName: "",
    lastName: "",
    email: "",
    country: "",
  });

  const [step2Data, setStep2Data] = React.useState<Step2Data>({
    interests: [],
    experience: "beginner",
    bio: "",
  });

  const step1FormResult = useForm<Step1Data>({
    schema: step1Schema,
    defaultValues: step1Data,
  });

  const step2FormResult = useForm<Step2Data>({
    schema: step2Schema,
    defaultValues: step2Data,
  });

  const step1Form = step1FormResult ?? ({} as ReturnType<typeof useForm>);
  const step2Form = step2FormResult ?? ({} as ReturnType<typeof useForm>);

  const step = currentStep ?? 0;
  const progress = ((step + 1) / 3) * 100;

  const STEP_LABELS = ["Personal Info", "Preferences", "Review & Confirm"];

  const handleStep1Next = (data: Step1Data) => {
    setStep1Data(data);
    setCurrentStep(1);
  };

  const handleStep2Next = (data: Step2Data) => {
    setStep2Data(data);
    setCurrentStep(2);
  };

  const handleSubmit = () => {
    toast("Registration completed successfully!");
    setCurrentStep(0);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          {STEP_LABELS.map((label, i) => (
            <div
              key={label}
              className={cn(
                "flex items-center gap-2",
                i <= step ? "text-primary font-medium" : ""
              )}
            >
              <span
                className={cn(
                  "flex items-center justify-center w-6 h-6 rounded-full text-xs",
                  i < step
                    ? "bg-primary text-primary-foreground"
                    : i === step
                    ? "border-2 border-primary text-primary"
                    : "border border-muted-foreground"
                )}
              >
                {i < step ? (
                  <Icons.Check className="h-3 w-3" />
                ) : (
                  i + 1
                )}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </div>
          ))}
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      {step === 0 && step1FormResult && (
        <Card>
          <CardHeader>
            <CardTitle>Personal Information</CardTitle>
            <CardDescription>
              Tell us about yourself to get started.
            </CardDescription>
          </CardHeader>
          <Form {...step1Form} onSubmit={handleStep1Next}>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={step1Form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name</FormLabel>
                      <FormControl>
                        <Input placeholder="John" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={step1Form.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Doe" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={step1Form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="john@example.com"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={step1Form.control}
                name="country"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Country</FormLabel>
                    <Controller
                      control={step1Form.control}
                      name="country"
                      render={({ field: ctrlField }) => (
                        <Select
                          value={ctrlField.value}
                          onValueChange={ctrlField.onChange}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select a country" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {COUNTRIES.map((c) => (
                              <SelectItem key={c} value={c}>
                                {c}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter className="flex justify-end">
              <Button type="submit">
                Next
                <Icons.ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </CardFooter>
          </Form>
        </Card>
      )}

      {step === 1 && step2FormResult && (
        <Card>
          <CardHeader>
            <CardTitle>Your Preferences</CardTitle>
            <CardDescription>
              Help us personalize your experience.
            </CardDescription>
          </CardHeader>
          <Form {...step2Form} onSubmit={handleStep2Next}>
            <CardContent className="space-y-6">
              <FormField
                control={step2Form.control}
                name="interests"
                render={() => (
                  <FormItem>
                    <FormLabel>Interests</FormLabel>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                      {INTERESTS.map((interest) => (
                        <FormField
                          key={interest.id}
                          control={step2Form.control}
                          name="interests"
                          render={({ field }) => (
                            <FormItem className="flex items-center gap-2 space-y-0">
                              <FormControl>
                                <Checkbox
                                  checked={(field.value || []).includes(
                                    interest.id
                                  )}
                                  onCheckedChange={(checked: boolean) => {
                                    const current = field.value || [];
                                    field.onChange(
                                      checked
                                        ? [...current, interest.id]
                                        : current.filter(
                                            (v: string) => v !== interest.id
                                          )
                                    );
                                  }}
                                />
                              </FormControl>
                              <FormLabel className="font-normal cursor-pointer">
                                {interest.label}
                              </FormLabel>
                            </FormItem>
                          )}
                        />
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={step2Form.control}
                name="experience"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Experience Level</FormLabel>
                    <FormControl>
                      <RadioGroup
                        value={field.value}
                        onValueChange={field.onChange}
                        className="space-y-2 mt-2"
                      >
                        {EXPERIENCE_LEVELS.map((level) => (
                          <div
                            key={level.value}
                            className="flex items-center gap-3"
                          >
                            <RadioGroupItem
                              value={level.value}
                              id={`exp-${level.value}`}
                            />
                            <Label
                              htmlFor={`exp-${level.value}`}
                              className="flex flex-col cursor-pointer"
                            >
                              <span className="font-medium">{level.label}</span>
                              <span className="text-xs text-muted-foreground">
                                {level.description}
                              </span>
                            </Label>
                          </div>
                        ))}
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={step2Form.control}
                name="bio"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Short Bio (optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Tell us a bit about yourself..."
                        className="resize-none"
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCurrentStep(0)}
              >
                <Icons.ChevronLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <Button type="submit">
                Next
                <Icons.ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </CardFooter>
          </Form>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Review & Confirm</CardTitle>
            <CardDescription>
              Please review your information before submitting.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground mb-2">
                  Personal Information
                </h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Name:</span>{" "}
                    {step1Data.firstName} {step1Data.lastName}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Email:</span>{" "}
                    {step1Data.email}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Country:</span>{" "}
                    {step1Data.country}
                  </div>
                </div>
              </div>
              <div className="border-t pt-4">
                <h4 className="text-sm font-semibold text-muted-foreground mb-2">
                  Preferences
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="flex flex-wrap gap-1">
                    <span className="text-muted-foreground mr-1">Interests:</span>
                    {step2Data.interests.map((id) => {
                      const interest = INTERESTS.find((i) => i.id === id);
                      return (
                        <Badge key={id} variant="secondary">
                          {interest?.label || id}
                        </Badge>
                      );
                    })}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Experience:</span>{" "}
                    <Badge>
                      {EXPERIENCE_LEVELS.find(
                        (l) => l.value === step2Data.experience
                      )?.label || step2Data.experience}
                    </Badge>
                  </div>
                  {step2Data.bio && (
                    <div>
                      <span className="text-muted-foreground">Bio:</span>{" "}
                      {step2Data.bio}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button variant="outline" onClick={() => setCurrentStep(1)}>
              <Icons.ChevronLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <Button onClick={handleSubmit}>
              <Icons.Check className="mr-2 h-4 w-4" />
              Submit Registration
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}

export default MultiStepForm;
