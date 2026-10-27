/**
 * Phase 1 结构化资料基础断言集
 *
 * 覆盖：
 *   - 新增字段的归一化与旧数据默认值
 *   - 词表解析 / 重名 / 合并 / 删除保护 / 使用次数
 *   - 关系方向文案与保存前校验
 *   - 本地仓储与 GitHub 仓储的词表事务、冲突重放、删除清理
 *   - 草稿往返不会抹掉新字段
 *
 * 与其它断言集一样：不依赖线上数据的标题 / 条数，只断言规则。
 */
import { nextTick } from 'vue'
import { draftToPatch, gameToDraft } from '../composables/useAdminGameDraft'
import { initialTaxonomy } from '../config/taxonomy'
import { createGitHubGameRepository } from '../repositories/githubGameRepository'
import {
  createLocalGameRepository,
  STORAGE_KEY,
  TAXONOMY_STORAGE_KEY,
  type StorageLike,
} from '../repositories/localGameRepository'
import { decodeBase64, encodeBase64 } from '../services/githubApi'
import type { AdminGame } from '../types/admin'
import type { Game } from '../types/game'
import type { Taxonomy } from '../types/taxonomy'
import { normalizeGame, normalizeGames } from '../utils/gameDefaults'
import { applyPatch, blankGame, createGameFrom } from '../utils/gameFactory'
import {
  explicitRelatedWorks,
  inspectGameRelations,
  inverseRelationLabel,
  normalizeRelations,
  relationLabel,
  sameAuthorWorks,
  sameSeriesWorks,
  validateGameRelations,
  validateRelationInput,
} from '../utils/relations'
import {
  countUnclassifiedGames,
  countVocabularyUsage,
  createVocabularyEntryIn,
  deleteVocabularyEntryIn,
  findVocabularyNameConflicts,
  mergeVocabularyEntriesIn,
  normalizeTaxonomy,
  resolveVocabularyEntry,
  updateVocabularyEntryIn,
  vocabularyOptionsForGames,
} from '../utils/taxonomy'
import type { Assertion } from './libraryAssertions'

function check(
  results: Assertion[],
  name: string,
  actual: unknown,
  expected: unknown,
): void {
  const a = String(actual)
  const e = String(expected)
  results.push({ name, expected: e, actual: a, pass: a === e })
}

function syncErrorOf(fn: () => unknown): string {
  try {
    fn()
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

async function asyncErrorOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/* ---------------------------------------------------------------------------
   合成夹具
   --------------------------------------------------------------------------- */

const RAW_GAMES: Game[] = [
  {
    id: 'fixture-alpha',
    title: 'Fixture Alpha',
    author: 'Fixture Author',
    releaseYear: 2020,
    ipSeries: 'Fixture Series',
    engine: 'Clickteam',
    coverImage: '/images/alpha.png',
    bannerImage: '/images/alpha-banner.png',
    gallery: [],
    description: 'Synthetic fixture.',
    downloads: [],
    metrics: { fakeViews: 1, score: 4 },
    platforms: ['Windows'],
    gameplayTypes: ['traditional-night-watch'],
    mechanics: ['security-cameras'],
    relations: [{ type: 'sequel', targetId: 'fixture-beta' }],
    developmentStatus: 'released',
  },
  {
    id: 'fixture-beta',
    title: 'Fixture Beta',
    author: 'Fixture Author',
    releaseYear: 2021,
    ipSeries: 'Fixture Series',
    engine: 'Unity',
    coverImage: '/images/beta.png',
    bannerImage: '/images/beta-banner.png',
    gallery: [],
    description: 'Synthetic fixture.',
    downloads: [],
    metrics: { fakeViews: 2, score: 3 },
    platforms: ['windows'],
    gameplayTypes: ['exploration'],
    mechanics: ['free-roaming'],
    relations: [],
    developmentStatus: 'in-development',
  },
  {
    id: 'fixture-gamma',
    title: 'Fixture Gamma',
    author: 'Another Author',
    releaseYear: 2022,
    ipSeries: 'Other Series',
    engine: 'Godot',
    coverImage: '/images/gamma.png',
    bannerImage: '/images/gamma-banner.png',
    gallery: [],
    description: 'Synthetic fixture.',
    downloads: [],
    metrics: { fakeViews: 3, score: 5 },
    platforms: [],
    gameplayTypes: [],
    mechanics: [],
    relations: [],
    developmentStatus: 'cancelled',
  },
]

const FIXTURE_GAMES = normalizeGames(RAW_GAMES)

/** 只在测试里使用的内存 Storage */
function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
  }
}

