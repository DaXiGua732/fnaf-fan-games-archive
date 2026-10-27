/**
 * ============================================================================
 * filterUrl —— 首页筛选状态 ↔ URL query 的纯函数
 * ============================================================================
 * 为什么单独一层：
 *   - 刷新、复制链接、前进 / 后退都必须还原同一组筛选；把这套解析写在
 *     Home.vue 里会让「URL 语义」和「查询状态」互相耦合，也无法用纯函数断言。
 *   - 默认值（空搜索 / 默认排序 / 第 1 页 / 无条件）**不写进 URL**，
 *     否则每次进首页都会得到一个又长又没意义的地址。
 *
 * URL 约定：
 *   - `q`      搜索词
 *   - `sort`   排序键（等于默认值时省略）
 *   - `page`   页码（第 1 页省略）
 *   - 每个筛选维度用**重复参数**表示多选：
 *     `author` / `year` / `series` / `gameplay` / `mechanic` / `tag` / `platform` / `engine`
 *   - 同维度多值 = OR；不同维度 = AND（语义在 useGameLibrary 里执行）
 *   - 未知参数忽略；无效排序 / 页码回退默认值
 * ============================================================================
 */

/** 可筛选的维度。顺序即 URL 参数与索引摘要的展示顺序 */
export type FilterCategory =
  | 'author'
  | 'year'
  | 'series'
  | 'gameplay'
  | 'mechanic'
  | 'tag'
  | 'platform'
  | 'engine'

export const FILTER_DIMENSIONS: FilterCategory[] = [
  'author',
  'year',
  'series',
  'gameplay',
  'mechanic',
  'tag',
  'platform',
  'engine',
]

/** 摘要与 chip 的维度文案；`Record` 保证新增维度时编译器会提醒补文案 */
export const FILTER_CATEGORY_LABELS: Record<FilterCategory, string> = {
  author: '作者',
  year: '年份',
  series: 'IP 系列',
  gameplay: '玩法',
  mechanic: '机制',
  tag: '标签',
  platform: '平台',
  engine: '引擎',
}

/** URL 解析后的查询状态（`sort` 只做形状校验，合法性由调用方给定范围） */
export interface FilterQueryState {
  search: string
  sort: string
  page: number
  author: string[]
  year: string[]
  series: string[]
  gameplay: string[]
  mechanic: string[]
  tag: string[]
  platform: string[]
  engine: string[]
}

export interface FilterUrlOptions {
  /** 允许的排序键 */
  sorts: readonly string[]
  /** 默认排序键；等于它时不写进 URL */
  defaultSort: string
}

export function emptyFilterQuery(): FilterQueryState {
  return {
    search: '',
    sort: '',
    page: 1,
    author: [],
    year: [],
    series: [],
    gameplay: [],
    mechanic: [],
    tag: [],
    platform: [],
    engine: [],
  }
}

/**
 * 读取一个可能重复的 query 参数。
 * 去空、去重、保留首次出现的顺序 —— 顺序会影响索引摘要的展示。
 */
function readList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const text = item.trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push(text)
  }
  return result
}

function readPage(value: unknown): number {
  const text = Array.isArray(value) ? value[0] : value
  if (typeof text !== 'string' || !/^\d+$/.test(text.trim())) return 1
  const page = Number.parseInt(text, 10)
  return Number.isFinite(page) && page >= 1 ? page : 1
}

/** 解析原始 route.query。永远不会抛错，坏值一律回退默认值 */
export function parseFilterQuery(
  raw: Record<string, unknown>,
  options: FilterUrlOptions,
): FilterQueryState {
  const state = emptyFilterQuery()
  state.search = typeof raw.q === 'string' ? raw.q.trim() : ''

  const sort = typeof raw.sort === 'string' ? raw.sort.trim() : ''
  state.sort = options.sorts.includes(sort) ? sort : options.defaultSort
  state.page = readPage(raw.page)

  for (const category of FILTER_DIMENSIONS) {
    state[category] = readList(raw[category])
  }
  return state
}

/**
 * 序列化为 route.query 对象。
 * 默认值不写；多值保持数组（Vue Router 会输出重复参数）。
 */
export function serializeFilterQuery(
  state: FilterQueryState,
  options: FilterUrlOptions,
): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {}

  const search = state.search.trim()
  if (search) params.q = search
  if (state.sort !== options.defaultSort && options.sorts.includes(state.sort)) {
    params.sort = state.sort
  }

  const page = Math.max(1, Math.floor(state.page))
  if (page !== 1) params.page = String(page)

  for (const category of FILTER_DIMENSIONS) {
    const values = readList(state[category])
    if (values.length > 0) params[category] = values
  }
  return params
}

/**
 * 把任意 query 归一化成可比较的签名。
 * 用于「URL 与当前状态是否已经一致」的判断 —— 避免双向同步互相触发。
 */
export function filterQuerySignature(
  raw: Record<string, unknown>,
  options: FilterUrlOptions,
): string {
  return JSON.stringify(parseFilterQuery(raw, options))
}
