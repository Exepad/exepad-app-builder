function CorrectArbitraryFont700() {
  // Tailwind v4 accepts the arbitrary form `font-[700]`. The fixer must
  // leave it alone.
  return (
    <h1 className="font-headline font-[700] text-4xl">Heading</h1>
  );
}
export default CorrectArbitraryFont700;
