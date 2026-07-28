import { HandlerContext } from "@exepad/sdk";

async function handler(ctx: HandlerContext) {
  const now = new Date().toISOString();

  const result = await ctx.db.prepare(
    'INSERT INTO bookings (owner_id, service_id, date, customer_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(ctx.user.id, ctx.params.service_id, ctx.params.date, ctx.params.customer_name, 'pending', now, now).run();

  return { bookingId: result.meta.last_row_id, status: 'pending' };
}

export default handler;
