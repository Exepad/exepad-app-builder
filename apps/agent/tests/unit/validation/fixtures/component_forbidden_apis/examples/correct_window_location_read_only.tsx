export default function PathDisplay() {
  const path = window.location.pathname;
  const fragment = window.location.hash;
  function refresh() {
    window.location.reload();
  }
  return (
    <div>
      <span>{path}</span>
      <span>{fragment}</span>
      <button onClick={refresh}>reload</button>
    </div>
  );
}
