async function getProductionTrend(ctx) {
  const { period = '30d' } = ctx.params;
  const db = ctx.db;

  let groupBy, dateFormat, cutoff;
  const now = new Date();

  if (period === 'yearly') {
    // Group by month for yearly view
    groupBy = "substr(harvested_at, 1, 7)"; // YYYY-MM
    cutoff = new Date(now.getFullYear(), 0, 1).toISOString();
  } else if (period === '90d') {
    groupBy = "substr(harvested_at, 1, 7)";
    cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
  } else {
    // 30d - group by day
    groupBy = "substr(harvested_at, 1, 10)"; // YYYY-MM-DD
    cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  }

  const results = await db.prepare(
    `SELECT ${groupBy} as period_label, SUM(quantity_kg) as volume
     FROM harvest_logs
     WHERE harvested_at >= ?
     GROUP BY ${groupBy}
     ORDER BY period_label ASC`
  ).bind(cutoff).all();

  const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  const data = (results.results || []).map((row) => {
    let label = row.period_label;
    if (period === 'yearly' || period === '90d') {
      const monthIdx = parseInt(label.split('-')[1], 10) - 1;
      label = monthNames[monthIdx] || label;
    } else {
      label = label.split('-')[2]; // day number
    }
    return { label, volume: Math.round(row.volume * 10) / 10 };
  });

  // Totals
  const totalsResult = await db.prepare(
    `SELECT COALESCE(SUM(quantity_kg), 0) as total FROM harvest_logs WHERE harvested_at >= ?`
  ).bind(cutoff).first();

  const hivesResult = await db.prepare('SELECT COUNT(*) as count FROM hives').first();

  const totalYield = Math.round((totalsResult?.total || 0) * 10) / 10;
  const totalHives = hivesResult?.count || 1;
  const avgPerHive = Math.round((totalYield / totalHives) * 10) / 10;

  return {
    data,
    totalYield,
    avgPerHive,
    yoyChange: 12, // Placeholder - would need previous year data
  };
}
