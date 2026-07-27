async function seedDemoData(ctx) {
  const db = ctx.db;

  // Check if data already exists
  const existing = await db.prepare('SELECT COUNT(*) as count FROM hives').first();
  if (existing?.count > 0) {
    return { seeded: false, counts: { message: 'Data already exists, skipping seed' } };
  }

  const now = new Date();
  const iso = (daysAgo = 0) => new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString();

  // Hives
  const hives = [
    { name: 'Hive Alpha', status: 'Thriving', queen_name: 'Isabella II', queen_marking_color: 'Blue', temperature: 35.2, humidity: 62, activity_change: 12, population_density: 92, sound_status: 'Steady' },
    { name: 'Hive Beta', status: 'Alert', queen_name: 'Cleopatra VII', queen_marking_color: 'White', temperature: 38.2, humidity: 45, activity_change: -24, population_density: 67, sound_status: 'Irregular' },
    { name: 'Hive Gamma', status: 'Monitoring', queen_name: 'Victoria', queen_marking_color: 'Yellow', temperature: 34.8, humidity: 58, activity_change: 3, population_density: 85, sound_status: 'Steady' },
    { name: 'Hive Delta', status: 'Thriving', queen_name: 'Elizabeth', queen_marking_color: 'Green', temperature: 35.5, humidity: 60, activity_change: 8, population_density: 90, sound_status: 'Steady' },
    { name: 'Hive Epsilon', status: 'Thriving', queen_name: null, queen_marking_color: null, temperature: 35.0, humidity: 55, activity_change: 5, population_density: 88, sound_status: 'Steady' },
    { name: 'Hive Zeta', status: 'Monitoring', queen_name: null, queen_marking_color: null, temperature: 34.5, humidity: 52, activity_change: -2, population_density: 78, sound_status: 'Steady' },
    { name: 'Hive Eta', status: 'Thriving', queen_name: null, queen_marking_color: null, temperature: 35.1, humidity: 59, activity_change: 6, population_density: 91, sound_status: 'Steady' },
    { name: 'Hive Theta', status: 'Monitoring', queen_name: null, queen_marking_color: null, temperature: 34.9, humidity: 54, activity_change: -1, population_density: 80, sound_status: 'Steady' },
    { name: 'Hive Iota', status: 'Thriving', queen_name: null, queen_marking_color: null, temperature: 35.3, humidity: 57, activity_change: 10, population_density: 89, sound_status: 'Steady' },
    { name: 'Hive Kappa', status: 'Thriving', queen_name: null, queen_marking_color: null, temperature: 35.0, humidity: 56, activity_change: 4, population_density: 87, sound_status: 'Steady' },
    { name: 'Hive Lambda', status: 'Thriving', queen_name: null, queen_marking_color: null, temperature: 35.2, humidity: 61, activity_change: 7, population_density: 93, sound_status: 'Steady' },
    { name: 'Hive Mu', status: 'Monitoring', queen_name: null, queen_marking_color: null, temperature: 34.7, humidity: 50, activity_change: -3, population_density: 75, sound_status: 'Steady' },
  ];

  const hiveIds = [];
  for (const hive of hives) {
    const result = await db.prepare(
      `INSERT INTO hives (name, status, queen_name, queen_marking_color, temperature, humidity, activity_change, population_density, sound_status, installed_at, owner_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`
    ).bind(
      hive.name, hive.status, hive.queen_name, hive.queen_marking_color,
      hive.temperature, hive.humidity, hive.activity_change, hive.population_density,
      hive.sound_status, iso(180), ctx.user.id, iso(), iso()
    ).first();
    hiveIds.push(result.id);
  }

  // Sensor readings (hourly for first 4 hives, last 24 hours)
  const activityProfiles = [
    [45, 58, 72, 88, 100, 92, 78],  // Alpha - rising then falling
    [85, 100, 78, 55, 40, 32, 25],   // Beta - declining
    [48, 52, 50, 55, 53, 50, 48],    // Gamma - stable
    [60, 75, 85, 90, 88, 82, 70],    // Delta - bell curve
  ];

  let sensorCount = 0;
  for (let h = 0; h < 4; h++) {
    const profile = activityProfiles[h];
    for (let i = 0; i < profile.length; i++) {
      const hoursAgo = (profile.length - 1 - i) * 2;
      await db.prepare(
        `INSERT INTO sensor_readings (hive_id, temperature, humidity, activity_level, recorded_at, owner_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        hiveIds[h], hives[h].temperature + (Math.random() - 0.5),
        hives[h].humidity + Math.floor((Math.random() - 0.5) * 4),
        profile[i], iso(hoursAgo / 24), ctx.user.id, iso(), iso()
      ).run();
      sensorCount++;
    }
  }

  // Harvest logs (monthly data matching the bar chart)
  const monthlyYields = [
    { month: 0, yield: 74 }, { month: 1, yield: 78 }, { month: 2, yield: 125 },
    { month: 3, yield: 168 }, { month: 4, yield: 210 }, { month: 5, yield: 245 },
    { month: 6, yield: 198 }, { month: 7, yield: 165 },
  ];

  const grades = ['Grade A+', 'Grade A', 'Grade B'];
  const collectors = ['E. Whitmore', 'M. Hargreaves', 'A. Thorne', 'J. Blackwood'];
  let harvestCount = 0;
  for (const m of monthlyYields) {
    const monthDate = new Date(now.getFullYear(), m.month, 15);
    // Split monthly yield across a few hives
    const numEntries = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < numEntries; i++) {
      const qty = Math.round((m.yield / numEntries) * 10) / 10;
      await db.prepare(
        `INSERT INTO harvest_logs (hive_id, quantity_kg, quality_grade, collector, harvested_at, owner_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        hiveIds[i % hiveIds.length], qty, grades[Math.floor(Math.random() * grades.length)],
        collectors[Math.floor(Math.random() * collectors.length)],
        monthDate.toISOString(), ctx.user.id, iso(), iso()
      ).run();
      harvestCount++;
    }
  }

  // Pest alerts
  const pestAlerts = [
    { hive: 1, pest: 'Varroa Mites', severity: 'critical', varroa: 4.2, status: 'active', daysAgo: 2 },
    { hive: 2, pest: 'Wax Moth', severity: 'medium', varroa: null, status: 'monitoring', daysAgo: 7 },
    { hive: 0, pest: 'Varroa Mites', severity: 'low', varroa: 1.2, status: 'resolved', daysAgo: 60 },
    { hive: 2, pest: 'Varroa Mites', severity: 'medium', varroa: 2.8, status: 'resolved', daysAgo: 30 },
    { hive: 3, pest: 'Small Hive Beetle', severity: 'low', varroa: null, status: 'resolved', daysAgo: 45 },
  ];

  for (const alert of pestAlerts) {
    await db.prepare(
      `INSERT INTO pest_alerts (hive_id, pest_type, severity, varroa_count, status, detected_at, resolved_at, owner_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      hiveIds[alert.hive], alert.pest, alert.severity, alert.varroa, alert.status,
      iso(alert.daysAgo), alert.status === 'resolved' ? iso(alert.daysAgo - 5) : null,
      ctx.user.id, iso(), iso()
    ).run();
  }

  // Treatments
  const treatments = [
    { hive: 1, pest: 'Varroa Mites', name: 'Oxalic Acid Dribble', status: 'Success', daysAgo: 14 },
    { hive: 2, pest: 'Wax Moth', name: 'Oil Trap', status: 'In Progress', daysAgo: 5 },
    { hive: 0, pest: 'Nosema', name: 'Fumidil-B', status: 'Failed', daysAgo: 21 },
    { hive: 3, pest: 'Wax Moth', name: 'B401 Biological Control', status: 'Success', daysAgo: 30 },
  ];

  for (const t of treatments) {
    await db.prepare(
      `INSERT INTO treatments (hive_id, pest_type, treatment_name, status, applied_at, owner_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      hiveIds[t.hive], t.pest, t.name, t.status, iso(t.daysAgo),
      ctx.user.id, iso(), iso()
    ).run();
  }

  // Inspections
  const inspections = [
    { hive: 0, type: 'routine', daysAgo: 3, completed: true },
    { hive: 1, type: 'emergency', daysAgo: 1, completed: false },
    { hive: 2, type: 'seasonal', daysAgo: -2, completed: false },
    { hive: 3, type: 'routine', daysAgo: -5, completed: false },
  ];

  for (const insp of inspections) {
    await db.prepare(
      `INSERT INTO inspections (hive_id, inspector_name, inspection_type, scheduled_at, completed_at, owner_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      hiveIds[insp.hive], 'A. Thorne', insp.type, iso(insp.daysAgo),
      insp.completed ? iso(insp.daysAgo) : null,
      ctx.user.id, iso(), iso()
    ).run();
  }

  // Apiary settings
  await db.prepare(
    `INSERT INTO apiary_settings (full_name, cert_id, email, location, active_hives_count, flora_type, weight_loss_alert_enabled, temp_alert_threshold, owner_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    'Alistair Thorne', 'GOLD-88291-UK', 'a.thorne@apiaryinsight.co.uk',
    'Cotswolds, UK', 12, 'Mixed Wildflower', 1, 35.0,
    ctx.user.id, iso(), iso()
  ).run();

  return {
    seeded: true,
    counts: {
      hives: hives.length,
      sensor_readings: sensorCount,
      harvest_logs: harvestCount,
      pest_alerts: pestAlerts.length,
      treatments: treatments.length,
      inspections: inspections.length,
      apiary_settings: 1,
    },
  };
}
