import { observationPlanListSchema } from "../../contracts/product-read";
import { Empty, ErrorState, formatDate, labelOf, Loading, PageHeader, Status, TableLink } from "./components/ProductUi";
import { useApi } from "./hooks/useApi";

export function MonitoringPlansPage({navigate}:{navigate:(to:string)=>void}) {
  const {data,error,retry}=useApi("/api/v1/observation-plans",observationPlanListSchema);
  if(error)return <><PageHeader eyebrow="AI 监测" title="监测计划" description="查看真实监测使用的问题组、渠道、模型、样本数与授权状态。"/><ErrorState message={error} retry={retry}/></>;
  if(!data)return <Loading/>;
  return <>
    <PageHeader eyebrow="AI 监测" title="监测计划" description="计划定义监测范围和采集口径；执行结果、失败与费用进入运行记录。" actions={<button className="button button--secondary" onClick={()=>navigate("/monitoring/questions")}>查看游客问题管理</button>}/>
    {!data.items.length?<Empty title="尚无监测计划" description="当前只读工作台不会代你创建计划或产生模型费用。"/>:<section className="table-panel">
      <div className="section-head"><div><h2>全部计划</h2><p>每个计划绑定不可变问题组版本和真实采集渠道。</p></div></div>
      <div className="table-scroll"><table><thead><tr><th>计划</th><th>问题组</th><th>采集渠道</th><th>计划样本</th><th>执行授权</th><th>创建时间</th></tr></thead><tbody>{data.items.map((plan)=><tr key={plan.id}>
        <td><TableLink onClick={()=>navigate(`/monitoring/runs/${plan.id}`)}><span><strong>{plan.cycleKey??"首次监测"}</strong><small>查看对应运行记录</small></span></TableLink></td>
        <td>V{plan.questionPanelVersion}</td><td><strong>{labelOf(plan.provider)} · {plan.model}</strong><small>{labelOf(plan.surface)}</small></td><td>{plan.plannedSamples}</td><td><Status value={plan.authorized?"authorized":"not_authorized"} tone={plan.authorized?"good":"neutral"}/></td><td>{formatDate(plan.createdAt)}</td>
      </tr>)}</tbody></table></div>
    </section>}
  </>;
}
