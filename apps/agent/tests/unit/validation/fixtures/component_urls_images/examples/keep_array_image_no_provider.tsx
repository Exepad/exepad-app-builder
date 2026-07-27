export default function Gallery() {
  const items = [
    { image: "https://images.unsplash.com/photo-aaa", title: "One" },
    { image: "https://images.pexels.com/photos/123/x.jpg", title: "Two" },
  ];
  return (
    <div className="grid grid-cols-2 gap-4">
      {items.map((it) => (
        <img key={it.title} src={it.image} alt={it.title} className="w-full" />
      ))}
    </div>
  );
}
