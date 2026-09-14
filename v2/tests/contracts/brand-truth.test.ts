import { describe, expect, it } from "vitest";
import { approveBrandTruth, createBrandTruthDraft } from "../../src/modules/brand-truth/brand-truth.js";

const base = {
  id: "11111111-1111-4111-8111-111111111111",
  tenantId: "22222222-2222-4222-8222-222222222222",
  brandName: "示例旅行社",
  facts: [{ id: "33333333-3333-4333-8333-333333333333", statement: "提供亲子定制行程", category: "service" as const, status: "draft" as const, factLevel: "F0" as const, public: true, source: { type: "human" as const, reference: "企业确认表" } }],
  createdAt: "2026-09-13T00:00:00.000Z",
};

describe("brand truth contract", () => {
  it("creates an unaudited draft", () => expect(createBrandTruthDraft(base)).toMatchObject({ status: "draft", version: 1 }));
  it("requires every fact to be approved", () => expect(() => approveBrandTruth(createBrandTruthDraft(base))).toThrow("Every fact"));
  it("creates a new immutable version on approval", () => {
    const draft = createBrandTruthDraft(base);
    const reviewed = { ...draft, facts: draft.facts.map((fact) => ({ ...fact, status: "approved" as const })) };
    expect(approveBrandTruth(reviewed)).toMatchObject({ status: "approved", version: 2 });
  });
});
