import { HandlerContext } from "@exepad/sdk";

async function handler(ctx: HandlerContext) {
  const userId = ctx.user.id;

  const contactCount = await ctx.db.prepare(
    'SELECT COUNT(*) as count FROM contacts WHERE owner_id = ?'
  ).bind(userId).first();

  const tasksByStatus = await ctx.db.prepare(
    'SELECT status, COUNT(*) as count FROM tasks WHERE owner_id = ? GROUP BY status'
  ).bind(userId).all();

  return {
    contactCount: contactCount?.count ?? 0,
    tasksByStatus: tasksByStatus.results,
  };
}

export default handler;
