import { Dialog, DialogContent, DialogTitle } from "@exepad/sdk";

export default function ConfirmDialog() {
  return (
    <Dialog>
      <DialogContent>
        <DialogTitle>Confirm action</DialogTitle>
        <DialogDescription>Are you sure you want to proceed?</DialogDescription>
      </DialogContent>
    </Dialog>
  );
}
