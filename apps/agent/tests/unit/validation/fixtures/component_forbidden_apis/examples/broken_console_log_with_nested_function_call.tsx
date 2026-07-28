export default function NestedDebug({ rows }) {
  console.log(JSON.stringify({ first: rows[0], count: rows.length }), "extra");
  return <div>{rows.length}</div>;
}
