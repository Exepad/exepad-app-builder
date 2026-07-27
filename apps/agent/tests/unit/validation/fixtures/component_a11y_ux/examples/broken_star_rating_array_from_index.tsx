// Array.from + 0-indexed comparison (`i < score`). N comes from length: 5.
import { Icons } from "@exepad/sdk";

export function Score({ score }: { score: number }) {
  return (
    <span className="stars">
      {Array.from({ length: 5 }).map((_, i) => (
        <Icons.Star key={i} className={i < score ? "on" : "off"} />
      ))}
    </span>
  );
}
