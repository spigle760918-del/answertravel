import { useEffect, useMemo, useState } from "react";
import type { Overview } from "./types";
import { StatusPill } from "./components/StatusPill";
import { AnswerDrawer } from "./components/AnswerDrawer";
type Tab = "overview" | "onboarding" | "truth" | "questions" | "geo" | "cycles" | "decision" | "runs";
const tabs: Array<[Tab, string]> = [
  ["overview", "项目概览"],
  ["onboarding", "真实品牌接入"],
  ["truth", "品牌真相"],
  ["questions", "游客问题"],
  ["geo", "GEO 情报"],
  ["cycles", "可比较周期"],
  ["decision", "决策建议"],
  ["runs", "采集与回答"],
];
const percent = (value: number | null) =>
  value === null ? "证据不足" : `${Math.round(value * 100)}%`;
const sentimentLabels: Record<string, string> = {
  positive: "正向",
  negative: "负向",
  neutral: "中性",
  mixed: "正负并存",
  uncertain: "不确定",
};
const rootCauseLabels: Record<string, string> = {
  sampling_insufficient: "样本与周期不足",
  brand_truth_gap: "品牌事实缺口",
  product_service_gap: "产品服务真实差距",
  website_structure_gap: "官网结构差距",
  content_coverage_gap: "内容覆盖差距",
  external_source_gap: "外部信源差距",
  reputation_risk: "口碑与风险",
  model_volatility: "模型波动",
  competitor_reason_unclear: "竞品领先原因不清",
  no_action: "暂无需行动",
};
const deepDiveLabels: Record<string, string> = {
  no_trigger: "暂不深挖",
  expand_sample: "先扩充中性样本",
  recommend_approval: "建议深挖，等待确认",
};
export default function App() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [selected, setSelected] = useState<
    Overview["observations"]["answers"][number] | null
  >(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/acceptance/overview", { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json() as Promise<Overview>;
      })
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(true);
      });
    return () => controller.abort();
  }, []);
  const totals = useMemo(
    () =>
      data?.observations.plans.reduce(
        (a, p) => ({
          planned: a.planned + p.plannedSamples,
          success: a.success + p.success,
          failed: a.failed + p.failed,
          stopped: a.stopped + p.budgetStopped,
          tokens: a.tokens + p.tokens,
        }),
        { planned: 0, success: 0, failed: 0, stopped: 0, tokens: 0 },
      ),
    [data],
  );
  if (error)
    return (
      <main className="state">
        <div className="state-card">
          <span className="brand-mark">A</span>
          <h1>验收数据暂时不可用</h1>
          <p>数据库或服务尚未准备好。系统没有使用模拟数字填充页面。</p>
          <button onClick={() => location.reload()}>重新加载</button>
        </div>
      </main>
    );
  if (!data)
    return (
      <main className="state" aria-live="polite">
        <div className="loader" />
        <p>正在读取真实验收数据…</p>
      </main>
    );
  return (
    <>
      <aside className="test-banner" aria-label="数据环境">{data.environment === "real_brand_draft" ? "真实品牌问题草案 · 尚未进行答案采样" : "验收测试数据 · 不代表真实品牌运营结果"}</aside>
      <header>
        <div className="identity">
          <span className="brand-mark">A</span>
          <div>
            <strong>AnswerTravel</strong>
            <small>文旅 GEO 决策系统 · Alpha</small>
          </div>
        </div>
        <div className="brand-switch">
          <span>当前品牌空间</span>
          <strong>{data.brand.name}</strong>
        </div>
      </header>
      <div className="shell">
        <nav aria-label="主要导航">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <main className="content">
          {tab === "overview" && (
            <>
              <section className="hero">
                <div>
                  <p className="eyebrow">真实链路验收</p>
                  <h1>从品牌事实，到游客问题，再到每一条 AI 回答</h1>
                  <p>
                    所有数字都来自 V2 数据库，可以继续下钻到原始回答与来源证据。
                  </p>
                </div>
                <div className="ring">
                  <strong>{totals?.success ?? 0}</strong>
                  <span>有效回答</span>
                </div>
              </section>
              <section className="stat-grid">
                <article>
                  <span>品牌真相版本</span>
                  <strong>V{data.brand.version}</strong>
                  <StatusPill value={data.brand.status} tone="good" />
                </article>
                <article>
                  <span>已纳入问题</span>
                  <strong>
                    {data.questions.items.filter((x) => x.included).length}
                  </strong>
                  <small>问题组 V{data.questions.panelVersion}</small>
                </article>
                <article>
                  <span>计划样本</span>
                  <strong>{totals?.planned ?? 0}</strong>
                  <small>仅 DeepSeek API</small>
                </article>
                <article>
                  <span>实际用量</span>
                  <strong>{totals?.tokens ?? 0}</strong>
                  <small>tokens</small>
                </article>
              </section>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <p className="eyebrow">能力边界</p>
                    <h2>现在能确认什么</h2>
                  </div>
                </div>
                <div className="limit-grid">
                  {data.limitations.map((x, i) => (
                    <div key={x}>
                      <span>{String(i + 1).padStart(2, "0")}</span>
                      <p>{x}</p>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
          {tab === "truth" && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">品牌真相 · V{data.brand.version}</p>
                  <h1>{data.brand.name}</h1>
                </div>
                <StatusPill value={data.brand.status} tone="good" />
              </div>
              <div className="fact-list">
                {data.brand.facts.map((f, i) => (
                  <article key={`${f.statement}-${i}`}>
                    <div>
                      <StatusPill value={f.category} />
                      <StatusPill
                        value={f.visibility}
                        tone={f.visibility === "public" ? "good" : "warn"}
                      />
                    </div>
                    <h3>{f.statement}</h3>
                    <p>来源：{f.source}</p>
                  </article>
                ))}
              </div>
              {data.truthQuality.issues.length > 0 ? (
                <div className="issues">
                  <h2>需要关注</h2>
                  {data.truthQuality.issues.map((x, i) => (
                    <p key={i}>{x.message}</p>
                  ))}
                </div>
              ) : (
                <p className="empty">当前版本没有未处理的质量问题。</p>
              )}
            </section>
          )}
          {tab === "onboarding" && (
            data.realBrandOnboarding ? (
              <>
                <section className="panel">
                  <div className="panel-head"><div><p className="eyebrow">真实品牌资料草案</p><h1>{data.realBrandOnboarding.brandName}</h1></div><StatusPill value={data.realBrandOnboarding.readyForApproval ? "可进入审核" : "资料待补充"} tone={data.realBrandOnboarding.readyForApproval ? "good" : "warn"} /></div>
                  <p>这里只展示从历史资料提取的候选内容；未获你确认前，不会成为品牌真相，也不会用于答案采样。</p>
                </section>
                <section className="decision-grid">
                  <article className="panel"><p className="eyebrow">候选事实</p><h2>需要你确认的品牌资料</h2>{data.realBrandOnboarding.facts.map((fact)=><div className="action-card" key={`${fact.category}-${fact.statement}`}><div><StatusPill value={fact.category}/><StatusPill value={fact.visibility}/></div><h3>{fact.statement}</h3><p>来源可信度：{fact.confidence === "high" ? "高" : fact.confidence === "medium" ? "中" : "低"} · {fact.needsHumanConfirmation ? "尚待确认" : "已确认"}</p></div>)}</article>
                  <article className="panel"><p className="eyebrow">资料缺口</p><h2>现在不能由 AI 猜测的内容</h2><ul>{data.realBrandOnboarding.gaps.map((item)=><li key={item}>{item}</li>)}</ul>{data.realBrandOnboarding.conflicts.length?<><h3>冲突候选</h3><ul>{data.realBrandOnboarding.conflicts.map((item)=><li key={item}>{item}</li>)}</ul></>:null}</article>
                </section>
                <section className="decision-grid">
                  <article className="panel"><p className="eyebrow">品牌真相候选草案</p><h2>公开候选 {data.realBrandOnboarding.truthDraft.publicCandidateCount} 条</h2><p>{data.realBrandOnboarding.truthDraft.note}</p><p>排除或待核验 {data.realBrandOnboarding.truthDraft.excludedCount} 条。后续资料可追加新版本，不覆盖历史版本。</p></article>
                  <article className="panel"><p className="eyebrow">竞品范围</p><h2>{data.realBrandOnboarding.competitors.length ? "待确认竞品" : "尚未提供竞品"}</h2>{data.realBrandOnboarding.competitors.length?<ul>{data.realBrandOnboarding.competitors.map((item)=><li key={item.name}>{item.name}</li>)}</ul>:<p className="empty">不会从行业常识中替你猜竞品。</p>}</article>
                  <article className="panel"><p className="eyebrow">历史问题种子</p><h2>{data.realBrandOnboarding.seedQuestions.length} 条待复核问题</h2><ul>{data.realBrandOnboarding.seedQuestions.map((item)=><li key={item.text}>{item.text} <small>· {item.group}</small></li>)}</ul></article>
                </section>
              </>
            ) : <section className="panel"><h1>尚无真实品牌资料草案</h1><p className="empty">验收测试品牌不会自动迁移成真实品牌。</p></section>
          )}
          {tab === "questions" && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">
                    问题组 V{data.questions.panelVersion}
                  </p>
                  <h1>游客出发前会问什么</h1>
                </div>
                <StatusPill value={data.questions.status} tone="good" />
              </div>
              <div className="question-list">
                {data.questions.items.map((q) => (
                  <article key={q.id} className={!q.included ? "muted" : ""}>
                    <div>
                      <StatusPill value={q.panelRole} />
                      <StatusPill value={q.objectType} />
                      {q.included ? (
                        <StatusPill value="已纳入" tone="good" />
                      ) : (
                        <StatusPill value="已排除" tone="warn" />
                      )}
                    </div>
                    <h3>{q.text}</h3>
                    {q.exclusionReason ? (
                      <p>排除原因：{q.exclusionReason}</p>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          )}
          {tab === "geo" && (
            <>
              <section className="panel geo-intro">
                <div className="panel-head">
                  <div>
                    <p className="eyebrow">同口径基础情报</p>
                    <h1>品牌与竞品如何被 AI 描述</h1>
                  </div>
                  <StatusPill value={data.geoIntelligence.rulesVersion} tone="good" />
                </div>
                <p>{data.geoIntelligence.note}</p>
              </section>
              <section className="stat-grid geo-stats">
                <article>
                  <span>中性问题有效样本</span>
                  <strong>{data.geoIntelligence.naturalSampleCount}</strong>
                  <small>品牌直问不计入</small>
                </article>
                <article>
                  <span>品牌自然提及率</span>
                  <strong>{percent(data.geoIntelligence.brandNaturalMentionRate)}</strong>
                  <small>{data.geoIntelligence.brandNaturalMentionCount} 条明确提及</small>
                </article>
                <article>
                  <span>可用排名事实</span>
                  <strong>{data.geoIntelligence.applicableRankingFacts || "不适用"}</strong>
                  <small>仅明确有序推荐才计算</small>
                </article>
                <article>
                  <span>主张级描述</span>
                  <strong>{data.geoIntelligence.claimSentiments.reduce((sum, item) => sum + item.count, 0)}</strong>
                  <small>不按整篇回答粗分情感</small>
                </article>
              </section>
              <section className="geo-grid">
                <article className="panel">
                  <div className="panel-head">
                    <div>
                      <p className="eyebrow">竞品同口径对比</p>
                      <h2>中性问题自然提及</h2>
                    </div>
                  </div>
                  {data.geoIntelligence.competitorNaturalMentions.length ? (
                    <div className="metric-list">
                      {data.geoIntelligence.competitorNaturalMentions.map((item) => (
                        <div key={item.entityId}>
                          <span>{item.entityName}</span>
                          <strong>{percent(item.rate)}</strong>
                          <small>{item.count} 条明确提及</small>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="empty">当前中性样本未发现竞品明确提及。</p>
                  )}
                </article>
                <article className="panel">
                  <div className="panel-head">
                    <div>
                      <p className="eyebrow">主张级情感</p>
                      <h2>AI 如何描述各实体</h2>
                    </div>
                  </div>
                  {data.geoIntelligence.claimSentiments.length ? (
                    <div className="sentiment-list">
                      {data.geoIntelligence.claimSentiments.map((item) => (
                        <div key={item.sentiment}>
                          <StatusPill
                            value={sentimentLabels[item.sentiment] ?? item.sentiment}
                            tone={item.sentiment === "positive" ? "good" : item.sentiment === "negative" ? "bad" : item.sentiment === "uncertain" ? "warn" : "neutral"}
                          />
                          <strong>{item.count}</strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="empty">当前没有可归属到品牌或竞品的主张。</p>
                  )}
                </article>
              </section>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <p className="eyebrow">逐条追溯</p>
                    <h2>查看每条回答的提及、排名与描述</h2>
                  </div>
                </div>
                <div className="answer-list">
                  {data.observations.answers.map((answer) => (
                    <button key={answer.id} onClick={() => setSelected(answer)}>
                      <span>第 {answer.round} 轮</span>
                      <div>
                        <strong>{answer.question}</strong>
                        <small>
                          {answer.geoAnalysis.status === "completed"
                            ? `${answer.geoAnalysis.mentions.length} 个提及 · ${answer.geoAnalysis.claims.length} 条主张`
                            : "分析尚未完成"}
                        </small>
                      </div>
                      <b>查看证据 →</b>
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}
          {tab === "decision" && (
            data.decisionIntelligence ? (
              <>
                <section className="panel decision-hero">
                  <div className="panel-head">
                    <div>
                      <p className="eyebrow">AI 决策前证据门禁</p>
                      <h1>为什么这样判断，下一步做什么</h1>
                    </div>
                    <div>
                      <StatusPill value={data.decisionIntelligence.factLevel} />
                      <StatusPill value={data.decisionIntelligence.rulesVersion} tone="good" />
                    </div>
                  </div>
                  <div className="decision-summary">
                    <StatusPill
                      value={data.decisionIntelligence.evidenceStatus === "sufficient" ? "证据可行动" : "证据不足"}
                      tone={data.decisionIntelligence.evidenceStatus === "sufficient" ? "good" : "warn"}
                    />
                    <h2>{rootCauseLabels[data.decisionIntelligence.primaryRootCause] ?? data.decisionIntelligence.primaryRootCause}</h2>
                    <p>{data.decisionIntelligence.summary}</p>
                  </div>
                </section>
                <section className="stat-grid decision-stats">
                  <article><span>中性有效样本</span><strong>{data.decisionIntelligence.sampleCount}</strong><small>最低行动门槛：6</small></article>
                  <article><span>可比较观察周期</span><strong>{data.decisionIntelligence.observationPlanCount}</strong><small>最低行动门槛：2</small></article>
                  <article><span>内容方向</span><strong>{data.decisionIntelligence.actions[0]?.actionType === "expand_sampling" ? "暂不写" : "有建议"}</strong><small>先判断根因再产内容</small></article>
                  <article><span>竞对深挖</span><strong>{deepDiveLabels[data.decisionIntelligence.deepDive.decision] ?? data.decisionIntelligence.deepDive.decision}</strong><small>与中性指标隔离</small></article>
                </section>
                <section className="decision-grid">
                  <article className="panel">
                    <p className="eyebrow">建议动作</p>
                    <h2>当前优先做什么</h2>
                    {data.decisionIntelligence.actions.map((action) => (
                      <div className="action-card" key={`${action.actionType}-${action.title}`}>
                        <div>
                          <StatusPill value={action.priority === "high" ? "高优先级" : action.priority} tone={action.priority === "high" ? "warn" : "neutral"} />
                          <StatusPill value={action.requiresApproval ? "需要 Yes/No" : "可自动观察"} tone={action.requiresApproval ? "warn" : "good"} />
                        </div>
                        <h3>{action.title}</h3>
                        <p>{action.rationale}</p>
                        <dl><div><dt>预计窗口</dt><dd>{action.expectedWindow}</dd></div><div><dt>验收指标</dt><dd>{action.successMetric}</dd></div></dl>
                      </div>
                    ))}
                  </article>
                  <article className="panel">
                    <p className="eyebrow">竞对深挖决定</p>
                    <h2>{deepDiveLabels[data.decisionIntelligence.deepDive.decision] ?? data.decisionIntelligence.deepDive.decision}</h2>
                    <p>{data.decisionIntelligence.deepDive.reason}</p>
                    {data.decisionIntelligence.deepDive.proposedSampleBudget > 0 ? <p className="budget">建议新增样本预算：{data.decisionIntelligence.deepDive.proposedSampleBudget}</p> : null}
                    {data.decisionIntelligence.deepDive.questionThemes.length ? <><h3>独立问题主题</h3><ul>{data.decisionIntelligence.deepDive.questionThemes.map((item) => <li key={item}>{item}</li>)}</ul></> : null}
                    <h3>自动停止条件</h3>
                    <ul>{data.decisionIntelligence.deepDive.stopConditions.map((item) => <li key={item}>{item}</li>)}</ul>
                  </article>
                </section>
                <section className="decision-grid">
                  <article className="panel">
                    <p className="eyebrow">替代解释</p>
                    <h2>还可能是什么原因</h2>
                    <ul>{data.decisionIntelligence.alternatives.map((item) => <li key={item}>{item}</li>)}</ul>
                  </article>
                  <article className="panel">
                    <p className="eyebrow">尚缺证据</p>
                    <h2>系统不会猜测的部分</h2>
                    {data.decisionIntelligence.missingEvidence.length ? <ul>{data.decisionIntelligence.missingEvidence.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="empty">当前决策所需证据已接入。</p>}
                  </article>
                </section>
              </>
            ) : (
              <section className="panel"><h1>决策尚未生成</h1><p className="empty">等待基础 GEO 情报完成后自动评估，不使用模拟建议填充。</p></section>
            )
          )}
          {tab === "cycles" && (
            data.observationCycles ? (
              <>
                <section className="panel">
                  <div className="panel-head"><div><p className="eyebrow">同口径样本扩充</p><h1>第二观察周期已经形成</h1></div><div><StatusPill value={data.observationCycles.status === "comparable" ? "可比较" : "不可比较"} tone={data.observationCycles.status === "comparable" ? "good" : "warn"} /><StatusPill value={data.observationCycles.rulesVersion} tone="good" /></div></div>
                  <div className="decision-summary"><h2>{data.observationCycles.status === "comparable" ? "已达到自动复诊门槛" : "仍不能形成趋势判断"}</h2><p>{data.observationCycles.status === "comparable" ? "新旧周期的问题、模型、API 终端、区域和关键采样参数一致，系统已自动重新诊断。" : "关键口径存在变化，系统已阻止把两个周期拼成趋势。"}</p></div>
                </section>
                <section className="stat-grid decision-stats">
                  <article><span>中性有效回答</span><strong>{data.observationCycles.validAnswerCount}</strong><small>最低门槛：6</small></article>
                  <article><span>可比较周期</span><strong>{data.observationCycles.observationPlanCount}</strong><small>最低门槛：2</small></article>
                  <article><span>本次新增授权</span><strong>{data.observationCycles.approvedSampleBudget}</strong><small>只允许中性回答</small></article>
                  <article><span>竞对直问</span><strong>未启动</strong><small>仍需独立 Yes/No</small></article>
                </section>
                <section className="decision-grid">
                  <article className="panel"><p className="eyebrow">人工授权边界</p><h2>只执行已确认的最小补采</h2><p>{data.observationCycles.decisionReference}</p><dl><div><dt>最大新增样本</dt><dd>{data.observationCycles.approvedSampleBudget}</dd></div><div><dt>Token 上限</dt><dd>{data.observationCycles.approvedTokenBudget}</dd></div></dl></article>
                  <article className="panel"><p className="eyebrow">可比较性检查</p><h2>{data.observationCycles.differences.length ? "发现口径差异" : "关键口径完全一致"}</h2>{data.observationCycles.differences.length ? <ul>{data.observationCycles.differences.map((item) => <li key={item}>{item}</li>)}</ul> : <p>问题组、模型、终端、语言、区域、温度和回答长度上限均一致。</p>}</article>
                </section>
              </>
            ) : <section className="panel"><h1>第二观察周期尚未形成</h1><p className="empty">系统不会用未获授权或不可比较的数据填充趋势。</p></section>
          )}
          {tab === "runs" && (
            <>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <p className="eyebrow">观察计划</p>
                    <h1>采集运行</h1>
                  </div>
                  <StatusPill value="api" tone="good" />
                </div>
                {data.observations.plans.map((p) => (
                  <article className="run" key={p.id}>
                    <div>
                      <strong>{p.model}</strong>
                      <span>
                        {new Date(p.createdAt).toLocaleString("zh-CN")}
                      </span>
                      <small>{p.cycleKey === "baseline" ? "基线周期" : "获批补采周期"}</small>
                    </div>
                    <div className="run-numbers">
                      <span>
                        计划 <b>{p.plannedSamples}</b>
                      </span>
                      <span>
                        成功 <b>{p.success}</b>
                      </span>
                      <span>
                        失败 <b>{p.failed}</b>
                      </span>
                      <span>
                        预算停止 <b>{p.budgetStopped}</b>
                      </span>
                      <span>
                        用量 <b>{p.tokens}</b>
                      </span>
                    </div>
                  </article>
                ))}
              </section>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <p className="eyebrow">可下钻证据</p>
                    <h2>原始回答</h2>
                  </div>
                </div>
                <div className="answer-list">
                  {data.observations.answers.map((a) => (
                    <button key={a.id} onClick={() => setSelected(a)}>
                      <span>第 {a.round} 轮</span>
                      <div>
                        <strong>{a.question}</strong>
                        <small>{a.answerText.slice(0, 86)}…</small>
                      </div>
                      <b>查看原文 →</b>
                    </button>
                  ))}
                </div>
                {data.observations.failures.length > 0 ? (
                  <div className="issues">
                    <h2>失败与停止记录</h2>
                    {data.observations.failures.map((f, i) => (
                      <p key={i}>
                        {f.question} · 第 {f.round} 轮 · {f.status} ·{" "}
                        {f.errorCode ?? "无错误码"}
                      </p>
                    ))}
                  </div>
                ) : null}
              </section>
            </>
          )}
        </main>
      </div>
      <AnswerDrawer answer={selected} onClose={() => setSelected(null)} />
    </>
  );
}
