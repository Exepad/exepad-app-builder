## EXAMPLES

> All cross-file frontend work (component create/modify/remove, page add/remove,
> slug renames, nav-link cascades, image swaps) routes through
> **`frontend_build_actions`** — a list of `FrontendBuildAction`. Each has a
> free-text **`prompt`** (WHAT to change, in plain language) plus optional
> structured side-effects `page_creates` / `page_removes` / `page_slug_renames`.
> There is no `modify_component_actions`, `add_page_actions`,
> `modify_page_metadata_actions`, `building_plan`, or `component_name` field —
> put the change spec in the `prompt`. Title-only page renames use
> `rename_page_title_actions`.

### Example 1 — Simple component edit
**User:** "Change the CTA button to say 'Get Started Free'"
```json
{
  "reasoning": "Simple text change on the hero component. No cascade.",
  "frontend_build_actions": [
    {
      "prompt": "On the hero component, change the primary CTA button text to 'Get Started Free'. Keep all styling and click handlers unchanged."
    }
  ]
}
```

### Example 1b — Change a background image (image swap)
**User:** "Change the background in hero section"
```json
{
  "reasoning": "Image swap on the hero. Describe the new image's INTENT — the ComponentBuilder owns the <ExepadImage> JSX mechanics (deleting src, updating keywords) so the platform's image resolver refetches at deploy time.",
  "frontend_build_actions": [
    {
      "prompt": "Replace the hero section's background image with a cinematic sun-drenched organic farm landscape at golden hour, with rolling green hills and a rustic barn. Preserve the gradient overlay (absolute inset-0 bg-gradient-to-r ...) and z-index layers so the headline stays legible."
    }
  ]
}
```

**ANTI-PATTERN — do NOT do this in the `prompt`:**
```
"Update the ExepadImage keywords to '...'. Update the src to ...  Update alt text to '...'."
```
That's mechanics, not intent. The Editor doesn't own `<ExepadImage>`
semantics — ComponentBuilder does. Phrase the prompt as "Replace the X with
<new image description>" and let ComponentBuilder decide which props to
mutate. See `editor/docs/04_IMAGE_OPS.md`.

### Example 2 — Add page (nav cascade is part of the same action)
**User:** "Add an About page with team info"
```json
{
  "reasoning": "New page + nav link. One FrontendBuildAction: page_creates registers the page entry post-agent; the prompt describes the page content AND the nav-link update (the coding agent rewrites the header nav — no separate action needed).",
  "frontend_build_actions": [
    {
      "prompt": "Create an About page (AboutContent): a hero section with the company mission, a team grid of 4-6 members with photos/names/roles, and a company-values section with icon cards. Then add an 'About Us' navigation link pointing to '/about' after the existing header links.",
      "page_creates": [
        {
          "title": "About Us",
          "slug": "/about",
          "mount_components": ["AboutContent"]
        }
      ]
    }
  ]
}
```

### Example 3 — Full cascade (model → handler → components)
**User:** "Add a priority column to tasks, show it in the task list and dashboard"
**Assume** `dependency_map` shows `model_to_handlers.tasks = ["getTasks"]`
and `handler_to_components.getTasks = ["TaskListContent", "DashboardContent"]`.
```json
{
  "reasoning": "Model change affects getTasks (per model_to_handlers.tasks), which feeds TaskListContent and DashboardContent (per handler_to_components.getTasks). Emit the model action, the paired handler action, and one frontend action covering both components.",
  "change_backend_models_actions": [
    {
      "editor_prompt": "Add a 'priority' column to the tasks model: type text, required, default 'medium', values 'low'|'medium'|'high'."
    }
  ],
  "modify_handler_actions": [
    {
      "handler_name": "getTasks",
      "modification_plan": "Return the new 'priority' field on every task. Order results so high-priority tasks come first, breaking ties by newest creation date."
    }
  ],
  "frontend_build_actions": [
    {
      "prompt": "In TaskListContent, display a priority badge on each task (low/medium/high with color coding). In DashboardContent, add a 'High priority tasks' stat card showing the count of high-priority tasks. Both read from the updated getTasks handler."
    }
  ]
}
```

### Example 4 — New handler vs breaking modify (senior-engineer judgment call)
**User:** "Show only active products on the homepage"
**Assume** `dependency_map.handler_to_components.getProducts = ["HomeContent", "ShopContent", "CategoryContent", "SearchContent", "AdminContent"]` (5 callers).
```json
{
  "reasoning": "Modifying getProducts to filter by active=1 would break 4 unrelated pages. Create a new specialized handler getActiveProducts and migrate only HomeContent.",
  "add_handler_actions": [
    {
      "handler_name": "getActiveProducts",
      "auth_level": "public",
      "handler_type": "read",
      "inputs": [],
      "outputs": ["products: array", "total: number"],
      "logic": [
        "Return all products marked active, newest first (shared catalog — no owner filter, consistent with the public auth level).",
        "Output the products array plus a total count."
      ]
    }
  ],
  "frontend_build_actions": [
    {
      "prompt": "In HomeContent, switch the product list to use the new 'getActiveProducts' handler instead of 'getProducts'. Update the rendering as needed."
    }
  ]
}
```

