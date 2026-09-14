import { randomUUID } from "node:crypto";
import { z } from "zod";
import { brandTruthCardSchema, type BrandTruthCard } from "../brand-truth/brand-truth.js";

export const benchmarkFactSchema = z.object({
  statement: z.string().min(1), category: z.enum(["identity", "product", "service", "restriction"]),
  source: z.string().min(1), evidence: z.enum(["official_registry", "licensed_platform", "self_reported", "user_provided", "web_snapshot"]),
  visibility: z.enum(["public", "internal", "restricted", "undetermined"]), accepted: z.boolean(),
});
export const benchmarkPackSchema = z.object({
  brandName: z.literal("北京珈程国际旅行社有限公司"), capturedAt: z.string().datetime({ offset: true }),
  facts: z.array(benchmarkFactSchema), contradictions: z.array(z.string()), forbiddenExpressions: z.array(z.string()),
  uncertainSignals: z.array(z.string()), sourceNote: z.string(),
});
export type BenchmarkFactPack = z.infer<typeof benchmarkPackSchema>;

export function buildBrandTruthDraftFromBenchmark(input: { tenantId: string; brandName: string; pack?: BenchmarkFactPack; createdAt?: string }): BrandTruthCard {
  const pack = input.pack ?? buildBenchmarkFactPack();
  const facts = pack.facts.filter((fact) => fact.accepted && fact.visibility === "public").map((fact) => ({
    id: randomUUID(), statement: fact.statement, category: fact.category === "restriction" ? "restriction" : fact.category,
    status: "draft" as const, factLevel: fact.evidence === "official_registry" || fact.evidence === "licensed_platform" || fact.evidence === "web_snapshot" ? "F1" as const : "F0" as const,
    public: true, visibility: "public" as const, source: { type: fact.evidence === "official_registry" || fact.evidence === "licensed_platform" || fact.evidence === "web_snapshot" ? "official" as const : "human" as const, reference: fact.source },
  }));
  return brandTruthCardSchema.parse({ id: randomUUID(), tenantId: input.tenantId, brandName: input.brandName, version: 1, status: "draft", facts, createdAt: input.createdAt ?? new Date().toISOString() });
}

