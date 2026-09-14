const labels: Record<string, string> = {
  approved: "已确认",
  draft: "待确认",
  public: "可公开",
  internal: "仅内部",
  restricted: "受限",
  undetermined: "待判断",
  api: "DeepSeek API",
  baseline: "固定基准",
  exploration: "探索问题",
  trigger: "触发问题",
  neutral_category: "中性品类",
  brand_direct: "品牌直问",
  competitor_direct: "竞品直问",
  brand_vs_competitor: "品牌对比",
};
export function StatusPill({
  value,
  tone = "neutral",
}: {
  value: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  return <span className={`pill ${tone}`}>{labels[value] ?? value}</span>;
}
