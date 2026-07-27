import { Button, DialogTrigger } from "@exepad/sdk";

export default function OpenButton() {
  return (
    <DialogTrigger asChild>
      <Button>Open</Button>
    </DialogTrigger>
  );
}
