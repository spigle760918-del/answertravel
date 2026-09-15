import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Redis } from "ioredis";
import pg from "pg";
import { provisionTestDatabase } from "./provision-test-database.js";
import { createEvidenceEnvelope } from "../src/kernel/evidence-envelope.js";
import { EvidenceRepository } from "../src/modules/evidence/evidence-repository.js";
import {
  approveBrandTruth,
  createBrandTruthDraft,
} from "../src/modules/brand-truth/brand-truth.js";
import { BrandTruthRepository } from "../src/modules/brand-truth/brand-truth-repository.js";
import { DeepSeekQuestionGenerator } from "../src/modules/question-intelligence/deepseek-question-generator.js";
import { QuestionIntelligenceRepository } from "../src/modules/question-intelligence/question-intelligence-repository.js";
import { QuestionIntelligenceService } from "../src/modules/question-intelligence/question-intelligence-service.js";
import { JIACHENG_APPROVED_QUESTIONS } from "../src/modules/question-intelligence/jiacheng-question-snapshot.js";
import {
  approveQuestionPanel,
  createQuestionPanelDraft,
  questionPanelSchema,
  questionGenerationRunSchema,
} from "../src/modules/question-intelligence/question-intelligence.js";
import { createObservationPlan } from "../src/modules/observation/observation.js";
import { ObservationRepository } from "../src/modules/observation/observation-repository.js";
import { createCitationSourceWorker } from "../src/modules/citation-source/citation-source-queue.js";
import { createGeoIntelligenceWorker } from "../src/modules/geo-intelligence/geo-intelligence-queue.js";
import { GeoIntelligenceRepository } from "../src/modules/geo-intelligence/geo-intelligence-repository.js";
import { geoEntitySetSchema } from "../src/modules/geo-intelligence/geo-intelligence.js";
import { createGeoDecisionWorker } from "../src/modules/geo-decision/geo-gap-decision-queue.js";
import { GeoGapDecisionRepository } from "../src/modules/geo-decision/geo-gap-decision-repository.js";
import { approveExpansion, comparePlans } from "../src/modules/observation-cycle/comparable-observation-cycle.js";
import { ComparableObservationRepository } from "../src/modules/observation-cycle/comparable-observation-repository.js";
import { buildOnboardingPackage, createIntakeSource } from "../src/modules/real-brand-onboarding/real-brand-onboarding.js";
import { buildBenchmarkFactPack, buildBrandTruthDraftFromBenchmark } from "../src/modules/real-brand-onboarding/benchmark-fact-pack.js";
import { RealBrandOnboardingRepository } from "../src/modules/real-brand-onboarding/real-brand-onboarding-repository.js";
import { createDailyMonitoringSchedule, planScheduledCycle } from "../src/modules/periodic-monitoring/periodic-monitoring.js";
import { PeriodicMonitoringRepository } from "../src/modules/periodic-monitoring/periodic-monitoring-repository.js";
import { BrandClaimVerificationRepository } from "../src/modules/brand-claim-verification/brand-claim-verification-repository.js";
import { BrandClaimVerificationService } from "../src/modules/brand-claim-verification/brand-claim-verification-service.js";
import { EvidenceGapRoutingRepository } from "../src/modules/evidence-gap-routing/evidence-gap-routing-repository.js";
import { EvidenceGapRoutingService } from "../src/modules/evidence-gap-routing/evidence-gap-routing-service.js";
import { OptimizationActionPlanRepository } from "../src/modules/optimization-action-plan/optimization-action-plan-repository.js";
import { OptimizationActionPlanService } from "../src/modules/optimization-action-plan/optimization-action-plan-service.js";
import {
  createObservationQueue,
  createObservationWorker,
  enqueueObservation,
  observationJob,
} from "../src/modules/observation/observation-queue.js";
import { buildApp } from "../src/app.js";
import { withTenantTransaction } from "../src/platform/database.js";
import {
  createFoundationQueue,
  enqueueFoundationJob,
} from "../src/platform/foundation-queue.js";

if (
  !["win32", "linux"].includes(process.platform) ||
  process.arch !== "x64" ||
  process.versions.node.split(".")[0] !== "24"
) {
  throw new Error(
    "This isolated harness requires Windows/Linux x64 and Node.js 24.",
  );
}
const windows = process.platform === "win32";
if (!windows && process.getuid?.() === 0)
  throw new Error("Native Linux tests must run as an unprivileged user.");
const root = resolve(".");
const databaseOnly = process.argv.includes("--database-only");
const deepseekSmoke = process.argv.includes("--deepseek-smoke");
const serveAcceptance = process.argv.includes("--serve-acceptance");
if (deepseekSmoke && !process.env.DEEPSEEK_API_KEY)
  throw new Error(
    "DEEPSEEK_API_KEY is required for the explicit real-provider smoke test.",
  );
if (serveAcceptance && !deepseekSmoke)
  throw new Error(
    "Acceptance console requires --deepseek-smoke so visible answers are real API samples.",
  );
