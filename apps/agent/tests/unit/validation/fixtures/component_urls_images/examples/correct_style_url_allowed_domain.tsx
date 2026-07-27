/**
 * Style url() pointing at an allowed image domain (storage.googleapis.com)
 * must pass through unchanged.
 */
export default function StyledHero() {
  return (
    <section
      className="h-96"
      style={{
        backgroundImage:
          "url('https://storage.googleapis.com/exepad-published/hero.webp')",
      }}
    >
      <h1>Welcome</h1>
    </section>
  );
}
