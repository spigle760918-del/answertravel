(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.answerTravelWorkspaceData = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  function activeBrandId(state) {
    return text(state?.workspace?.brandId) || text(state?.brands?.[0]?.id);
  }

  function promptsForBrand(state, brandId = activeBrandId(state)) {
    return list(state?.prompts).filter((item) => text(item?.brandId) === brandId);
  }

  function storedGroupsForBrand(state, brandId = activeBrandId(state)) {
    return list(state?.promptGroups)
      .filter((item) => text(item?.brandId) === brandId && text(item?.name))
      .slice()
      .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0) || text(left.name).localeCompare(text(right.name), 'zh-CN'));
  }

  function groupsForBrand(state, brandId = activeBrandId(state)) {
    const groups = storedGroupsForBrand(state, brandId).map((item) => Object.assign({}, item));
    const names = new Set(groups.map((item) => text(item.name).toLowerCase()));
    for (const prompt of promptsForBrand(state, brandId)) {
      const name = text(prompt.group);
      if (!name || names.has(name.toLowerCase())) continue;
      groups.push({ id: `group-derived-${encodeURIComponent(brandId)}-${encodeURIComponent(name)}`, brandId, name, sortOrder: groups.length, derived: true });
      names.add(name.toLowerCase());
    }
    return groups;
  }

  function groupNamesForBrand(state, brandId = activeBrandId(state)) {
    return groupsForBrand(state, brandId).map((item) => item.name);
  }

  function recordsForBrand(state, brandId = activeBrandId(state)) {
    const promptIds = new Set(promptsForBrand(state, brandId).map((item) => item.id));
    return list(state?.records).filter((item) => text(item?.brandId) === brandId || (!text(item?.brandId) && promptIds.has(item?.promptId)));
  }

  function resourcesForBrand(state, key, brandId = activeBrandId(state)) {
    return list(state?.[key]).filter((item) => text(item?.brandId) === brandId);
  }

  function assignBrandOwnership(state, fallbackBrandId = activeBrandId(state)) {
    if (!state || typeof state !== 'object') throw new Error('工作空间数据无效。');
    const promptBrands = new Map(list(state.prompts).map((item) => [item?.id, text(item?.brandId) || fallbackBrandId]));
    const articleBrands = new Map(list(state.articles).map((item) => [item?.id, text(item?.brandId) || fallbackBrandId]));
    for (const prompt of list(state.prompts)) if (!text(prompt?.brandId)) prompt.brandId = fallbackBrandId;
    for (const record of list(state.records)) if (!text(record?.brandId)) record.brandId = promptBrands.get(record?.promptId) || fallbackBrandId;
    for (const asset of list(state.assets)) if (!text(asset?.brandId)) asset.brandId = fallbackBrandId;
    for (const article of list(state.articles)) if (!text(article?.brandId)) article.brandId = fallbackBrandId;
    for (const task of list(state.tasks)) {
      if (!text(task?.brandId)) task.brandId = promptBrands.get(task?.promptId) || articleBrands.get(task?.articleId) || fallbackBrandId;
    }
    return state;
  }

  function brandScope(state, brandId = activeBrandId(state)) {
    const brand = list(state?.brands).find((item) => text(item?.id) === brandId) || null;
    return {
      brandId,
      brand,
      competitors: list(brand?.competitors).slice(),
      promptGroups: groupsForBrand(state, brandId),
      prompts: promptsForBrand(state, brandId),
      records: recordsForBrand(state, brandId),
      assets: resourcesForBrand(state, 'assets', brandId),
      articles: resourcesForBrand(state, 'articles', brandId),
      tasks: resourcesForBrand(state, 'tasks', brandId)
    };
  }

  function ensureMutableGroups(state) {
    if (!state || typeof state !== 'object') throw new Error('工作空间数据无效。');
    if (!Array.isArray(state.promptGroups)) state.promptGroups = [];
    return state.promptGroups;
  }

  function ensurePromptGroup(state, input = {}) {
    const brandId = text(input.brandId) || activeBrandId(state);
    const name = text(input.name);
    if (!brandId) throw new Error('请先选择品牌。');
    if (!name) throw new Error('主题分组名称不能为空。');
    const groups = ensureMutableGroups(state);
    const existing = groups.find((item) => text(item.brandId) === brandId && text(item.name).toLowerCase() === name.toLowerCase());
    if (existing) return { group: existing, created: false };
    const group = {
      id: text(input.id) || `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      brandId,
      name,
      sortOrder: groups.filter((item) => text(item.brandId) === brandId).length,
      createdAt: input.createdAt || new Date().toISOString(),
      updatedAt: input.updatedAt || new Date().toISOString()
    };
    groups.push(group);
    return { group, created: true };
  }

  function renamePromptGroup(state, groupId, nextName) {
    const groups = ensureMutableGroups(state);
    const group = groups.find((item) => text(item.id) === text(groupId));
    const name = text(nextName);
    if (!group) throw new Error('主题分组不存在，请刷新后重试。');
    if (!name) throw new Error('主题分组名称不能为空。');
    if (groups.some((item) => item !== group && text(item.brandId) === text(group.brandId) && text(item.name).toLowerCase() === name.toLowerCase())) throw new Error('该主题分组已存在。');
    const oldName = text(group.name);
    group.name = name;
    group.updatedAt = new Date().toISOString();
    for (const prompt of promptsForBrand(state, text(group.brandId))) {
      if (text(prompt.group) !== oldName) continue;
      prompt.group = name;
      for (const record of list(state.records)) if (record.promptId === prompt.id) record.group = name;
    }
    return group;
  }

  function removePromptGroup(state, groupId) {
    const groups = ensureMutableGroups(state);
    const group = groups.find((item) => text(item.id) === text(groupId));
    if (!group) throw new Error('主题分组不存在，请刷新后重试。');
    if (promptsForBrand(state, text(group.brandId)).some((item) => text(item.group) === text(group.name))) throw new Error('该主题下还有用户提问，请先移动或删除提问。');
    state.promptGroups = groups.filter((item) => item !== group);
    return group;
  }

  return {
    activeBrandId,
    brandScope,
    groupNamesForBrand,
    groupsForBrand,
    promptsForBrand,
    recordsForBrand,
    resourcesForBrand,
    assignBrandOwnership,
    ensurePromptGroup,
    renamePromptGroup,
    removePromptGroup
  };
});
