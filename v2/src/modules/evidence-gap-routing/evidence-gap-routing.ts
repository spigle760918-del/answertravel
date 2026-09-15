import {createHash,randomUUID} from "node:crypto";
import {z} from "zod";

export const gapThemeSchema=z.enum(["itinerary_service","pricing_offer","pure_play_assurance","license_trust","family_suitability","product_portfolio","customization","small_group_experience","refund_cancellation","other"]);
export const actionRouteSchema=z.enum(["brand_truth","website_structure","external_source","product_service","content_brief_candidate","observe_only","manual_review"]);
export const gapClusterSchema=z.object({id:z.string().uuid(),tenantId:z.string().uuid(),snapshotId:z.string().uuid(),theme:gapThemeSchema,title:z.string().min(1),factLevel:z.literal("F3"),priorityScore:z.number().int().min(0).max(100),occurrenceCount:z.number().int().positive(),uniqueClaimCount:z.number().int().positive(),cycleCount:z.number().int().positive(),findingIds:z.array(z.string().uuid()).min(1),recommendedRoute:actionRouteSchema,
  rationale:z.string().min(1),noActionOption:z.string().min(1),minimalHumanQuestion:z.string().nullable(),expectedWindow:z.string().min(1),risk:z.enum(["low","medium","high"]),contentBriefEligible:z.boolean()});
export const gapRoutingSnapshotSchema=z.object({id:z.string().uuid(),tenantId:z.string().uuid(),rulesVersion:z.literal("evidence-gap-routing.v1"),inputSha256:z.string().regex(/^[a-f0-9]{64}$/),status:z.literal("completed"),sourceFindingCount:z.number().int().nonnegative(),clusterCount:z.number().int().nonnegative(),clusters:z.array(gapClusterSchema),createdAt:z.string().datetime({offset:true})});
export type GapRoutingSnapshot=z.infer<typeof gapRoutingSnapshotSchema>;
export type GapInput={findingId:string;verdict:"insufficient_evidence"|"self_reported_only";claimText:string;question:string;panelRole:string;cycleKey:string};

const definitions:Array<{theme:z.infer<typeof gapThemeSchema>;title:string;match:RegExp;route:z.infer<typeof actionRouteSchema>;base:number;risk:"low"|"medium"|"high";question:string|null;rationale:string}>= [
 {theme:"refund_cancellation",title:"退款与临时取消规则",match:/退款|取消|去不了/u,route:"product_service",base:70,risk:"high",question:"请确认现行合同中，游客在不同取消时间点的退款比例、已发生费用和办理时限。",rationale:"退款承诺必须来自真实合同与执行政策，不能先用内容补位。"},
 {theme:"license_trust",title:"旅行社资质与可信核验",match:/资质|许可证|监管服务平台|文旅局|信用中国/u,route:"external_source",base:65,risk:"high",question:null,rationale:"已有许可证事实，但 AI 多次无法核实，应加强官方/持牌平台可发现证据和官网实体一致性。"},
 {theme:"pure_play_assurance",title:"纯玩、购物与自费保障",match:/纯玩|购物|自费|投诉|行政处罚/u,route:"external_source",base:65,risk:"high",question:"请确认可公开的合同条款、违约处理与投诉处理流程，是否有脱敏样例。",rationale:"承诺需要合同和可核验履约证据，单纯宣传文章不足以建立可信度。"},
 {theme:"family_suitability",title:"老人、儿童与家庭适配",match:/老人|小孩|儿童|亲子|家庭|步行强度/u,route:"brand_truth",base:58,risk:"medium",question:"请补充每日步行量、早起次数、台阶/无障碍、儿童年龄、老人健康限制和车辆座位规则。",rationale:"当前缺少适用与不适用边界，应先补真实产品颗粒度。"},
 {theme:"customization",title:"定制与行程调整能力",match:/定制|调整幅度|调整空间|游客需求/u,route:"brand_truth",base:55,risk:"medium",question:"请确认哪些项目可调整、最晚何时确认、最低成团人数及可能增加的费用。",rationale:"AI 正在用行业常识推测品牌能力，应先确认实际服务边界。"},
 {theme:"pricing_offer",title:"价格、包含项与优惠",match:/价格|报价|优惠|促销|价目/u,route:"website_structure",base:54,risk:"medium",question:"请确认当前可公开的价格有效期、儿童/单房差、旺季浮动和优惠条件。",rationale:"已有价格区间，但实时性和费用条件不足，适合建设带更新时间的产品事实区。"},
 {theme:"product_portfolio",title:"产品矩阵与其他线路",match:/还有哪些|产品清单|不同天数|最新线路/u,route:"brand_truth",base:50,risk:"low",question:"除5天4晚外，目前真实在售的线路名称、天数、人群、价格区间分别是什么？",rationale:"当前只核验了一款产品，不能依据行业惯例扩写产品矩阵。"},
 {theme:"small_group_experience",title:"12人小团真实体验",match:/12人|小团.*体验|带图评价|近期.*评价/u,route:"brand_truth",base:49,risk:"medium",question:"请补充12人团的车辆、导游配置、集合接送、等待时间、餐住标准和真实适用边界。",rationale:"团型数字已核验，但体验颗粒度和第三方评价证据不足。"},
 {theme:"itinerary_service",title:"5天4晚行程与服务清单",match:/行程安排|景点和服务|服务清单|行程单|具体行程/u,route:"website_structure",base:52,risk:"low",question:"请确认当前有效行程版本、每日时间线、餐住车导标准及最后更新时间。",rationale:"已有基础产品事实，但 AI 仍无法读取具体清单，优先改善官网结构与新鲜度。"},
];
const norm=(s:string)=>s.toLocaleLowerCase("zh-CN").replace(/[\s，。、“”‘’；：,.!?！？;:*_()（）\-]/g,"");

