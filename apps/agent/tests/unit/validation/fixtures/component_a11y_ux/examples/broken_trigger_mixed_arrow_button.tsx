import { DialogTrigger, Button, Icons } from "@exepad/sdk";

// Regression: an icon+TEXT Button whose onClick holds an arrow function under a
// Trigger asChild. It SHOULD get the single-<span> wrap — and the arrow handler
// must survive intact (before the fix the `>` in `=>` split the open tag and the
// wrap corrupted the JSX). The `onClick={() => onOpen()}` staying whole in the
// output is the proof the tag boundary was found correctly.
export default function AddHike({ onOpen }: { onOpen: () => void }) {
  return (
    <DialogTrigger asChild>
      <Button onClick={() => onOpen()} className="gap-2">
        <Icons.Plus className="w-4 h-4" /> Add Hike
      </Button>
    </DialogTrigger>
  );
}
