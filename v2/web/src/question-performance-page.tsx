import { questionPerformanceSchema } from "../../contracts/product-read";
import { CircleAlert, FileSearch, MessageSquareText, Radar, TriangleAlert } from "lucide-react";
import { ContextBar, Empty, ErrorState, labelOf, Loading, Metric, PageHeader, Status, TableLink } from "./components/ProductUi";
import { useApi } from "./hooks/useApi";

const stateOf=(item:{plannedSamples:number;effectiveAnswers:number;failedSamples:number;geoAnalyzedAnswers:number})=>{
  if(item.plannedSamples===0)return {label:"尚未采集",tone:"neutral" as const};
  if(item.effectiveAnswers===0&&item.failedSamples>0)return {label:"采集失败",tone:"bad" as const};
  if(item.effectiveAnswers===0)return {label:"等待采集",tone:"neutral" as const};
  if(item.geoAnalyzedAnswers===0)return {label:"等待分析",tone:"warn" as const};
  if(item.geoAnalyzedAnswers<item.effectiveAnswers)return {label:"部分分析",tone:"warn" as const};
  return {label:"可分析",tone:"good" as const};
};

type QuestionPerformanceItem=ReturnType<typeof questionPerformanceSchema.parse>["items"][number];

function QuestionPerformanceCard({item,onOpen}:{item:QuestionPerformanceItem;onOpen:()=>void}){
  const state=stateOf(item);
  return <article className="question-performance-card">
    <header className="question-performance-card__title">
      <span><strong>{item.text}</strong><small>{labelOf(item.objectType)} · {labelOf(item.journeyStage)}{item.audience?` · ${item.audience}`:""}</small></span>
      <Status value={state.label} tone={state.tone}/>
    </header>
    <dl>
      <div><dt>回答与失败</dt><dd>{item.effectiveAnswers} 有效 · {item.failedSamples} 失败<small>{item.plannedSamples} 个计划样本</small></dd></div>
      <div><dt>品牌出现</dt><dd>{item.geoAnalyzedAnswers?`${item.brandMentionAnswers} / ${item.geoAnalyzedAnswers}`:"未分析"}<small>{item.geoAnalyzedAnswers?"已分析回答":"尚无 GEO 分析"}</small></dd></div>
      <div><dt>竞争对手出现</dt><dd>{item.geoAnalyzedAnswers?`${item.competitorMentionAnswers} / ${item.geoAnalyzedAnswers}`:"未分析"}<small>{item.geoAnalyzedAnswers?"已分析回答":"不生成演示竞品"}</small></dd></div>
      <div><dt>引用与来源</dt><dd>{item.citationCandidates} 个链接候选<small>{item.sourceSnapshots} 个页面快照</small></dd></div>
    </dl>
    <button className="question-performance-card__open" onClick={onOpen}>查看这个游客提问的回答与证据</button>
  </article>;
}

export function QuestionPerformancePage({navigate}:{navigate:(to:string)=>void}){
  const {data,error,retry}=useApi("/api/v1/question-performance",questionPerformanceSchema);
  if(error)return <><PageHeader eyebrow="数据分析" title="问题表现分析" description="围绕每个游客提问核对回答、品牌、竞争对手和来源证据。"/><ErrorState message={error} retry={retry}/></>;
  if(!data)return <Loading/>;
  const analyzable=data.items.filter(item=>item.geoAnalyzedAnswers>0).length;
  return <><PageHeader eyebrow="数据分析" title="问题表现分析" description="不计算脱离证据的机会分；逐个游客提问查看真实样本、分析覆盖和下一步。"/>
    {data.context?<ContextBar><strong>当前分析口径</strong><span>问题组 V{data.context.panelVersion}</span><span>{labelOf(data.context.provider??"未记录")} · {data.context.model??"模型未记录"}</span><span>{labelOf(data.context.surface??"未记录")}</span><span>{data.context.rulesVersion??"规则未记录"}</span></ContextBar>:null}
    <section className="metric-grid question-performance-summary"><Metric label="游客提问" value={data.items.length} note="当前批准问题组"/><Metric label="有效回答" value={data.context?.effectiveSamples??0} note="可下钻原始回答"/><Metric label="失败样本" value={data.context?.failedSamples??0} note="失败证据保留"/><Metric label="已具备分析" value={analyzable} note="至少一条回答完成 GEO 分析"/></section>
    {!data.items.length?<Empty title="尚无可分析的游客提问" description="需要先批准游客问题组；页面不会以关键词或模拟问题代替。"/>:<><section className="table-panel question-performance-table"><div className="section-head"><div><h2>按游客提问查看表现</h2><p>品牌和竞争对手计数均表示“出现于多少条有效回答”，不是市场份额。</p></div></div><div className="table-scroll"><table><thead><tr><th>游客提问</th><th>回答与失败</th><th>品牌出现</th><th>竞争对手出现</th><th>引用与来源</th><th>当前状态</th></tr></thead><tbody>{data.items.map(item=>{const state=stateOf(item);return <tr key={item.id}><td><TableLink onClick={()=>navigate(`/monitoring/insights/${item.id}`)}><span><strong>{item.text}</strong><small>{labelOf(item.objectType)} · {labelOf(item.journeyStage)}{item.audience?` · ${item.audience}`:""}</small></span></TableLink></td><td><span className="count-stack"><b>{item.effectiveAnswers} 有效</b><small>{item.failedSamples} 失败 / {item.plannedSamples} 计划样本</small></span></td><td>{item.geoAnalyzedAnswers?<span className="count-stack"><b>{item.brandMentionAnswers} / {item.geoAnalyzedAnswers}</b><small>已分析回答</small></span>:<span className="evidence-missing">未分析</span>}</td><td>{item.geoAnalyzedAnswers?<span className="count-stack"><b>{item.competitorMentionAnswers} / {item.geoAnalyzedAnswers}</b><small>已分析回答</small></span>:<span className="evidence-missing">未分析</span>}</td><td><span className="count-stack"><b>{item.citationCandidates} 个链接候选</b><small>{item.sourceSnapshots} 个页面快照</small></span></td><td><Status value={state.label} tone={state.tone}/></td></tr>})}</tbody></table></div></section><section className="question-performance-cards" aria-label="按游客提问查看表现">{data.items.map(item=><QuestionPerformanceCard key={item.id} item={item} onOpen={()=>navigate(`/monitoring/insights/${item.id}`)}/>)}</section></>}
    <section className="question-analysis-rules"><div><MessageSquareText/><span><strong>提问是分析单位</strong><small>不同问题类型不混算一个提及率。</small></span></div><div><Radar/><span><strong>分析以有效回答为分母</strong><small>失败样本单独保留，不当作品牌缺席。</small></span></div><div><FileSearch/><span><strong>链接只是候选</strong><small>页面快照成功也不等于模型明确引用。</small></span></div><div><CircleAlert/><span><strong>没有排名就显示不适用</strong><small>不从普通叙述中硬算顺序。</small></span></div></section>
    <div className="notice"><TriangleAlert/><div><strong>如何决定先处理哪个提问</strong><p>先看是否有足够有效回答和完整分析，再看品牌、竞争对手与来源差异；证据不足时先补采，不直接给内容任务。</p></div></div>
  </>;
}
