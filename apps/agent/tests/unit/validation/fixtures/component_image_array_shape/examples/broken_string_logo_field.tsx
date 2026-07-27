import { React, ExepadImage } from "@exepad/sdk";

const PROVIDERS = [
  { name: "AWS", logo: "amazon web services aws logo blue" },
  { name: "Azure", logo: "microsoft azure logo blue cloud" },
  { name: "GCP", logo: "google cloud platform gcp logo" }
];

function LogoGrid() {
  return (
    <div className="grid grid-cols-3 gap-4">
      {PROVIDERS.map((provider, idx) => (
        <div key={idx} className="flex flex-col items-center">
          <ExepadImage
            keywords={provider.logo}
            importance={4}
            width={80}
            height={80}
            className="w-12 h-12 object-contain"
          />
          <span>{provider.name}</span>
        </div>
      ))}
    </div>
  );
}

export default LogoGrid;
