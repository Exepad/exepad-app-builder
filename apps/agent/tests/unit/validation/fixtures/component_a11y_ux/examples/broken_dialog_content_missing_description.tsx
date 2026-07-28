import { Dialog, DialogContent, DialogTitle } from "@exepad/sdk";

export default function ConfirmDialog() {
  return (
    <Dialog>
      <DialogContent>
        <DialogTitle>Confirm action</DialogTitle>
        <p>Are you sure?</p>
      </DialogContent>
    </Dialog>
  );
}
