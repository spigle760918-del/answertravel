import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { observationPlanSchema, samplingRulesSchema } from "../src/modules/observation/observation.js";
import {
  createObservationQueue,
  enqueueObservation,
  OBSERVATION_QUEUE,
  observationJob,
} from "../src/modules/observation/observation-queue.js";
import { ObservationRepository } from "../src/modules/observation/observation-repository.js";
import {
  assertProductionRecoveryAuthorization,
  createJiachengProductionNetworkRecovery,
  JIACHENG_PRODUCTION_BASELINE_PLAN_ID,
  JIACHENG_PRODUCTION_RECOVERY_AUTHORIZATION,
  JIACHENG_PRODUCTION_RECOVERY_CYCLE,
  JIACHENG_PRODUCTION_RECOVERY_PLAN_ID,
  JIACHENG_PRODUCTION_TENANT_ID,
} from "../src/modules/observation/production-baseline.js";
import { questionPanelSchema } from "../src/modules/question-intelligence/question-intelligence.js";
import { createDatabasePool, withTenantTransaction } from "../src/platform/database.js";

const execute = process.argv.includes("--execute");
assertProductionRecoveryAuthorization({
  execute,
  authorization: process.env.PRODUCTION_OBSERVATION_RECOVERY_AUTHORIZATION,
});

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (!redisUrl) throw new Error("REDIS_URL is required.");
if (process.env.ACCEPTANCE_TENANT_ID !== JIACHENG_PRODUCTION_TENANT_ID) {
  throw new Error("ACCEPTANCE_TENANT_ID does not match the production tenant.");
}
if (execute && process.env.NODE_ENV !== "production") {
  throw new Error("Production recovery requires NODE_ENV=production.");
}
if (execute && !process.env.DEEPSEEK_API_KEY?.trim()) {
  throw new Error("Production recovery requires a configured DeepSeek key.");
}

const pool = createDatabasePool(databaseUrl);
const connection = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
const inspectionQueue = new Queue(OBSERVATION_QUEUE, { connection });

