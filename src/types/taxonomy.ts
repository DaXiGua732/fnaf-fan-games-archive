/**
 * 分类词表 —— 玩法类型 / 游戏机制 / 平台
 *
 * 三套词表共用同一个模型：
 *   - `id`          稳定的机器标识，创建后不改；作品只存它
 *   - `name`        后台与前台展示的名称，可以改；改名不碰作品
 *   - `description` 简短定义，帮助管理员判断该归入哪一类
 *
 * 词表与自由标签的区别：
 *   - 词表是**受控**的，有独立词条、使用次数、重复防护和删除保护；
 *   - 自由标签只是作品上的字符串，由现有「标签与作者」页按派生列表管理。
 *
 * 数据落点：数据仓 `db.json` 顶层的 `taxonomy` 字段（与 `games` 并列）。
 */
export type VocabularyCollection = 'gameplayTypes' | 'mechanics' | 'platforms'

export interface VocabularyEntry {
  id: string
  name: string
  description: string
}

export interface Taxonomy {
  gameplayTypes: VocabularyEntry[]
  mechanics: VocabularyEntry[]
  platforms: VocabularyEntry[]
  /**
   * 保留未来扩展字段（例如 version、aliases 等）。
   * 旧代码序列化整个对象时不能把新字段静默抹掉。
   */
  [key: string]: unknown
}

/** 固定顺序：后台分区、公开筛选组与测试共用，避免三处各写一遍 */
export const VOCABULARY_COLLECTIONS: VocabularyCollection[] = [
  'gameplayTypes',
  'mechanics',
  'platforms',
]

/** 词表分区文案（Record 保证联合类型增删成员时编译报错） */
export const VOCABULARY_LABELS: Record<VocabularyCollection, string> = {
  gameplayTypes: '玩法类型',
  mechanics: '游戏机制',
  platforms: '支持平台',
}

/** 词条被多少作品使用；`visible` 只统计前台可见作品 */
export interface VocabularyUsage {
  all: number
  visible: number
}

export const VOCABULARY_LIMITS = {
  /** 显示名称最大长度 */
  nameMax: 40,
  /** 简短定义最大长度 */
  descriptionMax: 160,
  /** 稳定标识最大长度 */
  idMax: 60,
} as const

/**
 * 单条作品最多可挂多少个词条。
 *
 * 与 `VOCABULARY_LIMITS`（词条自身的名称 / 定义长度）不同，这里限制的是
 * **作品与词条的挂接数量**。上限的意义是让分类保持可用：
 * 一款作品挂 20 个机制，机制筛选就失去区分度。
 *
 * `Record<VocabularyCollection, number>` 保证新增集合时编译器会提醒补上限。
 */
export const GAME_VOCABULARY_LIMITS: Record<VocabularyCollection, number> = {
  /** 玩法类型：第一项是主要玩法，第二、三项用于混合玩法 */
  gameplayTypes: 3,
  /** 机制：具体系统 / 动作，数量本来就多 */
  mechanics: 12,
  /** 平台：条目少，正常作品不会超过这个数 */
  platforms: 8,
}

/** 新建词条的输入。id 省略时由名称自动生成 */
export interface VocabularyEntryInput {
  id?: string
  name: string
  description?: string
}

/** 改名 / 改定义；id 不可改 */
export interface VocabularyEntryPatch {
  name?: string
  description?: string
}

/** 合并 / 删除可能同时改动作品，返回实际受影响的条数 */
export interface VocabularyMutationResult {
  taxonomy: Taxonomy
  affectedGames: number
}

/**
 * 词表归一化结果。
 *
 * - `present=false`：数据里根本没有 taxonomy（或整块不是对象），已回退初始词表。
 * - `usable=false`：taxonomy 是对象，但至少一个集合缺失或不是数组。
 *   这种「半块」词表不能拿去覆盖现有词表 —— 否则一次坏数据会把公开筛选清空。
 *   回退初始词表的场景 `usable` 为 true（初始词表本身是可用的）。
 */
export interface TaxonomyNormalizationResult {
  taxonomy: Taxonomy
  issues: string[]
  present: boolean
  usable: boolean
}
