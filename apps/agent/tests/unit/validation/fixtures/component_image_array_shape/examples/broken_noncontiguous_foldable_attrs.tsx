import { ExepadImage, LightDOMContainer, React } from '@exepad/sdk';

const PRODUCTS = [
  { id: "p1", keywords: "modern wireless headphones product photography studio lighting", caption: "Studio cans" },
  { id: "p2", keywords: "vintage typewriter desk warm light retro aesthetic", caption: "Retro tools" },
];

function Catalog() {
  return (
    <LightDOMContainer>
      <div className="grid grid-cols-2">
        {PRODUCTS.map((item) => (
          <ExepadImage
            key={item.id}
            keywords={item.keywords}
            width={500}
            importance={item.importance}
            height={300}
            className="foo"
          />
        ))}
      </div>
    </LightDOMContainer>
  );
}

export default Catalog;
