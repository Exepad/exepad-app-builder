export default function FadeInPanel() {
  return (
    <div
      className="animate-in fade-in p-4"
      style={{ animationDuration: 'var(--animation-duration)' }}
    >
      <h2>Panel</h2>
    </div>
  );
}
