const STATUS_STYLES = {
  Paid: "bg-green-100 text-green-800",
  Pending: "bg-yellow-100 text-yellow-800",
  Sent: "bg-blue-100 text-blue-800",
};

export default function StatusBadge({ status }: { status: string }) {
  return <span className={STATUS_STYLES[status as keyof typeof STATUS_STYLES]}>{status}</span>;
}
