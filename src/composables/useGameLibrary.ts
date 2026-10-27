/**
 * ============================================================================
 * useGameLibrary —— 深模块 (Deep Module)
 * ============================================================================
 * 设计原则：向视图层隐藏数据的复杂性，只暴露极简接口。
 *
 * 本模块内部负责：
 *   1. 通过 `GameRepository` 读数据，并**只保留前台可见的条目**
 *      （已上线且未归档 —— 见 isPubliclyVisible）
 *   2. 全字段模糊搜索（标题 / 其他名称 / 作者 / 系列 / 引擎 / 标签 / 玩法 / 机制 / 平台）
 *   3. 八维筛选：作者 / 年份 / 系列 / 玩法 / 机制 / 标签 / 平台 / 引擎；
 *      同维多值 OR、跨维 AND，可与搜索叠加
 *   4. 排序（热度 / 评分 / 首字母 / 年份）
 *   5. 分页
 *   6. 模拟异步加载状态
 *   7. 运行时同步（refreshCatalog）—— 公开页挂载 / 重新可见时用数据仓最新数据
 *      替换构建期快照；失败保留快照，保证断网也能打开
 *
 * 【铁律】视图组件 (.vue) 只允许调用 setFilter / setSearchQuery 并遍历 games，
 *         绝对禁止在 .vue 文件内手写 .filter() / .sort() 逻辑。
 * ============================================================================
 */
import { computed, reactive, ref, watch } from 'vue'
import { hydratePublicCatalog, publicGameRepository } from '../repositories'
import type { AdminGame } from '../types/admin'
import type { Game } from '../types/game'
import type { Taxonomy, VocabularyCollection } from '../types/taxonomy'
import {
  FILTER_CATEGORY_LABELS,
  FILTER_DIMENSIONS,
  filterQuerySignature,
  parseFilterQuery,
  serializeFilterQuery,
  type FilterCategory,
  type FilterUrlOptions,
} from '../utils/filterUrl'
import {
  resolveVocabularyEntry,
  vocabularyOptionsForGames,
} from '../utils/taxonomy'
import { isPubliclyVisible } from '../utils/visibility'

export { isPubliclyVisible }
export type { FilterCategory }

export type SortKey = 'recommended' | 'views' | 'score' | 'title' | 'year'

/** 排序键顺序即 UI 展示顺序；URL 解析用它判断合法性 */
export const SORT_KEYS: SortKey[] = ['recommended', 'views', 'score', 'title', 'year']
/** 默认排序：URL 不写它，详情页的索引链接也回到它 */
export const DEFAULT_SORT: SortKey = 'views'
/** URL 纯函数需要的上下文 */
const URL_OPTIONS: FilterUrlOptions = { sorts: SORT_KEYS, defaultSort: DEFAULT_SORT }

/** 每页条数默认值（12 列网格 / 3 列 = 4 行） */
const DEFAULT_PAGE_SIZE = 12
/** 模拟网络往返耗时，用于驱动 UI 的骨架屏状态 */
const DEFAULT_LATENCY = 160

/* ---------------------------------------------------------------------------
   数据源：通过仓储拿（Phase 11 起）

   前台只依赖 `GameRepository` 接口，**不知道数据存在哪里** ——
   仓储换成本地持久化或远程库时，这里一行都不用改。

   读取用的是仓储的响应式快照 `games`，而不是 `listGames()`：
   UI 需要**同步**拿到数据才能渲染，而仓储的读写接口是异步的。
   两边读的必须是同一份快照 —— 后台改了状态，前台必须立刻反映出来。
   --------------------------------------------------------------------------- */

/**
 * 前台可见的条目。
 *
 * 前台的一切都从这里派生 —— 列表、搜索、筛选、分页、详情页，
 * 以及过滤面板里的「可用作者 / 年份 / 系列」。
 * 任何一处绕开它，就会出现「筛选选项里有某个作者，点了却是空的」这类裂缝。
 */
const VISIBLE = computed(() => publicGameRepository.games.value.filter(isPubliclyVisible))

