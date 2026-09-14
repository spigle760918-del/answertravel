import type pg from "pg";
import { createAuditEvent } from "../../kernel/audit-event.js";
import { appendAuditEvent } from "../../platform/audit.js";
import { withTenantTransaction } from "../../platform/database.js";
import {
  citationEventSchema,
  citationScanSchema,
  sourceSnapshotSchema,
  type CitationEvent,
  type CitationScan,
  type SourceSnapshot,
} from "./citation-source.js";

export class CitationSourceRepository {
  constructor(private readonly pool: pg.Pool) {}

  async answerMaterial(
    tenantId: string,
    answerId: string,
  ): Promise<{ answerText: string; providerResponse: unknown } | null> {
    return withTenantTransaction(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `select r.answer_text,a.response from raw_answers r
        join observation_attempts a on a.tenant_id=r.tenant_id and a.id=r.attempt_id where r.id=$1`,
        [answerId],
      );
      const row = result.rows[0];
      return row
        ? { answerText: row.answer_text, providerResponse: row.response }
        : null;
    });
  }

  async scanForAnswer(
    tenantId: string,
    answerId: string,
  ): Promise<{ scan: CitationScan; events: CitationEvent[] } | null> {
    return withTenantTransaction(this.pool, tenantId, async (client) => {
      const scanResult = await client.query(
        `select id,tenant_id,answer_id,extractor_version,status,candidate_count,error_code,scanned_at
        from citation_scans where answer_id=$1 and extractor_version='citation-extractor.v1'`,
        [answerId],
      );
      const row = scanResult.rows[0];
      if (!row) return null;
      const eventResult = await client.query(
        `select id,tenant_id,scan_id,answer_id,kind,raw_value,raw_url,canonical_url,domain,evidence_status,created_at
        from citation_events where scan_id=$1 order by created_at,id`,
        [row.id],
      );
      return {
        scan: citationScanSchema.parse({
          id: row.id,
          tenantId: row.tenant_id,
          answerId: row.answer_id,
          extractorVersion: row.extractor_version,
          status: row.status,
          candidateCount: row.candidate_count,
          errorCode: row.error_code,
          scannedAt: row.scanned_at.toISOString(),
        }),
        events: eventResult.rows.map((item) =>
          citationEventSchema.parse({
            id: item.id,
            tenantId: item.tenant_id,
            scanId: item.scan_id,
            answerId: item.answer_id,
            kind: item.kind,
            rawValue: item.raw_value,
            rawUrl: item.raw_url,
            canonicalUrl: item.canonical_url,
            domain: item.domain,
            evidenceStatus: item.evidence_status,
            createdAt: item.created_at.toISOString(),
          }),
        ),
      };
    });
  }

  async createScan(
    scanInput: CitationScan,
    eventInputs: CitationEvent[],
  ): Promise<void> {
    const scan = citationScanSchema.parse(scanInput);
    const events = eventInputs.map((event) => citationEventSchema.parse(event));
    if (
      events.length !== scan.candidateCount ||
      events.some(
        (event) =>
          event.tenantId !== scan.tenantId ||
          event.answerId !== scan.answerId ||
          event.scanId !== scan.id,
      )
    ) {
      throw new Error("Citation events do not match scan.");
    }
    await withTenantTransaction(this.pool, scan.tenantId, async (client) => {
      await client.query(
        `insert into citation_scans(id,tenant_id,answer_id,extractor_version,status,candidate_count,error_code,scanned_at)
        values($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          scan.id,
          scan.tenantId,
          scan.answerId,
          scan.extractorVersion,
          scan.status,
          scan.candidateCount,
          scan.errorCode,
          scan.scannedAt,
        ],
      );
      for (const event of events)
        await client.query(
          `insert into citation_events
        (id,tenant_id,scan_id,answer_id,kind,raw_value,raw_url,canonical_url,domain,evidence_status,created_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            event.id,
            event.tenantId,
            event.scanId,
            event.answerId,
            event.kind,
            event.rawValue,
            event.rawUrl,
            event.canonicalUrl,
            event.domain,
            event.evidenceStatus,
            event.createdAt,
          ],
        );
      await appendAuditEvent(
        client,
        createAuditEvent({
          tenantId: scan.tenantId,
          actorType: "worker",
          actorId: "citation-extractor.v1",
          traceId: scan.answerId,
          action: "citation_scan.completed",
          resourceType: "citation_scan",
          resourceId: scan.id,
          detail: { candidateCount: scan.candidateCount },
        }),
      );
    });
  }

  async event(
    tenantId: string,
    eventId: string,
  ): Promise<CitationEvent | null> {
    return withTenantTransaction(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `select id,tenant_id,scan_id,answer_id,kind,raw_value,raw_url,canonical_url,domain,evidence_status,created_at
        from citation_events where id=$1`,
        [eventId],
      );
      const row = result.rows[0];
      return row
        ? citationEventSchema.parse({
            id: row.id,
            tenantId: row.tenant_id,
            scanId: row.scan_id,
            answerId: row.answer_id,
            kind: row.kind,
            rawValue: row.raw_value,
            rawUrl: row.raw_url,
            canonicalUrl: row.canonical_url,
            domain: row.domain,
            evidenceStatus: row.evidence_status,
            createdAt: row.created_at.toISOString(),
          })
        : null;
    });
  }

  async snapshots(
    tenantId: string,
    eventId: string,
  ): Promise<SourceSnapshot[]> {
    return withTenantTransaction(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `select id,tenant_id,citation_event_id,attempt,canonical_url,status,http_status,redirect_chain,content_type,title,
        author,published_at,text_excerpt,content_sha256,error_code,captured_at from source_snapshots where citation_event_id=$1 order by attempt`,
        [eventId],
      );
      return result.rows.map((row) =>
        sourceSnapshotSchema.parse({
          id: row.id,
          tenantId: row.tenant_id,
          citationEventId: row.citation_event_id,
          attempt: row.attempt,
          canonicalUrl: row.canonical_url,
          status: row.status,
          httpStatus: row.http_status,
          redirectChain: row.redirect_chain,
          contentType: row.content_type,
          title: row.title,
          author: row.author,
          publishedAt: row.published_at,
          textExcerpt: row.text_excerpt,
          contentSha256: row.content_sha256,
          errorCode: row.error_code,
          capturedAt: row.captured_at.toISOString(),
        }),
      );
    });
  }

  async recordSnapshot(snapshotInput: SourceSnapshot): Promise<void> {
    const snapshot = sourceSnapshotSchema.parse(snapshotInput);
    await withTenantTransaction(
      this.pool,
      snapshot.tenantId,
      async (client) => {
        await client.query(
          `insert into source_snapshots(id,tenant_id,citation_event_id,attempt,canonical_url,status,http_status,redirect_chain,content_type,
        title,author,published_at,text_excerpt,content_sha256,error_code,captured_at) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            snapshot.id,
            snapshot.tenantId,
            snapshot.citationEventId,
            snapshot.attempt,
            snapshot.canonicalUrl,
            snapshot.status,
            snapshot.httpStatus,
            JSON.stringify(snapshot.redirectChain),
            snapshot.contentType,
            snapshot.title,
            snapshot.author,
            snapshot.publishedAt,
            snapshot.textExcerpt,
            snapshot.contentSha256,
            snapshot.errorCode,
            snapshot.capturedAt,
          ],
        );
        await appendAuditEvent(
          client,
          createAuditEvent({
            tenantId: snapshot.tenantId,
            actorType: "worker",
            actorId: "source-fetcher.v1",
            traceId: snapshot.citationEventId,
            action: `source_snapshot.${snapshot.status}`,
            resourceType: "source_snapshot",
            resourceId: snapshot.id,
            detail: {
              attempt: snapshot.attempt,
              errorCode: snapshot.errorCode,
              httpStatus: snapshot.httpStatus,
            },
          }),
        );
      },
    );
  }
}
