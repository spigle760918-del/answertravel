# AnswerTravel V2 项目知识库

状态：已启动  
建立日期：2026-09-13  
当前阶段：总体基线已确认，执行 7 天单品牌/DeepSeek API Alpha 计划

## 目的

本目录是 AnswerTravel V2 的长期项目记忆和唯一决策基线，用于防止：

- 需求在多轮对话中漂移；
- 把模型推断误当成事实；
- 将第三方仓库的计划或示例误当成生产能力；
- 因缺少模块边界而反复推翻重做；
- 让不具备开发经验的业务负责人承担不必要的技术决策。

## 文档地图

| 文件 | 作用 | 当前状态 |
| --- | --- | --- |
| `01-product-charter.md` | 产品使命、用户角色、AI 自治边界、成功标准 | 已确认 |
| `02-architecture-baseline.md` | 总体架构、模块边界、数据链和推荐技术形态 | 已确认 |
| `03-vibe-coding-sop.md` | 从需求到上线的严格开发 SOP 和门禁 | 已确认 |
| `04-source-ledger.md` | GitHub 项目、内部文档和证据边界 | 已建立，持续更新 |
| `05-decision-log.md` | 已决定、待决定、废弃决定及原因 | 已建立，持续更新 |
| `06-metric-contracts.md` | 核心指标口径与不可误用边界 | 原则已确认，逐模块细化 |
| `07-phase-1-intent-card.md` | 第一阶段范围、非目标、验收和环境风险 | 已确认并实施中 |
| `08-phase-1-implementation-log.md` | Phase 1 已完成证据、未验证项和下一步 | 持续更新 |
| `09-seven-day-alpha-plan.md` | 7 天 Alpha 范围、日程、上线口径和前置条件 | 已确认并执行中 |
| `10-foundation-verification-contract.md` | 独立数据库/队列验证、角色隔离与恢复验收契约 | Phase 1 内实施 |
| `11-phase-1-local-verification.md` | 面向业务负责人的本地与 Linux CI 验证结果 | 本地 33 项通过，Linux CI 已通过 |
| `12-server-preflight.md` | 宝塔现有服务与资源只读核查、隔离测试准备 | 已核查，临时测试待执行 |
| `13-brand-truth-intent-card.md` | 品牌事实卡最小切片的范围、证据与验收 | Gate A-F 已通过并封版 |
| `14-brand-truth-quality-intent-card.md` | 品牌事实冲突、缺口与公开范围 | Gate A-F 已通过并封版 |
| `15-question-intelligence-intent-card.md` | AI 游客问题拓展与版本化问题组 | Gate A-F 已通过并封版 |
| `16-deepseek-observation-intent-card.md` | DeepSeek API 真实答案采集与不可变证据 | Gate A-F 已通过并封版 |
| `17-visible-acceptance-console-intent-card.md` | 面向文旅负责人的 V2 可视化验收台 | Gate A-F 已通过并封版 |
| `18-citation-source-evidence-intent-card.md` | 回答引用候选、来源快照与安全抓取证据 | Gate A-F 已通过并封版 |
| `19-basic-geo-intelligence-intent-card.md` | 品牌/竞品提及、条件化排名、主张情感与同口径对比 | Gate A-F 已通过并封版 |
| `20-geo-gap-decision-intent-card.md` | 差距根因、内容方向、竞对深挖触发与执行路线 | Gate A-F 已通过并封版 |
| `21-comparable-observation-cycle-intent-card.md` | 同口径样本扩充、可比较观察周期与自动复诊 | Gate A-F 已通过并封版 |
| `22-real-brand-onboarding-intent-card.md` | 真实品牌资料导入、审核与单品牌运行基线 | Gate A-F 已通过并封版 |
| `23-brand-truth-completion-approval-intent-card.md` | 品牌事实缺口补充、公开范围确认与批准 | Gate A-F 已完成并封版 |
| `24-brand-truth-approval-intent-card.md` | 品牌真相基线批准与可增补版本 | Gate A-F 已完成并封版 |
| `25-real-question-panel-intent-card.md` | 北京珈程真实游客问题组草拟 | Gate A-F 已通过并封版 |
| `26-first-real-observation-baseline-intent-card.md` | 北京珈程首次真实观察基线与自动诊断 | Gate A-F 已通过并封版 |
| `27-periodic-monitoring-intent-card.md` | 北京珈程周期化监测、失败补采与自动复诊 | Gate A-F 已通过并封版 |
| `28-brand-claim-verification-intent-card.md` | AI 品牌描述逐条事实核验与污染预警 | Gate A-F 已通过并封版 |
| `29-evidence-gap-action-routing-intent-card.md` | 证据缺口聚类、优先级与优化动作路由 | Gate A-F 已通过并封版 |
| `30-optimization-action-plan-intent-card.md` | 优化行动计划、依赖与最小审批 | Gate A-F 已通过并封版 |
| `31-trust-evidence-blueprint-intent-card.md` | 资质可信证据清单与官网事实区蓝图 | Gate A-F 已通过并封版 |
| `32-trust-source-verification-intent-card.md` | 资质来源独立核验与补证状态 | Gate A-F 已通过并封版 |
| `33-refund-policy-intake-intent-card.md` | 退款、取消与履约政策事实采集 | Gate A-F 已通过并封版 |
| `34-configurable-action-fact-intake-intent-card.md` | 品牌个性化行动事实采集框架 | Gate A-F 已通过并封版 |
| `35-personalized-fact-workbench-intent-card.md` | 品牌个性化事实补充工作台 | Gate A-F 已通过并封版 |
| `36-alpha-readiness-overview-intent-card.md` | 单品牌 DeepSeek Alpha 上线就绪总览 | Gate A-F 已通过并封版 |
| `37-isolated-cloud-predeploy-intent-card.md` | 阿里云隔离预发布准备 | Gate A-F 已通过并封版 |
| `38-cloud-resource-risk-decision-intent-card.md` | 阿里云资源风险与原生运行决策 | Gate A-D 已完成，Gate E 待确认 |
| `39-production-acceptance-intent-card.md` | 阿里云生产实例验收状态 | Gate A-F 已完成并封版 |
| `40-cloud-backup-restore-intent-card.md` | 阿里云生产备份与隔离恢复演练 | Gate A-F 已完成并封版 |
| `41-production-first-observation-intent-card.md` | 北京珈程生产首次真实观察执行门禁 | Gate A-F 已通过并封版 |
| `42-production-website-diagnosis-intent-card.md` | 北京珈程生产官网只读诊断 | Gate A-F 已通过并封版 |
| `43-production-website-remediation-blueprint-intent-card.md` | 北京珈程官网结构修复蓝图 | Gate A 待确认 |

