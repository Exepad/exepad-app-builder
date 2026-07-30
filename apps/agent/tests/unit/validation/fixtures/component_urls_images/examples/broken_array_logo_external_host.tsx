import { React } from "@exepad/sdk";

export default function PartnerLogos() {
  const partners = [
    { name: "Migros", logo: "https://upload.wikimedia.org/wikipedia/tr/b/b2/Migros_Logo.png" },
    { name: "CarrefourSA", logo: "https://upload.wikimedia.org/wikipedia/tr/b/b5/CarrefourSA_Logo.png" },
  ];
  return (
    <div>
      {partners.map((p, i) => (
        <div key={i}>{p.name}</div>
      ))}
    </div>
  );
}
