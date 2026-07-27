async function getMiteLoadTrend(ctx) {
  const { months = 6 } = ctx.params;
  const db = ctx.db;

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffISO = cutoff.toISOString();

  const results = await db.prepare(
    `SELECT substr(detected_at, 1, 7) as month_label, AVG(varroa_count) as avg_load
     FROM pest_alerts
     WHERE varroa_count IS NOT NULL AND detected_at >= ?
     GROUP BY month_label
     ORDER BY month_label ASC`
  ).bind(cutoffISO).all();

  const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  const data = (results.results || []).map((row) => {
    const monthIdx = parseInt(row.month_label.split('-')[1], 10) - 1;
    return {
      month: monthNames[monthIdx] || row.month_label,
      load: Math.round(row.avg_load * 10) / 10,
    };
  });

  // Current load = most recent month's average
  const currentLoad = data.length > 0 ? data[data.length - 1].load : 0;
  const previousLoad = data.length > 1 ? data[data.length - 2].load : currentLoad;
  const momChange = Math.round((currentLoad - previousLoad) * 10) / 10;

  // Treatment efficacy
  const efficacyResult = await db.prepare(
    `SELECT
       COUNT(CASE WHEN status = 'Success' THEN 1 END) as success_count,
       COUNT(*) as total_count
     FROM treatments`
  ).first();

  const treatmentEfficacy = efficacyResult?.total_count > 0
    ? Math.round((efficacyResult.success_count / efficacyResult.total_count) * 100)
    : 0;

  return { data, currentLoad, momChange, treatmentEfficacy };
}
