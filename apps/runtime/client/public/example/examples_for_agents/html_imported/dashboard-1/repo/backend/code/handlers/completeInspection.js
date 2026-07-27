async function completeInspection(ctx) {
  const { inspection_id, checklist, notes } = ctx.params;
  const db = ctx.db;

  const now = new Date().toISOString();
  const checklistStr = checklist ? JSON.stringify(checklist) : null;

  await db.prepare(
    `UPDATE inspections
     SET completed_at = ?,
         checklist = COALESCE(?, checklist),
         notes = COALESCE(?, notes),
         updated_at = ?
     WHERE id = ?`
  ).bind(now, checklistStr, notes, now, inspection_id).run();

  return { success: true };
}
