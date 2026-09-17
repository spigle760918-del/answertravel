import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SourceFetchResult } from "../../src/modules/citation-source/safe-source-fetcher.js";
import { createWebsiteDiagnosis, type WebsitePageKey, type WebsiteTarget } from "../../src/modules/website-diagnosis/website-diagnosis.js";

const targets:WebsiteTarget[]=[{key:"home",label:"首页",url:"https://www.jiacheng666.com/"},{key:"product",label:"产品",url:"https://www.jiacheng666.com/lines/show_1740.html"}];
const ok=(text:string,signals:Partial<NonNullable<SourceFetchResult["documentSignals"]>>={}):SourceFetchResult=>({status:"succeeded",httpStatus:200,redirectChain:[],contentType:"text/html",title:"页面",author:null,publishedAt:null,textExcerpt:text,contentSha256:"a".repeat(64),errorCode:null,retryable:false,documentSignals:{metaDescription:null,canonicalUrl:null,robots:null,h1Count:0,h2Count:0,jsonLdTypes:[],imageCount:2,missingAltCount:1,internalLinkCount:4,...signals}});
describe("website diagnosis",()=>{
  it("separates deterministic page signals from owned-site claims",()=>{const captures={home:ok("北京珈程国际旅行社有限公司 L-BJ10127 91110112MAE7E8FC0K 京ICP备2025121278号-1 满意度100 销量688 保证低价"),product:ok("产品编号 jxt003 ￥2280 北京5天4晚行程 0购物0自费 救援保障",{metaDescription:"产品",canonicalUrl:"https://www.jiacheng666.com/lines/show_1740.html",h1Count:1})} as Record<WebsitePageKey,SourceFetchResult>;const x=createWebsiteDiagnosis(randomUUID(),targets,captures);expect(x.succeededCount).toBe(2);expect(x.strengths).toEqual(expect.arrayContaining([expect.stringContaining("许可证号"),expect.stringContaining("产品编号")]));expect(x.gaps).toEqual(expect.arrayContaining([expect.stringContaining("JSON-LD")]));expect(x.selfReportedClaims.length).toBeGreaterThan(0);expect(x.decisionSignals).toEqual([]);expect(x.publicationAuthorized).toBe(false);});
  it("fails closed when a fixed capture is missing",()=>{expect(()=>createWebsiteDiagnosis(randomUUID(),targets,{home:ok("首页")} as Record<WebsitePageKey,SourceFetchResult>)).toThrow(/Missing website capture/);});
});
