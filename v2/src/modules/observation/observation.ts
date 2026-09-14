import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { questionPanelSchema, type QuestionPanel } from "../question-intelligence/question-intelligence.js";

export const samplingRulesSchema = z.object({
  version: z.literal("deepseek-sampling.v1"), rounds: z.number().int().min(1).max(20), language: z.string().trim().min(2).max(50),
  regionContext: z.string().trim().min(1).max(120), temperature: z.number().min(0).max(2), maxTokens: z.number().int().min(1).max(8192),
  timeoutMs: z.number().int().min(1000).max(120000), maxAttempts: z.number().int().min(1).max(10), maxTotalTokens: z.number().int().positive(),
});
export const observationPlanSchema = z.object({ id: z.string().uuid(), tenantId: z.string().uuid(), questionPanelId: z.string().uuid(),
  questionPanelVersion: z.number().int().positive(), provider: z.literal("deepseek"), model: z.string().min(1).max(200), surface: z.literal("api"),
  rules: samplingRulesSchema, plannedSamples: z.number().int().positive(), createdAt: z.string().datetime({ offset: true }) });
export const observationTargetSchema = z.object({ id: z.string().uuid(), tenantId: z.string().uuid(), planId: z.string().uuid(),
  questionCandidateId: z.string().uuid(), questionText: z.string().trim().min(3).max(500), round: z.number().int().positive(),
  idempotencyKey: z.string().length(64).regex(/^[a-f0-9]+$/), context: z.object({ language: z.string(), regionContext: z.string() }) });
export const observationAttemptSchema = z.object({ id: z.string().uuid(), tenantId: z.string().uuid(), targetId: z.string().uuid(),
  attempt: z.number().int().positive(), status: z.enum(["succeeded", "retryable_failure", "terminal_failure", "budget_stopped"]),
  request: z.record(z.string(), z.unknown()), response: z.unknown(), errorCode: z.string().min(1).max(120).nullable(), httpStatus: z.number().int().nullable(),
  promptTokens: z.number().int().nonnegative(), completionTokens: z.number().int().nonnegative(), totalTokens: z.number().int().nonnegative(),
  startedAt: z.string().datetime({ offset: true }), completedAt: z.string().datetime({ offset: true }) });
export const rawAnswerSchema = z.object({ id: z.string().uuid(), tenantId: z.string().uuid(), targetId: z.string().uuid(), attemptId: z.string().uuid(),
  answerText: z.string().min(1), providerResponseId: z.string().min(1), model: z.string().min(1), surface: z.literal("api"),
  finishReason: z.string().min(1), payloadSha256: z.string().length(64).regex(/^[a-f0-9]+$/), capturedAt: z.string().datetime({ offset: true }) });

export type SamplingRules = z.infer<typeof samplingRulesSchema>; export type ObservationPlan = z.infer<typeof observationPlanSchema>;
export type ObservationTarget = z.infer<typeof observationTargetSchema>; export type ObservationAttempt = z.infer<typeof observationAttemptSchema>;
export type RawAnswer = z.infer<typeof rawAnswerSchema>;
const idFrom = (seed: string) => { const chars = createHash("sha256").update(seed).digest("hex").slice(0, 32).split(""); chars[12]="4";
  chars[16]=((Number.parseInt(chars[16] ?? "0",16)&3)|8).toString(16); return `${chars.slice(0,8).join("")}-${chars.slice(8,12).join("")}-${chars.slice(12,16).join("")}-${chars.slice(16,20).join("")}-${chars.slice(20).join("")}`; };

export function createObservationPlan(input: { id: string; panel: QuestionPanel; rules: SamplingRules; model?: string; createdAt: string }): { plan: ObservationPlan; targets: ObservationTarget[] } {
  const panel = questionPanelSchema.parse(input.panel); const rules = samplingRulesSchema.parse(input.rules);
  if (panel.status !== "approved") throw new Error("Observation requires an approved question panel.");
  const questions = panel.candidates.filter((item) => item.included); if (!questions.length) throw new Error("Approved panel has no included questions.");
  const plan = observationPlanSchema.parse({ id: input.id, tenantId: panel.tenantId, questionPanelId: panel.id, questionPanelVersion: panel.version,
    provider: "deepseek", model: input.model ?? "deepseek-chat", surface: "api", rules, plannedSamples: questions.length * rules.rounds, createdAt: input.createdAt });
  const targets = questions.flatMap((question) => Array.from({ length: rules.rounds }, (_, index) => {
    const round = index + 1; const key = createHash("sha256").update(`${panel.tenantId}:${panel.id}:${panel.version}:${question.id}:${round}:${rules.version}`).digest("hex");
    return observationTargetSchema.parse({ id: idFrom(key), tenantId: panel.tenantId, planId: plan.id, questionCandidateId: question.id,
      questionText: question.text, round, idempotencyKey: key, context: { language: rules.language, regionContext: rules.regionContext } });
  }));
  return { plan, targets };
}
export const newObservationId = () => randomUUID();
