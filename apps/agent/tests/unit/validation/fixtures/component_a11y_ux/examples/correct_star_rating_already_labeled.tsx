// Container already carries role="img" + aria-label — no double injection.
import { Icons } from "@exepad/sdk";

export function Rated({ rating }: { rating: number }) {
  return (
    <div role="img" aria-label={`${rating} out of 5 stars`} className="flex">
      {[1, 2, 3, 4, 5].map((s) => (
        <Icons.Star key={s} className={s <= rating ? "fill" : ""} />
      ))}
    </div>
  );
}
