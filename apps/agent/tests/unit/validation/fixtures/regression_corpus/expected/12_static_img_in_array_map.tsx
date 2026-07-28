// Provenance: scope_blind_map_img_fixer memory — pre-fix, the regex
// auto-fixer that swapped a static <img src="..."/> inside `.map(...)`
// for a per-item dynamic src had a 3000-char window. With nested JSX
// trees larger than that window, it would happily mutate sibling JSX
// outside the .map() body. Now paren-balanced and AST-aware — this
// fixture pins the safe behavior.

import { React } from '@exepad/sdk';

const items = [
  { image: "__PLACEHOLDER__",  id: 1, name: "alpha" },
  { image: "__PLACEHOLDER__",  id: 2, name: "beta" },
];

const C = () => (
  <ul>
    {items.map((item) => (
      <li key={item.id} className="flex items-center gap-2">
        <img src={item.image} alt="cover" className="h-10 w-10" />
        <span>{item.name}</span>
      </li>
    ))}
  </ul>
);

export default C;
