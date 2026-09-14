import type pg from "pg";
import { withTenantTransaction } from "../../platform/database.js";
import { appendAuditEvent } from "../../platform/audit.js";
import { createAuditEvent } from "../../kernel/audit-event.js";
import { brandTruthCardSchema, type BrandTruthCard } from "./brand-truth.js";

type StoredCard = { id: string; tenant_id: string; brand_name: string; version: number; status: "draft" | "approved"; facts: unknown; created_at: Date };
const map = (row: StoredCard): BrandTruthCard => brandTruthCardSchema.parse({
  id: row.id, tenantId: row.tenant_id, brandName: row.brand_name, version: row.version,
  status: row.status, facts: row.facts, createdAt: row.created_at.toISOString()
});

export class BrandTruthRepository {
  constructor(private readonly pool: pg.Pool) {}

  async create(card: BrandTruthCard, actorId = "brand-truth-repository.v1"): Promise<BrandTruthCard> {
    const parsed = brandTruthCardSchema.parse(card);
    return withTenantTransaction(this.pool, parsed.tenantId, async (client) => {
      const result = await client.query<StoredCard>(
        `insert into brand_truth_cards (id, tenant_id, brand_name, version, status, facts, created_at)
         values ($1,$2,$3,$4,$5,$6::jsonb,$7)
         returning id, tenant_id, brand_name, version, status, facts, created_at`,
        [parsed.id, parsed.tenantId, parsed.brandName, parsed.version, parsed.status, JSON.stringify(parsed.facts), parsed.createdAt]
      );
      const row = result.rows[0];
      if (!row) throw new Error("Brand truth card insert returned no row.");
      await appendAuditEvent(client, createAuditEvent({ tenantId: parsed.tenantId, actorType: "user", actorId,
        traceId: parsed.id, action: parsed.status === "approved" ? "brand_truth.approved" : "brand_truth.drafted",
        resourceType: "brand_truth_card", resourceId: parsed.id, detail: { version: parsed.version } }));
      return map(row);
    });
  }

  async latest(tenantId: string, cardId: string): Promise<BrandTruthCard | null> {
    return withTenantTransaction(this.pool, tenantId, async (client) => {
      const result = await client.query<StoredCard>(
        `select id, tenant_id, brand_name, version, status, facts, created_at from brand_truth_cards
         where tenant_id = $1 and id = $2 order by version desc limit 1`, [tenantId, cardId]);
      return result.rows[0] ? map(result.rows[0]) : null;
    });
  }
}
