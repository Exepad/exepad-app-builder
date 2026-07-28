const features = [
  { id: 1, title: "Speed", image: "__PLACEHOLDER__" },
  { id: 2, title: "Reliability", image: "__PLACEHOLDER__" },
];

export default function Features() {
  return (
    <ul>
      {features.map((feature) => (
        <li key={feature.id}>
          <img src={feature.image} alt={feature.title} />
          <h3>{feature.title}</h3>
        </li>
      ))}
    </ul>
  );
}
