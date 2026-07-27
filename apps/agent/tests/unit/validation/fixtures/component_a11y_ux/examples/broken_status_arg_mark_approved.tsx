export default function ApprovalButton({ markAsApproved }: { markAsApproved: (s: string) => void }) {
  return <button onClick={() => markAsApproved("Approved")}>Approve</button>;
}
