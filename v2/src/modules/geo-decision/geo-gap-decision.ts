import { z } from "zod";

export const rootCauseSchema = z.enum([
  "sampling_insufficient", "brand_truth_gap", "product_service_gap", "website_structure_gap",
  "content_coverage_gap", "external_source_gap", "reputation_risk", "model_volatility",
  "competitor_reason_unclear", "no_action",
]);
export const actionTypeSchema = z.enum([
  "no_action", "expand_sampling", "brand_truth_update", "business_improvement", "website_fix",
  "content_cluster", "source_building", "reputation_response", "competitor_deep_dive",
]);
export const verifiedSignalSchema = z.enum([
  "brand_truth_gap", "product_service_gap", "website_structure_gap", "content_coverage_gap",
  "external_source_gap", "reputation_risk", "model_volatility",
]);

export const gapDecisionInputSchema = z.object({
  tenantId: z.string().uuid(), naturalSampleCount: z.number().int().nonnegative(),
  observationPlanCount: z.number().int().nonnegative(), brandMentionCount: z.number().int().nonnegative(),
  competitorMentions: z.array(z.object({ entityId: z.string().min(1), count: z.number().int().nonnegative() })),
  brandTruthFactCount: z.number().int().nonnegative(), citationCandidateCount: z.number().int().nonnegative(),
  geoRunIds: z.array(z.string().uuid()), planIds: z.array(z.string().uuid()),
  verifiedSignals: z.array(verifiedSignalSchema).default([]), websiteEvidenceConnected: z.boolean(),
});

export const diagnosisSnapshotSchema = z.object({
  id: z.string().uuid(), tenantId: z.string().uuid(), rulesVersion: z.literal("geo-gap-decision.v1"),
  inputSha256: z.string().regex(/^[0-9a-f]{64}$/), status: z.enum(["completed", "failed"]),
  evidenceStatus: z.enum(["sufficient", "insufficient", "not_connected"]), factLevel: z.enum(["F2", "F3"]),
  sampleCount: z.number().int().nonnegative(), observationPlanCount: z.number().int().nonnegative(),
  brandMentionCount: z.number().int().nonnegative(), strongestCompetitorId: z.string().nullable(),
  strongestCompetitorMentionCount: z.number().int().nonnegative(), primaryRootCause: rootCauseSchema,
  summary: z.string().min(1), alternatives: z.array(z.string().min(1)), missingEvidence: z.array(z.string().min(1)),
  evidenceRefs: z.array(z.string().min(1)), createdAt: z.string().datetime({ offset: true }),
});
export const actionProposalSchema = z.object({
  id: z.string().uuid(), tenantId: z.string().uuid(), diagnosisId: z.string().uuid(), actionType: actionTypeSchema,
  factLevel: z.enum(["F3", "F4"]), title: z.string().min(1), rationale: z.string().min(1),
  priority: z.enum(["low", "medium", "high"]), risk: z.enum(["low", "medium", "high"]),
  requiresApproval: z.boolean(), ownerType: z.enum(["ai", "business_owner", "content_owner", "website_owner", "brand_owner"]),
  expectedWindow: z.string().min(1), successMetric: z.string().min(1),
  verificationPlan: z.record(z.string(), z.unknown()), evidenceRefs: z.array(z.string().min(1)),
  createdAt: z.string().datetime({ offset: true }),
});
export const deepDiveRecommendationSchema = z.object({
  id: z.string().uuid(), tenantId: z.string().uuid(), diagnosisId: z.string().uuid(),
  decision: z.enum(["no_trigger", "expand_sample", "recommend_approval"]), factLevel: z.enum(["F3", "F4"]),
  reason: z.string().min(1), proposedSampleBudget: z.number().int().nonnegative(),
  questionThemes: z.array(z.string().min(1)), stopConditions: z.array(z.string().min(1)),
  requiresApproval: z.boolean(), createdAt: z.string().datetime({ offset: true }),
});

export type GapDecisionInput = z.infer<typeof gapDecisionInputSchema>;
export type DiagnosisSnapshot = z.infer<typeof diagnosisSnapshotSchema>;
export type ActionProposal = z.infer<typeof actionProposalSchema>;
export type DeepDiveRecommendation = z.infer<typeof deepDiveRecommendationSchema>;

