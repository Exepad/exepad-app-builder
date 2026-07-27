import { Icons, LightDOMContainer, React } from "@exepad/sdk";

export default function MainHeader() {
  return (
    <LightDOMContainer>
      <header className="sticky top-0 z-40 border-b border-outline/20 bg-primary text-on-primary">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/80">
              <Icons.Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.28em]">Orbital Mail</p>
              <p className="text-lg font-semibold">Inbox automation</p>
            </div>
          </div>
          <nav className="flex items-center gap-6 text-sm font-medium">
            <a href="#product">Product</a>
            <a href="#security">Security</a>
            <a href="#pricing">Pricing</a>
          </nav>
        </div>
      </header>
    </LightDOMContainer>
  );
}
