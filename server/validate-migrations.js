const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const directory = path.join(__dirname, 'migrations');
const files = fs.readdirSync(directory).filter((file) => /^\d+_.+\.sql$/.test(file)).sort();
assert.ok(files.length >= 4, '至少应包含基础表、过渡存储、运行时扩展和信源证据四份迁移。');
assert.deepEqual(files, [...files].sort(), '迁移文件必须按名称稳定排序。');

const combined = files.map((file) => fs.readFileSync(path.join(directory, file), 'utf8')).join('\n').toLowerCase();
for (const table of ['users', 'workspaces', 'workspace_members', 'brands', 'prompts', 'collection_tasks', 'answer_records', 'assets', 'articles', 'publish_jobs', 'refresh_tokens', 'audit_logs', 'answertravel_state']) {
  assert.match(combined, new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+${table}\\b`), `缺少数据表 ${table}`);
}
assert.match(combined, /create\s+table\s+if\s+not\s+exists\s+runtime_tasks\b/, '缺少统一运行任务表 runtime_tasks');
assert.match(combined, /alter\s+table\s+brands\s+add\s+column\s+if\s+not\s+exists\s+external_id/, '品牌必须支持迁移期间的外部业务 ID');
assert.match(combined, /alter\s+table\s+workspaces\s+add\s+column\s+if\s+not\s+exists\s+revision/, '工作空间必须具备并发写入版本号');
assert.match(combined, /alter\s+table\s+audit_logs\s+add\s+column\s+if\s+not\s+exists\s+external_resource_id/, '审计日志必须保存稳定的外部资源 ID');
assert.doesNotMatch(combined, /\bdrop\s+(table|database|schema)\b/, '基线迁移不应包含破坏性 DROP。');
assert.match(combined, /workspace_id\s+uuid\s+not\s+null/, '业务表必须包含 workspace_id 租户字段。');
assert.match(combined, /token_hash\s+text\s+not\s+null\s+unique/, '刷新令牌必须只保存哈希且保持唯一。');
assert.match(combined, /alter\s+table\s+answer_sources\s+add\s+column\s+if\s+not\s+exists\s+source_type/, '回答信源必须区分来源类型。');
assert.match(combined, /verification_status/, '回答信源必须保存验证状态。');

console.log(`AnswerTravel migration baseline passed (${files.length} files).`);
