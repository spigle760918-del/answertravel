import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { questionPanelSchema } from "../src/modules/question-intelligence/question-intelligence.js";
import {
  createObservationQueue,
  enqueueObservation,
  OBSERVATION_QUEUE,
  observationJob,
} from "../src/modules/observation/observation-queue.js";
import { ObservationRepository } from "../src/modules/observation/observation-repository.js";
import { samplingRulesSchema } from "../src/modules/observation/observation.js";
import {
  assertProductionBaselineAuthorization,
  createJiachengProductionBaseline,
  JIACHENG_PRODUCTION_AUTHORIZATION,
  JIACHENG_PRODUCTION_BASELINE_CYCLE,
  JIACHENG_PRODUCTION_BASELINE_PLAN_ID,
  JIACHENG_PRODUCTION_TENANT_ID,
} from "../src/modules/observation/production-baseline.js";
import { createDatabasePool, withTenantTransaction } from "../src/platform/database.js";

const execute = process.argv.includes("--execute");
assertProductionBaselineAuthorization({
  execute,
  authorization: process.env.PRODUCTION_OBSERVATION_AUTHORIZATION,
});

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (!redisUrl) throw new Error("REDIS_URL is required.");
if (process.env.ACCEPTANCE_TENANT_ID !== JIACHENG_PRODUCTION_TENANT_ID) {
  throw new Error("ACCEPTANCE_TENANT_ID does not match the production tenant.");
}
if (execute && process.env.NODE_ENV !== "production") {
  throw new Error("Production observation execution requires NODE_ENV=production.");
}
if (execute && !process.env.DEEPSEEK_API_KEY?.trim()) {
  throw new Error("Production observation execution requires a configured DeepSeek key.");
}

const pool = createDatabasePool(databaseUrl);
const connection = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
const inspectionQueue = new Queue(OBSERVATION_QUEUE, { connection });

