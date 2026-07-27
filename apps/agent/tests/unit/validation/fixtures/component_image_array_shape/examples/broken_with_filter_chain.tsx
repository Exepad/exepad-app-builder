import { ExepadImage, LightDOMContainer, React } from '@exepad/sdk';

const ITEMS = [
  { id: "a", category: "food", keywords: "italian pasta dish gourmet plating top-down" },
  { id: "b", category: "food", keywords: "italian risotto saffron top-down detail" },
  { id: "c", category: "drinks", keywords: "italian wine glass dark backdrop fine art" },
];

function FilteredGallery() {
  const { useState, useMemo } = React;
  const [cat, setCat] = useState("food");
  const visible = useMemo(() => ITEMS.filter((i) => i.category === cat), [cat]);
  return (
    <LightDOMContainer>
      <div>
        {visible.map((item) => (
          <ExepadImage
            key={item.id}
            keywords={item.keywords}
            importance={5}
            width={600}
            height={600}
          />
        ))}
      </div>
    </LightDOMContainer>
  );
}

export default FilteredGallery;
