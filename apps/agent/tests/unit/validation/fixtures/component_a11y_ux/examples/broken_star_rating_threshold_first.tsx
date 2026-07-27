// Review Finding 2: a guard/threshold comparison (`star < 6`) precedes the real
// rating comparison. The fixer must skip the numeric-literal bound and label
// with the DYNAMIC value (`rating`), not "6 out of 5 stars".
import { Icons } from "@exepad/sdk";

export function Rated({ rating }: { rating: number }) {
  return (
    <div className="flex">
      {[1, 2, 3, 4, 5].map((star) => (
        <Icons.Star
          key={star}
          className={[star < 6 && "block", star <= rating ? "gold" : "gray"].filter(Boolean).join(" ")}
        />
      ))}
    </div>
  );
}
