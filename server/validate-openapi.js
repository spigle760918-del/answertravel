const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'openapi.yaml');
const source = fs.readFileSync(file, 'utf8');

assert.match(source, /^openapi:\s+3\.0\.3/m, '必须声明 OpenAPI 3.0.3');
assert.match(source, /^components:\s*$/m, '缺少 components 节点');
assert.match(source, /bearerAuth:/, '必须声明 Bearer 认证方案');
assert.match(source, /^security:\s*\n\s+- bearerAuth:\s*\[\]/m, '业务接口必须默认使用 Bearer 认证');

const requiredPaths = [
  '/auth/login:', '/auth/local-admin:', '/auth/register:', '/auth/refresh:', '/auth/logout:', '/auth/me:',
  '/providers:',
  '/workspace:', '/workspace/team:', '/workspace/channels/{channelId}:',
  '/brands:', '/brands/{brandId}:', '/brands/{brandId}/competitors:',
  '/prompt-groups:', '/prompt-groups/{groupId}:', '/prompts:', '/prompts/{promptId}:', '/records:', '/sources:', '/sources/refresh:', '/records/{recordId}/rerun:',
  '/assets:', '/assets/{assetId}:', '/members:', '/members/{memberId}:',
  '/articles:', '/articles/{articleId}:', '/articles/{articleId}/review:',
  '/articles/{articleId}/publish:', '/articles/{articleId}/index:',
  '/tasks:', '/tasks/{taskId}:', '/tasks/{taskId}/{action}:'
];
for (const route of requiredPaths) assert.match(source, new RegExp(`^  ${route.replace(/[{}]/g, '\\$&')}$`, 'm'), `OpenAPI 缺少路径 ${route.slice(0, -1)}`);

const refs = [...source.matchAll(/\$ref:\s*['"]#\/components\/schemas\/([^'"\s]+)['"]/g)].map((match) => match[1]);
for (const ref of refs) assert.match(source, new RegExp(`^    ${ref}:`, 'm'), `OpenAPI 引用了未定义 schema ${ref}`);

for (const match of source.matchAll(/^  (\/[^\s:]+):[\s\S]*?(?=^  \/|^components:|(?![\s\S]))/gm)) {
  const route = match[1];
  const params = [...route.matchAll(/\{([^}]+)\}/g)].map((item) => item[1]);
  for (const param of params) assert.match(match[0], new RegExp(`name:\\s*${param}\\b`), `${route} 缺少路径参数 ${param}`);
}

console.log(`AnswerTravel OpenAPI baseline passed (${requiredPaths.length} required paths).`);
