import { z } from "zod";

export const FactLevelSchema = z.enum(["F0", "F1", "F2", "F3", "F4"]);
export type FactLevel = z.infer<typeof FactLevelSchema>;

export const FACT_LEVEL_MEANING: Readonly<Record<FactLevel, string>> = Object.freeze({
  F0: "用户确认事实",
  F1: "原始证据",
  F2: "可复算结果",
  F3: "有依据推断",
  F4: "建议或假设"
});
