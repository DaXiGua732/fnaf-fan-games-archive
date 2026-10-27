/**
 * 分类词表的归一化、查询与安全修改
 *
 * 【为什么把逻辑放在纯函数里】
 * 本地仓储与 GitHub 仓储必须对「重名」「合并」「删除保护」给出**完全相同**的结果。
 * 各写一份迟早分叉；这里返回新对象、不修改入参，仓储只负责持久化与并发重放。
 *
 * 【ID 与名称】
 *   - id 是稳定标识，创建后不可改；作品存 id，所以改名不需要批量改作品。
 *   - name 是展示名称，可改；同集合内按 NFKC + 小写 + 折叠空白判重。
 *   - 历史数据可能把平台名（如 "Windows"）直接写在 platforms 里，
 *     读取时按「先 id、再 name」解析；合并 / 删除时也同时匹配名称。
 */
import { initialTaxonomy } from '../config/taxonomy'
import type { AdminGame } from '../types/admin'
import type {
  Taxonomy,
  TaxonomyNormalizationResult,
  VocabularyCollection,
  VocabularyEntry,
  VocabularyEntryInput,
  VocabularyEntryPatch,
  VocabularyMutationResult,
} from '../types/taxonomy'
import {
  VOCABULARY_COLLECTIONS,
  VOCABULARY_LABELS,
  VOCABULARY_LIMITS,
} from '../types/taxonomy'
import { isRecord } from './guards'

export interface VocabularyGameMutationResult extends VocabularyMutationResult {
  games: AdminGame[]
  /**
   * 本次实际改写的作品 id。
   *
   * 持久化只能写这些记录：把整个作品列表重新序列化会顺手清掉
   * 未编辑作品上的历史异常关系（质量检查本来要报告它们）。
   */
  affectedGameIds: string[]
}

/* ---------------------------------------------------------------------------
   基础归一化
   --------------------------------------------------------------------------- */

export function normalizeVocabularyName(input: unknown): string {
  if (typeof input !== 'string') return ''
  return input.normalize('NFKC').trim().replace(/\s+/g, ' ')
}

/** 判重用的名称键：保留展示名的大小写，只用于比较 */
export function vocabularyNameKey(input: unknown): string {
  return normalizeVocabularyName(input).toLocaleLowerCase()
}

export function normalizeVocabularyDescription(input: unknown): string {
  return typeof input === 'string' ? input.normalize('NFKC').trim() : ''
}

/**
 * 把任意输入变成合法 id 的形状。
 * 中文等非 ASCII 名称会得到空字符串 —— 调用方应改用 generateVocabularyId()。
 */
export function normalizeVocabularyId(input: unknown): string {
  if (typeof input !== 'string') return ''
  return input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function isValidVocabularyId(id: string): boolean {
  return (
    id.length > 0 &&
    id.length <= VOCABULARY_LIMITS.idMax &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)
  )
}

export function isValidVocabularyName(name: string): boolean {
  return name.length > 0 && name.length <= VOCABULARY_LIMITS.nameMax
}

export function isValidVocabularyDescription(description: string): boolean {
  return description.length <= VOCABULARY_LIMITS.descriptionMax
}

/* ---------------------------------------------------------------------------
   归一化
   --------------------------------------------------------------------------- */

export function emptyTaxonomy(): Taxonomy {
  return { gameplayTypes: [], mechanics: [], platforms: [] }
}

export function cloneTaxonomy(taxonomy: Taxonomy): Taxonomy {
  return {
    ...taxonomy,
    gameplayTypes: taxonomy.gameplayTypes.map((item) => ({ ...item })),
    mechanics: taxonomy.mechanics.map((item) => ({ ...item })),
    platforms: taxonomy.platforms.map((item) => ({ ...item })),
  }
}

function normalizeEntry(raw: unknown): VocabularyEntry | null {
  if (!isRecord(raw)) return null

  const name = normalizeVocabularyName(raw.name)
  const id = normalizeVocabularyId(raw.id)
  if (!name || !id) return null

  // 保留未知扩展字段，避免以后加 aliases / note 时被旧代码抹掉
  return {
    ...raw,
    id,
    name,
    description: normalizeVocabularyDescription(raw.description),
  }
}

