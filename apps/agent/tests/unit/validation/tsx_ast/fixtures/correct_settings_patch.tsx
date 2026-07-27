import { HandlerContext } from "@exepad/sdk";

async function handler(ctx: HandlerContext) {
  const { businessName, email, currency } = ctx.params as {
    businessName?: string;
    email?: string;
    currency?: string;
  };

  await ctx.settings.patch({ businessName, email, currency });
  const next = await ctx.settings.getAll();

  return { success: true, settings: next };
}

export default handler;
