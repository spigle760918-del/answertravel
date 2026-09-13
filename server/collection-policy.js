function monthStart(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
}

function nextCollectionAt(frequency, from = new Date()) {
  const interval = frequency === 'weekly' ? 7 * 86400000 : frequency === 'daily' ? 86400000 : 0;
  return interval ? new Date(new Date(from).getTime() + interval).toISOString() : '';
}

function collectionUsage(db, options = {}) {
  const since = options.since || monthStart();
  const brandId = options.brandId || '';
  const tasks = new Map((db.tasks || [])
    .filter((task) => task.type === '回答采集' && String(task.createdAt || '') >= since)
    .map((task) => [task.id, task]));
  return (db.records || []).filter((record) => {
    const task = tasks.get(record.taskId);
    return task && (!brandId || record.brandId === brandId || task.brandId === brandId);
  }).length;
}

function ensureUsageLedger(db) {
  const periodStart = monthStart();
  const current = db.workspace?.collectionUsage;
  if (current?.periodStart === periodStart && current.brands && typeof current.brands === 'object') return current;
  const brands = {};
  for (const brand of db.brands || []) brands[brand.id] = collectionUsage(db, { since: periodStart, brandId: brand.id });
  const ledger = { periodStart, team: collectionUsage(db, { since: periodStart }), brands };
  db.workspace.collectionUsage = ledger;
  return ledger;
}

function quotaStatus(db, config, brandId = '') {
  const since = monthStart();
  const teamLimit = Number(db.workspace?.collectionQuota?.teamMonthly || config.collectionTeamMonthlyQuota || 0);
  const brandLimit = Number(db.brands?.find((brand) => brand.id === brandId)?.collectionQuota?.monthly || config.collectionBrandMonthlyQuota || 0);
  const ledger = ensureUsageLedger(db);
  const teamUsed = Number(ledger.team || 0);
  const brandUsed = brandId ? Number(ledger.brands?.[brandId] || 0) : 0;
  const item = (used, limit) => ({ used, limit, remaining: limit > 0 ? Math.max(0, limit - used) : null, unlimited: limit <= 0 });
  return { periodStart: since, team: item(teamUsed, teamLimit), brand: item(brandUsed, brandLimit) };
}

function assertCollectionQuota(db, config, brandId, requestedCount) {
  const status = quotaStatus(db, config, brandId);
  const count = Math.max(1, Number(requestedCount) || 1);
  if (!status.team.unlimited && status.team.remaining < count) {
    throw Object.assign(new Error(`团队本月采集配额不足（剩余 ${status.team.remaining} 次，需要 ${count} 次）。`), { statusCode: 429, code: 'TEAM_COLLECTION_QUOTA_EXCEEDED', quota: status });
  }
  if (!status.brand.unlimited && status.brand.remaining < count) {
    throw Object.assign(new Error(`当前品牌本月采集配额不足（剩余 ${status.brand.remaining} 次，需要 ${count} 次）。`), { statusCode: 429, code: 'BRAND_COLLECTION_QUOTA_EXCEEDED', quota: status });
  }
  return status;
}

function consumeCollectionQuota(db, config, brandId, requestedCount) {
  const status = assertCollectionQuota(db, config, brandId, requestedCount);
  const count = Math.max(1, Number(requestedCount) || 1);
  const ledger = ensureUsageLedger(db);
  ledger.team = Number(ledger.team || 0) + count;
  ledger.brands[brandId] = Number(ledger.brands[brandId] || 0) + count;
  return status;
}

module.exports = { monthStart, nextCollectionAt, collectionUsage, ensureUsageLedger, quotaStatus, assertCollectionQuota, consumeCollectionQuota };
