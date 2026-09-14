import { useEffect, useMemo, useState } from "react";
import type { Overview } from "./types";
import { StatusPill } from "./components/StatusPill";
import { AnswerDrawer } from "./components/AnswerDrawer";
type Tab = "overview" | "truth" | "questions" | "runs";
const tabs: Array<[Tab, string]> = [
  ["overview", "项目概览"],
  ["truth", "品牌真相"],
  ["questions", "游客问题"],
  ["runs", "采集与回答"],
];
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
      <aside className="test-banner" aria-label="数据环境">验收测试数据 · 不代表真实品牌运营结果</aside>
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
                    所有数字都来自 V2 数据库，可以继续下钻。当前尚未计算 GEO
                    指标。
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
