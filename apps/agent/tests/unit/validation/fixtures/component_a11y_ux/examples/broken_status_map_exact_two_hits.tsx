const ORDER_LABELS = {
  Paid: "Payment received",
  Refunded: "Money returned",
};

export default function OrderRow({ status }: { status: string }) {
  return <span>{ORDER_LABELS[status as keyof typeof ORDER_LABELS]}</span>;
}
