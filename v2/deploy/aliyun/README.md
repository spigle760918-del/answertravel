# AnswerTravel V2 阿里云隔离预发布契约

本目录是可审阅模板，不代表阿里云部署已经通过。

## 固定边界

- 使用独立目录 `/www/wwwroot/answertravel-v2`，不得覆盖现有站点目录。
- API 只监听 `127.0.0.1:4288`；公网只通过独立域名和 Nginx 进入。
- PostgreSQL、Redis 仅监听本机或私网，禁止开放公网端口。
- `DATABASE_URL` 使用无建库、无迁移、无超级用户权限的运行账号。
- `MIGRATION_DATABASE_URL` 仅在发布迁移步骤临时注入，不写入 API/Worker 常驻配置。
- DeepSeek Key 不得写入 Git、发布包、日志或 Nginx 配置。

## 生产构建

在 Node.js 24 和完整开发依赖环境执行 `npm ci`、`npm run build:alpha`。生成：

- `dist/src/main.js`：API；
- `dist/src/worker.js`：Worker；
- `dist/scripts/migrate.js`：迁移入口；
- `web-dist/`：Web 静态文件。

服务器运行阶段安装锁文件中的生产依赖，API 与 Worker 分别使用 `npm run start:api:prod` 和 `npm run start:worker:prod`，不依赖 `tsx`。

## 宝塔接入顺序

1. 建立独立站点/域名，不复用现有 PHP 站点根目录；
2. 准备 Node.js 24、PostgreSQL 16+、Redis 7+，先核对资源和现有端口；
3. 创建独立数据库、迁移账号、运行账号和 Redis DB/命名空间；
4. 注入环境变量，先执行数据库备份，再运行一次迁移；
5. 启动 API，确认回环健康检查；
6. 启动 Worker，确认队列健康；
7. 添加独立域名反向代理并签发 HTTPS；
8. 从公网复核页面、就绪检查、日志和错误路径；
9. 建立每日备份及一次真实恢复演练后，才可把云端备份状态改为已就绪。

## 回滚

- 代码使用 `releases/<版本>/` 与 `current` 指针切换；回滚只切回上一发布版本。
- 数据库迁移前必须有可恢复备份。涉及不可逆 Schema 变化时，不允许仅靠切换代码回滚。
- Nginx 变更先做配置检查；失败时恢复该独立站点配置，不改全局或其他站点配置。
- API/Worker 异常时只停止 AnswerTravel 自身进程，不操作现有 PHP、MySQL 或其他业务。

## 上线前必须取得的证据

- Node.js 24 版本与生产构建哈希；
- API/Worker 进程状态及回环健康检查；
- Nginx 配置检查和 HTTPS 公网访问；
- PostgreSQL/Redis 无公网监听；
- 数据库备份文件、校验值和恢复演练结果；
- 错误日志可查看、最小告警能触达；
- 当前 Alpha 限制在页面可见。
