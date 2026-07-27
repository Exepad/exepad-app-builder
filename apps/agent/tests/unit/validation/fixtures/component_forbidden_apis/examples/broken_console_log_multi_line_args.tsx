export default function ReportTable({ rows }) {
  console.log(
    "report",
    rows.length,
    rows[0],
  );
  return <table>{rows.length}</table>;
}
