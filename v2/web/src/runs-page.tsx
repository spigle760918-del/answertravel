import { observationPlanListSchema } from "../../contracts/product-read";
import { Empty, ErrorState, formatDate, formatNumber, labelOf, Loading, PageHeader, TableLink } from "./components/ProductUi";
import { useApi } from "./hooks/useApi";

export function RunsPage({navigate}:{navigate:(to:string)=>void}) {
  const {data,error,retry}=useApi("/api/v1/observation-plans",observationPlanListSchema);
  if(error)return <><PageHeader eyebrow="AI 监测" title="运行记录（含失败与费用）" description="逐次核对运行结果、失败证据和实际用量。"/><ErrorState message={error} retry={retry}/></>;
  if(!data)return <Loading/>;
  return <>
    <PageHeader eyebrow="AI 监测" title="运行记录（含失败与费用）" description="每次执行都保留成功、失败、预算停止、Token 用量和证据入口。" actions={<button className="button button--secondary" onClick={()=>navigate("/monitoring/plans")}>查看监测计划</button>}/>
    {!data.items.length?<Empty title="尚无运行记录" description="只有真实监测计划执行后才会产生运行记录。"/>:<section className="table-panel">
      <div className="section-head"><div><h2>全部运行</h2><p>失败记录不会删除；补采和重试产生新记录。</p></div></div>
      <div className="table-scroll"><table><thead><tr><th>运行</th><th>问题组与渠道</th><th>成功</th><th>失败</th><th>预算停止</th><th>Token 用量</th><th>执行时间</th></tr></thead><tbody>{data.items.map((run)=><tr key={run.id}>
        <td><TableLink onClick={()=>navigate(`/monitoring/runs/${run.id}`)}><span><strong>{run.cycleKey??"首次监测"}</strong><small>{run.plannedSamples} 个计划样本</small></span></TableLink></td>
        <td><strong>问题组 V{run.questionPanelVersion}</strong><small>{run.model} · {labelOf(run.surface)}</small></td>
        <td><b className="good-text">{run.succeeded}</b></td><td><b className={run.failed?"bad-text":""}>{run.failed}</b></td><td>{run.budgetStopped}</td><td>{formatNumber(run.usedTokens)}</td><td>{formatDate(run.createdAt)}</td>
      </tr>)}</tbody></table></div>
    </section>}
  </>;
}
