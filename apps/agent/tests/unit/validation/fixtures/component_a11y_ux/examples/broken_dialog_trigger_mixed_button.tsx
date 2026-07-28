import { Button, DialogTrigger, Icons } from "@exepad/sdk";

export default function OpenButton() {
  return (
    <DialogTrigger asChild>
      <Button><Icons.Plus />Add Item</Button>
    </DialogTrigger>
  );
}
