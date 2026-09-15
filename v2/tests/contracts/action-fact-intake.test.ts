import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createActionFactIntake } from "../../src/modules/action-fact-intake/action-fact-intake.js";
import { optimizationActionPlanSchema } from "../../src/modules/optimization-action-plan/optimization-action-plan.js";

const tenantId = randomUUID();

function plan(
  key: "website_product_facts" | "product_service_detail" | "license_evidence",
  humanInputs: string[],
  status: "waiting_facts" | "ai_can_prepare" = "waiting_facts",
) {
  const planId = randomUUID();
  const packageId = randomUUID();
  return optimizationActionPlanSchema.parse({
    id: planId,
    tenantId,
    rulesVersion: "optimization-action-plan.v1",
    sourceRoutingSnapshotId: randomUUID(),
    inputSha256: "a".repeat(64),
    status: "completed",
    sourceFindingCount: 21,
    sourceClusterCount: 2,
    packageCount: 1,
    packages: [
      {
        id: packageId,
        tenantId,
        planId,
        key,
        title: "品牌个性化行动",
        factLevel: "F4",
        priority: 1,
        status,
        risk: "medium",
        sourceClusterIds: [randomUUID()],
        sourceFindingIds: Array.from({ length: 21 }, () => randomUUID()),
        businessGoal: "补齐当前品牌真正关心的事实",
        aiPreparation: ["生成个性化采集卡"],
        humanInputs,
        approvalQuestion: null,
        afterHumanInput: "仅形成待审核事实草案",
        dependencies: ["只能使用真实资料"],
        acceptanceCriteria: ["事实可追溯", "不扩写未提供能力"],
        noActionOption: "保留缺口",
        expectedWindow: "资料齐全后1-3天",
      },
    ],
    executionOrder: [packageId],
    createdAt: new Date().toISOString(),
  });
}

describe("brand-configurable action fact intake", () => {
  it("derives the current brand focus from the approved action instead of a fixed industry questionnaire", () => {
    const prompts = ["当前价格有效期", "当前行程版本", "当前服务标准"];
    const intake = createActionFactIntake(
      tenantId,
      plan("website_product_facts", prompts),
      "website_product_facts",
    );
    expect(intake.personalizationMode).toBe("diagnosis_driven");
    expect(intake.focusAreas.map((item) => item.prompt)).toEqual(prompts);
    expect(intake.coreEnvelopeFields).toHaveLength(5);
    expect(intake.responseOptions).toEqual([
      "provide_now",
      "not_applicable",
      "defer",
    ]);
    expect(intake.factDraftAuthorized).toBe(false);
    expect(intake.publicationAuthorized).toBe(false);
  });

  it("changes its focus count and content when another brand action supplies different inputs", () => {
    const prompts = ["家庭适配", "定制边界", "产品矩阵", "小团服务"];
    const intake = createActionFactIntake(
      tenantId,
      plan("product_service_detail", prompts),
      "product_service_detail",
    );
    expect(intake.focusCount).toBe(4);
    expect(intake.missingInputs).toEqual(prompts);
  });

  it("rejects packages that do not require brand facts", () => {
    expect(() =>
      createActionFactIntake(
        tenantId,
        plan("license_evidence", [], "ai_can_prepare"),
        "license_evidence",
      ),
    ).toThrow(/waiting-facts/);
  });
});
