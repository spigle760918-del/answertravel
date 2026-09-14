import { describe, expect, it } from "vitest";
import { buildBenchmarkFactPack } from "../../src/modules/real-brand-onboarding/benchmark-fact-pack.js";

describe("benchmark fact pack",()=>{
  it("keeps official, licensed, self-reported and uncertain facts separate",()=>{
    const pack=buildBenchmarkFactPack();
    expect(pack.facts.filter(x=>x.accepted)).toHaveLength(11);
    expect(pack.facts.find(x=>x.statement.includes("质量保证金"))).toMatchObject({evidence:"self_reported",accepted:false});
    expect(pack.contradictions).toHaveLength(7);
    expect(pack.facts.find(x=>x.statement.includes("jiacheng666.com"))).toMatchObject({ evidence:"user_provided", accepted:false, visibility:"undetermined" });
  });
  it("blocks exaggerated claims from accepted facts",()=>{
    const pack=buildBenchmarkFactPack();
    for(const phrase of pack.forbiddenExpressions) expect(pack.facts.every(x=>x.accepted? !x.statement.includes(phrase):true)).toBe(true);
  });
});
