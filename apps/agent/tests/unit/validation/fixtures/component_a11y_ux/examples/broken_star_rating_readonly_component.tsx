// Read-only star rating in a StarRating component: the value is conveyed only
// by icon fill. The fixer must add role="img" + aria-label={`${rating} out of
// 5 stars`} on the container so a screen reader announces the value.
import { Icons } from "@exepad/sdk";

export function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Icons.Star
          key={star}
          className={`w-4 h-4 ${star <= rating ? "text-secondary" : "text-outline-variant/40"}`}
          fill={star <= rating ? "var(--color-secondary)" : "transparent"}
        />
      ))}
    </div>
  );
}
