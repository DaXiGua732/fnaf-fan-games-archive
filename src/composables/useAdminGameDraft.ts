/**
 * ============================================================================
 * useAdminGameDraft —— 编辑器草稿态（Phase 5）
 * ============================================================================
 * 职责：把「一条可编辑的作品副本 + 校验 + 未保存改动跟踪」收进一个模块，
 *      让编辑页只负责渲染。
 *
 * 【与 useAdminGames 的关键区别：这是工厂，不是单例】
 *   useAdminGames 是模块级单例（全后台共享一份目录状态）；
 *   而草稿是**每次编辑会话独有**的，所以这里返回的是新实例。
 *   如果哪天看到 `const { draft } = useAdminGameDraft()` 出现在模块顶层，那是用错了。
 *
 * 【纯函数与状态分离】
 *   gameToDraft / draftToPatch / validateDraft 都是纯函数并对外导出，
 *   断言可以直接测它们，不需要构造组件。
 * ============================================================================
 */
import {
  computed,
  inject,
  provide,
  reactive,
  ref,
  type ComputedRef,
  type InjectionKey,
  type Ref,
} from 'vue'
import type {
  AdminGame,
  DownloadDraft,
  DraftErrors,
  DraftField,
  GameDraft,
} from '../types/admin'
import {
  DEVELOPMENT_STATUSES,
  RELATION_LIMITS,
  type DevelopmentStatus,
  type GameRelation,
  type GameStatus,
  type RelationType,
} from '../types/game'
import {
  ALT_TITLE_LIMITS,
  DOWNLOAD_LIMITS,
  DRAFT_ERROR_FIELDS,
  DRAFT_FIELDS,
  DRAFT_TEXT_FIELDS,
  IMAGE_LIMITS,
  TAG_LIMITS,
  isValidAltTitle,
  isValidImageRef,
  isValidTag,
  normalizeAltTitle,
  normalizeImageRef,
  normalizeTag,
} from '../types/admin'
import {
  GAME_VOCABULARY_LIMITS,
  VOCABULARY_LABELS,
  type Taxonomy,
  type VocabularyCollection,
} from '../types/taxonomy'
import { adminGameRepository } from '../repositories'
import { resolveVocabularyEntry } from '../utils/taxonomy'
import { blankGame } from '../utils/gameFactory'
import { inspectGameRelations, isRelationType } from '../utils/relations'

/** 年份下限：FNAF 初代是 2014，留一点余量 */
const YEAR_MIN = 1990
/** 年份上限余量：允许填写「已公布发售日」的预告作品 */
const YEAR_MAX_OFFSET = 2

/** 模块加载时取一次，保证同一进程内校验边界恒定（便于断言） */
const CURRENT_YEAR = new Date().getFullYear()

/** 允许的发行年份区间 */
export const YEAR_RANGE = { min: YEAR_MIN, max: CURRENT_YEAR + YEAR_MAX_OFFSET }

/** 各字段的长度上限 */
export const DRAFT_LIMITS = {
  title: 120,
  author: 80,
  ipSeries: 60,
  engine: 60,
  shortDescription: 120,
  description: 2000,
  sourceUrl: 300,
}

/** 空白草稿（新增模式的起点） */
export function emptyDraft(): GameDraft {
  return {
    title: '',
    author: '',
    releaseYear: '',
    ipSeries: '',
    engine: '',
    videoUrl: '',
    shortDescription: '',
    description: '',
    sortOrder: '',
    tags: [],
    altTitles: [],
    sourceUrl: '',
    developmentStatus: 'unknown',
    gameplayTypes: [],
    mechanics: [],
    platforms: [],
    relations: [],
    coverImage: '',
    bannerImage: '',
    gallery: [],
    downloads: [],
    // ⚠️ 新建缺省是 draft —— 与 normalizeGame 缺省 published **刻意相反**：
    //    前者是「新建不该默认对外可见」，后者是「不能因为加了个字段就把已有内容藏起来」。
    status: 'draft',
    archived: false,
    featured: false,
  }
}

/**
 * 读发布状态并做防御性归一。
 * 非法值一律降级为 `draft` —— 与 blankGame 同一条安全原则：
 * 宁可少发布一条，也不能因为一个脏值把内容误公开出去。
 */
function readStatus(value: unknown): GameStatus {
  return value === 'published' || value === 'offline' ? value : 'draft'
}

/**
 * 把任意值强制读成字符串。
 *
 * 【为什么需要这个】`v-model` 绑在 `<input type="number">` 上时，Vue 会把值
 * **自动转成 Number**（内部 `castToNumber = el.type === 'number'`），
 * 这直接绕过了 TS 的类型约束 —— 声明的 `releaseYear: string` 在运行时可能是 `1800`。
 * 纯函数一旦对着数字调 `.trim()`，抛的是 TypeError，表现为「校验静默失效、保存毫无反应」，
 * 排查成本极高。所以在纯函数的入口统一做一次归一化，让它们对运行时类型漂移免疫。
 *
 * 注意：这只防「崩」，字段控件的 `type` 仍然必须是正确的（年份用 text + inputmode）。
 */
function asText(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '')
}

/** 归一化后的文本字段（全部保证是字符串） */
function readText(draft: GameDraft): Record<(typeof DRAFT_TEXT_FIELDS)[number], string> {
  const result = {} as Record<(typeof DRAFT_TEXT_FIELDS)[number], string>
  for (const field of DRAFT_TEXT_FIELDS) result[field] = asText(draft[field])
  return result
}