## 事实分级

- `F0 用户确认事实`：用户明确确认的产品目标、企业资料和规则。
- `F1 原始证据`：不可变模型回答、页面快照、接口响应、发布回执等。
- `F2 可复算结果`：能从 F1 按版本化算法重新计算的指标。
- `F3 有依据推断`：有证据支持但仍存在不确定性的 AI 判断。
- `F4 建议或假设`：用于决策或实验，尚未被证明。

UI、API 和报告必须保留该等级，不能把 F3/F4 显示成确定事实。

## 更新规则

1. 用户确认总体架构和 SOP 后，将对应状态改为 `已确认`，并在决策日志记录日期。
2. 每个模块实施前补充模块契约、验收场景和风险边界。
3. 每个切片完成后更新实现证据、测试结果和遗留风险。
4. 外部仓库更新或引入新版本时，在来源台账记录版本和复核结果。
5. 任何推翻性变更必须说明触发证据、影响范围和迁移方案。

## 当前一句话产品定义

AnswerTravel V2 是面向文旅品牌的 AI 原生 GEO 决策与自动运营系统：从游客问题发现、多 AI 真实采样、品牌与竞品证据分析，到内容/网站/信源动作、发布和发布后复测形成可追溯闭环；人主要维护企业真相、差异化能力并对高风险动作做 Yes/No 决策。

## 用户确认记录

2026-09-13，用户明确回复“以你确定的 V2 为准。继续”。该回复确认产品章程、总体架构、Vibe Coding SOP、核心指标原则、外部仓库使用策略以及 V1/V2 隔离原则。
