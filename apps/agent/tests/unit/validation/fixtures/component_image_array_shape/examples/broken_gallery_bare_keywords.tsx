import { ExepadImage, LightDOMContainer, React } from '@exepad/sdk';

interface GalleryItem {
  id: string;
  category: string;
  keywords: string;
  caption: string;
  size: string;
}

const GALLERY_DATA: GalleryItem[] = [
  {
    id: "1",
    category: "food",
    keywords: "high-end italian pasta dish top-down atmospheric lighting gourmet",
    caption: "Our signature handmade Tagliatelle.",
    size: "square",
  },
  {
    id: "2",
    category: "interiors",
    keywords: "luxury italian restaurant interior warm lighting marble bar wide shot",
    caption: "The L'Anima bar.",
    size: "wide",
  },
  {
    id: "3",
    category: "food",
    keywords: "close-up fresh italian ingredients basil tomatoes olive oil splash",
    caption: "DOP ingredients.",
    size: "tall",
  },
];

function GalleryContent() {
  return (
    <LightDOMContainer>
      <div className="grid grid-cols-3 gap-6">
        {GALLERY_DATA.map((item) => (
          <ExepadImage
            key={item.id}
            keywords={item.keywords}
            importance={6}
            width={800}
            height={800}
            className="w-full h-full object-cover"
          />
        ))}
      </div>
    </LightDOMContainer>
  );
}

export default GalleryContent;
