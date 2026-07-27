const products = [
  { id: 1, name: "Alpha", image: "__PLACEHOLDER__" },
  { id: 2, name: "Beta", image: "__PLACEHOLDER__" },
];

export default function ProductList() {
  return (
    <ul className="grid grid-cols-2 gap-4">
      {products.map((p) => (
        <li key={p.id}>
          <img src={p.image} alt={p.name} className="h-32 w-full" />
          <span>{p.name}</span>
        </li>
      ))}
    </ul>
  );
}
