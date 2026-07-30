// Review Finding 4: `[...Array(5)]` spread form with 0-indexed comparison.
import { Icons } from "@exepad/sdk";

export function Rated({ rating }: { rating: number }) {
  return (
    <div className="flex">
      {[...Array(5)].map((_, i) => (
        <Icons.Star key={i} className={i < rating ? "on" : "off"} />
      ))}
    </div>
  );
}