const COMPARATORS: Record<SortKey, (a: Game, b: Game) => number> = {
  // 推荐：先把「推荐」标记的排前面，再按后台填写的手动权重降序；
  // 权重相同才退回热度，最后用标题保证顺序确定。
  recommended: (a, b) =>
    Number(Boolean(b.featured)) - Number(Boolean(a.featured)) ||
    (b.sortOrder ?? 0) - (a.sortOrder ?? 0) ||
    b.metrics.fakeViews - a.metrics.fakeViews ||
    a.title.localeCompare(b.title, 'en'),
  views: (a, b) => b.metrics.fakeViews - a.metrics.fakeViews,
  score: (a, b) => b.metrics.score - a.metrics.score,
  title: (a, b) => a.title.localeCompare(b.title, 'en'),
  year: (a, b) => b.releaseYear - a.releaseYear,
}
/**
 * 分类词表（玩法类型 / 机制 / 平台）。
 *
 * 前台只读；词条名由 `vocabularyName()` 统一解析（先 id、再名称），
 * 这样历史数据里直接写平台名的记录也能显示，而不是露出一个 id。
 */
const TAXONOMY = computed<Taxonomy>(() => publicGameRepository.taxonomy.value)

export function vocabularyName(
  collection: VocabularyCollection,
  value: string,
): string {
  return resolveVocabularyEntry(TAXONOMY.value, collection, value)?.name ?? value
}

interface QueryState {
  search: string
  author: string[]
  year: string[]
  series: string[]
  gameplay: string[]
  mechanic: string[]
  tag: string[]
  platform: string[]
  engine: string[]
  sort: SortKey
  page: number
  pageSize: number
}

/* ---------------------------------------------------------------------------
   内部状态（模块级单例，全应用共享）
   --------------------------------------------------------------------------- */
const query = reactive<QueryState>({
  search: '',
  author: [],
  year: [],
  series: [],
  gameplay: [],
  mechanic: [],
  tag: [],
  platform: [],
  engine: [],
  sort: DEFAULT_SORT,
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
})

/** 数组字段必须复制：query 与 applied 共享同一个数组会让「已生效」随输入漂移 */
function snapshot(state: QueryState): QueryState {
  const copy = { ...state }
  for (const category of FILTER_DIMENSIONS) copy[category] = [...state[category]]
  return copy
}

/** 已生效的查询快照 —— 与 query 之间隔着一段模拟延迟，制造真实的异步感 */
const applied = ref<QueryState>(snapshot(query))
const isLoading = ref(true)

let loadTimer: ReturnType<typeof setTimeout> | null = null
/** 页码夹紧时不要反过来再触发一次模拟加载 */
let muted = false

function commit(): void {
  applied.value = snapshot(query)

  // 过滤后总量变小 → URL 里的页码可能已经不合法。夹紧到末页，
  // 否则页面会停在一个永远空白的页上（刷新后尤其明显）。
  const pages = Math.max(
    1,
    Math.ceil(filtered.value.length / Math.max(1, applied.value.pageSize)),
  )
  const clamped = Math.min(Math.max(1, query.page), pages)
  if (clamped !== query.page) {
    muted = true
    query.page = clamped
    muted = false
    applied.value = snapshot(query)
  }
  isLoading.value = false
}

function scheduleLoad(latency = DEFAULT_LATENCY): void {
  isLoading.value = true
  if (loadTimer !== null) clearTimeout(loadTimer)
  loadTimer = setTimeout(commit, latency)
}

watch(query, () => {
  if (!muted) scheduleLoad()
}, { deep: true })

// 首次加载
scheduleLoad()

/* ---------------------------------------------------------------------------
   派生数据：过滤 → 排序 → 分页
   --------------------------------------------------------------------------- */
/** 同维度多选 = OR；没有选中任何值 = 不限制 */
function matchesText(selected: string[], value: string): boolean {
  return selected.length === 0 || selected.includes(value)
}

/**
 * 分类词条匹配：作品上可能存 id，也可能是历史遗留的名称写法。
 * 两边都解析成稳定 id 再比较，避免「改名后筛选突然失效」。
 */
