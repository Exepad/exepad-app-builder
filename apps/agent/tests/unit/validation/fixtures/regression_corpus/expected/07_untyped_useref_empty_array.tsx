// Provenance: TypeScript strict mode infers `never[]` from a bare `[]`
// literal initializer. Any later `arr.push(item)` call then fails with
// tsc.2345 (target type 'never'). The polishing fixer annotates
// `useRef([])` / `useState([])` with `<any[]>` so the array opens to
// pushes of any shape. Already-typed forms (`useRef<Foo[]>([])`) and
// non-empty initializers are left intact.

import React, { useRef, useState } from "react";

const C = () => {
  const stack = useRef<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const typed = useRef<string[]>([]);
  const seeded = useState([1, 2, 3]);
  void stack; void items; void setItems; void typed; void seeded;
  return <div>refs</div>;
};

export default C;
