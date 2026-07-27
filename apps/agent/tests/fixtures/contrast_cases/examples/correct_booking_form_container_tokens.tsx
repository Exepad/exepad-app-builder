import { Icons, LightDOMContainer, React } from "@exepad/sdk";

// Harvested from session-20260413T181526-6f8448 — dog-walking booking app.
// Exercises the M3 *-container token family (bg-primary-container +
// text-on-primary-container, bg-secondary-container + text-on-secondary-
// container) which exposed a regex word-boundary false positive in the
// pre-fix detector (matched text-on-secondary inside text-on-secondary-
// container).  Must be silent.
export default function BookingForm() {
  return (
    <LightDOMContainer>
      <section className="bg-surface py-16">
        <div className="max-w-3xl mx-auto px-6">
          <form className="space-y-8">
            <div className="flex items-center gap-4 mb-2">
              <div className="w-10 h-10 rounded-xl bg-secondary-container flex items-center justify-center text-on-secondary-container">
                <Icons.User className="w-5 h-5" />
              </div>
              <h2 className="font-headline text-2xl font-bold">
                Your Information
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <label className="text-sm font-bold text-on-surface-variant uppercase tracking-wider">
                Full Name
              </label>
              <input
                className="w-full bg-surface-container border-none rounded-2xl px-5 py-4 text-on-surface"
                placeholder="Alistair Thorne"
              />
            </div>
            <div className="flex items-center gap-4 mt-8">
              <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container">
                <Icons.Calendar className="w-5 h-5" />
              </div>
              <h2 className="font-headline text-2xl font-bold">Schedule</h2>
            </div>
            <div className="w-10 h-10 rounded-xl bg-error-container flex items-center justify-center text-on-error-container">
              <Icons.AlertTriangle className="w-5 h-5" />
            </div>
          </form>
        </div>
      </section>
    </LightDOMContainer>
  );
}
