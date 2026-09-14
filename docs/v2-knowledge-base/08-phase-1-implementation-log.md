# Phase 1 实施记录

状态：实施中  
最近更新：2026-09-13

Phase 1 已验收封版；后续品牌真相中心切片的新增测试结果记录在 `13-brand-truth-intent-card.md`，不得反向改写 Phase 1 当时的 33 项基线。

## 已完成

- 用户确认记录、项目门禁和技术基线已写入知识库与 `AGENTS.md`；
- 新建与 V1 隔离的 `v2/` 工程目录；
- 固定 TypeScript 主系统和 Node.js 24.x LTS 目标；
- 建立 F0-F4 事实等级、规范 JSON、SHA-256 证据信封和审计事件契约；
- 建立版本化持久任务契约；
- 建立 PostgreSQL 初始迁移：租户、不可变证据、不可变审计、行级安全；
- 建立幂等证据写入和租户事务边界；
- 建立进程存活与 PostgreSQL/Redis 就绪检查；
- 建立 API、Worker、迁移、契约测试、架构测试和数据库集成测试入口；
- 建立 Node.js 24 + PostgreSQL 16 + Redis 7 的 CI 配置；
- 修正幂等写入与不可变触发器冲突：冲突时不更新原始证据，只读取既有记录；
- 为证据与审计表启用并强制 PostgreSQL Row Level Security。
- 安装并精确锁定 5 项运行依赖与 6 项开发依赖，生成独立 `v2/package-lock.json`；
- 从 Node.js 官网下载 `v24.21.0` Windows x64，校验官方 SHA-256 后解压至 `v2/.runtime/tools/`，未替换系统 Node.js；
- 修复 TypeScript NodeNext 模式下 ioredis 默认导入无法构造的问题，API、Worker 与健康检查改用具名 `Redis` 导出。
- 增加证据与审计同事务提交；重复写入不重复审计，采集上下文冲突明确拒绝；
- 增加租户目录 RLS、证据/审计 TRUNCATE 保护、高权限应用账号拒绝机制；
- 迁移核心可独立测试，支持校验历史、串行执行、失败 DDL 回滚；
- 基础任务具有稳定幂等键，Worker 写入真实探针证据与审计，重试和失败状态保存在 Redis；
- 独立 Windows 验证脚本自动创建随机端口的测试服务，并在结束后关闭进程；未使用 V1 数据；
- 增加完整集成测试门禁：缺少服务配置明确失败；
- Linux 隔离测试镜像、Compose 和只读服务器检查脚本已准备；GitHub Ubuntu CI 已实际运行成功，阿里云原生路径受主机安全策略阻断。

## 已实际验证

- `package.json` 与 `tsconfig.json` JSON 语法有效；
- 运行时门禁正确识别本机 Node.js `v25.2.1` 不等于目标 Node.js 24 LTS，并标记本地结果为临时；
- V2 文件均位于独立目录，未修改 V1 产品代码和运行数据。
- 2026-09-13，用户切换会话模型并要求重试后，本次自动审批成功，npm 实际启动并完成安装；此前的 503 未复现。该结果不能单独证明主会话模型切换改变了审批服务的路由。
- 在隔离的 Node.js `v24.21.0` / npm `11.19.0` 下执行 `npm ci --no-fund --no-audit` 成功，按锁文件安装 150 个包；
- 同一环境下执行 `npm audit --audit-level=high`，当次返回 `found 0 vulnerabilities`（仅代表查询时已知公告）；
- 锁文件重装后执行 `npm run check` 成功：运行时检查通过、TypeScript 无错误、4 项测试通过、2 项 PostgreSQL 集成测试跳过；不得把跳过计为通过；
- API 内部 HTTP 注入检查：`/health/live` 返回 200 / `alive`；
- 使用回环地址上不可连接的测试依赖检查失败路径：`/health/ready` 返回 503，PostgreSQL 与 Redis 分别标记 `down`，API 可以正常关闭。该结果仅证明故障识别，不证明真实服务就绪。

### 完整本地验证（2026-09-13 15:16，Asia/Shanghai）