/** 等远程仓储把首次 fetch 落地（Node 环境没有真实网络延迟，但仍是异步的） */
async function waitReady(repo: ReturnType<typeof createGitHubGameRepository>): Promise<void> {
  for (let i = 0; i < 50 && !repo.ready.value; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
}

/* ---------------------------------------------------------------------------
   1. 字段默认值
   --------------------------------------------------------------------------- */

function testGameDefaults(results: Assertion[]): void {
  const raw: Game = {
    id: 'sparse',
    title: 'Sparse',
    author: 'A',
    releaseYear: 2020,
    ipSeries: 'S',
    engine: 'E',
    coverImage: '',
    bannerImage: '',
    gallery: [],
    description: '',
    downloads: [],
    metrics: { fakeViews: 0, score: 0 },
  }
  const game = normalizeGame(raw)

  check(results, '旧记录 · altTitles 默认空数组', game.altTitles.length, 0)
  check(results, '旧记录 · gameplayTypes 默认空数组', game.gameplayTypes.length, 0)
  check(results, '旧记录 · mechanics 默认空数组', game.mechanics.length, 0)
  check(results, '旧记录 · relations 默认空数组', game.relations.length, 0)
  check(results, '旧记录 · developmentStatus 默认 unknown', game.developmentStatus, 'unknown')
  check(results, '旧记录 · sourceUrl 默认空串', game.sourceUrl, '')
  check(results, '旧记录 · status 仍默认 published', game.status, 'published')

  const invalid = normalizeGame({
    ...raw,
    developmentStatus: 'not-a-status' as never,
    altTitles: ['  A  ', 'a', '', 'B'],
    relations: [
      { type: 'sequel', targetId: 'sparse' },
      { type: 'sequel', targetId: 'other' },
      { type: 'prequel', targetId: 'other' },
      { type: 'bogus' as never, targetId: 'other-2' },
      { type: 'related', targetId: '' },
    ],
  })
  check(results, '非法开发状态回退 unknown', invalid.developmentStatus, 'unknown')
  check(results, 'altTitles 去空白并按大小写不敏感去重', invalid.altTitles.join('|'), 'A|B')
  check(results, '关系 · 自关联被丢弃', invalid.relations.length, 1)
  check(results, '关系 · 同一目标只保留第一条', invalid.relations[0]?.targetId, 'other')
  check(results, '关系 · 同一目标保留原类型', invalid.relations[0]?.type, 'sequel')

  const many = normalizeGame({
    ...raw,
    gameplayTypes: Array.from({ length: 20 }, (_, i) => `gt-${i}`),
  })
  check(results, '归一化不截断数组（上限只属于编辑入口）', many.gameplayTypes.length, 20)

  const selfDropped = normalizeRelations(
    [
      { type: 'related', targetId: 'self' },
      { type: 'related', targetId: 'other' },
    ],
    'self',
  )
  check(results, 'normalizeRelations 丢弃自关联', selfDropped.length, 1)

  // 显式 undefined 不能把已有字段清成默认值
  const existing = normalizeGame({
    ...raw,
    status: 'draft',
    mechanics: ['mc-1'],
    platforms: ['pf-1'],
    relations: [{ type: 'related', targetId: 'other' }],
    developmentStatus: 'released',
    sourceUrl: 'https://example.com',
  })
  const undefinedPatch = applyPatch(existing, {
    status: undefined,
    mechanics: undefined,
    platforms: undefined,
    relations: undefined,
    developmentStatus: undefined,
    sourceUrl: undefined,
  })
  check(results, 'patch 显式 undefined · status 保持原值', undefinedPatch.status, 'draft')
  check(results, 'patch 显式 undefined · mechanics 保持原值', undefinedPatch.mechanics.join('|'), 'mc-1')
  check(results, 'patch 显式 undefined · platforms 保持原值', undefinedPatch.platforms.join('|'), 'pf-1')
  check(results, 'patch 显式 undefined · relations 保持原值', undefinedPatch.relations.length, 1)
  check(results, 'patch 显式 undefined · developmentStatus 保持原值', undefinedPatch.developmentStatus, 'released')
  check(results, 'patch 显式 undefined · sourceUrl 保持原值', undefinedPatch.sourceUrl, 'https://example.com')

  const createdWithoutStatus = createGameFrom([], { title: 'No Status', status: undefined })
  check(results, '新建作品 status: undefined 仍默认 draft', createdWithoutStatus.status, 'draft')
}

/* ---------------------------------------------------------------------------
   2. 词表解析
   --------------------------------------------------------------------------- */

function testTaxonomyNormalization(results: Assertion[]): void {
  const missing = normalizeTaxonomy(undefined)
  check(results, '词表缺失 · present=false', missing.present, false)
  check(
    results,
    '词表缺失 · 使用内置初始玩法数',
    missing.taxonomy.gameplayTypes.length,
    initialTaxonomy().gameplayTypes.length,
  )

  const empty = normalizeTaxonomy({})
  check(results, '词表存在但为空 · present=true', empty.present, true)
  check(results, '词表对象缺集合 · usable=false', empty.usable, false)
  check(results, '词表存在但为空 · 不回填玩法', empty.taxonomy.gameplayTypes.length, 0)
  check(results, '词表存在但为空 · 不回填机制', empty.taxonomy.mechanics.length, 0)

  const completeEmpty = normalizeTaxonomy({
    gameplayTypes: [],
    mechanics: [],
    platforms: [],
  })
  check(results, '词表三集合齐全 · usable=true', completeEmpty.usable, true)

  const withExtra = normalizeTaxonomy({
    version: 2,
    gameplayTypes: [],
    mechanics: [],
    platforms: [],
  })
  check(results, '词表顶层扩展字段被保留', withExtra.taxonomy.version, 2)

  const broken = normalizeTaxonomy(['not', 'an', 'object'])
  check(results, '词表整块损坏 · present=false', broken.present, false)
  check(results, '词表整块损坏 · 有 issue', broken.issues.length > 0, true)

  const duplicated = normalizeTaxonomy({
    gameplayTypes: [
      { id: 'same', name: 'Same', description: '', future: 'keep' },
      { id: 'same', name: 'Other', description: '' },
      { id: 'other', name: 'same', description: '' },
      { id: 'missing-name', description: '' },
    ],
    mechanics: [{ id: 'same', name: 'Same', description: '' }],
    platforms: [],
  })
  check(results, '重复 id / 名称被丢弃', duplicated.taxonomy.gameplayTypes.length, 1)
  check(
    results,
    '词条未知扩展字段被保留',
    (duplicated.taxonomy.gameplayTypes[0] as { future?: string }).future,
    'keep',
  )
  check(results, '跨集合同名产生 issue', duplicated.issues.length > 0, true)
  check(results, '跨集合同名不丢词条', duplicated.taxonomy.mechanics.length, 1)

  // 名称已被别的集合占用时，当前集合内的第二个同名仍必须被丢弃
  const crossThenLocalDuplicate = normalizeTaxonomy({
    gameplayTypes: [{ id: 'gt-same', name: 'Same', description: '' }],
    mechanics: [
      { id: 'mc-1', name: 'Same', description: '' },
      { id: 'mc-2', name: 'Same', description: '' },
    ],
    platforms: [],
  })
  check(
    results,
    '跨集合同名后，同集合重复仍被丢弃',
    crossThenLocalDuplicate.taxonomy.mechanics.length,
    1,
  )

  const resolved = resolveVocabularyEntry(
    initialTaxonomy(),
    'platforms',
    'Windows',
  )
  check(results, '词条解析 · 名称大小写回退', resolved?.id, 'windows')
  const resolvedId = resolveVocabularyEntry(initialTaxonomy(), 'platforms', 'windows')
  check(results, '词条解析 · id 优先', resolvedId?.name, 'Windows')
}

/* ---------------------------------------------------------------------------
   3. 词表修改
   --------------------------------------------------------------------------- */

function testTaxonomyMutations(results: Assertion[]): void {
  const base = initialTaxonomy()
  const baseMechanics = base.mechanics.length

  const created = createVocabularyEntryIn(base, 'mechanics', {
    name: 'Fixture Mechanic',
    description: '用于测试',
  })
  check(results, '新建词条 · 进入词表', created.taxonomy.mechanics.length, baseMechanics + 1)
  check(results, '新建词条 · id 稳定生成', created.entry.id, 'fixture-mechanic')
  check(results, '新建词条 · 不改动原词表', base.mechanics.length, baseMechanics)

  const duplicateName = syncErrorOf(() =>
    createVocabularyEntryIn(created.taxonomy, 'mechanics', { name: ' fixture mechanic ' }),
  )
  check(results, '新建词条 · 同名被拒绝', duplicateName.length > 0, true)

  const invalidId = syncErrorOf(() =>
    createVocabularyEntryIn(created.taxonomy, 'mechanics', {
      name: 'Another',
      id: '中文标识',
    }),
  )
  check(results, '新建词条 · 非法 id 被拒绝', invalidId.length > 0, true)

  const chinese = createVocabularyEntryIn(created.taxonomy, 'mechanics', { name: '自由移动测试' })
  check(results, '中文名称自动生成 mc 前缀 id', chinese.entry.id.startsWith('mc'), true)

  const second = createVocabularyEntryIn(chinese.taxonomy, 'mechanics', { name: 'Second Mechanic' })
  const renamed = updateVocabularyEntryIn(second.taxonomy, 'mechanics', created.entry.id, {
    name: 'Renamed Mechanic',
  })
  check(results, '改名只改名称、id 不变', renamed.entry.id, created.entry.id)
  check(results, '改名后名称更新', renamed.entry.name, 'Renamed Mechanic')
  const renameConflict = syncErrorOf(() =>
    updateVocabularyEntryIn(renamed.taxonomy, 'mechanics', created.entry.id, {
      name: second.entry.name,
    }),
  )
  check(results, '改名撞名被拒绝', renameConflict.length > 0, true)

  const conflictCollections = findVocabularyNameConflicts(
    renamed.taxonomy,
    'mechanics',
    '传统守夜式',
  )
  check(results, '跨集合同名可被 UI 提前发现', conflictCollections.includes('gameplayTypes'), true)

  // 合并：source 同时以 id 与旧名称出现，目标已存在时要去重
  const games: AdminGame[] = normalizeGames([
    {
      ...RAW_GAMES[0],
      mechanics: [created.entry.id, second.entry.id, 'Renamed Mechanic'],
    },
    {
      ...RAW_GAMES[1],
      mechanics: [second.entry.id],
    },
  ])
  const merged = mergeVocabularyEntriesIn(
    renamed.taxonomy,
    games,
    'mechanics',
    created.entry.id,
    second.entry.id,
  )
  check(results, '合并 · source 从词表移除', merged.taxonomy.mechanics.some((e) => e.id === created.entry.id), false)
  check(results, '合并 · 目标仍在词表', merged.taxonomy.mechanics.some((e) => e.id === second.entry.id), true)
  check(results, '合并 · 受影响作品数', merged.affectedGames, 1)
  check(
    results,
    '合并 · 引用改写并按目标去重',
    (merged.games[0].mechanics ?? []).join('|'),
    second.entry.id,
  )
  check(results, '合并 · 未引用作品不变', (merged.games[1].mechanics ?? []).join('|'), second.entry.id)

  const usage = countVocabularyUsage(merged.games, merged.taxonomy, 'mechanics')
  check(results, '使用次数 · 目标词条', usage.get(second.entry.id), 2)
  check(results, '使用次数 · 未使用词条', usage.get('stealth'), 0)
  check(results, '未分类作品数', countUnclassifiedGames(merged.games), 0)
  check(
    results,
    '公开筛选选项只包含被使用的词条',
    vocabularyOptionsForGames(merged.taxonomy, merged.games, 'mechanics').length,
    1,
  )

  const protectedDelete = syncErrorOf(() =>
    deleteVocabularyEntryIn(merged.taxonomy, merged.games, 'mechanics', second.entry.id),
  )
  check(results, '删除仍被引用的词条 · 拒绝', protectedDelete.length > 0, true)

  const forcedDelete = deleteVocabularyEntryIn(
    merged.taxonomy,
    merged.games,
    'mechanics',
    second.entry.id,
    { removeFromGames: true },
  )
  check(results, '强制删除 · 词表移除', forcedDelete.taxonomy.mechanics.some((e) => e.id === second.entry.id), false)
  check(results, '强制删除 · 受影响作品数', forcedDelete.affectedGames, 2)
  check(results, '强制删除 · 作品引用清空', (forcedDelete.games[0].mechanics ?? []).length, 0)
}

/* ---------------------------------------------------------------------------
   4. 关系
   --------------------------------------------------------------------------- */

function testRelations(results: Assertion[]): void {
  check(results, '关系文案 · sequel', relationLabel('sequel'), '续作')
  check(results, '关系反向文案 · sequel', inverseRelationLabel('sequel'), '前传')
  check(results, '关系反向文案 · remake', inverseRelationLabel('remake'), '重制原作')
  check(results, '关系文案 · same-universe', inverseRelationLabel('same-universe'), '同一世界观')
  check(
    results,
    '原始关系输入 · 非法类型被拒绝',
    validateRelationInput([{ type: 'bogus', targetId: 'x' }]).length > 0,
    true,
  )
  check(
    results,
    '原始关系输入 · 重复目标被拒绝',
    validateRelationInput([
      { type: 'related', targetId: 'x' },
      { type: 'prequel', targetId: 'x' },
    ]).length > 0,
    true,
  )
  check(
    results,
    '原始关系输入 · 自关联被拒绝',
    validateRelationInput([{ type: 'related', targetId: 'self' }], 'self').length > 0,
    true,
  )

  const games = normalizeGames([
    {
      ...RAW_GAMES[0],
      relations: [],
    },
    {
      ...RAW_GAMES[1],
      relations: [],
    },
    {
      ...RAW_GAMES[2],
      relations: [],
    },
  ])

  const current = { ...games[0], relations: [{ type: 'sequel' as const, targetId: games[1].id }] }
  const withCurrent = [current, games[1], games[2]]
  check(results, '合法关系通过校验', validateGameRelations(withCurrent, current).length, 0)

  const self = { ...current, relations: [{ type: 'related' as const, targetId: current.id }] }
  check(
    results,
    '自关联被拒绝',
    validateGameRelations([self, games[1], games[2]], self).length > 0,
    true,
  )

  const missing = { ...current, relations: [{ type: 'related' as const, targetId: 'no-such-game' }] }
  check(
    results,
    '不存在的目标被拒绝',
    validateGameRelations([missing, games[1], games[2]], missing).length > 0,
    true,
  )

  const duplicate = {
    ...current,
    relations: [
      { type: 'related' as const, targetId: games[1].id },
      { type: 'prequel' as const, targetId: games[1].id },
    ],
  }
  check(
    results,
    '同一目标重复关系被拒绝',
    validateGameRelations([duplicate, games[1], games[2]], duplicate).length > 0,
    true,
  )

  const peer = {
    ...games[1],
    relations: [{ type: 'prequel' as const, targetId: current.id }],
  }
  check(
    results,
    '目标端已记录反向关系时拒绝',
    validateGameRelations([current, peer, games[2]], current).length > 0,
    true,
  )

  const inspected = inspectGameRelations(withCurrent, current)
  check(results, '逐行检查 · 合法关系行错误为空', inspected.rowErrors.join('|'), '')
  check(results, '逐行检查 · 整体错误为空', inspected.errors.length, 0)
  const duplicateInspect = inspectGameRelations([duplicate, games[1], games[2]], duplicate)
  check(results, '逐行检查 · 行错误与关系一一对应', duplicateInspect.rowErrors.length, 2)
  check(results, '逐行检查 · 第一行通过', duplicateInspect.rowErrors[0], '')
  check(results, '逐行检查 · 重复行报错', duplicateInspect.rowErrors[1].length > 0, true)
  check(
    results,
    '逐行检查 · 反向关系行报错',
    inspectGameRelations([current, peer, games[2]], current).rowErrors[0].includes('已经记录'),
    true,
  )

  const explicit = explicitRelatedWorks(withCurrent, current)
  check(results, '详情页 · 出边文案', explicit[0]?.label, '续作')
  check(results, '详情页 · 出边目标', explicit[0]?.game.id, games[1].id)
  check(
    results,
    '详情页 · 入边反向文案',
    explicitRelatedWorks(withCurrent, games[1])[0]?.label,
    '前传',
  )
  check(
    results,
    '详情页 · 不可见目标被忽略',
    explicitRelatedWorks([current, games[2]], current).length,
    0,
  )

  const sameAuthor = sameAuthorWorks(withCurrent, current)
  check(results, '同作者 · 命中', sameAuthor.map((work) => work.game.id).join(','), games[1].id)
  check(
    results,
    '同作者 · 排除显式关系目标',
    sameAuthorWorks(withCurrent, current, [games[1].id]).length,
    0,
  )
  check(
    results,
    '同系列 · 命中',
    sameSeriesWorks(withCurrent, current).map((work) => work.game.id).join(','),
    games[1].id,
  )
  check(
    results,
    '同系列 · 排除后为空',
    sameSeriesWorks(withCurrent, current, [games[1].id]).length,
    0,
  )

  const plainCurrent = { ...games[0], relations: [] }
  const plainList = [plainCurrent, games[1], games[2]]
  const authorHits = sameAuthorWorks(plainList, plainCurrent)
  check(results, '同作者 · 无显式关系时命中', authorHits.map((work) => work.game.id).join(','), games[1].id)
  check(
    results,
    '同系列 · 与同作者去重后为空',
    sameSeriesWorks(plainList, plainCurrent, authorHits.map((work) => work.game.id)).length,
    0,
  )
}

/* ---------------------------------------------------------------------------
   5. 草稿往返不丢新字段
   --------------------------------------------------------------------------- */

function testDraftRoundTrip(results: Assertion[]): void {
  const source = normalizeGame({
    ...RAW_GAMES[0],
    altTitles: ['Alias'],
    relations: [{ type: 'sequel', targetId: 'fixture-beta' }],
    sourceUrl: 'https://example.com/alpha',
  })
  const draft = gameToDraft(source)
  const patch = draftToPatch(draft)
  const next = applyPatch(source, patch)

  check(results, '草稿保存后 altTitles 保留', next.altTitles.join('|'), 'Alias')
  check(results, '草稿保存后 gameplayTypes 保留', next.gameplayTypes.join('|'), source.gameplayTypes.join('|'))
  check(results, '草稿保存后 mechanics 保留', next.mechanics.join('|'), source.mechanics.join('|'))
  check(results, '草稿保存后 relations 保留', next.relations.length, source.relations.length)
  check(results, '草稿保存后 sourceUrl 保留', next.sourceUrl, source.sourceUrl)
  check(results, '新建作品带默认玩法数组', blankGame().gameplayTypes.length, 0)
  check(results, '新建作品开发状态默认 unknown', blankGame().developmentStatus, 'unknown')
}

/* ---------------------------------------------------------------------------
   6. 本地仓储
   --------------------------------------------------------------------------- */

async function testLocalRepository(results: Assertion[]): Promise<void> {
  const storage = memoryStorage()
  const repo = createLocalGameRepository({ storage })

  check(
    results,
    '本地仓 · 初始词表存在',
    repo.taxonomy.value.gameplayTypes.length,
    initialTaxonomy().gameplayTypes.length,
  )
  check(results, '本地仓 · 初始 issue 为空', repo.taxonomyIssues.value.length, 0)

  const created = await repo.createVocabularyEntry('mechanics', {
    name: 'Local Fixture',
    description: '',
  })
  check(results, '本地仓 · 新建词条写入快照', repo.taxonomy.value.mechanics.some((e) => e.id === created.id), true)
  check(results, '本地仓 · 词表落盘', storage.data.has(TAXONOMY_STORAGE_KEY), true)

  const duplicate = await asyncErrorOf(
    repo.createVocabularyEntry('mechanics', { name: 'local fixture' }),
  )
  check(results, '本地仓 · 同名新建被拒绝', duplicate.length > 0, true)

  const game = repo.games.value[0]
  await repo.updateGame(game.id, { mechanics: [created.id] })
  check(
    results,
    '本地仓 · 作品引用词条',
    repo.games.value.find((item) => item.id === game.id)?.mechanics.includes(created.id),
    true,
  )

  const deleteError = await asyncErrorOf(repo.deleteVocabularyEntry('mechanics', created.id))
  check(results, '本地仓 · 删除保护', deleteError.length > 0, true)

  const deleted = await repo.deleteVocabularyEntry('mechanics', created.id, {
    removeFromGames: true,
  })
  check(results, '本地仓 · 强制删除影响作品', deleted.affectedGames, 1)
  check(
    results,
    '本地仓 · 强制删除后引用清空',
    repo.games.value.find((item) => item.id === game.id)?.mechanics.length,
    0,
  )

  const persisted = await repo.createVocabularyEntry('mechanics', { name: 'Persisted Entry' })
  const reopened = createLocalGameRepository({ storage })
  check(
    results,
    '本地仓 · 重新打开后词条仍在',
    reopened.taxonomy.value.mechanics.some((e) => e.id === persisted.id),
    true,
  )

  // hydrate 只改内存，不写本机存档
  const custom: Taxonomy = {
    gameplayTypes: [{ id: 'custom', name: 'Custom', description: '' }],
    mechanics: [],
    platforms: [],
  }
  repo.hydrate(repo.games.value, custom)
  check(results, '本地仓 · hydrate 更新内存词表', repo.taxonomy.value.gameplayTypes[0]?.id, 'custom')
  const reopenedAfterHydrate = createLocalGameRepository({ storage })
  check(
    results,
    '本地仓 · hydrate 不写本机存档',
    reopenedAfterHydrate.taxonomy.value.gameplayTypes[0]?.id,
    'traditional-night-watch',
  )

  // 关系：合法目标可保存；不存在目标被拒绝；删除目标时清理入边
  const relationSource = repo.games.value[0]
  const relationTarget = repo.games.value[1]
  await repo.updateGame(relationSource.id, {
    relations: [{ type: 'related', targetId: relationTarget.id }],
  })
  check(
    results,
    '本地仓 · 合法关系写入',
    repo.games.value.find((item) => item.id === relationSource.id)?.relations.length,
    1,
  )
  const localRelationError = await asyncErrorOf(
    repo.updateGame(relationSource.id, {
      relations: [{ type: 'related', targetId: 'missing-local-target' }],
    }),
  )
  check(results, '本地仓 · 不存在的目标被拒绝', localRelationError.length > 0, true)
  await repo.deleteGame(relationTarget.id)
  check(
    results,
    '本地仓 · 删除目标后入边被清理',
    repo.games.value.find((item) => item.id === relationSource.id)?.relations.length,
    0,
  )

  // 新建时 id 是生成的：目标恰好等于新 id 必须报错，不能被当成自关联静默丢弃
  const createStorage = memoryStorage()
  const createRepo = createLocalGameRepository({ storage: createStorage })
  createRepo.hydrate(FIXTURE_GAMES.map((game) => ({ ...game })))
  const beforeCreateCount = createRepo.games.value.length
  const selfTargetError = await asyncErrorOf(
    createRepo.createGame({
      title: 'Self Target',
      relations: [{ type: 'related', targetId: 'self-target' }],
    }),
  )
  check(results, '本地仓 · 新建指向自身 id 的关系被拒绝', selfTargetError.length > 0, true)
  check(results, '本地仓 · 被拒绝的新建不会留下半条数据', createRepo.games.value.length, beforeCreateCount)

  // 历史悬挂关系不应阻塞状态更新 —— 否则 Phase 1 没有关系 UI，作品会永远改不动
  const danglingStorage = memoryStorage()
  const danglingRepo = createLocalGameRepository({ storage: danglingStorage })
  const danglingBase = danglingRepo.games.value[0]
  danglingRepo.hydrate(
    danglingRepo.games.value.map((game) =>
      game.id === danglingBase.id
        ? { ...game, relations: [{ type: 'related', targetId: 'missing-dangling' }] }
        : game,
    ),
  )
  const danglingUpdated = await danglingRepo.unpublishGame(danglingBase.id)
  check(results, '本地仓 · 悬挂关系不阻塞状态更新', danglingUpdated.status, 'offline')

  // 词表对象缺集合时不能覆盖内置词表
  const partialStorage = memoryStorage()
  partialStorage.setItem(TAXONOMY_STORAGE_KEY, JSON.stringify({ gameplayTypes: [] }))
  const partialRepo = createLocalGameRepository({ storage: partialStorage })
  check(
    results,
    '本地仓 · 缺集合的词表回退初始词表',
    partialRepo.taxonomy.value.gameplayTypes.length,
    initialTaxonomy().gameplayTypes.length,
  )
  check(results, '本地仓 · 缺集合的词表有 issue', partialRepo.taxonomyIssues.value.length > 0, true)

  // localStorage 没有事务：第二个 key 写失败时要回滚第一个 key
  const flakyStorage = memoryStorage()
  const originalSetItem = flakyStorage.setItem
  let failTaxonomyOnce = true
  flakyStorage.setItem = (key, value) => {
    if (key === TAXONOMY_STORAGE_KEY && failTaxonomyOnce) {
      failTaxonomyOnce = false
      throw new Error('quota exceeded')
    }
    originalSetItem(key, value)
  }
  const flakyRepo = createLocalGameRepository({ storage: flakyStorage })
  const gamesBeforeFailure = flakyStorage.data.get(STORAGE_KEY) ?? null
  const flakyGame = flakyRepo.games.value[0]
  await flakyRepo.updateGame(flakyGame.id, { title: 'Flaky Update' })
  check(results, '本地仓 · 部分写入失败降级 memory', flakyRepo.storage.value, 'memory')
  check(
    results,
    '本地仓 · 部分写入失败回滚作品存档',
    flakyStorage.data.get(STORAGE_KEY) ?? null,
    gamesBeforeFailure,
  )

  // 损坏的词表存档回退初始词表，但作品存档仍可读
  storage.setItem(TAXONOMY_STORAGE_KEY, '{broken')
  const recovered = createLocalGameRepository({ storage })
  check(
    results,
    '本地仓 · 损坏词表回退初始词表',
    recovered.taxonomy.value.gameplayTypes.length,
    initialTaxonomy().gameplayTypes.length,
  )
  check(results, '本地仓 · 损坏词表有 issue', recovered.taxonomyIssues.value.length > 0, true)

  await recovered.resetToSeed()
  check(
    results,
    '本地仓 · 恢复出厂同时重置词表',
    recovered.taxonomy.value.mechanics.some((e) => e.name === 'Persisted Entry'),
    false,
  )
}

/* ---------------------------------------------------------------------------
   7. GitHub 仓储（假 fetch）
   --------------------------------------------------------------------------- */

interface RemoteState {
  content: string
  sha: string
  putCount: number
  conflictOnce: boolean
  restore: () => void
}

async function createRemoteStub(
  initialGames: AdminGame[],
  withTaxonomy = true,
  taxonomyValue: unknown = initialTaxonomy(),
): Promise<RemoteState> {
  const originalFetch = globalThis.fetch
  const document: Record<string, unknown> = {
    games: initialGames,
    futureTopLevel: { keep: true },
  }
  if (withTaxonomy) document.taxonomy = taxonomyValue
  let content = JSON.stringify(document, null, 2)
  let sha = 'sha-1'

  const state: RemoteState = {
    content,
    sha,
    putCount: 0,
    conflictOnce: false,
    restore: () => {
      globalThis.fetch = originalFetch
    },
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })

  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as {
        content: string
        sha?: string
        message: string
      }

      if (state.conflictOnce) {
        state.conflictOnce = false
        // 模拟另一位管理员刚保存了另一条作品；同时改一个未来顶层键
        const parsed = JSON.parse(content) as {
          games: { id: string; author: string }[]
          futureTopLevel: { keep: boolean; peer?: boolean }
        }
        const peer = parsed.games.find((game) => game.id === 'fixture-gamma')
        if (peer) peer.author = 'Peer Author'
        parsed.futureTopLevel.peer = true
        content = JSON.stringify(parsed, null, 2)
        sha = 'sha-after-conflict'
        return json({ message: 'sha 不匹配' }, 409)
      }

      if (body.sha !== undefined && body.sha !== sha) return json({ message: 'sha 不匹配' }, 409)

      content = decodeBase64(body.content)
      sha = `sha-${state.putCount + 2}`
      state.putCount += 1
      state.content = content
      state.sha = sha
      return json({ content: { sha } })
    }

    return json({ content: encodeBase64(content), sha })
  }) as typeof fetch

  return state
}

