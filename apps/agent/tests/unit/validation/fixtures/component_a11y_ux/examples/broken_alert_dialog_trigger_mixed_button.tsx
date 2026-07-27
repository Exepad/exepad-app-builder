import { AlertDialogTrigger, Button, Icons } from "@exepad/sdk";

export default function DeleteButton() {
  return (
    <AlertDialogTrigger asChild>
      <Button><Icons.Trash />Delete</Button>
    </AlertDialogTrigger>
  );
}
