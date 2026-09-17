import { randomUUID } from "node:crypto";
import { sha256OfJson } from "../../kernel/canonical-json.js";
import { actionProposalSchema, decideGeoGap, deepDiveRecommendationSchema, diagnosisSnapshotSchema } from "./geo-gap-decision.js";
import { GeoGapDecisionRepository } from "./geo-gap-decision-repository.js";

export class GeoGapDecisionService {
  constructor(private readonly repository: GeoGapDecisionRepository) {}
  async evaluate(tenantId: string): Promise<{ diagnosisId: string; idempotent: boolean }> {
    const input = await this.repository.input(tenantId);
    const inputSha256 = sha256OfJson(input);
    const existing = await this.repository.byInputHash(tenantId, inputSha256);
    if (existing) return { diagnosisId: existing.diagnosis.id, idempotent: true };
    const draft = decideGeoGap(input), diagnosisId = randomUUID(), now = new Date().toISOString();
    const strongest = [...input.competitorMentions].sort((a,b) => b.count-a.count)[0] ?? null;
    const evidenceRefs = [...input.geoRunIds.map((id) => `geo-run:${id}`), ...input.planIds.map((id) => `observation-plan:${id}`), ...input.websiteDiagnosisIds.map((id) => `website-diagnosis:${id}`)];
    const diagnosis = diagnosisSnapshotSchema.parse({ id:diagnosisId,tenantId,rulesVersion:"geo-gap-decision.v1",inputSha256,status:"completed",evidenceStatus:draft.evidenceStatus,factLevel:draft.factLevel,
      sampleCount:input.naturalSampleCount,observationPlanCount:input.observationPlanCount,brandMentionCount:input.brandMentionCount,strongestCompetitorId:strongest?.entityId ?? null,strongestCompetitorMentionCount:strongest?.count ?? 0,
      primaryRootCause:draft.rootCause,summary:draft.summary,alternatives:draft.alternatives,missingEvidence:draft.missingEvidence,evidenceRefs,createdAt:now });
    const action = actionProposalSchema.parse({ id:randomUUID(),tenantId,diagnosisId,...draft.action,evidenceRefs,createdAt:now });
    const deepDive = deepDiveRecommendationSchema.parse({ id:randomUUID(),tenantId,diagnosisId,...draft.deepDive,createdAt:now });
    await this.repository.save({ diagnosis, actions:[action], deepDive });
    return { diagnosisId, idempotent: false };
  }
}
