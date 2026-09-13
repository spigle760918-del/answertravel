const assert = require('assert/strict');
const workspace = require('../workspace-data');

function fixture() {
  return {
    workspace: { brandId: 'brand-a' },
    brands: [
      { id: 'brand-a', name: '甲品牌', competitors: ['甲竞品'] },
      { id: 'brand-b', name: '乙品牌', competitors: ['乙竞品'] }
    ],
    promptGroups: [
      { id: 'group-a-empty', brandId: 'brand-a', name: '甲空主题', sortOrder: 0 },
      { id: 'group-b', brandId: 'brand-b', name: '乙主题', sortOrder: 0 }
    ],
    prompts: [
      { id: 'prompt-a', brandId: 'brand-a', group: '甲衍生主题', text: '甲问题' },
      { id: 'prompt-b', brandId: 'brand-b', group: '乙主题', text: '乙问题' }
    ],
    records: [
      { id: 'record-a', brandId: 'brand-a', promptId: 'prompt-a', group: '甲衍生主题' },
      { id: 'record-b', brandId: 'brand-b', promptId: 'prompt-b', group: '乙主题' }
    ],
    assets: [{ id: 'asset-a', brandId: 'brand-a' }, { id: 'asset-b', brandId: 'brand-b' }],
    articles: [{ id: 'article-a', brandId: 'brand-a' }, { id: 'article-b', brandId: 'brand-b' }],
    tasks: [{ id: 'task-a', brandId: 'brand-a', articleId: 'article-a' }, { id: 'task-b', brandId: 'brand-b', articleId: 'article-b' }]
  };
}

const state = fixture();
assert.equal(workspace.activeBrandId(state), 'brand-a');
assert.deepEqual(workspace.groupNamesForBrand(state), ['甲空主题', '甲衍生主题']);
assert.deepEqual(workspace.brandScope(state).prompts.map((item) => item.id), ['prompt-a']);
assert.deepEqual(workspace.brandScope(state).records.map((item) => item.id), ['record-a']);
assert.deepEqual(workspace.brandScope(state).assets.map((item) => item.id), ['asset-a']);
assert.deepEqual(workspace.brandScope(state).articles.map((item) => item.id), ['article-a']);
assert.deepEqual(workspace.brandScope(state).tasks.map((item) => item.id), ['task-a']);
assert.deepEqual(workspace.brandScope(state).competitors, ['甲竞品']);

state.workspace.brandId = 'brand-b';
assert.deepEqual(workspace.groupNamesForBrand(state), ['乙主题']);
assert.deepEqual(workspace.brandScope(state).prompts.map((item) => item.id), ['prompt-b']);
assert.deepEqual(workspace.brandScope(state).articles.map((item) => item.id), ['article-b']);
assert.deepEqual(workspace.brandScope(state).tasks.map((item) => item.id), ['task-b']);
assert.deepEqual(workspace.brandScope(state).competitors, ['乙竞品']);

const ownershipState = fixture();
ownershipState.workspace.brandId = 'brand-b';
ownershipState.articles.push({ id: 'article-new' });
ownershipState.tasks.push({ id: 'task-new', articleId: 'article-new' });
workspace.assignBrandOwnership(ownershipState);
assert.equal(ownershipState.articles.find((item) => item.id === 'article-new').brandId, 'brand-b', '新文章必须归属当前品牌');
assert.equal(ownershipState.tasks.find((item) => item.id === 'task-new').brandId, 'brand-b', '发布任务必须继承文章品牌');
assert.deepEqual(workspace.brandScope(ownershipState, 'brand-a').articles.map((item) => item.id), ['article-a'], '乙品牌文章不得出现在甲品牌');

state.workspace.brandId = 'brand-a';
const created = workspace.ensurePromptGroup(state, { id: 'group-a-new', name: '甲新主题' });
assert.equal(created.created, true);
assert.equal(workspace.ensurePromptGroup(state, { name: '甲新主题' }).created, false, '重复主题不得再次创建');
assert.ok(workspace.groupNamesForBrand(state).includes('甲新主题'));
assert.deepEqual(workspace.groupNamesForBrand(state, 'brand-b'), ['乙主题'], '甲品牌新增主题不得污染乙品牌');

const derived = workspace.groupsForBrand(state).find((item) => item.name === '甲衍生主题');
assert.equal(derived.derived, true, '历史提问对应的缺失主题应作为衍生主题显示');
const materialized = workspace.ensurePromptGroup(state, { id: 'group-a-derived', name: '甲衍生主题' });
assert.equal(materialized.created, true, '衍生主题应可补建为正式主题');
workspace.renamePromptGroup(state, materialized.group.id, '甲已改名');
assert.equal(state.prompts.find((item) => item.id === 'prompt-a').group, '甲已改名');
assert.equal(state.records.find((item) => item.id === 'record-a').group, '甲已改名');
assert.equal(state.prompts.find((item) => item.id === 'prompt-b').group, '乙主题', '主题改名不得影响其他品牌');

assert.throws(() => workspace.removePromptGroup(state, materialized.group.id), /还有用户提问/);
workspace.removePromptGroup(state, 'group-a-empty');
assert.ok(!workspace.groupNamesForBrand(state).includes('甲空主题'));

console.log('AnswerTravel workspace brand-scope and prompt-group tests passed.');
