async function getHiveActivityData(ctx) {
  const { hive_id, hours = 24 } = ctx.params;

  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const db = ctx.db;

  const results = await db.prepare(
    `SELECT recorded_at, activity_level
     FROM sensor_readings
     WHERE hive_id = ? AND recorded_at >= ?
     ORDER BY recorded_at ASC`
  ).bind(hive_id, cutoff).all();

  const data = (results.results || []).map((row) => {
    const date = new Date(row.recorded_at);
    const h = date.getHours();
    const hour = h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
    return { hour, activity: row.activity_level || 0 };
  });

  return { data };
}
