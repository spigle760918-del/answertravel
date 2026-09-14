import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decideGeoGap, gapDecisionInputSchema } from "../../src/modules/geo-decision/geo-gap-decision.js";

const input = (overrides: Record<string, unknown> = {}) => gapDecisionInputSchema.parse({
  tenantId: randomUUID(), naturalSampleCount: 12, observationPlanCount: 2, brandMentionCount: 3,
  competitorMentions: [{ entityId: "competitor-a", count: 4 }], brandTruthFactCount: 3,
  citationCandidateCount: 0, geoRunIds: Array.from({ length: 12 }, () => randomUUID()),
  planIds: [randomUUID(), randomUUID()], verifiedSignals: [], websiteEvidenceConnected: false, ...overrides,
});

describe("GEO gap decision contract", () => {
  it("blocks content decisions when samples or periods are insufficient", () => {
    const result = decideGeoGap(input({ naturalSampleCount: 4, observationPlanCount: 1, brandMentionCount: 0, competitorMentions: [] }));
    expect(result).toMatchObject({ evidenceStatus: "insufficient", rootCause: "sampling_insufficient" });
    expect(result.action).toMatchObject({ actionType: "expand_sampling", requiresApproval: true });
    expect(result.deepDive).toMatchObject({ decision: "expand_sample" });
  });

  it("recommends isolated competitor deep dive only after a material unexplained lead", () => {
    const result = decideGeoGap(input({ brandMentionCount: 1, competitorMentions: [{ entityId: "competitor-a", count: 7 }] }));
    expect(result.rootCause).toBe("competitor_reason_unclear");
    expect(result.action.actionType).toBe("competitor_deep_dive");
    expect(result.deepDive).toMatchObject({ decision: "recommend_approval", requiresApproval: true, proposedSampleBudget: 8 });
    expect(result.deepDive.questionThemes).toContain("竞品优缺点");
  });

  it("does not manufacture work when the difference is below threshold", () => {
    const result = decideGeoGap(input());
    expect(result.rootCause).toBe("no_action");
    expect(result.action).toMatchObject({ actionType: "no_action", requiresApproval: false });
    expect(result.deepDive.decision).toBe("no_trigger");
  });

  it("routes a verified product gap to business improvement rather than content", () => {
    const result = decideGeoGap(input({ verifiedSignals: ["product_service_gap"] }));
    expect(result.rootCause).toBe("product_service_gap");
    expect(result.action).toMatchObject({ actionType: "business_improvement", ownerType: "business_owner", risk: "high" });
    expect(result.deepDive.decision).toBe("no_trigger");
  });

  it("routes a verified content gap without claiming causal improvement", () => {
    const result = decideGeoGap(input({ verifiedSignals: ["content_coverage_gap"] }));
    expect(result.action.actionType).toBe("content_cluster");
    expect(result.action.rationale).not.toMatch(/保证|必然|一定提升/u);
    expect(result.action.verificationPlan).toHaveProperty("nextStep");
  });
});