function matchesVocabulary(
  collection: VocabularyCollection,
  selected: string[],
  values: string[],
): boolean {
  if (selected.length === 0) return true
  if (values.length === 0) return false

  const ids = new Set(
    values.map(
      (value) => resolveVocabularyEntry(TAXONOMY.value, collection, value)?.id ?? value,
    ),
  )
  return selected.some(
    (value) =>
      ids.has(resolveVocabularyEntry(TAXONOMY.value, collection, value)?.id ?? value),
  )
}

/**
 * 一条作品的搜索文本。
 *
 * 除标准字段外，还要包含词表解析后的**展示名**：
 * 用户搜「传统守夜式」时，数据里存的是 `traditional-night-watch`。
 */
function gameSearchText(game: AdminGame): string {
  return [
    game.title,
    ...(game.altTitles ?? []),
    game.author,
    game.ipSeries,
    game.engine,
    ...(game.tags ?? []),
    ...(game.gameplayTypes ?? []).map((value) => vocabularyName('gameplayTypes', value)),
    ...(game.mechanics ?? []).map((value) => vocabularyName('mechanics', value)),
    ...(game.platforms ?? []).map((value) => vocabularyName('platforms', value)),
  ].join(' ')
}

const SEARCH_INDEX = computed(() => {
  const index = new Map<string, string>()
  for (const game of VISIBLE.value) {
    index.set(game.id, gameSearchText(game).toLowerCase())
  }
  return index
})
const filtered = computed<Game[]>(() => {
  const q = applied.value
  const needle = q.search.trim().toLowerCase()

  const hit = VISIBLE.value.filter((game) => {
    if (!matchesText(q.author, game.author)) return false
    if (q.year.length > 0 && !q.year.includes(String(game.releaseYear))) return false
    if (!matchesText(q.series, game.ipSeries)) return false
    if (!matchesText(q.engine, game.engine)) return false
    if (q.tag.length > 0 && !q.tag.some((tag) => (game.tags ?? []).includes(tag))) {
      return false
    }
    if (!matchesVocabulary('gameplayTypes', q.gameplay, game.gameplayTypes ?? [])) {
      return false
    }
    if (!matchesVocabulary('mechanics', q.mechanic, game.mechanics ?? [])) {
      return false
    }
    if (!matchesVocabulary('platforms', q.platform, game.platforms ?? [])) {
      return false
    }
    if (needle) {
      const haystack = SEARCH_INDEX.value.get(game.id) ?? ''
      if (!haystack.includes(needle)) return false
    }
    return true
  })

  return hit.sort(COMPARATORS[q.sort])
})
const total = computed(() => filtered.value.length)

const totalPages = computed(() =>
  Math.max(1, Math.ceil(total.value / Math.max(1, applied.value.pageSize))),
)

/** 当前页（已夹紧到合法区间，避免过滤后页码越界出现空白页） */
const currentPage = computed(() => Math.min(applied.value.page, totalPages.value))

/** 过滤 + 排序后的最终展示数据（已分页切片） */
const games = computed<Game[]>(() => {
  const size = Math.max(1, applied.value.pageSize)
  const start = (currentPage.value - 1) * size
  return filtered.value.slice(start, start + size)
})

/* ---------------------------------------------------------------------------
   元数据：供 UI 渲染过滤面板
   基于**前台可见**的数据集 —— 只基于全量会让「草稿作品的作者」出现在筛选里，
   而那个选项永远命中 0 条。
   --------------------------------------------------------------------------- */
const availableAuthors = computed(() =>
  [...new Set(VISIBLE.value.map((g) => g.author))].sort((a, b) => a.localeCompare(b, 'en')),
)
const availableYears = computed(() =>
  [...new Set(VISIBLE.value.map((g) => g.releaseYear))].sort((a, b) => b - a),
)
const availableSeries = computed(() =>
  [...new Set(VISIBLE.value.map((g) => g.ipSeries))].sort((a, b) => a.localeCompare(b, 'zh')),
)
const availableGameplayTypes = computed(() =>
  vocabularyOptionsForGames(TAXONOMY.value, VISIBLE.value, 'gameplayTypes'),
)
const availableMechanics = computed(() =>
  vocabularyOptionsForGames(TAXONOMY.value, VISIBLE.value, 'mechanics'),
)
const availablePlatforms = computed(() =>
  vocabularyOptionsForGames(TAXONOMY.value, VISIBLE.value, 'platforms'),
)
const availableTags = computed(() =>
  [...new Set(VISIBLE.value.flatMap((game) => game.tags ?? []))].sort((a, b) =>
    a.localeCompare(b, 'zh'),
  ),
)
const availableEngines = computed(() =>
  [...new Set(VISIBLE.value.map((game) => game.engine))].sort((a, b) =>
    a.localeCompare(b, 'en'),
  ),
)

