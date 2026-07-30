import { HandlerContext } from "@exepad/sdk";

async function handler(ctx: HandlerContext) {
  const result = await ctx.db.prepare(
    'SELECT o.*, c.name as customer_name FROM orders o JOIN customers c ON o.customer_id = c.id WHERE o.owner_id = ? ORDER BY o.created_at DESC'
  ).bind(ctx.user.id).all();

  return { orders: result.results };
}

export default handler;
