import { createHash } from "node:crypto";
import { z } from "zod";
import { brandTruthCardSchema, visibilityScopeSchema, type BrandFact, type BrandTruthCard } from "./brand-truth.js";

export const qualityIssueTypeSchema = z.enum(["conflict_candidate", "duplicate_candidate", "gap", "scope_review"]);
export const qualityIssueSchema = z.object({
  id: z.string().uuid(),
  type: qualityIssueTypeSchema,
  code: z.string().regex(/^[a-z][a-z0-9_.-]{2,79}$/),
  factIds: z.array(z.string().uuid()),
  certainty: z.enum(["deterministic", "candidate", "undetermined"]),
  message: z.string().trim().min(1).max(1000),
  suggestedScope: visibilityScopeSchema.nullable(),
});

export const qualityConfirmationItemSchema = z.object({
  id: z.string().uuid(),
  issueIds: z.array(z.string().uuid()).min(1),
  kind: z.enum(["fact_selection", "scope_confirmation", "truth_input"]),
  question: z.string().trim().min(1).max(1000),
  factIds: z.array(z.string().uuid()),
});

export const brandTruthQualityReportSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  cardId: z.string().uuid(),
  cardVersion: z.number().int().positive(),
  rulesVersion: z.string().regex(/^brand-truth-quality\.v\d+$/),
  issues: z.array(qualityIssueSchema),
  confirmationItems: z.array(qualityConfirmationItemSchema),
  createdAt: z.string().datetime({ offset: true }),
});

export const qualityRulesSchema = z.object({
  version: z.string().regex(/^brand-truth-quality\.v\d+$/),
  requiredCategories: z.array(z.enum(["identity", "product", "service", "differentiator", "restriction"])),
  minimumDetailLength: z.number().int().min(1).max(200),
  sensitiveTerms: z.array(z.string().trim().min(1).max(100)),
});

export const defaultQualityRules = qualityRulesSchema.parse({
  version: "brand-truth-quality.v1",
  requiredCategories: ["identity", "product", "service", "differentiator"],
  minimumDetailLength: 8,
  sensitiveTerms: ["内部价", "底价", "成本", "身份证", "手机号", "合同价"],
});

export const qualityDecisionSchema = z.object({
  confirmationItemId: z.string().uuid(),
  selectedFactIds: z.array(z.string().uuid()).default([]),
  scopeByFactId: z.record(z.string().uuid(), visibilityScopeSchema).default({}),
});

export type BrandTruthQualityReport = z.infer<typeof brandTruthQualityReportSchema>;
export type QualityRules = z.infer<typeof qualityRulesSchema>;
export type QualityDecision = z.infer<typeof qualityDecisionSchema>;

function stableUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

const normalize = (value: string): string => value.toLocaleLowerCase("zh-CN").replace(/[\s，。、“”‘’；：,.!?！？;:()（）-]/g, "");
const effectiveScope = (fact: BrandFact) => fact.visibility ?? (fact.public ? "public" : "undetermined");

