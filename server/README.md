# AnswerTravel 本地业务 API

这是第二阶段业务层与上线骨架。JSON 开发存储只使用 Node.js 内置模块；PostgreSQL 运行模式使用 `pg` 驱动。服务将原来只存在浏览器 `localStorage` 中的团队、品牌、提问、文章、素材、回答记录和任务状态，保存到服务端存储，并提供版本化 REST API。

## 启动

在项目根目录执行：

```powershell
node server/index.js
```

默认地址：`http://127.0.0.1:4174`

数据文件：`server/data.json`

### 完全本地 PostgreSQL 模式（推荐）

无需 Docker 或云数据库。首次运行会下载到项目依赖中的 PostgreSQL 16，随后初始化数据库、执行迁移、导入现有 JSON 数据，并启动真实登录模式的 API 与前端：

```powershell
start-local.cmd
```

也可以在 `server` 目录运行 `npm run local:start`。默认页面为 `http://127.0.0.1:4173/index.html?api=1`，API 为 `http://127.0.0.1:4180/api/v1`。数据库仅监听 `127.0.0.1:55432`，数据保存在被忽略的 `server/.local/postgres`，停止和重新启动后仍会保留。

本地管理员仅用于本机开发：`admin@answertravel.local` / `AnswerTravel-Local-2026!`。可通过同名环境变量覆盖，部署时不得使用该默认密码。

运行真实 PostgreSQL 的重启持久化、迁移、登录、邀请、刷新令牌和品牌权限隔离测试：

```powershell
cd server
npm run test:postgres:local
```

创建带 SHA-256 完整性校验、可迁移到托管 PostgreSQL 的业务备份：

```powershell
cd server
npm run local:backup
```

备份保存在 `server/.local/backups`，其中包含账号哈希和业务数据，请按敏感数据管理且不要对外分享。恢复命令默认只允许写入空数据库；若目标库已有数据会拒绝覆盖：

```powershell
$env:DATABASE_URL='postgresql://user:password@host:5432/answertravel'
npm run migrate
npm run local:restore -- "备份文件路径"
```

服务端也支持通过环境变量切换监听地址、数据文件和演示收录延迟：

- `ANSWERTRAVEL_API_HOST` / `ANSWERTRAVEL_API_PORT`
- `ANSWERTRAVEL_API_DATA_FILE`：适合测试或按环境隔离数据
- `ANSWERTRAVEL_AUTO_INDEX_DELAY_MS`：发布后自动标记为「已收录」的等待时间，默认 2200 毫秒

当前 Node 服务支持 JSON 开发存储，以及基于四份迁移的 PostgreSQL 关系表存储。品牌、竞品、监控问题、素材、文章、成员、刷新令牌、任务与回答记录均已使用独立 repository 增量写入；整份关系数据同步只保留给首次导入、便携备份恢复和开发快照工具。工作空间设置与发布渠道仍需继续切换为资源级写入。

API 同时接受 `/api/...` 和版本化的 `/api/v1/...` 路径。`/api/ready` 会返回当前环境是否满足启动条件；生产环境在 PostgreSQL 查询适配器、数据库连接、来源白名单、演示认证关闭和初始管理员配置全部满足前，会以 503/退出码 78 阻断流量。

## PostgreSQL 接入

安装依赖后，先对目标数据库执行迁移：

```powershell
$env:DATABASE_URL='postgres://user:password@host:5432/answertravel'
npm run migrate
```

将现有 JSON 数据一次性写入关系表：

```powershell
$env:ANSWERTRAVEL_STORAGE='postgres'
npm run migrate:json
```

然后可在开发或 staging 环境使用 PostgreSQL 运行 API。目标数据库已有数据时，迁移命令默认拒绝覆盖；只有明确设置 `ANSWERTRAVEL_MIGRATION_OVERWRITE=true` 才会覆盖。正式生产上线前，仍需验证多工作空间隔离、多实例并发和生产任务队列。

`npm run test:postgres:local` 已使用项目内嵌 PostgreSQL 16 验证空库迁移、JSON 导入、API 持久化、真实登录、权限隔离、备份和恢复。仓库中的 `.github/workflows/ci.yml` 会在 PostgreSQL 16 临时数据库上重复执行数据库 smoke test。

## 已提供的业务能力

