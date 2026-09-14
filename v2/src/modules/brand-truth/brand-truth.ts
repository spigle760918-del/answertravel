import { z } from "zod";

export const truthStatusSchema = z.enum(["draft", "approved", "rejected"]);
export const factLevelSchema = z.enum(["F0", "F1"]);
export const visibilityScopeSchema = z.enum(["public", "internal", "restricted", "undetermined"]);

export const brandFactSchema = z.object({
  id: z.string().uuid(),
  statement: z.string().trim().min(1).max(2000),
  category: z.enum(["identity", "product", "service", "differentiator", "restriction"]),
  status: truthStatusSchema,
  factLevel: factLevelSchema,
  public: z.boolean(),
  visibility: visibilityScopeSchema.optional(),
  subject: z.string().trim().min(1).max(200).optional(),
  attribute: z.string().trim().min(1).max(200).optional(),
  source: z.object({ type: z.enum(["human", "official"]), reference: z.string().trim().min(1).max(2000) }),
});

export const brandTruthCardSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  brandName: z.string().trim().min(1).max(200),
  version: z.number().int().positive(),
  status: z.enum(["draft", "approved"]),
  facts: z.array(brandFactSchema).min(1),
  createdAt: z.string().datetime({ offset: true }),
});

export type BrandFact = z.infer<typeof brandFactSchema>;
export type BrandTruthCard = z.infer<typeof brandTruthCardSchema>;

export function createBrandTruthDraft(input: Omit<BrandTruthCard, "status" | "version">): BrandTruthCard {
  const card = brandTruthCardSchema.parse({ ...input, status: "draft", version: 1 });
  if (card.facts.some((fact) => fact.status === "approved")) {
    throw new Error("Draft cannot contain approved facts; approval must create a new version.");
  }
  return card;
}

export function approveBrandTruth(card: BrandTruthCard): BrandTruthCard {
  if (card.status !== "draft") throw new Error("Only draft cards can be approved.");
  if (card.facts.some((fact) => fact.status !== "approved")) throw new Error("Every fact must be approved before card approval.");
  return brandTruthCardSchema.parse({ ...card, status: "approved", version: card.version + 1 });
}
