export default function HomeButton() {
  function go() {
    window.location = '/';
  }
  return <button onClick={go}>home</button>;
}
