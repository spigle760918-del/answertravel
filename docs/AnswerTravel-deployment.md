# AnswerTravel 部署说明

当前部署骨架包含三个服务：Nginx 前端、Node.js API 和 PostgreSQL 16。前端与 API 使用同一域名，Nginx 将 `/api/` 转发给 API，避免生产页面依赖本机地址。

## 上线前配置

从 `.env.production.example` 准备生产环境变量：

- `ANSWERTRAVEL_DB_PASSWORD`：数据库强密码。
- `ANSWERTRAVEL_PUBLIC_ORIGIN`：外部访问来源，必须包含协议且不能使用 `*`。
- `ANSWERTRAVEL_BOOTSTRAP_ADMIN_EMAIL`：首位团队管理员邮箱。
- `ANSWERTRAVEL_BOOTSTRAP_ADMIN_PASSWORD`：首位管理员初始密码，至少 12 个字符。
- `ANSWERTRAVEL_WEB_PORT`：宿主机暴露端口，默认 8080。
- `DEEPSEEK_API_KEY`：DeepSeek 正式 API Key，由 Secret 管理器注入。
- `DEEPSEEK_API_ENDPOINT` / `DEEPSEEK_MODEL`：默认使用官方 `deepseek-chat` 配置。

不要把真实密码提交进代码仓库。正式环境应由部署平台的 Secret 管理器注入。

## 启动顺序

```powershell
docker compose --env-file .env.production up -d --build
```

API 容器会先等待 PostgreSQL 健康，再执行带校验值的数据库迁移，最后启动服务。Web 容器只会在 API 健康后接收流量。

部署完成后检查：

```text
GET https://你的域名/healthz
GET https://你的域名/api/v1/health
GET https://你的域名/api/v1/ready
```

三个地址分别用于前端存活、API 存活和生产配置就绪检查。`ready` 必须返回 `ready: true` 且 `storage: postgres`。

## 首次数据迁移

如果需要导入现有 `server/data.json`，在空库完成迁移后只执行一次：

```powershell
docker compose --env-file .env.production run --rm api npm run migrate:json
```

目标库已有业务数据时命令会拒绝覆盖。不要在生产环境设置 `ANSWERTRAVEL_MIGRATION_OVERWRITE=true`，除非已完成备份并明确安排维护窗口。

## 反向代理与 HTTPS

公网部署仍需在最外层负载均衡或网关配置域名证书和 HTTPS，并把流量转发到 Web 服务的 8080 端口。`ANSWERTRAVEL_PUBLIC_ORIGIN` 必须与浏览器实际访问源完全一致。

## 上线验收

1. 新管理员可登录，刷新浏览器后会话可恢复，退出后刷新令牌失效。
2. 团队邀请只显示一次原始邀请 token，数据库仅保存哈希。
3. 品牌、提问、竞品、素材和文章新增后，容器重启仍能读取。
4. 只读成员无法创建、编辑、删除或发布。
5. `/api/v1/ready`、容器健康检查、数据库备份和恢复演练全部通过。
6. 使用正式模型与发布渠道凭证完成一次端到端采集和发布验证。

DeepSeek 适配器与任务链路已实现，但在提供正式 API Key 并完成一次真实采集前，不能视为模型接入验收通过。第三方发布渠道仍未接入，因此部署骨架完成不等于业务已经正式上线。
