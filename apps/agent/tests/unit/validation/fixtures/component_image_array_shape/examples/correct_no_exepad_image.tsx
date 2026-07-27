import { LightDOMContainer, React } from '@exepad/sdk';

const SEARCH_FILTERS = [
  { id: "italian", keywords: "pizza pasta risotto", label: "Italian" },
  { id: "japanese", keywords: "sushi ramen tempura", label: "Japanese" },
];

function FilterList() {
  return (
    <LightDOMContainer>
      <ul>
        {SEARCH_FILTERS.map((f) => (
          <li key={f.id} data-keywords={f.keywords}>{f.label}</li>
        ))}
      </ul>
    </LightDOMContainer>
  );
}

export default FilterList;
