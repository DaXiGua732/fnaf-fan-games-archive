/**
 * ============================================================================
 * dataQuality —— 只读资料质量检查
 * ============================================================================
 * 只**报告**问题，绝不修改数据。可以在构建快照或任意 db.json 上跑：
 *
 *   npm run check:data
 *   npm run check:data -- --file=path/to/db.json
 *   npm run check:data -- --json
 *   npm run check:data -- --strict   # 有 error 时退出码 1（默认总是 0）
 *
 * 检查项：
 *   - 未分类作品（没有玩法类型）
 *   - 词条引用失效（玩法 / 机制 / 平台）
 *   - 关系问题：类型非法、目标为空 / 不存在 / 自关联 / 重复 / 两端重复记录 / 超过上限
 *   - 关联目标不可见（仅信息：后台保留、前台不展示）
 *   - 标签与受控词条同名（概念重叠）
 *   - 重复标签 / 重复其他名称
 *   - 缺少封面 / Banner / 下载渠道
 *   - 资料字段异常（缺标题 / 作者、年份不合理、开发状态非法）
 *   - 词表结构问题、跨集合同名、无人使用的词条
 * ============================================================================
 */
import type { AdminGame } from '../types/admin'
import type { Game } from '../types/game'
import { DEVELOPMENT_STATUSES } from '../types/game'
import { VOCABULARY_COLLECTIONS, VOCABULARY_LABELS } from '../types/taxonomy'
import { normalizeGame } from './gameDefaults'
import { isRecord } from './guards'
import { isRelationType, rawRelationTargetId } from './relations'
import {
  countVocabularyUsage,
  normalizeTaxonomy,
  resolveVocabularyEntry,
  vocabularyNameKey,
} from './taxonomy'
import { isPubliclyVisible } from './visibility'

export type QualitySeverity = 'error' | 'warning' | 'info'

export interface QualityIssue {
  severity: QualitySeverity
  /** 稳定的机器可读代码，便于将来做筛选 / 忽略列表 */
  code: string
  message: string
  gameId?: string
}

export interface DataQualityReport {
  source: string
  counts: {
    games: number
    visible: number
    hidden: number
    taxonomyEntries: number
    unclassified: number
    errors: number
    warnings: number
    infos: number
  }
  unclassifiedGames: { id: string; title: string }[]
  issues: QualityIssue[]
  /** 没有 error（warning / info 不影响） */
  ok: boolean
}

const RELATION_LIMIT = 20
const YEAR_MIN = 1990
const YEAR_MAX = new Date().getFullYear() + 2

/** 需要「必须是字符串数组」的原始字段；类型错误要单独报告，不能只靠归一化后的空数组 */
const RAW_TEXT_LIST_FIELDS = [
  { field: 'tags', code: 'invalid-tags', label: '标签' },
  { field: 'altTitles', code: 'invalid-alt-titles', label: '其他名称' },
  { field: 'platforms', code: 'invalid-platforms', label: '平台' },
  { field: 'gameplayTypes', code: 'invalid-gameplay-types', label: '玩法类型' },
  { field: 'mechanics', code: 'invalid-mechanics', label: '游戏机制' },
] as const


/** 大小写 / 空白归一化后找重复项；返回出现次数 > 1 的原值 */
function duplicateValues(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const seen = new Map<string, string>()
  const duplicates = new Set<string>()
  for (const raw of values) {
    if (typeof raw !== 'string') continue
    const text = raw.trim()
    if (!text) continue
    const key = text.toLocaleLowerCase()
    if (seen.has(key)) duplicates.add(seen.get(key) ?? text)
    else seen.set(key, text)
  }
  return [...duplicates]
}

/** 文本字段的类型兜底：类型不对时返回空串，让检查可以继续（问题由 raw 检查报告） */
function readText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 文本数组的类型兜底：非数组 / 非字符串项一律排除，避免 `for...of` / `.trim()` 抛错 */
function readTextList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

/** 给「实际是什么」一个可读描述，报告里能直接定位问题 */
function describeValue(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return '数组'
  return `类型 ${typeof value}`
}

