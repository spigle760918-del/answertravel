# AnswerTravel V2 阿里云隔离预发布契约

本目录是可审阅模板，不代表阿里云部署已经通过。

## 固定边界

- 使用独立目录 `/www/wwwroot/answertravel-v2`，不得覆盖现有站点目录。
- API 在 Compose 内监听 `0.0.0.0:4288`，但不发布宿主机端口；宝塔 Nginx 只通过固定代理网络地址 `172.30.0.10:4288` 访问。
- PostgreSQL、Redis 仅监听本机或私网，禁止开放公网端口。
- `DATABASE_URL` 使用无建库、无迁移、无超级用户权限的运行账号。
- `MIGRATION_DATABASE_URL` 仅在发布迁移步骤临时注入，不写入 API/Worker 常驻配置。
- DeepSeek Key 不得写入 Git、发布包、日志或 Nginx 配置。
- Docker 运行时的 `WEB_ROOT` 必须为容器内路径 `/app/web-dist`，不得填写宿主机站点目录。

## 生产构建

在 Node.js 24 和完整开发依赖环境执行 `npm ci`、`npm run build:alpha`。生成：

- `dist/src/main.js`：API；
- `dist/src/worker.js`：Worker；
- `dist/scripts/migrate.js`：迁移入口；
- `web-dist/`：Web 静态文件。

服务器运行阶段安装锁文件中的生产依赖，API 与 Worker 分别使用 `npm run start:api:prod` 和 `npm run start:worker:prod`，不依赖 `tsx`。

## 宝塔接入顺序

1. 建立独立站点/域名，不复用现有 PHP 站点根目录；
2. 准备 Node.js 24、PostgreSQL 16+、Redis 7+，先核对资源、路由和现有 Docker 网段；
3. 确认 `172.30.0.0/24` 不冲突，创建外部网络 `answertravel_proxy`；
4. 创建独立数据库、迁移账号、运行账号和 Redis DB/命名空间；
5. 注入环境变量，先执行数据库备份，再运行一次迁移；
6. 启动 API，确认容器健康及 `172.30.0.10:4288/health/ready`；
7. 启动 Worker，确认队列健康；
8. 添加独立域名反向代理并签发 HTTPS；
9. 从公网复核页面、就绪检查、日志和错误路径；
10. 建立每日备份及一次真实恢复演练后，才可把云端备份状态改为已就绪。

## 固定代理网络

`answertravel_proxy` 是 Compose 之外管理的外部网络。新服务器首次部署前必须先创建：

```bash
docker network create \
  --driver bridge \
  --subnet 172.30.0.0/24 \
  --gateway 172.30.0.1 \
  answertravel_proxy
```

网络已存在时不得只核对名称，还必须确认子网和网关：

```bash
docker network inspect answertravel_proxy \
  --format 'Subnet={{(index .IPAM.Config 0).Subnet}} Gateway={{(index .IPAM.Config 0).Gateway}}'
```

API 在该网络中固定为 `172.30.0.10`。手工执行 `docker network connect` 只用于切换前预验，容器重建后的最终状态必须以 Compose 声明为准。如果外部网络被删除，Compose 应直接失败并停止部署，不得自动改用动态容器 IP。

## 北京珈程生产数据初始化

数据库迁移完成后，使用编译后的 `dist/scripts/initialize-jiacheng-production.js` 执行一次幂等初始化。该入口只写入已批准的品牌事实、竞品监控实体和20条用户批准问题快照；不调用 DeepSeek、不创建观察计划或周期调度、不授权发布。

成功输出必须包含：

```text
event=jiacheng.production_initialized
approvedQuestions=20
observationPlans=0
rawAnswers=0
monitoringSchedules=0
deepseekCalled=false
publicationAuthorized=false
```

输出的 `tenantId` 用于服务器 `ACCEPTANCE_TENANT_ID`，不是密钥。在品牌数据和预算边界未复核前，Worker 应保持停止。

## 回滚

- 代码使用 `releases/<版本>/` 与 `current` 指针切换；回滚只切回上一发布版本。
- 数据库迁移前必须有可恢复备份。涉及不可逆 Schema 变化时，不允许仅靠切换代码回滚。
- Nginx 变更先做配置检查；失败时恢复该独立站点配置，不改全局或其他站点配置。
- API/Worker 异常时只停止 AnswerTravel 自身进程，不操作现有 PHP、MySQL 或其他业务。
- 禁止执行 `docker compose down -v`；不得删除 PostgreSQL/Redis 数据卷。

## 上线前必须取得的证据

- Node.js 24 版本与生产构建哈希；
- API/Worker 进程状态及回环健康检查；
- Nginx 配置检查和 HTTPS 公网访问；
- PostgreSQL/Redis 无公网监听；
- 数据库备份文件、校验值和恢复演练结果；
- 错误日志可查看、最小告警能触达；
- 当前 Alpha 限制在页面可见。