type DecisionDraft = {
  evidenceStatus: DiagnosisSnapshot["evidenceStatus"]; factLevel: DiagnosisSnapshot["factLevel"];
  rootCause: DiagnosisSnapshot["primaryRootCause"]; summary: string; alternatives: string[]; missingEvidence: string[];
  action: Omit<ActionProposal, "id" | "tenantId" | "diagnosisId" | "createdAt" | "evidenceRefs">;
  deepDive: Omit<DeepDiveRecommendation, "id" | "tenantId" | "diagnosisId" | "createdAt">;
};

const routes: Record<Exclude<DiagnosisSnapshot["primaryRootCause"], "sampling_insufficient" | "competitor_reason_unclear" | "no_action">,
  Pick<DecisionDraft, "summary" | "action">> = {
  brand_truth_gap: { summary: "品牌事实证据存在已验证缺口，应先补齐真相而不是直接写文章。", action: { actionType: "brand_truth_update", factLevel: "F4", title: "补齐并审核品牌事实", rationale: "内容必须建立在已确认、可公开的企业事实之上。", priority: "high", risk: "medium", requiresApproval: true, ownerType: "brand_owner", expectedWindow: "1-3 天", successMetric: "缺失事实形成新审核版本", verificationPlan: { nextStep: "重新运行差距诊断" } } },
  product_service_gap: { summary: "已验证差距属于产品或服务能力，内容不能替代真实业务改进。", action: { actionType: "business_improvement", factLevel: "F4", title: "建立产品服务改进任务", rationale: "禁止用宣传包装尚不存在的优势。", priority: "high", risk: "high", requiresApproval: true, ownerType: "business_owner", expectedWindow: "由业务负责人评估", successMetric: "形成可验证的新服务事实", verificationPlan: { nextStep: "业务完成后更新品牌真相并复测" } } },
  website_structure_gap: { summary: "已验证差距集中在官网结构或可抓取证据，应优先修复页面。", action: { actionType: "website_fix", factLevel: "F4", title: "修复官网证据结构", rationale: "先改善页面事实颗粒度、结构和可抓取性。", priority: "high", risk: "medium", requiresApproval: true, ownerType: "website_owner", expectedWindow: "3-7 天", successMetric: "页面诊断项通过并完成复测", verificationPlan: { nextStep: "同问题组发布前后复测" } } },
  content_coverage_gap: { summary: "已验证存在内容覆盖缺口，可围绕游客决策问题建立内容集群。", action: { actionType: "content_cluster", factLevel: "F4", title: "建立可验证的主题内容集群", rationale: "内容方向由游客问题、品牌事实与证据缺口共同决定。", priority: "medium", risk: "medium", requiresApproval: true, ownerType: "content_owner", expectedWindow: "3-7 天", successMetric: "内容发布后按原问题组复测", verificationPlan: { nextStep: "建立发布前基线和固定复测窗口" } } },
  external_source_gap: { summary: "已验证差距来自外部可信信源，应建设真实可核验的第三方证据。", action: { actionType: "source_building", factLevel: "F4", title: "建设外部可信信源", rationale: "不制造评论或垃圾外链，只使用真实机构、媒体或合作证据。", priority: "medium", risk: "high", requiresApproval: true, ownerType: "brand_owner", expectedWindow: "按合作周期", successMetric: "新增可访问、可核验的外部来源", verificationPlan: { nextStep: "来源上线后重新采样引用证据" } } },
  reputation_risk: { summary: "已验证存在口碑或风险差距，应先解决真实问题并准备公开回应。", action: { actionType: "reputation_response", factLevel: "F4", title: "处理真实服务问题与公开回应", rationale: "先修复服务和事实，再考虑传播内容。", priority: "high", risk: "high", requiresApproval: true, ownerType: "business_owner", expectedWindow: "立即评估", successMetric: "问题有处理证据且公开表达获批", verificationPlan: { nextStep: "风险处理后复测相关问题" } } },
  model_volatility: { summary: "当前差异更可能来自模型波动，暂不建议内容或竞对动作。", action: { actionType: "no_action", factLevel: "F4", title: "继续观察，不立即行动", rationale: "避免对短期模型波动作出过度反应。", priority: "low", risk: "low", requiresApproval: false, ownerType: "ai", expectedWindow: "下一个有效周期", successMetric: "获得稳定的重复采样结果", verificationPlan: { nextStep: "保持同口径复测" } } },
};

