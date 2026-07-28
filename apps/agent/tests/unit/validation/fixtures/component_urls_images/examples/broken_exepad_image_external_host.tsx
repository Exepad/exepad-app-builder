import { ExepadImage } from "@exepad/sdk";

export default function PartnerBanner() {
  return (
    <ExepadImage
      keywords="partner logo Migros retail"
      importance={5}
      width={150}
      height={40}
      className="h-10 w-auto object-contain"
      src="https://upload.wikimedia.org/wikipedia/tr/b/b2/Migros_Logo.png"
      vendor="catalog"
    />
  );
}