async function testGitHubRepository(results: Assertion[]): Promise<void> {
  const state = await createRemoteStub(FIXTURE_GAMES.map((game) => ({ ...game })))
  const repo = createGitHubGameRepository({ token: 'fixture-token' })

  try {
    await waitReady(repo)
    check(results, '远程仓 · 加载成功', repo.error.value, '')
    check(
      results,
      '远程仓 · 读到底层词表',
      repo.taxonomy.value.gameplayTypes.length,
      initialTaxonomy().gameplayTypes.length,
    )

    const created = await repo.createVocabularyEntry('mechanics', {
      name: 'Remote Fixture',
      description: '',
    })
    const afterCreate = JSON.parse(state.content) as {
      games: unknown[]
      taxonomy: Taxonomy
      futureTopLevel: { keep: boolean }
    }
    check(results, '远程仓 · 词条进入提交内容', afterCreate.taxonomy.mechanics.some((e) => e.id === created.id), true)
    check(results, '远程仓 · 保留未知顶层键', afterCreate.futureTopLevel.keep, true)
    check(results, '远程仓 · 未改动作品条数', afterCreate.games.length, FIXTURE_GAMES.length)

    await repo.updateGame('fixture-alpha', { mechanics: [created.id] })
    let parsed = JSON.parse(state.content) as {
      games: AdminGame[]
      taxonomy: Taxonomy
      futureTopLevel: { keep: boolean }
    }
    check(
      results,
      '远程仓 · 作品保存后词表仍在',
      parsed.taxonomy.mechanics.some((e) => e.id === created.id),
      true,
    )
    check(
      results,
      '远程仓 · 作品保存后未知顶层键仍在',
      parsed.futureTopLevel.keep,
      true,
    )

    const beforeInvalid = state.putCount
    const invalidError = await asyncErrorOf(
      repo.updateGame('fixture-alpha', {
        relations: [{ type: 'related', targetId: 'missing-game' }],
      }),
    )
    check(results, '远程仓 · 无效关系被拒绝', invalidError.length > 0, true)
    check(results, '远程仓 · 无效关系没有产生提交', state.putCount, beforeInvalid)

    await repo.deleteGame('fixture-beta')
    const afterDelete = JSON.parse(state.content) as { games: AdminGame[] }
    const alpha = afterDelete.games.find((game) => game.id === 'fixture-alpha')
    check(results, '远程仓 · 删除目标后入边被清理', (alpha?.relations ?? []).length, 0)
    check(results, '远程仓 · 删除目标本身', afterDelete.games.some((game) => game.id === 'fixture-beta'), false)

    state.conflictOnce = true
    const beforeConflict = state.putCount
    await repo.updateGame('fixture-alpha', { title: 'Alpha After Conflict' })
    const afterConflict = JSON.parse(state.content) as {
      games: AdminGame[]
      futureTopLevel: { keep: boolean; peer?: boolean }
    }
    check(results, '远程仓 · 冲突后自己的改动仍在', afterConflict.games.find((game) => game.id === 'fixture-alpha')?.title, 'Alpha After Conflict')
    check(
      results,
      '远程仓 · 冲突后别人的作品改动仍在',
      afterConflict.games.find((game) => game.id === 'fixture-gamma')?.author,
      'Peer Author',
    )
    check(results, '远程仓 · 冲突后未知顶层键仍在', afterConflict.futureTopLevel.keep, true)
    check(results, '远程仓 · 冲突后冲突期间的新键仍在', afterConflict.futureTopLevel.peer, true)
    check(results, '远程仓 · 冲突重试产生了额外提交', state.putCount > beforeConflict, true)

    const mergeSource = await repo.createVocabularyEntry('mechanics', { name: 'Merge Source' })
    await repo.updateGame('fixture-gamma', { mechanics: [mergeSource.id] })
    const mergeTarget = await repo.createVocabularyEntry('mechanics', { name: 'Merge Target' })
    const merged = await repo.mergeVocabularyEntries('mechanics', mergeSource.id, mergeTarget.id)
    check(results, '远程仓 · 合并影响作品', merged.affectedGames, 1)
    check(
      results,
      '远程仓 · 合并后来源词条消失',
      repo.taxonomy.value.mechanics.some((e) => e.id === mergeSource.id),
      false,
    )
    const afterMerge = JSON.parse(state.content) as { games: AdminGame[] }
    check(
      results,
      '远程仓 · 合并后作品引用目标',
      afterMerge.games.find((game) => game.id === 'fixture-gamma')?.mechanics.join('|'),
      mergeTarget.id,
    )
  } finally {
    state.restore()
  }
}

