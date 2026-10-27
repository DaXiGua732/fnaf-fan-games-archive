/**
 * ============================================================================
 * useVocabulary —— 分类词表的后台深模块
 * ============================================================================
 * 玩法类型 / 机制 / 平台三套词表共用同一套读写规则，所以收敛在这里：
 *
 *   1. 从当前仓储（本地或远程）读词表与作品目录；
 *   2. 计算每个词条的使用次数（全部作品 / 前台可见作品）；
 *   3. 提供创建、改名、改定义、合并、删除保护（调用仓储，不自己拼写数据）；
 *   4. 提供「未分类作品数」「跨集合同名」这类管理提示；
 *   5. 搜索也不在 `.vue` 里手写 `.filter()`。
 *
 * 【为什么不放在 useAdminGames】
 *   useAdminGames 已经是 1000+ 行的目录查询模块；词表是另一条数据线（虽然同文件），
 *   混进去会让「列表查询」与「词表维护」互相牵连。两个模块都依赖同一个仓储，
 *   仓储切换（登录 / 登出）通过 `adminGameRepository` 的响应式引用自动生效。
 *
 * 【可见口径】
 *   「前台可见」严格复用 `isPubliclyVisible()`，不在这里另写一份判据 ——
 *   否则草稿作品用过的词条会出现在公开筛选里，点了却没有结果。
 * ============================================================================
 */
import { computed, type ComputedRef } from 'vue'
import { adminGameRepository } from '../repositories'
import type { AdminGame, StorageKind } from '../types/admin'
import {
  VOCABULARY_COLLECTIONS,
  VOCABULARY_LABELS,
  type Taxonomy,
  type VocabularyCollection,
  type VocabularyEntry,
  type VocabularyEntryInput,
  type VocabularyEntryPatch,
  type VocabularyMutationResult,
} from '../types/taxonomy'
import {
  countUnclassifiedGames,
  countVocabularyUsage,
  findVocabularyNameConflicts,
  resolveVocabularyEntry,
} from '../utils/taxonomy'
import { isPubliclyVisible } from './useGameLibrary'

/** 后台词表页的一行：词条 + 两个口径的使用次数 */
export interface VocabularyEntryRow {
  entry: VocabularyEntry
  /** 使用该词条的全部作品数（含草稿 / 下线 / 归档） */
  all: number
  /** 其中前台可见的作品数 */
  visible: number
}

export interface VocabularyAPI {
  /** 当前词表（随仓储切换更新） */
  taxonomy: ComputedRef<Taxonomy>
  /** 数据源里的词表结构问题 */
  issues: ComputedRef<string[]>
  /** 写入实际落在哪里（本地 / 远程 / 内存） */
  storage: ComputedRef<StorageKind>
  /** 三个分区的词条与使用次数，顺序即词表顺序 */
  sections: ComputedRef<Record<VocabularyCollection, VocabularyEntryRow[]>>
  /** 全部作品数（分母） */
  totalGames: ComputedRef<number>
  /** 还没有标注玩法类型的作品数 */
  unclassifiedGames: ComputedRef<number>
  /** 每个分区里没有被任何作品使用的词条数 */
  unused: ComputedRef<Record<VocabularyCollection, number>>
  /** 按 id 找一行（合并 / 删除确认的标题用） */
  findRow: (
    collection: VocabularyCollection,
    id: string,
  ) => VocabularyEntryRow | undefined
  /** 同一分区里除某个词条以外的行（合并目标候选） */
  otherRows: (
    collection: VocabularyCollection,
    excludeId: string,
  ) => VocabularyEntryRow[]

  /** 分区标签（玩法类型 / 游戏机制 / 支持平台） */
  label: (collection: VocabularyCollection) => string
  /** 按关键词过滤某个分区（名称 + 定义，大小写不敏感） */
  search: (collection: VocabularyCollection, needle: string) => VocabularyEntryRow[]
  /** 跨集合同名（只提示，不阻止保存） */
  nameConflicts: (collection: VocabularyCollection, name: string) => VocabularyCollection[]
  /** 某分区里还没被选中的词条（用于「+ 添加」列表） */
  availableEntries: (
    collection: VocabularyCollection,
    selected: string[],
  ) => VocabularyEntry[]
  /** 词条 id / 名称 → 展示名；失效引用原样返回，方便管理员看到问题值 */
  entryName: (collection: VocabularyCollection, value: string) => string

  createEntry: (
    collection: VocabularyCollection,
    input: VocabularyEntryInput,
  ) => Promise<VocabularyEntry>
  updateEntry: (
    collection: VocabularyCollection,
    id: string,
    patch: VocabularyEntryPatch,
  ) => Promise<VocabularyEntry>
  mergeEntries: (
    collection: VocabularyCollection,
    sourceId: string,
    targetId: string,
  ) => Promise<VocabularyMutationResult>
  deleteEntry: (
    collection: VocabularyCollection,
    id: string,
    options?: { removeFromGames?: boolean },
  ) => Promise<VocabularyMutationResult>
}

