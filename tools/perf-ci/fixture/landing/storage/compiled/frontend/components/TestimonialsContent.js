// ../../../../../tmp/exepad-build-a1kguu163-qr2bL9/TestimonialsContent.tsx
import { React, LightDOMContainer, Icons, ExepadImage } from "@exepad/sdk";
var { useState } = React;
var testimonials = [
  {
    quote: "Working with this team was an absolute delight. They listened carefully to our vision and translated it into a brand experience that exceeded every expectation. The attention to detail and genuine care they brought to the project was remarkable.",
    name: "Clarissa Hendricks",
    title: "Founder, Meadow & Vine",
    rating: 5,
    image: {
      keywords: "professional portrait of joyful female entrepreneur modern office",
      importance: 6
    }
  },
  {
    quote: "From the initial consultation to the final delivery, every step felt collaborative and intentional. They didn't just design for us \u2014 they designed with us. Our customers immediately noticed the difference. Truly transformative work.",
    name: "Marcus Delgado",
    title: "CEO, Terraform Collective",
    rating: 5,
    image: {
      keywords: "professional portrait of confident male ceo bright workspace",
      importance: 6
    }
  },
  {
    quote: "We've worked with dozens of creative agencies over the years, but none have matched the level of thoughtfulness and craft that this team brings. They have a rare ability to combine beauty with function in a way that simply works.",
    name: "Priya Nair",
    title: "Creative Director, Lumina Studio",
    rating: 5,
    image: {
      keywords: "professional portrait of female creative director colorful studio",
      importance: 6
    }
  },
  {
    quote: "The rebrand they delivered didn't just refresh our look \u2014 it reshaped how our community perceives us. Our engagement metrics have soared, and the team's strategic insight was worth every bit of the investment.",
    name: "Thomas Whitfield",
    title: "Managing Partner, Whitfield & Co.",
    rating: 5,
    image: {
      keywords: "professional portrait of male business partner modern loft office",
      importance: 6
    }
  },
  {
    quote: "I was initially hesitant about investing in a full brand overhaul, but from the very first presentation, I knew we were in good hands. They made the entire process seamless, transparent, and genuinely enjoyable.",
    name: "Anika Patel",
    title: "Owner, Saffron Kitchen",
    rating: 4,
    image: {
      keywords: "professional portrait of female small business owner restaurant",
      importance: 6
    }
  },
  {
    quote: "Their ability to distill complex ideas into elegant, intuitive designs is unmatched. Every touchpoint \u2014 from our website to our packaging \u2014 now feels cohesive and intentional. A partnership we truly treasure.",
    name: "David Okoro",
    title: "VP of Brand, Greenline Goods",
    rating: 5,
    image: {
      keywords: "professional portrait of male brand executive bright conference room",
      importance: 6
    }
  }
];
function StarRating({ rating }) {
  return /* @__PURE__ */ React.createElement("div", { className: "flex gap-0.5" }, [1, 2, 3, 4, 5].map((star) => /* @__PURE__ */ React.createElement(
    Icons.Star,
    {
      key: star,
      className: `w-4 h-4 ${star <= rating ? "text-secondary fill-secondary" : "text-outline-variant"}`
    }
  )));
}
function TestimonialsContent() {
  return /* @__PURE__ */ React.createElement(LightDOMContainer, null, /* @__PURE__ */ React.createElement("div", { className: "flex flex-col" }, /* @__PURE__ */ React.createElement("section", { className: "relative overflow-hidden bg-gradient-to-br from-primary/5 via-surface to-primary/5 py-20 md:py-28 lg:py-32" }, /* @__PURE__ */ React.createElement("div", { className: "max-w-5xl mx-auto px-6 md:px-10 text-center" }, /* @__PURE__ */ React.createElement("span", { className: "inline-block bg-primary/30 text-primary text-xs font-bold uppercase tracking-[0.2em] px-4 py-1.5 rounded-full mb-6" }, "Testimonials"), /* @__PURE__ */ React.createElement("h1", { className: "font-headline text-4xl md:text-5xl lg:text-6xl font-extrabold text-on-surface leading-tight mb-6" }, "Kind Words from", " ", /* @__PURE__ */ React.createElement("span", { className: "text-primary" }, "Our Clients")), /* @__PURE__ */ React.createElement("p", { className: "text-lg md:text-xl text-on-surface-variant max-w-3xl mx-auto leading-relaxed" }, "Don't take our word for it \u2014 hear from the people and organizations we've had the privilege of working with."))), /* @__PURE__ */ React.createElement("section", { className: "bg-surface-container-low/50 border-y border-outline-variant/10" }, /* @__PURE__ */ React.createElement("div", { className: "max-w-5xl mx-auto px-6 md:px-10 py-10" }, /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 sm:grid-cols-3 gap-8 text-center" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "font-headline text-3xl font-extrabold text-primary" }, "150+"), /* @__PURE__ */ React.createElement("p", { className: "text-sm text-on-surface-variant mt-1" }, "Projects Completed")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "font-headline text-3xl font-extrabold text-primary" }, "98%"), /* @__PURE__ */ React.createElement("p", { className: "text-sm text-on-surface-variant mt-1" }, "Client Satisfaction")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "font-headline text-3xl font-extrabold text-primary" }, "50+"), /* @__PURE__ */ React.createElement("p", { className: "text-sm text-on-surface-variant mt-1" }, "Happy Partners"))))), /* @__PURE__ */ React.createElement("section", { className: "py-16 md:py-24" }, /* @__PURE__ */ React.createElement("div", { className: "max-w-5xl mx-auto px-6 md:px-10" }, /* @__PURE__ */ React.createElement("div", { className: "text-center mb-14" }, /* @__PURE__ */ React.createElement("span", { className: "inline-block bg-secondary/30 text-secondary text-xs font-bold uppercase tracking-[0.2em] px-4 py-1.5 rounded-full mb-4" }, "Client Reviews"), /* @__PURE__ */ React.createElement("h2", { className: "font-headline text-3xl md:text-4xl font-extrabold text-on-surface" }, "What People Are Saying")), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-8" }, testimonials.map((item, idx) => /* @__PURE__ */ React.createElement(
    "div",
    {
      key: idx,
      className: "bg-surface rounded-2xl p-8 shadow-sm border border-outline-variant/10 hover:shadow-md transition-all flex flex-col"
    },
    /* @__PURE__ */ React.createElement("div", { className: "mb-6" }, /* @__PURE__ */ React.createElement(Icons.Quote, { className: "w-8 h-8 text-primary mb-3" }), /* @__PURE__ */ React.createElement("p", { className: "text-on-surface-variant leading-relaxed text-sm italic" }, "\u201C", item.quote, "\u201D")),
    /* @__PURE__ */ React.createElement("div", { className: "mt-auto" }, /* @__PURE__ */ React.createElement(StarRating, { rating: item.rating }), /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-4 mt-4 pt-4 border-t border-outline-variant/10" }, /* @__PURE__ */ React.createElement("div", { className: "w-12 h-12 rounded-full overflow-hidden ring-2 ring-primary/10 shrink-0" }, /* @__PURE__ */ React.createElement(
      ExepadImage,
      {
        ...item.image,
        width: 200,
        height: 200,
        className: "w-full h-full object-cover"
      }
    )), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "font-bold text-on-surface text-sm" }, item.name), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-on-surface-variant" }, item.title))))
  ))))), /* @__PURE__ */ React.createElement("section", { className: "py-16 md:py-24 bg-primary" }, /* @__PURE__ */ React.createElement("div", { className: "max-w-4xl mx-auto px-6 md:px-10 text-center" }, /* @__PURE__ */ React.createElement("h2", { className: "font-headline text-3xl md:text-4xl font-extrabold text-on-primary mb-4" }, "Ready to Join Our Community?"), /* @__PURE__ */ React.createElement("p", { className: "text-on-primary text-lg max-w-2xl mx-auto mb-8 leading-relaxed" }, "We'd love to help you bring your vision to life. Get in touch and let's start a conversation."), /* @__PURE__ */ React.createElement(
    "a",
    {
      href: "/contact",
      className: "inline-flex items-center gap-2 bg-surface text-primary font-bold px-8 py-3.5 rounded-2xl hover:bg-surface-container transition-all shadow-sm"
    },
    "Get Started",
    /* @__PURE__ */ React.createElement(Icons.ArrowRight, { className: "w-5 h-5" })
  )))));
}
var TestimonialsContent_default = TestimonialsContent;
export {
  TestimonialsContent_default as default
};