/**
 * 归一化后的标签数组：去重、去空、限长。
 *
 * ⚠️ 这里**刻意不按数量截断**。上限只在 `addTag()` 这个「新增」入口执行。
 * 原因：本函数同时被 `draftToPatch()`（保存路径）使用，如果在这里截断，
 * 一条标签超限的作品在被保存时会**静默丢掉多余的标签** —— 归一化不该有副作用。
 */
function readTags(draft: GameDraft): string[] {
  if (!Array.isArray(draft.tags)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of draft.tags) {
    const tag = normalizeTag(raw)
    if (!isValidTag(tag) || seen.has(tag)) continue
    seen.add(tag)
    result.push(tag)
  }
  return result
}

/**
 * 归一化后的其他名称：去空、去重。**不按数量 / 长度截断** ——
 * 超限由 `validateDraft()` 报错，静默丢数据比拒绝保存糟糕得多。
 */
function readAltTitles(draft: GameDraft): string[] {
  if (!Array.isArray(draft.altTitles)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of draft.altTitles) {
    const title = normalizeAltTitle(raw)
    if (!title) continue
    const key = title.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(title)
  }
  return result
}

/** 开发状态归一：非法值回退 `unknown`，**绝不**回退成 `released` */
function readDevelopmentStatus(value: unknown): DevelopmentStatus {
  return typeof value === 'string' &&
    (DEVELOPMENT_STATUSES as string[]).includes(value)
    ? (value as DevelopmentStatus)
    : 'unknown'
}

/**
 * 词条引用的基础归一化：去掉非字符串 / 空项、按字面去重。
 *
 * 刻意**不**校验「这个 id 在词表里存在」：那是 `validateDraft()` 的职责。
 * 读路径静默丢弃不存在的引用，会让数据问题永远不可见。
 */
function normalizeVocabularyValues(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of list) {
    const value = typeof raw === 'string' ? raw : String(raw ?? '')
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}

function readVocabulary(draft: GameDraft, collection: VocabularyCollection): string[] {
  return normalizeVocabularyValues(draft[collection])
}

/**
 * 把数据里的词条引用映射成稳定 id。
 *
 * 历史数据可能直接写名称（如平台 `"Windows"`）。有词表时按「先 id、再名称」
 * 解析；解析不了的**保留原值**，让保存前的校验给出可读错误，而不是静默丢掉。
 */
