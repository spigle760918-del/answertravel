import type pg from "pg";
import { EvidenceEnvelopeSchema, type EvidenceEnvelope } from "../../kernel/evidence-envelope.js";
import { withTenantTransaction } from "../../platform/database.js";
import { createAuditEvent, type AuditEvent } from "../../kernel/audit-event.js";
import { appendAuditEvent } from "../../platform/audit.js";
import { canonicalJson } from "../../kernel/canonical-json.js";

type StoredEvidence = {
  id: string;
  tenant_id: string;
  artifact_type: string;
  fact_level: string;
  schema_version: number;
  source: unknown;
  payload: unknown;
  payload_sha256: string;
  created_at: Date;
};

function mapEvidence(row: StoredEvidence): EvidenceEnvelope {
  return EvidenceEnvelopeSchema.parse({
    id: row.id,
    tenantId: row.tenant_id,
    artifactType: row.artifact_type,
    factLevel: row.fact_level,
    schemaVersion: row.schema_version,
    source: row.source,
    payload: row.payload,
    payloadSha256: row.payload_sha256,
    createdAt: row.created_at.toISOString()
  });
}

export class EvidenceRepository {
  constructor(private readonly pool: pg.Pool) {}

  async append(
    envelope: EvidenceEnvelope,
    actor?: Pick<AuditEvent, "actorType" | "actorId" | "traceId">
  ): Promise<EvidenceEnvelope> {
    const parsed = EvidenceEnvelopeSchema.parse(envelope);
    return withTenantTransaction(this.pool, parsed.tenantId, async (client) => {
      const inserted = await client.query<StoredEvidence>(
        `insert into evidence_artifacts
          (id, tenant_id, artifact_type, fact_level, schema_version, source, source_ref, payload, payload_sha256, captured_at, created_at)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, $10, $11)
         on conflict (tenant_id, artifact_type, source_ref, payload_sha256)
         do nothing
         returning id, tenant_id, artifact_type, fact_level, schema_version, source, payload, payload_sha256, created_at`,
        [
          parsed.id,
          parsed.tenantId,
          parsed.artifactType,
          parsed.factLevel,
          parsed.schemaVersion,
          JSON.stringify(parsed.source),
          parsed.source.reference,
          JSON.stringify(parsed.payload),
          parsed.payloadSha256,
          parsed.source.capturedAt,
          parsed.createdAt
        ]
      );
      const existing = inserted.rows[0]
        ? inserted
        : await client.query<StoredEvidence>(
            `select id, tenant_id, artifact_type, fact_level, schema_version, source, payload, payload_sha256, created_at
             from evidence_artifacts
             where tenant_id = $1 and artifact_type = $2 and source_ref = $3 and payload_sha256 = $4`,
            [parsed.tenantId, parsed.artifactType, parsed.source.reference, parsed.payloadSha256]
          );
      const row = existing.rows[0];
      if (!row) throw new Error("Evidence append or idempotent lookup returned no row.");
      if (row.schema_version !== parsed.schemaVersion || row.fact_level !== parsed.factLevel ||
          canonicalJson(row.source) !== canonicalJson(parsed.source)) {
        throw new Error("Evidence identity conflicts with existing collection context.");
      }
      if (inserted.rows[0]) {
        await appendAuditEvent(client, createAuditEvent({
          tenantId: parsed.tenantId,
          actorType: actor?.actorType ?? "system",
          actorId: actor?.actorId ?? "evidence-repository.v1",
          traceId: actor?.traceId ?? parsed.id,
          action: "evidence.appended",
          resourceType: parsed.artifactType,
          resourceId: row.id,
          detail: { payloadSha256: parsed.payloadSha256, schemaVersion: parsed.schemaVersion }
        }));
      }
      return mapEvidence(row);
    });
  }

  async findById(tenantId: string, id: string): Promise<EvidenceEnvelope | null> {
    return withTenantTransaction(this.pool, tenantId, async (client) => {
      const result = await client.query<StoredEvidence>(
        `select id, tenant_id, artifact_type, fact_level, schema_version, source, payload, payload_sha256, created_at
         from evidence_artifacts where id = $1`,
        [id]
      );
      return result.rows[0] ? mapEvidence(result.rows[0]) : null;
    });
  }
}
