export default function NavCluster() {
  function goAssign() {
    window.location.assign('/foo');
  }
  function goReplace() {
    window.location.replace('/bar');
  }
  return (
    <div>
      <button onClick={goAssign}>foo</button>
      <button onClick={goReplace}>bar</button>
    </div>
  );
}
