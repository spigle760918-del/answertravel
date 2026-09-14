import { z } from "zod";

export const geoEntitySchema = z.object({
  id: z.string().min(1).max(120), name: z.string().trim().min(1).max(200), aliases: z.array(z.string().trim().min(1).max(200)).max(30),
});
export const geoEntitySetSchema = z.object({
  id: z.string().uuid(), tenantId: z.string().uuid(), version: z.number().int().positive(), status: z.enum(["draft", "approved"]),
  brand: geoEntitySchema, competitors: z.array(geoEntitySchema).max(30), createdAt: z.string().datetime({ offset: true }),
});
export const geoAnalysisRunSchema = z.object({
  id: z.string().uuid(), tenantId: z.string().uuid(), answerId: z.string().uuid(), entitySetId: z.string().uuid(), entitySetVersion: z.number().int().positive(),
  rulesVersion: z.literal("basic-geo.v1"), status: z.enum(["completed", "failed"]), questionObjectType: z.string().min(1).max(120),
  errorCode: z.string().min(1).max(120).nullable(), analyzedAt: z.string().datetime({ offset: true }),
});
export const geoMentionSchema = z.object({
  id: z.string().uuid(), tenantId: z.string().uuid(), runId: z.string().uuid(), answerId: z.string().uuid(), entityId: z.string().min(1),
  entityRole: z.enum(["brand", "competitor"]), matchedAlias: z.string().min(1), startOffset: z.number().int().nonnegative(), endOffset: z.number().int().positive(),
  excerpt: z.string().min(1), certainty: z.enum(["certain", "ambiguous"]), createdAt: z.string().datetime({ offset: true }),
});
export const geoRankingSchema = z.object({
  id: z.string().uuid(), tenantId: z.string().uuid(), runId: z.string().uuid(), entityId: z.string().min(1),
  applicability: z.enum(["applicable", "not_applicable", "uncertain"]), rank: z.number().int().positive().nullable(), reason: z.string().min(1),
  evidenceExcerpt: z.string().min(1).nullable(), createdAt: z.string().datetime({ offset: true }),
}).superRefine((value, context) => {
  if (value.applicability === "applicable" && (!value.rank || !value.evidenceExcerpt)) context.addIssue({ code: "custom", message: "Applicable ranking requires rank and evidence." });
  if (value.applicability !== "applicable" && value.rank) context.addIssue({ code: "custom", message: "Non-applicable ranking cannot have rank." });
});
export const geoClaimSchema = z.object({
  id: z.string().uuid(), tenantId: z.string().uuid(), runId: z.string().uuid(), entityId: z.string().min(1), claimText: z.string().min(1),
  sentiment: z.enum(["positive", "negative", "neutral", "mixed", "uncertain"]), certainty: z.enum(["certain", "uncertain"]),
  evidenceExcerpt: z.string().min(1), createdAt: z.string().datetime({ offset: true }),
});

export type GeoEntitySet = z.infer<typeof geoEntitySetSchema>;
export type GeoAnalysisRun = z.infer<typeof geoAnalysisRunSchema>;
export type GeoMention = z.infer<typeof geoMentionSchema>;
export type GeoRanking = z.infer<typeof geoRankingSchema>;
export type GeoClaim = z.infer<typeof geoClaimSchema>;

const positiveWords = ["推荐", "适合", "专业", "可靠", "优势", "优秀", "贴心", "完善", "值得", "擅长"];
const negativeWords = ["不推荐", "不适合", "风险", "投诉", "不足", "缺点", "较差", "谨慎", "问题", "不可靠"];
const sentences = (text: string) => text.split(/(?<=[。！？!?；;\n])/u).map((item) => item.trim()).filter(Boolean);
const excerptAt = (text: string, start: number, end: number) => text.slice(Math.max(0, start - 45), Math.min(text.length, end + 65)).trim();

export type AnalyzedGeoFacts = { mentions: Omit<GeoMention, "id" | "tenantId" | "runId" | "answerId" | "createdAt">[];
  rankings: Omit<GeoRanking, "id" | "tenantId" | "runId" | "createdAt">[]; claims: Omit<GeoClaim, "id" | "tenantId" | "runId" | "createdAt">[] };

export function analyzeGeoText(answerText: string, entitySet: GeoEntitySet): AnalyzedGeoFacts {
  const entities = [{ ...entitySet.brand, role: "brand" as const }, ...entitySet.competitors.map((item) => ({ ...item, role: "competitor" as const }))];
  const mentions: AnalyzedGeoFacts["mentions"] = [];
  for (const entity of entities) {
    const occupied: Array<[number, number]> = [];
    for (const alias of [...new Set([entity.name, ...entity.aliases])].sort((a, b) => b.length - a.length)) {
      let from = 0;
      for (;;) {
        const index = answerText.indexOf(alias, from); if (index < 0) break; const end = index + alias.length;
        if (!occupied.some(([startOffset, endOffset]) => index < endOffset && end > startOffset)) {
          occupied.push([index, end]); mentions.push({ entityId: entity.id, entityRole: entity.role, matchedAlias: alias, startOffset: index, endOffset: end,
            excerpt: excerptAt(answerText, index, end), certainty: alias.length < 2 ? "ambiguous" : "certain" });
        }
        from = end;
      }
    }
  }
  mentions.sort((a, b) => a.startOffset - b.startOffset);
  const claims: AnalyzedGeoFacts["claims"] = [];
  for (const sentence of sentences(answerText)) for (const entity of entities) {
    if (![entity.name, ...entity.aliases].some((alias) => sentence.includes(alias))) continue;
    const positive = positiveWords.some((word) => sentence.includes(word)); const negative = negativeWords.some((word) => sentence.includes(word));
    const sentiment = positive && negative ? "mixed" : positive ? "positive" : negative ? "negative" : sentence.length < 8 ? "uncertain" : "neutral";
    claims.push({ entityId: entity.id, claimText: sentence, sentiment, certainty: sentiment === "uncertain" ? "uncertain" : "certain", evidenceExcerpt: sentence });
  }
  const orderedLines = answerText.split(/\r?\n/u).map((line) => line.trim()).filter((line) => /^(?:\d+[.、)]|第[一二三四五六七八九十]+|[-*])\s*/u.test(line));
  const rankedEntities: Array<{ entityId: string; line: string }> = [];
  for (const line of orderedLines) for (const entity of entities) if ([entity.name, ...entity.aliases].some((alias) => line.includes(alias)) && !rankedEntities.some((item) => item.entityId === entity.id)) rankedEntities.push({ entityId: entity.id, line });
  const rankingApplicable = rankedEntities.length >= 2 && /推荐|排名|首选|优先/u.test(answerText);
  const rankings = entities.map((entity) => {
    const index = rankedEntities.findIndex((item) => item.entityId === entity.id);
    return rankingApplicable && index >= 0
      ? { entityId: entity.id, applicability: "applicable" as const, rank: index + 1, reason: "回答包含明确推荐语义和有序实体列表", evidenceExcerpt: rankedEntities[index]!.line }
      : { entityId: entity.id, applicability: "not_applicable" as const, rank: null, reason: "回答没有可验证的明确推荐顺序", evidenceExcerpt: null };
  });
  return { mentions, rankings, claims };
}
