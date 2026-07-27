import { useState, useEffect } from "react";

export default function Counter() {
  const [n, setN] = useState(0);
  useEffect(() => {
    document.title = String(n);
  }, [n]);
  return <span>{n}</span>;
}
