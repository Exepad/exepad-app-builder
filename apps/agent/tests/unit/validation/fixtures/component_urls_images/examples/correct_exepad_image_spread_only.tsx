/**
 * Spread-based ExepadImage tags get their keywords/importance/dimensions
 * from the spread object at runtime — the fixer must NOT inject defaults
 * (which would shadow whatever the spread provides).
 */
const heroImage = {
  keywords: "warm cafe interior morning sunlight",
  importance: 5,
  width: 800,
  height: 600,
};

export default function HeroSection() {
  return (
    <section>
      <ExepadImage {...heroImage} />
    </section>
  );
}