/**
 * 归一化整个词表。
 *
 * 缺省与损坏的区别很重要：
 *   - `taxonomy` 不存在（undefined / null）→ present=false，使用内置初始词表
 *   - `taxonomy` 存在但集合为空 → present=true、空词表，**不回填**（尊重管理员删空）
 *   - `taxonomy` 结构损坏 → 尽量保留合法词条；整块不可用时回退初始词表并记录 issue
 */
export function normalizeTaxonomy(raw: unknown): TaxonomyNormalizationResult {
  const issues: string[] = []

  if (raw === undefined || raw === null) {
    return { taxonomy: initialTaxonomy(), issues, present: false, usable: true }
  }
  if (!isRecord(raw)) {
    issues.push('taxonomy 不是对象，已使用内置初始词表')
    return { taxonomy: initialTaxonomy(), issues, present: false, usable: true }
  }

  // 三个集合都必须是数组，才允许这份词表替换调用方当前持有的词表。
  // 缺失一个集合时仍尽量归一化其余集合（供诊断 / 后台修复），但标记 usable=false。
  const usable = VOCABULARY_COLLECTIONS.every((collection) =>
    Array.isArray(raw[collection]),
  )

  // 先保留顶层扩展字段，再覆盖三套已知集合（即使缺字段也落成空数组）
  const taxonomy: Taxonomy = {
    ...raw,
    gameplayTypes: [],
    mechanics: [],
    platforms: [],
  }
  const nameOwners = new Map<string, VocabularyCollection>()
  const seenIds: Record<VocabularyCollection, Set<string>> = {
    gameplayTypes: new Set(),
    mechanics: new Set(),
    platforms: new Set(),
  }
  // 同集合判重必须独立于跨集合的 nameOwners：
  // 若某名称先被另一集合占用，nameOwners 不会指向当前集合，
  // 只看它会让当前集合里的第二个同名词条漏过去。
  const seenNames: Record<VocabularyCollection, Set<string>> = {
    gameplayTypes: new Set(),
    mechanics: new Set(),
    platforms: new Set(),
  }

  for (const collection of VOCABULARY_COLLECTIONS) {
    const list = raw[collection]
    if (list === undefined) {
      issues.push(`${VOCABULARY_LABELS[collection]} 缺失，按空词表处理`)
      continue
    }
    if (!Array.isArray(list)) {
      issues.push(`${VOCABULARY_LABELS[collection]} 不是数组，按空词表处理`)
      continue
    }

    for (const item of list) {
      const entry = normalizeEntry(item)
      if (!entry) {
        issues.push(`${VOCABULARY_LABELS[collection]} 中有词条缺少合法的 id 或名称，已忽略`)
        continue
      }
      if (seenIds[collection].has(entry.id)) {
        issues.push(`${VOCABULARY_LABELS[collection]} 中 id「${entry.id}」重复，已保留第一条`)
        continue
      }
      const key = vocabularyNameKey(entry.name)
      if (seenNames[collection].has(key)) {
        issues.push(`${VOCABULARY_LABELS[collection]} 中名称「${entry.name}」重复，已保留第一条`)
        continue
      }

      seenIds[collection].add(entry.id)
      seenNames[collection].add(key)
      taxonomy[collection].push(entry)

      const owner = nameOwners.get(key)
      if (!owner) {
        nameOwners.set(key, collection)
      } else {
        issues.push(
          `「${entry.name}」同时出现在${VOCABULARY_LABELS[owner]}与${VOCABULARY_LABELS[collection]}中`,
        )
      }
    }
  }

  return { taxonomy, issues, present: true, usable }
}

/* ---------------------------------------------------------------------------
   查询
   --------------------------------------------------------------------------- */

export function findVocabularyEntry(
  taxonomy: Taxonomy,
  collection: VocabularyCollection,
  id: string,
): VocabularyEntry | undefined {
  return taxonomy[collection].find((item) => item.id === id)
}

