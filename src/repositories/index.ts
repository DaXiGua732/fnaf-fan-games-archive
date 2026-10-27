/**
 * ============================================================================
 * 仓储的装配处 —— **唯一的实例化点**
 * ============================================================================
 * 有两份「当前生效的仓储」，因为前台和后台的数据来源**本来就不是同一个东西**：
 *
 *   publicGameRepository  前台用。以**构建期快照**（`db.json`）为首屏与离线兜底；
 *                         生产环境在公开页挂载 / 重新可见时，从数据仓同步一次最新数据。
 *                         快照保证「断网也能打开」，同步保证「后台改完不用等构建」。
 *
 *   adminGameRepository   后台用。**未登录时**与前台同一份（本地）；
 *                         **登录后**换成远程数据仓（GitHub）。
 *
 * 【为什么不共用一份】后台写的是 GitHub；前台如果只读构建期快照，两者之间就隔着
 * 一次重新构建。现在的做法是「快照兜底 + 运行时同步」：公开页挂载时把快照换成
 * 数据仓的最新内容（失败保留快照），因此后台改完不需要等构建。
 *
 * ⚠️ 每份都必须**只实例化一次**。本地仓储内部持有那一份内存数据，
 * 多实例化一次就会出现两份互不相干的数据。
 * ============================================================================
 */
import { shallowRef } from 'vue'
import { REQUESTS_REMOTE_ENABLED, SUPABASE_ANON_KEY, SUPABASE_URL } from '../config/requests'
import type { AdminGame } from '../types/admin'
import type { ResourceRequestRepository } from '../types/resourceRequest'
import type { GameRepository } from './gameRepository'
import { createGitHubGameRepository } from './githubGameRepository'
import { createLocalGameRepository } from './localGameRepository'
import { createLocalResourceRequestRepository } from './localResourceRequestRepository'
import { createSupabaseResourceRequestRepository } from './supabaseResourceRequestRepository'
import { normalizeTaxonomy } from '../utils/taxonomy'

/** 前台的数据源（也是未登录后台的数据源） */
export const publicGameRepository: GameRepository = createLocalGameRepository()

/**
 * 后台当前生效的仓储。
 *
 * 用 `shallowRef` 而不是普通变量，是为了让 `useAdminGames` 里的 computed
 * 能在切换实现时自动重算 —— 否则登录之后页面还停在本地数据上。
 */
export const adminGameRepository = shallowRef<GameRepository>(publicGameRepository)

/** 登录成功后切到远程数据仓。`getAccount` 在写入时取当下账号，随每次写入打进 `updatedBy` */
export function useRemoteAdminRepository(token: string, getAccount: () => string): void {
  adminGameRepository.value = createGitHubGameRepository({ token, account: getAccount })
}

/** 登出后回到本地仓 */
export function useLocalAdminRepository(): void {
  adminGameRepository.value = publicGameRepository
}

/**
 * 催资源仓储 —— **全站只实例化这一次**。
 *
 * 配置了 Supabase（URL + anon public key）就走全站共享；
 * 否则走本机模式。两种实现满足同一个接口，上层组件不关心数据在哪。
 */
export const resourceRequestRepository: ResourceRequestRepository = REQUESTS_REMOTE_ENABLED
  ? createSupabaseResourceRequestRepository({
      url: SUPABASE_URL,
      anonKey: SUPABASE_ANON_KEY,
    })
  : createLocalResourceRequestRepository()

/* ---------------------------------------------------------------------------
   前台数据同步
   ---------------------------------------------------------------------------
   构建期快照是为了「断网也能打开」，但它有个副作用：后台改完数据后，
   前台要等下一次构建才会变。两个页面之间看起来就像「数据不同步」。

   这里在**生产构建**里补一次运行时同步：从数据仓取最新 db.json，
   整表替换内存目录。失败就继续用快照 —— 静态站不能因为数据仓挂了而白屏。
   开发 / UI 测试不执行，避免网络让断言不稳定。
   --------------------------------------------------------------------------- */
const PUBLIC_CATALOG_URL = 'https://daxigua732.github.io/fnaf-fan-games-data/db.json'
/** 5 秒内重复进入公开页不重复请求 */
const HYDRATE_THROTTLE_MS = 5_000
const HYDRATE_TIMEOUT_MS = 5_000

let lastHydratedAt = 0
let hydrating: Promise<void> | null = null

/**
 * 把前台的构建期快照换成数据仓里的最新数据。
 * 幂等、失败静默；同一时刻只会有一次请求。
 */
export function hydratePublicCatalog(): Promise<void> {
  if (!import.meta.env.PROD) return Promise.resolve()
  if (hydrating) return hydrating
  if (Date.now() - lastHydratedAt < HYDRATE_THROTTLE_MS) return Promise.resolve()

  hydrating = (async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HYDRATE_TIMEOUT_MS)
    try {
      // 加时间戳绕过 GitHub Pages 的 10 分钟缓存
      const response = await fetch(`${PUBLIC_CATALOG_URL}?t=${Date.now()}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!response.ok) return

      const payload = (await response.json()) as {
        games?: unknown
        taxonomy?: unknown
      }
      if (!Array.isArray(payload.games)) return

      // 数据仓还没有 taxonomy 字段时保留当前词表（通常是内置初始词表）；
      // 存在但结构不可用时同样保留，不能因为一次坏数据把本地词表清空。
      const normalized =
        payload.taxonomy === undefined ? null : normalizeTaxonomy(payload.taxonomy)

      publicGameRepository.hydrate(
        payload.games as AdminGame[],
        normalized?.present && normalized.usable ? normalized.taxonomy : undefined,
      )
      lastHydratedAt = Date.now()
    } catch {
      // 数据仓不可达时保持构建期快照：前台必须仍能离线打开
    } finally {
      clearTimeout(timer)
    }
  })().finally(() => {
    hydrating = null
  })

  return hydrating
}

export type { GameRepository } from './gameRepository'
