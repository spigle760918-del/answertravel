import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  approveBrandTruth,
  createBrandTruthDraft,
} from "../../src/modules/brand-truth/brand-truth.js";
import { BrandTruthRepository } from "../../src/modules/brand-truth/brand-truth-repository.js";
import { AcceptanceConsoleRepository } from "../../src/modules/acceptance-console/acceptance-console.js";
import { createCitationSourceWorker } from "../../src/modules/citation-source/citation-source-queue.js";
import { CitationSourceRepository } from "../../src/modules/citation-source/citation-source-repository.js";
import { createObservationPlan } from "../../src/modules/observation/observation.js";
import {
  createObservationQueue,
  createObservationWorker,
  enqueueObservation,
  observationJob,
} from "../../src/modules/observation/observation-queue.js";
import { ObservationRepository } from "../../src/modules/observation/observation-repository.js";
import {
  questionGenerationRunSchema,
  questionPanelSchema,
} from "../../src/modules/question-intelligence/question-intelligence.js";
import { QuestionIntelligenceRepository } from "../../src/modules/question-intelligence/question-intelligence-repository.js";
import { createEvidenceEnvelope } from "../../src/kernel/evidence-envelope.js";
import { EvidenceRepository } from "../../src/modules/evidence/evidence-repository.js";
import { withTenantTransaction } from "../../src/platform/database.js";
import { testDatabaseUrl, testRedisUrl } from "../support/environment.js";
const url = testDatabaseUrl(),
  adminUrl = testDatabaseUrl("TEST_ADMIN_DATABASE_URL"),
  redisUrl = testRedisUrl();