/** 目录总条目数 —— **只算前台可见的**（首页「当前可浏览」用它） */
const catalogSize = computed(() => VISIBLE.value.length)

/**
 * 前台可见列表的只读副本。
 *
 * 给催资源等新功能做「站内是否已有」判断用。仍然是同一个可见性判据，
 * 不另开一条会漏出草稿 / 已归档作品的数据通道。
 */
const visibleGames = computed<Game[]>(() => VISIBLE.value)

/**
 * 只搜索**公开可见**作品，供催资源对话框的「站内已有？」建议使用。
 *
 * 刻意不复用当前筛选条件，也不改动 query：这是对话框里的独立预检，
 * 用户关掉弹窗后首页的游戏库仍应保持原样。
 */
function searchGames(term: string, limit = 6): Game[] {
  const needle = term.trim().toLowerCase()
  if (!needle) return []

  const size = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 6
  if (size === 0) return []

  return VISIBLE.value
    .filter((game) => {
      const haystack = `${gameSearchText(game)} ${game.shortDescription ?? ''}`.toLowerCase()
      return haystack.includes(needle)
    })
    .sort((a, b) => a.title.localeCompare(b.title, 'en') || a.id.localeCompare(b.id))
    .slice(0, size)
}

/**
 * 数据里的**全部条目**（含下线 / 草稿 / 归档）。
 *
 * 首页的「收录作品」用它：后台显示的收录数就是它。
 * 只显示可见数会让人误以为「后台 7 条、首页少了」—— 其实少掉的是没有对外的条目。
 */
const totalSize = computed(() => publicGameRepository.games.value.length)

/* ---------------------------------------------------------------------------
   供 UI 读取的当前筛选状态（反映用户「意图」，即时更新，不受延迟影响）
   --------------------------------------------------------------------------- */
const activeFilters = computed(() => ({
  search: query.search,
  author: query.author,
  year: query.year,
  series: query.series,
  gameplay: query.gameplay,
  mechanic: query.mechanic,
  tag: query.tag,
  platform: query.platform,
  engine: query.engine,
  sort: query.sort,
  page: query.page,
  pageSize: query.pageSize,
}))

export interface ActiveFilterChip {
  category: FilterCategory
  categoryLabel: string
  /** URL / 状态里的原始值（词条场景是 id） */
  value: string
  /** 展示文案（词条场景是词条名） */
  label: string
  /** 该条件在当前可见目录里是否仍然成立 */
  valid: boolean
}

function filterChipLabel(category: FilterCategory, value: string): string {
  if (category === 'gameplay') return vocabularyName('gameplayTypes', value)
  if (category === 'mechanic') return vocabularyName('mechanics', value)
  if (category === 'platform') return vocabularyName('platforms', value)
  return value
}

/**
 * 「这个条件还成立吗」。
 *
 * 词条场景只要求词表里还有这个 id —— 词条存在但暂时没有可见作品，
 * 是一个「空结果」，不是「失效」；真正的失效是被删除 / 合并掉的 id。
 */
function isKnownFilterValue(category: FilterCategory, value: string): boolean {
  if (category === 'author') return availableAuthors.value.includes(value)
  if (category === 'year') return availableYears.value.some((year) => String(year) === value)
  if (category === 'series') return availableSeries.value.includes(value)
  if (category === 'engine') return availableEngines.value.includes(value)
  if (category === 'tag') return availableTags.value.includes(value)
  if (category === 'gameplay') {
    return Boolean(resolveVocabularyEntry(TAXONOMY.value, 'gameplayTypes', value))
  }
  if (category === 'mechanic') {
    return Boolean(resolveVocabularyEntry(TAXONOMY.value, 'mechanics', value))
  }
  return Boolean(resolveVocabularyEntry(TAXONOMY.value, 'platforms', value))
}

