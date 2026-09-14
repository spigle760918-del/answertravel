import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { brandTruthCardSchema, type BrandTruthCard } from "../brand-truth/brand-truth.js";

export const questionObjectTypeSchema = z.enum(["neutral_category", "brand_direct", "competitor_direct", "brand_vs_competitor"]);
export const journeyStageSchema = z.enum(["inspiration", "comparison", "planning", "booking", "risk_confirmation"]);
export const panelRoleSchema = z.enum(["baseline", "exploration", "trigger"]);

export const generatedQuestionSchema = z.object({
  text: z.string().trim().min(3).max(500),
  journeyStage: journeyStageSchema,
  objectType: questionObjectTypeSchema,
  panelRole: panelRoleSchema,
  intentCluster: z.string().trim().min(1).max(120),
  audience: z.string().trim().min(1).max(120).nullable(),
  scenario: z.string().trim().min(1).max(200).nullable(),
  supportingFactIds: z.array(z.string().uuid()).max(20),
  rationale: z.string().trim().min(1).max(500),
});

export const questionCandidateSchema = generatedQuestionSchema.extend({
  id: z.string().uuid(),
  rawIndex: z.number().int().nonnegative(),
  included: z.boolean(),
  canonicalCandidateId: z.string().uuid(),
  exclusionReason: z.enum(["duplicate", "forbidden_expression", "hidden_fact", "ungrounded_fact", "object_type_mismatch", "role_capacity", "manual_rejection"]).nullable(),
});

export const panelMixSchema = z.object({
  requestedTotal: z.number().int().positive(),
  actualTotal: z.number().int().nonnegative(),
  baseline: z.object({ target: z.number().int().nonnegative(), actual: z.number().int().nonnegative() }),
  exploration: z.object({ target: z.number().int().nonnegative(), actual: z.number().int().nonnegative() }),
  trigger: z.object({ target: z.number().int().nonnegative(), actual: z.number().int().nonnegative() }),
});

export const questionPanelSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  version: z.number().int().positive(),
  status: z.enum(["draft", "approved"]),
  brandTruthCardId: z.string().uuid(),
  brandTruthVersion: z.number().int().positive(),
  generationRunId: z.string().uuid(),
  candidates: z.array(questionCandidateSchema).min(1),
  mix: panelMixSchema,
  createdAt: z.string().datetime({ offset: true }),
});

export const questionGenerationInputSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  panelId: z.string().uuid(),
  brandAliases: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  destinations: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
  competitors: z.array(z.string().trim().min(1).max(200)).max(20),
  questionScope: z.enum(["all_objects", "brand_and_neutral_only"]).optional(),
  seedQuestions: z.array(z.string().trim().min(3).max(500)).max(50).default([]),
  requestedTotal: z.number().int().min(4).max(100),
  promptVersion: z.enum(["question-expansion.v1", "question-expansion.v2"]),
  createdAt: z.string().datetime({ offset: true }),
});

export const questionGenerationResultSchema = z.object({ questions: z.array(generatedQuestionSchema).min(1).max(200) });

export const questionGenerationRunSchema = z.object({
  id: z.string().uuid(), tenantId: z.string().uuid(), brandTruthCardId: z.string().uuid(), brandTruthVersion: z.number().int().positive(),
  status: z.enum(["succeeded", "failed"]), provider: z.literal("deepseek"), model: z.string().trim().min(1).max(200),
  promptVersion: z.enum(["question-expansion.v1", "question-expansion.v2"]), evidenceId: z.string().uuid(), errorCode: z.string().trim().min(1).max(120).nullable(),
  requestedAt: z.string().datetime({ offset: true }), completedAt: z.string().datetime({ offset: true }),
});

export type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>;
export type QuestionCandidate = z.infer<typeof questionCandidateSchema>;
export type QuestionPanel = z.infer<typeof questionPanelSchema>;
export type QuestionGenerationInput = z.infer<typeof questionGenerationInputSchema>;
export type QuestionGenerationRun = z.infer<typeof questionGenerationRunSchema>;

