import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { approveBrandTruth, createBrandTruthDraft, type BrandFact } from "../../src/modules/brand-truth/brand-truth.js";
import { approveQuestionPanel, createQuestionPanelDraft, publicBrandTruth, type GeneratedQuestion } from "../../src/modules/question-intelligence/question-intelligence.js";
import { buildQuestionExpansionPrompt } from "../../src/modules/question-intelligence/question-intelligence-service.js";

const tenantId = "22222222-2222-4222-8222-222222222222";
const publicFactId = "33333333-3333-4333-8333-333333333333";
const hiddenFactId = "44444444-4444-4444-8444-444444444444";
const createdAt = "2026-09-14T00:00:00.000Z";
const fact = (overrides: Partial<BrandFact> = {}): BrandFact => ({ id: randomUUID(), statement: "提供亲子定制行程", category: "service",
  status: "approved", factLevel: "F0", public: true, visibility: "public", source: { type: "human", reference: "负责人确认" }, ...overrides });
function approvedTruth() {
  const draft = createBrandTruthDraft({ id: "11111111-1111-4111-8111-111111111111", tenantId, brandName: "品牌甲", createdAt, facts: [
    fact({ id: publicFactId }), fact({ id: hiddenFactId, statement: "内部合同价", public: false, visibility: "restricted" }),
  ].map((item) => ({ ...item, status: "draft" as const })) });
  return approveBrandTruth({ ...draft, facts: draft.facts.map((item) => ({ ...item, status: "approved" as const })) });
}
const generation = { id: "55555555-5555-4555-8555-555555555555", tenantId, panelId: "66666666-6666-4666-8666-666666666666",
  brandAliases: ["甲旅行"], destinations: ["云南"], competitors: ["竞品乙"], seedQuestions: [], requestedTotal: 4,
  promptVersion: "question-expansion.v1" as const, createdAt };
const question = (overrides: Partial<GeneratedQuestion> = {}): GeneratedQuestion => ({ text: "云南亲子旅行如何规划？", journeyStage: "planning",
  objectType: "neutral_category", panelRole: "baseline", intentCluster: "亲子规划", audience: "亲子家庭", scenario: "云南五日游",
  supportingFactIds: [], rationale: "覆盖行程规划", ...overrides });

describe("question intelligence contract", () => {
  it("requires approved truth and exposes only public facts to the prompt", () => {
    const safe = publicBrandTruth(approvedTruth());
    expect(safe.facts.map((item) => item.id)).toEqual([publicFactId]);
    const prompt = buildQuestionExpansionPrompt(generation, approvedTruth());
    expect(prompt).toContain(publicFactId);
    expect(prompt).not.toContain(hiddenFactId);
    expect(prompt).not.toContain("内部合同价");
  });

  it("isolates object types, deduplicates candidates and reports a real mix shortage", () => {
    const panel = createQuestionPanelDraft({ panelId: generation.panelId, generationRunId: generation.id, brandTruth: approvedTruth(), generation,
      forbiddenExpressions: [], createdAt, generated: [
        question(), question({ text: "云南亲子旅行，如何规划？" }),
        question({ text: "品牌甲适合亲子家庭吗？", objectType: "brand_direct", panelRole: "exploration", supportingFactIds: [publicFactId] }),
        question({ text: "竞品乙怎么样？", objectType: "competitor_direct", panelRole: "trigger" }),
      ] });
    expect(panel.candidates[1]).toMatchObject({ included: false, exclusionReason: "duplicate" });
    expect(panel.mix).toMatchObject({ requestedTotal: 4, actualTotal: 3, baseline: { target: 2, actual: 1 } });
    expect(panel.candidates.filter((item) => item.included).map((item) => item.objectType)).toEqual([
      "neutral_category", "brand_direct", "competitor_direct",
    ]);
  });

  it("rejects mislabeled, forbidden and hidden-fact questions from the panel", () => {
    const panel = createQuestionPanelDraft({ panelId: generation.panelId, generationRunId: generation.id, brandTruth: approvedTruth(), generation,
      forbiddenExpressions: ["绝对保证"], createdAt, generated: [
        question({ text: "甲旅行亲子旅行如何规划？" }),
        question({ text: "品牌甲绝对保证满意吗？", objectType: "brand_direct", supportingFactIds: [publicFactId] }),
        question({ text: "品牌甲内部合同价是多少？", objectType: "brand_direct", supportingFactIds: [hiddenFactId] }),
      ] });
    expect(panel.candidates.map((item) => item.exclusionReason)).toEqual(["object_type_mismatch", "forbidden_expression", "hidden_fact"]);
    expect(panel.mix.actualTotal).toBe(0);
  });

  it("blocks competitor questions in brand-and-neutral-only scope", () => {
    const scopedGeneration = { ...generation, questionScope: "brand_and_neutral_only" as const };
    const scopedPrompt = JSON.parse(buildQuestionExpansionPrompt(scopedGeneration, approvedTruth())) as {
      allowedObjectTypes: string[]; targetMix: { baseline: number; exploration: number; trigger: number };
    };
    expect(scopedPrompt.allowedObjectTypes).toEqual(["neutral_category", "brand_direct"]);
    expect(scopedPrompt.targetMix).toEqual({ baseline: 2, exploration: 1, trigger: 1 });
    const panel = createQuestionPanelDraft({ panelId: scopedGeneration.panelId, generationRunId: scopedGeneration.id,
      brandTruth: approvedTruth(), generation: scopedGeneration, forbiddenExpressions: [], createdAt, generated: [
        question({ text: "竞品乙怎么样？", objectType: "competitor_direct", panelRole: "trigger" }),
        question({ text: "品牌甲和竞品乙哪个更适合亲子家庭？", objectType: "brand_vs_competitor", panelRole: "trigger" }),
      ] });
    expect(panel.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: "competitor_direct", included: false, exclusionReason: "object_type_mismatch" }),
      expect.objectContaining({ objectType: "brand_vs_competitor", included: false, exclusionReason: "object_type_mismatch" }),
    ]));
    expect(panel.mix.actualTotal).toBe(0);
  });

  it("creates an immutable approval version and preserves explicit human rejection", () => {
    const panel = createQuestionPanelDraft({ panelId: generation.panelId, generationRunId: generation.id, brandTruth: approvedTruth(), generation,
      forbiddenExpressions: [], createdAt, generated: [question(), question({ text: "品牌甲适合亲子家庭吗？", objectType: "brand_direct",
        panelRole: "exploration", supportingFactIds: [publicFactId] })] });
    const approved = approveQuestionPanel(panel, [panel.candidates[1]!.id], "2026-09-14T01:00:00.000Z");
    expect(approved).toMatchObject({ status: "approved", version: 2, mix: { actualTotal: 1 } });
    expect(approved.candidates[1]).toMatchObject({ included: false, exclusionReason: "manual_rejection" });
  });
});
