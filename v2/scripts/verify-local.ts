import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
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
import { approveBrandTruth, createBrandTruthDraft } from "../src/modules/brand-truth/brand-truth.js";
import { BrandTruthRepository } from "../src/modules/brand-truth/brand-truth-repository.js";
import { DeepSeekQuestionGenerator } from "../src/modules/question-intelligence/deepseek-question-generator.js";
import { QuestionIntelligenceRepository } from "../src/modules/question-intelligence/question-intelligence-repository.js";
import { QuestionIntelligenceService } from "../src/modules/question-intelligence/question-intelligence-service.js";
import { withTenantTransaction } from "../src/platform/database.js";
import { createFoundationQueue, enqueueFoundationJob } from "../src/platform/foundation-queue.js";

if (!["win32", "linux"].includes(process.platform) || process.arch !== "x64" || process.versions.node.split(".")[0] !== "24") {
  throw new Error("This isolated harness requires Windows/Linux x64 and Node.js 24.");
}
const windows = process.platform === "win32";
if (!windows && process.getuid?.() === 0) throw new Error("Native Linux tests must run as an unprivileged user.");
const root = resolve(".");
const databaseOnly = process.argv.includes("--database-only");
const deepseekSmoke = process.argv.includes("--deepseek-smoke");
if (deepseekSmoke && !process.env.DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY is required for the explicit real-provider smoke test.");
const redisBinary = resolve(windows ? ".runtime/tools/redis-7.2.16/Redis-7.2.16-Windows-x64-msys2/redis-server.exe" : ".runtime/tools/redis-7.2.16/src/redis-server");
const work = await mkdtemp(join(tmpdir(), "answertravel-v2-test-"));
console.log(`Isolated test workspace: ${work}`);
const native = resolve(dirname(fileURLToPath(import.meta.resolve(windows ? "@embedded-postgres/windows-x64" : "@embedded-postgres/linux-x64"))), "../native");
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
const serviceEnv = { ...process.env, LANG: "C", LC_ALL: "C", PGCLIENTENCODING: "UTF8",
  ...(!windows ? { LD_LIBRARY_PATH: join(nativeAlias, "lib") } : {}) };

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((yes, no) => { server.once("error", no); server.listen(0, "127.0.0.1", yes); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No local TCP port available.");
  await new Promise<void>((yes, no) => server.close((error) => error ? no(error) : yes()));
  return address.port;
}

async function run(executable: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; visible?: boolean } = {}): Promise<void> {
  await new Promise<void>((yes, no) => {
    const child = spawn(executable, args, { cwd: options.cwd ?? root, env: options.env ?? serviceEnv,
      windowsHide: true, stdio: options.visible ? "inherit" : ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout?.on("data", (chunk) => { output += String(chunk); });
    child.stderr?.on("data", (chunk) => { output += String(chunk); });
    const timer = setTimeout(() => { child.kill(); no(new Error(`Test command timed out: ${executable}`)); }, 120_000);
    child.once("error", (error) => { clearTimeout(timer); no(error); });
    child.once("exit", (code) => { clearTimeout(timer); code === 0 ? yes() : no(new Error(`Test command failed (${code}): ${output}`)); });
  });
}

const pgPort = await freePort();
let redisPort = await freePort();
while (redisPort === pgPort) redisPort = await freePort();
const adminBase = `postgresql://answertravel_v2_admin:${password}@127.0.0.1:${pgPort}`;
const adminUrl = `${adminBase}/answertravel_v2_test`;
const redisUrl = `redis://:${password}@127.0.0.1:${redisPort}`;

async function startPostgres(): Promise<void> {
  await run(executable("pg_ctl"), ["-D", activeData, "-l", join(work, "postgres.log"), "-w", "-t", "25",
    "-o", `-p ${pgPort} -h 127.0.0.1 -c shared_buffers=32MB -c max_connections=30${windows ? "" : ` -k ${work}`}`, "start"], { cwd: bin });
  pgStarted = true;
}
async function stopPostgres(): Promise<void> {
  if (!pgStarted) return;
  await run(executable("pg_ctl"), ["-D", activeData, "-m", "fast", "-w", "stop"], { cwd: bin });
  pgStarted = false;
}
async function startRedis(): Promise<void> {
  redisProcess = spawn(redisBinary, ["--bind", "127.0.0.1", "--port", String(redisPort), "--protected-mode", "yes",
    "--requirepass", password, "--dir", ".", "--appendonly", "yes", "--appendfsync", "always", "--save", ""],
  { cwd: redisData, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let startupError: Error | undefined;
  redisProcess.on("error", (error) => { startupError = error; });
  redisProcess.stdout?.on("data", (chunk) => { redisOutput += String(chunk); });
  redisProcess.stderr?.on("data", (chunk) => { redisOutput += String(chunk); });
  const client = new Redis(redisUrl, { lazyConnect: true, retryStrategy: null, connectTimeout: 500 });
  client.on("error", () => {});
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (startupError) throw startupError;
      if (redisProcess.exitCode !== null) throw new Error(`Redis exited: ${redisOutput}`);
      try { await client.connect(); if (await client.ping() === "PONG") return; } catch { client.disconnect(); }
      await delay(250);
    }
    throw new Error(`Redis startup timed out: ${redisOutput}`);
  } finally { client.disconnect(); }
}
async function killOwnedRedis(): Promise<void> {
  if (!redisProcess || redisProcess.exitCode !== null) return;
  const child = redisProcess;
  await new Promise<void>((yes) => { child.once("exit", () => yes()); child.kill("SIGKILL"); });
  redisProcess = undefined;
}

let success = false;
let testSummary: Record<string, unknown> = {};
try {
  await run(executable("initdb"), ["-D", pgData, "-U", "answertravel_v2_admin", `--pwfile=${passwordFile}`,
    "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C"], { cwd: bin });
  await startPostgres();
  const bootstrap = new pg.Client({ connectionString: `${adminBase}/postgres` });
  await bootstrap.connect();
  try { await bootstrap.query("create database answertravel_v2_test"); } finally { await bootstrap.end(); }
  const appUrl = await provisionTestDatabase(adminUrl, password);
  if (!databaseOnly) await startRedis();
  console.log(databaseOnly ? "PostgreSQL 16.14 is ready; Redis checks explicitly excluded." : "PostgreSQL 16.14 and Redis 7.2.16 are ready on isolated loopback ports.");
  const env = { ...serviceEnv, NODE_ENV: "test", REQUIRE_INTEGRATION: "true",
    TEST_ADMIN_DATABASE_URL: adminUrl, TEST_DATABASE_URL: appUrl, TEST_REDIS_URL: redisUrl };
  await run(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "--noEmit"], { env, visible: true });
  const selection = databaseOnly ? ["tests/contracts", "tests/architecture", "tests/integration/database.test.ts", "tests/integration/migrations.test.ts"] : [];
  const resultsPath = join(work, "vitest-results.json");
  await run(process.execPath, [resolve("node_modules/vitest/vitest.mjs"), "run", ...selection,
    "--reporter=default", "--reporter=json", `--outputFile=${resultsPath}`], { env, visible: true });
  const results = JSON.parse(await readFile(resultsPath, "utf8"));
  if (results.numFailedTests || results.numPendingTests || !results.numPassedTests) throw new Error("Verification requires passing tests without skips.");
  testSummary = { passed: results.numPassedTests, failed: results.numFailedTests, skipped: results.numPendingTests, resultsPath };

  if (deepseekSmoke) {
    const smokeTenantId = randomUUID(); const smokeCardId = randomUUID(); const smokeFactId = randomUUID();
    const smokeAdmin = new pg.Pool({ connectionString: adminUrl });
    try { await smokeAdmin.query("insert into tenants(id,slug,display_name) values ($1,$2,$3)",
      [smokeTenantId, `deepseek-smoke-${smokeTenantId.slice(0, 8)}`, "DeepSeek provider test fixture"]); }
    finally { await smokeAdmin.end(); }
    const smokePool = new pg.Pool({ connectionString: appUrl });
    try {
      const truthRepository = new BrandTruthRepository(smokePool);
      const draft = createBrandTruthDraft({ id: smokeCardId, tenantId: smokeTenantId, brandName: "远行测试旅行社", createdAt: new Date().toISOString(), facts: [
        { id: smokeFactId, statement: "测试品牌提供适合六至十二岁儿童的云南亲子行程咨询", category: "service", status: "draft",
          factLevel: "F0", public: true, visibility: "public", source: { type: "human", reference: "明确隔离的测试事实" } },
      ] });
      await truthRepository.create(draft, "deepseek-smoke-test");
      const approved = await truthRepository.create(approveBrandTruth({ ...draft,
        facts: draft.facts.map((fact) => ({ ...fact, status: "approved" as const })) }), "deepseek-smoke-test");
      const service = new QuestionIntelligenceService(new DeepSeekQuestionGenerator({ apiKey: process.env.DEEPSEEK_API_KEY!, timeoutMs: 60_000 }),
        new EvidenceRepository(smokePool), new QuestionIntelligenceRepository(smokePool));
      const panel = await service.generateDraft({ id: randomUUID(), tenantId: smokeTenantId, panelId: randomUUID(), brandAliases: [],
        destinations: ["云南"], competitors: ["同行测试旅行社"], seedQuestions: ["云南亲子旅行怎么规划？"], requestedTotal: 8,
        promptVersion: "question-expansion.v1", createdAt: new Date().toISOString() }, approved, ["绝对保证", "零风险"]);
      if (!panel.candidates.length || !panel.candidates.some((candidate) => candidate.included)) {
        throw new Error("Real DeepSeek response produced no eligible question candidates.");
      }
      const evidenceCount = await withTenantTransaction(smokePool, smokeTenantId, (client) => client.query<{ count: string }>(
        "select count(*)::text as count from evidence_artifacts where artifact_type='question_generation.deepseek_response'"));
      if (evidenceCount.rows[0]?.count !== "1") throw new Error("Real DeepSeek response evidence was not persisted exactly once.");
      console.log(`PASS: Real DeepSeek API generated ${panel.candidates.length} candidates; ${panel.mix.actualTotal} passed deterministic gates. Raw response stored only in the isolated test database.`);
    } finally { await smokePool.end(); }
  }

  const tenantId = randomUUID();
  const admin = new pg.Pool({ connectionString: adminUrl });
  try { await admin.query("insert into tenants(id,slug,display_name) values ($1,$2,$3)", [tenantId, `recovery-${tenantId}`, "Recovery fixture only"]); }
  finally { await admin.end(); }
  const pool = new pg.Pool({ connectionString: appUrl });
  const marker = createEvidenceEnvelope({ tenantId, artifactType: "foundation.recovery", factLevel: "F1", schemaVersion: 1,
    source: { system: "local-recovery-test", reference: `fixture://${randomUUID()}`, capturedAt: new Date().toISOString() },
    payload: { testOnly: true, marker: randomUUID() } });
  try { await new EvidenceRepository(pool).append(marker); } finally { await pool.end(); }
  let jobId = "";
  if (!databaseOnly) {
    const producer = createFoundationQueue(redisUrl);
    try {
      const job = await enqueueFoundationJob(producer.queue, { name: "foundation.probe", version: 1, tenantId,
        idempotencyKey: randomUUID(), requestedAt: new Date().toISOString(), traceId: randomUUID(), payload: { testOnly: true, recovery: true } });
      jobId = job.id!;
    } finally { await producer.close(); }
  }

  // Cold physical backup: stop our cluster, copy to a new directory, start the copy.
  await stopPostgres();
  const restored = join(work, "postgres-restored");
  await cp(pgData, restored, { recursive: true, errorOnExist: true, force: false });
  activeData = restored;
  await startPostgres();
  const restoredPool = new pg.Pool({ connectionString: appUrl });
  try {
    const restoredEvidence = await new EvidenceRepository(restoredPool).findById(tenantId, marker.id);
    if (restoredEvidence?.payloadSha256 !== marker.payloadSha256) throw new Error("Restored evidence hash mismatch.");
    const audits = await withTenantTransaction(restoredPool, tenantId, (client) => client.query("select id from audit_events where resource_id=$1", [marker.id]));
    if (audits.rowCount !== 1) throw new Error("Restored audit record missing.");
  } finally { await restoredPool.end(); }
  console.log("PASS: PostgreSQL cold backup restored evidence and audit with the same hash.");

  // Kill only the child this harness started; AOF is configured to fsync every write.
  if (!databaseOnly) {
    await killOwnedRedis();
    await startRedis();
    const recovered = createFoundationQueue(redisUrl);
    try {
      const job = await recovered.queue.getJob(jobId);
      if (!job || await job.getState() !== "waiting") throw new Error("Queued task lost after Redis process restart.");
    } finally { await recovered.close(); }
    console.log("PASS: Redis AOF recovered the pending task after process termination.");
  }
  success = true;
} finally {
  await killOwnedRedis();
  await stopPostgres();
  await writeFile(join(work, "redis.log"), redisOutput);
  await mkdir(resolve(".runtime"), { recursive: true });
  await writeFile(resolve(".runtime/latest-verification.json"), JSON.stringify({
    success, scope: databaseOnly ? "database-only" : "full-local", platform: process.platform,
    runtime: process.version, postgres: "16.14", redis: windows ? "7.2.16-windows-msys2" : "7.2.16-official-source",
    completedAt: new Date().toISOString(), testWorkspace: work, linuxCiVerified: false, tests: testSummary
  }, null, 2));
  console.log(`Test processes stopped; evidence retained at ${work}`);
}
