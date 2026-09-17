import { SafeSourceFetcher } from "../citation-source/safe-source-fetcher.js";
import { createWebsiteDiagnosis, type WebsitePageKey, type WebsiteTarget } from "./website-diagnosis.js";
import { WebsiteDiagnosisRepository } from "./website-diagnosis-repository.js";

export const JIACHENG_WEBSITE_TARGETS:WebsiteTarget[]=[
  {key:"home",label:"官网首页",url:"https://www.jiacheng666.com/"},
  {key:"about",label:"关于我们",url:"https://www.jiacheng666.com/servers/index_12.html"},
  {key:"product",label:"代表性产品详情",url:"https://www.jiacheng666.com/lines/show_1740.html"},
  {key:"questions",label:"游客问答",url:"https://www.jiacheng666.com/questions/"},
  {key:"terms",label:"服务条款",url:"https://www.jiacheng666.com/servers/index_10.html"},
];
export class WebsiteDiagnosisService{
  constructor(private readonly repository:WebsiteDiagnosisRepository,private readonly fetcher=new SafeSourceFetcher({allowedDomains:["jiacheng666.com"],timeoutMs:20_000,maximumBytes:1_000_000})){}
  async diagnose(tenantId:string){const entries=await Promise.all(JIACHENG_WEBSITE_TARGETS.map(async target=>[target.key,await this.fetcher.capture(target.url)] as const));const captures=Object.fromEntries(entries) as Record<WebsitePageKey,Awaited<ReturnType<SafeSourceFetcher["capture"]>>>;const draft=createWebsiteDiagnosis(tenantId,JIACHENG_WEBSITE_TARGETS,captures);const existing=await this.repository.byHash(tenantId,draft.inputSha256);if(existing)return{diagnosis:existing,idempotent:true};return{diagnosis:await this.repository.save(draft),idempotent:false};}
}
