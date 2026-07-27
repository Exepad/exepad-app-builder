export default function Gallery() {
  const items = [{ title: "a" }, { title: "b" }];
  return (
    <div className="grid grid-cols-2 gap-4">
      {items.map((item) => (
        <img
          key={item.title}
          src="https://images.unsplash.com/photo-123/real.jpg"
          alt={item.title}
          className="w-full"
        />
      ))}
    </div>
  );
}
