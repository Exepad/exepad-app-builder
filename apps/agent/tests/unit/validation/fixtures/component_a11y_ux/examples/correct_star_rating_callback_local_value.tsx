// Review Finding 1 (HIGH): the rating value is a binding declared INSIDE the map
// callback (`const r = item.rating`). Labelling the container with `${r}` would
// reference an out-of-scope variable → runtime ReferenceError. Must NOT fire.
import { Icons } from "@exepad/sdk";

export function ReviewCard({ item }: { item: { rating: number } }) {
  return (
    <div className="flex">
      {[1, 2, 3, 4, 5].map((star) => {
        const r = item.rating;
        return <Icons.Star key={star} className={star <= r ? "fill" : "empty"} />;
      })}
    </div>
  );
}
