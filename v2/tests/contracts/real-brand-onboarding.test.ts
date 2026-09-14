import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildOnboardingPackage, createIntakeSource, redactSensitiveText } from "../../src/modules/real-brand-onboarding/real-brand-onboarding.js";

describe("real brand onboarding contracts", () => {
  it("creates a hashed source and keeps facts as drafts", () => {
    const source = createIntakeSource({ tenantId: randomUUID(), sourceType: "file", reference: "server/data.json", capturedAt: new Date().toISOString(), sensitive: false, content: { brand: "test" } });
    const pack = buildOnboardingPackage({ tenantId: source.tenantId, brandName: "测试旅行社", source, facts: [{ statement: "提供云南亲子咨询", category: "service", factLevel: "F0", visibility: "public", confidence: "medium", needsHumanConfirmation: true }], competitors: [{ name: "竞品旅行社", aliases: [], needsHumanConfirmation: true }] });
    expect(source.contentSha256).toHaveLength(64);
    expect(pack.facts[0]).toMatchObject({ status: "draft", sourceId: source.id, needsHumanConfirmation: true });
  });
  it("never leaves credential-like text in an intake preview", () => {
    expect(redactSensitiveText("deepseek_api_key=sk-abcdefghijklmnop" )).toContain("[已脱敏]");
  });
});