export function buildBenchmarkFactPack(capturedAt = new Date().toISOString()): BenchmarkFactPack {
  return benchmarkPackSchema.parse({
    brandName: "北京珈程国际旅行社有限公司", capturedAt,
    facts: [
      { statement:"工商登记名称为北京珈程国际旅行社有限公司", category:"identity", source:"用户提供：国家企业信用信息公示系统", evidence:"official_registry", visibility:"public", accepted:true },
      { statement:"统一社会信用代码为91110112MAE7E8FC0K", category:"identity", source:"用户提供：国家企业信用信息公示系统", evidence:"official_registry", visibility:"restricted", accepted:false },
      { statement:"工商登记成立日期为2024年12月06日", category:"identity", source:"用户提供：国家企业信用信息公示系统", evidence:"official_registry", visibility:"public", accepted:true },
      { statement:"注册资本为30万元人民币", category:"identity", source:"用户提供：工商/商业信息核验资料", evidence:"official_registry", visibility:"public", accepted:true },
      { statement:"法定代表人为齐正春", category:"identity", source:"用户提供：工商登记", evidence:"official_registry", visibility:"restricted", accepted:false },
      { statement:"企业类型为有限责任公司（自然人独资）", category:"identity", source:"用户提供：工商登记", evidence:"official_registry", visibility:"public", accepted:true },
      { statement:"经营状态为存续", category:"identity", source:"用户提供：工商登记", evidence:"official_registry", visibility:"public", accepted:true },
      { statement:"持有旅行社业务经营许可证L-BJ10127", category:"service", source:"用户提供：欣欣旅游认证页", evidence:"licensed_platform", visibility:"public", accepted:true },
      { statement:"许可经营业务为国内旅游业务、入境旅游业务", category:"service", source:"用户提供：欣欣旅游认证页", evidence:"licensed_platform", visibility:"public", accepted:true },
      { statement:"旅游质量保证金已缴纳，但具体金额仅为企业自述，未获第三方核验", category:"restriction", source:"用户提供：企业自述", evidence:"self_reported", visibility:"undetermined", accepted:false },
      { statement:"在欣欣旅游平台存在资质认证有效至2028年的店铺记录", category:"service", source:"用户提供：欣欣旅游认证页", evidence:"licensed_platform", visibility:"public", accepted:true },
      { statement:"在售北京5天4晚经典游，12人精品小团，价格2280至2480元，门市价2580元", category:"product", source:"用户提供：欣欣旅游网店", evidence:"licensed_platform", visibility:"public", accepted:true },
      { statement:"该产品包含故宫、天安门广场、八达岭长城、颐和园、天坛等景点，含接送站、住宿、部分餐食和导游", category:"product", source:"用户提供：欣欣旅游网店", evidence:"licensed_platform", visibility:"public", accepted:true },
      { statement:"该产品页面标注纯玩0购物0自费，但需以正式合同为准", category:"restriction", source:"用户提供：欣欣旅游网店/合同提示", evidence:"licensed_platform", visibility:"public", accepted:true },
      { statement:"用户提供独立官网地址 https://www.jiacheng666.com/，页面主体归属与持续可用性待独立抓取核验", category:"identity", source:"用户提供：官网链接", evidence:"user_provided", visibility:"undetermined", accepted:false },
      { statement:"百度百科词条据用户资料称内容引自工商系统，页面快照与更新时间待独立核验", category:"identity", source:"用户提供：百度百科", evidence:"user_provided", visibility:"undetermined", accepted:false },
      { statement:"网易号‘小家漫漫旅程’标注官方企业号，但与北京主体的关联性存疑", category:"identity", source:"用户提供：网易号", evidence:"self_reported", visibility:"undetermined", accepted:false },
      { statement:"欣欣旅游加盟列表显示联系人齐蕊，属于基础关联线索，不等于法人或官方账号确认", category:"identity", source:"用户提供：欣欣旅游加盟列表", evidence:"licensed_platform", visibility:"undetermined", accepted:false },
      { statement:"官网自述展示‘京小团’系列产品，品牌归属和授权关系待核验", category:"product", source:"用户提供：官网自述", evidence:"self_reported", visibility:"undetermined", accepted:false },
      { statement:"官网自述展示销量365至1263、满意度100等数据，暂无第三方交易或评价证据", category:"restriction", source:"用户提供：官网自述", evidence:"self_reported", visibility:"undetermined", accepted:false },
      { statement:"基于当前证据，尚未发现可被第三方验证的差异化能力；许可证属于行业准入门槛", category:"service", source:"用户提供：事实核查结论", evidence:"user_provided", visibility:"internal", accepted:false },
      { statement:"工商宽泛经营范围不等于实际核心业务，会议展览、摄影摄像等不得直接描述为主营", category:"restriction", source:"用户提供：工商经营范围解释规则", evidence:"user_provided", visibility:"internal", accepted:false },
      { statement:"独立抓取于2026-09-14返回HTTP 200，页面标题为‘北京珈程国际旅行社_北京旅游_北京旅行社官方网站-北京珈程国际旅行社’，快照哈希为9502311745b16e40a899e848be53bf6c9d66017a2830bc04b30a385aff52432a", category:"identity", source:"独立网页快照：https://www.jiacheng666.com/", evidence:"web_snapshot", visibility:"public", accepted:true },
      { statement:"官网页脚展示旅行社经营许可证号L-BJ10127，并显示北京珈程国际旅行社有限公司及北京市通州区", category:"service", source:"独立网页快照：https://www.jiacheng666.com/", evidence:"web_snapshot", visibility:"public", accepted:false },
      { statement:"官网页面展示‘京小团’栏目、满意度100和销量399，这些属于官网自述，暂无第三方交叉核验", category:"restriction", source:"独立网页快照：https://www.jiacheng666.com/", evidence:"web_snapshot", visibility:"undetermined", accepted:false },
      { statement:"官网元描述包含‘北京十佳旅行社、十大诚信旅行社、综合实力突出’等宣传语，未见对应官方证明材料", category:"restriction", source:"独立网页快照：https://www.jiacheng666.com/", evidence:"web_snapshot", visibility:"internal", accepted:false },
    ],
    contradictions: [
      "成立日期为2024年12月06日，与‘成立13年/深耕20年/前身2005年’互相矛盾",
      "社保参保人数为0的用户资料，与‘256人导游团队/百人定制师’不能同时作为已核验事实",
      "未发现官方来源支持5A级旅行社，与‘5A级旅行社’互相矛盾",
      "‘连续五年零投诉’与成立时间不足两年不具备可比统计基础",
      "‘年服务10万人次/累计100万+人次’当前无公开证据支持",
      "此前‘独立官网未发现’与用户新提供的官网地址存在状态冲突，须以独立抓取和主体关联核验为准",
      "官网‘京小团’品牌归属、销量和满意度均为自述或存疑，不能升级为第三方事实",
      "官网页脚‘Copyright©2008-2025’与工商成立日期2024年12月06日存在时间矛盾，不能据此推导经营年限",
      "官网元描述中的‘北京十佳/十大诚信/综合实力突出’目前缺少对应官方证明，需降权处理",
    ],
    forbiddenExpressions: ["5A级旅行社","深耕北京旅游13年","成立13年","前身2005年","256人持证导游团队","500+车辆","百人定制师","年服务游客超10万人次","累计100万+人次","连续五年零投诉","行业口碑榜首","全网最低","绝对安全"],
    uncertainSignals: ["用户提供 https://www.jiacheng666.com/，尚未完成独立抓取、主体关联、HTTPS与内容快照核验","网易号‘小家漫漫旅程’标注官方企业号，但IP属地新疆且关联性存疑","百度百科存在，但具体页面内容和更新时间仍需独立快照核验","官网‘京小团’品牌归属及销量/满意度数据暂无第三方交叉证据","行政处罚记录无、经营异常名录无均需保留查询日期"],
    sourceNote: "本包由用户于2026-09-14提供，以上均为待批准基准资料；未批准字段不得进入生产品牌真相。",
  });
}
