import { createHash } from "node:crypto";

function normalize(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || !value) throw new TypeError("Evidence payload must contain only JSON values.");
  if (ancestors.has(value)) throw new TypeError("Evidence payload must not contain cycles.");
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError("Evidence payload must contain only plain JSON objects.");
  }
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError("JSON symbol keys are forbidden.");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return Array.from({ length: value.length }, (_, index) => normalize(value[index], ancestors));
    }
    return Object.fromEntries(Object.keys(value).sort().map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!("value" in descriptor)) throw new TypeError("JSON getters are forbidden.");
      return [key, normalize(descriptor.value, ancestors)];
    }));
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(normalize(value));
  if (serialized === undefined) throw new TypeError("Evidence payload must be JSON serializable.");
  return serialized;
}

export function sha256OfJson(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
