/**
 * ============================================================================
 * LocalGameRepository —— 本地实现
 * ============================================================================
 * 唯一读 `db.json` 的地方。数据流：
 *
 *   db.json（出厂数据）
 *        ↓ 首次访问、或本地存档损坏时读入
 *   浏览器 localStorage（本机存档）
 *        ↓
 *   内存中的那一份 store（前后台共用同一实例）
 *
 * 【这不是线上数据】它把改动存在**当前这台设备的这个浏览器**里 ——
 * 刷新不丢，但换台机器 / 换个浏览器 / 清掉浏览器数据就没了，也不会写回数据仓。
 * 登录后后台会切换到 `githubGameRepository`，那才是线上正式数据。
 * 本地模式由 `storage` 如实暴露给 UI（见 `STORAGE_NOTICE`），绝不能含糊成「保存成功」。
 *
 * 【为什么前后台读同一份】Phase 10 要求「后台改状态 → 前台立刻受影响」。
 * 若各持一份快照，那只是两条并行数据，不叫联动。所以这里只实例化一次
 * （见 `src/repositories/index.ts`）。
 * ============================================================================
 */
import { computed, ref } from 'vue'
import db from '../data/db.json'
import { initialTaxonomy } from '../config/taxonomy'
import type { AdminGame, GamePatch, StorageKind } from '../types/admin'
import type { Game } from '../types/game'
import type { Taxonomy, TaxonomyNormalizationResult } from '../types/taxonomy'
import { normalizeGames } from '../utils/gameDefaults'
import {
  buildVocabularyWritePatches,
  catalogIdentityErrorMessage,
  findCatalogIdentityIssues,
  removeRelationTarget,
} from '../utils/gamePersistence'
import { planCreateGame, planDeleteGame, planUpdateGame } from '../utils/gameWrite'
import { isRecord } from '../utils/guards'
import {
  createVocabularyEntryIn,
  deleteVocabularyEntryIn,
  mergeVocabularyEntriesIn,
  normalizeTaxonomy,
  updateVocabularyEntryIn,
} from '../utils/taxonomy'
import { getLocalStorage } from '../utils/localStorage'
import type { GameRepository } from './gameRepository'

/**
 * 本地存储的最小接口 —— 只用到这两个方法，所以测试可以注入一个假的。
 * 不直接用 `Storage` 类型，是为了不依赖 DOM 类型库、也避免把实现绑死在 localStorage 上。
 */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  /** 可选：写入失败时回滚「本来不存在的键」需要它 */
  removeItem?(key: string): void
}

/**
 * 本地存档的键名。
 * 带版本号：将来数据形状变了，直接改成 v2 即可让旧存档自然失效，
 * 不需要写迁移代码。
 */
export const STORAGE_KEY = 'fnaf-archive:admin-catalog:v1'

/**
 * 词表单独存一个 key，不改动现有作品存档的数组格式。
 * 这样旧浏览器里的 `admin-catalog:v1` 继续可读，不需要迁移。
 */
export const TAXONOMY_STORAGE_KEY = 'fnaf-archive:taxonomy:v1'

/** 一份目录的两个视角：UI 读归一化结果，持久化写「原始记录 + 显式改动」 */
interface CatalogState {
  games: AdminGame[]
  records: Map<string, Record<string, unknown>>
  /**
   * 记录身份问题（缺失 / 空白 / 非法 / 重复 id）。
   * 非空时**任何写入都要拒绝** —— 按 id 匹配原始记录已不可靠。
   */
  identityIssues: string[]
}

/** 原始记录按 id 索引；非法 / 重复 id 不进入映射（写入会被整体拒绝） */
function indexRecords(rawGames: unknown[]): Map<string, Record<string, unknown>> {
  const records = new Map<string, Record<string, unknown>>()
  const seen = new Set<string>()
  for (const entry of rawGames) {
    if (!isRecord(entry)) continue
    const id = entry.id
    if (typeof id !== 'string' || !id.trim() || id !== id.trim() || seen.has(id)) continue
    seen.add(id)
    // 键保持原始 id：`normalizeGame()` 也不改 id，持久化时才能命中对应记录
    records.set(id, entry)
  }
  return records
}

