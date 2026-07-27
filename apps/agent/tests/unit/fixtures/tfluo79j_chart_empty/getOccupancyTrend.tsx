import { HandlerContext } from "@exepad/sdk";

async function handler(ctx: HandlerContext) {
  const { days = 7 } = ctx.params as { days?: number };

  // Get total room count first to calculate percentage
  // Model 'rooms' is ownerScope: 'shared'
  const roomCountResult = await ctx.db
    .prepare("SELECT COUNT(*) as total FROM rooms")
    .first<{ total: number }>();
  const totalRooms = roomCountResult?.total ?? 1; // Avoid division by zero

  // Generate date series and calculate occupancy for each day
  // We look for reservations that overlap with each date
  // Since D1 doesn't have a robust date generator, we calculate the last N days in JS
  const trendData = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];

    // A room is occupied on dateStr if:
    // check_in <= dateStr AND check_out > dateStr
    // and reservation is not cancelled
    const occupancy = await ctx.db
      .prepare(
        `SELECT COUNT(DISTINCT room_id) as count 
         FROM reservations 
         WHERE check_in <= ? 
         AND check_out > ? 
         AND status NOT IN ('cancelled')`
      )
      .bind(dateStr, dateStr)
      .first<{ count: number }>();

    const occupiedCount = occupancy?.count ?? 0;
    // Percentage is [0, 1] for chart components
    const percentage = occupiedCount / totalRooms;

    trendData.push({
      date: dateStr,
      percentage: percentage,
    });
  }

  return { trendData };
}

export default handler;
