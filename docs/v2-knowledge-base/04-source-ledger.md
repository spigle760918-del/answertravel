# AnswerTravel V2 来源与证据台账

状态：持续更新  
本轮复核日期：2026-09-13

## 1. 核验等级

- `R1 元数据`：仓库存在、主分支、许可证元数据。
- `R2 入口文档`：已阅读当前 README 的定位、能力、边界和许可说明。
- `R3 关键契约`：已核验与拟用模块直接相关的 Skill/API/Schema/脚本。
- `R4 运行验证`：已在固定版本运行测试并复核输出。

本轮用于总体架构的是 R1-R2 深读。任何代码并入 V2 前，必须针对拟用文件完成 R3-R4；不能因为 README 有示例就宣称生产可用。

## 2. GitHub 项目复核

### GEOFlow

- 地址：https://github.com/yaojingang/GEOFlow
- 核验：R2；README 为 GEOFlow 3.1，2026-09-13 获取；Git HEAD 曾核验为 `abcc638887dd35f508a59815f01ed42bc4415a09`。
- 定位：企业官网 GEO 智能运营系统，覆盖知识、AI 内容、质量门禁、人工审核、多站点分发与数据分析。
- V2 用法：借鉴内容运营、知识库、审核、站点和 WordPress 分发；可考虑边界清晰的外部集成。
- 不直接承担：AnswerTravel 的多模型观察事实仓、同口径竞品实验和因果复测。
- 风险：AGPL-3.0。闭源或 SaaS 复用前必须做许可证方案；默认不复制代码进核心。

### yao-open-prompts

- 地址：https://github.com/yaojingang/yao-open-prompts
- 核验：R2；当前文档列出 118 个中文提示词、29 个 AI 营销提示词和 25 个 GEO 营销实战模板。
- 定位：可复制 Prompt 内容库，不是运行时系统。
- V2 用法：作为问题、内容、结构化数据、信源、监测和合规 Prompt 的候选素材。
- 门禁：生产使用前必须改造成有输入输出契约、版本、评测和证据边界的内部 Prompt/Skill。
- 许可：README 声明提示词内容 CC BY 4.0；第三方内容保持原授权边界。

### yao-meta-skill

- 地址：https://github.com/yaojingang/yao-meta-skill
- 核验：R2；README 已复核 Skill IR、编译适配、触发/输出评测、Review Studio、Evidence Ledger、Claim Guard、发布门禁、治理和漂移。
- 定位：Skill 工程、评测、治理和跨平台包装系统。
- V2 用法：借鉴 Skill/Prompt 生命周期、证据台账、防过度声明、路由评测、版本治理和发布门禁。
- 不直接承担：文旅事实库、模型采集、指标事实表、文章发布和实验数据。
- 重要边界：仓库自身明确区分本地工程证据、人类证据和外部 Provider 证据；V2 继承这一反过度声明原则。
- 许可：MIT。

### yao-open-skills

- 地址：https://github.com/yaojingang/yao-open-skills
- 核验：R2。
- 定位：通用研究、决策、商业、学习和交付 Skill 集合。
- V2 用法：选择性参考定位、需求、主要矛盾、贝叶斯决策、博弈、安全和教程交付方法。
- 不作为：GEO 核心运行时或业务数据库。
- 许可：MIT。

### geo-citation-lab

- 地址：https://github.com/yaojingang/geo-citation-lab
- 核验：R2；当前 README 记录 602 条受控 Prompt、21,143 条有效搜索层引用、23,745 条 citation-level 特征、18,151 个成功抓取页面、72 维特征；CN-GEO 原始引用记录 214,119 条。
- 定位：AI 搜索引用选择、内容吸收、实体曝光和跨平台/终端差异的公开实证研究台。
- V2 用法：定义引用选择与吸收、页面特征、跨终端实验和研究评测基线。
- 关键限制：静态快照；部分数据缺完整回答、批次、模型版本和统一采集时间，不可直接计算长期趋势、严格排名、情感或品牌推荐率。
- 许可：代码/自动化 MIT；自有报告/文档/可视化/目录元数据 CC BY 4.0；论文和第三方数据保持原许可。

