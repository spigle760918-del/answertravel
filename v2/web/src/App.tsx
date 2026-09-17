import { useEffect, useMemo, useState } from "react";
import type { Overview } from "./types";
import { StatusPill } from "./components/StatusPill";
import { AnswerDrawer } from "./components/AnswerDrawer";
type Tab = "overview" | "onboarding" | "truth" | "questions" | "geo" | "claims" | "actions" | "cycles" | "decision" | "runs";
const tabs: Array<[Tab, string]> = [
  ["overview", "项目概览"],
  ["onboarding", "真实品牌接入"],
  ["truth", "品牌真相"],
  ["questions", "游客问题"],
  ["geo", "GEO 情报"],
  ["claims", "品牌描述核验"],
  ["actions", "优化行动"],
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
const verdictLabels:Record<string,string>={fact_consistent:"事实一致",fact_conflict:"事实冲突",self_reported_only:"仅品牌自述",insufficient_evidence:"证据不足",not_applicable:"不适用"};
const routeLabels:Record<string,string>={brand_truth:"补充品牌事实",website_structure:"修复官网证据结构",external_source:"建设可核验外部信源",product_service:"先完善真实产品服务",content_brief_candidate:"进入内容任务书候选",observe_only:"暂不行动",manual_review:"待人工复核"};
const actionStatusLabels:Record<string,string>={waiting_facts:"等待真实资料",ai_can_prepare:"AI可以先准备",waiting_yes_no:"等待 Yes/No",no_action:"暂不行动"};
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
  const fallbackItems:Array<{key:string;label:string;status:"ready"|"pending"|"blocked"|"not_in_alpha";evidence:string;requiredForLaunch:boolean}>=[
    {key:"brand_truth",label:"真实品牌真相",status:data.brand.status==="approved"?"ready":"pending",evidence:`品牌真相 V${data.brand.version} · ${data.brand.status}`,requiredForLaunch:true},
    {key:"question_panel",label:"真实游客问题组",status:data.questions.status==="approved"?"ready":"pending",evidence:`问题组 V${data.questions.panelVersion} · ${data.questions.items.filter(x=>x.included).length} 条`,requiredForLaunch:true},
    {key:"deepseek_api",label:"DeepSeek API 真实采样",status:data.observations.answers.length?"ready":"pending",evidence:data.observations.answers.length?`${data.observations.answers.length} 条成功回答可下钻`:"尚无真实回答",requiredForLaunch:true},
    {key:"evidence_chain",label:"不可变证据与指标下钻",status:data.observations.answers.length?"ready":"pending",evidence:data.observations.answers.length?"原始回答、引用和 GEO 分析可追溯":"尚无可下钻回答",requiredForLaunch:true},
    {key:"periodic_monitoring",label:"周期监测与失败留痕",status:data.periodicMonitoring?"ready":"pending",evidence:data.periodicMonitoring?"周期计划、成功与失败证据已保留":"尚未建立周期计划",requiredForLaunch:true},
    {key:"web_console",label:"文旅业务验收网页",status:"ready" as const,evidence:"当前页面使用真实验收数据",requiredForLaunch:true},
    {key:"linux_ci",label:"GitHub Linux CI",status:"ready" as const,evidence:"提交 89a6aea 的 Linux CI 34944606535 已成功",requiredForLaunch:true},
    {key:"aliyun_native",label:"阿里云原生运行验证",status:"blocked" as const,evidence:"blocked-by-host-policy：宝塔主机策略阻断，未冒充通过",requiredForLaunch:true},
    {key:"https_domain",label:"域名与 HTTPS 预发布",status:"pending" as const,evidence:"尚未完成本版本的公网 HTTPS 验收",requiredForLaunch:true},
    {key:"cloud_backup",label:"云端备份与恢复",status:"pending" as const,evidence:"本地恢复已通过，云端尚未验收",requiredForLaunch:true},
    {key:"cloud_logs_alerts",label:"云端日志与最小告警",status:"pending" as const,evidence:"尚未完成云端告警验收",requiredForLaunch:true},
    {key:"multi_model",label:"多模型并行监控",status:"not_in_alpha" as const,evidence:"本次仅 DeepSeek API",requiredForLaunch:false},
    {key:"multi_account_publish",label:"多平台多账号发布",status:"not_in_alpha" as const,evidence:"Alpha 不自动对外发布",requiredForLaunch:false},
    {key:"web_app_sampling",label:"AI Web/App 搜索终端",status:"not_in_alpha" as const,evidence:"API 采样不代表 Web/App 搜索表现",requiredForLaunch:false},
  ];
  const fallbackOpen=fallbackItems.filter(x=>x.requiredForLaunch&&(x.status==="pending"||x.status==="blocked"));
  const alphaReadiness=data.alphaReadiness??{rulesVersion:"alpha-readiness.v1" as const,overallStatus:fallbackOpen.some(x=>x.status==="blocked")?"blocked" as const:fallbackOpen.length?"pending" as const:"ready" as const,summary:fallbackOpen.length?`距离公网 Alpha 上线还有 ${fallbackOpen.length} 个硬门槛未满足。`:"单品牌 DeepSeek API Alpha 上线硬门槛已满足。",readyCount:fallbackItems.filter(x=>x.status==="ready").length,pendingCount:fallbackItems.filter(x=>x.status==="pending").length,blockedCount:fallbackItems.filter(x=>x.status==="blocked").length,notInAlphaCount:fallbackItems.filter(x=>x.status==="not_in_alpha").length,items:fallbackItems};
  return (
    <>
      <aside className="test-banner" aria-label="数据环境">{data.environment === "real_brand_baseline" ? "真实品牌首次观察 · DeepSeek API" : data.environment === "real_brand_draft" ? data.questions.status === "approved" ? "真实品牌问题组已批准 · 尚未进行答案采样" : "真实品牌问题草案 · 尚未进行答案采样" : "验收测试数据 · 不代表真实品牌运营结果"}</aside>
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
              {data.websiteDiagnosis?<section className="panel"><div className="panel-head"><div><p className="eyebrow">官网只读诊断</p><h2>公开页面证据已接入，仍不把自述当作独立事实</h2></div><div><StatusPill value={`${data.websiteDiagnosis.succeededCount}/${data.websiteDiagnosis.targetCount} 页面成功`} tone={data.websiteDiagnosis.failedCount||data.websiteDiagnosis.blockedCount?"warn":"good"}/><StatusPill value="未授权发布" tone="neutral"/></div></div><div className="stat-grid decision-stats"><article><span>成功页面</span><strong>{data.websiteDiagnosis.succeededCount}</strong><small>均保留内容哈希</small></article><article><span>已确认信号</span><strong>{data.websiteDiagnosis.strengths.length}</strong><small>页面级F2事实</small></article><article><span>结构缺口</span><strong>{data.websiteDiagnosis.gaps.length}</strong><small>不等同于因果根因</small></article><article><span>官网自述</span><strong>{data.websiteDiagnosis.selfReportedClaims.length}</strong><small>未升级为独立事实</small></article></div><div className="decision-grid"><article><h3>页面已具备</h3><ul>{data.websiteDiagnosis.strengths.map(x=><li key={x}>{x}</li>)}</ul></article><article><h3>仍需改善或补证</h3><ul>{data.websiteDiagnosis.gaps.map(x=><li key={x}>{x}</li>)}</ul></article></div>{data.websiteDiagnosis.selfReportedClaims.length?<><h3>仅为官网自述</h3><ul>{data.websiteDiagnosis.selfReportedClaims.map(x=><li key={x}>{x}</li>)}</ul></>:null}</section>:null}
              {data.websiteRemediationBlueprint?<><section className="panel"><div className="panel-head"><div><p className="eyebrow">官网结构修复蓝图</p><h2>先形成可回滚任务，再决定是否实施</h2></div><div><StatusPill value={`${data.websiteRemediationBlueprint.batchCount} 个批次`} tone="good"/><StatusPill value="未授权实施" tone="neutral"/></div></div><p>{data.websiteRemediationBlueprint.taskCount} 个任务均来自当前官网快照；这是F4建议，不代表官网已经修改。</p></section><section className="decision-grid">{data.websiteRemediationBlueprint.batches.map(batch=><article className="panel" key={batch.key}><div><StatusPill value={`第 ${batch.priority} 批`} tone={batch.status==="waiting_facts"?"warn":"good"}/><StatusPill value={batch.status==="waiting_facts"?"等待真实资料":"技术可准备"} tone={batch.status==="waiting_facts"?"warn":"neutral"}/></div><h2>{batch.title}</h2>{batch.tasks.map(task=><div className="run" key={task.id}><strong>{task.title}</strong><small>页面：{task.pageKeys.join("、")}</small><p>{task.reason}</p><h3>验收</h3><ul>{task.acceptanceCriteria.map(x=><li key={x}>{x}</li>)}</ul><small>回滚：{task.rollback}</small></div>)}</article>)}</section></>:null}
              <section className="panel">
                <div className="panel-head">
                  <div><p className="eyebrow">Alpha 上线就绪总览</p><h2>{alphaReadiness.summary}</h2></div>
                  <StatusPill value={alphaReadiness.overallStatus === "ready" ? "可上线" : alphaReadiness.overallStatus === "blocked" ? "仍有阻塞" : "仍有待办"} tone={alphaReadiness.overallStatus === "ready" ? "good" : "warn"}/>
                </div>
                <div className="stat-grid decision-stats">
                  <article><span>已就绪</span><strong>{alphaReadiness.readyCount}</strong><small>有可追溯证据</small></article>
                  <article><span>待完成</span><strong>{alphaReadiness.pendingCount}</strong><small>尚未执行或验收</small></article>
                  <article><span>外部阻塞</span><strong>{alphaReadiness.blockedCount}</strong><small>不冒充通过</small></article>
                  <article><span>不属本次 Alpha</span><strong>{alphaReadiness.notInAlphaCount}</strong><small>后续版本处理</small></article>
                </div>
                <div className="fact-list">
                  {alphaReadiness.items.map(item=><article key={item.key}><div><StatusPill value={item.status === "ready" ? "已就绪" : item.status === "pending" ? "待完成" : item.status === "blocked" ? "被阻塞" : "不属本次 Alpha"} tone={item.status === "ready" ? "good" : item.status === "not_in_alpha" ? "neutral" : "warn"}/>{item.requiredForLaunch?<StatusPill value="上线硬门槛"/>:null}</div><h3>{item.label}</h3><p>{item.evidence}</p></article>)}
                </div>
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
          {tab === "claims" && <>
            <section className="panel"><div className="panel-head"><div><p className="eyebrow">AI 品牌描述逐条核验</p><h1>AI 说了什么，哪些可信，哪些需要警惕</h1></div><StatusPill value={data.brandClaimVerification.rulesVersion} tone="good" /></div><p>{data.brandClaimVerification.note}</p></section>
            <section className="stat-grid decision-stats"><article><span>已核验品牌回答</span><strong>{data.brandClaimVerification.analyzedAnswers}</strong><small>仅品牌直问</small></article><article><span>可追溯主张</span><strong>{data.brandClaimVerification.totalFindings}</strong><small>逐条关联原回答</small></article>{data.brandClaimVerification.counts.slice(0,2).map(item=><article key={item.verdict}><span>{verdictLabels[item.verdict]??item.verdict}</span><strong>{item.count}</strong><small>规则型事实核验</small></article>)}</section>
            <section className="panel"><div className="panel-head"><div><p className="eyebrow">逐条证据</p><h2>品牌描述核验结果</h2></div></div>{data.brandClaimVerification.findings.length?<div className="answer-list">{data.brandClaimVerification.findings.map(item=><article className="run" key={item.id}><div><StatusPill value={verdictLabels[item.verdict]??item.verdict} tone={item.severity==="critical"?"bad":item.severity==="warning"?"warn":"good"}/><strong>{item.question} · 第 {item.round} 轮</strong><p>{item.claimText}</p><small>{item.reason}</small>{item.matchedRule?<small>命中规则：{item.matchedRule}</small>:null}</div></article>)}</div>:<p className="empty">当前品牌直问回答中没有发现可核验主张。</p>}</section>
            {data.evidenceGapRouting?<><section className="panel"><div className="panel-head"><div><p className="eyebrow">证据缺口动作路由</p><h2>先补什么，为什么不是直接写文章</h2></div><StatusPill value={data.evidenceGapRouting.rulesVersion} tone="good"/></div><p>{data.evidenceGapRouting.sourceFindingCount} 条缺口被归为 {data.evidenceGapRouting.clusterCount} 个游客决策主题，重复表达不会被当成新的独立证据。</p></section><section className="decision-grid">{data.evidenceGapRouting.clusters.map(cluster=><article className="panel" key={cluster.id}><div><StatusPill value={`优先级 ${cluster.priorityScore}`} tone={cluster.priorityScore>=80?"warn":"neutral"}/><StatusPill value={routeLabels[cluster.recommendedRoute]??cluster.recommendedRoute} tone={cluster.contentBriefEligible?"good":"neutral"}/></div><h2>{cluster.title}</h2><p>{cluster.rationale}</p><dl><div><dt>出现/去重</dt><dd>{cluster.occurrenceCount} / {cluster.uniqueClaimCount}</dd></div><div><dt>覆盖周期</dt><dd>{cluster.cycleCount}</dd></div><div><dt>预计窗口</dt><dd>{cluster.expectedWindow}</dd></div></dl>{cluster.minimalHumanQuestion?<><h3>需要人补充的最少信息</h3><p>{cluster.minimalHumanQuestion}</p></>:null}<h3>不行动选项</h3><p>{cluster.noActionOption}</p></article>)}</section></>:null}
          </>}
          {tab === "actions" && <>
            {data.optimizationActionPlan?<>
              <section className="panel"><div className="panel-head"><div><p className="eyebrow">优化行动计划</p><h1>AI先准备，人只补真相和做关键确认</h1></div><StatusPill value={data.optimizationActionPlan.rulesVersion} tone="good"/></div><p>{data.optimizationActionPlan.sourceFindingCount} 条证据缺口已从 {data.optimizationActionPlan.sourceClusterCount} 个主题压缩为 {data.optimizationActionPlan.packageCount} 个行动包。它们是 F4 建议，尚未修改官网、合同或产品。</p></section>
              <section className="stat-grid decision-stats"><article><span>原始缺口</span><strong>{data.optimizationActionPlan.sourceFindingCount}</strong><small>完整保留追溯</small></article><article><span>行动包</span><strong>{data.optimizationActionPlan.packageCount}</strong><small>最多 5 个</small></article><article><span>AI可先准备</span><strong>{data.optimizationActionPlan.packages.filter(x=>x.status==="ai_can_prepare").length}</strong><small>不产生发布动作</small></article><article><span>等待真实资料</span><strong>{data.optimizationActionPlan.packages.filter(x=>x.status==="waiting_facts").length}</strong><small>系统不会猜测</small></article></section>
              <section className="decision-grid">{[...data.optimizationActionPlan.packages].sort((a,b)=>a.priority-b.priority).map(item=><article className="panel" key={item.id}><div><StatusPill value={`第 ${item.priority} 步`} tone={item.priority<=2?"warn":"neutral"}/><StatusPill value={actionStatusLabels[item.status]??item.status} tone={item.status==="ai_can_prepare"?"good":item.status==="waiting_facts"?"warn":"neutral"}/></div><h2>{item.title}</h2><p>{item.businessGoal}</p><dl><div><dt>关联证据缺口</dt><dd>{item.sourceFindingIds.length}</dd></div><div><dt>预计窗口</dt><dd>{item.expectedWindow}</dd></div></dl><h3>AI现在会做什么</h3><ul>{item.aiPreparation.map(x=><li key={x}>{x}</li>)}</ul>{item.humanInputs.length?<><h3>需要你补充什么</h3><ul>{item.humanInputs.map(x=><li key={x}>{x}</li>)}</ul></>:<><h3>需要你补充什么</h3><p>当前不需要补资料。</p></>}<h3>补充或确认后</h3><p>{item.afterHumanInput}</p>{item.approvalQuestion?<><h3>后续 Yes/No</h3><p>{item.approvalQuestion}</p></>:null}<h3>验收标准</h3><ul>{item.acceptanceCriteria.map(x=><li key={x}>{x}</li>)}</ul><h3>不行动选项</h3><p>{item.noActionOption}</p></article>)}</section>
              {data.trustEvidenceBlueprint?<><section className="panel"><div className="panel-head"><div><p className="eyebrow">资质可信证据草案</p><h2>先说明证据强弱，再设计官网事实区</h2></div><div><StatusPill value="草案" tone="warn"/><StatusPill value={data.trustEvidenceBlueprint.publicationAuthorized?"已授权发布":"未授权发布"} tone="neutral"/></div></div><p>{data.trustEvidenceBlueprint.evidenceItemCount} 条批准事实已进入蓝图；用户确认的来源引用与独立官网快照分开显示。</p></section><section className="decision-grid"><article className="panel"><h2>证据清单</h2>{data.trustEvidenceBlueprint.evidenceItems.map(x=><div className="run" key={x.id}><StatusPill value={x.verificationState==="independent_snapshot"?"独立官网快照":"用户确认的来源引用"} tone={x.verificationState==="independent_snapshot"?"good":"warn"}/><strong>{x.statement}</strong><small>{x.sourceReference}</small>{x.missingEvidence.map(m=><small key={m}>仍缺：{m}</small>)}</div>)}</article><article className="panel"><h2>下一步补证</h2><ul>{data.trustEvidenceBlueprint.nextEvidenceTasks.map(x=><li key={x}>{x}</li>)}</ul><h3>绝不进入页面</h3><ul>{data.trustEvidenceBlueprint.prohibitedClaims.slice(0,6).map(x=><li key={x}>{x}</li>)}</ul></article></section><section className="decision-grid">{data.trustEvidenceBlueprint.pageSections.map(x=><article className="panel" key={x.key}><p className="eyebrow">官网事实区</p><h2>{x.heading}</h2><p>{x.purpose}</p><h3>必须展示</h3><ul>{x.requiredFields.map(y=><li key={y}>{y}</li>)}</ul><h3>展示规则</h3><ul>{x.displayRules.map(y=><li key={y}>{y}</li>)}</ul></article>)}</section></>:null}
              {data.trustSourceVerification?<><section className="panel"><div className="panel-head"><div><p className="eyebrow">资质来源只读核验</p><h2>哪些已取到原始页面，哪些仍被来源阻断</h2></div><div><StatusPill value={data.trustSourceVerification.rulesVersion} tone="good"/><StatusPill value={data.trustSourceVerification.publicationAuthorized?"已授权发布":"未授权发布"} tone="neutral"/></div></div><p>共访问 {data.trustSourceVerification.targetCount} 个固定来源：{data.trustSourceVerification.independentlyVerifiedCount} 个独立核验、{data.trustSourceVerification.selfAssertedCount} 个仅为官网自述、{data.trustSourceVerification.blockedCount} 个来源阻断。</p></section><section className="stat-grid decision-stats"><article><span>独立平台快照</span><strong>{data.trustSourceVerification.independentlyVerifiedCount}</strong><small>满足确定性命中</small></article><article><span>官网自述</span><strong>{data.trustSourceVerification.selfAssertedCount}</strong><small>不升级为官方事实</small></article><article><span>来源阻断</span><strong>{data.trustSourceVerification.blockedCount}</strong><small>不冒充核验通过</small></article><article><span>仍待补证</span><strong>{data.trustSourceVerification.remainingEvidenceTasks.length}</strong><small>需要官方结果或材料</small></article></section><section className="decision-grid">{data.trustSourceVerification.results.map(x=><article className="panel" key={x.id}><div><StatusPill value={x.verificationStatus==="independently_verified"?"已独立核验":x.verificationStatus==="self_asserted"?"仅官网自述":x.verificationStatus==="source_blocked"?"来源阻断":"证据不足"} tone={x.verificationStatus==="independently_verified"?"good":x.verificationStatus==="self_asserted"?"warn":"neutral"}/></div><h2>{x.label}</h2><p>{x.url}</p><dl><div><dt>页面状态</dt><dd>{x.httpStatus??x.errorCode??"未知"}</dd></div><div><dt>快照哈希</dt><dd>{x.contentSha256?`${x.contentSha256.slice(0,12)}…`:"未取得"}</dd></div></dl>{x.verifiedSignals.length?<><h3>本次能确认</h3><ul>{x.verifiedSignals.map(y=><li key={y}>{y}</li>)}</ul></>:null}<h3>证据边界</h3><ul>{x.limitations.map(y=><li key={y}>{y}</li>)}</ul></article>)}</section><section className="decision-grid"><article className="panel"><h2>已解决的补证</h2>{data.trustSourceVerification.resolvedEvidenceTasks.length?<ul>{data.trustSourceVerification.resolvedEvidenceTasks.map(x=><li key={x}>{x}</li>)}</ul>:<p className="empty">本轮没有补证任务达到独立核验条件。</p>}</article><article className="panel"><h2>仍需真实材料</h2><ul>{data.trustSourceVerification.remainingEvidenceTasks.map(x=><li key={x}>{x}</li>)}</ul></article></section></>:null}
              {data.refundPolicyIntake?<><section className="panel"><div className="panel-head"><div><p className="eyebrow">退款政策事实采集</p><h2>一次补齐真实规则，AI 不猜比例和时限</h2></div><div><StatusPill value="等待真实资料" tone="warn"/><StatusPill value={data.refundPolicyIntake.publicationAuthorized?"已授权发布":"未授权发布"} tone="neutral"/></div></div><p>{data.refundPolicyIntake.sourceFindingCount} 条退款证据缺口已合并为 {data.refundPolicyIntake.fieldCount} 个事实主题。当前没有生成政策摘要或公开承诺。</p></section><section className="decision-grid">{data.refundPolicyIntake.paths.map(x=><article className="panel" key={x.key}><StatusPill value={x.key==="current_policy"?"路径 A":"路径 B"} tone={x.key==="current_policy"?"good":"neutral"}/><h2>{x.label}</h2><p>{x.whenToChoose}</p><h3>选择后</h3><p>{x.nextStep}</p><h3>公开边界</h3><p>{x.publicOutcome}</p></article>)}</section><section className="decision-grid">{data.refundPolicyIntake.fields.map(x=><article className="panel" key={x.key}><p className="eyebrow">需要真实事实</p><h2>{x.label}</h2><p>{x.question}</p><small>{x.whyNeeded}</small><h3>一次提供</h3><ul>{x.requiredInputs.map(y=><li key={y}>{y}</li>)}</ul><h3>可以作为依据</h3><ul>{x.acceptableEvidence.map(y=><li key={y}>{y}</li>)}</ul></article>)}</section><section className="decision-grid"><article className="panel"><h2>完整性门禁</h2><ul>{data.refundPolicyIntake.completenessRules.map(x=><li key={x}>{x}</li>)}</ul></article><article className="panel"><h2>冲突门禁</h2><ul>{data.refundPolicyIntake.conflictRules.map(x=><li key={x}>{x}</li>)}</ul></article></section></>:null}
              {data.actionFactIntakes.length?<><section className="panel"><div className="panel-head"><div><p className="eyebrow">品牌个性化事实工作台</p><h2>所有待补方向一次看完，不再逐细节设置 Gate</h2></div><div><StatusPill value={`${data.actionFactIntakes.length} 个行动包`} tone="good"/><StatusPill value="未授权发布" tone="neutral"/></div></div><p>当前共 {data.actionFactIntakes.reduce((sum,x)=>sum+x.focusCount,0)} 个品牌专属主题；每个主题都可选择现在提供、不适用或稍后增补。</p></section><section className="decision-grid"><article className="panel"><h2>所有品牌共用的证据外壳</h2><ul>{(data.actionFactIntakes.at(0)?.coreEnvelopeFields??[]).map(x=><li key={x}>{x}</li>)}</ul></article><article className="panel"><h2>统一处理方式</h2><ul><li>现在提供真实资料</li><li>确认与本品牌不适用</li><li>稍后增补并继续保留缺口</li></ul><p className="empty">未提供真实资料前，不生成事实草案、内容或页面。</p></article></section><section className="decision-grid">{data.actionFactIntakes.map(intake=><article className="panel" key={intake.actionPackageKey}><p className="eyebrow">{intake.sourceFindingCount} 条来源缺口</p><h2>{intake.actionPackageTitle}</h2><ul>{intake.focusAreas.map(area=><li key={area.key}>{area.prompt}</li>)}</ul><small>{intake.focusCount} 个品牌专属主题 · 诊断驱动</small></article>)}</section></>:null}
            </>:<section className="panel"><h1>优化行动计划尚未生成</h1><p className="empty">等待证据缺口路由完成，系统不会用模拟建议填充。</p></section>}
          </>}
          {tab === "cycles" && (
            <>
              {data.periodicMonitoring ? <>
                <section className="panel">
                  <div className="panel-head"><div><p className="eyebrow">周期化监测</p><h1>每日计划已进入持久化调度</h1></div><div><StatusPill value={data.periodicMonitoring.status === "active" ? "已启用" : "已暂停"} tone={data.periodicMonitoring.status === "active" ? "good" : "warn"} /><StatusPill value="DeepSeek API" tone="good" /></div></div>
                  <div className="decision-summary"><h2>普通周期自动运行，真正门禁才找人</h2><p>固定 20 条问题、每题 2 轮；失败会保留并按规则重试，不会用追加样本粉饰成功率。</p></div>
                </section>
                <section className="stat-grid decision-stats"><article><span>每周期最大样本</span><strong>{data.periodicMonitoring.maxSamplesPerCycle}</strong><small>固定问题组</small></article><article><span>每周期 Token 上限</span><strong>{data.periodicMonitoring.maxTokensPerCycle}</strong><small>达到即停止</small></article><article><span>已计划周期</span><strong>{data.periodicMonitoring.cycles.length}</strong><small>持久化且幂等</small></article><article><span>长期云端计费</span><strong>未开启</strong><small>本轮仅验收测试</small></article></section>
                <section className="decision-grid"><article className="panel"><p className="eyebrow">下次计划</p><h2>{new Date(data.periodicMonitoring.nextRunAt).toLocaleString("zh-CN")}</h2><p>时区：{data.periodicMonitoring.timezone}</p></article><article className="panel"><p className="eyebrow">授权依据</p><h2>范围没有扩大</h2><p>{data.periodicMonitoring.decisionReference}</p></article></section>
              </> : <section className="panel"><h1>周期化监测尚未启用</h1><p className="empty">系统不会在没有明确范围和预算时自动产生计费任务。</p></section>}
              {data.observationCycles ? (
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
            ) : null}
            </>
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
