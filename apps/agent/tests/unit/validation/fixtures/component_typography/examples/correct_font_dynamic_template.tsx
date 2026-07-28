function CorrectFontDynamicTemplate() {
  // Dynamic interpolation — the fixer can't know what `weight` resolves
  // to, so it must NOT mutate this className. The companion AST rule
  // surfaces the warning instead.
  const weight = 700;
  return (
    <h1 className={`font-headline font-${weight} text-4xl`}>Heading</h1>
  );
}
export default CorrectFontDynamicTemplate;
