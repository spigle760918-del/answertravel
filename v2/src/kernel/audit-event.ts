import { randomUUID } from "node:crypto";
import { z } from "zod";

export const AuditEventSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  actorType: z.enum(["user", "agent", "system", "worker"]),
  actorId: z.string().trim().min(1).max(200),
  action: z.string().regex(/^[a-z][a-z0-9_.-]{2,119}$/),
  resourceType: z.string().regex(/^[a-z][a-z0-9_.-]{2,79}$/),
  resourceId: z.string().trim().min(1).max(200),
  occurredAt: z.string().datetime({ offset: true }),
  traceId: z.string().trim().min(1).max(200),
  detail: z.record(z.string(), z.unknown()).default({})
});

export type AuditEvent = z.infer<typeof AuditEventSchema>;

export function createAuditEvent(input: Omit<AuditEvent, "id" | "occurredAt">): AuditEvent {
  return AuditEventSchema.parse({ ...input, id: randomUUID(), occurredAt: new Date().toISOString() });
}