const redisBinary = resolve(
  windows
    ? ".runtime/tools/redis-7.2.16/Redis-7.2.16-Windows-x64-msys2/redis-server.exe"
    : ".runtime/tools/redis-7.2.16/src/redis-server",
);
const work = await mkdtemp(join(tmpdir(), "answertravel-v2-test-"));
console.log(`Isolated test workspace: ${work}`);
const native = resolve(
  dirname(
    fileURLToPath(
      import.meta.resolve(
        windows
          ? "@embedded-postgres/windows-x64"
          : "@embedded-postgres/linux-x64",
      ),
    ),
  ),
  "../native",
);
const nativeAlias = join(work, "pg-native");
await symlink(native, nativeAlias, windows ? "junction" : "dir");
const bin = join(nativeAlias, "bin");
const executable = (name: string) => join(bin, windows ? `${name}.exe` : name);
const pgData = join(work, "postgres");
let activeData = pgData;
let pgStarted = false;
let redisProcess: ChildProcess | undefined;
let redisOutput = "";
const password = randomBytes(24).toString("hex");
const passwordFile = join(work, "test-password.txt");
await writeFile(passwordFile, password, { mode: 0o600 });
const redisData = join(work, "redis");
await mkdir(redisData);
const serviceEnv = {
  ...process.env,
  LANG: "C",
  LC_ALL: "C",
  PGCLIENTENCODING: "UTF8",
  ...(!windows ? { LD_LIBRARY_PATH: join(nativeAlias, "lib") } : {}),
};

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((yes, no) => {
    server.once("error", no);
    server.listen(0, "127.0.0.1", yes);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No local TCP port available.");
  await new Promise<void>((yes, no) =>
    server.close((error) => (error ? no(error) : yes())),
  );
  return address.port;
}

async function run(
  executable: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; visible?: boolean } = {},
): Promise<void> {
  await new Promise<void>((yes, no) => {
    const child = spawn(executable, args, {
      cwd: options.cwd ?? root,
      env: options.env ?? serviceEnv,
      windowsHide: true,
      stdio: options.visible ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      output += String(chunk);
    });
    const timer = setTimeout(() => {
      child.kill();
      no(new Error(`Test command timed out: ${executable}`));
    }, 120_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      no(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0
        ? yes()
        : no(new Error(`Test command failed (${code}): ${output}`));
    });
  });
}

const pgPort = await freePort();
let redisPort = await freePort();
while (redisPort === pgPort) redisPort = await freePort();
const adminBase = `postgresql://answertravel_v2_admin:${password}@127.0.0.1:${pgPort}`;
const adminUrl = `${adminBase}/answertravel_v2_test`;
const redisUrl = `redis://:${password}@127.0.0.1:${redisPort}`;

async function startPostgres(): Promise<void> {
  await run(
    executable("pg_ctl"),
    [
      "-D",
      activeData,
      "-l",
      join(work, "postgres.log"),
      "-w",
      "-t",
      "25",
      "-o",
      `-p ${pgPort} -h 127.0.0.1 -c shared_buffers=32MB -c max_connections=30${windows ? "" : ` -k ${work}`}`,
      "start",
    ],
    { cwd: bin },
  );
  pgStarted = true;
}
async function stopPostgres(): Promise<void> {
  if (!pgStarted) return;
  await run(
    executable("pg_ctl"),
    ["-D", activeData, "-m", "fast", "-w", "stop"],
    { cwd: bin },
  );
  pgStarted = false;
}
async function startRedis(): Promise<void> {
  redisProcess = spawn(
    redisBinary,
    [
      "--bind",
      "127.0.0.1",
      "--port",
      String(redisPort),
      "--protected-mode",
      "yes",
      "--requirepass",
      password,
      "--dir",
      ".",
      "--appendonly",
      "yes",
      "--appendfsync",
      "always",
      "--save",
      "",
    ],
    { cwd: redisData, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let startupError: Error | undefined;
  redisProcess.on("error", (error) => {
    startupError = error;
  });
  redisProcess.stdout?.on("data", (chunk) => {
    redisOutput += String(chunk);
  });
  redisProcess.stderr?.on("data", (chunk) => {
    redisOutput += String(chunk);
  });
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    retryStrategy: null,
    connectTimeout: 500,
  });
  client.on("error", () => {});
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (startupError) throw startupError;
      if (redisProcess.exitCode !== null)
        throw new Error(`Redis exited: ${redisOutput}`);
      try {
        await client.connect();
        if ((await client.ping()) === "PONG") return;
      } catch {
        client.disconnect();
      }
      await delay(250);
    }
    throw new Error(`Redis startup timed out: ${redisOutput}`);
  } finally {
    client.disconnect();
  }
}
async function killOwnedRedis(): Promise<void> {
  if (!redisProcess || redisProcess.exitCode !== null) return;
  const child = redisProcess;
  await new Promise<void>((yes) => {
    child.once("exit", () => yes());
    child.kill("SIGKILL");
  });
  redisProcess = undefined;
}

