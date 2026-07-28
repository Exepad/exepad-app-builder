const products = [
  { id: 1, name: "Alpha", image: "https://images.unsplash.com/alpha.jpg" },
  { id: 2, name: "Beta", image: "https://picsum.photos/seed/beta/300/200" },
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
