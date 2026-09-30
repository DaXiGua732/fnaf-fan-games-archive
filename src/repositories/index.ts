/**
 * ============================================================================
 * 仓储的装配处 —— **唯一的实例化点**
 * ============================================================================
 * 有两份「当前生效的仓储」，因为前台和后台的数据来源**本来就不是同一个东西**：
 *
 *   publicGameRepository  前台用。读**构建期快照**（`db.json`）+ 本机存档。
 *                         访客不需要登录、不发任何请求、断网也能看。
 *
 *   adminGameRepository   后台用。**未登录时**与前台同一份（本地）；
 *                         **登录后**换成远程数据仓（GitHub）。
 *
 * 【为什么不共用一份】Phase 10 曾让前后台共用同一份内存数据，来实现「改了立刻可见」。
 * 那在纯本地是对的，但换成远程之后就不成立了：后台写的是 GitHub，
 * 前台看到的是构建期快照 —— 两者之间隔着一次重新构建。这是静态站的固有性质，
 * 不是缺陷（提示条会如实告诉用户「约 1 分钟后前台可见」）。
 *
 * ⚠️ 每份都必须**只实例化一次**。本地仓储内部持有那一份内存数据，
 * 多实例化一次就会出现两份互不相干的数据。
 * ============================================================================
 */
import { shallowRef } from 'vue'
import type { GameRepository } from './gameRepository'
import { createGitHubGameRepository } from './githubGameRepository'
import { createLocalGameRepository } from './localGameRepository'

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

export type { GameRepository } from './gameRepository'
