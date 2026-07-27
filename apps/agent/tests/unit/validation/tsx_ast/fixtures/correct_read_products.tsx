import { HandlerContext } from "@exepad/sdk";

async function handler(ctx: HandlerContext) {
  const result = await ctx.db.prepare(
    'SELECT * FROM products WHERE owner_id = ? ORDER BY created_at DESC'
  ).bind(ctx.user.id).all();

  return { products: result.results };
}

export default handler;