export function analyzeBrandTruthQuality(
  cardInput: BrandTruthCard,
  input: { id: string; createdAt: string; rules?: QualityRules },
): BrandTruthQualityReport {
  const card = brandTruthCardSchema.parse(cardInput);
  const rules = qualityRulesSchema.parse(input.rules ?? defaultQualityRules);
  const reportSeed = `${card.tenantId}:${card.id}:${card.version}:${rules.version}`;
  const issues: z.infer<typeof qualityIssueSchema>[] = [];
  const confirmations: z.infer<typeof qualityConfirmationItemSchema>[] = [];
  const addIssue = (issue: Omit<z.infer<typeof qualityIssueSchema>, "id">) => {
    const id = stableUuid(`${reportSeed}:issue:${issue.code}:${issue.factIds.slice().sort().join(":")}`);
    issues.push({ id, ...issue });
    return id;
  };
  const addConfirmation = (kind: z.infer<typeof qualityConfirmationItemSchema>["kind"], issueIds: string[], factIds: string[], question: string) => {
    confirmations.push({ id: stableUuid(`${reportSeed}:confirmation:${kind}:${issueIds.join(":")}`), issueIds, kind, factIds, question });
  };

  for (let leftIndex = 0; leftIndex < card.facts.length; leftIndex++) {
    const left = card.facts[leftIndex];
    if (!left) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < card.facts.length; rightIndex++) {
      const right = card.facts[rightIndex];
      if (!right || left.category !== right.category) continue;
      const sameStatement = normalize(left.statement) === normalize(right.statement);
      const sameStructuredField = Boolean(left.subject && left.attribute && right.subject && right.attribute
        && normalize(left.subject) === normalize(right.subject) && normalize(left.attribute) === normalize(right.attribute));
      if (sameStructuredField && !sameStatement) {
        const issueId = addIssue({ type: "conflict_candidate", code: "structured_value_conflict", factIds: [left.id, right.id], certainty: "candidate",
          message: `同一主体“${left.subject}”的同一属性“${left.attribute}”存在不同陈述，需要人工确认真实取值。`, suggestedScope: null });
        addConfirmation("fact_selection", [issueId], [left.id, right.id], "请选择应保留的真实事实；若两条都不准确，请补充真实信息。");
      } else if (sameStatement) {
        const scopeConflict = effectiveScope(left) !== effectiveScope(right);
        const issueId = addIssue({ type: scopeConflict ? "conflict_candidate" : "duplicate_candidate",
          code: scopeConflict ? "same_fact_scope_conflict" : "normalized_duplicate", factIds: [left.id, right.id], certainty: "deterministic",
          message: scopeConflict ? "相同事实的公开范围不一致，需要人工确认。" : "两条事实规范化后相同，建议合并但不自动删除。", suggestedScope: null });
        addConfirmation(scopeConflict ? "scope_confirmation" : "fact_selection", [issueId], [left.id, right.id],
          scopeConflict ? "请确认该事实的公开范围。" : "请选择要保留的事实记录。");
      }
    }
  }

  const presentCategories = new Set(card.facts.map((fact) => fact.category));
  for (const category of rules.requiredCategories) {
    if (presentCategories.has(category)) continue;
    const issueId = addIssue({ type: "gap", code: `missing_category.${category}`, factIds: [], certainty: "deterministic",
      message: `缺少“${category}”类别的品牌事实；系统不会生成缺失内容。`, suggestedScope: null });
    addConfirmation("truth_input", [issueId], [], `是否补充“${category}”类别的真实品牌资料？`);
  }

  for (const fact of card.facts) {
    if (normalize(fact.statement).length < rules.minimumDetailLength) {
      const issueId = addIssue({ type: "gap", code: "insufficient_detail", factIds: [fact.id], certainty: "deterministic",
        message: "事实陈述颗粒度不足，需要补充适用对象、边界或可验证细节。", suggestedScope: null });
      addConfirmation("truth_input", [issueId], [fact.id], "是否补充这条事实的真实细节？");
    }
    const sensitive = rules.sensitiveTerms.some((term) => fact.statement.includes(term));
    const currentScope = effectiveScope(fact);
    const suggestedScope = sensitive ? "restricted" : currentScope;
    if (sensitive || currentScope === "undetermined") {
      const issueId = addIssue({ type: "scope_review", code: sensitive ? "sensitive_term_scope" : "scope_undetermined", factIds: [fact.id],
        certainty: sensitive ? "candidate" : "undetermined", message: sensitive
          ? "事实可能包含敏感或内部信息，建议限制公开并由人工确认。" : "该事实的公开范围尚未确定，不得进入公开路径。", suggestedScope });
      addConfirmation("scope_confirmation", [issueId], [fact.id], "请确认这条事实是公开、内部、受限还是暂无法判断。");
    }
  }

  return brandTruthQualityReportSchema.parse({ id: input.id, tenantId: card.tenantId, cardId: card.id, cardVersion: card.version,
    rulesVersion: rules.version, issues, confirmationItems: confirmations, createdAt: input.createdAt });
}

export function applyQualityDecisions(
  cardInput: BrandTruthCard,
  reportInput: BrandTruthQualityReport,
  decisionsInput: QualityDecision[],
  createdAt: string,
): BrandTruthCard {
  const card = brandTruthCardSchema.parse(cardInput);
  const report = brandTruthQualityReportSchema.parse(reportInput);
  if (report.tenantId !== card.tenantId || report.cardId !== card.id || report.cardVersion !== card.version) {
    throw new Error("Quality report does not belong to this brand truth version.");
  }
  const decisions = new Map(decisionsInput.map((input) => {
    const decision = qualityDecisionSchema.parse(input);
    return [decision.confirmationItemId, decision] as const;
  }));
  let facts = card.facts.map((fact) => ({ ...fact }));
  for (const item of report.confirmationItems) {
    if (item.kind === "truth_input") continue;
    const decision = decisions.get(item.id);
    if (!decision) throw new Error(`Missing human decision for confirmation item ${item.id}.`);
    if (item.kind === "fact_selection") {
      if (!decision.selectedFactIds.length || decision.selectedFactIds.some((id) => !item.factIds.includes(id))) {
        throw new Error("Fact selection must keep at least one fact from the confirmation item.");
      }
      const selected = new Set(decision.selectedFactIds);
      facts = facts.filter((fact) => !item.factIds.includes(fact.id) || selected.has(fact.id));
    } else {
      for (const factId of item.factIds) {
        const scope = decision.scopeByFactId[factId];
        if (!scope) throw new Error("Scope confirmation requires a human-selected scope for every related fact.");
        facts = facts.map((fact) => fact.id === factId ? { ...fact, visibility: scope, public: scope === "public" } : fact);
      }
    }
  }
  return brandTruthCardSchema.parse({ ...card, version: card.version + 1, status: "draft", facts, createdAt });
}