/**
 * 不可信记录 → 可继续检查的 `Game`。
 *
 * 只做**类型兜底**，不修改入参：字段缺失 / 类型错误会在逐条检查里单独报告，
 * 绝不能靠这里填默认值后把脏数据当成正常（那正是质量检查要抓的东西）。
 * 归一化本身（词表数组去重、开发状态回退等）复用读路径的 `normalizeGame()`。
 */
function toAnalysisGame(record: Record<string, unknown>): AdminGame {
  return normalizeGame({
    ...record,
    id: String(record.id).trim(),
    title: readText(record.title),
    author: readText(record.author),
    ipSeries: readText(record.ipSeries),
    engine: readText(record.engine),
    coverImage: readText(record.coverImage),
    bannerImage: readText(record.bannerImage),
    gallery: readTextList(record.gallery),
    description: readText(record.description),
    downloads: Array.isArray(record.downloads) ? record.downloads : [],
    metrics: isRecord(record.metrics) ? record.metrics : { fakeViews: 0, score: 0 },
    tags: readTextList(record.tags),
    altTitles: readTextList(record.altTitles),
    gameplayTypes: readTextList(record.gameplayTypes),
    mechanics: readTextList(record.mechanics),
    platforms: readTextList(record.platforms),
  } as unknown as Game)
}