const integration = describe.runIf(Boolean(url && adminUrl && redisUrl));
integration("durable DeepSeek observations", () => {
  const pool = new pg.Pool({ connectionString: url });
  const admin = new pg.Pool({ connectionString: adminUrl });
  const tenantId = randomUUID();
  const observations = new ObservationRepository(pool);
  const citations = new CitationSourceRepository(pool);
  let producer: ReturnType<typeof createObservationQueue>;
  let consumer: ReturnType<typeof createObservationWorker>;
  let citationConsumer: ReturnType<typeof createCitationSourceWorker>;
  let calls = 0;
  let targets: any[] = [];
  const fetchImpl = (async () => {
    calls++;
    if (calls === 1)
      return new Response(JSON.stringify({ error: { message: "rate" } }), {
        status: 429,
      });
    return new Response(
      JSON.stringify({
        id: `answer-${calls}`,
        model: "deepseek-chat",
        choices: [
          {
            finish_reason: "stop",
            message: {
              content:
                "这是一次真实结构的测试回答。参考来源：https://example.com/article?utm_source=test",
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  beforeAll(async () => {
    await admin.query(
      "insert into tenants(id,slug,display_name) values($1,$2,$3)",
      [tenantId, `observe-${tenantId.slice(0, 8)}`, "Observation fixture"],
    );
    const truthRepo = new BrandTruthRepository(pool);
    const draft = createBrandTruthDraft({
      id: randomUUID(),
      tenantId,
      brandName: "测试旅行社",
      createdAt: new Date().toISOString(),
      facts: [
        {
          id: randomUUID(),
          statement: "提供云南亲子咨询",
          category: "service",
          status: "draft",
          factLevel: "F0",
          public: true,
          visibility: "public",
          source: { type: "human", reference: "测试" },
        },
      ],
    });
    await truthRepo.create(draft);
    const approved = await truthRepo.create(
      approveBrandTruth({
        ...draft,
        facts: draft.facts.map((x) => ({ ...x, status: "approved" as const })),
      }),
    );
    const evidence = await new EvidenceRepository(pool).append(
      createEvidenceEnvelope({
        tenantId,
        artifactType: "question_generation.test_fixture",
        factLevel: "F1",
        schemaVersion: 1,
        source: {
          system: "test",
          reference: `fixture://${randomUUID()}`,
          capturedAt: new Date().toISOString(),
          surface: "internal",
        },
        payload: { testOnly: true },
      }),
    );
    const qi = new QuestionIntelligenceRepository(pool);
    const run = await qi.createRun(
      questionGenerationRunSchema.parse({
        id: randomUUID(),
        tenantId,
        brandTruthCardId: approved.id,
        brandTruthVersion: approved.version,
        status: "succeeded",
        provider: "deepseek",
        model: "deepseek-chat",
        promptVersion: "question-expansion.v1",
        evidenceId: evidence.id,
        errorCode: null,
        requestedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }),
    );
    const qid = randomUUID(),
      panelId = randomUUID();
    const draftPanel = questionPanelSchema.parse({
      id: panelId,
      tenantId,
      version: 1,
      status: "draft",
      brandTruthCardId: approved.id,
      brandTruthVersion: approved.version,
      generationRunId: run.id,
      createdAt: new Date().toISOString(),
      candidates: [
        {
          id: qid,
          text: "云南亲子游怎么规划？",
          journeyStage: "planning",
          objectType: "neutral_category",
          panelRole: "baseline",
          intentCluster: "规划",
          audience: "亲子",
          scenario: "云南",
          supportingFactIds: [],
          rationale: "测试",
          rawIndex: 0,
          included: true,
          canonicalCandidateId: qid,
          exclusionReason: null,
        },
      ],
      mix: {
        requestedTotal: 1,
        actualTotal: 1,
        baseline: { target: 1, actual: 1 },
        exploration: { target: 0, actual: 0 },
        trigger: { target: 0, actual: 0 },
      },
    });
    await qi.createPanel(draftPanel);
    const panel = await qi.createPanel({
      ...draftPanel,
      version: 2,
      status: "approved",
      createdAt: new Date().toISOString(),
    });
    const made = createObservationPlan({
      id: randomUUID(),
      panel,
      rules: {
        version: "deepseek-sampling.v1",
        rounds: 2,
        language: "简体中文",
        regionContext: "中国大陆",
        temperature: 0.2,
        maxTokens: 1000,
        timeoutMs: 30000,
        maxAttempts: 3,
        maxTotalTokens: 30,
      },
      createdAt: new Date().toISOString(),
    });
    await observations.createPlan(made.plan, made.targets);
    targets = made.targets;
    producer = createObservationQueue(redisUrl!);
    citationConsumer = createCitationSourceWorker(redisUrl!, pool, {
      lookupAddresses: async () => ["93.184.216.34"],
      allowedDomains: ["example.com"],
      fetchImpl: (async () =>
        new Response(
          "<html><head><title>来源文章</title></head><body>可验证正文</body></html>",
          {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          },
        )) as typeof fetch,
    });
    consumer = createObservationWorker(redisUrl!, pool, "test-key", fetchImpl);
    await citationConsumer.worker.waitUntilReady();
    await consumer.worker.waitUntilReady();
  });
  afterAll(async () => {
    await consumer?.close();
    await citationConsumer?.close();
    await producer?.close();
    await pool.end();
    await admin.end();
  });
  it("records retry then one immutable success and idempotent redelivery", async () => {
    const job = await enqueueObservation(
      producer.queue,
      observationJob(targets[0]),
    );
    await vi.waitFor(
      async () => expect(await job.getState()).toBe("completed"),
      { timeout: 15000 },
    );
    const rows = await withTenantTransaction(pool, tenantId, (c) =>
      c.query(
        "select status from observation_attempts where target_id=$1 order by attempt",
        [targets[0].id],
      ),
    );
    expect(rows.rows).toEqual([
      { status: "retryable_failure" },
      { status: "succeeded" },
    ]);
    const answer = await observations.answer(tenantId, targets[0].id);
    expect(answer).not.toBeNull();
    await vi.waitFor(
      async () => {
        const scan = await citations.scanForAnswer(tenantId, answer!.id);
        expect(scan?.scan.candidateCount).toBe(1);
        const snapshots = await citations.snapshots(
          tenantId,
          scan!.events[0]!.id,
        );
        expect(snapshots[0]).toMatchObject({
          status: "succeeded",
          title: "来源文章",
          canonicalUrl: "https://example.com/article",
        });
      },
      { timeout: 10_000 },
    );
    expect(await citations.scanForAnswer(randomUUID(), answer!.id)).toBeNull();
    const overview = await new AcceptanceConsoleRepository(pool).overview(tenantId);
    expect(overview.observations.answers.find((item) => item.id === answer!.id)?.citationEvidence.events[0]?.snapshot).toMatchObject({
      status: "succeeded",
      title: "来源文章",
    });
    const completed = await producer.queue.getJob(job.id!);
    await completed!.remove();
    const replay = await enqueueObservation(
      producer.queue,
      observationJob(targets[0]),
    );
    await vi.waitFor(
      async () => expect(await replay.getState()).toBe("completed"),
      { timeout: 10000 },
    );
    expect(
      (await producer.queue.getJob(replay.id!))!.returnvalue.idempotent,
    ).toBe(true);
    const persistedScan = await citations.scanForAnswer(tenantId, answer!.id);
    expect(persistedScan?.events).toHaveLength(1);
    await expect(
      withTenantTransaction(pool, tenantId, (client) =>
        client.query("update citation_scans set candidate_count=0 where answer_id=$1", [answer!.id]),
      ),
    ).rejects.toThrow("append-only");
  });
  it("stops the next target when cumulative token budget is exhausted", async () => {
    const job = await enqueueObservation(
      producer.queue,
      observationJob(targets[1]),
    );
    await vi.waitFor(async () => expect(await job.getState()).toBe("failed"), {
      timeout: 10000,
    });
    const rows = await withTenantTransaction(pool, tenantId, (c) =>
      c.query("select status from observation_attempts where target_id=$1", [
        targets[1].id,
      ]),
    );
    expect(rows.rows).toEqual([{ status: "budget_stopped" }]);
    expect(calls).toBe(2);
  });
});