/** 出厂数据（db.json）—— 只在首次访问与「恢复出厂」时用 */
function seedCatalog(): CatalogState {
  const raw = structuredClone(db.games) as unknown[]
  return {
    games: normalizeGames(raw.filter(isRecord) as unknown as Game[]),
    records: indexRecords(raw),
    identityIssues: findCatalogIdentityIssues(raw),
  }
}

/** 归一化记录的直接落盘形态：新记录没有原始 JSON，只能整条写入 */
function recordOf(game: AdminGame): Record<string, unknown> {
  return { ...game } as unknown as Record<string, unknown>
}

/** 出厂词表：数据仓快照里有且结构可用就用它，否则用内置初始词表 */
function seedTaxonomy(): Taxonomy {
  const raw = (db as { taxonomy?: unknown }).taxonomy
  const result = normalizeTaxonomy(raw)
  return result.usable ? result.taxonomy : initialTaxonomy()
}

/**
 * 读取本机存档。
 * **任何异常都退回出厂数据** —— 一份损坏的存档绝不能让站点变成空白，
 * 那比丢失改动严重得多。
 */
function readStoredCatalog(backend: StorageLike | null): CatalogState | null {
  if (!backend) return null

  let raw: string | null = null
  try {
    raw = backend.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      console.warn('[localGameRepository] 本地存档不是数组，已退回出厂数据')
      return null
    }
    // 走一遍归一化：存档可能是旧版本写的，缺的字段要补齐。
    // 同时保留原始记录，写回时未编辑的作品不会被归一化结果覆盖。
    // 非对象记录无法归一化，但身份检查会让所有写入被拒绝，原始存档不会被改写。
    return {
      games: normalizeGames(parsed.filter(isRecord) as unknown as Game[]),
      records: indexRecords(parsed),
      identityIssues: findCatalogIdentityIssues(parsed),
    }
  } catch {
    console.warn('[localGameRepository] 本地存档解析失败，已退回出厂数据')
    return null
  }
}