try {
  const state = await withTenantTransaction(
    pool,
    JIACHENG_PRODUCTION_TENANT_ID,
    async (client) => {
      const panelResult = await client.query(
        `select id,tenant_id,version,status,brand_truth_card_id,brand_truth_version,
          generation_run_id,candidates,mix,created_at
         from question_panels
         where status='approved'
         order by created_at desc,version desc
         limit 1`,
      );
      const row = panelResult.rows[0];
      if (!row) throw new Error("No approved production question panel exists.");
      const panel = questionPanelSchema.parse({
        id: row.id,
        tenantId: row.tenant_id,
        version: row.version,
        status: row.status,
        brandTruthCardId: row.brand_truth_card_id,
        brandTruthVersion: row.brand_truth_version,
        generationRunId: row.generation_run_id,
        candidates: row.candidates,
        mix: row.mix,
        createdAt: row.created_at.toISOString(),
      });
      const counts = (
        await client.query<{
          plans: string;
          answers: string;
          schedules: string;
          exact_plan_answers: string;
        }>(
          `select
            (select count(*) from observation_plans)::text plans,
            (select count(*) from raw_answers)::text answers,
            (select count(*) from monitoring_schedules)::text schedules,
            (select count(*) from raw_answers a
              join observation_targets t on t.tenant_id=a.tenant_id and t.id=a.target_id
              where t.plan_id=$1)::text exact_plan_answers`,
          [JIACHENG_PRODUCTION_BASELINE_PLAN_ID],
        )
      ).rows[0];
      const existingPlan = (
        await client.query<{
          id: string;
          question_panel_id: string;
          question_panel_version: number;
          model: string;
          surface: string;
          cycle_key: string;
          rules: unknown;
          planned_samples: number;
        }>(
          `select id,question_panel_id,question_panel_version,model,surface,cycle_key,rules,planned_samples
           from observation_plans where cycle_key=$1 limit 1`,
          [JIACHENG_PRODUCTION_BASELINE_CYCLE],
        )
      ).rows[0];
      const storedTargets = existingPlan
        ? (
            await client.query<{
              id: string;
              idempotency_key: string;
              question_text: string;
              round: number;
            }>(
              `select id,idempotency_key,question_text,round
               from observation_targets where plan_id=$1 order by idempotency_key`,
              [JIACHENG_PRODUCTION_BASELINE_PLAN_ID],
            )
          ).rows
        : [];
      return { panel, counts, existingPlan, storedTargets };
    },
  );

  const baseline = createJiachengProductionBaseline({
    panel: state.panel,
    createdAt: new Date().toISOString(),
  });
  const planCount = Number(state.counts?.plans ?? 0);
  const answerCount = Number(state.counts?.answers ?? 0);
  const scheduleCount = Number(state.counts?.schedules ?? 0);
  const exactPlanAnswerCount = Number(state.counts?.exact_plan_answers ?? 0);

  if (scheduleCount !== 0) {
    throw new Error("Production periodic monitoring must remain disabled.");
  }
  if (!state.existingPlan && (planCount !== 0 || answerCount !== 0)) {
    throw new Error("Production contains an unknown observation plan or answer.");
  }
  if (state.existingPlan) {
    if (planCount !== 1 || answerCount !== exactPlanAnswerCount) {
      throw new Error("Production contains observation data outside the fixed baseline.");
    }
    const expectedPlan = baseline.plan;
    const storedPlan = state.existingPlan;
    if (
      storedPlan.id !== expectedPlan.id ||
      storedPlan.question_panel_id !== expectedPlan.questionPanelId ||
      storedPlan.question_panel_version !== expectedPlan.questionPanelVersion ||
      storedPlan.model !== expectedPlan.model ||
      storedPlan.surface !== expectedPlan.surface ||
      storedPlan.cycle_key !== expectedPlan.cycleKey ||
      storedPlan.planned_samples !== expectedPlan.plannedSamples ||
      JSON.stringify(samplingRulesSchema.parse(storedPlan.rules)) !==
        JSON.stringify(expectedPlan.rules)
    ) {
      throw new Error("Existing production baseline differs from the fixed contract.");
    }
    const expectedTargets = baseline.targets
      .map((target) => ({
        id: target.id,
        idempotency_key: target.idempotencyKey,
        question_text: target.questionText,
        round: target.round,
      }))
      .sort((a, b) => a.idempotency_key.localeCompare(b.idempotency_key));
    if (JSON.stringify(state.storedTargets) !== JSON.stringify(expectedTargets)) {
      throw new Error("Existing production targets differ from the fixed contract.");
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
  if (!state.existingPlan && pending !== 0) {
    throw new Error("Observation queue contains pending work; execution is blocked.");
  }
  if (state.existingPlan && pending !== 0) {
    const allowedTargetIds = new Set(baseline.targets.map((target) => target.id));
    const pendingJobs = await inspectionQueue.getJobs(
      ["wait", "active", "delayed", "prioritized", "waiting-children"],
      0,
      -1,
      true,
    );
    const containsUnrelatedWork = pendingJobs.some((job) => {
      const data = job.data as {
        name?: unknown;
        tenantId?: unknown;
        payload?: { targetId?: unknown };
      };
      return (
        data.name !== "observation.capture" ||
        data.tenantId !== JIACHENG_PRODUCTION_TENANT_ID ||
        typeof data.payload?.targetId !== "string" ||
        !allowedTargetIds.has(data.payload.targetId)
      );
    });
    if (containsUnrelatedWork || pendingJobs.length !== pending) {
      throw new Error("Observation queue contains work outside the fixed baseline.");
    }
  }

  if (!execute) {
    console.log(
      JSON.stringify({
        event: "jiacheng.production_baseline.dry_run",
        mode: "dry-run",
        tenantId: JIACHENG_PRODUCTION_TENANT_ID,
        panelId: baseline.plan.questionPanelId,
        panelVersion: baseline.plan.questionPanelVersion,
        approvedQuestions: 20,
        rounds: baseline.plan.rules.rounds,
        plannedSamples: baseline.plan.plannedSamples,
        model: baseline.plan.model,
        surface: baseline.plan.surface,
        maxTotalTokens: baseline.plan.rules.maxTotalTokens,
        existingPlan: Boolean(state.existingPlan),
        existingAnswers: answerCount,
        pendingQueueJobs: pending,
        deepseekCalled: false,
        executionAuthorized: false,
        requiredAuthorizationMarker: JIACHENG_PRODUCTION_AUTHORIZATION,
      }),
    );
  } else {
    if (!state.existingPlan) {
      await new ObservationRepository(pool).createPlan(
        baseline.plan,
        baseline.targets,
      );
    }
    const producer = createObservationQueue(redisUrl);
    try {
      const jobs = await Promise.all(
        baseline.targets.map((target) =>
          enqueueObservation(producer.queue, observationJob(target)),
        ),
      );
      console.log(
        JSON.stringify({
          event: "jiacheng.production_baseline.enqueued",
          mode: "execute",
          tenantId: JIACHENG_PRODUCTION_TENANT_ID,
          planId: baseline.plan.id,
          plannedSamples: baseline.plan.plannedSamples,
          maxTotalTokens: baseline.plan.rules.maxTotalTokens,
          enqueuedJobs: jobs.length,
          idempotentRerun: Boolean(state.existingPlan),
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
