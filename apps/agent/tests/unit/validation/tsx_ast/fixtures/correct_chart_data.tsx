import { HandlerContext } from "@exepad/sdk";

async function handler(ctx: HandlerContext) {
  const result = await ctx.db.prepare(
    "SELECT strftime('%Y-%m-%d %H:00', created_at) as hour, COUNT(*) as count FROM calls WHERE owner_id = ? GROUP BY hour ORDER BY hour"
  ).bind(ctx.user.id).all();

  return { chartData: result.results };
}

export default handler;
