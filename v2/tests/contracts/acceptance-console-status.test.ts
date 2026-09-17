import { describe, expect, it } from "vitest";
import { buildPrimaryAcceptanceLimitation } from "../../src/modules/acceptance-console/acceptance-console.js";

describe("acceptance console status copy", () => {
  it("does not claim that observations are absent after production answers exist", () => {
    expect(buildPrimaryAcceptanceLimitation({
      isRealBrand: true,
      panelStatus: "approved",
      approvedQuestionCount: 20,
      observationPlanCount: 2,
      successfulAnswerCount: 39,
    })).toBe("当前真实品牌问题组已批准，共 20 条；已创建 2 个观察计划并采集 39 条成功回答，失败尝试继续作为不可变证据保留");
  });

  it("keeps the pre-observation limitation when no plan or answer exists", () => {
    expect(buildPrimaryAcceptanceLimitation({
      isRealBrand: true,
      panelStatus: "approved",
      approvedQuestionCount: 20,
      observationPlanCount: 0,
      successfulAnswerCount: 0,
    })).toContain("尚未创建观察计划或采集任何答案");
  });
});
