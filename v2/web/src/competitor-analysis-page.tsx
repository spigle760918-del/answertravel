import { competitorAnalysisSchema } from "../../contracts/product-read";
import { GitCompareArrows, ShieldCheck, TriangleAlert } from "lucide-react";
import { ContextBar, Empty, ErrorState, labelOf, Loading, Metric, PageHeader, Status } from "./components/ProductUi";
import { useApi } from "./hooks/useApi";

type AnalysisItem=ReturnType<typeof competitorAnalysisSchema.parse>["items"][number];
const tone=(value:AnalysisItem["comparability"])=>value==="comparable"?"good" as const:value==="insufficient"?"warn" as const:"neutral" as const;
const comparability=(value:AnalysisItem["comparability"])=>value==="comparable"?"可比较":value==="insufficient"?"样本不足":"不可比较";
function metric(entity:{name:string;analyzedAnswers:number;mentionedAnswers:number;certainMentions:number;applicableRanks:number[]}){return <div className="competitor-entity"><strong>{entity.name}</strong><span>{entity.analyzedAnswers} 条已分析回答</span><span>{entity.mentionedAnswers} 条回答明确出现 · {entity.certainMentions} 处提及</span><small>适用排名：{entity.applicableRanks.length?entity.applicableRanks.join("、"):"不适用"}</small></div>}
function QuestionCard({item}:{item:AnalysisItem}){return <article className="analysis-mobile-card competitor-question-card"><header><div><strong>{item.text}</strong><small>{labelOf(item.objectType)} · {labelOf(item.journeyStage)}</small></div><Status value={comparability(item.comparability)} tone={tone(item.comparability)}/></header><div className="competitor-card-body"><div><dt>本品牌</dt>{metric(item.brand)}</div>{item.competitors.map(entity=><div key={entity.entityId}><dt>{labelOf(entity.relationshipType)}</dt>{metric(entity)}</div>)}</div><p className="competitor-reason">{item.reason}</p></article>}

export function CompetitorAnalysisPage(){
  const {data,error,retry}=useApi("/api/v1/competitor-analysis",competitorAnalysisSchema);
  if(error)return <><PageHeader eyebrow="数据分析" title="竞争对手分析" description="围绕同一个游客提问，比较本品牌与已确认竞争实体的真实回答证据。"/><ErrorState message={error} retry={retry}/></>;
  if(!data)return <Loading/>;
  const comparable=data.items.filter(item=>item.comparability==="comparable").length;
  const insufficient=data.items.filter(item=>item.comparability==="insufficient").length;
  return <><PageHeader eyebrow="数据分析" title="竞争对手分析" description="围绕同一个游客提问，比较本品牌与已确认竞争实体的真实回答证据。"/>
    {data.context?<ContextBar><strong>当前分析口径</strong><span>问题组 V{data.context.panelVersion}</span><span>{labelOf(data.context.provider??"未记录")} · {data.context.model??"模型未记录"}</span><span>{data.context.effectiveSamples} 有效 · {data.context.failedSamples} 失败</span><span>竞争范围 {data.scope?`V${data.scope.version}`:"未建立"}</span></ContextBar>:null}
    <section className="metric-grid analysis-summary"><Metric label="游客提问" value={data.items.length} note="当前批准问题组"/><Metric label="可比较问题" value={comparable} note="品牌与竞对均有有效分析"/><Metric label="样本不足" value={insufficient} note="不会推断谁更强"/><Metric label="竞争范围" value={data.scope?`V${data.scope.version}`:"未建立"} note={data.scope?.region??"需先确认范围"}/></section>
    {!data.items.length?<Empty title="尚无游客提问" description="需要先批准问题组并完成真实回答分析。"/>:<><section className="table-panel analysis-desktop-table"><div className="section-head"><div><h2>按游客提问比较回答表现</h2><p>只统计同一问题组、同一采集口径下已完成 GEO 分析的回答；失败样本不会被算作未出现。</p></div></div><div className="table-scroll"><table><thead><tr><th>游客提问</th><th>比较状态</th><th>本品牌</th><th>已确认竞争实体</th><th>原因</th></tr></thead><tbody>{data.items.map(item=><tr key={item.id}><td><strong>{item.text}</strong><small>{labelOf(item.objectType)} · {labelOf(item.journeyStage)}</small></td><td><Status value={comparability(item.comparability)} tone={tone(item.comparability)}/></td><td>{metric(item.brand)}</td><td><div className="competitor-entity-list">{item.competitors.length?item.competitors.map(entity=><div key={entity.entityId}>{metric(entity)}</div>):<span className="evidence-missing">没有已确认竞争实体</span>}</div></td><td>{item.reason}</td></tr>)}</tbody></table></div></section><section className="analysis-mobile-cards">{data.items.map(item=><QuestionCard key={item.id} item={item}/>)}</section></>}
    <div className="notice"><TriangleAlert/><div><strong>比较边界</strong><p>本页不计算市场份额、综合竞争力或自动生成竞品名单；只有版本化竞争范围与同口径有效回答同时满足时，才显示“可比较”。</p></div></div>
    <div className="evidence-note standalone"><ShieldCheck/><span>每个数字都可回到对应游客提问、原始回答、GEO 分析运行和竞争范围版本。</span></div>
  </>;
}
