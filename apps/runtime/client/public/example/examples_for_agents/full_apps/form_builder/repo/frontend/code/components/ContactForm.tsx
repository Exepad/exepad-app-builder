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
  Textarea,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Icons,
  cn,
  toast,
} from "@exepad/sdk";

function ContactForm() {
  const navigation = useNavigation();
  const currentUser = useCurrentUser();
  const model = useModel("submissions");

  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [priority, setPriority] = React.useState("Normal");
  const [loading, setLoading] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Full name is required";
    if (!email.trim()) errs.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = "Invalid email address";
    if (!subject) errs.subject = "Please select a subject";
    if (!message.trim()) errs.message = "Message is required";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      const data = JSON.stringify({ name, email, phone, subject, message, priority });
      if (model?.create) {
        await model.create({
          form_type: "contact",
          data,
          status: "pending",
          submitted_by: currentUser?.email || email,
        });
      }
      toast({ title: "Form submitted!", description: "Your contact form has been received." });
      setName(""); setEmail(""); setPhone(""); setSubject(""); setMessage(""); setPriority("Normal");
      setErrors({});
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to submit form", variant: "destructive" });
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
              <Icons.Mail className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-xl">Contact Form</CardTitle>
              <CardDescription>Get in touch with us. We'll respond within 24 hours.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Full Name */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Full Name <span className="text-destructive">*</span></label>
              <Input
                placeholder="John Doe"
                value={name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              />
              {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
            </div>

            {/* Email */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Email <span className="text-destructive">*</span></label>
              <Input
                type="email"
                placeholder="john@example.com"
                value={email}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
              />
              {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
            </div>

            {/* Phone */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Phone <span className="text-muted-foreground text-xs">(optional)</span></label>
              <Input
                type="tel"
                placeholder="+1 (555) 000-0000"
                value={phone}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)}
              />
            </div>

            {/* Subject */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Subject <span className="text-destructive">*</span></label>
              <Select value={subject} onValueChange={setSubject}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a subject" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="General">General Inquiry</SelectItem>
                  <SelectItem value="Support">Technical Support</SelectItem>
                  <SelectItem value="Sales">Sales</SelectItem>
                  <SelectItem value="Partnership">Partnership</SelectItem>
                </SelectContent>
              </Select>
              {errors.subject && <p className="text-xs text-destructive">{errors.subject}</p>}
            </div>

            {/* Message */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Message <span className="text-destructive">*</span></label>
              <Textarea
                placeholder="Tell us how we can help..."
                value={message}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setMessage(e.target.value)}
                rows={5}
              />
              {errors.message && <p className="text-xs text-destructive">{errors.message}</p>}
            </div>

            {/* Priority */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Priority</label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Low">Low</SelectItem>
                  <SelectItem value="Normal">Normal</SelectItem>
                  <SelectItem value="High">High</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Submit */}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Icons.Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Icons.Send className="h-4 w-4 mr-2" />}
              Submit Contact Form
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default ContactForm;