/** 读取本机词表存档；损坏 / 不存在时返回 null，由调用方回退出厂词表 */
function readStoredTaxonomy(
  backend: StorageLike | null,
): { taxonomy: Taxonomy; issues: string[] } | null {
  if (!backend) return null

  let raw: string | null = null
  try {
    raw = backend.getItem(TAXONOMY_STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null

  try {
    const result: TaxonomyNormalizationResult = normalizeTaxonomy(JSON.parse(raw))
    if (!result.present) {
      return {
        taxonomy: result.taxonomy,
        issues: [...result.issues, '本机词表存档格式不可用，已使用内置初始词表'],
      }
    }
    if (!result.usable) {
      return {
        taxonomy: initialTaxonomy(),
        issues: [...result.issues, '本机词表存档缺集合或集合类型不对，已使用内置初始词表'],
      }
    }
    return { taxonomy: result.taxonomy, issues: result.issues }
  } catch {
    return {
      taxonomy: initialTaxonomy(),
      issues: ['本机词表存档解析失败，已使用内置初始词表'],
    }
  }
}

export function createLocalGameRepository(
  options: { storage?: StorageLike | null } = {},
): GameRepository {
  const backend = options.storage === undefined ? getLocalStorage() : options.storage

  const storedCatalog = readStoredCatalog(backend)
  const initial = storedCatalog ?? seedCatalog()
  const store = ref<AdminGame[]>(initial.games)
  /**
   * 持久化视角：id → 最近一次写出的原始记录。
   * `store` 是归一化数据（UI 用），本机存档写的是「原始记录 + 显式改动」，
   * 这样普通编辑不会顺手清掉未编辑作品上的历史异常关系。
   */
  const records = initial.records
  /** 当前数据源的记录身份问题；非空时所有目录写入都必须拒绝（reset 除外） */
  let identityIssues = initial.identityIssues
  const storedTaxonomy = readStoredTaxonomy(backend)
  const taxonomyStore = ref<Taxonomy>(storedTaxonomy?.taxonomy ?? seedTaxonomy())
  const taxonomyIssues = ref<string[]>(storedTaxonomy?.issues ?? [])

  /** 上一次落盘是否失败（配额满等）。失败就降级为「只写内存」，**不假装成功** */
  const persistFailed = ref(false)

  const storage = computed<StorageKind>(() =>
    backend && !persistFailed.value ? 'local' : 'memory',
  )

  /**
   * 把当前内存数据写进本机存档。
   *
   * localStorage 没有跨 key 事务，所以这里做**尽力回滚**：
   * 第二个 key 写失败时，把已经写进去的第一个 key 恢复成旧值。
   * 回滚本身也可能因配额失败，此时仍降级为 memory 并如实告知用户 ——
   * 绝不把「只写了一半」说成保存成功。
   */
  function persist(): void {
    if (!backend) return

    // 读取旧值用于回滚；读不到就放弃对应 key 的回滚，而不是误删
    let previousGames: string | null | undefined
    let previousTaxonomy: string | null | undefined
    try {
      previousGames = backend.getItem(STORAGE_KEY)
      previousTaxonomy = backend.getItem(TAXONOMY_STORAGE_KEY)
    } catch {
      previousGames = undefined
      previousTaxonomy = undefined
    }

    const restore = (key: string, previous: string | null | undefined) => {
      if (previous === undefined) return
      if (previous === null) {
        backend.removeItem?.(key)
        return
      }
      backend.setItem(key, previous)
    }

    try {
      const persistedGames = store.value.map(
        (game) => records.get(game.id) ?? recordOf(game),
      )
      backend.setItem(STORAGE_KEY, JSON.stringify(persistedGames))
      backend.setItem(TAXONOMY_STORAGE_KEY, JSON.stringify(taxonomyStore.value))
      persistFailed.value = false
    } catch {
      // 配额满 / 隐私模式：写不进去**不能假装成功** ——
      // 降级 storage 为 memory，UI 会如实说「只写入了内存，刷新即丢」
      // 两个 key 独立回滚：一个失败不应阻止另一个恢复
      try {
        restore(STORAGE_KEY, previousGames)
      } catch {
        // 保持 memory 降级，下一次刷新会从可读到的旧值重建
      }
      try {
        restore(TAXONOMY_STORAGE_KEY, previousTaxonomy)
      } catch {
        // 同上
      }
      persistFailed.value = true
    }
  }

  /** 记录身份不可靠时，任何目录写入都必须在修改内存 / 本机存档之前失败 */
  function assertWritableCatalog(): void {
    if (identityIssues.length > 0) {
      throw new Error(catalogIdentityErrorMessage(identityIssues))
    }
  }

  /** 把词表操作产生的字段改动合并进原始记录；没有原始记录的新作品整条写入 */
  function applyRecordPatches(
    patches: Map<string, Record<string, unknown>>,
    games: readonly AdminGame[],
  ): void {
    const byId = new Map(games.map((game) => [game.id, game]))
    for (const [gameId, patch] of patches) {
      const original = records.get(gameId)
      const game = byId.get(gameId)
      if (original) records.set(gameId, { ...original, ...patch })
      else if (game) records.set(gameId, recordOf(game))
    }
  }

  async function updateGame(id: string, patch: GamePatch): Promise<AdminGame> {
    assertWritableCatalog()
    const plan = planUpdateGame(store.value, id, patch, { taxonomy: taxonomyStore.value })

    store.value = plan.games
    const original = records.get(id)
    records.set(
      id,
      original && plan.writePatch
        ? { ...original, ...plan.writePatch }
        : recordOf(plan.game),
    )
    persist()
    return plan.game
  }

  return {
    games: computed(() => store.value),
    taxonomy: computed(() => taxonomyStore.value),
    taxonomyIssues: computed(() => taxonomyIssues.value),
    storage,
    // 数据在构建期就打进来了，永远是就绪的
    ready: computed(() => true),
    error: computed(() => ''),
    // 本地数据本来就在手边，没有「重新拉取」这回事
    reload: async () => {},

    hydrate(games, taxonomy) {
      // 整表替换，但不 persist：下一次启动仍然从构建期快照 / 本机存档开始，
      // 再由前台同步逻辑拉到最新 —— 避免把「服务端数据」写成本机存档。
      // 用 JSON 深拷贝而不是 structuredClone：调用方可能传 Vue 响应式代理，
      // structuredClone 遇到 Proxy 会抛 DataCloneError。
      const cloned = JSON.parse(JSON.stringify(games)) as unknown[]
      identityIssues = findCatalogIdentityIssues(cloned)
      const nextGames = normalizeGames(cloned.filter(isRecord) as unknown as Game[])
      store.value = nextGames
      // hydrate 的数据本身就是归一化后的外部快照，没有可保留的原始 JSON；
      // 重建记录，避免下一次本地保存把过期的出厂原始数据写回去。
      records.clear()
      for (const [id, record] of indexRecords(cloned)) records.set(id, record)
      if (taxonomy) {
        const normalized = normalizeTaxonomy(taxonomy)
        taxonomyStore.value = normalized.taxonomy
        taxonomyIssues.value = normalized.issues
      }
    },

    async listGames() {
      // 返回副本：调用方改不动内部数据
      return store.value.map((game) => ({ ...game }))
    },

    async getGame(id) {
      const game = store.value.find((item) => item.id === id)
      return game ? { ...game } : undefined
    },

    async createGame(patch) {
      assertWritableCatalog()
      const plan = planCreateGame(store.value, patch, { taxonomy: taxonomyStore.value })
      store.value = plan.games
      records.set(plan.game.id, recordOf(plan.game))
      persist()
      return plan.game
    },

    updateGame,

    async deleteGame(id) {
      assertWritableCatalog()
      const plan = planDeleteGame(store.value, id)
      if (!plan) return false
      store.value = plan.games

      // 落盘走原始记录：只剔除指向目标的入边，其他历史异常关系保留。
      records.delete(id)
      for (const [gameId, record] of records) {
        const cleaned = removeRelationTarget(record, id)
        if (cleaned) records.set(gameId, cleaned)
      }
      persist()
      return true
    },

    async publishGame(id) {
      return updateGame(id, { status: 'published' })
    },

    async unpublishGame(id) {
      // 下线改状态、不删数据
      return updateGame(id, { status: 'offline' })
    },

    async resetToSeed() {
      const seed = seedCatalog()
      store.value = seed.games
      records.clear()
      for (const [id, record] of seed.records) records.set(id, record)
      identityIssues = seed.identityIssues
      taxonomyStore.value = seedTaxonomy()
      taxonomyIssues.value = []
      persist()
    },

    async createVocabularyEntry(collection, input) {
      assertWritableCatalog()
      const result = createVocabularyEntryIn(taxonomyStore.value, collection, input)
      taxonomyStore.value = result.taxonomy
      taxonomyIssues.value = []
      persist()
      return { ...result.entry }
    },

    async updateVocabularyEntry(collection, id, patch) {
      assertWritableCatalog()
      const result = updateVocabularyEntryIn(taxonomyStore.value, collection, id, patch)
      taxonomyStore.value = result.taxonomy
      taxonomyIssues.value = []
      persist()
      return { ...result.entry }
    },

    async mergeVocabularyEntries(collection, sourceId, targetId) {
      assertWritableCatalog()
      const result = mergeVocabularyEntriesIn(
        taxonomyStore.value,
        store.value,
        collection,
        sourceId,
        targetId,
      )
      taxonomyStore.value = result.taxonomy
      store.value = result.games
      applyRecordPatches(
        buildVocabularyWritePatches(result.games, result.affectedGameIds, collection),
        result.games,
      )
      taxonomyIssues.value = []
      persist()
      return { taxonomy: result.taxonomy, affectedGames: result.affectedGames }
    },

    async deleteVocabularyEntry(collection, id, options = {}) {
      assertWritableCatalog()
      const result = deleteVocabularyEntryIn(
        taxonomyStore.value,
        store.value,
        collection,
        id,
        options,
      )
      taxonomyStore.value = result.taxonomy
      store.value = result.games
      applyRecordPatches(
        buildVocabularyWritePatches(result.games, result.affectedGameIds, collection),
        result.games,
      )
      taxonomyIssues.value = []
      persist()
      return { taxonomy: result.taxonomy, affectedGames: result.affectedGames }
    },

    async uploadImage() {
      // 本地模式没有可写的远端。**明确抛错**，而不是给一个假地址 ——
      // 后者会让用户以为图片已经上传成功了。
      throw new Error('本地模式没有可写的远端，无法上传图片。登录后上传会直接进数据仓。')
    },

    async deleteImage() {
      throw new Error('本地模式没有可写的远端，无法删除图片。')
    },
  }
}
