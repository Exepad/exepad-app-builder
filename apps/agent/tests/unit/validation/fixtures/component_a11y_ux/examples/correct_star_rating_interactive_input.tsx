// Interactive rating INPUT: each star is its own <button aria-label>. This is
// not an image — the fixer must NOT add role="img" to the container.
import { Icons } from "@exepad/sdk";

export function RatingInput({ rating, setRating }: { rating: number; setRating: (n: number) => void }) {
  return (
    <div className="flex">
      {[1, 2, 3, 4, 5].map((star) => (
        <button key={star} aria-label={`Rate ${star} stars`} onClick={() => setRating(star)}>
          <Icons.Star className={star <= rating ? "fill" : ""} />
        </button>
      ))}
    </div>
  );
}
