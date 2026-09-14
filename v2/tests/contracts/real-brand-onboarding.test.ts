import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildOnboardingPackage, completionGaps, createIntakeSource, redactSensitiveText, completionInputSchema } from "../../src/modules/real-brand-onboarding/real-brand-onboarding.js";

describe("real brand onboarding contracts", () => {
  it("creates a hashed source and keeps facts as drafts", () => {
    const source = createIntakeSource({ tenantId: randomUUID(), sourceType: "file", reference: "server/data.json", capturedAt: new Date().toISOString(), sensitive: false, content: { brand: "test" } });
    const pack = buildOnboardingPackage({ tenantId: source.tenantId, brandName: "测试旅行社", source, facts: [{ statement: "提供云南亲子咨询", category: "service", factLevel: "F0", visibility: "public", confidence: "medium", needsHumanConfirmation: true }], competitors: [{ name: "竞品旅行社", aliases: [], needsHumanConfirmation: true }], seedQuestions:[{text:"云南亲子游怎么规划？",group:"路线规划"}] });
    expect(source.contentSha256).toHaveLength(64);
    expect(pack.facts[0]).toMatchObject({ status: "draft", sourceId: source.id, needsHumanConfirmation: true });
    expect(pack.seedQuestions[0]).toMatchObject({ text:"云南亲子游怎么规划？",sourceId:source.id });
  });
  it("never leaves credential-like text in an intake preview", () => {
    expect(redactSensitiveText("deepseek_api_key=sk-abcdefghijklmnop" )).toContain("[已脱敏]");
  });
  it("identifies missing business truth without inventing it", () => {
    const input = completionInputSchema.parse({ tenantId:randomUUID(),brandName:"北京珈程国际旅行社",officialAliases:["北京珈程"],officialWebsite:"http://www.jiacheng666.com",officialAccounts:[],destinations:["云南"],products:["云南旅游服务"],audiences:["待确认"],exclusions:[],services:["待确认"],differentiators:["待确认"],credentials:[],protections:[],competitors:[{name:"待提供竞品",aliases:[],reason:"待确认"}],publicFacts:[],internalFacts:[],restrictedFacts:[],forbiddenExpressions:[],sourceReference:"用户补充"});
    expect(completionGaps(input)).toEqual(expect.arrayContaining(["缺少可核验资质","尚未确认可公开事实"]));
  });
});
