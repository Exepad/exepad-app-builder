export default function ProfileLink({ userId }) {
  function go() {
    window.location.href = `/users/${userId}`;
  }
  return <button onClick={go}>profile</button>;
}
