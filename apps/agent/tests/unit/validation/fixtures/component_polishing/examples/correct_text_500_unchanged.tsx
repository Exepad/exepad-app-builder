// Shade 500 is borderline-passing AA on light backgrounds — fixer
// only rewrites 300/400.
export default function MidLabel() {
  return <p className="text-gray-500">Mid contrast</p>;
}