export function analyzeCatalog(raw: unknown, source = ''): DataQualityReport {
  const issues: QualityIssue[] = []
  const add = (
    severity: QualitySeverity,
    code: string,
    message: string,
    gameId?: string,
  ): void => {
    issues.push({ severity, code, message, ...(gameId ? { gameId } : {}) })
  }

  const root = isRecord(raw) ? raw : {}
  const rawGames = Array.isArray(root.games) ? root.games : []

  if (!isRecord(raw)) {
    add(
      'error',
      'catalog-root-invalid',
      `db.json 顶层应当是对象，实际是 ${describeValue(raw)}`,
    )
  }
  if (!Array.isArray(root.games)) {
    add('error', 'catalog-games-missing', 'db.json 顶层缺少 games 数组')
  }

  /* ---------------------------------------------------------------------------
     游戏：先建立原始 id → 对象索引，再归一化
     --------------------------------------------------------------------------- */
  const rawById = new Map<string, Record<string, unknown>>()
  rawGames.forEach((entry, index) => {
    if (!isRecord(entry)) {
      add('error', 'game-invalid', `games[${index}] 不是对象（实际为 ${describeValue(entry)}）`)
      return
    }
    if (typeof entry.id !== 'string' || !entry.id.trim()) {
      add(
        'error',
        'game-invalid',
        `games[${index}] 缺少合法的 id（实际为 ${describeValue(entry.id)}）`,
      )
      return
    }
    const id = entry.id.trim()
    if (rawById.has(id)) {
      add('error', 'game-duplicate-id', `作品 id「${id}」重复`, id)
      return
    }
    rawById.set(id, entry)
  })

  const games = [...rawById.values()].map(toAnalysisGame)
  const byId = new Map(games.map((game) => [game.id, game]))
  const visibleGames = games.filter(isPubliclyVisible)

  /* ---------------------------------------------------------------------------
     词表
     --------------------------------------------------------------------------- */
  const normalizedTaxonomy = normalizeTaxonomy(root.taxonomy)
  const taxonomy = normalizedTaxonomy.taxonomy
  if (!normalizedTaxonomy.present) {
    add('info', 'taxonomy-missing', '数据里没有 taxonomy，本次检查使用内置初始词表')
  }
  if (!normalizedTaxonomy.usable) {
    add('error', 'taxonomy-unusable', 'taxonomy 缺集合或集合类型不对，公开筛选可能为空')
  }
  for (const message of normalizedTaxonomy.issues) {
    add('warning', 'taxonomy-issue', message)
  }

  const taxonomyEntries = VOCABULARY_COLLECTIONS.reduce(
    (sum, collection) => sum + taxonomy[collection].length,
    0,
  )

  // 跨集合同名（玩法 / 机制 / 平台）—— 只提示，不自动合并
  const nameOwners = new Map<string, string[]>()
  for (const collection of VOCABULARY_COLLECTIONS) {
    for (const entry of taxonomy[collection]) {
      const key = vocabularyNameKey(entry.name)
      const owners = nameOwners.get(key) ?? []
      owners.push(VOCABULARY_LABELS[collection])
      nameOwners.set(key, owners)
    }
  }
  for (const [key, owners] of nameOwners) {
    if (owners.length > 1) {
      add(
        'warning',
        'overlapping-vocabulary',
        `「${key}」同时出现在${owners.join('、')}中，请确认它到底属于哪一类`,
      )
    }
  }

  // 无人使用的词条（信息级；初始词表本来就未绑定作品）
  for (const collection of VOCABULARY_COLLECTIONS) {
    const usage = countVocabularyUsage(games, taxonomy, collection)
    for (const entry of taxonomy[collection]) {
      if ((usage.get(entry.id) ?? 0) === 0) {
        add(
          'info',
          'unused-vocabulary',
          `${VOCABULARY_LABELS[collection]}「${entry.name}」还没有被任何作品使用`,
        )
      }
    }
  }

  const vocabularyNames = new Set<string>()
  for (const collection of VOCABULARY_COLLECTIONS) {
    for (const entry of taxonomy[collection]) vocabularyNames.add(vocabularyNameKey(entry.name))
  }

  /* ---------------------------------------------------------------------------
     逐条作品
     --------------------------------------------------------------------------- */
  const unclassifiedGames: { id: string; title: string }[] = []

  for (const game of games) {
    const rawGame = rawById.get(game.id) ?? {}
    const label = game.title || game.id

    // 原始字段逐项检查类型：归一化会把缺失 / 类型错误填成空值，
    // 只看归一化结果会把「数据坏了」误报成「还没填」，两种结论完全不同。
    if (rawGame.title === undefined) {
      add('error', 'missing-title', `作品「${game.id}」没有标题`, game.id)
    } else if (typeof rawGame.title !== 'string') {
      add(
        'error',
        'invalid-title',
        `作品「${game.id}」的 title 不是字符串（实际为 ${describeValue(rawGame.title)}）`,
        game.id,
      )
    } else if (!rawGame.title.trim()) {
      add('error', 'missing-title', `作品「${game.id}」没有标题`, game.id)
    }

    if (rawGame.author === undefined) {
      add('error', 'missing-author', `作品《${label}》没有作者`, game.id)
    } else if (typeof rawGame.author !== 'string') {
      add(
        'error',
        'invalid-author',
        `作品《${label}》的 author 不是字符串（实际为 ${describeValue(rawGame.author)}）`,
        game.id,
      )
    } else if (!rawGame.author.trim()) {
      add('error', 'missing-author', `作品《${label}》没有作者`, game.id)
    }

    if (rawGame.coverImage === undefined) {
      add('warning', 'missing-cover', `作品《${label}》没有封面图`, game.id)
    } else if (typeof rawGame.coverImage !== 'string') {
      add(
        'error',
        'invalid-cover',
        `作品《${label}》的 coverImage 不是字符串（实际为 ${describeValue(rawGame.coverImage)}）`,
        game.id,
      )
    } else if (!rawGame.coverImage.trim()) {
      add('warning', 'missing-cover', `作品《${label}》没有封面图`, game.id)
    }

    if (rawGame.bannerImage === undefined) {
      add('warning', 'missing-banner', `作品《${label}》没有 Banner 宣传图`, game.id)
    } else if (typeof rawGame.bannerImage !== 'string') {
      add(
        'error',
        'invalid-banner',
        `作品《${label}》的 bannerImage 不是字符串（实际为 ${describeValue(rawGame.bannerImage)}）`,
        game.id,
      )
    } else if (!rawGame.bannerImage.trim()) {
      add('warning', 'missing-banner', `作品《${label}》没有 Banner 宣传图`, game.id)
    }

    if (rawGame.downloads === undefined) {
      add('warning', 'missing-downloads', `作品《${label}》没有下载渠道`, game.id)
    } else if (!Array.isArray(rawGame.downloads)) {
      add(
        'error',
        'invalid-downloads',
        `作品《${label}》的 downloads 不是数组（实际为 ${describeValue(rawGame.downloads)}）`,
        game.id,
      )
    } else if (rawGame.downloads.length === 0) {
      add('warning', 'missing-downloads', `作品《${label}》没有下载渠道`, game.id)
    } else {
      rawGame.downloads.forEach((link, linkIndex) => {
        const where = `作品《${label}》的第 ${linkIndex + 1} 个下载渠道`
        if (!isRecord(link)) {
          add('error', 'invalid-download', `${where}不是对象（实际为 ${describeValue(link)}）`, game.id)
          return
        }
        if (typeof link.provider !== 'string' || !link.provider.trim()) {
          add('error', 'invalid-download', `${where}缺少 provider`, game.id)
        }
        if (typeof link.url !== 'string' || !link.url.trim()) {
          add('error', 'invalid-download', `${where}缺少 url`, game.id)
        }
        if (link.password !== undefined && typeof link.password !== 'string') {
          add('error', 'invalid-download', `${where}的 password 不是字符串`, game.id)
        }
      })
    }

    for (const { field, code, label: fieldLabel } of RAW_TEXT_LIST_FIELDS) {
      const value = rawGame[field]
      if (value === undefined) continue
      if (!Array.isArray(value)) {
        add(
          'error',
          code,
          `作品《${label}》的${fieldLabel}字段不是数组（实际为 ${describeValue(value)}）`,
          game.id,
        )
        continue
      }
      const invalidItems = value.filter((item) => typeof item !== 'string')
      if (invalidItems.length > 0) {
        add(
          'error',
          code,
          `作品《${label}》的${fieldLabel}字段包含 ${invalidItems.length} 个非字符串项`,
          game.id,
        )
      }
    }

    const year = rawGame.releaseYear
    if (typeof year !== 'number' || !Number.isFinite(year)) {
      add(
        'error',
        'invalid-year',
        `作品《${label}》的发行年份不是数字（实际为 ${describeValue(year)}）`,
        game.id,
      )
    } else if (year < YEAR_MIN || year > YEAR_MAX) {
      add(
        'warning',
        'implausible-year',
        `作品《${label}》的发行年份 ${year} 不在 ${YEAR_MIN}–${YEAR_MAX} 之间`,
        game.id,
      )
    }

    // 开发状态：原始值非法（归一化会静默回退 unknown）
    if (
      rawGame.developmentStatus !== undefined &&
      !(DEVELOPMENT_STATUSES as string[]).includes(String(rawGame.developmentStatus))
    ) {
      add(
        'warning',
        'invalid-development-status',
        `作品《${label}》的开发状态「${String(rawGame.developmentStatus)}」不合法，读取时会回退为 unknown`,
        game.id,
      )
    }

    // 未分类
    if (game.gameplayTypes.length === 0) {
      unclassifiedGames.push({ id: game.id, title: game.title })
      add('warning', 'unclassified', `作品《${label}》还没有标注玩法类型`, game.id)
    }

    // 词条引用失效
    for (const collection of VOCABULARY_COLLECTIONS) {
      for (const value of game[collection]) {
        if (resolveVocabularyEntry(taxonomy, collection, value)) continue
        add(
          'error',
          'unknown-vocabulary',
          `作品《${label}》的${VOCABULARY_LABELS[collection]}引用「${value}」不在词表里`,
          game.id,
        )
      }
    }

    // 标签与受控词条同名 → 概念重叠（不是错误，但建议合并 / 清理）
    for (const tag of game.tags) {
      if (vocabularyNames.has(tag.toLocaleLowerCase())) {
        add(
          'warning',
          'tag-overlaps-vocabulary',
          `作品《${label}》的标签「${tag}」与词表条目同名，建议改用受控字段`,
          game.id,
        )
      }
    }

    // 原始数组里的重复项（归一化会去重，但数据本身仍应清理）
    for (const duplicate of duplicateValues(rawGame.tags)) {
      add('warning', 'duplicate-tag', `作品《${label}》的标签「${duplicate}」重复`, game.id)
    }
    for (const duplicate of duplicateValues(rawGame.altTitles)) {
      add(
        'warning',
        'duplicate-alt-title',
        `作品《${label}》的其他名称「${duplicate}」重复`,
        game.id,
      )
    }
    for (const duplicate of duplicateValues(rawGame.platforms)) {
      add('warning', 'duplicate-platform', `作品《${label}》的平台「${duplicate}」重复`, game.id)
    }
  }

  /* ---------------------------------------------------------------------------
     关系：直接检查原始数据
     ---------------------------------------------------------------------------
     归一化会丢掉非法类型 / 自关联 / 重复目标 —— 对读取是对的，对检查却会让
     数据问题永远不可见。所以这里看原始 relations。
     --------------------------------------------------------------------------- */
  for (const [id, rawGame] of rawById) {
    const game = byId.get(id)
    const label = game?.title || id
    if (rawGame.relations === undefined) continue

    if (!Array.isArray(rawGame.relations)) {
      add('error', 'relation-not-array', `作品《${label}》的 relations 不是数组`, id)
      continue
    }

    if (rawGame.relations.length > RELATION_LIMIT) {
      add(
        'warning',
        'relation-limit',
        `作品《${label}》有 ${rawGame.relations.length} 条关系，超过 ${RELATION_LIMIT} 条上限`,
        id,
      )
    }

    const seenTargets = new Set<string>()
    for (const rawRelation of rawGame.relations) {
      if (!isRecord(rawRelation)) {
        add('error', 'relation-invalid', `作品《${label}》有一条关系不是对象`, id)
        continue
      }
      if (!isRelationType(rawRelation.type)) {
        add(
          'error',
          'relation-invalid-type',
          `作品《${label}》的关系类型「${String(rawRelation.type)}」不合法`,
          id,
        )
      }
      if (rawRelation.targetId !== undefined && typeof rawRelation.targetId !== 'string') {
        add(
          'error',
          'relation-invalid-target',
          `作品《${label}》有一条关系的目标 id 不是字符串（实际为 ${describeValue(rawRelation.targetId)}）`,
          id,
        )
        continue
      }
      const targetId = rawRelationTargetId(rawRelation)
      if (!targetId) {
        add('error', 'relation-empty-target', `作品《${label}》有一条关系缺少目标 id`, id)
        continue
      }
      if (targetId === id) {
        add('error', 'relation-self', `作品《${label}》关联到了自身`, id)
        continue
      }
      if (seenTargets.has(targetId)) {
        add(
          'error',
          'relation-duplicate',
          `作品《${label}》对目标「${targetId}」记录了不止一条关系`,
          id,
        )
        continue
      }
      seenTargets.add(targetId)

      const targetRaw = rawById.get(targetId)
      const target = byId.get(targetId)
      if (!targetRaw) {
        add(
          'error',
          'relation-dangling',
          `作品《${label}》的关系目标「${targetId}」不存在`,
          id,
        )
        continue
      }

      if (target && !isPubliclyVisible(target)) {
        add(
          'info',
          'relation-target-hidden',
          `作品《${label}》关联的《${target.title}》当前未上线或已归档，前台不会展示`,
          id,
        )
      }

      // 两端各存一条（同一对作品只应有一条有向边）；只报告一次
      const back = Array.isArray(targetRaw.relations) && targetRaw.relations.some(
        (relation) => rawRelationTargetId(relation) === id,
      )
      if (back && id < targetId) {
        add(
          'warning',
          'relation-reverse-duplicate',
          `《${label}》与《${target?.title ?? targetId}》在两端各记录了一条关系，应只保留一条`,
          id,
        )
      }
    }
  }

  /* ---------------------------------------------------------------------------
     汇总
     --------------------------------------------------------------------------- */
  const errors = issues.filter((issue) => issue.severity === 'error').length
  const warnings = issues.filter((issue) => issue.severity === 'warning').length
  const infos = issues.filter((issue) => issue.severity === 'info').length

  return {
    source,
    counts: {
      games: games.length,
      visible: visibleGames.length,
      hidden: games.length - visibleGames.length,
      taxonomyEntries,
      unclassified: unclassifiedGames.length,
      errors,
      warnings,
      infos,
    },
    unclassifiedGames,
    issues,
    ok: errors === 0,
  }
}