- 登录 / 退出演示会话与角色权限：团队管理员、品牌管理员、品牌编辑者、品牌成员只读
- 邮箱密码注册/登录、短期 access token、refresh token 轮换、退出撤销和当前用户查询
- 工作空间、团队信息和发布渠道配置
- 团队成员邀请：生成邀请地址、查看邀请信息、接受邀请并更新成员状态
- 品牌与竞品管理
- 监控问题增删改查；创建提问时自动创建多平台回答记录与采集任务
- 素材增删改查
- 文章创建、编辑、事实审核、发布、收录检查和删除
- 任务查询、取消、重试；发布任务会自动推进到已发布 / 待收录
- 回答记录按平台、分组、状态、关键词和日期范围直接查询关系表
- DeepSeek 真实适配器、任务执行器、原始回答/模型/耗时/引用保存和品牌曝光评估
- 手动、每日、每周采集调度；可重试错误采用指数退避并尊重平台 Retry-After
- 团队与品牌自然月双层采集配额，按「一个问题 × 一个平台」计数并在执行前拦截
- JSON 开发文件原子写入，重启后数据仍然保留
- PostgreSQL 模式下以事务同步关系表，具备工作空间 revision 并发保护
- 工作空间、团队资料、发布渠道、品牌、竞品、提问、素材、成员权限、文章审核发布与任务操作会通过资源级事务写入 PostgreSQL，并记录持久化审计日志；`GET /api/v1/audit-logs` 仅团队管理员可查询

## 回归测试

```powershell
cd server
npm test
```

测试会使用临时数据文件，不会修改 `server/data.json`，覆盖登录、角色权限、提问采集、回答记录筛选、文章审核发布、自动收录、任务取消/重试和快照写入。

## 示例

```powershell
Invoke-RestMethod http://127.0.0.1:4174/api/health
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4174/api/auth/login -ContentType 'application/json' -Body '{"user":"Admin","role":"团队管理员"}'
```

当前已经具备邮箱密码认证、刷新令牌、PostgreSQL 关系存储代码和 DeepSeek 适配器，但仍属于待部署验证版本：尚未提供真实 DeepSeek Key 完成外部请求验收，也未连接 WordPress / 公众号发布 API 和搜索引擎接口。生产前端使用 `Authorization: Bearer <token>`；`X-Demo-Role` 只允许在明确启用演示认证的开发环境使用。

回答记录接口支持联动筛选：`platform`、`group`、`mentioned`、`status`、`search`，以及可选的 `from` / `to` 日期（`YYYY-MM-DD`）。

团队邀请流程：管理员 `POST /api/members` 后，将响应中的 `inviteUrl` 分享给成员；访问该地址可查看邀请，`POST <inviteUrl>/accept` 即可接受邀请。接受后邀请地址失效。

## 连接当前前端原型

- `http://127.0.0.1:4173/index.html?api=1`：分别读取工作空间、品牌、提问、回答、素材、文章、任务与成员，后续浏览器变更通过资源 API 增量保存。
- `http://127.0.0.1:4173/index.html?api=1&bootstrap=local`：仅用于首次迁移，把当前浏览器 `localStorage` 数据导入 API；日常操作不再整份写入快照。

本地页面服务可在项目根目录运行 `node dev-server.js`。API 模式提供独立邮箱登录和邀请注册界面；非 API 模式仍可离线查看原型。

不带 `api=1` 时，前端仍保持纯浏览器本地模式，便于离线查看和回退。

启用 API 模式后，浏览器会保存短期 Bearer 会话并使用 refresh token 恢复登录；生产环境会话失效时显示登录界面，开发环境可按配置回退到演示身份。当服务端暂时不可用时会显示连接错误并自动重试未完成的增量保存。

## DeepSeek 真实采集

配置 `DEEPSEEK_API_KEY` 后，回答采集任务会调用 DeepSeek，保存回答、模型版本、耗时、引用与原始响应，并计算当前品牌的提及状态、首次排名和曝光分数。`GET /api/v1/providers` 用于检查配置状态，响应不会返回密钥。未配置 Key 时继续使用开发演示任务，不会发起外部请求。

本地推荐在 `server` 目录复制 `.env.example` 为 `.env.local`，只填写 `DEEPSEEK_API_KEY`，然后重启 `start-local.cmd`。`.env.local` 已被版本库忽略，密钥不会进入页面或业务数据库。`GET /api/v1/collection/status` 可查看真实平台连接、品牌/团队月度用量以及下一次定时采集时间。

完整容器部署入口见根目录 `compose.yaml` 和 `docs/AnswerTravel-deployment.md`。
