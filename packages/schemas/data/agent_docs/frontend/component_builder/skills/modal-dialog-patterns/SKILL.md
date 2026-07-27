---
name: modal-dialog-patterns
description: "Modal/dialog/drawer/sheet UX choreography — Radix Dialog + portal, focus trap, Escape-to-close, click-outside-to-dismiss, form-submit-inside-modal, AlertDialog for destructive confirmations. Load whenever a component plan needs a confirm-delete dialog, edit/create modal, share/export sheet, or any overlay surface beyond a simple toast. Keywords: modal, dialog, alert-dialog, drawer, sheet, popover, overlay, confirm, popup, side-panel, escape-close."
metadata:
  kind: domain
---
# Skill: Modal & Dialog Patterns

Use the SDK's Radix-backed primitives — `Dialog`, `AlertDialog`, `Sheet`,
`Drawer` — never roll your own portal, focus trap, or escape handler.
Each primitive picks up keyboard nav, ARIA roles, and inert-background
behaviour for free.

## Picking the right primitive

| Use case | Primitive |
|----------|-----------|
| Edit/create a record (form-driven) | `Dialog` |
| Confirm a destructive action | `AlertDialog` |
| Right-side share/filters/details panel on desktop | `Sheet` (variant `right`) |
| Bottom-up panel on mobile | `Drawer` |
| Inline contextual menu / picker | `Popover` |

Choose by purpose, not by aesthetic. A confirm-delete is **not** a
`Dialog` — `AlertDialog` enforces the focus-on-cancel default and exposes
the right ARIA role.

## Edit/Create modal (Dialog)

```tsx
const [open, setOpen] = useState(false);
const [editing, setEditing] = useState<Record | null>(null);
const { create, update } = useModel('records');

async function onSubmit(values: FormValues) {
  if (editing) await update(editing.id, values);
  else await create(values);
  setOpen(false);
  setEditing(null);
  toast.success(editing ? 'Updated' : 'Created');
}

return (
  <>
    <Button onClick={() => { setEditing(null); setOpen(true); }}>
      <Icons.Plus className="mr-2 h-4 w-4" /> New record
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit record' : 'New record'}</DialogTitle>
          <DialogDescription>
            {editing ? 'Update the fields and save.' : 'Add a new record to the table.'}
          </DialogDescription>
        </DialogHeader>
        {/* form fields here, see crud-data-app skill */}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => onSubmit(values)}>{editing ? 'Save' : 'Create'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
);
```

Rules:
- **`DialogTitle` is required.** Radix uses it for `aria-labelledby`. A
  Dialog without a title fails the a11y validator and reads as "dialog"
  to screen readers.
- **Provide `DialogDescription`.** It binds to `aria-describedby`.
- **Close after success, keep open after error.** On error show the
  error message inline and let the user retry without re-typing.
- **Reset state on close** (`setEditing(null)`) — don't carry the previous
  selection into the next "New" click.

## Entrance motion (`motion` prop)

By default a Dialog/AlertDialog inherits the **app-wide** entrance motion from
the design system's animation tokens — you get consistent, on-brand motion for
free, so **omit `motion` in the normal case.** Only set it when a specific
dialog should animate differently from the rest of the app:

```tsx
<DialogContent motion="slide-up" className="sm:max-w-md">…</DialogContent>
```

`motion` accepts: `zoom` (default feel — fade + subtle scale), `fade`
(opacity only), `scale` (larger scale-up), `pop` (biggest scale, reads springy),
`slide-up` / `slide-down` (fade + directional slide), or `none` (no entrance
animation — good for a dialog that reopens rapidly). It maps to
`data-exepad-motion` on the panel; the same prop exists on `AlertDialogContent`.
`prefers-reduced-motion` is honoured automatically. Don't reach for raw
`animate-*` / `duration-*` classes on the content to fake this — use `motion`.

## Confirm-delete (AlertDialog)

```tsx
const [confirmId, setConfirmId] = useState<string | null>(null);
const { remove } = useModel('records');

async function onConfirm() {
  if (!confirmId) return;
  await remove(confirmId);
  setConfirmId(null);
  toast.success('Deleted');
}

return (
  <AlertDialog open={!!confirmId} onOpenChange={(v) => !v && setConfirmId(null)}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete this record?</AlertDialogTitle>
        <AlertDialogDescription>
          This can't be undone. The record and any associated data will be permanently removed.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={onConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
          Delete
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
```

Rules:
- **AlertDialog default focus is the cancel button** — the safe choice.
  Don't override.
- **Destructive actions use `bg-destructive`** so they're visually
  distinct from a standard confirm.
- **Title is a question, body explains the consequence.** Don't hedge ("Are
  you sure you want to delete?") — be specific about what is irreversible.

## Side panel (Sheet)

For details/filters/share that need more space than a Dialog but
shouldn't replace the page:

```tsx
<Sheet open={open} onOpenChange={setOpen}>
  <SheetContent side="right" className="w-full sm:max-w-md">
    <SheetHeader>
      <SheetTitle>Filters</SheetTitle>
      <SheetDescription>Refine the list below.</SheetDescription>
    </SheetHeader>
    {/* filter controls */}
    <SheetFooter>
      <Button variant="ghost" onClick={() => resetFilters()}>Reset</Button>
      <Button onClick={() => setOpen(false)}>Apply</Button>
    </SheetFooter>
  </SheetContent>
</Sheet>
```

`side="right"` on desktop slides from the right; on mobile it
auto-resizes to full width. Use `side="bottom"` for mobile-first sheets
(filters, action menus) — feels native on touch devices.

## Stacking & nesting

- **Avoid nested modals.** A confirm-delete inside an edit Dialog is a
  smell — close the outer Dialog first, then open the AlertDialog.
- **One modal at a time.** If you need two confirm steps, that's a
  multi-step wizard — load the `multi-step-wizard` skill instead.
- **Don't trap toasts inside modals.** Render `<Toaster />` at app root,
  not inside a Dialog body.

## Anti-patterns

- ✗ Custom portals via `createPortal` + a manually-styled `<div>` overlay. The Radix primitive already does this with focus management.
- ✗ Triggering a second mutation in `onOpenChange` (`if (!open) save()`). User expects close to discard, not save.
- ✗ Click-outside-to-confirm (`onPointerDownOutside={save}`). Always require an explicit click on the action button.
- ✗ Putting destructive actions in a `Dialog` (which defaults focus to the action button). Use `AlertDialog`.
- ✗ Long forms inside a Dialog. If the form has more than ~6 fields, use a `Sheet`/`Drawer` or a dedicated route.

## Compatibility

All primitives are exported from `@exepad/sdk`. Don't import from `@radix-ui/react-*` directly — the SDK wraps them with theme-aware defaults.
