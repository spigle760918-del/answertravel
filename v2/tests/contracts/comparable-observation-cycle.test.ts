import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { approveExpansion, comparePlans } from "../../src/modules/observation-cycle/comparable-observation-cycle.js";
import { observationPlanSchema } from "../../src/modules/observation/observation.js";

const tenantId = randomUUID(), panelId = randomUUID(), authorizationId = randomUUID();
const plan = (cycleKey: string, overrides: Record<string, unknown> = {}) => observationPlanSchema.parse({
  id: randomUUID(), tenantId, questionPanelId: panelId, questionPanelVersion: 2, provider:"deepseek", model:"deepseek-chat", surface:"api",
  cycleKey, authorizationId: cycleKey === "baseline" ? null : authorizationId,
  rules:{version:"deepseek-sampling.v1",rounds:1,language:"简体中文",regionContext:"中国大陆测试语境",temperature:0.2,maxTokens:1200,timeoutMs:60000,maxAttempts:3,maxTotalTokens:6000},
  plannedSamples:2,createdAt:new Date().toISOString(),...overrides,
});

describe("comparable observation cycle contracts", () => {
  it("records a narrow human authorization", () => {
    const approved = approveExpansion({ tenantId, decisionReference:"Gate A 2026-09-14", maxNewSamples:2, maxTotalTokens:6000, approvedAt:new Date().toISOString() });
    expect(approved).toMatchObject({ status:"approved", allowedObjectType:"neutral_category", maxNewSamples:2 });
  });
  it("marks matching cycles comparable only after the evidence threshold", () => {
    expect(comparePlans(plan("baseline"), plan("followup"), 6, randomUUID())).toMatchObject({ status:"comparable",differences:[],validAnswerCount:6 });
    expect(comparePlans(plan("baseline"), plan("followup"), 5, null).status).toBe("insufficient");
  });
  it("blocks trend comparison when a critical dimension changes", () => {
    const changed = plan("followup", { model:"another-model" });
    expect(comparePlans(plan("baseline"), changed, 6, null)).toMatchObject({ status:"not_comparable",differences:["model"] });
  });
  it("requires an authorization for the comparison cycle", () => {
    expect(() => comparePlans(plan("baseline"), plan("followup", { authorizationId:null }), 6, null)).toThrow("authorization");
  });
});
