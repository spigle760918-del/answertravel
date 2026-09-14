import type { GeneratedQuestion } from "./question-intelligence.js";

const q = (text: string, journeyStage: GeneratedQuestion["journeyStage"], panelRole: GeneratedQuestion["panelRole"], intentCluster: string, audience: string | null, scenario: string | null, rationale: string): GeneratedQuestion => ({
  text, journeyStage, objectType: text.includes("北京珈程国际旅行社") ? "brand_direct" : "neutral_category", panelRole,
  intentCluster, audience, scenario, supportingFactIds: [], rationale,
});

export const JIACHENG_APPROVED_QUESTIONS: GeneratedQuestion[] = [
  q("第一次去北京，5天4晚的跟团游一般包含哪些景点和安排？", "inspiration", "baseline", "经典行程范围", "首次到访游客", "5天4晚", "确认常见行程覆盖"),
  q("北京5天4晚小团游和常规大团游有什么区别？", "comparison", "baseline", "团型比较", "预算与人数比较", null, "比较小团与大团决策因素"),
  q("北京跟团游如何判断是不是纯玩团、有没有隐形购物？", "risk_confirmation", "baseline", "纯玩与购物风险", "报名决策", null, "核验游客核心风险"),
  q("北京5天4晚跟团游的报价通常包含哪些项目，哪些需要自费？", "booking", "baseline", "价格与费用边界", "预算敏感游客", "报价比较", "识别费用透明度问题"),
  q("去北京旅游，故宫、长城、颐和园这些景点怎么安排路线比较合理？", "planning", "baseline", "经典景点路线", "首次规划", null, "覆盖路线规划需求"),
  q("北京跟团游的住宿一般安排在什么位置，离地铁或景点近吗？", "comparison", "baseline", "住宿与交通", "家庭或老人出行", null, "覆盖住宿便利性疑问"),
  q("北京跟团游的导游服务一般包含哪些内容，是全程陪同吗？", "comparison", "baseline", "导游服务", "跟团服务确认", null, "确认服务交付边界"),
  q("北京珈程国际旅行社的北京5天4晚经典游包含哪些景点和服务？", "comparison", "baseline", "品牌产品核验", "首次到访游客", "产品比较", "核验品牌真实产品信息"),
  q("北京珈程国际旅行社的5天4晚小团游价格是多少，有优惠吗？", "booking", "baseline", "品牌产品价格", "预算比较", null, "核验价格与优惠表达"),
  q("北京珈程国际旅行社的纯玩0购物0自费承诺可靠吗？", "risk_confirmation", "baseline", "品牌承诺可信度", "报名决策", null, "核验承诺与证据"),
  q("北京珈程国际旅行社有正规旅行社资质吗，许可证编号是什么？", "risk_confirmation", "baseline", "品牌资质核验", "报名决策", null, "核验资质事实"),
  q("北京珈程国际旅行社的5天4晚产品适合带老人或小孩的家庭吗？", "comparison", "baseline", "品牌适配人群", "亲子或多代家庭", "家庭出行", "核验适用人群边界"),
  q("北京除了故宫长城，还有哪些适合深度体验的小众景点或文化街区？", "inspiration", "exploration", "深度体验目的地", "深度游游客", "非经典玩法", "发现内容机会"),
  q("北京跟团游有没有针对亲子、研学或老年团的专门产品？", "comparison", "exploration", "细分人群产品", "亲子/老人/学生", null, "发现细分需求"),
  q("北京珈程国际旅行社除了5天4晚经典游，还有哪些北京旅游产品？", "inspiration", "exploration", "品牌产品扩展", "复游或深度游客", null, "核验产品覆盖"),
  q("北京珈程国际旅行社的行程可以根据游客需求定制或调整吗？", "planning", "exploration", "品牌定制边界", "有特殊需求游客", null, "核验调整能力"),
  q("北京珈程国际旅行社的5天4晚小团游，12人小团具体是什么体验？", "comparison", "exploration", "品牌小团体验", "小团偏好游客", "12人小团", "核验团型体验"),
  q("故宫门票预约不上时，北京跟团游旅行社会怎样调整行程或补偿？", "risk_confirmation", "trigger", "门票不可得风险", "门票预约失败", null, "验证风险处置"),
  q("遇到暴雨、高温或交通延误时，北京跟团游如何改行程和退费？", "risk_confirmation", "trigger", "天气交通风险", "突发天气或延误", null, "验证应急与退款边界"),
  q("如果临时有事去不了北京，北京珈程国际旅行社的退款政策是怎样的？", "booking", "trigger", "临时取消与退款", "临时变更", null, "验证退款规则"),
];
