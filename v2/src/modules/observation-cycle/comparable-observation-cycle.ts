import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { observationPlanSchema, type ObservationPlan } from "../observation/observation.js";

export const expansionAuthorizationSchema = z.object({
  id: z.string().uuid(), tenantId: z.string().uuid(), decisionReference: z.string().min(1), status: z.literal("approved"),
  allowedObjectType: z.literal("neutral_category"), maxNewSamples: z.number().int().min(1).max(20),
  maxTotalTokens: z.number().int().positive(), scopeSha256: z.string().regex(/^[0-9a-f]{64}$/), approvedAt: z.string().datetime({ offset: true }),
});
export const comparableSnapshotSchema = z.object({
  id: z.string().uuid(), tenantId: z.string().uuid(), authorizationId: z.string().uuid(), baselinePlanId: z.string().uuid(),
  comparisonPlanId: z.string().uuid(), rulesVersion: z.literal("comparable-observation.v1"), inputSha256: z.string().regex(/^[0-9a-f]{64}$/),
  status: z.enum(["comparable", "not_comparable", "insufficient"]), differences: z.array(z.string()),
  validAnswerCount: z.number().int().nonnegative(), observationPlanCount: z.number().int().nonnegative(), diagnosisId: z.string().uuid().nullable(),
  createdAt: z.string().datetime({ offset: true }),
});
export type ExpansionAuthorization = z.infer<typeof expansionAuthorizationSchema>;
export type ComparableObservationSnapshot = z.infer<typeof comparableSnapshotSchema>;

export function approveExpansion(input: Omit<ExpansionAuthorization, "id" | "status" | "allowedObjectType" | "scopeSha256">): ExpansionAuthorization {
  const scope = { tenantId: input.tenantId, decisionReference: input.decisionReference, maxNewSamples: input.maxNewSamples, maxTotalTokens: input.maxTotalTokens };
  return expansionAuthorizationSchema.parse({ ...input, id: randomUUID(), status: "approved", allowedObjectType: "neutral_category", scopeSha256: createHash("sha256").update(JSON.stringify(scope)).digest("hex") });
}

export function comparePlans(baselineRaw: ObservationPlan, comparisonRaw: ObservationPlan, validAnswerCount: number, diagnosisId: string | null): ComparableObservationSnapshot {
  const baseline = observationPlanSchema.parse(baselineRaw), comparison = observationPlanSchema.parse(comparisonRaw);
  if (baseline.tenantId !== comparison.tenantId) throw new Error("Observation cycles must belong to the same tenant.");
  if (!comparison.authorizationId) throw new Error("Comparison cycle requires an approved expansion authorization.");
  const differences: string[] = [];
  const checks: Array<[string, unknown, unknown]> = [
    ["question_panel", `${baseline.questionPanelId}:${baseline.questionPanelVersion}`, `${comparison.questionPanelId}:${comparison.questionPanelVersion}`],
    ["provider", baseline.provider, comparison.provider], ["model", baseline.model, comparison.model], ["surface", baseline.surface, comparison.surface],
    ["rules_version", baseline.rules.version, comparison.rules.version], ["language", baseline.rules.language, comparison.rules.language],
    ["region", baseline.rules.regionContext, comparison.rules.regionContext], ["temperature", baseline.rules.temperature, comparison.rules.temperature],
    ["max_tokens", baseline.rules.maxTokens, comparison.rules.maxTokens],
  ];
  for (const [name, left, right] of checks) if (left !== right) differences.push(name);
  const status = differences.length ? "not_comparable" : validAnswerCount < 6 ? "insufficient" : "comparable";
  const inputSha256 = createHash("sha256").update(JSON.stringify({ baselineId: baseline.id, comparisonId: comparison.id, differences, validAnswerCount, diagnosisId })).digest("hex");
  return comparableSnapshotSchema.parse({ id: randomUUID(), tenantId: baseline.tenantId, authorizationId: comparison.authorizationId,
    baselinePlanId: baseline.id, comparisonPlanId: comparison.id, rulesVersion: "comparable-observation.v1", inputSha256,
    status, differences, validAnswerCount, observationPlanCount: 2, diagnosisId, createdAt: new Date().toISOString() });
}
