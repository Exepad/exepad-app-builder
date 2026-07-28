// Cross-branch fixture — exercises 4+ fix paths in one file:
//   1. Icon typo close-match  (Icons.HearttIcon -> Icons.Heart)
//   2. Hallucinated img URL   -> __PLACEHOLDER__ -> ExepadImage
//   3. Bare-slug navigate()   ("about" -> "/about")
//   4. Existing ExepadImage missing keywords + importance + dimensions
//
// Verifies that fixes from independent branches all fire in one pass and
// that the second pass is a no-op (idempotence across branches).
import { Icons, useNavigate } from "@/sdk";

export default function LandingPage() {
  const navigate = useNavigate();
  return (
    <main>
      <header className="flex items-center gap-2">
        <Icons.HearttIcon className="h-5 w-5" />
        <button onClick={() => navigate("about")}>About</button>
      </header>

      <img
        src="https://images.unsplash.com/hero.jpg"
        alt="modern minimalist office workspace bright"
        className="h-96 w-full"
      />

      <ExepadImage alt="cozy reading nook with warm lamp light" />
    </main>
  );
}
