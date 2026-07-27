// Review Finding 3: an interactive hover rating keyed on onMouseEnter (no
// onClick). Any on* handler marks it interactive — must NOT be labelled img.
import { Icons } from "@exepad/sdk";

export function HoverRating({ hover, setHover }: { hover: number; setHover: (n: number) => void }) {
  return (
    <div className="flex">
      {[1, 2, 3, 4, 5].map((star) => (
        <Icons.Star
          key={star}
          onMouseEnter={() => setHover(star)}
          className={star <= hover ? "fill" : "empty"}
        />
      ))}
    </div>
  );
}
