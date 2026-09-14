import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { analyzeGeoText, geoEntitySetSchema } from "../../src/modules/geo-intelligence/geo-intelligence.js";

const entitySet = geoEntitySetSchema.parse({ id: randomUUID(), tenantId: randomUUID(), version: 1, status: "approved", createdAt: new Date().toISOString(),
  brand: { id: "brand", name: "远行旅行", aliases: ["远行"] }, competitors: [{ id: "competitor-a", name: "山海旅行", aliases: ["山海"] }] });

describe("basic GEO intelligence rule contract", () => {
  it("finds entity evidence without treating mention count as victory", () => {
    const facts = analyzeGeoText("远行旅行提供亲子服务。山海旅行也提供类似服务。远行值得考虑。", entitySet);
    expect(facts.mentions.filter((item) => item.entityId === "brand")).toHaveLength(2);
    expect(facts.mentions.find((item) => item.entityId === "competitor-a")?.excerpt).toContain("山海旅行");
    expect(facts.rankings.every((item) => item.applicability === "not_applicable")).toBe(true);
  });

  it("only assigns ranks for explicit ordered recommendations", () => {
    const applicable = analyzeGeoText("推荐顺序：\n1. 山海旅行：适合预算家庭\n2. 远行旅行：服务完善", entitySet);
    expect(applicable.rankings).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityId: "competitor-a", applicability: "applicable", rank: 1 }),
      expect.objectContaining({ entityId: "brand", applicability: "applicable", rank: 2 }),
    ]));
    const narrative = analyzeGeoText("远行旅行和山海旅行各有特点，可以分别了解。", entitySet);
    expect(narrative.rankings.every((item) => item.applicability === "not_applicable" && item.rank === null)).toBe(true);
  });

  it("keeps positive and negative claims separate instead of forcing document sentiment", () => {
    const facts = analyzeGeoText("远行旅行服务专业，值得推荐。远行旅行的退改政策存在不足，需谨慎确认。", entitySet);
    expect(facts.claims.filter((item) => item.entityId === "brand").map((item) => item.sentiment)).toEqual(["positive", "negative"]);
  });

  it("returns no invented facts when entities are absent", () => {
    const facts = analyzeGeoText("云南亲子旅行可以安排昆明、大理和丽江。", entitySet);
    expect(facts.mentions).toEqual([]);
    expect(facts.claims).toEqual([]);
    expect(facts.rankings.every((item) => item.applicability === "not_applicable")).toBe(true);
  });
});
