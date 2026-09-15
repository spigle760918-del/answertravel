import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

export const claimVerdictSchema=z.enum(["fact_consistent","fact_conflict","self_reported_only","insufficient_evidence","not_applicable"]);
export const claimFindingSchema=z.object({id:z.string().uuid(),tenantId:z.string().uuid(),runId:z.string().uuid(),answerId:z.string().uuid(),claimText:z.string().min(1),evidenceExcerpt:z.string().min(1),verdict:claimVerdictSchema,
  severity:z.enum(["info","warning","critical"]),matchedRule:z.string().min(1).nullable(),brandFactId:z.string().uuid().nullable(),reason:z.string().min(1),createdAt:z.string().datetime({offset:true})});
export const claimVerificationRunSchema=z.object({id:z.string().uuid(),tenantId:z.string().uuid(),answerId:z.string().uuid(),brandTruthCardId:z.string().uuid(),brandTruthVersion:z.number().int().positive(),rulesVersion:z.literal("brand-claim-verification.v1"),
  inputSha256:z.string().regex(/^[a-f0-9]{64}$/),status:z.literal("completed"),findingCount:z.number().int().nonnegative(),analyzedAt:z.string().datetime({offset:true})});
export type ClaimFinding=z.infer<typeof claimFindingSchema>; export type ClaimVerificationRun=z.infer<typeof claimVerificationRunSchema>;

const conflictRules=[
  [/(?:成立|深耕|经营)[^。！？\n]{0,12}(?:13|十三)年|(?:13|十三)年[^。！？\n]{0,8}(?:旅行社|经验)/u,"成立13年/深耕13年"],
  [/(?:深耕|经营)[^。！？\n]{0,12}(?:20|二十)年/u,"深耕20年"],[/前身[^。！？\n]{0,8}2005|2005年[^。！？\n]{0,8}成立/u,"前身2005年"],
  [/(?:5A|5a|AAAAA)级?旅行社/u,"5A级旅行社"],[/(?:256|二百五十六)[^。！？\n]{0,8}(?:导游|持证)/u,"256人导游团队"],
  [/(?:500\+?|五百)[^。！？\n]{0,8}(?:车辆|车队)/u,"500+车辆"],[/百人[^。！？\n]{0,8}(?:定制师|团队)/u,"百人定制师"],
  [/(?:年服务|服务游客)[^。！？\n]{0,10}(?:10万|十万)/u,"年服务10万人次"],[/(?:累计服务|累计)[^。！？\n]{0,10}(?:100万|百万)/u,"累计100万+人次"],
  [/(?:连续)?五年[^。！？\n]{0,8}零投诉/u,"连续五年零投诉"],[/(?:行业)?口碑[^。！？\n]{0,8}(?:榜首|第一)/u,"行业口碑榜首"],
] as const;
const selfReportedRules=[[/京小团/u,"京小团品牌归属"],[/(?:销量|已售)[^。！？\n]{0,12}\d+/u,"官网销量自述"],[/满意度[^。！？\n]{0,8}(?:100|百分之百)/u,"官网满意度自述"],[/(?:北京十佳|十大诚信|综合实力突出)/u,"官网宣传语"]] as const;
const consistentRules=[
  [/2024年(?:12月(?:0?6|6)日|12月)|成立于2024/u,"工商登记成立日期"],[/L-BJ10127/u,"旅行社业务经营许可证"],
  [/国内旅游[^。！？\n]{0,12}入境旅游|入境旅游[^。！？\n]{0,12}国内旅游/u,"许可经营业务"],[/(?:2280|2,?280)[^。！？\n]{0,16}(?:2480|2,?480)/u,"产品价格区间"],
  [/(?:12人|十二人)[^。！？\n]{0,8}(?:小团|精品团)/u,"12人精品小团"],[/0购物[^。！？\n]{0,12}0自费|零购物[^。！？\n]{0,12}零自费/u,"产品页面纯玩承诺"],
] as const;
const segments=(text:string)=>text.split(/(?<=[。！？!?；;\n])/u).map(x=>x.replace(/^\s*(?:[-*]|\d+[.、)])\s*/u,"").trim()).filter(x=>x.length>=8);

export function verifyBrandClaims(input:{tenantId:string;answerId:string;answerText:string;brandName:string;brandTruthCardId:string;brandTruthVersion:number;facts:Array<{id:string;statement:string}>;createdAt:string}):{run:ClaimVerificationRun;findings:ClaimFinding[]}{
  const inputSha256=createHash("sha256").update(JSON.stringify({answerId:input.answerId,text:input.answerText,truth:input.brandTruthCardId,version:input.brandTruthVersion,rules:"brand-claim-verification.v1"})).digest("hex");
  const runId=randomUUID(); const findings:ClaimFinding[]=[];
  for(const claimText of segments(input.answerText)){
    const conflict=conflictRules.find(([pattern])=>pattern.test(claimText)); const selfReported=selfReportedRules.find(([pattern])=>pattern.test(claimText)); const consistent=consistentRules.find(([pattern])=>pattern.test(claimText));
    let verdict:z.infer<typeof claimVerdictSchema>="not_applicable",severity:"info"|"warning"|"critical"="info",matchedRule:string|null=null,reason="该片段未形成当前规则可核验的品牌事实主张。",brandFactId:string|null=null;
    if(conflict){verdict="fact_conflict";severity="critical";matchedRule=conflict[1];reason=`命中已确认的污染/矛盾规则：${conflict[1]}。该结果是事实核验预警，不是法律结论。`;}
    else if(selfReported){verdict="self_reported_only";severity="warning";matchedRule=selfReported[1];reason=`该信息目前只有品牌官网或营销材料自述，缺少第三方交叉核验：${selfReported[1]}。`;}
    else if(consistent){verdict="fact_consistent";matchedRule=consistent[1];const fact=input.facts.find(f=>f.statement.includes(consistent[1])||consistent[0].test(f.statement));brandFactId=fact?.id??null;reason=`与当前批准品牌真相一致：${consistent[1]}。`;}
    else if(claimText.includes(input.brandName)||/(?:该公司|该旅行社|珈程|其产品|他们)/u.test(claimText)){verdict="insufficient_evidence";severity="warning";reason="回答形成了品牌相关描述，但当前批准事实不足以证明或否定，保持证据不足。";}
    if(verdict!=="not_applicable") findings.push(claimFindingSchema.parse({id:randomUUID(),tenantId:input.tenantId,runId,answerId:input.answerId,claimText,evidenceExcerpt:claimText,verdict,severity,matchedRule,brandFactId,reason,createdAt:input.createdAt}));
  }
  const run=claimVerificationRunSchema.parse({id:runId,tenantId:input.tenantId,answerId:input.answerId,brandTruthCardId:input.brandTruthCardId,brandTruthVersion:input.brandTruthVersion,rulesVersion:"brand-claim-verification.v1",inputSha256,status:"completed",findingCount:findings.length,analyzedAt:input.createdAt});
  return {run,findings};
}
