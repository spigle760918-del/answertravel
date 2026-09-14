import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createBrandTruthDraft, type BrandFact } from "../../src/modules/brand-truth/brand-truth.js";
import { analyzeBrandTruthQuality, applyQualityDecisions } from "../../src/modules/brand-truth/brand-truth-quality.js";

const tenantId = "22222222-2222-4222-8222-222222222222";
const cardId = "11111111-1111-4111-8111-111111111111";
const createdAt = "2026-09-14T00:00:00.000Z";
const fact = (overrides: Partial<BrandFact> = {}): BrandFact => ({
  id: randomUUID(), statement: "提供适合六至十二岁儿童的亲子定制行程", category: "service", status: "draft",
  factLevel: "F0", public: true, source: { type: "human", reference: "企业确认表" }, ...overrides,
});
const card = (facts: BrandFact[]) => createBrandTruthDraft({ id: cardId, tenantId, brandName: "示例旅行社", facts, createdAt });

describe("brand truth quality contract", () => {
  it("flags different values for the same structured field as a candidate conflict", () => {
    const report = analyzeBrandTruthQuality(card([
      fact({ statement: "最多服务 20 人", category: "product", subject: "亲子研学团", attribute: "人数上限" }),
      fact({ statement: "最多服务 30 人", category: "product", subject: "亲子研学团", attribute: "人数上限" }),
    ]), { id: randomUUID(), createdAt });
    expect(report.issues).toContainEqual(expect.objectContaining({ type: "conflict_candidate", code: "structured_value_conflict", certainty: "candidate" }));
    expect(report.confirmationItems.filter((item) => item.kind === "fact_selection")).toHaveLength(1);
  });

  it("treats punctuation-only wording differences as duplicates rather than proven conflicts", () => {
    const report = analyzeBrandTruthQuality(card([
      fact({ statement: "提供亲子定制行程。" }), fact({ statement: "提供亲子定制行程" }),
    ]), { id: randomUUID(), createdAt });
    expect(report.issues).toContainEqual(expect.objectContaining({ type: "duplicate_candidate", code: "normalized_duplicate" }));
    expect(report.issues.some((issue) => issue.code === "structured_value_conflict")).toBe(false);
  });

  it("reports missing truth without inventing an answer", () => {
    const report = analyzeBrandTruthQuality(card([fact()]), { id: randomUUID(), createdAt });
    const gaps = report.issues.filter((issue) => issue.type === "gap");
    expect(gaps.map((issue) => issue.code)).toEqual(expect.arrayContaining(["missing_category.identity", "missing_category.product", "missing_category.differentiator"]));
    expect(gaps.every((issue) => issue.message.includes("不会生成") || issue.code === "insufficient_detail")).toBe(true);
  });

  it("keeps sensitive information out of the public path pending human confirmation", () => {
    const sensitive = fact({ statement: "内部合同价和手机号仅供员工联系", public: true });
    const report = analyzeBrandTruthQuality(card([sensitive]), { id: randomUUID(), createdAt });
    expect(report.issues).toContainEqual(expect.objectContaining({ code: "sensitive_term_scope", suggestedScope: "restricted" }));
  });

  it("creates a new draft version from human conflict and scope decisions", () => {
    const keep = fact({ statement: "最多服务 20 人", category: "product", subject: "亲子研学团", attribute: "人数上限", public: false });
    const remove = fact({ statement: "最多服务 30 人", category: "product", subject: "亲子研学团", attribute: "人数上限", public: false });
    const report = analyzeBrandTruthQuality(card([keep, remove]), { id: randomUUID(), createdAt });
    const decisions = report.confirmationItems.filter((item) => item.kind !== "truth_input").map((item) => item.kind === "fact_selection"
      ? { confirmationItemId: item.id, selectedFactIds: [keep.id], scopeByFactId: {} }
      : { confirmationItemId: item.id, selectedFactIds: [], scopeByFactId: Object.fromEntries(item.factIds.map((id) => [id, "internal" as const])) });
    const next = applyQualityDecisions(card([keep, remove]), report, decisions, "2026-09-14T01:00:00.000Z");
    expect(next).toMatchObject({ version: 2, status: "draft" });
    expect(next.facts.map((item) => item.id)).toEqual([keep.id]);
    expect(next.facts[0]).toMatchObject({ visibility: "internal", public: false });
  });

  it("refuses to bypass a required human decision", () => {
    const input = card([fact({ public: false })]);
    const report = analyzeBrandTruthQuality(input, { id: randomUUID(), createdAt });
    expect(() => applyQualityDecisions(input, report, [], createdAt)).toThrow("Missing human decision");
  });
});
