// ../../../../../tmp/exepad-build-a1kguu163-qr2bL9/AboutContent.tsx
import { React, LightDOMContainer, Icons, ExepadImage, Link } from "@exepad/sdk";
var missionPoints = [
  {
    icon: Icons.Leaf,
    title: "Our Mission",
    description: "We believe in creating meaningful experiences that connect people with what matters most. Every decision we make is guided by a commitment to quality, sustainability, and genuine human connection."
  },
  {
    icon: Icons.Heart,
    title: "Our Values",
    description: "Integrity, creativity, and community are at the heart of everything we do. We build lasting relationships with our clients, partners, and the communities we serve."
  },
  {
    icon: Icons.TrendingUp,
    title: "Our Vision",
    description: "To be a catalyst for positive change \u2014 inspiring individuals and businesses to embrace thoughtful design, sustainable practices, and a deeper appreciation for the world around us."
  }
];
var teamMembers = [
  {
    name: "Elena Marchetti",
    role: "Founder & Creative Director",
    bio: "With over 15 years of experience in design and brand strategy, Elena founded the company with a vision to blend purpose with aesthetics.",
    image: {
      keywords: "professional portrait of female founder creative director modern office",
      importance: 7
    }
  },
  {
    name: "James Okonkwo",
    role: "Head of Operations",
    bio: "James brings operational excellence and a passion for sustainable business practices, ensuring every project runs smoothly from concept to completion.",
    image: {
      keywords: "professional portrait of male operations manager bright workspace",
      importance: 7
    }
  },
  {
    name: "Sophia Chen",
    role: "Lead Designer",
    bio: "Sophia's award-winning design work has been featured in publications worldwide. She leads our creative team with an eye for detail and a love for storytelling.",
    image: {
      keywords: "professional portrait of female lead designer creative studio",
      importance: 7
    }
  }
];
function AboutContent() {
  return /* @__PURE__ */ React.createElement(LightDOMContainer, null, /* @__PURE__ */ React.createElement("div", { className: "flex flex-col" }, /* @__PURE__ */ React.createElement("section", { className: "relative overflow-hidden bg-gradient-to-br from-primary/5 via-surface to-primary/5" }, /* @__PURE__ */ React.createElement("div", { className: "max-w-5xl mx-auto px-6 md:px-10 py-20 md:py-28 lg:py-32 text-center" }, /* @__PURE__ */ React.createElement("span", { className: "inline-block bg-primary/30 text-primary text-xs font-bold uppercase tracking-[0.2em] px-4 py-1.5 rounded-full mb-6" }, "About Us"), /* @__PURE__ */ React.createElement("h1", { className: "font-headline text-4xl md:text-5xl lg:text-6xl font-extrabold text-on-surface leading-tight mb-6" }, "Crafted with Purpose,", " ", /* @__PURE__ */ React.createElement("span", { className: "text-primary" }, "Rooted in Care")), /* @__PURE__ */ React.createElement("p", { className: "text-lg md:text-xl text-on-surface-variant max-w-3xl mx-auto leading-relaxed" }, "We are a team of passionate creators, thinkers, and doers \u2014 united by a shared belief that great design can transform the way we live, work, and connect with one another."))), /* @__PURE__ */ React.createElement("section", { className: "py-16 md:py-24" }, /* @__PURE__ */ React.createElement("div", { className: "max-w-5xl mx-auto px-6 md:px-10" }, /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { className: "inline-block bg-secondary/30 text-secondary text-xs font-bold uppercase tracking-[0.2em] px-4 py-1.5 rounded-full mb-4" }, "Our Story"), /* @__PURE__ */ React.createElement("h2", { className: "font-headline text-3xl md:text-4xl font-extrabold text-on-surface mb-6" }, "A Journey of Passion and Purpose"), /* @__PURE__ */ React.createElement("div", { className: "space-y-4 text-on-surface-variant leading-relaxed" }, /* @__PURE__ */ React.createElement("p", null, "What began as a small creative studio in a sunlit corner of the city has grown into a thriving collective of designers, strategists, and dreamers. Our journey started with a simple question: ", /* @__PURE__ */ React.createElement("em", null, "What if every project could be both beautiful and meaningful?")), /* @__PURE__ */ React.createElement("p", null, "Over the years, we've had the privilege of working with incredible clients \u2014 from local artisans to global organizations \u2014 each partnership deepening our understanding of what it means to create with intention. We don't just build brands; we nurture ecosystems of trust, creativity, and shared purpose."), /* @__PURE__ */ React.createElement("p", null, "Today, our studio continues to evolve, but our core belief remains unchanged: the best work comes from a place of genuine care, deep listening, and an unwavering commitment to quality."))), /* @__PURE__ */ React.createElement("div", { className: "relative" }, /* @__PURE__ */ React.createElement("div", { className: "absolute -inset-4 bg-primary/30 rounded-3xl" }), /* @__PURE__ */ React.createElement(
    ExepadImage,
    {
      keywords: "sunlit creative studio workspace with plants and natural light",
      importance: 9,
      width: 800,
      height: 600,
      className: "w-full h-auto rounded-2xl shadow-sm relative"
    }
  ))))), /* @__PURE__ */ React.createElement("section", { className: "py-16 md:py-24 bg-surface-container-low/50" }, /* @__PURE__ */ React.createElement("div", { className: "max-w-5xl mx-auto px-6 md:px-10" }, /* @__PURE__ */ React.createElement("div", { className: "text-center mb-14" }, /* @__PURE__ */ React.createElement("span", { className: "inline-block bg-primary/30 text-primary text-xs font-bold uppercase tracking-[0.2em] px-4 py-1.5 rounded-full mb-4" }, "What Drives Us"), /* @__PURE__ */ React.createElement("h2", { className: "font-headline text-3xl md:text-4xl font-extrabold text-on-surface" }, "Our Guiding Principles")), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 md:grid-cols-3 gap-8" }, missionPoints.map((point, idx) => /* @__PURE__ */ React.createElement(
    "div",
    {
      key: idx,
      className: "bg-surface rounded-2xl p-8 shadow-sm border border-outline-variant/10 hover:shadow-md transition-all group"
    },
    /* @__PURE__ */ React.createElement("div", { className: "w-14 h-14 bg-primary/30 rounded-xl flex items-center justify-center mb-6 group-hover:bg-primary/30 transition-colors" }, /* @__PURE__ */ React.createElement(point.icon, { className: "w-7 h-7 text-primary" })),
    /* @__PURE__ */ React.createElement("h3", { className: "font-headline text-xl font-bold text-on-surface mb-3" }, point.title),
    /* @__PURE__ */ React.createElement("p", { className: "text-on-surface-variant leading-relaxed text-sm" }, point.description)
  ))))), /* @__PURE__ */ React.createElement("section", { className: "py-16 md:py-24" }, /* @__PURE__ */ React.createElement("div", { className: "max-w-5xl mx-auto px-6 md:px-10" }, /* @__PURE__ */ React.createElement("div", { className: "text-center mb-14" }, /* @__PURE__ */ React.createElement("span", { className: "inline-block bg-secondary/30 text-secondary text-xs font-bold uppercase tracking-[0.2em] px-4 py-1.5 rounded-full mb-4" }, "Our Team"), /* @__PURE__ */ React.createElement("h2", { className: "font-headline text-3xl md:text-4xl font-extrabold text-on-surface mb-4" }, "Meet the People Behind the Work"), /* @__PURE__ */ React.createElement("p", { className: "text-on-surface-variant max-w-2xl mx-auto" }, "A diverse group of talented individuals who bring passion, expertise, and heart to every project we take on.")), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 md:grid-cols-3 gap-8" }, teamMembers.map((member, idx) => /* @__PURE__ */ React.createElement(
    "div",
    {
      key: idx,
      className: "bg-surface rounded-2xl p-6 shadow-sm border border-outline-variant/10 text-center hover:shadow-md transition-all group"
    },
    /* @__PURE__ */ React.createElement("div", { className: "w-28 h-28 mx-auto mb-5 rounded-full overflow-hidden ring-2 ring-primary/10 group-hover:ring-primary/30 transition-all" }, /* @__PURE__ */ React.createElement(
      ExepadImage,
      {
        ...member.image,
        width: 200,
        height: 200,
        className: "w-full h-full object-cover"
      }
    )),
    /* @__PURE__ */ React.createElement("h3", { className: "font-headline text-lg font-bold text-on-surface mb-1" }, member.name),
    /* @__PURE__ */ React.createElement("p", { className: "text-primary text-sm font-semibold mb-3" }, member.role),
    /* @__PURE__ */ React.createElement("p", { className: "text-on-surface-variant text-sm leading-relaxed" }, member.bio)
  ))))), /* @__PURE__ */ React.createElement("section", { className: "py-16 md:py-24 bg-primary" }, /* @__PURE__ */ React.createElement("div", { className: "max-w-4xl mx-auto px-6 md:px-10 text-center" }, /* @__PURE__ */ React.createElement("h2", { className: "font-headline text-3xl md:text-4xl font-extrabold text-on-primary mb-4" }, "Let's Create Something Beautiful Together"), /* @__PURE__ */ React.createElement("p", { className: "text-on-primary text-lg max-w-2xl mx-auto mb-8 leading-relaxed" }, "Whether you have a project in mind or just want to say hello, we'd love to hear from you. Let's start a conversation."), /* @__PURE__ */ React.createElement(
    Link,
    {
      to: "/contact",
      className: "inline-flex items-center gap-2 bg-surface text-primary font-bold px-8 py-3.5 rounded-2xl hover:bg-surface-container transition-all shadow-sm"
    },
    "Get in Touch",
    /* @__PURE__ */ React.createElement(Icons.ArrowRight, { className: "w-5 h-5" })
  )))));
}
var AboutContent_default = AboutContent;
export {
  AboutContent_default as default
};
