# AnswerTravel V2

AnswerTravel V2 是面向文旅品牌的 AI 原生 GEO 决策与自动运营系统。本目录与 V1 完全隔离，并按已确认架构持续增加真实垂直切片。

## 当前状态

- 产品章程、架构、SOP 和指标原则已确认；
- Phase 1、品牌真相、问题智能和 DeepSeek API 观察切片已完成业务验收；
- 已接入真实 DeepSeek API 问题生成与多轮答案采集；该能力不代表 DeepSeek Web/App 搜索表现；
- 已建立只读 V2 可视化验收台和引用/信源证据下钻；尚未实现 GEO 指标、文章生成或发布能力；
- 生产路径中不存在 mock 数据。
- 已安装并锁定依赖；Node.js 24.21.0 下编译与 86 项测试全部通过（含真实 PostgreSQL/Redis，0 跳过）；
- 本地数据库冷备份恢复、Redis 进程终止后的 AOF 任务恢复通过；
- GitHub Linux CI 已通过；阿里云原生验证仍为 `blocked-by-host-policy`，不得表述为通过。

## 目标运行环境

- Node.js 24.x LTS
- PostgreSQL 16+
- Redis 7+

系统默认仍为 Node.js 25。已在 `.runtime/tools/node-v24.21.0-win-x64/` 准备经官方 SHA-256 校验的独立 Node.js 24.21.0；仅在本工作区使用，不改变系统安装。本地完整验证和 GitHub Linux CI 均已在 Node.js 24 上通过。

## 目录

```text
v2/
├── migrations/        # PostgreSQL 迁移，数据库结构唯一事实源
├── scripts/           # 迁移等工程脚本
├── src/
│   ├── kernel/        # 跨模块最小契约
│   ├── modules/       # 业务模块，禁止跨模块直接写表
│   └── platform/      # 数据库、队列、配置等基础设施
├── web/               # React/Vite 永久 Web 产品外壳
├── web-dist/          # 由同一 Fastify 服务提供的生产静态文件
└── tests/             # 契约、架构和集成测试
```

## 命令

在 Node.js 24 环境下：

```bash
npm run check
npm test
npm run db:migrate
npm run dev:api
npm run dev:worker
npm run acceptance:serve
```

本机 PowerShell 可在 `v2/` 内临时选择已安装的独立运行时：

```powershell
$env:PATH = (Join-Path (Get-Location) '.runtime\tools\node-v24.21.0-win-x64') + ';' + $env:PATH
npm run check
```

`npm run check` 在没有 `TEST_DATABASE_URL` 时会跳过数据库集成测试；看到命令成功不等于完整验收。数据库与 Redis 不可用时，进程存活检查可通过，就绪检查应返回 503。完整本地验证必须使用下一节的隔离验证命令。

数据库集成测试必须使用隔离的测试库和无超级用户、无 BYPASSRLS 权限的角色；迁移角色单独配置，不得连接 V1 或真实品牌数据库。

来源页面抓取默认关闭。只有在 `SOURCE_FETCH_ALLOWED_DOMAINS` 中以逗号分隔明确允许的公开域名才会被访问；未配置时引用候选仍保存，但页面抓取记录为拒绝，不自动联网。

## 完整本地验证（Windows）

首次可执行 `scripts/setup-local-tools.ps1` 下载固定版本工具并核对 SHA-256；工具保存在忽略目录 `.runtime/tools/`。Redis Windows 移植版只用于本地测试，正式环境使用 Linux Redis。

在本目录选择 Node.js 24 后：

```powershell
npm ci
npm run verify:local
```

该命令自动创建独立 PostgreSQL/Redis 进程、随机回环端口和随机测试密码，验证迁移、隔离、审计、队列和恢复，最后关闭本次进程。不会安装系统服务，不会访问 V1 数据。日志、测试数据和恢复副本保留在输出所示的临时目录，汇总位于 `.runtime/latest-verification.json`。

`npm run verify:local -- --database-only` 仅用于明确排除 Redis 的数据库诊断，不代表完整验收。

已有隔离测试服务时，提供 `TEST_ADMIN_DATABASE_URL`、`TEST_DATABASE_URL`、`TEST_REDIS_URL`，执行 `npm run check:integration`；缺少配置会失败而不是跳过。

## Linux 与阿里云复核边界

- `scripts/server-preflight.sh` 只读输出资源、监听端口和 Docker 可用性，不安装或调整现有服务；
- `scripts/verify-linux.sh` 使用本次唯一 Compose 项目，测试服务不发布主机端口，不挂载外部数据卷；测试后清理本次测试容器；
- 运行前必须审阅服务器资源情况；脚本要求至少 2 GiB 可用内存和 4 GiB 可用磁盘；
- 现有业务服务器不自动安装 Docker，也不停止或重启已有业务；
- `Dockerfile.verify` 与 `compose.verify.yaml` 是测试配置，不是生产部署配置。
- GitHub Linux CI 已完成 Node.js 24、PostgreSQL 16、Redis 7 和完整集成检查；阿里云宝塔主机策略仍阻断原生验证，因此两者必须分别记录。
