import { createHash } from "node:crypto";
import type { QuestionPanel } from "../question-intelligence/question-intelligence.js";
import { JIACHENG_APPROVED_QUESTIONS } from "../question-intelligence/jiacheng-question-snapshot.js";
import {
  createObservationPlan,
  type ObservationPlan,
  type ObservationTarget,
  type SamplingRules,
} from "./observation.js";

export const JIACHENG_PRODUCTION_TENANT_ID =
  "09f3c859-9f60-4370-8364-a55229632edd";
export const JIACHENG_PRODUCTION_BASELINE_CYCLE =
  "jiacheng-production-baseline-v1";
export const JIACHENG_PRODUCTION_AUTHORIZATION =
  "jiacheng-production-baseline-v1:40-calls:60000-tokens";
export const JIACHENG_PRODUCTION_RECOVERY_CYCLE =
  "jiacheng-production-baseline-network-recovery-v1";
export const JIACHENG_PRODUCTION_RECOVERY_AUTHORIZATION =
  "jiacheng-production-network-recovery-v1:40-calls:1-attempt:60000-tokens";

export const JIACHENG_PRODUCTION_SAMPLING_RULES: SamplingRules = {
  version: "deepseek-sampling.v1",
  rounds: 2,
  language: "简体中文",
  regionContext: "中国大陆游客计划北京旅行",
  temperature: 0.2,
  maxTokens: 1000,
  timeoutMs: 60_000,
  maxAttempts: 3,
  maxTotalTokens: 60_000,
};

const stableUuid = (seed: string): string => {
  const hex = createHash("sha256")
    .update(seed)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16] ?? "0", 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
};

export const JIACHENG_PRODUCTION_BASELINE_PLAN_ID = stableUuid(
  "answertravel-v2:production:beijing-jiacheng:observation-baseline:v1",
);
export const JIACHENG_PRODUCTION_RECOVERY_PLAN_ID = stableUuid(
  "answertravel-v2:production:beijing-jiacheng:observation-baseline:network-recovery:v1",
);

export function assertProductionBaselineAuthorization(input: {
  execute: boolean;
  authorization: string | undefined;
}): void {
  if (!input.execute) return;
  if (input.authorization !== JIACHENG_PRODUCTION_AUTHORIZATION) {
    throw new Error(
      "Production observation execution requires the exact authorization marker.",
    );
  }
}

export function assertProductionRecoveryAuthorization(input: {
  execute: boolean;
  authorization: string | undefined;
}): void {
  if (!input.execute) return;
  if (input.authorization !== JIACHENG_PRODUCTION_RECOVERY_AUTHORIZATION) {
    throw new Error(
      "Production recovery execution requires the exact authorization marker.",
    );
  }
}

function assertApprovedProductionPanel(panel: QuestionPanel): void {
  if (panel.tenantId !== JIACHENG_PRODUCTION_TENANT_ID) {
    throw new Error("Production observation tenant does not match Beijing Jiacheng.");
  }
  if (panel.status !== "approved") {
    throw new Error("Production observation requires an approved question panel.");
  }
  const included = panel.candidates.filter((candidate) => candidate.included);
  if (panel.mix.actualTotal !== 20 || included.length !== 20) {
    throw new Error("Production observation requires exactly 20 approved questions.");
  }
  const approvedSnapshot = JIACHENG_APPROVED_QUESTIONS.map((question) => ({
    text: question.text,
    objectType: question.text.includes("北京珈程国际旅行社")
      ? "brand_direct"
      : "neutral_category",
    panelRole: question.panelRole,
  }));
  const currentSnapshot = included.map((question) => ({
    text: question.text,
    objectType: question.objectType,
    panelRole: question.panelRole,
  }));
  if (JSON.stringify(currentSnapshot) !== JSON.stringify(approvedSnapshot)) {
    throw new Error("Production question panel differs from the approved snapshot.");
  }
  if (
    included.some(
      (question) =>
        question.objectType !== "neutral_category" &&
        question.objectType !== "brand_direct",
    )
  ) {
    throw new Error("Production baseline contains an unauthorized question type.");
  }
}

export function createJiachengProductionBaseline(input: {
  panel: QuestionPanel;
  createdAt: string;
}): { plan: ObservationPlan; targets: ObservationTarget[] } {
  const { panel } = input;
  assertApprovedProductionPanel(panel);

  const baseline = createObservationPlan({
    id: JIACHENG_PRODUCTION_BASELINE_PLAN_ID,
    panel,
    rules: JIACHENG_PRODUCTION_SAMPLING_RULES,
    model: "deepseek-chat",
    cycleKey: JIACHENG_PRODUCTION_BASELINE_CYCLE,
    createdAt: input.createdAt,
  });
  if (baseline.plan.plannedSamples !== 40 || baseline.targets.length !== 40) {
    throw new Error("Production baseline must contain exactly 40 targets.");
  }
  return baseline;
}

export function createJiachengProductionNetworkRecovery(input: {
  panel: QuestionPanel;
  createdAt: string;
}): { plan: ObservationPlan; targets: ObservationTarget[] } {
  assertApprovedProductionPanel(input.panel);
  const recovery = createObservationPlan({
    id: JIACHENG_PRODUCTION_RECOVERY_PLAN_ID,
    panel: input.panel,
    rules: { ...JIACHENG_PRODUCTION_SAMPLING_RULES, maxAttempts: 1 },
    model: "deepseek-chat",
    cycleKey: JIACHENG_PRODUCTION_RECOVERY_CYCLE,
    createdAt: input.createdAt,
  });
  if (recovery.plan.plannedSamples !== 40 || recovery.targets.length !== 40) {
    throw new Error("Production recovery must contain exactly 40 targets.");
  }
  return recovery;
}
