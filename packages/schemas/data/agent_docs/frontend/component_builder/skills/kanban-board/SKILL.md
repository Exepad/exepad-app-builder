---
name: kanban-board
description: "Kanban / board views for status-driven entities — HTML5 drag-and-drop between columns, persisted via useModel.update, with optimistic UI and drop-target highlighting. Load for pipeline/board pages in CRM, ATS, project management, or ticketing apps. Without this skill the LLM tends to default to broken click-to-move kanbans. Keywords: kanban, board, pipeline, hiring-pipeline, deal-pipeline, sales-pipeline, workflow, stages, drag-and-drop, draggable, columns, tasks, task-board, issues, tickets, applicant-tracking, ats, crm-pipeline, trello, jira-board."
metadata:
  kind: domain
---
# Skill: Kanban / Board Views for Data Apps

For status-driven entity workflows: hiring pipelines, deal pipelines, task boards,
issue trackers, support tickets, order fulfillment stages, content moderation
queues, etc. The defining feature is that **the user expects to drag cards
between columns** — not click a menu.

## Core Rule: Kanban MUST Be Draggable

If you render columns of cards that represent workflow stages, you MUST implement
HTML5 drag-and-drop that calls `update(...)` from `useModel` to persist the new
stage. A kanban without drag-and-drop is a bug, not a design choice.

**A dropdown menu "Move to Stage" is NOT a substitute.** It can exist as a
secondary affordance (for keyboard users or on mobile), but drag MUST be the
primary interaction.

**A decorative arrow/chevron icon on a card is NOT an interaction.** If it looks
clickable, users will click it. Either wire an `onClick` or remove it.

## The HTML5 Drag-and-Drop Pattern

Walled-garden constraint: no npm packages (`@dnd-kit`, `react-dnd`, etc. are not
available). Use the native HTML5 drag API via React synthetic events.

```
const [draggedId, setDraggedId] = React.useState<number | null>(null);
const [dragOverStage, setDragOverStage] = React.useState<string | null>(null);

function handleDragStart(e: React.DragEvent, cardId: number) {
  setDraggedId(cardId);
  e.dataTransfer.effectAllowed = "move";
  // dataTransfer.setData is REQUIRED for Firefox to initiate drag
  e.dataTransfer.setData("text/plain", String(cardId));
}

function handleDragOver(e: React.DragEvent, stageId: string) {
  e.preventDefault(); // REQUIRED — without this, onDrop never fires
  e.dataTransfer.dropEffect = "move";
  if (dragOverStage !== stageId) setDragOverStage(stageId);
}

function handleDragLeave(e: React.DragEvent) {
  // Only clear when leaving the column, not when moving over children
  if (e.currentTarget === e.target) setDragOverStage(null);
}

async function handleDrop(e: React.DragEvent, targetStage: string) {
  e.preventDefault();
  setDragOverStage(null);
  const id = draggedId;
  setDraggedId(null);
  if (id === null) return;
  const card = (applications ?? []).find(a => a.id === id);
  if (!card || card.stage === targetStage) return;
  try {
    await updateApplication(id, { stage: targetStage });
    toast.success(`Moved to ${targetStage}`);
  } catch {
    toast.error("Failed to move card");
  }
}

function handleDragEnd() {
  setDraggedId(null);
  setDragOverStage(null);
}
```

## Wiring Elements

On each **column** (drop target):
```
<div
  onDragOver={(e) => handleDragOver(e, stage.id)}
  onDragLeave={handleDragLeave}
  onDrop={(e) => handleDrop(e, stage.id)}
  className={`flex flex-col gap-3 min-h-[600px] p-2 rounded-sm border transition-colors
    ${dragOverStage === stage.id
      ? "bg-primary/10 border-primary border-dashed"
      : "bg-surface-container-low/30 border-outline-variant/10"}`}
>
```

On each **card** (drag source):
```
<div
  draggable
  onDragStart={(e) => handleDragStart(e, card.id)}
  onDragEnd={handleDragEnd}
  className={`group p-4 rounded-sm border shadow-sm cursor-grab active:cursor-grabbing
    transition-all duration-200
    ${draggedId === card.id ? "opacity-40 scale-95" : ""}`}
>
```

## Required Visual Feedback

Every kanban board MUST show all four of these states. Missing any one makes the
board feel broken:

| State | Visual cue |
|-------|-----------|
| Card is draggable | `cursor-grab` class on hover |
| Card is being dragged | `cursor-grabbing` (use `active:cursor-grabbing`) |
| Card is the drag source | `opacity-40` or `opacity-50 scale-95` while `draggedId === card.id` |
| Column is a valid drop target | Tinted background + dashed border while `dragOverStage === stage.id` |

## Defining `stages` (column scaffolding)

`stages` is the list of workflow columns the board renders. It is router/UI
scaffolding, not data — the items must mirror the `enum_values` declared on the
stage field of the model (e.g. `tasks.status`, `applications.stage`).

