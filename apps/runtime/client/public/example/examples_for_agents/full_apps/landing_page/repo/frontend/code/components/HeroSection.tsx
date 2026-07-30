import {
  React,
  Button,
  Input,
  Badge,
  Icons,
} from "@exepad/sdk";

interface StatItem {
  value: string;
  label: string;
}

const STATS: StatItem[] = [
  { value: "50K+", label: "Active Users" },
  { value: "10M+", label: "Words Generated" },
  { value: "4.9/5", label: "User Rating" },
];

function HeroSection() {
  const [email, setEmail] = React.useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
  };

  return (
    <section id="hero" className="relative overflow-hidden bg-gradient-to-br from-violet-600 via-indigo-600 to-purple-700">
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20 lg:py-28">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Left content */}
          <div className="text-center lg:text-left">
            <Badge variant="secondary" className="mb-6 bg-white/20 text-white border-white/30 hover:bg-white/25">
              <Icons.Zap className="h-3 w-3 mr-1" />
              Powered by GPT-4 &amp; Claude
            </Badge>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-tight mb-6">
              Write Smarter,{" "}
              <span className="text-purple-200">Not Harder</span>
            </h1>

            <p className="text-lg sm:text-xl text-purple-100 max-w-lg mx-auto lg:mx-0 mb-8 leading-relaxed">
              LaunchPad AI is your intelligent writing companion. Generate blog posts, emails, ad copy, and more in seconds — with the tone and style that matches your brand.
            </p>

            {/* Email CTA */}
            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto lg:mx-0 mb-4">
              <Input
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                className="h-12 bg-white/10 border-white/20 text-white placeholder:text-purple-200 focus-visible:ring-white/40"
              />
              <Button
                type="submit"
                size="lg"
                className="h-12 px-8 bg-white text-primary hover:bg-purple-50 font-semibold"
              >
                Start Free Trial
              </Button>
            </form>

            <p className="text-sm text-purple-200 flex items-center justify-center lg:justify-start gap-1">
              <Icons.Shield className="h-3.5 w-3.5" />
              No credit card required. 14-day free trial.
            </p>

            {/* Stats */}
            <div className="flex items-center justify-center lg:justify-start gap-8 mt-10 pt-10 border-t border-white/20">
              {STATS.map((stat) => (
                <div key={stat.label} className="stat-item text-center lg:text-left">
                  <div className="text-2xl sm:text-3xl font-bold text-white">{stat.value}</div>
                  <div className="text-sm text-purple-200">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: UI mockup placeholder */}
          <div className="hidden lg:flex justify-center">
            <div className="relative w-full max-w-md">
              <div className="rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 p-6 shadow-2xl">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-3 h-3 rounded-full bg-red-400" />
                  <div className="w-3 h-3 rounded-full bg-yellow-400" />
                  <div className="w-3 h-3 rounded-full bg-green-400" />
                  <span className="ml-2 text-xs text-purple-200">LaunchPad AI Editor</span>
                </div>
                <div className="space-y-3">
                  <div className="h-3 bg-white/20 rounded-full w-full" />
                  <div className="h-3 bg-white/20 rounded-full w-4/5" />
                  <div className="h-3 bg-white/20 rounded-full w-3/5" />
                  <div className="h-8 mt-4" />
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-white/10 border border-white/10">
                    <Icons.Sparkles className="h-4 w-4 text-purple-200" />
                    <span className="text-sm text-purple-100">AI is writing your next paragraph...</span>
                  </div>
                  <div className="h-3 bg-purple-300/30 rounded-full w-full" />
                  <div className="h-3 bg-purple-300/30 rounded-full w-5/6" />
                  <div className="h-3 bg-purple-300/30 rounded-full w-2/3" />
                </div>
              </div>
              {/* Floating badge */}
              <div className="absolute -bottom-4 -left-4 bg-white rounded-xl shadow-lg px-4 py-3 flex items-center gap-2">
                <Icons.CheckCircle className="h-5 w-5 text-green-500" />
                <div>
                  <div className="text-sm font-semibold text-gray-900">Grammar check</div>
                  <div className="text-xs text-gray-500">0 issues found</div>
                </div>
              </div>
              {/* Floating badge right */}
              <div className="absolute -top-4 -right-4 bg-white rounded-xl shadow-lg px-4 py-3 flex items-center gap-2">
                <Icons.TrendingUp className="h-5 w-5 text-primary" />
                <div>
                  <div className="text-sm font-semibold text-gray-900">SEO Score</div>
                  <div className="text-xs text-gray-500">95/100</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default HeroSection;