const activeFilterChips = computed<ActiveFilterChip[]>(() => {
  const chips: ActiveFilterChip[] = []
  for (const category of FILTER_DIMENSIONS) {
    for (const value of query[category]) {
      chips.push({
        category,
        categoryLabel: FILTER_CATEGORY_LABELS[category],
        value,
        label: filterChipLabel(category, value),
        valid: isKnownFilterValue(category, value),
      })
    }
  }
  return chips
})

const invalidFilterChips = computed(() =>
  activeFilterChips.value.filter((chip) => !chip.valid),
)

const hasActiveFilters = computed(
  () =>
    query.search.trim() !== '' ||
    FILTER_DIMENSIONS.some((category) => query[category].length > 0),
)

/* ---------------------------------------------------------------------------
   操作方法
   --------------------------------------------------------------------------- */
function toggleInList(list: string[], value: string): string[] {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value]
}

function setSearchQuery(value: string): void {
  if (query.search === value) return
  query.search = value
  query.page = 1
}

/** 同维度多选 toggle（OR），跨维度自动 AND */
function setFilter(category: FilterCategory, value: string): void {
  const normalized = value.trim()
  if (!normalized) return
  if (category === 'year' && !/^\d{4}$/.test(normalized)) return

  query[category] = toggleInList(query[category], normalized)
  query.page = 1
}

/**
 * 详情页的索引入口：清空其他条件，只保留被点击的这一项。
 * 页码回到 1、排序回到默认值，避免把上一次浏览留下的状态带进来。
 */
function setIndexFilter(category: FilterCategory, value: string): void {
  const normalized = value.trim()
  if (!normalized) return
  clearFilters()
  query[category] = [normalized]
  query.page = 1
  query.sort = DEFAULT_SORT
}

function removeFilterValue(category: FilterCategory, value: string): void {
  query[category] = query[category].filter((item) => item !== value)
  query.page = 1
}

function clearFilters(): void {
  query.search = ''
  for (const category of FILTER_DIMENSIONS) query[category] = []
  query.page = 1
}

/** 只移除已经失效的条件，保留仍然成立的部分 */
function clearInvalidFilters(): void {
  for (const category of FILTER_DIMENSIONS) {
    query[category] = query[category].filter((value) =>
      isKnownFilterValue(category, value),
    )
  }
  query.page = 1
}

function setSortBy(key: SortKey): void {
  if (query.sort === key) return
  query.sort = key
  query.page = 1
}

function setPage(page: number): void {
  query.page = Math.min(Math.max(1, Math.floor(page)), totalPages.value)
}

function setPageSize(size: number): void {
  query.pageSize = Math.max(1, Math.floor(size))
  query.page = 1
}

function isFilterActive(category: FilterCategory, value: string): boolean {
  return query[category].includes(value)
}

/**
 * 用 URL query 覆盖当前状态。
 *
 * 只覆盖已知维度与合法排序 / 页码；未知参数丢弃，非法值回退默认。
 * 页面（Home）只调用它一次，避免「URL → 状态 → URL」循环。
 */
function hydrateFromQuery(raw: Record<string, unknown>): void {
  const parsed = parseFilterQuery(raw, URL_OPTIONS)
  query.search = parsed.search
  for (const category of FILTER_DIMENSIONS) query[category] = parsed[category]
  query.sort = parsed.sort as SortKey
  query.page = parsed.page
}

/** 当前状态 → route.query；默认值不写 */
function toQueryParams(): Record<string, string | string[]> {
  return serializeFilterQuery(activeFilters.value, URL_OPTIONS)
}

/** 任意 query 的归一化签名，供 Home 判断「URL 是否已经与状态一致」 */
function querySignature(raw: Record<string, unknown>): string {
  return filterQuerySignature(raw, URL_OPTIONS)
}

