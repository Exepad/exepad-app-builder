// Cross-branch: title-case status keys + DialogDescription missing +
// mixed icon+text Trigger Button + status arg literal — all in one file.
import { Button, Dialog, DialogContent, DialogTitle, DialogTrigger, Icons } from "@exepad/sdk";

const ORDER_STATUS_STYLES = {
  Paid: "text-green-700",
  Pending: "text-yellow-700",
  Cancelled: "text-red-700",
};

export default function OrderActions({ saveStatus }: { saveStatus: (s: string) => void }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button><Icons.Edit />Update status</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Update status</DialogTitle>
        <button onClick={() => saveStatus("Sent")}>Mark sent</button>
        <pre>{JSON.stringify(ORDER_STATUS_STYLES)}</pre>
      </DialogContent>
    </Dialog>
  );
}
