import { describe, expect, it } from "vitest";
import { buildBenchmarkFactPack, buildBrandTruthDraftFromBenchmark } from "../../src/modules/real-brand-onboarding/benchmark-fact-pack.js";
import { randomUUID } from "node:crypto";

describe("benchmark fact pack",()=>{
  it("keeps official, licensed, self-reported and uncertain facts separate",()=>{
    const pack=buildBenchmarkFactPack();
    expect(pack.facts.filter(x=>x.accepted)).toHaveLength(12);
    expect(pack.facts.find(x=>x.statement.includes("质量保证金"))).toMatchObject({evidence:"self_reported",accepted:false});
    expect(pack.contradictions).toHaveLength(9);
    expect(pack.facts.find(x=>x.statement.includes("jiacheng666.com"))).toMatchObject({ evidence:"user_provided", accepted:false, visibility:"undetermined" });
  });
  it("blocks exaggerated claims from accepted facts",()=>{
    const pack=buildBenchmarkFactPack();
    for(const phrase of pack.forbiddenExpressions) expect(pack.facts.every(x=>x.accepted? !x.statement.includes(phrase):true)).toBe(true);
  });
  it("creates only a draft from accepted public candidates",()=>{
    const card=buildBrandTruthDraftFromBenchmark({tenantId:randomUUID(),brandName:"北京珈程国际旅行社"});
    expect(card.status).toBe("draft");
    expect(card.facts.length).toBe(12);
    expect(card.facts.every((fact)=>fact.status==="draft"&&fact.public&&fact.visibility==="public")).toBe(true);
    expect(card.facts.some((fact)=>fact.statement.includes("91110112"))).toBe(false);
  });
  it("keeps user-confirmed competitors as monitoring entities only",()=>{
    const pack=buildBenchmarkFactPack();
    expect(pack.competitors.map((item)=>item.name)).toEqual(["北青美途（北京）旅行社","北京途开心文化旅游","泛海国际旅行社"]);
    expect(pack.competitors.every((item)=>item.confirmedForMonitoring)).toBe(true);
    expect(new Set(pack.competitors.map((item)=>item.name)).size).toBe(pack.competitors.length);
  });
});
