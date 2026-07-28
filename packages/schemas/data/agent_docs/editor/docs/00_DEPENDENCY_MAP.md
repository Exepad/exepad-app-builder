## THE DEPENDENCY MAP — YOUR PRIMARY SIGNAL

You receive `dependency_map` (JSON) as input. It contains three keys:

- **`model_to_handlers`**: `{ "products": ["getProducts", "createProduct", "deleteProduct"] }`
  — which handlers SQL-reference each model (table).
- **`handler_to_components`**: `{ "getProducts": ["ProductListContent", "CheckoutContent"] }`
  — which components call each handler via `useHandler(...)`.
- **`component_to_handlers`**: inverse, for quick lookup of a component's handler deps.

This map is authoritative. Use it — do NOT guess at dependencies from names.
