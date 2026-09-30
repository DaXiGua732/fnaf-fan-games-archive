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
 * 【这不是永久方案】它把改动存在**当前这台设备的这个浏览器**里 ——
 * 刷新不丢，但换台机器 / 换个浏览器 / 清掉浏览器数据就没了，
 * 更**不会**写回仓库里的 db.json。线上正式数据要等 Phase 13 / 14 接入远程库。
 * 这一点由 `storage` 如实暴露给 UI（见 `STORAGE_NOTICE`），绝不能含糊成「保存成功」。
 *
 * 【为什么前后台读同一份】Phase 10 要求「后台改状态 → 前台立刻受影响」。
 * 若各持一份快照，那只是两条并行数据，不叫联动。所以这里只实例化一次
 * （见 `src/repositories/index.ts`）。
 * ============================================================================
 */
import { computed, ref } from 'vue'
import db from '../data/db.json'
import type { AdminGame, GamePatch, StorageKind } from '../types/admin'
import type { Game } from '../types/game'
import { normalizeGames } from '../utils/gameDefaults'
import { applyPatch, createGameFrom } from '../utils/gameFactory'
import type { GameRepository } from './gameRepository'

/**
 * 本地存储的最小接口 —— 只用到这两个方法，所以测试可以注入一个假的。
 * 不直接用 `Storage` 类型，是为了不依赖 DOM 类型库、也避免把实现绑死在 localStorage 上。
 */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * 本地存档的键名。
 * 带版本号：将来数据形状变了，直接改成 v2 即可让旧存档自然失效，
 * 不需要写迁移代码。
 */
export const STORAGE_KEY = 'fnaf-archive:admin-catalog:v1'

/** 出厂数据（db.json）—— 只在首次访问与「恢复出厂」时用 */
function seedCatalog(): AdminGame[] {
  return normalizeGames(structuredClone(db.games) as Game[])
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

export function createLocalGameRepository(
  options: { storage?: StorageLike | null } = {},
): GameRepository {
  // 传了就用传进来的（测试注入），没传就取浏览器环境
  const backend = options.storage === undefined ? resolveBrowserStorage() : options.storage

  const store = ref<AdminGame[]>(readStoredCatalog(backend) ?? seedCatalog())

  /** 上一次落盘是否失败（配额满等）。失败就降级为「只写内存」，**不假装成功** */
  const persistFailed = ref(false)

  const storage = computed<StorageKind>(() =>
    backend && !persistFailed.value ? 'local' : 'memory',
  )

  /** 把当前内存数据写进本机存档 */
  function persist(): void {
    if (!backend) return
    try {
      backend.setItem(STORAGE_KEY, JSON.stringify(store.value))
      persistFailed.value = false
    } catch {
      // 配额满 / 隐私模式：写不进去**不能假装成功** ——
      // 降级 storage 为 memory，UI 会如实说「只写入了内存，刷新即丢」
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

    const updated = applyPatch(store.value[index], patch)
    store.value = store.value.map((game, i) => (i === index ? updated : game))
    persist()
    return updated
  }

  return {
    games: computed(() => store.value),
    storage,
    // 数据在构建期就打进来了，永远是就绪的
    ready: computed(() => true),
    error: computed(() => ''),
    // 本地数据本来就在手边，没有「重新拉取」这回事
    reload: async () => {},

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
      store.value = [created, ...store.value]
      persist()
      return created
    },

    updateGame,

    async deleteGame(id) {
      const index = indexOf(id)
      if (index === -1) return false
      store.value = store.value.filter((_, i) => i !== index)
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
      persist()
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
