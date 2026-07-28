import { HandlerContext } from "@exepad/sdk";

export default async function handler(ctx: HandlerContext) {
  await ctx.settings.save({ businessName: ctx.params.name });
  const all = await ctx.settings.fetchAll();

  return { success: true, settings: all };
}
