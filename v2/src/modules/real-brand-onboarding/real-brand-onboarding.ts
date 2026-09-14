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
  competitors: Array<Omit<ProposedCompetitor, "id" | "sourceId" | "status">>; conflicts?: string[]; gaps?: string[];
}): OnboardingPackage {
  const source = intakeSourceSchema.parse(input.source);
  return onboardingPackageSchema.parse({ id: randomUUID(), tenantId: input.tenantId, brandName: input.brandName,
    sources: [source], facts: input.facts.map((fact) => ({ ...fact, id: randomUUID(), sourceId: source.id, status: "draft" })),
    competitors: input.competitors.map((competitor) => ({ ...competitor, id: randomUUID(), sourceId: source.id, status: "draft" })),
    conflicts: input.conflicts ?? [], gaps: input.gaps ?? [], createdAt: new Date().toISOString() });
}

export function redactSensitiveText(value: string): string {
  return value.replace(/(?:sk|api|key|token)[-_]?[a-z0-9]{12,}/gi, "[已脱敏]");
}
