export default function ProductCard() {
  return (
    <article className="rounded-lg border p-4">
      <img
        src="https://weird-cdn.example.test/asset/abc.jpg"
        alt="product"
        className="h-40 w-full object-cover"
      />
      <h3>Product</h3>
    </article>
  );
}
