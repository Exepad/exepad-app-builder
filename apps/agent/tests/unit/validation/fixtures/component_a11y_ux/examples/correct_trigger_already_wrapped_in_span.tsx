import { Button, DialogTrigger, Icons } from "@exepad/sdk";

export default function OpenButton() {
  return (
    <DialogTrigger asChild>
      <Button>
        <span className="inline-flex items-center gap-2"><Icons.Plus />Add Item</span>
      </Button>
    </DialogTrigger>
  );
}
