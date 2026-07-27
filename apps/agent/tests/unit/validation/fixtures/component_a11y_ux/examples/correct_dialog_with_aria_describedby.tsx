import { Dialog, DialogContent, DialogTitle } from "@exepad/sdk";

// DialogContent already has aria-describedby — author has opted into a
// custom description target, so the auto-fix must NOT inject a default
// DialogDescription.
export default function CustomDescDialog() {
  return (
    <Dialog>
      <DialogContent aria-describedby="custom-desc">
        <DialogTitle>Custom description target</DialogTitle>
        <p id="custom-desc">Custom description content</p>
      </DialogContent>
    </Dialog>
  );
}
