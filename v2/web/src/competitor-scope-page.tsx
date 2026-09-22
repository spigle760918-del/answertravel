import { competitorScopeSchema } from "../../contracts/product-read";
import { GitCompareArrows, ShieldCheck, TriangleAlert } from "lucide-react";
import { Empty, ErrorState, Loading, PageHeader, Status, ContextBar, labelOf, formatDate } from "./components/ProductUi";
import { useApi } from "./hooks/useApi";

export function CompetitorScopePage(){
  const {data,error,retry}=useApi("/api/v1/competitor-scope",competitorScopeSchema);
  if(error)return <><PageHeader eyebrow="品牌真相" title="竞争范围" description="明确系统拿谁比较、为什么比较以及适用区域和时间。"/><ErrorState message={error} retry={retry}/></>;
  if(!data)return <Loading/>;
  if(data.status==="not_established")return <><PageHeader eyebrow="品牌真相" title="竞争范围" description="明确系统拿谁比较、为什么比较以及适用区域和时间。"/><div className="capability-state"><GitCompareArrows/><div><span>当前状态</span><h2>尚未建立竞争范围版本</h2><p>回答中出现的其他实体可以被观察，但尚不能被称为本品牌的竞争对手。</p></div></div><div className="notice"><TriangleAlert/><div><strong>为什么不显示竞品排名</strong><p>需要先确认实体、重叠产品/服务、区域、有效时间和证据来源；这些条件不能从一次 AI 回答自动推出。</p></div></div></>;
  const current=data.current!;
  return <><PageHeader eyebrow="品牌真相" title="竞争范围" description="只有在版本、区域、时间和证据都匹配时，才进行同口径对比。"/>
    <ContextBar><strong>当前范围 V{current.version}</strong><span>{current.region}</span><span>{current.effectiveFrom} 至 {current.effectiveTo??"当前"}</span><Status value={data.status==="approved"?"已批准":"不可比较"} tone={data.status==="approved"?"good":"warn"}/></ContextBar>
    <section className="panel scope-summary"><div className="compact-head"><div><h2>本版本说明</h2><p>{current.evidenceNote}</p></div></div><dl className="detail-grid"><div><dt>关联品牌真相</dt><dd>V{current.brandTruthVersion}</dd></div><div><dt>确认时间</dt><dd>{current.confirmedAt?formatDate(current.confirmedAt):"尚未确认"}</dd></div><div><dt>证据来源</dt><dd>{current.sourceReference}</dd></div><div><dt>实体数量</dt><dd>{data.entities.length}</dd></div></dl></section>
    <section className="table-panel"><div className="section-head"><div><h2>范围内实体</h2><p>“替代方案”和“参考实体”保留观察价值，不自动参与胜负汇总。</p></div></div>{data.entities.length?<div className="table-scroll"><table><thead><tr><th>实体</th><th>关系</th><th>重叠产品/服务</th><th>区域与有效期</th><th>状态</th></tr></thead><tbody>{data.entities.map(item=><tr key={item.id}><td><strong>{item.name}</strong><small>{item.aliases.length?`别名：${item.aliases.join("、")}`:"无已确认别名"}</small></td><td>{labelOf(item.relationshipType)}</td><td>{item.overlappingOfferings.length?item.overlappingOfferings.join("、"):"未记录"}</td><td><strong>{item.region}</strong><small>{item.effectiveFrom} 至 {item.effectiveTo??"当前"}</small></td><td><Status value={item.status} tone={item.status==="approved"?"good":item.status==="excluded"?"bad":"neutral"}/></td></tr>)}</tbody></table></div>:<Empty title="该版本没有已确认实体" description="系统不会用 AI 回答里的名字自动补成竞品。"/>}</section>
    <section className="scope-version-list panel"><div className="compact-head"><div><h2>历史范围版本</h2><p>版本不覆盖历史，以便复测时回到当时的比较口径。</p></div></div><div className="scope-version-items">{data.versions.map(item=><div key={item.id}><strong>V{item.version}</strong><Status value={item.status}/><span>{item.region} · {item.effectiveFrom} 至 {item.effectiveTo??"当前"} · {item.entityCount} 个实体</span></div>)}</div></section>
    <div className="evidence-note standalone"><ShieldCheck/><span>只读契约：本页不创建、不导入、不启动竞品直问采样。</span></div>
  </>;
}
