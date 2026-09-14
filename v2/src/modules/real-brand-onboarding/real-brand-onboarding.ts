import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

export const intakeSourceSchema = z.object({
  id: z.string().uuid(), tenantId: z.string().uuid(), sourceType: z.enum(["file", "url", "manual"]),
  reference: z.string().trim().min(1).max(2000), contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  capturedAt: z.string().datetime({ offset: true }), sensitive: z.boolean(),
});
export const proposedFactSchema = z.object({
  id: z.string().uuid(), sourceId: z.string().uuid(), statement: z.string().trim().min(1).max(2000),
  category: z.enum(["identity", "product", "service", "differentiator", "restriction"]),
  factLevel: z.enum(["F0", "F1"]), visibility: z.enum(["public", "internal", "restricted", "undetermined"]),
  status: z.literal("draft"), confidence: z.enum(["high", "medium", "low"]), needsHumanConfirmation: z.boolean(),
});
export const proposedCompetitorSchema = z.object({
  id: z.string().uuid(), sourceId: z.string().uuid(), name: z.string().trim().min(1).max(200), aliases: z.array(z.string().trim().min(1).max(200)),
  status: z.literal("draft"), needsHumanConfirmation: z.boolean(),
});
export const onboardingPackageSchema = z.object({
  id: z.string().uuid(), tenantId: z.string().uuid(), brandName: z.string().trim().min(1).max(200),
  sources: z.array(intakeSourceSchema).min(1), facts: z.array(proposedFactSchema), competitors: z.array(proposedCompetitorSchema),
  seedQuestions: z.array(z.object({ text: z.string().trim().min(3).max(500), group: z.string().trim().min(1).max(100), sourceId: z.string().uuid() })),
  conflicts: z.array(z.string().min(1)), gaps: z.array(z.string().min(1)), createdAt: z.string().datetime({ offset: true }),
});
export type IntakeSource = z.infer<typeof intakeSourceSchema>;
export type ProposedFact = z.infer<typeof proposedFactSchema>;
export type ProposedCompetitor = z.infer<typeof proposedCompetitorSchema>;
export type OnboardingPackage = z.infer<typeof onboardingPackageSchema>;

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function createIntakeSource(input: Omit<IntakeSource, "id" | "contentSha256"> & { content: unknown }): IntakeSource {
  return intakeSourceSchema.parse({ ...input, id: randomUUID(), contentSha256: hash(input.content) });
}

export function buildOnboardingPackage(input: {
  tenantId: string; brandName: string; source: IntakeSource; facts: Array<Omit<ProposedFact, "id" | "sourceId" | "status">>;
  competitors: Array<Omit<ProposedCompetitor, "id" | "sourceId" | "status">>; seedQuestions?: Array<{ text: string; group: string }>;
  conflicts?: string[]; gaps?: string[];
}): OnboardingPackage {
  const source = intakeSourceSchema.parse(input.source);
  return onboardingPackageSchema.parse({ id: randomUUID(), tenantId: input.tenantId, brandName: input.brandName,
    sources: [source], facts: input.facts.map((fact) => ({ ...fact, id: randomUUID(), sourceId: source.id, status: "draft" })),
    competitors: input.competitors.map((competitor) => ({ ...competitor, id: randomUUID(), sourceId: source.id, status: "draft" })),
    seedQuestions: (input.seedQuestions ?? []).map((question) => ({ ...question, sourceId: source.id })),
    conflicts: input.conflicts ?? [], gaps: input.gaps ?? [], createdAt: new Date().toISOString() });
}

export function redactSensitiveText(value: string): string {
  return value.replace(/(?:sk|api|key|token)[-_]?[a-z0-9]{12,}/gi, "[已脱敏]");
}

export const completionInputSchema = z.object({
  tenantId: z.string().uuid(), brandName: z.string().trim().min(1).max(200),
  officialAliases: z.array(z.string().trim().min(1).max(200)).default([]),
  officialWebsite: z.string().url().nullable(), officialAccounts: z.array(z.string().trim().min(1).max(500)).default([]),
  destinations: z.array(z.string().trim().min(1).max(200)).min(1), products: z.array(z.string().trim().min(1).max(500)).min(1),
  audiences: z.array(z.string().trim().min(1).max(200)).min(1), exclusions: z.array(z.string().trim().min(1).max(500)).default([]),
  services: z.array(z.string().trim().min(1).max(1000)).min(1), differentiators: z.array(z.string().trim().min(1).max(1000)).min(1),
  credentials: z.array(z.string().trim().min(1).max(1000)).default([]), protections: z.array(z.string().trim().min(1).max(1000)).default([]),
  competitors: z.array(z.object({ name: z.string().trim().min(1).max(200), aliases: z.array(z.string().trim().min(1).max(200)).default([]), reason: z.string().trim().min(1).max(500) })).min(1),
  publicFacts: z.array(z.string().trim().min(1).max(1000)).default([]), internalFacts: z.array(z.string().trim().min(1).max(1000)).default([]), restrictedFacts: z.array(z.string().trim().min(1).max(1000)).default([]), forbiddenExpressions: z.array(z.string().trim().min(1).max(200)).default([]),
  sourceReference: z.string().trim().min(1).max(2000),
});
export type CompletionInput = z.infer<typeof completionInputSchema>;

export function completionGaps(input: CompletionInput): string[] {
  const item = completionInputSchema.parse(input); const gaps: string[] = [];
  if (!item.officialWebsite) gaps.push("正式官网尚未确认");
  if (!item.credentials.length) gaps.push("缺少可核验资质");
  if (!item.protections.length) gaps.push("缺少真实保障或服务边界");
  if (!item.publicFacts.length) gaps.push("尚未确认可公开事实");
  if (!item.forbiddenExpressions.length) gaps.push("尚未确认禁用表达");
  return gaps;
}
