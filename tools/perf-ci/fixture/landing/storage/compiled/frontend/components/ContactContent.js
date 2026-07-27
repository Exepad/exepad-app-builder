// ../../../../../tmp/exepad-build-a1kguu163-qr2bL9/ContactContent.tsx
import { React, LightDOMContainer, Icons, Button, Input, Textarea, Card, CardContent, toast } from "@exepad/sdk";
function ContactContent() {
  const [formData, setFormData] = React.useState({
    name: "",
    email: "",
    subject: "",
    message: ""
  });
  const handleChange = (field) => (e) => {
    setFormData((prev) => ({ ...prev, [field]: e.target.value }));
  };
  const handleSubmit = (e) => {
    e.preventDefault();
    const { name, email, subject, message } = formData;
    if (!name || !email || !subject || !message) {
      toast("Please fill in all fields.", { type: "error" });
      return;
    }
    toast("Message sent! We'll get back to you shortly.", { type: "success" });
    setFormData({ name: "", email: "", subject: "", message: "" });
  };
  return /* @__PURE__ */ React.createElement(LightDOMContainer, null, /* @__PURE__ */ React.createElement("section", { className: "bg-surface" }, /* @__PURE__ */ React.createElement("div", { className: "max-w-7xl mx-auto px-4 md:px-6 lg:px-10 py-12 lg:py-20" }, /* @__PURE__ */ React.createElement("div", { className: "max-w-2xl mx-auto text-center mb-12 lg:mb-16" }, /* @__PURE__ */ React.createElement("div", { className: "inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/30 text-primary text-xs font-semibold tracking-wider uppercase mb-4" }, /* @__PURE__ */ React.createElement("span", { className: "w-1.5 h-1.5 rounded-full bg-primary" }), "Get in Touch"), /* @__PURE__ */ React.createElement("h1", { className: "font-headline text-3xl md:text-4xl lg:text-5xl font-extrabold text-on-surface leading-tight mb-4" }, "We'd Love to Hear From You"), /* @__PURE__ */ React.createElement("p", { className: "text-base md:text-lg text-on-surface-variant leading-relaxed" }, "Whether you have a question about our services, pricing, or anything else \u2014 our team is ready to help.")), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 lg:grid-cols-5 gap-8 lg:gap-12" }, /* @__PURE__ */ React.createElement("div", { className: "lg:col-span-3" }, /* @__PURE__ */ React.createElement(Card, { className: "bg-surface border border-outline-variant/20 shadow-sm rounded-2xl overflow-hidden" }, /* @__PURE__ */ React.createElement(CardContent, { className: "p-6 md:p-8" }, /* @__PURE__ */ React.createElement("h2", { className: "font-headline text-xl md:text-2xl font-bold text-on-surface mb-6" }, "Send Us a Message"), /* @__PURE__ */ React.createElement("form", { onSubmit: handleSubmit, className: "space-y-5" }, /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-5" }, /* @__PURE__ */ React.createElement("div", { className: "space-y-1.5" }, /* @__PURE__ */ React.createElement("label", { htmlFor: "name", className: "text-xs font-bold text-on-surface-variant uppercase tracking-wider" }, "Your Name"), /* @__PURE__ */ React.createElement(
    Input,
    {
      id: "name",
      placeholder: "John Doe",
      value: formData.name,
      onChange: handleChange("name"),
      className: "w-full px-4 py-3 bg-surface-container-low border border-outline-variant/20 rounded-xl text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
    }
  )), /* @__PURE__ */ React.createElement("div", { className: "space-y-1.5" }, /* @__PURE__ */ React.createElement("label", { htmlFor: "email", className: "text-xs font-bold text-on-surface-variant uppercase tracking-wider" }, "Your Email"), /* @__PURE__ */ React.createElement(
    Input,
    {
      id: "email",
      type: "email",
      placeholder: "john@example.com",
      value: formData.email,
      onChange: handleChange("email"),
      className: "w-full px-4 py-3 bg-surface-container-low border border-outline-variant/20 rounded-xl text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
    }
  ))), /* @__PURE__ */ React.createElement("div", { className: "space-y-1.5" }, /* @__PURE__ */ React.createElement("label", { htmlFor: "subject", className: "text-xs font-bold text-on-surface-variant uppercase tracking-wider" }, "Subject"), /* @__PURE__ */ React.createElement(
    Input,
    {
      id: "subject",
      placeholder: "How can we help you?",
      value: formData.subject,
      onChange: handleChange("subject"),
      className: "w-full px-4 py-3 bg-surface-container-low border border-outline-variant/20 rounded-xl text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
    }
  )), /* @__PURE__ */ React.createElement("div", { className: "space-y-1.5" }, /* @__PURE__ */ React.createElement("label", { htmlFor: "message", className: "text-xs font-bold text-on-surface-variant uppercase tracking-wider" }, "Message"), /* @__PURE__ */ React.createElement(
    Textarea,
    {
      id: "message",
      rows: 5,
      placeholder: "Tell us more about what you're looking for...",
      value: formData.message,
      onChange: handleChange("message"),
      className: "w-full px-4 py-3 bg-surface-container-low border border-outline-variant/20 rounded-xl text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all resize-none"
    }
  )), /* @__PURE__ */ React.createElement(
    Button,
    {
      type: "submit",
      className: "inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-primary text-on-primary text-sm font-bold hover:opacity-90 transition-all active:scale-[0.98] shadow-md shadow-primary/20"
    },
    /* @__PURE__ */ React.createElement(Icons.Send, { className: "w-4 h-4" }),
    "Send Message"
  ))))), /* @__PURE__ */ React.createElement("div", { className: "lg:col-span-2 space-y-6" }, /* @__PURE__ */ React.createElement("div", { className: "bg-surface-container-low rounded-2xl shadow-sm border border-outline-variant/20 p-6 md:p-8" }, /* @__PURE__ */ React.createElement("h2", { className: "font-headline text-xl font-bold text-on-surface mb-6" }, "Contact Information"), /* @__PURE__ */ React.createElement("div", { className: "space-y-5" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-start gap-4" }, /* @__PURE__ */ React.createElement("div", { className: "w-10 h-10 rounded-xl bg-primary/30 flex items-center justify-center shrink-0" }, /* @__PURE__ */ React.createElement(Icons.Mail, { className: "w-5 h-5 text-primary" })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1" }, "Email"), /* @__PURE__ */ React.createElement("a", { href: "mailto:hello@verdant.co", className: "text-sm text-on-surface hover:text-primary transition-colors" }, "hello@verdant.co"))), /* @__PURE__ */ React.createElement("div", { className: "flex items-start gap-4" }, /* @__PURE__ */ React.createElement("div", { className: "w-10 h-10 rounded-xl bg-primary/30 flex items-center justify-center shrink-0" }, /* @__PURE__ */ React.createElement(Icons.Phone, { className: "w-5 h-5 text-primary" })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1" }, "Phone"), /* @__PURE__ */ React.createElement("a", { href: "tel:+15551234567", className: "text-sm text-on-surface hover:text-primary transition-colors" }, "+1 (555) 123-4567"))), /* @__PURE__ */ React.createElement("div", { className: "flex items-start gap-4" }, /* @__PURE__ */ React.createElement("div", { className: "w-10 h-10 rounded-xl bg-primary/30 flex items-center justify-center shrink-0" }, /* @__PURE__ */ React.createElement(Icons.MapPin, { className: "w-5 h-5 text-primary" })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1" }, "Address"), /* @__PURE__ */ React.createElement("p", { className: "text-sm text-on-surface" }, "123 Meadow Lane", /* @__PURE__ */ React.createElement("br", null), "Honey Valley, HV 10001"))))), /* @__PURE__ */ React.createElement("div", { className: "bg-surface-container-low rounded-2xl shadow-sm border border-outline-variant/20 p-6 md:p-8" }, /* @__PURE__ */ React.createElement("h2", { className: "font-headline text-xl font-bold text-on-surface mb-6" }, "Business Hours"), /* @__PURE__ */ React.createElement("div", { className: "space-y-3" }, /* @__PURE__ */ React.createElement("div", { className: "flex justify-between items-center text-sm" }, /* @__PURE__ */ React.createElement("span", { className: "text-on-surface-variant" }, "Mon \u2013 Fri"), /* @__PURE__ */ React.createElement("span", { className: "text-on-surface font-medium" }, "9:00 AM \u2013 6:00 PM")), /* @__PURE__ */ React.createElement("div", { className: "flex justify-between items-center text-sm" }, /* @__PURE__ */ React.createElement("span", { className: "text-on-surface-variant" }, "Saturday"), /* @__PURE__ */ React.createElement("span", { className: "text-on-surface font-medium" }, "10:00 AM \u2013 4:00 PM")), /* @__PURE__ */ React.createElement("div", { className: "flex justify-between items-center text-sm" }, /* @__PURE__ */ React.createElement("span", { className: "text-on-surface-variant" }, "Sunday"), /* @__PURE__ */ React.createElement("span", { className: "text-on-surface font-medium" }, "Closed")))), /* @__PURE__ */ React.createElement("div", { className: "bg-primary rounded-2xl p-6 md:p-8 text-center" }, /* @__PURE__ */ React.createElement(Icons.MessageCircle, { className: "w-8 h-8 mx-auto text-on-primary mb-3" }), /* @__PURE__ */ React.createElement("p", { className: "font-headline text-lg font-bold text-on-primary mb-2" }, "Prefer a quick chat?"), /* @__PURE__ */ React.createElement("p", { className: "text-sm text-on-primary mb-4" }, "We typically respond within 24 hours during business days."), /* @__PURE__ */ React.createElement(
    "a",
    {
      href: "mailto:hello@verdant.co",
      className: "inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-on-primary/30 text-on-primary text-sm font-semibold hover:bg-on-primary/30 transition-all active:scale-[0.98]"
    },
    /* @__PURE__ */ React.createElement(Icons.Mail, { className: "w-4 h-4" }),
    "Email Us Directly"
  )))))));
}
var ContactContent_default = ContactContent;
export {
  ContactContent_default as default
};