/**
 * 普通作品保存不能把内置种子词表「顺带」写进数据仓。
 * 那会绕过 Phase 1 的约定：只有词表操作才新增顶层 taxonomy。
 */
async function testGitHubGameSaveDoesNotSeedTaxonomy(results: Assertion[]): Promise<void> {
  const state = await createRemoteStub(
    FIXTURE_GAMES.map((game) => ({ ...game })),
    false,
  )
  const repo = createGitHubGameRepository({ token: 'fixture-token' })

  try {
    await waitReady(repo)
    await repo.updateGame('fixture-alpha', { title: 'Save Without Taxonomy' })
    const parsed = JSON.parse(state.content) as Record<string, unknown>
    check(
      results,
      '远程仓 · 普通作品保存不凭空写入 taxonomy',
      Object.prototype.hasOwnProperty.call(parsed, 'taxonomy'),
      false,
    )
    check(
      results,
      '远程仓 · 普通作品保存仍正常写入作品',
      (parsed.games as AdminGame[]).find((game) => game.id === 'fixture-alpha')?.title,
      'Save Without Taxonomy',
    )
  } finally {
    state.restore()
  }
}

/**
 * 远程仓的关系边界：历史悬挂关系不阻塞无关更新；
 * 新建时目标恰好等于生成 id 必须报错，不能被静默当成自关联丢弃。
 */
