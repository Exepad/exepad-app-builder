import {
  React,
  Button,
  Icons,
  cn,
} from "@exepad/sdk";

interface FaqItem {
  question: string;
  answer: string;
}

const FAQ_ITEMS: FaqItem[] = [
  {
    question: "How does LaunchPad AI generate content?",
    answer: "LaunchPad AI uses advanced language models including GPT-4 and Claude to understand your writing context and generate high-quality suggestions. It learns from your style to produce content that sounds authentically you.",
  },
  {
    question: "Is my content private and secure?",
    answer: "Absolutely. We use end-to-end encryption for all documents. Your content is never used to train AI models, and you retain full ownership of everything you create. We're SOC 2 Type II certified.",
  },
  {
    question: "Can I use LaunchPad AI for any type of writing?",
    answer: "Yes! LaunchPad AI works great for blog posts, marketing copy, emails, social media content, technical documentation, creative writing, and more. The tone adjustment feature lets you adapt to any context.",
  },
  {
    question: "What happens when I reach my word limit?",
    answer: "On the Free plan, you'll be notified when approaching your 5,000-word limit. You can upgrade anytime to continue writing. Pro and Enterprise plans offer generous or unlimited word counts.",
  },
  {
    question: "Does LaunchPad AI support languages other than English?",
    answer: "Yes, we support over 30 languages including Spanish, French, German, Japanese, Chinese, Portuguese, and more. You can write in one language and translate to another with one click.",
  },
  {
    question: "Can I cancel my subscription at any time?",
    answer: "Yes, you can cancel anytime with no penalties. If you cancel, you'll retain access until the end of your billing period. We also offer a 14-day money-back guarantee on all paid plans.",
  },
];

function FaqSection() {
  const [openIndex, setOpenIndex] = React.useState<number | null>(null);

  const toggle = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section id="faq" className="py-20 sm:py-28 bg-muted/30">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        {/* Header */}
        <div className="text-center mb-12">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider mb-2">FAQ</p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
            Frequently Asked Questions
          </h2>
          <p className="text-lg text-muted-foreground">
            Everything you need to know about LaunchPad AI.
          </p>
        </div>

        {/* Accordion */}
        <div className="space-y-3">
          {FAQ_ITEMS.map((item, index) => {
            const isOpen = openIndex === index;
            return (
              <div
                key={index}
                className="faq-item rounded-lg border border-border bg-card overflow-hidden"
              >
                <button
                  onClick={() => toggle(index)}
                  className="w-full flex items-center justify-between px-6 py-4 text-left"
                >
                  <span className="text-sm font-semibold pr-4">{item.question}</span>
                  <Icons.ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                      isOpen && "rotate-180"
                    )}
                  />
                </button>
                {isOpen && (
                  <div className="px-6 pb-4">
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {item.answer}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Contact CTA */}
        <div className="text-center mt-12 p-8 rounded-2xl border border-border bg-card">
          <h3 className="text-lg font-semibold mb-2">Still have questions?</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Our team is here to help. Reach out and we'll get back to you within 24 hours.
          </p>
          <Button variant="outline" className="gap-2">
            <Icons.Mail className="h-4 w-4" />
            Contact Support
          </Button>
        </div>
      </div>
    </section>
  );
}

export default FaqSection;
