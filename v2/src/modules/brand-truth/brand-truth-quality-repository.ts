import type pg from "pg";
import { createAuditEvent } from "../../kernel/audit-event.js";
import { appendAuditEvent } from "../../platform/audit.js";
import { withTenantTransaction } from "../../platform/database.js";
import { brandTruthQualityReportSchema, type BrandTruthQualityReport } from "./brand-truth-quality.js";

type StoredReport = { id: string; tenant_id: string; card_id: string; card_version: number; rules_version: string; issues: unknown; confirmation_items: unknown; created_at: Date };
const map = (row: StoredReport): BrandTruthQualityReport => brandTruthQualityReportSchema.parse({
  id: row.id, tenantId: row.tenant_id, cardId: row.card_id, cardVersion: row.card_version, rulesVersion: row.rules_version,
  issues: row.issues, confirmationItems: row.confirmation_items, createdAt: row.created_at.toISOString(),
});

export class BrandTruthQualityRepository {
  constructor(private readonly pool: pg.Pool) {}

  async create(reportInput: BrandTruthQualityReport, actorId = "brand-truth-quality.v1"): Promise<BrandTruthQualityReport> {
    const report = brandTruthQualityReportSchema.parse(reportInput);
    return withTenantTransaction(this.pool, report.tenantId, async (client) => {
      const result = await client.query<StoredReport>(
        `insert into brand_truth_quality_reports
          (id, tenant_id, card_id, card_version, rules_version, issues, confirmation_items, created_at)
         values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)
         returning id, tenant_id, card_id, card_version, rules_version, issues, confirmation_items, created_at`,
        [report.id, report.tenantId, report.cardId, report.cardVersion, report.rulesVersion,
          JSON.stringify(report.issues), JSON.stringify(report.confirmationItems), report.createdAt],
      );
      const row = result.rows[0];
      if (!row) throw new Error("Brand truth quality report insert returned no row.");
      await appendAuditEvent(client, createAuditEvent({ tenantId: report.tenantId, actorType: "agent", actorId,
        traceId: report.id, action: "brand_truth.quality_analyzed", resourceType: "brand_truth_quality_report", resourceId: report.id,
        detail: { cardId: report.cardId, cardVersion: report.cardVersion, rulesVersion: report.rulesVersion, issueCount: report.issues.length } }));
      return map(row);
    });
  }

  async findById(tenantId: string, reportId: string): Promise<BrandTruthQualityReport | null> {
    return withTenantTransaction(this.pool, tenantId, async (client) => {
      const result = await client.query<StoredReport>(
        `select id, tenant_id, card_id, card_version, rules_version, issues, confirmation_items, created_at
         from brand_truth_quality_reports where tenant_id=$1 and id=$2`, [tenantId, reportId]);
      return result.rows[0] ? map(result.rows[0]) : null;
    });
  }
}