const normalize = (value: string): string => value.toLocaleLowerCase("zh-CN").replace(/[\s，。、“”‘’；：,.!?！？;:()（）\-_/]/g, "");
const grams = (value: string): Set<string> => {
  const normalized = normalize(value);
  const result = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index++) result.add(normalized.slice(index, index + 2));
  if (!result.size && normalized) result.add(normalized);
  return result;
};
const similarity = (left: string, right: string): number => {
  const a = grams(left); const b = grams(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((item) => b.has(item)).length;
  return intersection / (a.size + b.size - intersection);
};
const stableUuid = (seed: string): string => {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "4"; hex[16] = ((Number.parseInt(hex[16] ?? "0", 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
};

export function publicBrandTruth(cardInput: BrandTruthCard): BrandTruthCard {
  const card = brandTruthCardSchema.parse(cardInput);
  if (card.status !== "approved" || card.facts.some((fact) => fact.status !== "approved")) {
    throw new Error("Question generation requires an approved brand truth version.");
  }
  const facts = card.facts.filter((fact) => (fact.visibility ?? (fact.public ? "public" : "undetermined")) === "public");
  if (!facts.length) throw new Error("Question generation requires at least one approved public fact.");
  return { ...card, facts };
}

export function createQuestionPanelDraft(input: {
  panelId: string; generationRunId: string; brandTruth: BrandTruthCard; generated: GeneratedQuestion[];
  generation: QuestionGenerationInput; forbiddenExpressions: string[]; createdAt: string;
}): QuestionPanel {
  const brandTruth = publicBrandTruth(input.brandTruth);
  const generation = questionGenerationInputSchema.parse(input.generation);
  if (generation.tenantId !== brandTruth.tenantId || generation.panelId !== input.panelId) throw new Error("Generation context mismatch.");
  const parsed = input.generated.map((question) => generatedQuestionSchema.parse(question));
  const publicFactIds = new Set(brandTruth.facts.map((fact) => fact.id));
  const hiddenStatements = input.brandTruth.facts.filter((fact) => !publicFactIds.has(fact.id)).map((fact) => normalize(fact.statement)).filter(Boolean);
  const candidates: QuestionCandidate[] = [];
  const roleTargets = {
    baseline: Math.floor(generation.requestedTotal * 0.6),
    exploration: Math.floor(generation.requestedTotal * 0.25),
    trigger: 0,
  };
  roleTargets.trigger = generation.requestedTotal - roleTargets.baseline - roleTargets.exploration;
  const roleCounts = { baseline: 0, exploration: 0, trigger: 0 };
  for (const [rawIndex, question] of parsed.entries()) {
    const id = stableUuid(`${generation.id}:${rawIndex}:${question.text}`);
    let exclusionReason: QuestionCandidate["exclusionReason"] = null;
    let canonicalCandidateId = id;
    const duplicate = candidates.find((candidate) => similarity(candidate.text, question.text) >= 0.86);
    if (duplicate) { exclusionReason = "duplicate"; canonicalCandidateId = duplicate.canonicalCandidateId; }
    if (!exclusionReason && input.forbiddenExpressions.some((term) => term && question.text.includes(term))) exclusionReason = "forbidden_expression";
    if (!exclusionReason && hiddenStatements.some((statement) => statement.length >= 4 && normalize(question.text).includes(statement))) exclusionReason = "hidden_fact";
    if (!exclusionReason && question.supportingFactIds.some((factId) => !publicFactIds.has(factId))) exclusionReason = "ungrounded_fact";
    if (!exclusionReason) {
      if (generation.questionScope === "brand_and_neutral_only" && ["competitor_direct", "brand_vs_competitor"].includes(question.objectType)) exclusionReason = "object_type_mismatch";
    }
    if (!exclusionReason) {
      const containsBrand = [brandTruth.brandName, ...generation.brandAliases].some((name) => question.text.includes(name));
      const containsCompetitor = generation.competitors.some((name) => question.text.includes(name));
      const validObjectType = question.objectType === "neutral_category" ? !containsBrand && !containsCompetitor
        : question.objectType === "brand_direct" ? containsBrand && !containsCompetitor
        : question.objectType === "competitor_direct" ? !containsBrand && containsCompetitor
        : containsBrand && containsCompetitor;
      if (!validObjectType) exclusionReason = "object_type_mismatch";
    }
    if (!exclusionReason && roleCounts[question.panelRole] >= roleTargets[question.panelRole]) exclusionReason = "role_capacity";
    if (!exclusionReason) roleCounts[question.panelRole]++;
    candidates.push(questionCandidateSchema.parse({ ...question, id, rawIndex, included: !exclusionReason, canonicalCandidateId, exclusionReason }));
  }
  return questionPanelSchema.parse({
    id: input.panelId, tenantId: brandTruth.tenantId, version: 1, status: "draft", brandTruthCardId: brandTruth.id,
    brandTruthVersion: brandTruth.version, generationRunId: input.generationRunId, candidates,
    mix: { requestedTotal: generation.requestedTotal, actualTotal: Object.values(roleCounts).reduce((sum, count) => sum + count, 0),
      baseline: { target: roleTargets.baseline, actual: roleCounts.baseline }, exploration: { target: roleTargets.exploration, actual: roleCounts.exploration },
      trigger: { target: roleTargets.trigger, actual: roleCounts.trigger } }, createdAt: input.createdAt,
  });
}

export function approveQuestionPanel(panelInput: QuestionPanel, rejectedCandidateIds: string[], createdAt: string): QuestionPanel {
  const panel = questionPanelSchema.parse(panelInput);
  if (panel.status !== "draft") throw new Error("Only draft question panels can be approved.");
  const allowed = new Set(panel.candidates.map((candidate) => candidate.id));
  if (rejectedCandidateIds.some((id) => !allowed.has(id))) throw new Error("Unknown question candidate rejection.");
  const rejected = new Set(rejectedCandidateIds);
  const candidates = panel.candidates.map((candidate) => rejected.has(candidate.id)
    ? { ...candidate, included: false, exclusionReason: "manual_rejection" as const } : candidate);
  if (!candidates.some((candidate) => candidate.included)) throw new Error("Approved question panel must contain at least one included question.");
  const count = (role: "baseline" | "exploration" | "trigger") => candidates.filter((candidate) => candidate.included && candidate.panelRole === role).length;
  return questionPanelSchema.parse({ ...panel, version: panel.version + 1, status: "approved", candidates, createdAt,
    mix: { ...panel.mix, actualTotal: candidates.filter((candidate) => candidate.included).length,
      baseline: { ...panel.mix.baseline, actual: count("baseline") }, exploration: { ...panel.mix.exploration, actual: count("exploration") },
      trigger: { ...panel.mix.trigger, actual: count("trigger") } } });
}

export const newQuestionGenerationId = (): string => randomUUID();
