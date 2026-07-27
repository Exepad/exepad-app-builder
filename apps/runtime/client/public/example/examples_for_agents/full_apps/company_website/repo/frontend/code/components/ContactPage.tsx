import {
  React,
  useNavigation,
  Button,
  Card,
  CardContent,
  Input,
  Icons,
  toast,
  cn,
} from "@exepad/sdk";

const SUBJECTS = [
  "General Inquiry",
  "Request a Demo",
  "Partnership Opportunity",
  "Career Inquiry",
  "Support Request",
];

interface ContactCard {
  icon: string;
  title: string;
  line1: string;
  line2: string;
}

const CONTACT_CARDS: ContactCard[] = [
  { icon: "Mail", title: "Email Us", line1: "hello@novatech.com", line2: "support@novatech.com" },
  { icon: "Phone", title: "Call Us", line1: "+1 (555) 234-5678", line2: "Mon–Fri, 9am–6pm PST" },
  { icon: "MapPin", title: "Visit Us", line1: "100 Innovation Drive", line2: "San Francisco, CA 94105" },
];

function ContactPage() {
  const navigation = useNavigation();
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [subject, setSubject] = React.useState(SUBJECTS[0]);
  const [message, setMessage] = React.useState("");
  const [sending, setSending] = React.useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !message.trim()) {
      toast.error("Please fill in all required fields.");
      return;
    }
    setSending(true);
    setTimeout(() => {
      setSending(false);
      toast.success("Message sent! We'll get back to you within 24 hours.");
      setName("");
      setEmail("");
      setSubject(SUBJECTS[0]);
      setMessage("");
    }, 1500);
  };

  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="py-20 bg-gradient-to-b from-accent/30 to-background">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/20 bg-primary/5 text-primary text-sm font-medium mb-6">
            <Icons.MessageSquare className="h-4 w-4" />
            Get in Touch
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-6">
            Let&apos;s Start a <span className="text-primary">Conversation</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Have a project in mind or want to learn more about our services? We&apos;d love to hear from you.
          </p>
        </div>
      </section>

      {/* Contact Cards */}
      <section className="py-12 bg-background">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid sm:grid-cols-3 gap-6">
            {CONTACT_CARDS.map((card) => {
              const Icon = (Icons as any)[card.icon];
              return (
                <Card key={card.title} className="text-center border-border/50 hover:shadow-md transition-shadow">
                  <CardContent className="p-6">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary mx-auto mb-4">
                      {Icon && <Icon className="h-6 w-6" />}
                    </div>
                    <h3 className="font-semibold mb-2">{card.title}</h3>
                    <p className="text-sm text-muted-foreground">{card.line1}</p>
                    <p className="text-sm text-muted-foreground">{card.line2}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* Form + Info Split */}
      <section className="py-20 bg-background">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-5 gap-12">
            {/* Contact Form */}
            <div className="lg:col-span-3">
              <h2 className="text-2xl font-bold mb-6">Send Us a Message</h2>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="grid sm:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-sm font-medium mb-2">Full Name *</label>
                    <Input
                      type="text"
                      placeholder="John Doe"
                      value={name}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
                      className="h-11"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Email Address *</label>
                    <Input
                      type="email"
                      placeholder="john@example.com"
                      value={email}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                      className="h-11"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Subject</label>
                  <select
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {SUBJECTS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Message *</label>
                  <textarea
                    placeholder="Tell us about your project or inquiry..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={6}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring resize-none"
                  />
                </div>
                <Button type="submit" size="lg" className="gap-2 px-8" disabled={sending}>
                  {sending ? (
                    <>
                      <Icons.Loader2 className="h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      Send Message
                      <Icons.Send className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </form>
            </div>

            {/* Office Info */}
            <div className="lg:col-span-2">
              <h2 className="text-2xl font-bold mb-6">Our Office</h2>

              {/* Map Placeholder */}
              <div className="rounded-xl bg-muted border border-border h-48 flex items-center justify-center mb-6">
                <div className="text-center text-muted-foreground">
                  <Icons.Map className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">San Francisco, CA</p>
                </div>
              </div>

              <div className="space-y-5">
                <div>
                  <h3 className="font-semibold mb-2">Office Hours</h3>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>Monday – Friday: 9:00 AM – 6:00 PM PST</p>
                    <p>Saturday: 10:00 AM – 2:00 PM PST</p>
                    <p>Sunday: Closed</p>
                  </div>
                </div>
                <div>
                  <h3 className="font-semibold mb-2">Response Time</h3>
                  <p className="text-sm text-muted-foreground">
                    We typically respond to all inquiries within 24 hours during business days. For urgent matters, please call us directly.
                  </p>
                </div>
                <div className="flex gap-3 pt-2">
                  <button className="flex h-10 w-10 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-colors">
                    <Icons.Twitter className="h-4 w-4" />
                  </button>
                  <button className="flex h-10 w-10 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-colors">
                    <Icons.Linkedin className="h-4 w-4" />
                  </button>
                  <button className="flex h-10 w-10 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-colors">
                    <Icons.Github className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ CTA */}
      <section className="py-16 bg-muted/30">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">Frequently Asked Questions</h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
            Check our services page for detailed information about what we offer, or reach out and we&apos;ll be happy to answer any questions.
          </p>
          <Button variant="outline" size="lg" className="gap-2" onClick={() => navigation.navigate("/services")}>
            View Our Services
            <Icons.ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </section>
    </div>
  );
}

export default ContactPage;