Declare it inline as a typed const at the top of the component. The
canonical scaffold is `{ id, label, icon, color }`: `id` mirrors a
`<model>.<status>.enum_values` entry; `label` is the column heading;
`icon` uses any `Icons.X` from the SDK; `color` is a Tailwind color
name. Do NOT fabricate a backend model called `stages` — the enum is
source of truth.

```
// UI config — the four columns the board renders.
// ``id`` must match one of the ``tasks.status`` enum_values exactly,
// otherwise dropping a card into that column will write an invalid value.
const stages = [
  { id: "backlog",     label: "Backlog",     icon: Icons.Inbox,      color: "slate" },
  { id: "todo",        label: "To Do",       icon: Icons.Circle,     color: "blue" },
  { id: "in_progress", label: "In Progress", icon: Icons.PlayCircle, color: "amber" },
  { id: "done",        label: "Done",        icon: Icons.CheckCircle, color: "emerald" },
];
```

**CRITICAL:** every `stages[i].id` MUST be one of the model column's
`enum_values` (lowercase, snake_case exactly as declared). A typo here
means drops silently fail the backend validation.

## Persistence via useModel

The drop handler MUST call `update(id, { <stage_field>: targetStage })` from the
same model that populates the board. Do not just update local state — the change
must survive reload.

```
const { data: applications, update: updateApplication } = useModel("applications");
// ...inside handleDrop:
await updateApplication(id, { stage: targetStage });
```

If the backend call is slow, the `data` returned from `useModel` will re-render
after the update resolves and the card will move columns naturally. No manual
re-derivation needed.

## Optimistic UI (optional, recommended for slow backends)

If the update may take >300ms, reorder locally first and revert on error:
```
const [optimisticMoves, setOptimisticMoves] = React.useState<Record<number, string>>({});

const boardData = React.useMemo(() => {
  const cols: Record<string, any[]> = {};
  stages.forEach(s => (cols[s.id] = []));
  (applications ?? []).forEach(app => {
    const stage = optimisticMoves[app.id] ?? app.stage;
    if (cols[stage]) cols[stage].push(app);
  });
  return cols;
}, [applications, stages, optimisticMoves]);

// In handleDrop:
setOptimisticMoves(m => ({ ...m, [id]: targetStage }));
try {
  await updateApplication(id, { stage: targetStage });
  setOptimisticMoves(m => { const { [id]: _, ...rest } = m; return rest; });
} catch {
  setOptimisticMoves(m => { const { [id]: _, ...rest } = m; return rest; });
  toast.error("Failed to move card");
}
```

## Keyboard & Mobile Fallback

Drag-and-drop does not work well on touch devices and is inaccessible to
keyboard users. Provide a **secondary** "Move to…" action on each card via
`DropdownMenu` — it lists the other stages. This complements drag, it does not
replace it.

```
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost" size="icon" className="h-6 w-6">
      <Icons.MoreHorizontal className="w-4 h-4" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuLabel>Move to</DropdownMenuLabel>
    <DropdownMenuSeparator />
    {stages.filter(s => s.id !== card.stage).map(s => (
      <DropdownMenuItem key={s.id} onClick={() => handleMoveStage(card.id, s.id)}>
        {s.label}
      </DropdownMenuItem>
    ))}
  </DropdownMenuContent>
</DropdownMenu>
```

## Column Structure

```
<div className="flex gap-4 overflow-x-auto pb-4 items-start">
  {stages.map(stage => (
    <div key={stage.id} className="flex flex-col gap-4 w-72 shrink-0">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">
          {stage.label}
        </h3>
        <Badge variant="outline">{boardData[stage.id]?.length || 0}</Badge>
      </div>
      <div
        onDragOver={(e) => handleDragOver(e, stage.id)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, stage.id)}
        className={/* see above */}
      >
        {boardData[stage.id]?.map(card => (
          <Card key={card.id} draggable ... />
        ))}
      </div>
    </div>
  ))}
</div>
```

Columns are fixed-width (`w-72` or `w-80`) and the outer wrapper scrolls
horizontally via `overflow-x-auto`. Do NOT use `flex-wrap` — columns must stay
in a single horizontal row.

## Anti-Patterns (Explicit)

- **NEVER** render a kanban with no `draggable` / `onDragStart` / `onDrop` — it
  is the defining interaction of the pattern.
- **NEVER** show a decorative "move forward" arrow icon on a card without
  wiring it to an actual handler. Users will click it and nothing will happen.
- **NEVER** forget `e.preventDefault()` in `onDragOver` — without it, `onDrop`
  silently never fires and the feature appears broken.
- **NEVER** forget `e.dataTransfer.setData(...)` in `onDragStart` — Firefox
  refuses to start a drag without it.
- **NEVER** rely only on a dropdown "Move to Stage" menu as the move mechanism.
  It is a fallback, not the primary interaction.
- **NEVER** use `flex-wrap` on the column container — columns must stay in a
  single row and scroll horizontally.
- **NEVER** call `update(...)` without a try/catch + toast. Network failures
  must be visible to the user and revert the optimistic state.
- **NEVER** omit the visual "drop target" highlight on columns — users need to
  see where the card will land before releasing.
