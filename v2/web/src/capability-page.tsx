import { ArrowRight, CircleDotDashed, ShieldCheck } from "lucide-react";
import { PageHeader } from "./components/ProductUi";

const capability:Record<string,{group:string;title:string;purpose:string;available:string;missing:string;next:string}>={
  "/monitoring/schedules":{group:"AI 监测",title:"周期监测",purpose:"按固定口径持续产生监测周期，并知道下次运行、预算和最近结果。",available:"当前后端仅有固定日频 DeepSeek API 能力。",missing:"写操作尚未接入此客户工作台。",next:"先核对现有计划和运行记录。"},
  "/monitoring/channels":{group:"AI 监测",title:"采集渠道",purpose:"核对答案来自哪个平台、模型和采集方式，以及渠道当前是否可用。",available:"已验证 DeepSeek 官方 API。",missing:"其他平台与网页终端尚未形成已验收适配器。",next:"未接入渠道不会显示为可选。"},
  "/monitoring/runs":{group:"AI 监测",title:"运行记录（含失败与费用）",purpose:"查看每次计划的成功、失败、费用和证据入口。",available:"运行数据已经接入。",missing:"独立运行列表正在从监测计划中拆分。",next:"当前请从监测计划进入具体运行。"},
  "/analysis/visibility":{group:"数据分析",title:"AI 可见性",purpose:"在明确样本口径下理解品牌是否自然出现、如何被描述、是否被推荐。",available:"提及、主张和条件排名事实已经保存。",missing:"独立汇总页尚未接入。",next:"当前可在游客提问分析中按问题核对。"},
  "/analysis/competitors":{group:"数据分析",title:"竞争对手分析",purpose:"在同一问题与采集口径下比较品牌和已确认竞争对手。",available:"实体提及、主张和条件排名已有真实证据。",missing:"版本化竞争范围业务契约尚未完成。",next:"先在游客提问分析中查看问题级竞争对手事实。"},
  "/analysis/questions":{group:"数据分析",title:"问题表现分析",purpose:"识别哪些游客问题存在品牌缺席、竞争对手领先、风险主张或信源不足。",available:"问题、回答和分析事实均可追溯。",missing:"尚未建立不会误导用户的跨问题排序契约。",next:"逐问题分析，不生成临时机会分。"},
  "/analysis/platforms":{group:"数据分析",title:"AI 平台比较",purpose:"比较同一问题在不同真实 AI 平台的表现差异。",available:"当前只有 DeepSeek 官方 API。",missing:"没有第二个已验收平台，当前不可比较。",next:"继续保留单平台证据，不生成模拟对比。"},
  "/analysis/sources":{group:"数据分析",title:"引用与来源",purpose:"查看链接候选、来源页面和品牌/竞争对手依赖的信源差异。",available:"引用候选与来源快照已经保存。",missing:"独立跨问题聚合页尚未接入。",next:"当前可在游客提问分析中按问题核对。"},
  "/analysis/history":{group:"数据分析",title:"历史变化",purpose:"按可比较周期查看品牌、竞品、问题和信源变化。",available:"原始周期和计划证据保留。",missing:"当前口径不足以形成连续趋势。",next:"口径变化时不拼接趋势线。"},
  "/evidence/answers":{group:"证据",title:"原始回答",purpose:"核对模型实际回答和完整采集上下文。",available:"原始回答详情已接入。",missing:"独立跨计划检索页尚未接入。",next:"当前从问题分析或运行记录进入回答。"},
  "/evidence/sources":{group:"证据",title:"引用来源",purpose:"核对每个链接候选及证据状态。",available:"引用事件已经保存。",missing:"独立来源列表尚未接入。",next:"当前从问题分析查看信源计数。"},
  "/evidence/snapshots":{group:"证据",title:"页面快照",purpose:"检查公开来源页面的抓取事实与内容指纹。",available:"成功、受阻和失败快照均保留。",missing:"独立快照列表尚未接入。",next:"不把抓取成功等同于模型引用。"},
  "/evidence/packages":{group:"证据",title:"证据包",purpose:"把问题、回答、来源和分析规则组成可审计集合。",available:"证据引用关系已经存在。",missing:"用户可管理的冻结与导出契约尚未建立。",next:"当前只提供可追溯下钻。"},
  "/decisions":{group:"闭环",title:"决策与行动",purpose:"从根因、替代解释和缺失证据中选择正确动作。",available:"总体诊断和动作候选已经保存。",missing:"独立审批与回执页尚未接入。",next:"当前在游客提问分析中查看总体诊断范围。"},
  "/remeasurement":{group:"闭环",title:"复测",purpose:"按原问题和同口径条件检查行动后的变化。",available:"可比较周期数据结构已经存在。",missing:"当前尚无足够前后周期支撑归因。",next:"没有实验设计时只报告关联。"},
  "/truth/facts":{group:"品牌真相",title:"品牌与服务事实",purpose:"维护监测与决策所依赖的企业真实能力。",available:"已批准品牌事实卡是后端事实源。",missing:"客户只读页尚未接入。",next:"不在分析页临时编造品牌能力。"},
  "/truth/aliases":{group:"品牌真相",title:"品牌名称与别名",purpose:"明确模型回答中哪些名称属于本品牌。",available:"实体集中已有分析别名。",missing:"通用租户级版本化契约尚未完成。",next:"别名未确认时标记实体歧义。"},
  "/truth/competitors":{group:"品牌真相",title:"竞争范围",purpose:"明确系统拿谁比较、为何比较以及适用区域和时期。",available:"现有实体集支持只读分析。",missing:"直接竞品、替代方案、区域与有效期契约尚未完成。",next:"不会用固定客户名单填充。"},
  "/truth/versions":{group:"品牌真相",title:"事实版本",purpose:"核对每次事实变更及其审批来源。",available:"事实卡按不可变版本保存。",missing:"客户版本列表尚未接入。",next:"历史事实不会被覆盖。"},
};
export function CapabilityPage({path,navigate}:{path:string;navigate:(to:string)=>void}){const item=capability[path]??capability["/analysis/questions"]!;return <><PageHeader eyebrow={item.group} title={item.title} description={item.purpose}/><section className="capability-state"><CircleDotDashed/><div><span>当前状态</span><h2>页面结构已保留，能力尚未完整接入</h2><p>{item.available}</p></div></section><div className="capability-grid"><section className="panel"><span className="state-label">缺少什么</span><h3>{item.missing}</h3><p>因此这里不展示模拟数据、不提供无后端支持的按钮，也不把规划能力包装成已经可用。</p></section><section className="panel"><span className="state-label">现在怎么继续</span><h3>{item.next}</h3><button className="button button--secondary" onClick={()=>navigate("/monitoring/insights")}>返回游客提问分析 <ArrowRight/></button></section></div><div className="evidence-note standalone"><ShieldCheck/><span>该栏目属于已确认产品结构；保留入口是为了不再次把产品缩成几个孤立页面。</span></div></>}
