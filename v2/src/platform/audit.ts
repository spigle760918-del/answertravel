import type pg from "pg";
import { AuditEventSchema, type AuditEvent } from "../kernel/audit-event.js";

// The caller owns the tenant transaction so evidence and its audit commit together.
export async function appendAuditEvent(client: pg.PoolClient, event: AuditEvent): Promise<void> {
  const parsed = AuditEventSchema.parse(event);
  await client.query(
    `insert into audit_events
      (id, tenant_id, actor_type, actor_id, action, resource_type, resource_id, trace_id, detail, occurred_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
    [parsed.id, parsed.tenantId, parsed.actorType, parsed.actorId, parsed.action,
      parsed.resourceType, parsed.resourceId, parsed.traceId, JSON.stringify(parsed.detail), parsed.occurredAt]
  );
}
