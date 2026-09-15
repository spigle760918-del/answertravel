import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  optimizationActionPlanSchema,
  type OptimizationActionPlan,
} from "../optimization-action-plan/optimization-action-plan.js";

export const actionFactFocusAreaSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  prompt: z.string().min(1),
  businessReason: z.string().min(1),
  requestedInputs: z.array(z.string().min(1)).min(1),
  acceptableEvidence: z.array(z.string().min(1)).min(1),
  required: z.literal(true),
});

export const actionFactIntakeSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  rulesVersion: z.literal("action-fact-intake.v1"),
  actionPlanId: z.string().uuid(),
  actionPackageId: z.string().uuid(),
  actionPackageKey: z.string().min(1),
  actionPackageTitle: z.string().min(1),
  inputSha256: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.literal("waiting_facts"),
  factLevel: z.literal("F4"),
  personalizationMode: z.literal("diagnosis_driven"),
  sourceFindingCount: z.number().int().positive(),
  coreEnvelopeFields: z.array(z.string().min(1)).length(5),
  focusCount: z.number().int().positive(),
  focusAreas: z.array(actionFactFocusAreaSchema).min(1),
  responseOptions: z
    .array(z.enum(["provide_now", "not_applicable", "defer"]))
    .length(3),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  completenessRules: z.array(z.string().min(1)).min(1),
  missingInputs: z.array(z.string().min(1)).min(1),
  factDraftAuthorized: z.literal(false),
  publicationAuthorized: z.literal(false),
  createdAt: z.string().datetime({ offset: true }),
});

export type ActionFactIntake = z.infer<typeof actionFactIntakeSchema>;

const coreEnvelopeFields = [
  "事实值或明确标记不适用/稍后增补",
  "适用产品、人群、渠道或订单范围",
  "生效时间、有效期或最后更新时间",
  "原始依据材料或可追溯来源",
  "公开、内部或受限范围",
] as const;

export function createActionFactIntake(
  tenantId: string,
  rawPlan: OptimizationActionPlan,
  actionPackageKey: string,
  createdAt = new Date().toISOString(),
): ActionFactIntake {
  const plan = optimizationActionPlanSchema.parse(rawPlan);
  if (plan.tenantId !== tenantId)
    throw new Error("Action fact intake tenant mismatch.");
  const action = plan.packages.find((item) => item.key === actionPackageKey);
  if (!action)
    throw new Error(`Action package ${actionPackageKey} is missing.`);
  if (action.status !== "waiting_facts")
    throw new Error("Action fact intake requires a waiting-facts package.");
  if (!action.humanInputs.length)
    throw new Error("Action fact intake requires brand-specific human inputs.");

  const focusAreas = action.humanInputs.map((prompt, index) =>
    actionFactFocusAreaSchema.parse({
      key: `focus_${index + 1}`,
      label: `品牌关注主题 ${index + 1}`,
      prompt,
      businessReason: action.businessGoal,
      requestedInputs: [prompt],
      acceptableEvidence: [
        "品牌当前有效资料",
        "与该主题直接相关的合同、产品单、价格表、行程单或内部批准文件",
      ],
      required: true,
    }),
  );
  const inputSha256 = createHash("sha256")
    .update(
      JSON.stringify({
        rulesVersion: "action-fact-intake.v1",
        planId: plan.id,
        actionPackageId: action.id,
        actionPackageKey: action.key,
        sourceFindingIds: [...action.sourceFindingIds].sort(),
        humanInputs: action.humanInputs,
        acceptanceCriteria: action.acceptanceCriteria,
        coreEnvelopeFields,
      }),
    )
    .digest("hex");

  return actionFactIntakeSchema.parse({
    id: randomUUID(),
    tenantId,
    rulesVersion: "action-fact-intake.v1",
    actionPlanId: plan.id,
    actionPackageId: action.id,
    actionPackageKey: action.key,
    actionPackageTitle: action.title,
    inputSha256,
    status: "waiting_facts",
    factLevel: "F4",
    personalizationMode: "diagnosis_driven",
    sourceFindingCount: action.sourceFindingIds.length,
    coreEnvelopeFields,
    focusCount: focusAreas.length,
    focusAreas,
    responseOptions: ["provide_now", "not_applicable", "defer"],
    acceptanceCriteria: action.acceptanceCriteria,
    completenessRules: [
      "每个个性化主题都必须选择现在提供、不适用或稍后增补",
      "现在提供的事实必须同时具备适用范围、时效、依据和公开范围",
      "不适用必须由品牌确认，系统不得根据行业类型自行删除主题",
      "稍后增补会保留证据缺口，不得进入事实草案或发布路径",
    ],
    missingInputs: action.humanInputs,
    factDraftAuthorized: false,
    publicationAuthorized: false,
    createdAt,
  });
}