function toVocabularyIds(
  values: unknown,
  collection: VocabularyCollection,
  taxonomy?: Taxonomy,
): string[] {
  const literals = normalizeVocabularyValues(values)
  if (!taxonomy) return literals

  const seen = new Set<string>()
  const result: string[] = []
  for (const value of literals) {
    const entry = resolveVocabularyEntry(taxonomy, collection, value)
    const id = entry?.id ?? value
    if (seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}

/**
 * 草稿关系 → 可保存形态。
 *
 * 只做结构复制，**不在这里丢弃非法项**：读路径的 `normalizeGame()` 已经
 * 清理过数据；编辑器里的每一行都要显示自己的错误，静默删除会让管理员
 * 以为「保存成功，但关系不见了」。
 */
function readRelations(source: { relations?: GameRelation[] }): GameRelation[] {
  if (!Array.isArray(source.relations)) return []
  return source.relations.map((relation) => ({
    type: relation.type,
    targetId: typeof relation.targetId === 'string' ? relation.targetId.trim() : '',
  }))
}

/**
 * 归一化后的图库：去空、去重。顺序即前台展示顺序，因此**不排序、不截断**
 * （不截断的理由同 readTags：它也给保存路径用）。
 */
function readGallery(draft: GameDraft): string[] {
  if (!Array.isArray(draft.gallery)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of draft.gallery) {
    const ref = normalizeImageRef(raw)
    if (!ref || seen.has(ref)) continue
    seen.add(ref)
    result.push(ref)
  }
  return result
}

/**
 * 归一化后的下载渠道：三个字段都强制成字符串，非法行直接丢弃。
 * 同样**不按数量截断**（理由见 readTags）。
 */
function readDownloads(draft: GameDraft): DownloadDraft[] {
  if (!Array.isArray(draft.downloads)) return []
  const result: DownloadDraft[] = []
  for (const raw of draft.downloads) {
    if (!raw || typeof raw !== 'object') continue
    result.push({
      provider: asText(raw.provider),
      url: asText(raw.url),
      password: asText(raw.password),
    })
  }
  return result
}

/**
 * 模型 → 草稿。
 *
 * `taxonomy` 可选：传入时把历史遗留的名称写法（如平台 "Windows"）映射成稳定 id；
 * 不传时原样保留（纯函数测试不需要词表）。
 */
export function gameToDraft(game: AdminGame, taxonomy?: Taxonomy): GameDraft {
  return {
    title: game.title,
    author: game.author,
    releaseYear: String(game.releaseYear),
    ipSeries: game.ipSeries,
    engine: game.engine,
    videoUrl: game.videoUrl ?? '',
    shortDescription: game.shortDescription ?? '',
    description: game.description,
    // 数组字段必须是副本：直接引用会让「编辑草稿」和「基线」共享同一份数据
    tags: [...game.tags],
    altTitles: [...(game.altTitles ?? [])],
    sourceUrl: game.sourceUrl ?? '',
    developmentStatus: readDevelopmentStatus(game.developmentStatus),
    gameplayTypes: toVocabularyIds(game.gameplayTypes, 'gameplayTypes', taxonomy),
    mechanics: toVocabularyIds(game.mechanics, 'mechanics', taxonomy),
    platforms: toVocabularyIds(game.platforms, 'platforms', taxonomy),
    relations: readRelations(game),
    coverImage: game.coverImage,
    bannerImage: game.bannerImage,
    gallery: [...game.gallery],
    downloads: game.downloads.map((link) => ({
      provider: link.provider,
      url: link.url,
      password: link.password ?? '',
    })),
    status: readStatus(game.status),
    archived: Boolean(game.archived),
    featured: Boolean(game.featured),
    sortOrder: String(game.sortOrder),
  }
}

/**
 * 草稿 → 写入片段。
 * 调用前**必须**先通过 `validateDraft`：这里不做二次校验，
 * 因为「校验」与「转换」各只有一处职责，重复校验只会让错误文案两处漂移。
 */
export function draftToPatch(draft: GameDraft): Partial<AdminGame> {
  const d = readText(draft)
  return {
    title: d.title.trim(),
    author: d.author.trim(),
    releaseYear: Number(d.releaseYear.trim()),
    ipSeries: d.ipSeries.trim(),
    engine: d.engine.trim(),
    // 留空表示「没有视频」，写成 undefined 以便保存时清掉旧值
    videoUrl: d.videoUrl.trim() || undefined,
    shortDescription: d.shortDescription.trim(),
    description: d.description.trim(),
    tags: readTags(draft),
    altTitles: readAltTitles(draft),
    sourceUrl: d.sourceUrl.trim(),
    developmentStatus: readDevelopmentStatus(draft.developmentStatus),
    gameplayTypes: readVocabulary(draft, 'gameplayTypes'),
    mechanics: readVocabulary(draft, 'mechanics'),
    platforms: readVocabulary(draft, 'platforms'),
    relations: readRelations(draft),
    coverImage: d.coverImage.trim(),
    bannerImage: d.bannerImage.trim(),
    gallery: readGallery(draft),
    downloads: readDownloads(draft).map((link) => ({
      provider: link.provider.trim(),
      url: link.url.trim(),
      // 留空表示「没有提取码」，写成 undefined 与模型的 optional 对齐
      password: link.password.trim() || undefined,
    })),
    sortOrder: Number(d.sortOrder.trim() || 0),
    status: readStatus(draft.status),
    archived: Boolean(draft.archived),
    featured: Boolean(draft.featured),
  }
}

/** 空的校验结果。按 DRAFT_ERROR_FIELDS 生成 —— 字段增删时不会漏掉一处 */
export function emptyErrors(): DraftErrors {
  const errors = {} as DraftErrors
  for (const field of DRAFT_ERROR_FIELDS) errors[field] = ''
  return errors
}

/**
 * 校验草稿。返回每个字段的错误文案（空字符串 = 通过）。
 *
 * `taxonomy` 可选：传入时额外校验分类词条 id 是否还存在。
 * 不传时跳过存在性检查（纯函数调用方可能没有词表），但数量 / 格式上限照样生效。
 */
export function validateDraft(draft: GameDraft, taxonomy?: Taxonomy): DraftErrors {
  const errors = emptyErrors()
  const d = readText(draft)

  const title = d.title.trim()
  if (!title) errors.title = '游戏名称不能为空'
  else if (title.length > DRAFT_LIMITS.title) {
    errors.title = `游戏名称不能超过 ${DRAFT_LIMITS.title} 个字符`
  }

  const author = d.author.trim()
  if (!author) errors.author = '作者不能为空'
  else if (author.length > DRAFT_LIMITS.author) {
    errors.author = `作者不能超过 ${DRAFT_LIMITS.author} 个字符`
  }

  const year = d.releaseYear.trim()
  if (!year) {
    errors.releaseYear = '发行年份不能为空'
  } else if (!/^\d{4}$/.test(year)) {
    errors.releaseYear = '发行年份必须是 4 位数字'
  } else {
    const value = Number(year)
    if (value < YEAR_RANGE.min) errors.releaseYear = `发行年份不能早于 ${YEAR_RANGE.min}`
    else if (value > YEAR_RANGE.max) {
      errors.releaseYear = `发行年份不能晚于 ${YEAR_RANGE.max}`
    }
  }

  const ipSeries = d.ipSeries.trim()
  if (!ipSeries) errors.ipSeries = 'IP 系列不能为空'
  else if (ipSeries.length > DRAFT_LIMITS.ipSeries) {
    errors.ipSeries = `IP 系列不能超过 ${DRAFT_LIMITS.ipSeries} 个字符`
  }

  const engine = d.engine.trim()
  if (!engine) errors.engine = '开发引擎不能为空'
  else if (engine.length > DRAFT_LIMITS.engine) {
    errors.engine = `开发引擎不能超过 ${DRAFT_LIMITS.engine} 个字符`
  }

  const videoUrl = d.videoUrl.trim()
  if (videoUrl && !/^https?:\/\/\S+$/i.test(videoUrl)) {
    errors.videoUrl = '视频地址必须是 http:// 或 https:// 开头的完整链接'
  }

  const shortDescription = d.shortDescription.trim()
  if (shortDescription.length > DRAFT_LIMITS.shortDescription) {
    errors.shortDescription = `一句话简介不能超过 ${DRAFT_LIMITS.shortDescription} 个字符`
  }

  const description = d.description.trim()
  if (!description) errors.description = '简介不能为空'
  else if (description.length > DRAFT_LIMITS.description) {
    errors.description = `简介不能超过 ${DRAFT_LIMITS.description} 个字符`
  }

  // 封面 / Banner 允许留空 —— 草稿阶段可以先没图，
  // 「发布必须有封面」属于发布校验（见 publishIssues），不该拦在保存这一步
  for (const field of ['coverImage', 'bannerImage'] as const) {
    const ref = d[field].trim()
    if (!ref) continue
    if (ref.length > IMAGE_LIMITS.maxLength) {
      errors[field] = `图片地址不能超过 ${IMAGE_LIMITS.maxLength} 个字符`
    } else if (!isValidImageRef(ref)) {
      errors[field] = '请填写网站内的图片路径（以 / 开头），或完整的 http(s) 图片地址'
    }
  }

  // 排序权重：可留空（视为 0），填了必须是整数
  const sortOrder = d.sortOrder.trim()
  if (sortOrder && !/^-?\d+$/.test(sortOrder)) {
    errors.sortOrder = '排序权重必须是整数（可以是负数），留空表示 0'
  }
  // 来源页：可留空；填了就必须是完整 http(s) 链接
  const sourceUrl = d.sourceUrl.trim()
  if (sourceUrl) {
    if (sourceUrl.length > DRAFT_LIMITS.sourceUrl) {
      errors.sourceUrl = `来源页不能超过 ${DRAFT_LIMITS.sourceUrl} 个字符`
    } else if (!/^https?:\/\/\S+$/i.test(sourceUrl)) {
      errors.sourceUrl = '来源页必须是 http:// 或 https:// 开头的完整链接'
    }
  }

  // 其他名称：超限 / 单项过长都**阻止保存**，不做静默截断
  const altTitles = readAltTitles(draft)
  if (altTitles.length > ALT_TITLE_LIMITS.maxPerGame) {
    errors.altTitles = `其他名称最多 ${ALT_TITLE_LIMITS.maxPerGame} 个`
  } else {
    const tooLong = altTitles.find((title) => !isValidAltTitle(title))
    if (tooLong) {
      errors.altTitles = `其他名称不能超过 ${ALT_TITLE_LIMITS.maxLength} 个字符`
    }
  }

  /*
   * 分类词条：数量上限对每个集合都生效；存在性只在拿到词表时校验。
   *
   * 存在性检查的意义：草稿里可能残留一个已被合并 / 删除的词条 id。
   * 若放它进去，保存后该引用会静默失效（前台筛不到、后台看不出原因）。
   */
  for (const collection of ['gameplayTypes', 'mechanics', 'platforms'] as const) {
    const label = VOCABULARY_LABELS[collection]
    const values = readVocabulary(draft, collection)
    if (values.length > GAME_VOCABULARY_LIMITS[collection]) {
      errors[collection] = `${label}最多 ${GAME_VOCABULARY_LIMITS[collection]} 个`
      continue
    }
    if (taxonomy) {
      const unknown = values.filter(
        (value) => !resolveVocabularyEntry(taxonomy, collection, value),
      )
      if (unknown.length > 0) {
        errors[collection] = `${label}里有已失效的词条：${unknown.join('、')}，请移除后重选`
      }
    }
  }

  return errors
}

/**
 * 校验单行下载渠道，返回第一条错误文案（空字符串 = 通过）。
 *
 * 下载是**逐行**校验的，一个扁平的错误记录（DraftErrors）装不下，
 * 所以单独导出，并在 isValid 里一起判断。每行只报第一条错误 ——
 * 一行同时飘三条红字只会让人不知道先改哪个。
 */
export function validateDownload(link: DownloadDraft): string {
  const provider = link.provider.trim()
  if (!provider) return '服务商不能为空'
  if (provider.length > DOWNLOAD_LIMITS.maxTextLength) {
    return `服务商不能超过 ${DOWNLOAD_LIMITS.maxTextLength} 个字符`
  }

  const url = link.url.trim()
  if (!url) return '下载地址不能为空'
  if (!/^https?:\/\/\S+$/i.test(url)) {
    return '下载地址必须是 http:// 或 https:// 开头的完整链接'
  }

  const password = link.password.trim()
  if (password.length > DOWNLOAD_LIMITS.maxTextLength) {
    return `提取码不能超过 ${DOWNLOAD_LIMITS.maxTextLength} 个字符`
  }

  return ''
}

/* ---------------------------------------------------------------------------
   对外接口
   --------------------------------------------------------------------------- */
export interface AdminGameDraftAPI {
  /** 可编辑副本（直接 v-model 绑到控件上） */
  draft: GameDraft
  /** 实时校验结果（始终计算，但由调用方决定何时展示） */
  errors: ComputedRef<DraftErrors>
  /** 是否全部字段通过校验 */
  isValid: ComputedRef<boolean>
  /** 能否保存：基础校验通过，且「已上线」时没有发布缺口 */
  canSave: ComputedRef<boolean>
  /** 发布缺口清单（草稿 / 已下线时为空） */
  publishIssues: ComputedRef<string[]>
  /** 是否与基线不同（即存在未保存改动） */
  isDirty: ComputedRef<boolean>
  /** 发生改动的字段名（用于区块头的「已修改」标记） */
  changedFields: ComputedRef<DraftField[]>
  /** 是否已经尝试过提交（决定校验错误何时开始显示） */
  touched: Ref<boolean>
  /** 用一条作品（或 undefined = 新增）重置整个草稿与基线 */
  loadFrom: (game: AdminGame | undefined) => void
  /** 丢弃改动，回到基线 */
  resetToBaseline: () => void
  /** 保存成功后调用：把基线同步为当前草稿 */
  markSaved: () => void

  // —— 标签（Phase 6）——
  /** 当前草稿的标签（已归一化） */
  draftTags: ComputedRef<string[]>
  /** 添加标签；重复或超上限时返回加入的标签数（0 表示没加进去） */
  addTag: (input: unknown) => number
  /** 移除标签 */
  removeTag: (tag: string) => void
  /** 是否还能继续添加标签 */
  canAddTag: ComputedRef<boolean>
  // —— 其他名称（Phase 2）——
  /** 当前草稿的其他名称（已归一化） */
  draftAltTitles: ComputedRef<string[]>
  /** 添加其他名称；重复 / 超限 / 非法时返回 0 */
  addAltTitle: (input: unknown) => number
  removeAltTitle: (title: string) => void
  canAddAltTitle: ComputedRef<boolean>

  // —— 分类词条（Phase 2：玩法类型 / 机制 / 平台）——
  /** 某个集合在当前草稿里的词条 id（顺序有意义：玩法第一项是主要玩法） */
  draftVocabulary: (collection: VocabularyCollection) => string[]
  /**
   * 加入一个词条。传 id 或名称都行（名称会解析成 id）。
   * 返回 false 表示：词表里没有、重复、或已达上限。
   */
  addVocabularyValue: (collection: VocabularyCollection, value: unknown) => boolean
  removeVocabularyValue: (collection: VocabularyCollection, value: string) => void
  /** 把某个玩法类型设为主要（移到第一位）；不在列表里时无操作 */
  setPrimaryGameplayType: (value: string) => void
  canAddVocabulary: (collection: VocabularyCollection) => boolean

  // —— 关联作品（Phase 5）——
  /** 当前草稿的显式关系（有向边，顺序即后台展示顺序） */
  draftRelations: ComputedRef<GameRelation[]>
  /** 与 draftRelations 一一对应的行错误（空字符串 = 通过） */
  relationRowErrors: ComputedRef<string[]>
  /** 会阻断保存的关系问题（行错误 + 数量上限） */
  relationIssues: ComputedRef<string[]>
  canAddRelation: ComputedRef<boolean>
  /** 添加关系；返回错误文案，空字符串表示成功 */
  addRelation: (type: unknown, targetId: unknown) => string
  removeRelation: (index: number) => void
  /** 关联目标候选（排除自身与已选），按标题排序 */
  searchRelationTargets: (needle: string, limit?: number) => AdminGame[]

  // —— 图片（Phase 7）——
  /** 当前草稿的图库（已归一化） */
  draftImages: ComputedRef<string[]>
  /** 是否还能继续添加图片 */
  canAddImage: ComputedRef<boolean>
  /** 设置封面 / Banner，传空串即清除 */
  setImage: (field: 'coverImage' | 'bannerImage', value: unknown) => void
  clearImage: (field: 'coverImage' | 'bannerImage') => void
  /** 批量加入图库，返回实际加入数 */
  addImages: (inputs: unknown[]) => number
  removeImage: (index: number) => void
  /** 上移 / 下移一位，返回是否真的移动了 */
  moveImage: (index: number, delta: -1 | 1) => boolean

  // —— 下载渠道（Phase 8）——
  /** 当前草稿的下载渠道（已归一化） */
  draftDownloads: ComputedRef<DownloadDraft[]>
  /** 逐行校验错误，与 draftDownloads 一一对应（空字符串 = 该行通过） */
  downloadErrors: ComputedRef<string[]>
  /** 是否还能继续添加渠道 */
  canAddDownload: ComputedRef<boolean>
  addDownload: () => void
  removeDownload: (index: number) => void
  /** 上移 / 下移一位，返回是否真的移动了 */
  moveDownload: (index: number, delta: -1 | 1) => boolean
}

export function useAdminGameDraft(): AdminGameDraftAPI {
  const draft = reactive<GameDraft>(emptyDraft())
  /** 基线：进入页面（或上次保存成功）时的快照，用于脏检查与「撤销修改」 */
  const baseline = reactive<GameDraft>(emptyDraft())
  const touched = ref(false)

  /**
   * 正在编辑的作品 id（新建时为空字符串）。
   *
   * 关系校验需要它来判断自关联与反向记录；草稿本身不含 id（id 由仓储管理），
   * 所以单独记一份，由 `loadFrom()` 同步。
   */
  const draftGameId = ref('')

  /**
   * 把 source 的内容**逐字段复制**进 target。
   *
   * 不用 `Object.assign`：它会连数组引用一起复制，
   * 于是「草稿的 tags」和「基线的 tags」会指向同一个数组 ——
   * 后续对草稿标签的增删会同时改掉基线，isDirty 永远为 false，改动静默丢失。
   */
  function applyDraft(target: GameDraft, source: GameDraft): void {
    const text = readText(source)
    for (const field of DRAFT_TEXT_FIELDS) target[field] = text[field]
    target.tags = readTags(source)
    target.altTitles = readAltTitles(source)
    target.gameplayTypes = readVocabulary(source, 'gameplayTypes')
    target.mechanics = readVocabulary(source, 'mechanics')
    target.platforms = readVocabulary(source, 'platforms')
    target.relations = readRelations(source).map((relation) => ({ ...relation }))
    target.developmentStatus = readDevelopmentStatus(source.developmentStatus)
    target.gallery = readGallery(source)
    // 对象数组要逐行复制，不能只复制外层数组 —— 否则草稿与基线共享同一批行对象
    target.downloads = readDownloads(source).map((link) => ({ ...link }))
    target.status = readStatus(source.status)
    target.archived = Boolean(source.archived)
    target.featured = Boolean(source.featured)
  }

  /**
   * 当前词表。
   *
   * 读 `adminGameRepository` 而不是自己存一份：登录后仓储会换成远程仓，
   * 词表随之更新；存副本会立刻过期。仓储切换本身是响应式的，所以这里也响应式。
   */
  const taxonomy = computed(() => adminGameRepository.value.taxonomy.value)

  const errors = computed<DraftErrors>(() => validateDraft(draft, taxonomy.value))

  /** 下载渠道逐行校验错误，与 draftDownloads 一一对应（空字符串 = 该行通过） */
  const downloadErrors = computed<string[]>(() => readDownloads(draft).map(validateDownload))

  /** 用「当前草稿覆盖后的作品」做关系校验；新建作品 id 为空，自关联留给仓储兜底 */
  function currentDraftGame(): AdminGame {
    const base = draftGameId.value
      ? adminGameRepository.value.games.value.find((game) => game.id === draftGameId.value)
      : undefined
    return {
      ...(base ?? blankGame()),
      ...draftToPatch(draft),
      id: draftGameId.value,
    } as AdminGame
  }

  /** 与 draftRelations 一一对应的行错误（空字符串 = 通过） */
  const relationRowErrors = computed<string[]>(() =>
    inspectGameRelations(adminGameRepository.value.games.value, currentDraftGame())
      .rowErrors,
  )

  /** 阻断保存的关系问题：逐行错误 + 数量上限 */
  const relationIssues = computed<string[]>(() => {
    const issues = relationRowErrors.value.filter(Boolean)
    if (readRelations(draft).length > RELATION_LIMITS.maxPerGame) {
      issues.push(`最多保存 ${RELATION_LIMITS.maxPerGame} 条关联`)
    }
    return [...new Set(issues)]
  })

  const isValid = computed(
    () =>
      DRAFT_ERROR_FIELDS.every((field) => errors.value[field] === '') &&
      downloadErrors.value.every((message) => message === '') &&
      relationIssues.value.length === 0,
  )

  /**
   * 发布级别的缺口清单（草稿 / 已下线不检查）。
   *
   * 为什么单列而不是塞进 isValid：这三项在前台都是**直接渲染**的 ——
   * 没有封面，列表卡片就是一片空白；没有 Banner，详情页顶部是裂图；
   * 没有下载渠道，这个「资源导航站」的条目就没有意义。
   * 但草稿阶段允许缺，所以不能拦在保存这一步。
   */
  const publishIssues = computed<string[]>(() => {
    const issues: string[] = []
    if (!asText(draft.coverImage).trim()) issues.push('还没有封面图')
    if (!asText(draft.bannerImage).trim()) issues.push('还没有 Banner 宣传图')
    if (readDownloads(draft).length === 0) issues.push('还没有下载渠道')
    return issues
  })

  /** 能否保存：基础校验通过，且「已上线」状态不能有发布缺口 */
  const canSave = computed(
    () =>
      isValid.value &&
      (readStatus(draft.status) !== 'published' || publishIssues.value.length === 0),
  )

  /** 字段的「可比较形态」：数组字段拍平成字符串，文本字段先做类型归一化 */
  function fieldValue(source: GameDraft, field: DraftField): string {
    if (field === 'tags') return readTags(source).join(',')
    if (field === 'altTitles') return readAltTitles(source).join(',')
    if (field === 'gameplayTypes') return readVocabulary(source, 'gameplayTypes').join(',')
    if (field === 'mechanics') return readVocabulary(source, 'mechanics').join(',')
    if (field === 'platforms') return readVocabulary(source, 'platforms').join(',')
    if (field === 'relations') return JSON.stringify(readRelations(source))
    if (field === 'developmentStatus') {
      return readDevelopmentStatus(source.developmentStatus)
    }
    if (field === 'gallery') return readGallery(source).join('\n')
    // 对象数组用 JSON 比较：readDownloads 产出的键顺序固定，因此结果稳定
    if (field === 'downloads') return JSON.stringify(readDownloads(source))
    if (field === 'status') return readStatus(source.status)
    if (field === 'archived') return String(Boolean(source.archived))
    if (field === 'featured') return String(Boolean(source.featured))
    return asText(source[field])
  }

  const changedFields = computed<DraftField[]>(() =>
    DRAFT_FIELDS.filter((field) => fieldValue(draft, field) !== fieldValue(baseline, field)),
  )
  const isDirty = computed(() => changedFields.value.length > 0)

  function loadFrom(game: AdminGame | undefined): void {
    const next = game ? gameToDraft(game, taxonomy.value) : emptyDraft()
    draftGameId.value = game?.id ?? ''
    applyDraft(draft, next)
    applyDraft(baseline, next)
    touched.value = false
  }

  function resetToBaseline(): void {
    applyDraft(draft, baseline)
    touched.value = false
  }

  function markSaved(): void {
    applyDraft(baseline, draft)
    touched.value = false
  }

  /* ---- 标签 ---- */
  const draftTags = computed<string[]>(() => readTags(draft))
  const canAddTag = computed(() => draftTags.value.length < TAG_LIMITS.maxPerGame)

  /** 返回实际加入的标签数（0 = 重复 / 超限 / 非法，调用方据此给反馈） */
  function addTag(input: unknown): number {
    const tag = normalizeTag(input)
    if (!isValidTag(tag)) return 0
    const current = draftTags.value
    if (current.includes(tag)) return 0
    if (current.length >= TAG_LIMITS.maxPerGame) return 0
    draft.tags = [...current, tag]
    return 1
  }

  function removeTag(tag: string): void {
    draft.tags = draftTags.value.filter((item) => item !== tag)
  }

  /* ---- 其他名称（Phase 2）---- */
  const draftAltTitles = computed<string[]>(() => readAltTitles(draft))
  const canAddAltTitle = computed(
    () => draftAltTitles.value.length < ALT_TITLE_LIMITS.maxPerGame,
  )

  function addAltTitle(input: unknown): number {
    const title = normalizeAltTitle(input)
    if (!isValidAltTitle(title)) return 0
    const current = draftAltTitles.value
    if (current.some((item) => item.toLocaleLowerCase() === title.toLocaleLowerCase())) return 0
    if (current.length >= ALT_TITLE_LIMITS.maxPerGame) return 0
    draft.altTitles = [...current, title]
    return 1
  }

  function removeAltTitle(title: string): void {
    draft.altTitles = draftAltTitles.value.filter((item) => item !== title)
  }

  /* ---- 分类词条（Phase 2）---- */
  function setDraftVocabulary(
    collection: VocabularyCollection,
    values: string[],
  ): void {
    if (collection === 'gameplayTypes') draft.gameplayTypes = values
    else if (collection === 'mechanics') draft.mechanics = values
    else draft.platforms = values
  }

  function draftVocabulary(collection: VocabularyCollection): string[] {
    return readVocabulary(draft, collection)
  }

  function canAddVocabulary(collection: VocabularyCollection): boolean {
    return draftVocabulary(collection).length < GAME_VOCABULARY_LIMITS[collection]
  }

  function addVocabularyValue(
    collection: VocabularyCollection,
    value: unknown,
  ): boolean {
    const entry = resolveVocabularyEntry(
      taxonomy.value,
      collection,
      typeof value === 'string' ? value : String(value ?? ''),
    )
    // 只接受词表里存在的词条：不允许通过作品编辑器「顺手新建」分类。
    if (!entry) return false

    const current = draftVocabulary(collection)
    if (current.includes(entry.id)) return false
    if (current.length >= GAME_VOCABULARY_LIMITS[collection]) return false
    setDraftVocabulary(collection, [...current, entry.id])
    return true
  }

  function removeVocabularyValue(collection: VocabularyCollection, value: string): void {
    const current = draftVocabulary(collection)
    const entry = resolveVocabularyEntry(taxonomy.value, collection, value)
    const id = entry?.id ?? value
    setDraftVocabulary(
      collection,
      current.filter((item) => item !== id && item !== value),
    )
  }

  function setPrimaryGameplayType(value: string): void {
    const current = draftVocabulary('gameplayTypes')
    const entry = resolveVocabularyEntry(taxonomy.value, 'gameplayTypes', value)
    const id = entry?.id ?? value
    if (!current.includes(id) || current[0] === id) return
    setDraftVocabulary('gameplayTypes', [id, ...current.filter((item) => item !== id)])
  }

  /* ---- 关联作品（Phase 5）---- */
  const draftRelations = computed<GameRelation[]>(() =>
    readRelations(draft).map((relation) => ({ ...relation })),
  )
  const canAddRelation = computed(
    () => draftRelations.value.length < RELATION_LIMITS.maxPerGame,
  )

  /**
   * 添加一条关系。返回错误文案，空字符串表示已加入。
   *
   * 判断全部复用 `inspectGameRelations()`：与仓储保存前的校验同一套规则，
   * 不在这里另写「目标存在吗 / 会不会两端重复」的第二套逻辑。
   */
  function addRelation(type: unknown, targetId: unknown): string {
    if (!isRelationType(type)) return '关系类型不合法'
    const target = typeof targetId === 'string' ? targetId.trim() : ''
    if (!target) return '关系目标不能为空'

    const current = draftRelations.value
    if (current.length >= RELATION_LIMITS.maxPerGame) {
      return `最多保存 ${RELATION_LIMITS.maxPerGame} 条关联`
    }

    const next: GameRelation[] = [...current, { type: type as RelationType, targetId: target }]
    const candidate = inspectGameRelations(adminGameRepository.value.games.value, {
      ...currentDraftGame(),
      relations: next,
    }).rowErrors
    const issue = candidate[candidate.length - 1] ?? ''
    if (issue) return issue

    draft.relations = next
    return ''
  }

  function removeRelation(index: number): void {
    const list = draftRelations.value
    if (index < 0 || index >= list.length) return
    draft.relations = list.filter((_, itemIndex) => itemIndex !== index)
  }

  /**
   * 关联目标候选：后台目录里的全部作品（含草稿 / 下线，便于提前建立关系），
   * 排除自身与已选目标。按标题排序，结果数量由调用方限制。
   */
  function searchRelationTargets(needle: string, limit = 8): AdminGame[] {
    const key = needle.trim().toLowerCase()
    const selected = new Set(draftRelations.value.map((relation) => relation.targetId))
    const size = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 8

    return adminGameRepository.value.games.value
      .filter(
        (game) =>
          game.id !== draftGameId.value &&
          !selected.has(game.id) &&
          (!key || `${game.title} ${game.id} ${game.author}`.toLowerCase().includes(key)),
      )
      .sort((a, b) => a.title.localeCompare(b.title, 'en') || a.id.localeCompare(b.id))
      .slice(0, size)
  }

  /* ---- 图片（Phase 7：只做 UI，接 Storage 是 Phase 16）---- */
  const draftImages = computed<string[]>(() => readGallery(draft))
  const canAddImage = computed(() => draftImages.value.length < IMAGE_LIMITS.maxGallery)

  /** 设置封面 / Banner。传空串即清除 */
  function setImage(field: 'coverImage' | 'bannerImage', value: unknown): void {
    draft[field] = normalizeImageRef(value)
  }

  function clearImage(field: 'coverImage' | 'bannerImage'): void {
    draft[field] = ''
  }

  /**
   * 批量加入图库，返回**实际加入数**（0 = 全部重复 / 非法 / 超限）。
   * 上限在这里执行 —— 见 readGallery 的注释：归一化不做截断。
   */
  function addImages(inputs: unknown[]): number {
    let added = 0
    for (const input of inputs) {
      const ref = normalizeImageRef(input)
      if (!ref || ref.length > IMAGE_LIMITS.maxLength) continue
      if (!isValidImageRef(ref)) continue
      const current = draftImages.value
      if (current.includes(ref)) continue
      if (current.length >= IMAGE_LIMITS.maxGallery) break
      draft.gallery = [...current, ref]
      added += 1
    }
    return added
  }

  function removeImage(index: number): void {
    const list = draftImages.value
    if (index < 0 || index >= list.length) return
    draft.gallery = list.filter((_, i) => i !== index)
  }

  /** 上移 / 下移一位。返回是否真的移动了（越界时为 false） */
  function moveImage(index: number, delta: -1 | 1): boolean {
    const list = [...draftImages.value]
    const target = index + delta
    if (index < 0 || index >= list.length) return false
    if (target < 0 || target >= list.length) return false
    const moved = list.splice(index, 1)
    list.splice(target, 0, ...moved)
    draft.gallery = list
    return true
  }

  /* ---- 下载渠道（Phase 8）----
     行的增删改都经过 readDownloads：它会把每行的三个字段强制成字符串，
     所以即使控件的 value 因为框架行为变成非字符串，也不会污染草稿。 */
  const draftDownloads = computed<DownloadDraft[]>(() => readDownloads(draft))
  const canAddDownload = computed(
    () => draftDownloads.value.length < DOWNLOAD_LIMITS.maxPerGame,
  )

  function addDownload(): void {
    if (!canAddDownload.value) return
    draft.downloads = [...readDownloads(draft), { provider: '', url: '', password: '' }]
  }

  function removeDownload(index: number): void {
    const list = readDownloads(draft)
    if (index < 0 || index >= list.length) return
    draft.downloads = list.filter((_, i) => i !== index)
  }

  function moveDownload(index: number, delta: -1 | 1): boolean {
    const list = [...readDownloads(draft)]
    const target = index + delta
    if (index < 0 || index >= list.length) return false
    if (target < 0 || target >= list.length) return false
    const moved = list.splice(index, 1)
    list.splice(target, 0, ...moved)
    draft.downloads = list
    return true
  }

  return {
    draft,
    errors,
    isValid,
    canSave,
    publishIssues,
    isDirty,
    changedFields,
    touched,
    loadFrom,
    resetToBaseline,
    markSaved,
    draftTags,
    addTag,
    removeTag,
    canAddTag,
    draftAltTitles,
    addAltTitle,
    removeAltTitle,
    canAddAltTitle,
    draftVocabulary,
    addVocabularyValue,
    removeVocabularyValue,
    setPrimaryGameplayType,
    canAddVocabulary,
    draftRelations,
    relationRowErrors,
    relationIssues,
    canAddRelation,
    addRelation,
    removeRelation,
    searchRelationTargets,
    draftImages,
    canAddImage,
    setImage,
    clearImage,
    addImages,
    removeImage,
    moveImage,
    draftDownloads,
    downloadErrors,
    canAddDownload,
    addDownload,
    removeDownload,
    moveDownload,
  }
}

/* ---------------------------------------------------------------------------
   provide / inject
   ---------------------------------------------------------------------------
   草稿是「每次编辑会话一个实例」。编辑页的各个子组件（标签录入、以后的图片 / 下载）
   必须拿到**同一个**实例 —— 在子组件里再调一次 useAdminGameDraft() 会造出第二个实例，
   两边各改各的，表现为「编辑了但草稿没变」，而且完全静默、极难排查。
   --------------------------------------------------------------------------- */
export const ADMIN_GAME_DRAFT_KEY: InjectionKey<AdminGameDraftAPI> = Symbol('admin-game-draft')

/** 在编辑器根组件里调用：创建草稿实例并向下提供 */
export function provideAdminGameDraft(): AdminGameDraftAPI {
  const api = useAdminGameDraft()
  provide(ADMIN_GAME_DRAFT_KEY, api)
  return api
}

/** 在编辑器子组件里调用：取用同一份草稿实例 */
export function useAdminGameDraftContext(): AdminGameDraftAPI {
  const api = inject(ADMIN_GAME_DRAFT_KEY)
  if (!api) {
    throw new Error(
      'useAdminGameDraftContext() 必须在 provideAdminGameDraft() 的子组件树内使用',
    )
  }
  return api
}
