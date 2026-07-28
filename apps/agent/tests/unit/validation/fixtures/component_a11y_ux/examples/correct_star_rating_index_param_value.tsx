// Review Finding 1 (HIGH): value is the map's index PARAM `i`, undefined at the
// container. Must NOT fire.
import { Icons } from "@exepad/sdk";

export function Rated() {
  return (
    <div className="flex">
      {[1, 2, 3, 4, 5].map((star, i) => (
        <Icons.Star key={star} className={star <= i ? "fill" : "empty"} />
      ))}
    </div>
  );
}