let success = false;
let testSummary: Record<string, unknown> = {};
let acceptanceTenantId: string | undefined;
try {
  await run(
    executable("initdb"),
    [
      "-D",
      pgData,
      "-U",
      "answertravel_v2_admin",
      `--pwfile=${passwordFile}`,
      "--auth=scram-sha-256",
      "--encoding=UTF8",
      "--locale=C",
    ],
    { cwd: bin },
  );
  await startPostgres();
  const bootstrap = new pg.Client({
    connectionString: `${adminBase}/postgres`,
  });
  await bootstrap.connect();
  try {
    await bootstrap.query("create database answertravel_v2_test");
  } finally {
    await bootstrap.end();
  }
  const appUrl = await provisionTestDatabase(adminUrl, password);
  if (!databaseOnly) await startRedis();
  console.log(
    databaseOnly
      ? "PostgreSQL 16.14 is ready; Redis checks explicitly excluded."
      : "PostgreSQL 16.14 and Redis 7.2.16 are ready on isolated loopback ports.",
  );
  const env = {
    ...serviceEnv,
    NODE_ENV: "test",
    REQUIRE_INTEGRATION: "true",
    TEST_ADMIN_DATABASE_URL: adminUrl,
    TEST_DATABASE_URL: appUrl,
    TEST_REDIS_URL: redisUrl,
  };
  await run(
    process.execPath,
    [resolve("node_modules/typescript/bin/tsc"), "--noEmit"],
    { env, visible: true },
  );
  await run(
    process.execPath,
    [resolve("node_modules/typescript/bin/tsc"), "-p", resolve("web/tsconfig.json"), "--noEmit"],
    { env, visible: true },
  );
  await run(
    process.execPath,
    [resolve("node_modules/vite/bin/vite.js"), "build", "--config", resolve("web/vite.config.ts")],
    { env, visible: true },
  );
  const selection = databaseOnly
    ? [
        "tests/contracts",
        "tests/architecture",
        "tests/integration/database.test.ts",
        "tests/integration/migrations.test.ts",
      ]
    : [];
  const resultsPath = join(work, "vitest-results.json");
  await run(
    process.execPath,
    [
      resolve("node_modules/vitest/vitest.mjs"),
      "run",
      ...selection,
      "--reporter=default",
      "--reporter=json",
      `--outputFile=${resultsPath}`,
    ],
    { env, visible: true },
  );
  const results = JSON.parse(await readFile(resultsPath, "utf8"));
  if (
    results.numFailedTests ||
    results.numPendingTests ||
    !results.numPassedTests
  )
    throw new Error("Verification requires passing tests without skips.");
  testSummary = {
    passed: results.numPassedTests,
    failed: results.numFailedTests,
    skipped: results.numPendingTests,
    resultsPath,
  };

  if (deepseekSmoke) {
    const smokeTenantId = randomUUID();
    const smokeCardId = randomUUID();
    const smokeFactId = randomUUID();
    acceptanceTenantId = smokeTenantId;
    const smokeAdmin = new pg.Pool({ connectionString: adminUrl });
    try {
      await smokeAdmin.query(
        "insert into tenants(id,slug,display_name) values ($1,$2,$3)",
        [
          smokeTenantId,
          `deepseek-smoke-${smokeTenantId.slice(0, 8)}`,
          "DeepSeek provider test fixture",
        ],
      );
    } finally {
      await smokeAdmin.end();
    }
    const smokePool = new pg.Pool({ connectionString: appUrl });
    try {
      const truthRepository = new BrandTruthRepository(smokePool);
      const draft = createBrandTruthDraft({
        id: smokeCardId,
        tenantId: smokeTenantId,
        brandName: "远行测试旅行社",
        createdAt: new Date().toISOString(),
        facts: [
          {
            id: smokeFactId,
            statement: "测试品牌提供适合六至十二岁儿童的云南亲子行程咨询",
            category: "service",
            status: "draft",
            factLevel: "F0",
            public: true,
            visibility: "public",
            source: { type: "human", reference: "明确隔离的测试事实" },
          },
        ],
      });
      await truthRepository.create(draft, "deepseek-smoke-test");
      const approved = await truthRepository.create(
        approveBrandTruth({
          ...draft,
          facts: draft.facts.map((fact) => ({
            ...fact,
            status: "approved" as const,
          })),
        }),
        "deepseek-smoke-test",
      );
      await new GeoIntelligenceRepository(smokePool).createEntitySet(
        geoEntitySetSchema.parse({
          id: randomUUID(), tenantId: smokeTenantId, version: 1, status: "approved", createdAt: new Date().toISOString(),
          brand: { id: "brand", name: "远行测试旅行社", aliases: ["远行旅行"] },
          competitors: [{ id: "competitor-a", name: "同行测试旅行社", aliases: [] }],
        }),
        "deepseek-smoke-test",
      );
      const benchmarkPack = buildBenchmarkFactPack();
      const historicalSource = createIntakeSource({ tenantId:smokeTenantId,sourceType:"file",reference:"用户提交：北京珈程国际旅行社 GEO检测基准事实包（待审核）",capturedAt:benchmarkPack.capturedAt,sensitive:true,content:benchmarkPack });
      await new RealBrandOnboardingRepository(smokePool).create(buildOnboardingPackage({ tenantId:smokeTenantId,brandName:"北京珈程国际旅行社",source:historicalSource,
        facts:benchmarkPack.facts.map((fact)=>({statement:fact.statement,category:fact.category,factLevel:"F0" as const,visibility:fact.visibility,confidence:fact.accepted?"high" as const:"low" as const,needsHumanConfirmation:true})),competitors:benchmarkPack.competitors.map((competitor)=>({name:competitor.name,aliases:competitor.aliases,needsHumanConfirmation:!competitor.confirmedForMonitoring})),seedQuestions:[
          {text:"大理三天两夜怎么安排路线和住宿？",group:"路线规划"},{text:"雨季去云南旅游安全吗？需要准备什么？",group:"出行安全"},
          {text:"云南 5 天游玩路线如何安排更省时间？",group:"路线规划"},{text:"第一次去云南，哪些景点最值得安排？",group:"旅行体验"},
          {text:"带孩子去云南适合自由行还是跟团？",group:"旅行体验"},
        ],gaps:["基准事实包尚未逐条批准","缺少服务流程和适用人群的企业确认","缺少可验证差异化能力","公开范围仍待品牌真相 Gate E 批准"],
        conflicts:benchmarkPack.contradictions }));
      const questionRepository = new QuestionIntelligenceRepository(smokePool);
      const service = new QuestionIntelligenceService(
        new DeepSeekQuestionGenerator({
          apiKey: process.env.DEEPSEEK_API_KEY!,
          timeoutMs: 60_000,
        }),
        new EvidenceRepository(smokePool),
        questionRepository,
      );
      const panel = await service.generateDraft(
        {
          id: randomUUID(),
          tenantId: smokeTenantId,
          panelId: randomUUID(),
          brandAliases: [],
          destinations: ["云南"],
          competitors: ["同行测试旅行社"],
          seedQuestions: ["云南亲子旅行怎么规划？"],
          requestedTotal: 8,
          promptVersion: "question-expansion.v1",
          createdAt: new Date().toISOString(),
        },
        approved,
        ["绝对保证", "零风险"],
      );
      if (
        !panel.candidates.length ||
        !panel.candidates.some((candidate) => candidate.included)
      ) {
        throw new Error(
          "Real DeepSeek response produced no eligible question candidates.",
        );
      }
      const evidenceCount = await withTenantTransaction(
        smokePool,
        smokeTenantId,
        (client) =>
          client.query<{ count: string }>(
            "select count(*)::text as count from evidence_artifacts where artifact_type='question_generation.deepseek_response'",
          ),
      );
      if (evidenceCount.rows[0]?.count !== "1")
        throw new Error(
          "Real DeepSeek response evidence was not persisted exactly once.",
        );
      console.log(
        `PASS: Real DeepSeek API generated ${panel.candidates.length} candidates; ${panel.mix.actualTotal} passed deterministic gates. Raw response stored only in the isolated test database.`,
      );
      const smokePanelId = randomUUID();
      const firstQuestionId = randomUUID();
      const secondQuestionId = randomUUID();
      const smokePanel = questionPanelSchema.parse({
        id: smokePanelId,
        tenantId: smokeTenantId,
        version: 1,
        status: "draft",
        brandTruthCardId: approved.id,
        brandTruthVersion: approved.version,
        generationRunId: panel.generationRunId,
        createdAt: new Date().toISOString(),
        candidates: [
          {
            id: firstQuestionId,
            text: "云南亲子五日游通常如何安排？请简要回答。",
            journeyStage: "planning",
            objectType: "neutral_category",
            panelRole: "baseline",
            intentCluster: "行程规划",
            audience: "亲子家庭",
            scenario: "云南五日游",
            supportingFactIds: [],
            rationale: "稳定采集测试",
            rawIndex: 0,
            included: true,
            canonicalCandidateId: firstQuestionId,
            exclusionReason: null,
          },
          {
            id: secondQuestionId,
            text: "选择亲子旅行社时应核对哪些服务信息？请简要回答。",
            journeyStage: "risk_confirmation",
            objectType: "neutral_category",
            panelRole: "baseline",
            intentCluster: "服务核验",
            audience: "亲子家庭",
            scenario: "出发前",
            supportingFactIds: [],
            rationale: "稳定采集测试",
            rawIndex: 1,
            included: true,
            canonicalCandidateId: secondQuestionId,
            exclusionReason: null,
          },
        ],
        mix: {
          requestedTotal: 2,
          actualTotal: 2,
          baseline: { target: 2, actual: 2 },
          exploration: { target: 0, actual: 0 },
          trigger: { target: 0, actual: 0 },
        },
      });
      await questionRepository.createPanel(smokePanel, "deepseek-smoke-test");
      const approvedPanel = await questionRepository.createPanel(
        approveQuestionPanel(smokePanel, [], new Date().toISOString()),
        "deepseek-smoke-test",
      );
      const observationRepository = new ObservationRepository(smokePool);
      const comparableRepository = new ComparableObservationRepository(smokePool);
      const observation = createObservationPlan({
        id: randomUUID(),
        panel: approvedPanel,
        rules: {
          version: "deepseek-sampling.v1",
          rounds: 3,
          language: "简体中文",
          regionContext: "中国大陆测试语境",
          temperature: 0.2,
          maxTokens: 1200,
          timeoutMs: 60_000,
          maxAttempts: 3,
          maxTotalTokens: 20_000,
        },
        createdAt: new Date().toISOString(),
      });
      await observationRepository.createPlan(
        observation.plan,
        observation.targets,
      );
      const producer = createObservationQueue(redisUrl);
      const citations = createCitationSourceWorker(redisUrl, smokePool);
      const geoIntelligence = createGeoIntelligenceWorker(redisUrl, smokePool);
      const geoDecisions = createGeoDecisionWorker(redisUrl, smokePool);
      const consumer = createObservationWorker(
        redisUrl,
        smokePool,
        process.env.DEEPSEEK_API_KEY!,
      );
      try {
        await citations.worker.waitUntilReady();
        await geoIntelligence.worker.waitUntilReady();
        await geoDecisions.worker.waitUntilReady();
        await consumer.worker.waitUntilReady();
        const selectedTargets = [
          observation.targets[0],
          observation.targets[1],
          observation.targets[3],
          observation.targets[4],
        ].filter((target): target is NonNullable<typeof target> =>
          Boolean(target),
        );
        const jobs = await Promise.all(
          selectedTargets.map((target) =>
            enqueueObservation(producer.queue, observationJob(target)),
          ),
        );
        for (let poll = 0; poll < 240; poll++) {
          const states = await Promise.all(jobs.map((job) => job.getState()));
          if (states.every((state) => state === "completed")) break;
          if (states.some((state) => state === "failed")) {
            const reasons = await Promise.all(
              jobs.map(async (job, index) => ({
                index,
                state: states[index],
                reason:
                  (await producer.queue.getJob(job.id!))?.failedReason ?? null,
              })),
            );
            throw new Error(
              `Real observation job failed: ${JSON.stringify(reasons)}`,
            );
          }
          if (poll === 239) throw new Error("Real observation jobs timed out.");
          await delay(500);
        }
        for (let poll = 0; poll < 120; poll++) {
          const scanCount = await withTenantTransaction(
            smokePool,
            smokeTenantId,
            (client) =>
              client.query<{ count: string }>(
                "select count(*)::text as count from citation_scans",
              ),
          );
          if (scanCount.rows[0]?.count === "4") break;
          if (poll === 119)
            throw new Error(
              "Citation scans did not complete for all real answers.",
            );
          await delay(250);
        }
        for (let poll = 0; poll < 120; poll++) {
          const runCount = await withTenantTransaction(smokePool, smokeTenantId, (client) =>
            client.query<{ count: string }>("select count(*)::text as count from geo_analysis_runs"));
          if (runCount.rows[0]?.count === "4") break;
          if (poll === 119) throw new Error("GEO analysis did not complete for all real answers.");
          await delay(250);
        }
        for (let poll = 0; poll < 120; poll++) {
          const decision = await new GeoGapDecisionRepository(smokePool).latest(smokeTenantId);
          if (decision?.diagnosis.sampleCount === 4) break;
          if (poll === 119) throw new Error("GEO gap decision did not complete for the real evidence set.");
          await delay(250);
        }
        const authorization = await comparableRepository.authorize(approveExpansion({
          tenantId: smokeTenantId,
          decisionReference: "Gate A confirmed by user on 2026-09-14",
          maxNewSamples: 2,
          maxTotalTokens: 6_000,
          approvedAt: new Date().toISOString(),
        }));
        const followup = createObservationPlan({
          id: randomUUID(), panel: approvedPanel, model: observation.plan.model, cycleKey: "comparison-cycle-2",
          authorizationId: authorization.id,
          rules: { ...observation.plan.rules, rounds: 1, maxTotalTokens: authorization.maxTotalTokens },
          createdAt: new Date().toISOString(),
        });
        if (followup.targets.length !== authorization.maxNewSamples) throw new Error("Authorized follow-up plan is not minimal.");
        await observationRepository.createPlan(followup.plan, followup.targets);
        const followupJobs = await Promise.all(followup.targets.map((target) => enqueueObservation(producer.queue, observationJob(target))));
        for (let poll = 0; poll < 240; poll++) {
          const states = await Promise.all(followupJobs.map((job) => job.getState()));
          if (states.every((state) => state === "completed")) break;
          if (states.some((state) => state === "failed")) throw new Error("Comparable follow-up observation failed.");
          if (poll === 239) throw new Error("Comparable follow-up observation timed out.");
          await delay(500);
        }
        let finalDecision = null;
        for (let poll = 0; poll < 160; poll++) {
          const counts = await withTenantTransaction(smokePool, smokeTenantId, (client) => client.query<{ answers:string; scans:string; runs:string }>(`select
            (select count(*) from raw_answers)::text answers,
            (select count(*) from citation_scans)::text scans,
            (select count(*) from geo_analysis_runs where status='completed')::text runs`));
          finalDecision = await new GeoGapDecisionRepository(smokePool).latest(smokeTenantId);
          if (counts.rows[0]?.answers === "6" && counts.rows[0]?.scans === "6" && counts.rows[0]?.runs === "6" && finalDecision?.diagnosis.sampleCount === 6 && finalDecision.diagnosis.observationPlanCount === 2) break;
          if (poll === 159) throw new Error("Comparable observation evidence or automatic re-diagnosis did not complete.");
          await delay(250);
        }
        if (!finalDecision) throw new Error("Automatic re-diagnosis is missing.");
        const snapshot = comparePlans(observation.plan, followup.plan, 6, finalDecision.diagnosis.id);
        await comparableRepository.saveSnapshot(snapshot);
        if (snapshot.status !== "comparable" || finalDecision.diagnosis.evidenceStatus !== "sufficient") throw new Error("Comparable cycle gate did not pass.");
        if (finalDecision.deepDive.decision !== "no_trigger") throw new Error("Competitor direct-question sampling must remain disabled without evidence.");
        console.log("PASS: Gate A authorization produced exactly two new neutral answers, a comparable second cycle, and automatic GEO re-diagnosis.");
      } finally {
        await consumer.close();
        await citations.close();
        await geoIntelligence.close();
        await geoDecisions.close();
        await producer.close();
      }
      const answerCount = await withTenantTransaction(
        smokePool,
        smokeTenantId,
        (client) =>
          client.query<{ count: string }>(
            "select count(*)::text as count from raw_answers",
          ),
      );
      if (answerCount.rows[0]?.count !== "6")
        throw new Error(
          "Real DeepSeek observation smoke test did not persist exactly six answers.",
        );
      const citationCounts = await withTenantTransaction(
        smokePool,
        smokeTenantId,
        (client) =>
          client.query<{ scans: string; events: string }>(
            "select (select count(*) from citation_scans)::text scans,(select count(*) from citation_events)::text events",
          ),
      );
      if (citationCounts.rows[0]?.scans !== "6")
        throw new Error("Real answers are missing citation scan evidence.");
      const stoppedTarget = observation.targets[2];
      if (!stoppedTarget)
        throw new Error("Acceptance budget-stop target is missing.");
      await observationRepository.recordAttempt({
        id: randomUUID(),
        tenantId: smokeTenantId,
        targetId: stoppedTarget.id,
        attempt: 1,
        status: "budget_stopped",
        request: {},
        response: null,
        errorCode: "acceptance_budget_limit",
        httpStatus: null,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
      console.log(
        `PASS: Real DeepSeek API preserved four baseline answers and added exactly two authorized comparison-cycle answers; all six were scanned for citation evidence (${citationCounts.rows[0]?.events ?? "0"} candidates).`,
      );
    } finally {
      await smokePool.end();
    }

    if (serveAcceptance) {
      const realTenantId = randomUUID();
      const realAdmin = new pg.Pool({ connectionString: adminUrl });
      try {
        await realAdmin.query("insert into tenants(id,slug,display_name) values ($1,$2,$3)", [realTenantId, `jiacheng-${realTenantId.slice(0,8)}`, "北京珈程国际旅行社"]);
      } finally { await realAdmin.end(); }
      const realPool = new pg.Pool({ connectionString: appUrl });
      try {
        const pack = buildBenchmarkFactPack();
        const truthRepository = new BrandTruthRepository(realPool);
        const truthDraft = buildBrandTruthDraftFromBenchmark({ tenantId:realTenantId, brandName:"北京珈程国际旅行社" });
        await truthRepository.create(truthDraft, "jiacheng-brand-truth-gate-e");
        const approvedTruth = await truthRepository.create(approveBrandTruth({ ...truthDraft, facts:truthDraft.facts.map((fact)=>({...fact,status:"approved" as const})) }), "jiacheng-brand-truth-gate-e");
        const source = createIntakeSource({ tenantId:realTenantId,sourceType:"manual",reference:"用户确认的北京珈程 GEO 基准事实包",capturedAt:pack.capturedAt,sensitive:true,content:pack });
        await new RealBrandOnboardingRepository(realPool).create(buildOnboardingPackage({ tenantId:realTenantId,brandName:"北京珈程国际旅行社",source,
          facts:pack.facts.map((fact)=>({statement:fact.statement,category:fact.category,factLevel:"F0" as const,visibility:fact.visibility,confidence:fact.accepted?"high" as const:"low" as const,needsHumanConfirmation:!fact.accepted})),
          competitors:pack.competitors.map((competitor)=>({name:competitor.name,aliases:competitor.aliases,needsHumanConfirmation:false})),
          seedQuestions:[{text:"第一次来北京，5天4晚跟团游怎么选？",group:"行程规划"},{text:"北京12人小团适合哪些游客？",group:"产品比较"},{text:"北京纯玩团如何确认没有购物和自费？",group:"风险确认"}],
          gaps:[],conflicts:pack.contradictions }));
        await new GeoIntelligenceRepository(realPool).createEntitySet(geoEntitySetSchema.parse({ id:randomUUID(),tenantId:realTenantId,version:1,status:"approved",createdAt:new Date().toISOString(),
          brand:{id:"brand",name:"北京珈程国际旅行社",aliases:[]},competitors:pack.competitors.map((competitor,index)=>({id:`competitor-${index+1}`,name:competitor.name,aliases:competitor.aliases})) }), "jiacheng-monitoring-scope");
        const questionRepository = new QuestionIntelligenceRepository(realPool);
        const evidence = new EvidenceRepository(realPool);
        const generationId = randomUUID();
        const panelId = randomUUID();
        const createdAt = new Date().toISOString();
        const generationInput = { id:generationId, tenantId:realTenantId, panelId, brandAliases:[], destinations:["北京"], competitors:pack.competitors.map((item)=>item.name),
          questionScope:"brand_and_neutral_only" as const, seedQuestions:[], requestedTotal:20, promptVersion:"question-expansion.v2" as const, createdAt };
        const snapshotEvidenceEnvelope = createEvidenceEnvelope({
          tenantId: realTenantId,
          artifactType: "question_panel.user_approved_snapshot",
          factLevel: "F0",
          schemaVersion: 1,
          source: { system: "answertravel-v2-knowledge-base", reference: "docs/v2-knowledge-base/25-real-question-panel-intent-card.md", capturedAt: createdAt, surface: "manual" },
          payload: { gate: "YES，通过真实游客问题组 Gate E", snapshotVersion: "question-snapshot.v1", questions: JIACHENG_APPROVED_QUESTIONS.map((item, index) => ({ index: index + 1, ...item })) },
        });
        const snapshotEvidence = await evidence.append(snapshotEvidenceEnvelope, { actorType: "user", actorId: "jiacheng-gate-e", traceId: generationId });
        const run = await questionRepository.createRun(questionGenerationRunSchema.parse({ id:generationId, tenantId:realTenantId, brandTruthCardId:approvedTruth.id, brandTruthVersion:approvedTruth.version,
          status:"succeeded", provider:"user_approved_snapshot", model:"not_applicable", promptVersion:"question-snapshot.v1", evidenceId:snapshotEvidence.id, errorCode:null, requestedAt:createdAt, completedAt:createdAt }), "jiacheng-gate-e");
        const realDraft = createQuestionPanelDraft({ panelId, generationRunId:run.id, brandTruth:approvedTruth, generated:JIACHENG_APPROVED_QUESTIONS, generation:generationInput, forbiddenExpressions:pack.forbiddenExpressions, createdAt });
        const draft = await questionRepository.createPanel(realDraft, "jiacheng-gate-e");
        const realPanel = await questionRepository.createPanel(approveQuestionPanel(draft, [], new Date().toISOString()), "jiacheng-gate-e");
        if (realPanel.status !== "approved" || realPanel.version !== 2 || realPanel.candidates.length !== 20 || realPanel.mix.actualTotal !== 20) throw new Error("Approved Jiacheng snapshot panel is incomplete.");
        if (realPanel.mix.baseline.actual !== 12 || realPanel.mix.exploration.actual !== 5 || realPanel.mix.trigger.actual !== 3) throw new Error("Approved Jiacheng snapshot panel did not preserve 12/5/3.");
        const observationRepository = new ObservationRepository(realPool);
        const observation = createObservationPlan({ id:randomUUID(), panel:realPanel, cycleKey:"jiacheng-real-baseline-1", rules:{ version:"deepseek-sampling.v1", rounds:2, language:"简体中文", regionContext:"中国大陆游客计划北京旅行", temperature:0.2, maxTokens:1000, timeoutMs:60_000, maxAttempts:3, maxTotalTokens:60_000 }, createdAt:new Date().toISOString() });
        if (observation.targets.length !== 40) throw new Error("Jiacheng baseline must plan exactly 40 samples.");
        await observationRepository.createPlan(observation.plan, observation.targets);
        const producer = createObservationQueue(redisUrl);
        const citations = createCitationSourceWorker(redisUrl, realPool);
        const geoIntelligence = createGeoIntelligenceWorker(redisUrl, realPool);
        const geoDecisions = createGeoDecisionWorker(redisUrl, realPool);
        const consumer = createObservationWorker(redisUrl, realPool, process.env.DEEPSEEK_API_KEY!);
        try {
          await Promise.all([citations.worker.waitUntilReady(), geoIntelligence.worker.waitUntilReady(), geoDecisions.worker.waitUntilReady(), consumer.worker.waitUntilReady()]);
          const jobs = await Promise.all(observation.targets.map((target)=>enqueueObservation(producer.queue, observationJob(target))));
          for (let poll=0; poll<900; poll++) {
            const states=await Promise.all(jobs.map((job)=>job.getState()));
            if (states.every((state)=>state === "completed" || state === "failed")) break;
            if (poll===899) throw new Error("Jiacheng real observation timed out.");
            await delay(500);
          }
          const periodicRepository = new PeriodicMonitoringRepository(realPool);
          const scheduledFor = new Date().toISOString();
          const schedule = await periodicRepository.createSchedule(createDailyMonitoringSchedule({ tenantId:realTenantId,panel:realPanel,nextRunAt:scheduledFor,
            decisionReference:"Gate A confirmed by user on 2026-09-14: 北京珈程周期化监测、失败补采与自动复诊 V1",createdAt:scheduledFor }));
          const scheduled = planScheduledCycle(schedule,realPanel,scheduledFor,new Date().toISOString());
          await observationRepository.createPlan(scheduled.plan,scheduled.targets);
          await periodicRepository.saveCycle(scheduled.cycle,scheduled.nextRunAt);
          const periodicJobs=await Promise.all(scheduled.targets.map((target)=>enqueueObservation(producer.queue,observationJob(target))));
          for(let poll=0;poll<900;poll++){
            const states=await Promise.all(periodicJobs.map((job)=>job.getState()));
            if(states.every((state)=>state==="completed"||state==="failed")) break;
            if(poll===899) throw new Error("Jiacheng periodic acceptance cycle timed out.");
            await delay(500);
          }
          for(let poll=0;poll<360;poll++){
            const r=await withTenantTransaction(realPool,realTenantId,(client)=>client.query<{answers:string;scans:string;geo:string}>(`select (select count(*) from raw_answers)::text answers,(select count(*) from citation_scans)::text scans,(select count(*) from geo_analysis_runs where status='completed')::text geo`));
            const x=r.rows[0]; if(x&&x.answers===x.scans&&x.answers===x.geo) break;
            if(poll===359) throw new Error("Periodic answer evidence did not finish downstream analysis.");
            await delay(500);
          }
          const claimVerification=new BrandClaimVerificationService(new BrandClaimVerificationRepository(realPool));
          const claimResult=await claimVerification.verifyTenant(realTenantId);
          const repeated=await claimVerification.verifyTenant(realTenantId);
          if(claimResult.answers===0||claimResult.created!==claimResult.answers||repeated.idempotent!==claimResult.answers) throw new Error("Brand claim verification did not cover brand-direct answers idempotently.");
          const routingService=new EvidenceGapRoutingService(new EvidenceGapRoutingRepository(realPool));const routed=await routingService.evaluate(realTenantId);const routedAgain=await routingService.evaluate(realTenantId);
          if(routed.snapshot.sourceFindingCount===0||routed.snapshot.clusterCount===0||routedAgain.idempotent!==true) throw new Error("Evidence gap routing did not persist an idempotent snapshot.");
          const actionPlanService=new OptimizationActionPlanService(new OptimizationActionPlanRepository(realPool));const actionPlan=await actionPlanService.create(realTenantId);const actionPlanAgain=await actionPlanService.create(realTenantId);
          if(actionPlan.plan.packageCount===0||actionPlan.plan.packageCount>5||actionPlan.plan.sourceFindingCount!==routed.snapshot.sourceFindingCount||actionPlanAgain.idempotent!==true) throw new Error("Optimization action plan did not compress all gaps idempotently.");
        } finally { await consumer.close(); await citations.close(); await geoIntelligence.close(); await geoDecisions.close(); await producer.close(); }
        let counts = { answers:"0", scans:"0", geo:"0" };
        for (let poll=0; poll<240; poll++) {
          const result = await withTenantTransaction(realPool,realTenantId,(client)=>client.query<{answers:string;scans:string;geo:string}>(`select (select count(*) from raw_answers)::text answers,(select count(*) from citation_scans)::text scans,(select count(*) from geo_analysis_runs where status='completed')::text geo`));
          counts = result.rows[0] ?? counts;
          if (Number(counts.scans) >= Number(counts.answers) && Number(counts.geo) >= Number(counts.answers) && Number(counts.answers) + Number(counts.geo) > 0) break;
          await delay(500);
        }
        const realAnswers = await withTenantTransaction(realPool,realTenantId,(client)=>client.query<{count:string}>("select count(*)::text count from raw_answers"));
        if (realAnswers.rows[0]?.count !== counts.answers) throw new Error("Jiacheng answer count changed during finalization.");
        acceptanceTenantId = realTenantId;
        const periodicState=await new PeriodicMonitoringRepository(realPool).latestSchedule(realTenantId);
        const periodicCycles=await new PeriodicMonitoringRepository(realPool).cycles(realTenantId);
        if(!periodicState||periodicState.status!=="active"||periodicCycles.length!==1) throw new Error("Periodic monitoring schedule was not persisted idempotently.");
        const claimCounts=await withTenantTransaction(realPool,realTenantId,c=>c.query<{runs:string;findings:string;conflicts:string}>(`select (select count(*) from brand_claim_verification_runs)::text runs,(select count(*) from brand_claim_findings)::text findings,(select count(*) from brand_claim_findings where verdict='fact_conflict')::text conflicts`));
        console.log(`PASS: Beijing Jiacheng baseline plus periodic cycle and brand-claim verification completed; answers=${counts.answers}, claimRuns=${claimCounts.rows[0]?.runs}, findings=${claimCounts.rows[0]?.findings}, conflicts=${claimCounts.rows[0]?.conflicts}.`);
      } finally { await realPool.end(); }
    }
  }

  const tenantId = randomUUID();
  const admin = new pg.Pool({ connectionString: adminUrl });
  try {
    await admin.query(
      "insert into tenants(id,slug,display_name) values ($1,$2,$3)",
      [tenantId, `recovery-${tenantId}`, "Recovery fixture only"],
    );
  } finally {
    await admin.end();
  }
  const pool = new pg.Pool({ connectionString: appUrl });
  const marker = createEvidenceEnvelope({
    tenantId,
    artifactType: "foundation.recovery",
    factLevel: "F1",
    schemaVersion: 1,
    source: {
      system: "local-recovery-test",
      reference: `fixture://${randomUUID()}`,
      capturedAt: new Date().toISOString(),
    },
    payload: { testOnly: true, marker: randomUUID() },
  });
  try {
    await new EvidenceRepository(pool).append(marker);
  } finally {
    await pool.end();
  }
  let jobId = "";
  if (!databaseOnly) {
    const producer = createFoundationQueue(redisUrl);
    try {
      const job = await enqueueFoundationJob(producer.queue, {
        name: "foundation.probe",
        version: 1,
        tenantId,
        idempotencyKey: randomUUID(),
        requestedAt: new Date().toISOString(),
        traceId: randomUUID(),
        payload: { testOnly: true, recovery: true },
      });
      jobId = job.id!;
    } finally {
      await producer.close();
    }
  }

  // Cold physical backup: stop our cluster, copy to a new directory, start the copy.
  await stopPostgres();
  const restored = join(work, "postgres-restored");
  await cp(pgData, restored, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  activeData = restored;
  await startPostgres();
  const restoredPool = new pg.Pool({ connectionString: appUrl });
  try {
    const restoredEvidence = await new EvidenceRepository(
      restoredPool,
    ).findById(tenantId, marker.id);
    if (restoredEvidence?.payloadSha256 !== marker.payloadSha256)
      throw new Error("Restored evidence hash mismatch.");
    const audits = await withTenantTransaction(
      restoredPool,
      tenantId,
      (client) =>
        client.query("select id from audit_events where resource_id=$1", [
          marker.id,
        ]),
    );
    if (audits.rowCount !== 1)
      throw new Error("Restored audit record missing.");
  } finally {
    await restoredPool.end();
  }
  console.log(
    "PASS: PostgreSQL cold backup restored evidence and audit with the same hash.",
  );

  // Kill only the child this harness started; AOF is configured to fsync every write.
  if (!databaseOnly) {
    await killOwnedRedis();
    await startRedis();
    const recovered = createFoundationQueue(redisUrl);
    try {
      const job = await recovered.queue.getJob(jobId);
      if (!job || (await job.getState()) !== "waiting")
        throw new Error("Queued task lost after Redis process restart.");
    } finally {
      await recovered.close();
    }
    console.log(
      "PASS: Redis AOF recovered the pending task after process termination.",
    );
  }
  success = true;
  if (serveAcceptance) {
    if (!acceptanceTenantId)
      throw new Error("Acceptance tenant was not created.");
    const acceptancePort = Number(process.env.ACCEPTANCE_PORT ?? 4274);
    const app = buildApp({
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: acceptancePort,
      DATABASE_URL: appUrl,
      REDIS_URL: redisUrl,
      LOG_LEVEL: "silent",
      ACCEPTANCE_TENANT_ID: acceptanceTenantId,
      WEB_ROOT: resolve("web-dist"),
    });
    await app.listen({ host: "127.0.0.1", port: acceptancePort });
    console.log(`ACCEPTANCE_CONSOLE_READY http://127.0.0.1:${acceptancePort}`);
    await new Promise<void>((done) => {
      process.once("SIGINT", done);
      process.once("SIGTERM", done);
    });
    await app.close();
  }
} finally {
  await killOwnedRedis();
  await stopPostgres();
  await writeFile(join(work, "redis.log"), redisOutput);
  await mkdir(resolve(".runtime"), { recursive: true });
  await writeFile(
    resolve(".runtime/latest-verification.json"),
    JSON.stringify(
      {
        success,
        scope: databaseOnly ? "database-only" : "full-local",
        platform: process.platform,
        runtime: process.version,
        postgres: "16.14",
        redis: windows ? "7.2.16-windows-msys2" : "7.2.16-official-source",
        completedAt: new Date().toISOString(),
        testWorkspace: work,
        linuxCiVerified: false,
        tests: testSummary,
      },
      null,
      2,
    ),
  );
  console.log(`Test processes stopped; evidence retained at ${work}`);
}
