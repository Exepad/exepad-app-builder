// Single status word (Paid) below the 2-hit threshold — must NOT rewrite,
// because the lowercase heuristic could otherwise trip on user-defined
// Pascal-cased map keys that happen to overlap with one status word.
const SHIPPING_LABELS = {
  Paid: "Order is paid",
  ExpressShip: "Express shipping",
  Tracking: "Track package",
};

export default function ShippingRow({ status }: { status: string }) {
  return <span>{SHIPPING_LABELS[status as keyof typeof SHIPPING_LABELS]}</span>;
}
