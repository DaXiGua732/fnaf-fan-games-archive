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
import { applyPatch, createGameFrom } from '../utils/gameFactory'
import { validateGameRelations, validateRelationInput } from '../utils/relations'
import {
  createVocabularyEntryIn,
  deleteVocabularyEntryIn,
  mergeVocabularyEntriesIn,
  normalizeTaxonomy,
  updateVocabularyEntryIn,
} from '../utils/taxonomy'
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

/** 出厂数据（db.json）—— 只在首次访问与「恢复出厂」时用 */
function seedCatalog(): AdminGame[] {
  return normalizeGames(structuredClone(db.games) as Game[])
}

/** 出厂词表：数据仓快照里有且结构可用就用它，否则用内置初始词表 */
function seedTaxonomy(): Taxonomy {
  const raw = (db as { taxonomy?: unknown }).taxonomy
  const result = normalizeTaxonomy(raw)
  return result.usable ? result.taxonomy : initialTaxonomy()
}

/**
 * 取浏览器提供的 localStorage。
 * SSR（Node）与隐私模式下没有 —— 那时返回 null，仓储降级为「只写内存」。
 */
function resolveBrowserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // 某些隐私模式下单纯**访问** localStorage 就会抛错
    return null
  }
}

/**
 * 读取本机存档。
 * **任何异常都退回出厂数据** —— 一份损坏的存档绝不能让站点变成空白，
 * 那比丢失改动严重得多。
 */
function readStoredCatalog(backend: StorageLike | null): AdminGame[] | null {
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
    // 走一遍归一化：存档可能是旧版本写的，缺的字段要补齐
    return normalizeGames(parsed as Game[])
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
  // 传了就用传进来的（测试注入），没传就取浏览器环境
  const backend = options.storage === undefined ? resolveBrowserStorage() : options.storage

  const store = ref<AdminGame[]>(readStoredCatalog(backend) ?? seedCatalog())
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
      backend.setItem(STORAGE_KEY, JSON.stringify(store.value))
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

  function indexOf(id: string): number {
    return store.value.findIndex((game) => game.id === id)
  }

  async function updateGame(id: string, patch: GamePatch): Promise<AdminGame> {
    const index = indexOf(id)
    // 显式抛错，不静默新建一条 —— 否则「保存」失败会被伪装成成功
    if (index === -1) throw new Error(`updateGame: 找不到 id 为「${id}」的条目`)

    if (patch.relations !== undefined) {
      const inputErrors = validateRelationInput(patch.relations, id)
      if (inputErrors.length > 0) throw new Error(inputErrors.join('；'))
    }

    const updated = applyPatch(store.value[index], patch)
    const games = store.value.map((game, i) => (i === index ? updated : game))

    // 只校验本次提交的关系。历史数据里可能有悬挂 / 双端关系；
    // 它们不应阻塞标题、状态、归档等无关字段的保存 —— 否则该作品会永远改不动。
    if (patch.relations !== undefined) {
      const relationErrors = validateGameRelations(games, updated)
      if (relationErrors.length > 0) throw new Error(relationErrors.join('；'))
    }

    store.value = games
    persist()
    return updated
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
      store.value = normalizeGames(JSON.parse(JSON.stringify(games)))
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
      const created = createGameFrom(store.value, patch)

      // id 是创建时才生成的，所以关系校验必须放在它之后：
      // 否则「目标正好等于新 id」会被 normalizeRelations 当作自关联静默丢弃。
      if (patch.relations !== undefined) {
        const inputErrors = validateRelationInput(patch.relations, created.id)
        if (inputErrors.length > 0) throw new Error(inputErrors.join('；'))
      }

      const games = [created, ...store.value]
      const relationErrors = validateGameRelations(games, created)
      if (relationErrors.length > 0) throw new Error(relationErrors.join('；'))

      store.value = games
      persist()
      return created
    },

    updateGame,

    async deleteGame(id) {
      const index = indexOf(id)
      if (index === -1) return false

      // 与远程仓一致：删除作品时在同一操作里清理所有指向它的关系
      store.value = store.value
        .filter((_, i) => i !== index)
        .map((game) => {
          const relations = game.relations ?? []
          const kept = relations.filter((relation) => relation.targetId !== id)
          return kept.length === relations.length ? game : { ...game, relations: kept }
        })
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
      store.value = seedCatalog()
      taxonomyStore.value = seedTaxonomy()
      taxonomyIssues.value = []
      persist()
    },

    async createVocabularyEntry(collection, input) {
      const result = createVocabularyEntryIn(taxonomyStore.value, collection, input)
      taxonomyStore.value = result.taxonomy
      taxonomyIssues.value = []
      persist()
      return { ...result.entry }
    },

    async updateVocabularyEntry(collection, id, patch) {
      const result = updateVocabularyEntryIn(taxonomyStore.value, collection, id, patch)
      taxonomyStore.value = result.taxonomy
      taxonomyIssues.value = []
      persist()
      return { ...result.entry }
    },

    async mergeVocabularyEntries(collection, sourceId, targetId) {
      const result = mergeVocabularyEntriesIn(
        taxonomyStore.value,
        store.value,
        collection,
        sourceId,
        targetId,
      )
      taxonomyStore.value = result.taxonomy
      store.value = result.games
      taxonomyIssues.value = []
      persist()
      return { taxonomy: result.taxonomy, affectedGames: result.affectedGames }
    },

    async deleteVocabularyEntry(collection, id, options = {}) {
      const result = deleteVocabularyEntryIn(
        taxonomyStore.value,
        store.value,
        collection,
        id,
        options,
      )
      taxonomyStore.value = result.taxonomy
      store.value = result.games
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