### Example 5 — Backward-compatible signature edit (few callers)
**User:** "Let getOrders filter by status, optional"
**Assume** `handler_to_components.getOrders = ["OrdersContent", "DashboardContent"]` (2 callers).
```json
{
  "reasoning": "Optional input is backward-compatible and only 2 callers. Modify in place and update both components to pass the new filter.",
  "modify_handler_actions": [
    {
      "handler_name": "getOrders",
      "modification_plan": "Accept an optional 'status' input. When provided, restrict results to orders with that status; when absent, return all orders as before.",
      "new_inputs": ["status: text, optional"]
    }
  ],
  "frontend_build_actions": [
    {
      "prompt": "In OrdersContent, add a status dropdown filter and scope the orders list to the selected status (handler getOrders). In DashboardContent, add a status filter chip row above the orders summary and pass the selected status to getOrders."
    }
  ]
}
```

### Example 6 — Remove handler with callers
**User:** "Delete the getDeprecatedMetrics handler"
**Assume** `handler_to_components.getDeprecatedMetrics = ["HomeContent"]`.
```json
{
  "reasoning": "Remove the handler and pair it with a frontend action for HomeContent (its only caller) so the cross-validation cascade check passes.",
  "remove_handler_actions": [
    {"handler_name": "getDeprecatedMetrics"}
  ],
  "frontend_build_actions": [
    {
      "prompt": "In HomeContent, remove the call to the 'getDeprecatedMetrics' handler and any UI that rendered its results."
    }
  ]
}
```

### Example 7 — Rename a page title AND change its URL
**User:** "Rename the Shop page to Store and change the URL to /store"
**Assume** `frontend.pages` has an entry with `uuid: 'xyz-789'`, slug `/shop`.
```json
{
  "reasoning": "Two distinct changes on one page. Title-only metadata → rename_page_title_actions (deterministic, no agent). Slug change is a cross-file cascade (nav links / navigate() / Link to=) → frontend_build_actions.page_slug_renames, with the prompt covering the nav-label update.",
  "rename_page_title_actions": [
    {
      "page_uuid": "xyz-789",
      "new_title": "Store"
    }
  ],
  "frontend_build_actions": [
    {
      "prompt": "The Shop page's URL is changing from '/shop' to '/store'. Update the header nav link label from 'Shop' to 'Store' and rewrite every reference to '/shop' (nav links, navigate() calls, Link to=) to '/store'.",
      "page_slug_renames": [
        {"page_uuid": "xyz-789", "new_slug": "/store"}
      ]
    }
  ]
}
```

### Example 8 — Global style change, no cascade
**User:** "Make the app use a blue color scheme"
```json
{
  "reasoning": "Theme-only change, no other actions needed.",
  "modify_styles_actions": [
    {
      "editor_prompt": "Update primary to #1565C0 and secondary to #42A5F5. Adjust surface/on-surface for WCAG AA contrast."
    }
  ]
}
```

### Example 9 — Change a data value (no schema change)
**User:** "Change the price of the 'Starter' plan from $9 to $12"
**Assume** "## Existing Backend Models" lists a `plans` model with a `Starter` row.
```json
{
  "reasoning": "This edits an existing row's VALUE — no column or model change — so it routes to edit_seed_data_actions, not change_backend_models_actions (a value change sent there is a no-op).",
  "edit_seed_data_actions": [
    {
      "target_model_name": "plans",
      "editor_prompt": "In the plans model, update the row where name = 'Starter': set price to 12 (was 9). Do not change the schema or any other row."
    }
  ]
}
```

---

## ANTI-PATTERNS

- **WRONG:** Emitting into `modify_component_actions`, `add_page_actions`, or `modify_page_metadata_actions` — these keys do NOT exist on EditorOutput and are silently dropped. Use `frontend_build_actions` (with `page_creates` / `page_slug_renames`) and `rename_page_title_actions`.
- **WRONG:** Changing a handler's signature without checking `handler_to_components` and updating callers via a paired `frontend_build_action`.
- **WRONG:** Modifying a model without emitting a paired `modify_handler_action` for handlers in `model_to_handlers[model]`.
- **WRONG:** Removing a handler that components still reference (pair a `frontend_build_action` that updates the callers).
- **WRONG:** Using a component name in `page_removes` — use `page_uuid`.
- **WRONG:** Adding/removing/renaming a page but forgetting to describe the nav-link update in the `frontend_build_action` prompt (the nav cascade is the coding agent's job, driven by your prompt — not a separate action).
- **WRONG:** Putting a slug rename in `rename_page_title_actions` (it has no `new_slug`) — slug changes are cross-file cascades and go through `frontend_build_actions.page_slug_renames`.
- **WRONG:** Breaking-change signature edit with many callers when an `add_handler_action` would be cleaner.
- **WRONG:** Vague prompts like "make it better" — be specific.
- **WRONG:** Routing a data-VALUE change (a price, a name, a sample row) to `change_backend_models_actions` — that alters SCHEMA only, so the value never updates. Use `edit_seed_data_actions`.
- **NOTE:** Auth/security/roles are configured, NOT editor-editable. The router upstream sends such requests to help_desk; the Editor has no help_desk channel. If one still reaches the Editor, emit ZERO actions and explain in `reasoning`.
