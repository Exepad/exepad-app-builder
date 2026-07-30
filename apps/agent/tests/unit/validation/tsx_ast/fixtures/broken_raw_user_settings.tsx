import { HandlerContext } from "@exepad/sdk";

export default async function handler(ctx: HandlerContext) {
  await ctx.db.prepare(
    'INSERT INTO _user_settings (owner_id, data) VALUES (?, ?)'
  ).bind(ctx.user.id, JSON.stringify(ctx.params)).run();

  return { success: true };
}
