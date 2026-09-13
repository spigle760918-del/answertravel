const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
for (const file of ['compose.yaml', 'Dockerfile.web', 'deploy/nginx.conf', '.env.production.example', 'docs/AnswerTravel-deployment.md']) {
  assert.ok(fs.existsSync(path.join(root, file)), `缺少部署文件 ${file}`);
}

const compose = read('compose.yaml');
for (const service of ['postgres:', 'api:', 'web:']) assert.match(compose, new RegExp(`^  ${service}$`, 'm'), `compose 缺少 ${service.slice(0, -1)} 服务`);
assert.match(compose, /ANSWERTRAVEL_STORAGE:\s*postgres/, '生产 API 必须使用 PostgreSQL');
assert.match(compose, /ANSWERTRAVEL_DEMO_AUTH:\s*"false"/, '生产 API 必须关闭演示认证');
assert.match(compose, /npm run migrate && node index\.js/, 'API 启动前必须执行迁移');
assert.match(compose, /condition:\s*service_healthy/, '服务启动顺序必须依赖健康检查');

const nginx = read('deploy/nginx.conf');
assert.match(nginx, /location \/api\/\s*\{[\s\S]*proxy_pass http:\/\/api:4174;/, 'Nginx 必须把 /api/ 转发给 API');
assert.match(nginx, /Content-Security-Policy/, '前端必须返回内容安全策略');
assert.match(nginx, /location = \/healthz/, '前端必须提供健康检查');

const apiClient = read('api-client.js');
assert.match(apiClient, /:\s*'\/api\/v1'/, '生产前端必须默认使用同源 /api/v1');
assert.doesNotMatch(read('.env.production.example'), /^(?!#).*=(?:password|secret|admin123)$/im, '示例环境文件不得包含可直接使用的弱凭证');

console.log('AnswerTravel deployment baseline passed.');
