# 意图卡：阿里云生产备份与隔离恢复演练 V1

状态：Gate A-D 实施中
日期：2026-09-16

## 用户价值

证明北京珈程生产数据不仅可以备份，而且能够在不触碰生产数据卷的临时容器中恢复并读取，避免把“已有备份文件”误当成“可恢复”。

## 范围

- 对生产PostgreSQL执行一致性逻辑备份；
- 触发Redis RDB快照并复制到受限备份目录；
- 记录两份备份的SHA-256；
- 在临时PostgreSQL容器和临时Redis容器中恢复；
- 比较租户、品牌真相、问题组、观察计划、原始回答、监测计划以及Redis DB2键数量；
- 输出不含密码或API Key的恢复清单。

## 安全边界

- 不停止、不重建生产PostgreSQL、Redis、API或Worker；
- 不挂载或修改生产数据卷；
- 不执行`docker compose down -v`；
- 不调用DeepSeek、不创建观察计划、不发布；
- 临时恢复容器和临时恢复卷使用唯一名称，演练结束后清理；备份文件保留在`/www/backup/answertravel-v2/<时间戳>/`。

## 验收标准

- PostgreSQL与Redis生产容器在备份前均为healthy；
- 两份备份文件非空且有SHA-256；
- PostgreSQL恢复后的关键表计数与生产一致；
- Redis恢复后的DB2键数量与生产一致；
- 输出`BACKUP_RESTORE_GATE=PASS`；
- 生产API与Worker仍保持运行，且未发生DeepSeek调用。
