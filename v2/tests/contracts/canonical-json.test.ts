import { describe, expect, it } from "vitest";
import { canonicalJson, sha256OfJson } from "../../src/kernel/canonical-json.js";

describe("evidence JSON fidelity", () => {
  it("hashes reordered nested object keys identically while preserving array order", () => {
    expect(sha256OfJson({ z: 2, a: { b: 1, a: "中文" } })).toBe(sha256OfJson({ a: { a: "中文", b: 1 }, z: 2 }));
    expect(sha256OfJson([1, 2])).not.toBe(sha256OfJson([2, 1]));
    expect(canonicalJson({ Z: 1, a: 2 })).toBe('{"Z":1,"a":2}');
  });
  it.each([undefined, NaN, Infinity, BigInt(1), new Date(), { x: undefined }, [undefined], new Array(1)])("rejects values JSON would silently discard or change (case %#)", (value) => {
    expect(() => canonicalJson(value)).toThrow();
  });
  it("rejects cycles but accepts shared JSON objects", () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow("cycles");
    const shared = { x: 1 };
    expect(canonicalJson([shared, shared])).toBe('[{"x":1},{"x":1}]');
  });
});
