export default function FadeInWithFallback() {
  return (
    <div
      className="animate-in fade-in p-4"
      style={{ animationDuration: 'var(--animation-duration, 200ms)' }}
    >
      <h2>Already correct</h2>
    </div>
  );
}
