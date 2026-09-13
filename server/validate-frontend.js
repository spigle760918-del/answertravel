const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const apiClient = fs.readFileSync(path.join(__dirname, '..', 'api-client.js'), 'utf8');
const authUi = fs.readFileSync(path.join(__dirname, '..', 'auth-ui.js'), 'utf8');
const promptGroupsUi = fs.readFileSync(path.join(__dirname, '..', 'prompt-groups-ui.js'), 'utf8');
const collectionStatusUi = fs.readFileSync(path.join(__dirname, '..', 'collection-status-ui.js'), 'utf8');
const brandIntelligence = fs.readFileSync(path.join(__dirname, '..', 'brand-intelligence.js'), 'utf8');
const brandOptimizationUi = fs.readFileSync(path.join(__dirname, '..', 'brand-optimization-ui.js'), 'utf8');
const memberPermissionsUi = fs.readFileSync(path.join(__dirname, '..', 'member-permissions-ui.js'), 'utf8');
const workspaceData = fs.readFileSync(path.join(__dirname, '..', 'workspace-data.js'), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter(Boolean);

for (const [name, source] of [['brand-intelligence.js', brandIntelligence], ['brand-optimization-ui.js', brandOptimizationUi]]) {
  try { new Function(source); } catch (error) { throw new Error(`${name} 语法错误：${error.message}`); }
}

scripts.forEach((source, index) => {
  try {
    new Function(source);
  } catch (error) {
    throw new Error(`index.html 内联脚本 ${index + 1} 语法错误：${error.message}`);
  }
});

assert.match(html, /name="confirmPermission" required/, '成员改权必须要求二次确认');
assert.match(html, /name="confirmPublish" required/, '文章发布必须要求二次确认');
assert.match(html, /dataset\.submitting==='true'/, '高风险操作必须阻止重复提交');
assert.match(html, /工作空间必须至少保留一位正常状态的团队管理员/, '前端必须保护最后一位团队管理员');
assert.match(apiClient, /pendingInviteToken/, '邀请链接必须优先于浏览器中的既有登录会话');
assert.match(apiClient, /async function refreshFromServer\(/, '已打开页面必须支持从服务端增量取得多用户与后台任务的最新状态');
assert.match(apiClient, /if \(!ready \|\| syncing \|\| pendingSnapshot \|\| timer\) return false/, '服务端自动刷新不得覆盖等待保存或正在同步的本地修改');
assert.match(apiClient, /typeof window\.setInterval === 'function'[\s\S]*refreshFromServer\(\{ silent: true \}\)[\s\S]*5000\)/, '页面可见时必须定期刷新后台任务和其他成员的修改');
assert.match(apiClient, /window\.addEventListener\('focus'/, '用户返回页面时必须立即刷新服务端数据');
assert.match(apiClient, /resendMemberInvitation/, 'API 客户端必须支持重新生成成员邀请');
assert.match(apiClient, /history\.replaceState/, '邀请注册成功后必须清除 URL 中的邀请码');
assert.match(authUi, /let mode = inviteToken \? 'register' : 'login'/, '邀请 URL 必须默认打开注册表单');
assert.match(authUi, /if \(detail\.invitation\) \{\s*setMode\('register'\)/, '邀请校验成功后必须保持注册表单可见');
assert.match(authUi, /emailInput\.readOnly = true/, '邀请注册必须固定为受邀邮箱');
assert.match(authUi, /form\.querySelector\('input\[name="password"\]'\)\?\.value/, '登录提交必须直接读取密码输入框的当前值');
assert.match(authUi, /await client\(\)\.localAdminStatus\(\)/, '本地管理员入口必须先由 API 明确确认可用');
assert.match(authUi, /data-auth-local-admin hidden/, '本地管理员入口必须默认隐藏');
assert.match(apiClient, /loginAsLocalAdmin/, 'API 客户端必须支持本地管理员快捷登录');
assert.match(html, /workspace-data\.js\?v=/, '页面必须载入统一的工作空间数据层');
assert.match(workspaceData, /function brandScope\(/, '工作空间数据层必须统一提供品牌作用域');
assert.match(workspaceData, /function assignBrandOwnership\(/, '工作空间数据层必须统一补齐文章、任务等资源的品牌归属');
assert.match(workspaceData, /articleBrands\.get\(task\?\.articleId\)/, '文章发布任务必须继承文章所属品牌');
assert.equal((html.match(/function renderArticles\(/g) || []).length, 0, '不得保留会覆盖统一文章视图的旧版重复渲染器');
assert.match(html, /let renderArticles=\(\)=>\{\}/, '文章列表必须只由统一品牌作用域渲染器接管');
assert.match(promptGroupsUi, /workspaceData\(\)\?\.groupsForBrand/, '主题列表必须使用统一品牌作用域选择器');
assert.match(promptGroupsUi, /data-prompt-group-action="add"/, '用户提问页面必须提供新增主题入口');
assert.match(promptGroupsUi, /data-prompt-group-action="edit"/, '用户提问页面必须提供主题编辑入口');
assert.match(promptGroupsUi, /\.prompt-view-panel\[data-prompt-view="topic"\]/, '主题管理工具栏必须定位主题内容面板，不能误选页签按钮');
assert.doesNotMatch(promptGroupsUi, /prompt-group-actions\{[^}]*opacity\s*:\s*0/, '主题编辑与删除操作必须常驻可见');
assert.match(promptGroupsUi, /浏览器演示模式/, '未接入 API 时必须明确提示当前为浏览器演示模式');
assert.match(promptGroupsUi, /existingNotes\.slice\(1\)/, '浏览器演示提示必须去重，不能在重复渲染后堆叠');
assert.match(promptGroupsUi, /还有用户提问/, '非空主题删除必须阻止误删用户提问');
assert.match(promptGroupsUi, /answerTravelPromptGroupRefreshInstalled/, '真实主题渲染必须接管旧视图刷新后的最终渲染');
assert.match(html, /collection-status-ui\.js\?v=/, '回答记录页面必须载入采集状态提示');
assert.match(collectionStatusUi, /当前为模拟采集/, '没有真实模型时必须明确标记模拟采集，避免误认成真实监控数据');
assert.match(collectionStatusUi, /真实大模型采集已连接/, '接入模型后必须显示真实采集状态');
assert.match(collectionStatusUi, /dataset\.collectionEvidence/, '回答详情必须展示真实采集的模型版本、耗时和状态');
assert.match(collectionStatusUi, /模型接口没有返回可验证的引用链接/, '真实回答无引用时必须明确区分未返回引用与未采集到回答');
assert.match(html, /brand-intelligence\.js\?v=/, '页面必须载入统一品牌优化分析模型');
assert.match(html, /brand-optimization-ui\.js\?v=/, '文章管理必须载入采集诊断面板');
assert.match(brandIntelligence, /mentionCount:\s*mentionedRecords\.length/, '品牌提及率必须以回答提及次数为分子');
assert.match(brandIntelligence, /completed\.length \? round\(mentionedRecords\.length \/ completed\.length \* 100\)/, '品牌提及率必须以已完成采集答案数为分母');
assert.match(brandIntelligence, /待抓取信源正文/, '未抓取信源正文时不得伪造 AI 偏好结构分析');
assert.match(brandOptimizationUi, /自身提及率/, '品牌诊断面板必须展示自身提及率');
assert.match(brandOptimizationUi, /AI 情感标签/, '品牌诊断面板必须展示 AI 情感标签');
assert.match(brandOptimizationUi, /相对优势/, '品牌诊断面板必须展示竞品相对优势');
assert.match(html, /function currentAnalysisRecords\([^)]*\)[\s\S]*collectionMode==='live'/, '概览和洞察必须优先采用真实采集回答');
assert.match(html, /allPrompts=currentBrandItems\(data\.prompts\),allRecords=currentAnalysisRecords\(\)/, '概览指标不得混入同品牌的模拟历史回答');
assert.match(html, /prompts=currentBrandItems\(data\.prompts\),records=currentAnalysisRecords\(\),groups=scopeGroups/, '洞察指标必须与正式品牌诊断采用同一真实样本口径');
assert.match(html, /仅真实采集 · 历史共/, '回答记录摘要必须说明正式分析与历史记录的区别');
assert.match(html, /analysisSnapshot:analysis\?clone\(analysis\):null/, '文章生成必须固化本次品牌诊断快照');
assert.match(html, /member-permissions-ui\.js\?v=/, '团队页面必须载入多品牌成员权限管理');
assert.match(memberPermissionsUi, /品牌范围（可多选，至少一个）/, '成员权限必须支持同时选择多个品牌');
assert.match(memberPermissionsUi, /resendMemberInvitation/, '待接受成员必须支持重新生成邀请链接');
assert.match(memberPermissionsUi, /只有团队管理员可以管理成员权限/, '前端必须隐藏并阻止非团队管理员调整成员权限');
assert.match(memberPermissionsUi, /listAuditLogs/, '团队管理员必须能查看最近成员权限审计');
assert.match(memberPermissionsUi, /lastActiveAt/, '成员列表必须显示真实最近活动时间');
assert.match(promptGroupsUi, /refreshExistingViews\?\.\(\);\s*renderTopicGroups\(\)/, '旧提问视图刷新后必须再次渲染当前品牌真实主题');
assert.match(html, /workspaceData\?\.groupNamesForBrand\(snapshot,brandId\)/, '批量新建提问的主题下拉框必须读取统一的当前品牌主题列表');
assert.match(html, /function openPromptCreatePage\(\)\{\s*close\(\);\s*const esc=/, '新建提问页必须在自身作用域定义安全文本转义函数');
assert.match(html, /主题分组已创建，并已同步到主题列表/, '批量新建页内创建主题后必须立即写入主题列表');
assert.doesNotMatch(html, /const groupOptions=\[\.\.\.new Set\(\[\.\.\.monitored\.map\(item=>item\.group\)\.filter\(Boolean\),'路线规划'/, '批量新建提问不得混入写死的预置主题');
assert.match(html, /<select name="group" required>/, '单条提问编辑也必须从当前品牌主题列表中选择');
assert.doesNotMatch(html, /\['question','write','asset','member'\]\.includes\(n\)/, '新建提问不得先触发旧版弹窗');
assert.doesNotMatch(html, /if\(n==='create-prompts'\)\{const total=/, '批量创建不得在保存前由旧监听器跳回列表');
assert.match(html, /const renderTopics=items=>\{if\(window\.answerTravelPromptGroupRefreshInstalled\)return;/, '统一主题控制器启用后旧主题渲染器必须停止覆盖页面');

console.log(`AnswerTravel frontend interaction baseline passed (${scripts.length} inline scripts).`);
