import { randomUUID } from "node:crypto";
import {
  citationEventSchema,
  citationScanSchema,
  extractCitationCandidates,
  type CitationEvent,
} from "./citation-source.js";
import { CitationSourceRepository } from "./citation-source-repository.js";

export class CitationSourceService {
  constructor(private readonly repository: CitationSourceRepository) {}

  async scanAnswer(
    tenantId: string,
    answerId: string,
  ): Promise<{ eventIds: string[]; idempotent: boolean }> {
    const existing = await this.repository.scanForAnswer(tenantId, answerId);
    if (existing)
      return {
        eventIds: existing.events
          .filter((event) => event.evidenceStatus === "candidate")
          .map((event) => event.id),
        idempotent: true,
      };
    const material = await this.repository.answerMaterial(tenantId, answerId);
    if (!material) throw new Error("Raw answer not found.");
    const extracted = extractCitationCandidates(
      material.answerText,
      material.providerResponse,
    );
    const scanId = randomUUID();
    const now = new Date().toISOString();
    const events: CitationEvent[] = extracted.map((item) =>
      citationEventSchema.parse({
        id: randomUUID(),
        tenantId,
        scanId,
        answerId,
        ...item,
        createdAt: now,
      }),
    );
    await this.repository.createScan(
      citationScanSchema.parse({
        id: scanId,
        tenantId,
        answerId,
        extractorVersion: "citation-extractor.v1",
        status: "completed",
        candidateCount: events.length,
        errorCode: null,
        scannedAt: now,
      }),
      events,
    );
    return {
      eventIds: events
        .filter((event) => event.evidenceStatus === "candidate")
        .map((event) => event.id),
      idempotent: false,
    };
  }
}