- `npm run verify:local`：Node.js 24.21.0 下 TypeScript 检查通过，7 个测试文件、33 项测试全部通过，0 失败、0 跳过；
- PostgreSQL 16.14：真实运行非超级用户 RLS、租户目录隔离、跨租户写入拒绝、并发幂等、审计原子性、上下文不泄露、不可变保护、迁移校验和失败回滚；
- Redis 7.2.16：真实入队、Worker 完成证据写入、重复投递去重、临时失败重试、跨租户幂等键隔离、不支持版本明确失败；
- API：真实服务就绪返回 200，高权限数据库账号和不可用服务返回 503；存活检查独立；
- PostgreSQL 冷备份：停止测试实例、完整复制到新目录、从副本启动，证据哈希和审计记录一致；这是本地同版本冷恢复，不等于生产在线备份方案验收；
- Redis 崩溃恢复：仅强制终止本次创建的进程，AOF 配置 `appendfsync always`；重启后待处理任务仍在；
- `npm run check:integration` 在缺少测试服务配置时确实失败；
- 新增开发依赖后，npm 公告审计仍返回 0 个已知漏洞；不涵盖所有原生二进制的安全性。

证据文件：

- `v2/.runtime/latest-verification.json`：本次汇总，明确 `scope=full-local`、`linuxCiVerified=false`；
- `C:\Users\ADMINI~1\AppData\Local\Temp\answertravel-v2-test-5l8cCm\vitest-results.json`：逐项 JSON 测试结果；
- 同目录保存 PostgreSQL/Redis 日志、原测试数据及恢复副本；本次创建的服务已关闭。

### 本次验证版本

- 运行依赖：Fastify `5.12.4`、pg `8.23.0`、Zod `4.6.4`、BullMQ `6.3.4`、ioredis `6.0.0`；
- 开发依赖：TypeScript `7.0.2`、tsx `4.23.13`、Vitest / coverage-v8 `4.1.11`、@types/node `24.13.4`、@types/pg `8.23.1`；
- 本地 PostgreSQL 工具依赖：embedded-postgres `16.14.0-beta.17`；
- Node.js 官网压缩包：`https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip`；
- SHA-256：`158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541`。

## 尚未验证，不得声称通过

- 阿里云实机已上传并校验验证包，但被宝塔/主机安全策略阻断（`blocked-by-host-policy`），不得记为实机原生验证通过；
- Linux 测试镜像构建、Compose 运行、生产在线备份与外部告警尚未验证；
- 用户已于 2026-09-13 确认 Phase 1 工程与证据骨架验收通过；
- Phase 1 在本地技术、Linux CI、追溯/恢复证据及用户业务确认范围内完成；阿里云原生实机仍不纳入“通过”证据。

## 当前阻塞

原安装及本地数据库/队列验证阻塞已解除。无需用户安装 Docker Desktop 或重启电脑。

之前发现的 CI 高权限测试账号问题已通过独立测试角色配置修复；本地真实账号检查与 Linux CI 均已通过。Redis 错误监听及资源关闭已补齐。

Linux 实机验证已完成边界尝试：文件上传与哈希校验成功，但 `systemd-run`、`runuser`、`su` 均被宝塔安全层阻断；现有 Nginx/MySQL 与监听端口只读复核仍正常。不得绕过该策略或把失败归因于 V2 代码。

## 下一步

1. 向用户展示 Phase 1 业务验收摘要并取得 Yes/No；
2. 若通过，封版 Phase 1 并更新决策日志；
3. 新建品牌真相中心意图卡后进入下一切片，不提前接入真实 AI 或业务数据。

### Linux CI（2026-09-13 19:07，Asia/Shanghai）

- 仓库 `spigle760918-del/answertravel`，提交 `c2a802ce1db27eb186c6626df72d4bfdfb0c3e63`；
- GitHub Actions push 运行 `34753545909` 与手动运行 `34753580732` 均成功；
- 手动运行的 `verify` 作业在 Ubuntu 上完成 PostgreSQL 16、Redis 7、Node.js 24、依赖锁定安装、独立应用角色初始化及 `npm run check:integration`；所有工作流步骤为 `success`；
- GitHub API 未向匿名请求提供逐行日志，33 项数量来自用户在已登录页面看到的运行结果；远端测试内容与本地 46 个 V2 受控文件比较一致，本地同套件为 33/33；
- Linux CI 已验证工程路径，但不覆盖本地 PostgreSQL 冷备恢复和 Redis 强制终止恢复演练，也不等于生产部署验收。