export function decideGeoGap(raw: GapDecisionInput): DecisionDraft {
  const input = gapDecisionInputSchema.parse(raw);
  const strongest = [...input.competitorMentions].sort((a, b) => b.count - a.count)[0] ?? null;
  const baseDeepDive = { factLevel: "F4" as const, questionThemes: [] as string[], stopConditions: ["达到预设样本预算", "连续两轮不再产生新根因证据"], requiresApproval: false };
  if (input.naturalSampleCount < 6 || input.observationPlanCount < 2) return {
    evidenceStatus: "insufficient", factLevel: "F2", rootCause: "sampling_insufficient",
    summary: `当前只有 ${input.naturalSampleCount} 条中性有效样本、${input.observationPlanCount} 个观察周期，不足以决定内容或判断竞品优势。`,
    alternatives: ["品牌与竞品都可能只是尚未进入当前样本", "单一时间窗可能受模型随机性影响"],
    missingEvidence: ["至少 6 条同口径中性回答", "至少 2 个可比较观察周期", ...(input.websiteEvidenceConnected ? [] : ["网站诊断证据尚未接入"])],
    action: { actionType: "expand_sampling", factLevel: "F4", title: "先扩充同口径样本", rationale: "证据不足时不生成内容方向，避免把随机波动当成真实差距。", priority: "high", risk: "low", requiresApproval: true, ownerType: "ai", expectedWindow: "下一个采样周期", successMetric: "达到最小样本与周期门禁", verificationPlan: { minimumNaturalSamples: 6, minimumComparablePlans: 2 } },
    deepDive: { ...baseDeepDive, decision: "expand_sample", reason: "先扩充中性主监测样本，暂不启动竞对直问。", proposedSampleBudget: Math.max(0, 6 - input.naturalSampleCount), requiresApproval: true },
  };
  const verified = input.verifiedSignals[0];
  if (verified) {
    const route = routes[verified];
    return { evidenceStatus: "sufficient", factLevel: "F3", rootCause: verified, summary: route.summary,
      alternatives: ["仍需通过执行后复测排除模型波动"], missingEvidence: input.websiteEvidenceConnected ? [] : ["其他网站维度证据尚未接入"], action: route.action,
      deepDive: { ...baseDeepDive, decision: "no_trigger", reason: "已有更直接的已验证根因，当前无需先做竞对直问。", proposedSampleBudget: 0 } };
  }
  const competitorLead = strongest ? strongest.count - input.brandMentionCount : 0;
  if (strongest && competitorLead >= Math.max(2, Math.ceil(input.naturalSampleCount * 0.2))) return {
    evidenceStatus: "sufficient", factLevel: "F3", rootCause: "competitor_reason_unclear",
    summary: "竞品在同口径中性样本中形成可见差距，但现有证据不能解释优势来自产品、内容、网站还是信源。",
    alternatives: ["竞品优势可能来自真实产品服务", "可能来自内容或外部信源", "仍可能存在模型与时间窗波动"],
    missingEvidence: ["竞品适用人群、优缺点与可靠性主张", ...(input.websiteEvidenceConnected ? [] : ["品牌与竞品网站诊断证据尚未接入"])],
    action: { actionType: "competitor_deep_dive", factLevel: "F4", title: "生成隔离的竞对深挖问题组", rationale: "先解释差距再决定写内容、修页面或改业务。", priority: "high", risk: "medium", requiresApproval: true, ownerType: "ai", expectedWindow: "批准后 1 个采样周期", successMetric: "获得足以区分根因的新证据", verificationPlan: { keepSeparateFromNaturalMentionRate: true } },
    deepDive: { ...baseDeepDive, decision: "recommend_approval", reason: "同口径差距达到触发门槛且根因不清。", proposedSampleBudget: 8,
      questionThemes: ["竞品怎么样与靠谱吗", "竞品适合谁与不适合谁", "竞品优缺点", "品牌与竞品对比"] , requiresApproval: true },
  };
  return { evidenceStatus: "sufficient", factLevel: "F3", rootCause: "no_action", summary: "当前没有达到需要内容或竞对深挖的可靠差距门槛。",
    alternatives: ["继续保持同口径监测", "等待网站与更多模型证据接入"], missingEvidence: input.websiteEvidenceConnected ? [] : ["网站诊断证据尚未接入"],
    action: { actionType: "no_action", factLevel: "F4", title: "继续观察", rationale: "没有足够差距时不制造内容任务。", priority: "low", risk: "low", requiresApproval: false, ownerType: "ai", expectedWindow: "下一个有效周期", successMetric: "维持可比较样本并监测变化", verificationPlan: { nextStep: "保持固定问题组复测" } },
    deepDive: { ...baseDeepDive, decision: "no_trigger", reason: "当前差距未达到竞对深挖门槛。", proposedSampleBudget: 0 } };
}
