export default function ClickyCard() {
  return (
    <button onClick={(e) => console.log(e.currentTarget.id)}>
      Click me
    </button>
  );
}