### yao-geo-skills

- 地址：https://github.com/yaojingang/yao-geo-skills
- 核验：R2；此前“待核验”状态已于 2026-09-13 解除。README 当前明确列出 21 个 GEO Skill。
- 与 V2 最相关的能力：
  - `yao-geo-intent-miner`：品牌、竞品、区域、人群和业务材料到问题集、意图簇、追问链、内容选题和监测 Prompt；
  - `yao-geo-panorama-audit`：DeepSeek、豆包、千问、Kimi、元宝的可见性、竞品、页面、官网证据和外部信源全景诊断；
  - `yao-geo-effect-monitor`：答案监测、引用追踪、事实纠偏、月报和谨慎归因；
  - `yao-deepseek-crawler`、`yao-doubao-crawler`、`yao-chatgpt-crawler`：网页/App 重复采样和概率报告；
  - `yao-geo-brand-graph`、`yao-geo-knowledge-base-builder`：实体图谱、事实卡、FAQ、禁用表达和来源索引；
  - 页面诊断/蓝图及六个内容生产 Skill；
  - GEOFlow CLI/模板/设计运营 Skill。
- V2 用法：优先作为模块需求、输入输出契约、评测用例和报告范式来源。
- 风险：网页 Browser Bridge、Appium/移动端采集属于易受界面、登录、风控和条款影响的方案。进入生产前必须做 R3-R4、授权/条款审查、稳定性测试、截图/原始响应证据和降级设计。
- 许可：MIT。

## 3. 内部项目资料

- `https://github.com/spigle760918-del/answertravel`：AnswerTravel V2 当前 GitHub CI 仓库；2026-09-13 核验提交 `c2a802ce1db27eb186c6626df72d4bfdfb0c3e63`，两个 V2 Linux CI 运行成功。该公开仓库不得提交 API Key、品牌私密资料或服务器凭据。
- `docs/AnswerTravel-PRD.md`：V1 产品目标和业务流程参考。
- `docs/AnswerTravel-品牌优化诊断方法.md`：已有提及率、竞品、来源和内容任务书方法参考。
- `docs/AnswerTravel-上线差距与实施计划.md`：V1 真实能力与演示边界。
- V1 代码：可迁移 `DeepSeek Provider`、信源抓取安全思路、品牌分析规则和测试资产；迁移前必须重新审查。

## 4. 尚未完成的核验

- 六个外部仓库拟复用文件的固定 commit、依赖、安全和运行测试；
- 国内各模型 API/Web/App 采集的正式授权、服务条款和可持续性；
- 文旅热点数据源及商业使用许可；
- 第三方媒体/评论/旅游平台正文抓取与保存边界；
- GEOFlow AGPL 集成方式的法律确认。

## 5. Phase 1 本地验证工具（不作为生产服务分发）

- Node.js：官方 `v24.21.0` Windows x64 压缩包，校验官方 `SHASUMS256.txt`；版本、哈希与实际编译结果见实施记录。
- PostgreSQL：开发依赖 `embedded-postgres@16.14.0-beta.17`，仓库 `https://github.com/leinelissen/embedded-postgres`，包许可 MIT；Windows 原生包 gitHead `e7ffa21b913e96bdd6129f7c4f60f22f3942071c`，依赖完整性以 npm 锁文件为准。已复核安装脚本（Windows symlink 清单为空），独立执行报告 PostgreSQL 16.14；未借用 V1 包或数据。
- Redis Windows 移植版：`https://github.com/redis-windows/redis-windows/releases/tag/7.2.16`，固定资产 `Redis-7.2.16-Windows-x64-msys2.zip`，GitHub asset ID `519261974`；发布页与 API 均给出 SHA-256 `bcbfda1dda027beaea4d616f8992f9b6353613c1b1f4d0e4a6776940bb036347`。仓库许可 Apache-2.0 不覆盖上游 Redis 和运行库各自许可；不复制其源码进入核心，不作为正式产品附带分发。
- 已读 Redis 移植版该 tag README：明确非 Redis 官方项目，仅推荐本地开发，生产应使用 Linux。因此 Windows 测试不替代阿里云/Linux 验证。
