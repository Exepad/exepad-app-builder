import {
  React,
  useModel,
  useNavigation,
  useCurrentUser,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Icons,
  cn,
  toast,
} from "@exepad/sdk";

const SESSIONS = ["Workshop A", "Workshop B", "Keynote", "Panel Discussion", "Networking Lunch"];

function RegistrationForm() {
  const navigation = useNavigation();
  const currentUser = useCurrentUser();
  const model = useModel("submissions");

  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [company, setCompany] = React.useState("");
  const [jobTitle, setJobTitle] = React.useState("");
  const [dietary, setDietary] = React.useState("None");
  const [tshirtSize, setTshirtSize] = React.useState("M");
  const [selectedSessions, setSelectedSessions] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const toggleSession = (session: string) => {
    setSelectedSessions((prev) =>
      prev.includes(session) ? prev.filter((s) => s !== session) : [...prev, session]
    );
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!firstName.trim()) errs.firstName = "First name is required";
    if (!lastName.trim()) errs.lastName = "Last name is required";
    if (!email.trim()) errs.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = "Invalid email address";
    if (!company.trim()) errs.company = "Company is required";
    if (!jobTitle.trim()) errs.jobTitle = "Job title is required";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      const data = JSON.stringify({
        firstName, lastName, email, company, jobTitle, dietary, tshirtSize, sessions: selectedSessions,
      });
      if (model?.create) {
        await model.create({
          form_type: "registration",
          data,
          status: "pending",
          submitted_by: currentUser?.email || email,
        });
      }
      toast({ title: "Registration submitted!", description: "You're registered for the event." });
      setFirstName(""); setLastName(""); setEmail(""); setCompany(""); setJobTitle("");
      setDietary("None"); setTshirtSize("M"); setSelectedSessions([]); setErrors({});
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to submit", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Icons.UserPlus className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-xl">Event Registration</CardTitle>
              <CardDescription>Register for the upcoming conference. All fields marked * are required.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">First Name <span className="text-destructive">*</span></label>
                <Input placeholder="John" value={firstName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFirstName(e.target.value)} />
                {errors.firstName && <p className="text-xs text-destructive">{errors.firstName}</p>}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Last Name <span className="text-destructive">*</span></label>
                <Input placeholder="Doe" value={lastName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLastName(e.target.value)} />
                {errors.lastName && <p className="text-xs text-destructive">{errors.lastName}</p>}
              </div>
            </div>

            {/* Email */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Email <span className="text-destructive">*</span></label>
              <Input type="email" placeholder="john@company.com" value={email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} />
              {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
            </div>

            {/* Company & Job Title */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Company <span className="text-destructive">*</span></label>
                <Input placeholder="Acme Inc." value={company} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCompany(e.target.value)} />
                {errors.company && <p className="text-xs text-destructive">{errors.company}</p>}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Job Title <span className="text-destructive">*</span></label>
                <Input placeholder="Software Engineer" value={jobTitle} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setJobTitle(e.target.value)} />
                {errors.jobTitle && <p className="text-xs text-destructive">{errors.jobTitle}</p>}
              </div>
            </div>

            {/* Dietary & T-shirt */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Dietary Preferences</label>
                <Select value={dietary} onValueChange={setDietary}>
                  <SelectTrigger><SelectValue placeholder="Select dietary" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="None">None</SelectItem>
                    <SelectItem value="Vegetarian">Vegetarian</SelectItem>
                    <SelectItem value="Vegan">Vegan</SelectItem>
                    <SelectItem value="Gluten-Free">Gluten-Free</SelectItem>
                    <SelectItem value="Halal">Halal</SelectItem>
                    <SelectItem value="Kosher">Kosher</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">T-shirt Size</label>
                <Select value={tshirtSize} onValueChange={setTshirtSize}>
                  <SelectTrigger><SelectValue placeholder="Select size" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="XS">XS</SelectItem>
                    <SelectItem value="S">S</SelectItem>
                    <SelectItem value="M">M</SelectItem>
                    <SelectItem value="L">L</SelectItem>
                    <SelectItem value="XL">XL</SelectItem>
                    <SelectItem value="XXL">XXL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Session Preferences */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Session Preferences</label>
              <div className="flex flex-wrap gap-2">
                {SESSIONS.map((session) => {
                  const isSelected = selectedSessions.includes(session);
                  return (
                    <Button
                      key={session}
                      type="button"
                      variant={isSelected ? "default" : "outline"}
                      size="sm"
                      onClick={() => toggleSession(session)}
                    >
                      {isSelected && <Icons.Check className="h-3 w-3 mr-1" />}
                      {session}
                    </Button>
                  );
                })}
              </div>
            </div>

            {/* Submit */}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Icons.Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Icons.UserPlus className="h-4 w-4 mr-2" />}
              Complete Registration
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default RegistrationForm;
