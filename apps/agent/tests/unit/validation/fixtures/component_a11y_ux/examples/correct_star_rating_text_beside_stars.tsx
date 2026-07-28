// Visible text sits beside the stars, so labelling the whole container "N out
// of 5 stars" would drop the "Rating:" text — the fixer must leave it alone.
import { Icons } from "@exepad/sdk";

export function Labelled({ rating }: { rating: number }) {
  return (
    <div className="flex">
      Rating: {[1, 2, 3, 4, 5].map((s) => (
        <Icons.Star key={s} className={s <= rating ? "fill" : ""} />
      ))}
    </div>
  );
}
