# 数据库迁移

迁移文件按数字顺序执行，`npm run migrate` 会在事务中执行迁移，并将文件名和 SHA-256 校验值写入 `schema_migrations`。已执行文件一旦被修改，执行器会拒绝继续，必须新增迁移文件。

```text
001_initial.sql
002_state_store.sql
003_runtime_extensions.sql
004_incremental_audit.sql
```

`002_state_store.sql` 是早期快照驱动实验的兼容表；当前服务使用 `003_runtime_extensions.sql` 扩展后的关系表存储，正式上线后可在确认没有旧数据依赖时移除兼容表。

`004_incremental_audit.sql` 为审计日志增加稳定的外部资源标识，并补充审计与刷新令牌查询索引。

当前工作机已通过项目内嵌 PostgreSQL 16 完成真实数据库验证：四份迁移可在空库执行，JSON 数据可首次导入，服务重启后数据保留，品牌权限与筛选隔离通过，便携备份的校验、空库恢复和记录数比对也已通过。CI 和未来托管环境仍应重复执行这些验证。

迁移前必须完成：

1. 为每条 JSON 数据补齐 `workspace_id`、`brand_id` 和操作者映射。
2. 将中文演示状态映射为数据库英文枚举值。
3. 对 prompts、articles、members 做重复数据检测。
4. 迁移后比对记录总数、状态计数和关键字段哈希。
