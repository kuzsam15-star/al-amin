import categoryRegistrySource from "../../content/category-registry.json" with { type: "json" };

export const categoryRegistry = Object.freeze({
  schemaVersion: categoryRegistrySource.schemaVersion,
  taxonomyVersion: categoryRegistrySource.taxonomyVersion,
  locale: categoryRegistrySource.locale,
  selectionLimit: categoryRegistrySource.selectionLimit,
  groups: Object.freeze(categoryRegistrySource.groups
    .map(({ id, label, sortOrder }) => Object.freeze({ id, label, sortOrder }))
    .sort((a, b) => a.sortOrder - b.sortOrder)),
  categories: Object.freeze(categoryRegistrySource.categories
    .filter((item) => item.active === true)
    .map(({ id, groupId, label, aliases }) => Object.freeze({ id, groupId, label, aliases: Object.freeze([...(aliases || [])]) }))),
});

export const categoryTaxonomyVersion = categoryRegistry.taxonomyVersion;
export const categorySelectionLimit = categoryRegistry.selectionLimit;

const categoryById = new Map(categoryRegistry.categories.map((item) => [item.id, item]));
const groupById = new Map(categoryRegistry.groups.map((item) => [item.id, item]));

export function normalizeCategorySearch(value) {
  return String(value || "")
    .normalize("NFC")
    .toLocaleLowerCase("ru")
    .replaceAll("ё", "е")
    .replace(/\s+/gu, " ")
    .trim();
}

const labelMatches = new Map();
const aliasMatches = new Map();
for (const item of categoryRegistry.categories) {
  const labelKey = normalizeCategorySearch(item.label);
  labelMatches.set(labelKey, [...(labelMatches.get(labelKey) || []), item.id]);
  for (const alias of item.aliases) {
    const aliasKey = normalizeCategorySearch(alias);
    aliasMatches.set(aliasKey, [...(aliasMatches.get(aliasKey) || []), item.id]);
  }
}

// Only aliases explicitly approved by the handoff may migrate legacy public data automatically.
const safeLegacyAliases = new Map([
  [normalizeCategorySearch("YouTube"), "creator-001"],
  [normalizeCategorySearch("ютуб"), "creator-001"],
  [normalizeCategorySearch("ютюб"), "creator-001"],
]);

export function getCategoryById(id) {
  return categoryById.get(String(id || "")) || null;
}

export function getCategoryGroup(groupId) {
  return groupById.get(String(groupId || "")) || null;
}

export function getCategoryLabels(categoryIds) {
  return Array.isArray(categoryIds)
    ? categoryIds.map((id) => getCategoryById(id)?.label).filter(Boolean)
    : [];
}

export function validateCategorySelection(categoryIds, taxonomyVersion, { allowEmpty = false } = {}) {
  const errors = [];
  if (taxonomyVersion !== categoryTaxonomyVersion) errors.push(`taxonomyVersion: поддерживается ${categoryTaxonomyVersion}`);
  if (!Array.isArray(categoryIds)) return { errors: [...errors, "categoryIds: ожидается массив"], categoryIds: [], categories: [] };
  if (categoryIds.length > categorySelectionLimit) errors.push(`categoryIds: максимум ${categorySelectionLimit} элементов`);
  const normalized = [];
  const seen = new Set();
  categoryIds.slice(0, categorySelectionLimit).forEach((rawId, index) => {
    if (typeof rawId !== "string" || !rawId.trim()) {
      errors.push(`categoryIds.${index}: ожидается непустой ID`);
      return;
    }
    const id = rawId.trim();
    if (!categoryById.has(id)) {
      errors.push(`categoryIds.${index}: неизвестная категория`);
      return;
    }
    if (seen.has(id)) {
      errors.push(`categoryIds.${index}: дубликат`);
      return;
    }
    seen.add(id);
    normalized.push(id);
  });
  if (!allowEmpty && !normalized.length) errors.push("categoryIds: выберите хотя бы одну категорию");
  return { errors, categoryIds: normalized, categories: getCategoryLabels(normalized) };
}

export function resolveLegacyCategories(values) {
  const categoryIds = [];
  const unresolved = [];
  const seen = new Set();
  for (const rawValue of Array.isArray(values) ? values : []) {
    if (typeof rawValue !== "string") continue;
    const value = rawValue.normalize("NFC").trim();
    if (!value) continue;
    const key = normalizeCategorySearch(value);
    const exactLabelIds = labelMatches.get(key) || [];
    const safeAliasId = safeLegacyAliases.get(key);
    const id = exactLabelIds.length === 1 ? exactLabelIds[0] : safeAliasId;
    if (id && !seen.has(id)) {
      categoryIds.push(id);
      seen.add(id);
    } else if (!id && !unresolved.some((entry) => normalizeCategorySearch(entry) === key)) {
      unresolved.push(value);
    }
  }
  return { categoryIds, categories: getCategoryLabels(categoryIds), unresolved };
}

function searchRank(item, query) {
  const label = normalizeCategorySearch(item.label);
  const aliases = item.aliases.map(normalizeCategorySearch);
  if (label === query) return 0;
  if (aliases.includes(query)) return 1;
  if (label.startsWith(query)) return 2;
  if (aliases.some((alias) => alias.startsWith(query))) return 3;
  if (label.includes(query)) return 4;
  if (aliases.some((alias) => alias.includes(query))) return 5;
  return Number.POSITIVE_INFINITY;
}

export function searchCategoryRegistry(query) {
  const normalized = normalizeCategorySearch(query);
  if (!normalized) return [];
  return categoryRegistry.categories
    .map((item) => ({ ...item, groupLabel: getCategoryGroup(item.groupId)?.label || "", rank: searchRank(item, normalized) }))
    .filter((item) => Number.isFinite(item.rank))
    .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, "ru"));
}

export function categoryRegistryIntegrity() {
  const ids = new Set();
  const groupIds = new Set();
  const labels = new Set();
  const aliasKeys = new Set();
  let aliases = 0;
  const errors = [];
  for (const group of categoryRegistry.groups) {
    if (!/^[a-z][a-z0-9-]*$/u.test(group.id)) errors.push(`invalid group id: ${group.id}`);
    if (groupIds.has(group.id)) errors.push(`duplicate group id: ${group.id}`);
    if (!group.label.trim()) errors.push(`empty group label: ${group.id}`);
    groupIds.add(group.id);
  }
  for (const item of categoryRegistry.categories) {
    if (!/^[a-z][a-z0-9-]*$/u.test(item.id)) errors.push(`invalid category id: ${item.id}`);
    if (ids.has(item.id)) errors.push(`duplicate category id: ${item.id}`);
    ids.add(item.id);
    if (!groupIds.has(item.groupId)) errors.push(`unknown group ${item.groupId}: ${item.id}`);
    const labelKey = normalizeCategorySearch(item.label);
    if (!labelKey) errors.push(`empty category label: ${item.id}`);
    if (labels.has(labelKey)) errors.push(`duplicate category label: ${item.label}`);
    labels.add(labelKey);
    for (const alias of item.aliases) {
      const aliasKey = normalizeCategorySearch(alias);
      if (!aliasKey) errors.push(`empty alias: ${item.id}`);
      if (aliasKeys.has(aliasKey)) errors.push(`duplicate alias: ${alias}`);
      if (labels.has(aliasKey) || labelMatches.has(aliasKey)) errors.push(`alias duplicates category label: ${alias}`);
      aliasKeys.add(aliasKey);
      aliases += 1;
    }
  }
  return { errors, groups: categoryRegistry.groups.length, categories: categoryRegistry.categories.length, aliases };
}
