import { createEvidenceEnvelope } from "../../kernel/evidence-envelope.js";
import type { BrandTruthCard } from "../brand-truth/brand-truth.js";
import { EvidenceRepository } from "../evidence/evidence-repository.js";
import { DeepSeekQuestionError, DeepSeekQuestionGenerator } from "./deepseek-question-generator.js";
import { createQuestionPanelDraft, publicBrandTruth, questionGenerationInputSchema, questionGenerationRunSchema,
  type QuestionGenerationInput, type QuestionPanel } from "./question-intelligence.js";
import { QuestionIntelligenceRepository } from "./question-intelligence-repository.js";

export const QUESTION_EXPANSION_SYSTEM_PROMPT_V1 = `你是文旅行业游客旅前问题设计器。只输出合法 JSON 对象，顶层格式为 {"questions": [...]}。
每个问题必须包含 text、journeyStage、objectType、panelRole、intentCluster、audience、scenario、supportingFactIds、rationale。
不得编造品牌事实、搜索量、热度、评价或产品；品牌相关问题只能使用输入中允许公开的事实 ID。中性问题不得出现品牌或竞品名。
journeyStage 只能是 inspiration/comparison/planning/booking/risk_confirmation；objectType 只能是 neutral_category/brand_direct/competitor_direct/brand_vs_competitor；panelRole 只能是 baseline/exploration/trigger。`;

export const QUESTION_EXPANSION_SYSTEM_PROMPT_V2 = `${QUESTION_EXPANSION_SYSTEM_PROMPT_V1}
必须严格遵守输入中的 requestedTotal、targetMix 和 allowedObjectTypes；不得用近义改写或重复问题凑数量。`;

export function buildQuestionExpansionPrompt(input: QuestionGenerationInput, brandTruthInput: BrandTruthCard): string {
  const generation = questionGenerationInputSchema.parse(input);
  const brandTruth = publicBrandTruth(brandTruthInput);
  const baselineTarget = Math.floor(generation.requestedTotal * 0.6);
  const explorationTarget = Math.floor(generation.requestedTotal * 0.25);
  const triggerTarget = generation.requestedTotal - baselineTarget - explorationTarget;
  return JSON.stringify({ task: "为游客出发前向 AI 提问生成候选问题", requestedTotal: generation.requestedTotal,
    targetMix: { baseline: baselineTarget, exploration: explorationTarget, trigger: triggerTarget }, destinations: generation.destinations,
    roleGuidance: {
      baseline: "适合长期重复监测、游客经常在比较或预订前询问的核心问题",
      exploration: "用于发现新的产品、适用人群、服务边界或决策疑虑",
      trigger: "围绕门票预约、天气交通、临时变更、退款保障等真实风险或事件触发场景",
    },
    brand: { name: brandTruth.brandName, aliases: generation.brandAliases,
      publicFacts: brandTruth.facts.map(({ id, statement, category }) => ({ id, statement, category })) },
    competitors: generation.competitors, seedQuestions: generation.seedQuestions,
    allowedObjectTypes: generation.questionScope === "brand_and_neutral_only" ? ["neutral_category", "brand_direct"] : ["neutral_category", "brand_direct", "competitor_direct", "brand_vs_competitor"],
    requirements: [`恰好生成 ${generation.requestedTotal} 条互不重复的问题`, "严格按照 targetMix 分配 panelRole", "问题必须会影响游客的路线、产品比较、预订、适用性或风险决策", "不要生成注册资本、企业类型、网页是否可访问等游客通常不会单独询问的审计或技术探针", "覆盖旅前五阶段、人群、场景和决策疑虑", "严格遵守 allowedObjectTypes", "中性问题不得出现品牌或竞品名称", "品牌直问必须出现完整品牌名称", "trigger 问题不得把尚未发生的事件写成既定事实", "不要复制问题凑数量", "输出 JSON"] });
}

export class QuestionIntelligenceService {
  constructor(private readonly generator: DeepSeekQuestionGenerator, private readonly evidence: EvidenceRepository,
    private readonly repository: QuestionIntelligenceRepository) {}

  async generateDraft(input: QuestionGenerationInput, brandTruth: BrandTruthCard, forbiddenExpressions: string[]): Promise<QuestionPanel> {
    const generation = questionGenerationInputSchema.parse(input);
    const safeTruth = publicBrandTruth(brandTruth);
    const userPrompt = buildQuestionExpansionPrompt(generation, safeTruth);
    const requestedAt = new Date().toISOString();
    try {
      const systemPrompt = generation.promptVersion === "question-expansion.v2"
        ? QUESTION_EXPANSION_SYSTEM_PROMPT_V2 : QUESTION_EXPANSION_SYSTEM_PROMPT_V1;
      const result = await this.generator.generate(systemPrompt, userPrompt);
      const completedAt = new Date().toISOString();
      const envelope = createEvidenceEnvelope({ tenantId: generation.tenantId, artifactType: "question_generation.deepseek_response",
        factLevel: "F1", schemaVersion: 1, source: { system: "deepseek-chat-completions", reference: `question-generation://${generation.id}`,
          capturedAt: completedAt, provider: "deepseek", surface: "api", model: result.model },
        payload: { promptVersion: generation.promptVersion, request: result.request, exchanges: result.exchanges,
          responseId: result.responseId, model: result.model, usage: result.usage } });
      const savedEvidence = await this.evidence.append(envelope, { actorType: "agent", actorId: "question-intelligence.v1", traceId: generation.id });
      const run = await this.repository.createRun(questionGenerationRunSchema.parse({ id: generation.id, tenantId: generation.tenantId,
        brandTruthCardId: safeTruth.id, brandTruthVersion: safeTruth.version, status: "succeeded", provider: "deepseek", model: result.model,
        promptVersion: generation.promptVersion, evidenceId: savedEvidence.id, errorCode: null, requestedAt, completedAt }));
      const panel = createQuestionPanelDraft({ panelId: generation.panelId, generationRunId: run.id, brandTruth,
        generated: result.questions, generation, forbiddenExpressions, createdAt: completedAt });
      return this.repository.createPanel(panel);
    } catch (error) {
      if (!(error instanceof DeepSeekQuestionError)) throw error;
      const completedAt = new Date().toISOString();
      const envelope = createEvidenceEnvelope({ tenantId: generation.tenantId, artifactType: "question_generation.deepseek_failure",
        factLevel: "F1", schemaVersion: 1, source: { system: "deepseek-chat-completions", reference: `question-generation://${generation.id}`,
          capturedAt: completedAt, provider: "deepseek", surface: "api", model: "deepseek-chat" },
        payload: { promptVersion: generation.promptVersion, request: error.request, exchanges: error.exchanges, errorCode: error.code } });
      const savedEvidence = await this.evidence.append(envelope, { actorType: "agent", actorId: "question-intelligence.v1", traceId: generation.id });
      await this.repository.createRun(questionGenerationRunSchema.parse({ id: generation.id, tenantId: generation.tenantId,
        brandTruthCardId: safeTruth.id, brandTruthVersion: safeTruth.version, status: "failed", provider: "deepseek", model: "deepseek-chat",
        promptVersion: generation.promptVersion, evidenceId: savedEvidence.id, errorCode: error.code, requestedAt, completedAt }));
      throw error;
    }
  }
}
