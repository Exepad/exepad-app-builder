import { HandlerContext } from "@exepad/sdk";

async function handler(ctx: HandlerContext) {
  const result = await ctx.db.prepare(
    'SELECT * FROM products WHERE owner_id = ?'
  ).bind(ctx.user.id).all();

  return { products: result.results };
}
