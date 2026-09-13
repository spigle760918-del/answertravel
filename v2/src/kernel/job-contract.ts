import { z } from "zod";

export const JobContractSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_.-]{2,119}$/),
  version: z.number().int().positive(),
  tenantId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(8).max(240),
  requestedAt: z.string().datetime({ offset: true }),
  traceId: z.string().trim().min(1).max(200),
  payload: z.record(z.string(), z.unknown())
});

export type JobContract = z.infer<typeof JobContractSchema>;