async function testGitHubRelationEdgeCases(results: Assertion[]): Promise<void> {
  const danglingGames = FIXTURE_GAMES.map((game) =>
    game.id === 'fixture-alpha'
      ? { ...game, relations: [{ type: 'related' as const, targetId: 'missing-dangling' }] }
      : { ...game },
  )
  const state = await createRemoteStub(danglingGames)
  const repo = createGitHubGameRepository({ token: 'fixture-token' })

  try {
    await waitReady(repo)
    const updated = await repo.unpublishGame('fixture-alpha')
    check(results, '远程仓 · 悬挂关系不阻塞状态更新', updated.status, 'offline')

    const beforeCreate = state.putCount
    const selfTargetError = await asyncErrorOf(
      repo.createGame({
        title: 'Self Target',
        relations: [{ type: 'related', targetId: 'self-target' }],
      }),
    )
    check(results, '远程仓 · 新建指向自身 id 的关系被拒绝', selfTargetError.length > 0, true)
    check(results, '远程仓 · 被拒绝的新建没有产生提交', state.putCount, beforeCreate)
  } finally {
    state.restore()
  }
}

/**
 * 数据仓里 taxonomy 存在但不可用（null / 数组）时，普通作品保存也必须原样保留。
 * 只在 writeTaxonomy 为 true 时改写词表 —— 否则会把内置种子写进生产数据。
 */
