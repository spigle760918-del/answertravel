const { nextCollectionAt } = require('./collection-policy');

function createCollectionScheduler({ getDb, createTask, persist, intervalMs = 60_000, now = () => new Date() }) {
  let timer = null;
  let active = false;

  async function tick() {
    if (active) return false;
    active = true;
    let changed = false;
    try {
      const db = getDb();
      const current = now();
      for (const prompt of db.prompts || []) {
        if (prompt.status !== 'active' || !['daily', 'weekly'].includes(prompt.frequency)) continue;
        if (!prompt.nextCollectionAt) {
          prompt.nextCollectionAt = nextCollectionAt(prompt.frequency, current);
          await persist({ prompts: [prompt] });
          changed = true;
          continue;
        }
        if (Date.parse(prompt.nextCollectionAt) > current.getTime()) continue;
        try {
          const result = createTask(prompt, { reason: 'scheduled', requestedBy: 'system:scheduler' });
          prompt.lastScheduledAt = current.toISOString();
          prompt.nextCollectionAt = nextCollectionAt(prompt.frequency, current);
          prompt.scheduleError = '';
          await persist({ task: result.task, records: result.records, prompts: [prompt] });
        } catch (error) {
          prompt.scheduleError = error.message;
          prompt.scheduleErrorCode = error.code || 'SCHEDULE_ERROR';
          prompt.lastScheduleAttemptAt = current.toISOString();
          prompt.nextCollectionAt = nextCollectionAt(prompt.frequency, current);
          await persist({ prompts: [prompt] });
        }
        changed = true;
      }
    } finally {
      active = false;
    }
    return changed;
  }

  return {
    tick,
    start() {
      if (timer) return;
      timer = setInterval(() => tick().catch((error) => console.error('[answertravel-scheduler] tick failed', error)), intervalMs);
      timer.unref();
    },
    stop() { if (timer) clearInterval(timer); timer = null; }
  };
}

module.exports = { createCollectionScheduler };
