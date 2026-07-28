// Inline read-only rating inside a table cell; value is `hike.rating ?? 0`.
// The fixer must extract the parenthesized value expression intact.
import { Icons } from "@exepad/sdk";

export function HikeRow({ hike }: { hike: { rating: number } }) {
  return (
    <td className="px-6 py-4">
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <Icons.Star
            key={star}
            className={`w-4 h-4 ${star <= (hike.rating ?? 0) ? "text-primary fill-primary" : "text-outline-variant"}`}
          />
        ))}
      </div>
    </td>
  );
}
