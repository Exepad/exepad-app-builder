// "stripe" is not a declared model — must NOT be stripped.
import Stripe from "stripe";
import { ExepadHandlerCtx } from "@exepad/sdk";

export default async function chargeHandler(ctx: ExepadHandlerCtx, input: { amount: number }) {
  const client = new Stripe(ctx.settings.STRIPE_KEY);
  return client.charges.create({ amount: input.amount, currency: "usd" });
}