export function routeEvidenceGaps(tenantId:string,inputs:GapInput[],createdAt=new Date().toISOString()):GapRoutingSnapshot{
 const relevant=inputs.filter(x=>["insufficient_evidence","self_reported_only"].includes(x.verdict));const snapshotId=randomUUID();const grouped=new Map<string,GapInput[]>();
 for(const item of relevant){const d=definitions.find(x=>x.match.test(`${item.question} ${item.claimText}`));const theme=d?.theme??"other";grouped.set(theme,[...(grouped.get(theme)??[]),item]);}
 const clusters=[...grouped.entries()].map(([theme,items])=>{const d=definitions.find(x=>x.theme===theme);const unique=new Set(items.map(x=>norm(x.claimText))).size,cycles=new Set(items.map(x=>x.cycleKey)).size,baseline=items.some(x=>x.panelRole==="baseline")?8:0;
   const score=Math.min(100,(d?.base??25)+Math.min(15,unique*2)+Math.min(12,(cycles-1)*6)+baseline);const route=d?.route??"manual_review";
   return gapClusterSchema.parse({id:randomUUID(),tenantId,snapshotId,theme,title:d?.title??"待人工复核的其他描述",factLevel:"F3",priorityScore:score,occurrenceCount:items.length,uniqueClaimCount:unique,cycleCount:cycles,findingIds:items.map(x=>x.findingId),recommendedRoute:route,
     rationale:d?.rationale??"现有规则无法可靠归类，保持待复核。",noActionOption:"暂不行动，保留现有证据并在后续周期观察是否重复出现。",minimalHumanQuestion:d?.question??null,expectedWindow:route==="product_service"?"确认后1-2周":route==="external_source"?"2-6周":"3-7天",risk:d?.risk??"medium",contentBriefEligible:route==="content_brief_candidate"});});
 clusters.sort((a,b)=>b.priorityScore-a.priorityScore||a.title.localeCompare(b.title,"zh-CN"));
 const inputSha256=createHash("sha256").update(JSON.stringify(relevant.map(x=>({id:x.findingId,verdict:x.verdict,question:x.question,claim:norm(x.claimText),role:x.panelRole,cycle:x.cycleKey})).sort((a,b)=>a.id.localeCompare(b.id)))).digest("hex");
 return gapRoutingSnapshotSchema.parse({id:snapshotId,tenantId,rulesVersion:"evidence-gap-routing.v1",inputSha256,status:"completed",sourceFindingCount:relevant.length,clusterCount:clusters.length,clusters,createdAt});
}
