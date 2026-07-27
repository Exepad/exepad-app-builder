import { Button, DialogTrigger, Icons } from "@exepad/sdk";

export default function MenuButton() {
  return (
    <DialogTrigger asChild>
      <Button><Icons.Menu /></Button>
    </DialogTrigger>
  );
}
