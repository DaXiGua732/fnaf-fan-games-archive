/**
 * ============================================================================
 * useGameLibrary —— 深模块 (Deep Module)
 * ============================================================================
 * 设计原则：向视图层隐藏数据的复杂性，只暴露极简接口。
 *
 * 本模块内部负责：
 *   1. 加载 db.json（单一事实来源）
 *   2. 全字段模糊搜索（标题 / 作者 / 系列 / 引擎）
 *   3. 作者 × 年份 × 系列 三向交叉过滤（组内单选切换，组间 AND）
 *   4. 排序（热度 / 评分 / 首字母 / 年份）
 *   5. 分页
 *   6. 模拟异步加载状态
 *
 * 【铁律】视图组件 (.vue) 只允许调用 setFilter / setSearchQuery 并遍历 games，
 *         绝对禁止在 .vue 文件内手写 .filter() / .sort() 逻辑。
 * ============================================================================
 */
import { computed, reactive, ref, watch } from 'vue'
import rawDb from '../data/db.json'
import type { Game } from '../types/game'

export type FilterCategory = 'author' | 'year' | 'series'
export type SortKey = 'views' | 'score' | 'title' | 'year'

/** 每页条数默认值（12 列网格 / 3 列 = 4 行） */
const DEFAULT_PAGE_SIZE = 12
/** 模拟网络往返耗时，用于驱动 UI 的骨架屏状态 */
const DEFAULT_LATENCY = 160

/* ---------------------------------------------------------------------------
   数据源：模块加载时一次性读入，视图层永远看不到这一步
   --------------------------------------------------------------------------- */
const ALL_GAMES: Game[] = rawDb.games as Game[]

const COMPARATORS: Record<SortKey, (a: Game, b: Game) => number> = {
  views: (a, b) => b.metrics.fakeViews - a.metrics.fakeViews,
  score: (a, b) => b.metrics.score - a.metrics.score,
  title: (a, b) => a.title.localeCompare(b.title, 'en'),
  year: (a, b) => b.releaseYear - a.releaseYear,
}

interface QueryState {
  search: string
  author: string | null
  year: number | null
  series: string | null
  sort: SortKey
  page: number
  pageSize: number
}

/* ---------------------------------------------------------------------------
   内部状态（模块级单例，全应用共享）
   --------------------------------------------------------------------------- */
const query = reactive<QueryState>({
  search: '',
  author: null,
  year: null,
  series: null,
  sort: 'views',
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
})

/** 已生效的查询快照 —— 与 query 之间隔着一段模拟延迟，制造真实的异步感 */
const applied = ref<QueryState>({ ...query })
const isLoading = ref(true)

let loadTimer: ReturnType<typeof setTimeout> | null = null

function commit(): void {
  applied.value = { ...query }
  isLoading.value = false
}

function scheduleLoad(latency = DEFAULT_LATENCY): void {
  isLoading.value = true
  if (loadTimer !== null) clearTimeout(loadTimer)
  loadTimer = setTimeout(commit, latency)
}

watch(query, () => scheduleLoad(), { deep: true })

// 首次加载
scheduleLoad()

/* ---------------------------------------------------------------------------
   派生数据：过滤 → 排序 → 分页
   --------------------------------------------------------------------------- */
const filtered = computed<Game[]>(() => {
  const q = applied.value
  const needle = q.search.trim().toLowerCase()

  const hit = ALL_GAMES.filter((game) => {
    if (q.author !== null && game.author !== q.author) return false
    if (q.year !== null && game.releaseYear !== q.year) return false
    if (q.series !== null && game.ipSeries !== q.series) return false
    if (needle) {
      const haystack = `${game.title} ${game.author} ${game.ipSeries} ${game.engine}`.toLowerCase()
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
   元数据：供 UI 渲染过滤面板（基于全量数据集，保证选项不会消失）
   --------------------------------------------------------------------------- */
const availableAuthors = computed(() =>
  [...new Set(ALL_GAMES.map((g) => g.author))].sort((a, b) => a.localeCompare(b, 'en')),
)
const availableYears = computed(() =>
  [...new Set(ALL_GAMES.map((g) => g.releaseYear))].sort((a, b) => b - a),
)
const availableSeries = computed(() =>
  [...new Set(ALL_GAMES.map((g) => g.ipSeries))].sort((a, b) => a.localeCompare(b, 'zh')),
)

/* ---------------------------------------------------------------------------
   供 UI 读取的当前筛选状态（反映用户「意图」，即时更新，不受延迟影响）
   --------------------------------------------------------------------------- */
const activeFilters = computed(() => ({
  search: query.search,
  author: query.author,
  year: query.year,
  series: query.series,
  sort: query.sort,
  page: query.page,
  pageSize: query.pageSize,
}))

const hasActiveFilters = computed(
  () =>
    query.search.trim() !== '' ||
    query.author !== null ||
    query.year !== null ||
    query.series !== null,
)

/* ---------------------------------------------------------------------------
   操作方法
   --------------------------------------------------------------------------- */
function setSearchQuery(value: string): void {
  if (query.search === value) return
  query.search = value
  query.page = 1
}

function setFilter(category: FilterCategory, value: string): void {
  if (category === 'author') {
    query.author = query.author === value ? null : value
  } else if (category === 'series') {
    query.series = query.series === value ? null : value
  } else {
    const year = Number(value)
    if (Number.isNaN(year)) return
    query.year = query.year === year ? null : year
  }
  query.page = 1
}

function clearFilters(): void {
  query.search = ''
  query.author = null
  query.year = null
  query.series = null
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
  if (category === 'author') return query.author === value
  if (category === 'series') return query.series === value
  return query.year === Number(value)
}

function getGameById(id: string): Game | undefined {
  return ALL_GAMES.find((game) => game.id === id)
}

/* ---------------------------------------------------------------------------
   对外暴露的极简接口
   --------------------------------------------------------------------------- */
export interface GameLibraryAPI {
  // —— 状态 ——
  /** 目录总条目数（不随筛选变化，供首页统计信息使用） */
  catalogSize: number
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

  // —— 当前筛选状态 ——
  activeFilters: typeof activeFilters
  hasActiveFilters: typeof hasActiveFilters

  // —— 操作方法 ——
  setSearchQuery: typeof setSearchQuery
  setFilter: typeof setFilter
  clearFilters: typeof clearFilters
  setSortBy: typeof setSortBy
  setPage: typeof setPage
  setPageSize: typeof setPageSize
  isFilterActive: typeof isFilterActive
  getGameById: typeof getGameById
}

export function useGameLibrary(): GameLibraryAPI {
  return {
    catalogSize: ALL_GAMES.length,
    games,
    filtered,
    isLoading,
    total,
    totalPages,
    currentPage,

    availableAuthors,
    availableYears,
    availableSeries,

    activeFilters,
    hasActiveFilters,

    setSearchQuery,
    setFilter,
    clearFilters,
    setSortBy,
    setPage,
    setPageSize,
    isFilterActive,
    getGameById,
  }
}
