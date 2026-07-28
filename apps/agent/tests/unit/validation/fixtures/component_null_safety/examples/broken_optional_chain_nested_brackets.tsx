export default function MatrixCell({ rows }: { rows: number[][] | null }) {
  return <span>{rows?.[0]?.[1].toFixed(2)}</span>;
}
