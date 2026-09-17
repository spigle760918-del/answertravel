import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { SourceFetchResult } from "../citation-source/safe-source-fetcher.js";

export const websitePageKeySchema = z.enum(["home", "about", "product", "questions", "terms"]);
export type WebsitePageKey = z.infer<typeof websitePageKeySchema>;
export type WebsiteTarget = { key: WebsitePageKey; label: string; url: string };

const pageSchema = z.object({
  key: websitePageKeySchema, label: z.string().min(1), url: z.string().url(),
  status: z.enum(["succeeded", "blocked", "failed"]), httpStatus: z.number().int().nullable(),
  title: z.string().nullable(), contentSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  errorCode: z.string().nullable(), textExcerpt: z.string().nullable(),
  documentSignals: z.object({ metaDescription:z.string().nullable(),canonicalUrl:z.string().nullable(),robots:z.string().nullable(),h1Count:z.number().int().nonnegative(),h2Count:z.number().int().nonnegative(),jsonLdTypes:z.array(z.string()),imageCount:z.number().int().nonnegative(),missingAltCount:z.number().int().nonnegative(),internalLinkCount:z.number().int().nonnegative() }).nullable(),
});

export const websiteDiagnosisSchema = z.object({
  id:z.string().uuid(),tenantId:z.string().uuid(),rulesVersion:z.literal("website-diagnosis.v1"),inputSha256:z.string().regex(/^[a-f0-9]{64}$/),
  status:z.literal("complete_with_gaps"),factLevel:z.literal("F2"),targetCount:z.number().int().positive().max(5),succeededCount:z.number().int().nonnegative(),blockedCount:z.number().int().nonnegative(),failedCount:z.number().int().nonnegative(),
  pages:z.array(pageSchema).min(1).max(5),strengths:z.array(z.string().min(1)),gaps:z.array(z.string().min(1)),selfReportedClaims:z.array(z.string().min(1)),decisionSignals:z.array(z.enum(["website_structure_gap"])),
  publicationAuthorized:z.literal(false),createdAt:z.string().datetime({offset:true}),
});
export type WebsiteDiagnosis = z.infer<typeof websiteDiagnosisSchema>;

export function createWebsiteDiagnosis(tenantId:string,targets:WebsiteTarget[],captures:Record<WebsitePageKey,SourceFetchResult>,createdAt=new Date().toISOString()):WebsiteDiagnosis{
  if(targets.length<1||targets.length>5)throw new Error("Website diagnosis requires one to five fixed targets.");
  const pages=targets.map(target=>{const capture=captures[target.key];if(!capture)throw new Error(`Missing website capture: ${target.key}`);return pageSchema.parse({key:target.key,label:target.label,url:target.url,status:capture.status,httpStatus:capture.httpStatus,title:capture.title,contentSha256:capture.contentSha256,errorCode:capture.errorCode,textExcerpt:capture.textExcerpt,documentSignals:capture.documentSignals??null});});
  const succeeded=pages.filter(page=>page.status==="succeeded"),text=succeeded.map(page=>page.textExcerpt??"").join(" ");
  const strengths:string[]=[];const gaps:string[]=[];const selfReportedClaims:string[]=[];
  if(succeeded.some(page=>page.key==="home"))strengths.push("官网首页可公开访问并取得可校验内容哈希");else gaps.push("官网首页未取得成功快照");
  if(/北京珈程国际旅行社有限公司/u.test(text)&&/L-BJ10127/u.test(text))strengths.push("页面公开展示公司全称与旅行社业务经营许可证号");else gaps.push("公司全称或旅行社许可证号未在目标页面形成稳定可读信号");
  if(/91110112MAE7E8FC0K/u.test(text)&&/京ICP备2025121278号-1/u.test(text))strengths.push("页面公开展示统一社会信用代码与ICP备案号");else gaps.push("统一社会信用代码或ICP备案号未同时形成稳定可读信号");
  const product=pages.find(page=>page.key==="product");
  if(product?.status==="succeeded"&&/产品编号/u.test(product.textExcerpt??"")&&/(?:￥|价格|电询)/u.test(product.textExcerpt??"")&&/(?:行程|天\d晚|\d天\d晚)/u.test(product.textExcerpt??""))strengths.push("代表性产品页展示产品编号、价格状态与行程时长");else gaps.push("代表性产品页缺少可同时读取的产品编号、价格状态或行程时长");
  const structured=succeeded.filter(page=>(page.documentSignals?.jsonLdTypes.length??0)>0).length;
  const described=succeeded.filter(page=>Boolean(page.documentSignals?.metaDescription)).length;
  const canonical=succeeded.filter(page=>Boolean(page.documentSignals?.canonicalUrl)).length;
  const withH1=succeeded.filter(page=>(page.documentSignals?.h1Count??0)>0).length;
  if(structured===0)gaps.push("目标页面未发现JSON-LD机器可读结构");
  if(described<succeeded.length)gaps.push(`${succeeded.length-described}个成功页面缺少meta description`);
  if(canonical<succeeded.length)gaps.push(`${succeeded.length-canonical}个成功页面缺少canonical链接`);
  if(withH1<succeeded.length)gaps.push(`${succeeded.length-withH1}个成功页面缺少H1主标题`);
  const missingAlt=succeeded.reduce((sum,page)=>sum+(page.documentSignals?.missingAltCount??0),0);if(missingAlt>0)gaps.push(`目标页面共有${missingAlt}张图片缺少非空alt文本`);
  const ownedClaims:Array<[string,RegExp]>=[["满意度数字",/满意度[：:]?\d+/u],["销量数字",/销量[：:]?\d+/u],["保证低价",/保证低价/u],["0购物0自费",/0购物0自费/u],["救援保障",/救援保障/u]];
  for(const [label,pattern] of ownedClaims)if(pattern.test(text))selfReportedClaims.push(`${label}仅为官网自述，未升级为独立事实`);
  const inputSha256=createHash("sha256").update(JSON.stringify(pages.map(page=>({key:page.key,url:page.url,status:page.status,httpStatus:page.httpStatus,contentSha256:page.contentSha256,errorCode:page.errorCode})))).digest("hex");
  return websiteDiagnosisSchema.parse({id:randomUUID(),tenantId,rulesVersion:"website-diagnosis.v1",inputSha256,status:"complete_with_gaps",factLevel:"F2",targetCount:pages.length,succeededCount:succeeded.length,blockedCount:pages.filter(page=>page.status==="blocked").length,failedCount:pages.filter(page=>page.status==="failed").length,pages,strengths,gaps,selfReportedClaims:[...new Set(selfReportedClaims)],decisionSignals:[],publicationAuthorized:false,createdAt});
}
