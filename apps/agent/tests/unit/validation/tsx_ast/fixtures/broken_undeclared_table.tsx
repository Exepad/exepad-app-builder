import { HandlerContext } from "@exepad/sdk";

export default async function handler(ctx: HandlerContext) {
  const guests = await ctx.db.prepare(
    'SELECT * FROM guests WHERE rsvp = ?'
  ).bind('yes').all();

  const activities = await ctx.db.prepare(
    'SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 10'
  ).all();

  return { guests: guests.results, activities: activities.results };
}