try {
  const state = await withTenantTransaction(
    pool,
    JIACHENG_PRODUCTION_TENANT_ID,
    async (client) => {
      const panelRow = (
        await client.query(
          `select id,tenant_id,version,status,brand_truth_card_id,brand_truth_version,
            generation_run_id,candidates,mix,created_at
           from question_panels where status='approved'
           order by created_at desc,version desc limit 1`,
        )
      ).rows[0];
      if (!panelRow) throw new Error("No approved production question panel exists.");
      const panel = questionPanelSchema.parse({
        id: panelRow.id,
        tenantId: panelRow.tenant_id,
        version: panelRow.version,
        status: panelRow.status,
        brandTruthCardId: panelRow.brand_truth_card_id,
        brandTruthVersion: panelRow.brand_truth_version,
        generationRunId: panelRow.generation_run_id,
        candidates: panelRow.candidates,
        mix: panelRow.mix,
        createdAt: panelRow.created_at.toISOString(),
      });
      const counts = (
        await client.query<{
          plans: string;
          answers: string;
          schedules: string;
          original_targets: string;
          original_answers: string;
          original_attempts: string;
          qualifying_failures: string;
          original_tokens: string;
          recovery_answers: string;
        }>(
          `select
            (select count(*) from observation_plans)::text plans,
            (select count(*) from raw_answers)::text answers,
            (select count(*) from monitoring_schedules)::text schedules,
            (select count(*) from observation_targets where plan_id=$1)::text original_targets,
            (select count(*) from raw_answers a join observation_targets t
              on t.tenant_id=a.tenant_id and t.id=a.target_id where t.plan_id=$1)::text original_answers,
            (select count(*) from observation_attempts a join observation_targets t
              on t.tenant_id=a.tenant_id and t.id=a.target_id where t.plan_id=$1)::text original_attempts,
            (select count(*) from observation_attempts a join observation_targets t
              on t.tenant_id=a.tenant_id and t.id=a.target_id
              where t.plan_id=$1 and a.status='retryable_failure'
                and a.error_code='network_error' and a.http_status is null
                and a.total_tokens=0)::text qualifying_failures,
            (select coalesce(sum(a.total_tokens),0) from observation_attempts a join observation_targets t
              on t.tenant_id=a.tenant_id and t.id=a.target_id where t.plan_id=$1)::text original_tokens,
            (select count(*) from raw_answers a join observation_targets t
              on t.tenant_id=a.tenant_id and t.id=a.target_id where t.plan_id=$2)::text recovery_answers`,
          [JIACHENG_PRODUCTION_BASELINE_PLAN_ID, JIACHENG_PRODUCTION_RECOVERY_PLAN_ID],
        )
      ).rows[0];
      const originalPlan = (
        await client.query(
          "select id from observation_plans where id=$1 limit 1",
          [JIACHENG_PRODUCTION_BASELINE_PLAN_ID],
        )
      ).rows[0];
      const recoveryPlanRow = (
        await client.query<{
          id: string;
          tenant_id: string;
          question_panel_id: string;
          question_panel_version: number;
          provider: "deepseek";
          model: string;
          surface: "api";
          cycle_key: string;
          authorization_id: string | null;
          rules: unknown;
          planned_samples: number;
          created_at: Date;
        }>(
          `select id,tenant_id,question_panel_id,question_panel_version,provider,model,surface,
            cycle_key,authorization_id,rules,planned_samples,created_at
           from observation_plans where id=$1 limit 1`,
          [JIACHENG_PRODUCTION_RECOVERY_PLAN_ID],
        )
      ).rows[0];
      const storedTargets = recoveryPlanRow
        ? (
            await client.query<{
              id: string;
              idempotency_key: string;
              question_text: string;
              round: number;
            }>(
              `select id,idempotency_key,question_text,round from observation_targets
               where plan_id=$1 order by idempotency_key`,
              [JIACHENG_PRODUCTION_RECOVERY_PLAN_ID],
            )
          ).rows
        : [];
      return { panel, counts, originalPlan, recoveryPlanRow, storedTargets };
    },
  );

  if (!state.originalPlan) throw new Error("Original failed production plan is missing.");
  const counts = state.counts;
  const planCount = Number(counts?.plans ?? 0);
  const answerCount = Number(counts?.answers ?? 0);
  const scheduleCount = Number(counts?.schedules ?? 0);
  const originalTargets = Number(counts?.original_targets ?? 0);
  const originalAnswers = Number(counts?.original_answers ?? 0);
  const originalAttempts = Number(counts?.original_attempts ?? 0);
  const qualifyingFailures = Number(counts?.qualifying_failures ?? 0);
  const originalTokens = Number(counts?.original_tokens ?? 0);
  const recoveryAnswers = Number(counts?.recovery_answers ?? 0);
  if (
    originalTargets !== 40 ||
    originalAnswers !== 0 ||
    originalAttempts !== 120 ||
    qualifyingFailures !== 120 ||
    originalTokens !== 0
  ) {
    throw new Error("Original production failure no longer matches the approved recovery scope.");
  }
  if (scheduleCount !== 0) throw new Error("Periodic monitoring must remain disabled.");

  const recovery = createJiachengProductionNetworkRecovery({
    panel: state.panel,
    createdAt: new Date().toISOString(),
  });
  if (!state.recoveryPlanRow) {
    if (planCount !== 1 || answerCount !== 0) {
      throw new Error("Production contains data outside the original failed plan.");
    }
  } else {
    if (planCount !== 2 || answerCount !== recoveryAnswers) {
      throw new Error("Production contains data outside the recovery scope.");
    }
    const storedPlan = observationPlanSchema.parse({
      id: state.recoveryPlanRow.id,
      tenantId: state.recoveryPlanRow.tenant_id,
      questionPanelId: state.recoveryPlanRow.question_panel_id,
      questionPanelVersion: state.recoveryPlanRow.question_panel_version,
      provider: state.recoveryPlanRow.provider,
      model: state.recoveryPlanRow.model,
      surface: state.recoveryPlanRow.surface,
      cycleKey: state.recoveryPlanRow.cycle_key,
      authorizationId: state.recoveryPlanRow.authorization_id,
      rules: samplingRulesSchema.parse(state.recoveryPlanRow.rules),
      plannedSamples: state.recoveryPlanRow.planned_samples,
      createdAt: state.recoveryPlanRow.created_at.toISOString(),
    });
    const expected = recovery.plan;
    if (
      storedPlan.id !== expected.id ||
      storedPlan.questionPanelId !== expected.questionPanelId ||
      storedPlan.questionPanelVersion !== expected.questionPanelVersion ||
      storedPlan.cycleKey !== JIACHENG_PRODUCTION_RECOVERY_CYCLE ||
      storedPlan.model !== expected.model ||
      storedPlan.plannedSamples !== 40 ||
      JSON.stringify(storedPlan.rules) !== JSON.stringify(expected.rules)
    ) {
      throw new Error("Existing recovery plan differs from the approved contract.");
    }
    const expectedTargets = recovery.targets
      .map((target) => ({
        id: target.id,
        idempotency_key: target.idempotencyKey,
        question_text: target.questionText,
        round: target.round,
      }))
      .sort((a, b) => a.idempotency_key.localeCompare(b.idempotency_key));
    if (JSON.stringify(state.storedTargets) !== JSON.stringify(expectedTargets)) {
      throw new Error("Existing recovery targets differ from the approved contract.");
    }
  }

  const pendingCounts = await inspectionQueue.getJobCounts(
    "wait",
    "active",
    "delayed",
    "prioritized",
    "waiting-children",
  );
  const pending = Object.values(pendingCounts).reduce(
    (sum, count) => sum + Number(count),
    0,
  );
  if (!state.recoveryPlanRow && pending !== 0) {
    throw new Error("Observation queue contains pending work; recovery is blocked.");
  }
  if (state.recoveryPlanRow && pending !== 0) {
    const allowedTargetIds = new Set(recovery.targets.map((target) => target.id));
    const jobs = await inspectionQueue.getJobs(
      ["wait", "active", "delayed", "prioritized", "waiting-children"],
      0,
      -1,
      true,
    );
    if (
      jobs.length !== pending ||
      jobs.some((job) => {
        const data = job.data as { tenantId?: unknown; payload?: { targetId?: unknown } };
        return (
          data.tenantId !== JIACHENG_PRODUCTION_TENANT_ID ||
          typeof data.payload?.targetId !== "string" ||
          !allowedTargetIds.has(data.payload.targetId)
        );
      })
    ) {
      throw new Error("Observation queue contains work outside the recovery plan.");
    }
  }

  if (!execute) {
    console.log(
      JSON.stringify({
        event: "jiacheng.production_baseline_recovery.dry_run",
        mode: "dry-run",
        tenantId: JIACHENG_PRODUCTION_TENANT_ID,
        originalPlanId: JIACHENG_PRODUCTION_BASELINE_PLAN_ID,
        originalNetworkFailures: originalAttempts,
        originalTokens,
        recoveryPlanId: JIACHENG_PRODUCTION_RECOVERY_PLAN_ID,
        approvedQuestions: 20,
        rounds: 2,
        plannedSamples: 40,
        maxAttemptsPerTarget: 1,
        maxTotalTokens: recovery.plan.rules.maxTotalTokens,
        existingRecoveryPlan: Boolean(state.recoveryPlanRow),
        recoveryAnswers,
        pendingQueueJobs: pending,
        deepseekCalled: false,
        executionAuthorized: false,
        requiredAuthorizationMarker: JIACHENG_PRODUCTION_RECOVERY_AUTHORIZATION,
      }),
    );
  } else {
    if (!state.recoveryPlanRow) {
      await new ObservationRepository(pool).createPlan(recovery.plan, recovery.targets);
    }
    const producer = createObservationQueue(redisUrl);
    try {
      const jobs = await Promise.all(
        recovery.targets.map((target) =>
          enqueueObservation(producer.queue, observationJob(target)),
        ),
      );
      console.log(
        JSON.stringify({
          event: "jiacheng.production_baseline_recovery.enqueued",
          mode: "execute",
          originalPlanId: JIACHENG_PRODUCTION_BASELINE_PLAN_ID,
          recoveryPlanId: recovery.plan.id,
          plannedSamples: 40,
          maxAttemptsPerTarget: 1,
          maxTotalTokens: recovery.plan.rules.maxTotalTokens,
          enqueuedJobs: jobs.length,
          idempotentRerun: Boolean(state.recoveryPlanRow),
          publicationAuthorized: false,
          periodicMonitoringAuthorized: false,
        }),
      );
    } finally {
      await producer.close();
    }
  }
} finally {
  await inspectionQueue.close();
  connection.disconnect();
  await pool.end();
}

