const features = [
  { id: 1, title: "Speed" },
  { id: 2, title: "Reliability" },
];

export default function Features() {
  return (
    <ul>
      {features.map((feature) => (
        <li key={feature.id}>
          <img src="https://example.test/static.jpg" alt={feature.title} />
          <h3>{feature.title}</h3>
        </li>
      ))}
    </ul>
  );
}
