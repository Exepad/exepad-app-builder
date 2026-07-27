import { AlertDialogTrigger, Button, Icons } from "@exepad/sdk";

// Regression: an icon-ONLY Button whose onClick holds an arrow function. The
// `>` in `=>` must not be mistaken for the Button tag's closing `>`. Before the
// fix, the mixed-child wrapper mis-parsed the open tag, leaked the prop text into
// the "body", saw icon+text, and corrupted the JSX. It must be left untouched
// (icon-only, already has an aria-label → no wrap, no aria injection).
export default function DeleteRow({ id, onDelete }: { id: number; onDelete: (id: number) => void }) {
  return (
    <AlertDialogTrigger asChild>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onDelete(id)}
        className="text-on-surface-variant rounded-xl"
        aria-label="Delete row"
      >
        <Icons.Trash2 className="w-4 h-4" />
      </Button>
    </AlertDialogTrigger>
  );
}