export function useVocabulary(): VocabularyAPI {
  const taxonomy = computed<Taxonomy>(() => adminGameRepository.value.taxonomy.value)
  const issues = computed<string[]>(() => adminGameRepository.value.taxonomyIssues.value)
  const storage = computed<StorageKind>(() => adminGameRepository.value.storage.value)
  const allGames = computed<AdminGame[]>(() => adminGameRepository.value.games.value)
  const visibleGames = computed<AdminGame[]>(() => allGames.value.filter(isPubliclyVisible))

  const sections = computed<Record<VocabularyCollection, VocabularyEntryRow[]>>(() => {
    const current = taxonomy.value
    const games = allGames.value
    const visible = visibleGames.value

    const result = {} as Record<VocabularyCollection, VocabularyEntryRow[]>
    for (const collection of VOCABULARY_COLLECTIONS) {
      const allCounts = countVocabularyUsage(games, current, collection)
      const visibleCounts = countVocabularyUsage(visible, current, collection)
      result[collection] = current[collection].map((entry) => ({
        entry,
        all: allCounts.get(entry.id) ?? 0,
        visible: visibleCounts.get(entry.id) ?? 0,
      }))
    }
    return result
  })

  const totalGames = computed(() => allGames.value.length)
  const unclassifiedGames = computed(() => countUnclassifiedGames(allGames.value))
  const unused = computed<Record<VocabularyCollection, number>>(() => {
    const result = {} as Record<VocabularyCollection, number>
    for (const collection of VOCABULARY_COLLECTIONS) {
      result[collection] = sections.value[collection].filter((row) => row.all === 0).length
    }
    return result
  })

  function findRow(
    collection: VocabularyCollection,
    id: string,
  ): VocabularyEntryRow | undefined {
    return sections.value[collection].find((row) => row.entry.id === id)
  }

  function otherRows(
    collection: VocabularyCollection,
    excludeId: string,
  ): VocabularyEntryRow[] {
    return sections.value[collection].filter((row) => row.entry.id !== excludeId)
  }

  function label(collection: VocabularyCollection): string {
    return VOCABULARY_LABELS[collection]
  }

  function search(
    collection: VocabularyCollection,
    needle: string,
  ): VocabularyEntryRow[] {
    const key = needle.trim().toLocaleLowerCase()
    const rows = sections.value[collection]
    if (!key) return rows
    return rows.filter(
      (row) =>
        row.entry.name.toLocaleLowerCase().includes(key) ||
        row.entry.description.toLocaleLowerCase().includes(key),
    )
  }

  function nameConflicts(
    collection: VocabularyCollection,
    name: string,
  ): VocabularyCollection[] {
    return findVocabularyNameConflicts(taxonomy.value, collection, name)
  }
  function availableEntries(
    collection: VocabularyCollection,
    selected: string[],
  ): VocabularyEntry[] {
    const chosen = new Set(
      selected.map(
        (value) => resolveVocabularyEntry(taxonomy.value, collection, value)?.id ?? value,
      ),
    )
    return taxonomy.value[collection].filter((entry) => !chosen.has(entry.id))
  }

  function entryName(collection: VocabularyCollection, value: string): string {
    return resolveVocabularyEntry(taxonomy.value, collection, value)?.name ?? value
  }

  function createEntry(
    collection: VocabularyCollection,
    input: VocabularyEntryInput,
  ): Promise<VocabularyEntry> {
    return adminGameRepository.value.createVocabularyEntry(collection, input)
  }

  function updateEntry(
    collection: VocabularyCollection,
    id: string,
    patch: VocabularyEntryPatch,
  ): Promise<VocabularyEntry> {
    return adminGameRepository.value.updateVocabularyEntry(collection, id, patch)
  }

  function mergeEntries(
    collection: VocabularyCollection,
    sourceId: string,
    targetId: string,
  ): Promise<VocabularyMutationResult> {
    return adminGameRepository.value.mergeVocabularyEntries(
      collection,
      sourceId,
      targetId,
    )
  }

  function deleteEntry(
    collection: VocabularyCollection,
    id: string,
    options: { removeFromGames?: boolean } = {},
  ): Promise<VocabularyMutationResult> {
    return adminGameRepository.value.deleteVocabularyEntry(collection, id, options)
  }

  return {
    taxonomy,
    issues,
    storage,
    sections,
    totalGames,
    unclassifiedGames,
    unused,
    findRow,
    otherRows,
    label,
    search,
    nameConflicts,
    availableEntries,
    entryName,
    createEntry,
    updateEntry,
    mergeEntries,
    deleteEntry,
  }
}
