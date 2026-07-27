async function getDashboardOverview(ctx) {
  const db = ctx.db;

  const [hivesResult, harvestResult, alertsResult, inspectionsResult] = await Promise.all([
    db.prepare('SELECT COUNT(*) as count FROM hives').first(),
    db.prepare('SELECT COALESCE(SUM(quantity_kg), 0) as total FROM harvest_logs').first(),
    db.prepare("SELECT COUNT(*) as count FROM pest_alerts WHERE status = 'active'").first(),
    db.prepare('SELECT COUNT(*) as count FROM inspections WHERE completed_at IS NULL').first(),
  ]);

  const totalHives = hivesResult?.count || 0;
  const totalYield = harvestResult?.total || 0;
  const activeAlerts = alertsResult?.count || 0;
  const pendingInspections = inspectionsResult?.count || 0;

  // Target: 100kg per hive per season
  const seasonTarget = totalHives * 100;
  const honeyTargetPercent = seasonTarget > 0 ? Math.round((totalYield / seasonTarget) * 100) : 0;

  return {
    totalHives,
    totalYield: Math.round(totalYield * 10) / 10,
    activeAlerts,
    pendingInspections,
    honeyTargetPercent,
  };
}
