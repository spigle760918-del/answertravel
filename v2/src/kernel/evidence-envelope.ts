import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sha256OfJson } from "./canonical-json.js";
import { FactLevelSchema } from "./fact-level.js";

const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const EvidenceSourceSchema = z.object({
  system: z.string().trim().min(1).max(120),
  reference: z.string().trim().min(1).max(2048),
  capturedAt: IsoDateTimeSchema,
  provider: z.string().trim().min(1).max(120).optional(),
  surface: z.enum(["api", "web", "app", "manual", "internal"]).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  modelVersion: z.string().trim().min(1).max(200).optional()
});

export const EvidenceEnvelopeSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  artifactType: z.string().regex(/^[a-z][a-z0-9_.-]{2,79}$/),
  factLevel: FactLevelSchema,
  schemaVersion: z.number().int().positive(),
  source: EvidenceSourceSchema,
  payload: z.unknown(),
  payloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: IsoDateTimeSchema
}).superRefine((value, context) => {
  try {
    if (sha256OfJson(value.payload) !== value.payloadSha256) {
      context.addIssue({ code: "custom", path: ["payloadSha256"], message: "Payload hash does not match payload." });
    }
  } catch {
    context.addIssue({ code: "custom", path: ["payload"], message: "Payload must contain only acyclic JSON values." });
  }
});

export type EvidenceEnvelope = z.infer<typeof EvidenceEnvelopeSchema>;

export type CreateEvidenceInput = Omit<EvidenceEnvelope, "id" | "payloadSha256" | "createdAt"> & {
  id?: string;
  createdAt?: string;
};

export function createEvidenceEnvelope(input: CreateEvidenceInput): EvidenceEnvelope {
  return EvidenceEnvelopeSchema.parse({
    ...input,
    id: input.id ?? randomUUID(),
    payloadSha256: sha256OfJson(input.payload),
    createdAt: input.createdAt ?? new Date().toISOString()
  });
}
