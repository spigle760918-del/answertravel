import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { JIACHENG_APPROVED_QUESTIONS } from "../../src/modules/question-intelligence/jiacheng-question-snapshot.js";
import { questionPanelSchema } from "../../src/modules/question-intelligence/question-intelligence.js";
import {
  assertProductionBaselineAuthorization,
  createJiachengProductionBaseline,
  JIACHENG_PRODUCTION_AUTHORIZATION,
  JIACHENG_PRODUCTION_BASELINE_CYCLE,
  JIACHENG_PRODUCTION_BASELINE_PLAN_ID,
  JIACHENG_PRODUCTION_TENANT_ID,
} from "../../src/modules/observation/production-baseline.js";

const stableUuid = (seed: string): string => {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16] ?? "0", 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
};

const approvedPanel = () =>
  questionPanelSchema.parse({
    id: stableUuid("jiacheng-panel"),
    tenantId: JIACHENG_PRODUCTION_TENANT_ID,
    version: 2,
    status: "approved",
    brandTruthCardId: stableUuid("jiacheng-truth"),
    brandTruthVersion: 2,
    generationRunId: stableUuid("jiacheng-generation"),
    candidates: JIACHENG_APPROVED_QUESTIONS.map((question, index) => ({
      id: stableUuid(`jiacheng-question-${index}`),
      ...question,
      objectType: question.text.includes("北京珈程国际旅行社")
        ? "brand_direct"
        : "neutral_category",
      rawIndex: index,
      included: true,
      canonicalCandidateId: stableUuid(`jiacheng-question-${index}`),
      exclusionReason: null,
    })),
    mix: {
      requestedTotal: 20,
      actualTotal: 20,
      baseline: { target: 12, actual: 12 },
      exploration: { target: 5, actual: 5 },
      trigger: { target: 3, actual: 3 },
    },
    createdAt: "2026-09-17T00:00:00.000Z",
  });

describe("production observation baseline gate", () => {
  it("builds the fixed 20 by 2 DeepSeek API baseline", () => {
    const result = createJiachengProductionBaseline({
      panel: approvedPanel(),
      createdAt: "2026-09-17T01:00:00.000Z",
    });
    expect(result.plan).toMatchObject({
      id: JIACHENG_PRODUCTION_BASELINE_PLAN_ID,
      tenantId: JIACHENG_PRODUCTION_TENANT_ID,
      cycleKey: JIACHENG_PRODUCTION_BASELINE_CYCLE,
      model: "deepseek-chat",
      surface: "api",
      plannedSamples: 40,
      rules: { rounds: 2, maxTokens: 1000, maxAttempts: 3, maxTotalTokens: 60_000 },
    });
    expect(result.targets).toHaveLength(40);
    expect(new Set(result.targets.map((target) => target.idempotencyKey)).size).toBe(40);
  });

  it("keeps dry-run open but blocks execution without the exact marker", () => {
    expect(() =>
      assertProductionBaselineAuthorization({ execute: false, authorization: undefined }),
    ).not.toThrow();
    expect(() =>
      assertProductionBaselineAuthorization({ execute: true, authorization: "yes" }),
    ).toThrow("exact authorization marker");
    expect(() =>
      assertProductionBaselineAuthorization({
        execute: true,
        authorization: JIACHENG_PRODUCTION_AUTHORIZATION,
      }),
    ).not.toThrow();
  });

  it("stops when the production panel differs from the approved snapshot", () => {
    const changed = approvedPanel();
    changed.candidates[0]!.text = "被静默改写的问题";
    expect(() =>
      createJiachengProductionBaseline({
        panel: changed,
        createdAt: "2026-09-17T01:00:00.000Z",
      }),
    ).toThrow("differs from the approved snapshot");
  });
});
