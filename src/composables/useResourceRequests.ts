/**
 * ============================================================================
 * useResourceRequests —— 催资源的模块级单例
 * ============================================================================
 * 策略全部在 `createResourceRequestStore`；这里只做一次生产装配：
 * 当前仓储 + 本机存储 + 前台可见作品 + 浏览器去重身份。
 * 测试直接构造 store，不需要碰这个单例。
 * ============================================================================
 */
import { resourceRequestRepository } from '../repositories'
import { getLocalStorage } from '../utils/localStorage'
import { getRequestClientId } from '../utils/requestClient'
import { createResourceRequestStore, type ResourceRequestsAPI } from './resourceRequestStore'
import { useGameLibrary } from './useGameLibrary'

export type { ResourceRequestsAPI } from './resourceRequestStore'

let store: ResourceRequestsAPI | null = null

export function useResourceRequests(): ResourceRequestsAPI {
  if (store) return store

  const { visibleGames } = useGameLibrary()
  store = createResourceRequestStore({
    repository: resourceRequestRepository,
    storage: getLocalStorage(),
    visibleGames: () => visibleGames.value,
    clientId: getRequestClientId,
  })
  return store
}
