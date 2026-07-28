import { HandlerContext } from "@exepad/sdk";

export default async function handler(ctx: HandlerContext) {
  const result = await ctx.db.prepare(
    `SELECT * FROM users WHERE name = '${ctx.params.name}' AND status = '${ctx.params.status}'`
  ).all();

  return { users: result.results };
}