/**
 * 按 id 取单条。
 *
 * **只在前台可见集合里找** —— 于是草稿 / 已下线 / 已归档的作品，其详情页 URL
 * 与「不存在的 id」表现一致（走前台的 404 分支）。这是计划书 §Phase 10
 * 推荐的初版策略：前台完全隐藏。
 */
function getGameById(id: string): Game | undefined {
  return VISIBLE.value.find((game) => game.id === id)
}

/**
 * 与数据仓同步一次。
 * 生产构建才会真正发请求；开发 / 测试直接返回。失败时保留构建期快照。
 * 公开页挂载时调用它，解决「后台改完、前台还是旧数据」的割裂。
 */
function refreshCatalog(): Promise<void> {
  return hydratePublicCatalog()
}

/* ---------------------------------------------------------------------------
   对外暴露的极简接口
   --------------------------------------------------------------------------- */
export interface GameLibraryAPI {
  // —— 状态 ——
  /** 前台可见条目数（已上线且未归档） */
  catalogSize: typeof catalogSize
  /** 前台可见的完整列表（供其他前台功能做匹配，不分页） */
  visibleGames: typeof visibleGames
  /** 数据里的全部条目数（含下线 / 草稿 / 归档） */
  totalSize: typeof totalSize
  /** 过滤、排序、分页后的最终展示数据 */
  games: typeof games
  /** 过滤 + 排序后但未分页的完整结果（调试 / 计数用） */
  filtered: typeof filtered
  isLoading: typeof isLoading
  total: typeof total
  totalPages: typeof totalPages
  currentPage: typeof currentPage

  // —— 元数据（供 UI 渲染过滤面板）——
  availableAuthors: typeof availableAuthors
  availableYears: typeof availableYears
  availableSeries: typeof availableSeries
  availableGameplayTypes: typeof availableGameplayTypes
  availableMechanics: typeof availableMechanics
  availablePlatforms: typeof availablePlatforms
  availableTags: typeof availableTags
  availableEngines: typeof availableEngines
  /** 分类词表（玩法类型 / 机制 / 平台），只读 */
  taxonomy: typeof TAXONOMY
  /** 词条 id / 名称 → 展示名；无法解析时原样返回 */
  vocabularyName: typeof vocabularyName

  // —— 当前筛选状态 ——
  activeFilters: typeof activeFilters
  hasActiveFilters: typeof hasActiveFilters
  /** 当前筛选条件的摘要（含是否仍然成立） */
  activeFilterChips: typeof activeFilterChips
  /** 已经失效的条件（词条被删除 / 值不在可见目录里） */
  invalidFilterChips: typeof invalidFilterChips

  // —— 操作方法 ——
  setSearchQuery: typeof setSearchQuery
  setFilter: typeof setFilter
  clearFilters: typeof clearFilters
  setSortBy: typeof setSortBy
  setPage: typeof setPage
  setPageSize: typeof setPageSize
  isFilterActive: typeof isFilterActive
  setIndexFilter: typeof setIndexFilter
  removeFilterValue: typeof removeFilterValue
  clearInvalidFilters: typeof clearInvalidFilters
  hydrateFromQuery: typeof hydrateFromQuery
  toQueryParams: typeof toQueryParams
  querySignature: typeof querySignature
  getGameById: typeof getGameById
  searchGames: typeof searchGames
  refreshCatalog: typeof refreshCatalog
}

export function useGameLibrary(): GameLibraryAPI {
  return {
    catalogSize,
    totalSize,
    visibleGames,
    games,
    filtered,
    isLoading,
    total,
    totalPages,
    currentPage,

    availableAuthors,
    availableYears,
    availableSeries,
    availableGameplayTypes,
    availableMechanics,
    availablePlatforms,
    availableTags,
    availableEngines,
    taxonomy: TAXONOMY,
    vocabularyName,

    activeFilters,
    hasActiveFilters,
    activeFilterChips,
    invalidFilterChips,

    setSearchQuery,
    setFilter,
    clearFilters,
    setSortBy,
    setPage,
    setPageSize,
    isFilterActive,
    setIndexFilter,
    removeFilterValue,
    clearInvalidFilters,
    hydrateFromQuery,
    toQueryParams,
    querySignature,
    getGameById,
    searchGames,
    refreshCatalog,
  }
}