async function testGitHubGameSavePreservesBrokenTaxonomy(results: Assertion[]): Promise<void> {
  for (const [label, value] of [
    ['null', null],
    ['数组', []],
  ] as const) {
    const state = await createRemoteStub(FIXTURE_GAMES.map((game) => ({ ...game })), true, value)
    const repo = createGitHubGameRepository({ token: 'fixture-token' })

    try {
      await waitReady(repo)
      await repo.updateGame('fixture-alpha', { title: 'Save With Broken Taxonomy' })
      const parsed = JSON.parse(state.content) as Record<string, unknown>
      check(
        results,
        `远程仓 · taxonomy=${label} 时普通保存不替换原值`,
        JSON.stringify(parsed.taxonomy),
        JSON.stringify(value),
      )
      check(
        results,
        `远程仓 · taxonomy=${label} 时作品仍正常写入`,
        (parsed.games as AdminGame[]).find((game) => game.id === 'fixture-alpha')?.title,
        'Save With Broken Taxonomy',
      )
    } finally {
      state.restore()
    }
  }
}

/* ---------------------------------------------------------------------------
   入口
   --------------------------------------------------------------------------- */

export async function runStructuredDataAssertions(): Promise<Assertion[]> {
  const results: Assertion[] = []

  testGameDefaults(results)
  testTaxonomyNormalization(results)
  testTaxonomyMutations(results)
  testRelations(results)
  testDraftRoundTrip(results)
  await testLocalRepository(results)
  await testGitHubRepository(results)
  await testGitHubGameSaveDoesNotSeedTaxonomy(results)
  await testGitHubRelationEdgeCases(results)
  await testGitHubGameSavePreservesBrokenTaxonomy(results)

  return results
}
