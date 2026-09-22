import { useEffect, useRef } from "react";
import type { Overview } from "../types";
import { StatusPill } from "./StatusPill";

type Answer = Overview["observations"]["answers"][number];
const citationLabels: Record<string, string> = {
  inline_link: "正文链接",
  source_list: "来源列表",
  provider_citation: "Provider 结构化引用",
  content_absorption_candidate: "内容吸收候选",
};
const objectTypeLabels: Record<string, string> = {
  neutral_category: "中性品类问题",
  brand_direct: "品牌直问",
  competitor_direct: "竞品直问",
  brand_comparison: "品牌对比",
};
const sentimentLabels: Record<string, string> = {
  positive: "正向",
  negative: "负向",
  neutral: "中性",
  mixed: "正负并存",
  uncertain: "不确定",
};

export function AnswerDrawer({
  answer,
  onClose,
}: {
  answer: Answer | null;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!answer) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    closeButtonRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [answer, onClose]);

  if (!answer) return null;
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="answer-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          ref={closeButtonRef}
          className="close"
          onClick={onClose}
          aria-label="关闭回答详情"
        >
          ×
        </button>
        <p className="eyebrow">原始回答证据</p>
        <h2 id="answer-title">
          第 {answer.round} 轮 · {answer.question}
        </h2>
        <div className="meta">
          <StatusPill value={answer.surface} tone="good" />
          <span>{answer.model}</span>
          <span>{answer.tokens} tokens</span>
          <span>{answer.attempts} 次尝试</span>
        </div>
        <div className="answer-text">{answer.answerText}</div>
        <section className="geo-evidence" aria-labelledby="geo-title">
          <p className="eyebrow">品牌与竞争对手分析</p>
          <h3 id="geo-title">提及、排名与主张证据</h3>
          {answer.geoAnalysis.status === "pending" ? (
            <p className="notice">GEO 分析尚未完成，当前不生成指标。</p>
          ) : (
            <>
              <div className="analysis-meta">
                <StatusPill
                  value={objectTypeLabels[answer.geoAnalysis.questionObjectType ?? ""] ?? "问题类型不确定"}
                />
                <StatusPill value="basic-geo.v1" tone="good" />
              </div>
              <div className="analysis-block">
                <h4>实体提及</h4>
                {answer.geoAnalysis.mentions.length ? (
                  answer.geoAnalysis.mentions.map((mention, index) => (
                    <article key={`${mention.entityId}-${mention.matchedAlias}-${index}`}>
                      <div>
                        <strong>{mention.entityName}</strong>
                        <StatusPill value={mention.entityRole === "brand" ? "品牌" : "竞品"} />
                        <StatusPill value={mention.certainty === "certain" ? "明确" : "可能歧义"} tone={mention.certainty === "certain" ? "good" : "warn"} />
                      </div>
                      <p>命中名称：{mention.matchedAlias}</p>
                      <blockquote>{mention.excerpt}</blockquote>
                    </article>
                  ))
                ) : (
                  <p className="empty">该回答未发现品牌或竞品明确提及。</p>
                )}
              </div>
              <div className="analysis-block">
                <h4>推荐排名</h4>
                {answer.geoAnalysis.rankings.map((ranking) => (
                  <article key={ranking.entityId}>
                    <div>
                      <strong>{ranking.entityName}</strong>
                      <StatusPill
                        value={ranking.applicability === "applicable" ? `第 ${ranking.rank} 名` : ranking.applicability === "uncertain" ? "不确定" : "不适用"}
                        tone={ranking.applicability === "applicable" ? "good" : "warn"}
                      />
                    </div>
                    <p>{ranking.reason}</p>
                    {ranking.evidenceExcerpt ? <blockquote>{ranking.evidenceExcerpt}</blockquote> : null}
                  </article>
                ))}
              </div>
              <div className="analysis-block">
                <h4>主张级描述</h4>
                {answer.geoAnalysis.claims.length ? (
                  answer.geoAnalysis.claims.map((claim, index) => (
                    <article key={`${claim.entityId}-${index}`}>
                      <div>
                        <strong>{claim.entityName}</strong>
                        <StatusPill
                          value={sentimentLabels[claim.sentiment] ?? claim.sentiment}
                          tone={claim.sentiment === "positive" ? "good" : claim.sentiment === "negative" ? "bad" : claim.sentiment === "uncertain" ? "warn" : "neutral"}
                        />
                      </div>
                      <blockquote>{claim.claimText}</blockquote>
                    </article>
                  ))
                ) : (
                  <p className="empty">没有足够上下文形成品牌或竞品主张。</p>
                )}
              </div>
            </>
          )}
        </section>
        <section className="citation-evidence" aria-labelledby="citation-title">
          <p className="eyebrow">可追溯关系</p>
          <h3 id="citation-title">引用与信源证据</h3>
          {answer.citationEvidence.scanStatus === "pending" ? (
            <p className="notice">引用检查尚未完成，当前不计算引用数量。</p>
          ) : answer.citationEvidence.events.length === 0 ? (
            <div className="citation-empty">
              <strong>未发现引用证据</strong>
              <p>
                该回答没有 URL 或 Provider
                结构化引用。系统不会据此推导虚假来源。
              </p>
            </div>
          ) : (
            <div className="citation-list">
              {answer.citationEvidence.events.map((event) => (
                <article key={event.id}>
                  <div>
                    <StatusPill
                      value={citationLabels[event.kind] ?? event.kind}
                    />
                    <StatusPill
                      value={event.snapshot?.status ?? event.evidenceStatus}
                      tone={
                        event.snapshot?.status === "succeeded" ? "good" : "warn"
                      }
                    />
                  </div>
                  <strong>
                    {event.snapshot?.title ??
                      event.domain ??
                      event.rawUrl ??
                      "来源名称不足"}
                  </strong>
                  {event.canonicalUrl ? (
                    <p className="mono">{event.canonicalUrl}</p>
                  ) : null}
                  {event.snapshot?.textExcerpt ? (
                    <p>{event.snapshot.textExcerpt.slice(0, 220)}…</p>
                  ) : null}
                  {event.snapshot?.errorCode ? (
                    <p>采集状态：{event.snapshot.errorCode}</p>
                  ) : null}
                  {event.snapshot?.contentSha256 ? (
                    <small className="mono">
                      快照哈希：{event.snapshot.contentSha256}
                    </small>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>
        <dl className="evidence">
          <div>
            <dt>采集时间</dt>
            <dd>{new Date(answer.capturedAt).toLocaleString("zh-CN")}</dd>
          </div>
          <div>
            <dt>结束原因</dt>
            <dd>{answer.finishReason}</dd>
          </div>
          <div>
            <dt>证据标识</dt>
            <dd className="mono">{answer.id}</dd>
          </div>
        </dl>
        <p className="notice">
          这是 DeepSeek API 文本回答，不代表 Web/App
          搜索结果。引用候选和页面快照不等于内容被模型吸收。
        </p>
      </div>
    </div>
  );
}
