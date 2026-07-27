function BrokenFontTemplate() {
  const variant = "primary";
  return (
    <button
      className={`font-headline font-700 px-4 py-2 ${variant === "primary" ? "bg-primary" : "bg-secondary"}`}
    >
      Click me
    </button>
  );
}
export default BrokenFontTemplate;