/** 先按 id、再按名称解析（兼容历史数据里直接写平台名的记录） */
export function resolveVocabularyEntry(
  taxonomy: Taxonomy,
  collection: VocabularyCollection,
  value: string,
): VocabularyEntry | undefined {
  const text = value.trim()
  if (!text) return undefined
  return (
    taxonomy[collection].find((item) => item.id === text) ??
    taxonomy[collection].find((item) => vocabularyNameKey(item.name) === vocabularyNameKey(text))
  )
}

/** 同一名称是否已经出现在别的集合里（后台新建时用于提示，不阻止保存） */
export function findVocabularyNameConflicts(
  taxonomy: Taxonomy,
  collection: VocabularyCollection,
  name: string,
): VocabularyCollection[] {
  const key = vocabularyNameKey(name)
  if (!key) return []
  return VOCABULARY_COLLECTIONS.filter(
    (other) =>
      other !== collection &&
      taxonomy[other].some((item) => vocabularyNameKey(item.name) === key),
  )
}

/** 名称 / id 生成稳定标识：中文名得不到 ASCII slug 时退化为集合前缀 + 序号 */
export function generateVocabularyId(
  collection: VocabularyCollection,
  name: string,
  existingIds: Iterable<string>,
): string {
  const prefix = collection === 'gameplayTypes' ? 'gt' : collection === 'mechanics' ? 'mc' : 'pf'
  const base = normalizeVocabularyId(name) || prefix
  const taken = new Set(existingIds)
  if (!taken.has(base)) return base

  let suffix = 2
  while (taken.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

/* ---------------------------------------------------------------------------
   修改（全部返回新对象，不修改入参）
   --------------------------------------------------------------------------- */

function fail(message: string): never {
  throw new Error(message)
}

export interface CreateVocabularyResult {
  taxonomy: Taxonomy
  entry: VocabularyEntry
}

export function createVocabularyEntryIn(
  taxonomy: Taxonomy,
  collection: VocabularyCollection,
  input: VocabularyEntryInput,
): CreateVocabularyResult {
  const label = VOCABULARY_LABELS[collection]
  const name = normalizeVocabularyName(input.name)
  if (!isValidVocabularyName(name)) {
    fail(`${label}名称不能为空，且不能超过 ${VOCABULARY_LIMITS.nameMax} 个字符`)
  }

  const description = normalizeVocabularyDescription(input.description)
  if (!isValidVocabularyDescription(description)) {
    fail(`词条定义不能超过 ${VOCABULARY_LIMITS.descriptionMax} 个字符`)
  }

  const key = vocabularyNameKey(name)
  if (taxonomy[collection].some((item) => vocabularyNameKey(item.name) === key)) {
    fail(`${label}中已经有「${name}」`)
  }

  const rawId = typeof input.id === 'string' ? input.id.trim() : ''
  let id: string
  if (rawId) {
    id = normalizeVocabularyId(rawId)
    if (!id || !isValidVocabularyId(id)) {
      fail('稳定标识只能使用小写字母、数字和连字符')
    }
  } else {
    id = generateVocabularyId(
      collection,
      name,
      taxonomy[collection].map((item) => item.id),
    )
  }

  if (taxonomy[collection].some((item) => item.id === id)) {
    fail(`稳定标识「${id}」已经被使用`)
  }

  const entry: VocabularyEntry = { id, name, description }
  const next = cloneTaxonomy(taxonomy)
  next[collection].push(entry)
  return { taxonomy: next, entry }
}

export interface UpdateVocabularyResult {
  taxonomy: Taxonomy
  entry: VocabularyEntry
}

export function updateVocabularyEntryIn(
  taxonomy: Taxonomy,
  collection: VocabularyCollection,
  id: string,
  patch: VocabularyEntryPatch,
): UpdateVocabularyResult {
  const label = VOCABULARY_LABELS[collection]
  const index = taxonomy[collection].findIndex((item) => item.id === id)
  if (index === -1) fail(`${label}中找不到 id 为「${id}」的词条`)

  const current = taxonomy[collection][index]
  const name =
    patch.name === undefined ? current.name : normalizeVocabularyName(patch.name)
  if (!isValidVocabularyName(name)) {
    fail(`${label}名称不能为空，且不能超过 ${VOCABULARY_LIMITS.nameMax} 个字符`)
  }
  if (
    taxonomy[collection].some(
      (item) => item.id !== id && vocabularyNameKey(item.name) === vocabularyNameKey(name),
    )
  ) {
    fail(`${label}中已经有「${name}」`)
  }

  const description =
    patch.description === undefined
      ? current.description
      : normalizeVocabularyDescription(patch.description)
  if (!isValidVocabularyDescription(description)) {
    fail(`词条定义不能超过 ${VOCABULARY_LIMITS.descriptionMax} 个字符`)
  }

  const entry: VocabularyEntry = { ...current, name, description }
  const next = cloneTaxonomy(taxonomy)
  next[collection][index] = entry
  return { taxonomy: next, entry }
}

/** 一个字面值是否指向某个词条（id 精确匹配，或名称归一化后相等） */
export function vocabularyValueMatches(value: string, entry: VocabularyEntry): boolean {
  return (
    value === entry.id || vocabularyNameKey(value) === vocabularyNameKey(entry.name)
  )
}

export function getVocabularyValues(
  game: AdminGame,
  collection: VocabularyCollection,
): string[] {
  return game[collection] ?? []
}

function setVocabularyValues(
  game: AdminGame,
  collection: VocabularyCollection,
  values: string[],
): AdminGame {
  if (collection === 'gameplayTypes') return { ...game, gameplayTypes: values }
  if (collection === 'mechanics') return { ...game, mechanics: values }
  return { ...game, platforms: values }
}

/**
 * 合并词条：把所有作品上的来源词条替换为目标词条并去重，再删除来源。
 * 旧数据里的名称写法（如 "Windows"）也会被识别并改写成目标 id。
 */
export function mergeVocabularyEntriesIn(
  taxonomy: Taxonomy,
  games: AdminGame[],
  collection: VocabularyCollection,
  sourceId: string,
  targetId: string,
): VocabularyGameMutationResult {
  if (sourceId === targetId) fail('不能把词条合并到它自己')
  const source = findVocabularyEntry(taxonomy, collection, sourceId)
  const target = findVocabularyEntry(taxonomy, collection, targetId)
  if (!source) fail(`找不到要合并的来源词条：${sourceId}`)
  if (!target) fail(`找不到合并目标词条：${targetId}`)

  let affectedGames = 0
  const affectedGameIds: string[] = []
  const nextGames = games.map((game) => {
    const values = getVocabularyValues(game, collection)
    let changed = false
    const nextValues: string[] = []

    for (const value of values) {
      // 来源与目标都统一写成目标 id：既完成合并，也顺手把历史名称写法规范化
      const mapped =
        vocabularyValueMatches(value, source) || vocabularyValueMatches(value, target)
          ? target.id
          : value
      if (mapped !== value) changed = true
      if (!nextValues.includes(mapped)) nextValues.push(mapped)
    }
    if (nextValues.length !== values.length) changed = true
    if (!changed) return game

    affectedGames += 1
    affectedGameIds.push(game.id)
    return setVocabularyValues(game, collection, nextValues)
  })

  const nextTaxonomy = cloneTaxonomy(taxonomy)
  nextTaxonomy[collection] = nextTaxonomy[collection].filter((item) => item.id !== sourceId)
  return { taxonomy: nextTaxonomy, games: nextGames, affectedGames, affectedGameIds }
}

/**
 * 删除词条。
 * 仍被作品引用时默认拒绝；`removeFromGames=true` 才会同时从所有作品移除。
 */
export function deleteVocabularyEntryIn(
  taxonomy: Taxonomy,
  games: AdminGame[],
  collection: VocabularyCollection,
  id: string,
  options: { removeFromGames?: boolean } = {},
): VocabularyGameMutationResult {
  const entry = findVocabularyEntry(taxonomy, collection, id)
  if (!entry) fail(`找不到 id 为「${id}」的词条`)

  const usage = games.filter((game) =>
    getVocabularyValues(game, collection).some((value) => vocabularyValueMatches(value, entry)),
  ).length
  if (usage > 0 && !options.removeFromGames) {
    fail(`该词条仍被 ${usage} 款作品使用，请先合并到其他词条，或明确从这些作品移除`)
  }

  let affectedGames = 0
  const affectedGameIds: string[] = []
  const nextGames = options.removeFromGames
    ? games.map((game) => {
        const values = getVocabularyValues(game, collection)
        const nextValues = values.filter((value) => !vocabularyValueMatches(value, entry))
        if (nextValues.length === values.length) return game
        affectedGames += 1
        affectedGameIds.push(game.id)
        return setVocabularyValues(game, collection, nextValues)
      })
    : games

  const nextTaxonomy = cloneTaxonomy(taxonomy)
  nextTaxonomy[collection] = nextTaxonomy[collection].filter((item) => item.id !== id)
  return { taxonomy: nextTaxonomy, games: nextGames, affectedGames, affectedGameIds }
}

/* ---------------------------------------------------------------------------
   统计（供后台词表页与前台筛选元数据使用）
   --------------------------------------------------------------------------- */

/** 每个词条被多少作品使用。调用方传全部作品或公开可见作品即可得到对应口径 */
export function countVocabularyUsage(
  games: AdminGame[],
  taxonomy: Taxonomy,
  collection: VocabularyCollection,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const entry of taxonomy[collection]) {
    let count = 0
    for (const game of games) {
      if (
        getVocabularyValues(game, collection).some((value) =>
          vocabularyValueMatches(value, entry),
        )
      ) {
        count += 1
      }
    }
    counts.set(entry.id, count)
  }
  return counts
}

/** 至少被一款给定作品使用的词条，保持词表顺序；公开筛选只应传可见作品 */
export function vocabularyOptionsForGames(
  taxonomy: Taxonomy,
  games: AdminGame[],
  collection: VocabularyCollection,
): VocabularyEntry[] {
  const used = new Set<string>()
  for (const game of games) {
    for (const value of getVocabularyValues(game, collection)) {
      const entry = resolveVocabularyEntry(taxonomy, collection, value)
      if (entry) used.add(entry.id)
    }
  }
  return taxonomy[collection].filter((entry) => used.has(entry.id))
}

/** 未标玩法类型的作品数（后台完整度提示，不阻止保存） */
export function countUnclassifiedGames(games: AdminGame[]): number {
  return games.filter((game) => (game.gameplayTypes ?? []).length === 0).length
}

/** 供测试与后台诊断：词表里存在但从未被使用的词条数 */
export function countUnusedEntries(
  games: AdminGame[],
  taxonomy: Taxonomy,
  collection: VocabularyCollection,
): number {
  const counts = countVocabularyUsage(games, taxonomy, collection)
  return [...counts.values()].filter((count) => count === 0).length
}

/** 归一化裸输入，供后台表单在调用修改函数前做即时提示 */
export function normalizeTaxonomyInput(input: {
  name?: unknown
  description?: unknown
  id?: unknown
}): { name: string; description: string; id: string } {
  return {
    name: normalizeVocabularyName(input.name),
    description: normalizeVocabularyDescription(input.description),
    id: normalizeVocabularyId(input.id),
  }
}

/** 数据里所有未知的词条引用（用于 Phase 6 的只读质量检查） */
export function collectUnknownVocabularyValues(
  games: AdminGame[],
  taxonomy: Taxonomy,
  collection: VocabularyCollection,
): string[] {
  const unknown = new Set<string>()
  for (const game of games) {
    for (const value of getVocabularyValues(game, collection)) {
      if (!resolveVocabularyEntry(taxonomy, collection, value)) unknown.add(value)
    }
  }
  return [...unknown].sort((a, b) => a.localeCompare(b, 'en'))
}
