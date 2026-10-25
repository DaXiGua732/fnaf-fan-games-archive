/**
 * ============================================================================
 * 浏览量服务 —— 适配器模式
 * ============================================================================
 * 当前状态：生产构建在 `main.ts` 注册 Abacus provider（实时计数）；
 * 开发 / 测试不注册，`trackView()` 直接返回 db.json 的 `metrics.fakeViews`。
 * 任何统计故障都会静默降级为静态基数 —— 页面永远不会因为计数服务而变慢或报错。
 *
 * 换后端只需实现下面的 ViewProvider 并在 `main.ts` 换一行注册，组件不用改。
 * ============================================================================
 */

export interface ViewProvider {
  /** 唯一标识，用于 UI 上标注数据来源 */
  id: string
  /** 读取当前浏览量；返回 null 表示该 gameId 尚无记录 */
  read: (gameId: string) => Promise<number | null>
  /** 自增一次并返回新值；返回 null 表示写入失败 */
  increment: (gameId: string) => Promise<number | null>
}

export interface ViewResult {
  count: number
  /** remote = 来自后端；static = 来自 db.json 的静态基数 */
  source: 'remote' | 'static'
}

let activeProvider: ViewProvider | null = null

export function registerViewProvider(provider: ViewProvider | null): void {
  activeProvider = provider
}

export function getActiveProviderId(): string {
  return activeProvider ? activeProvider.id : 'static'
}

export function isRemoteViewEnabled(): boolean {
  return activeProvider !== null
}

/**
 * 记录一次浏览：自增 + 读取。
 * 任何异常都会静默降级到静态基数 —— 统计失败绝不能影响页面可用性。
 */
export async function trackView(gameId: string, staticBase: number): Promise<ViewResult> {
  if (activeProvider === null) {
    return { count: staticBase, source: 'static' }
  }

  try {
    const incremented = await activeProvider.increment(gameId)
    if (incremented !== null) {
      return { count: incremented, source: 'remote' }
    }
    const current = await activeProvider.read(gameId)
    if (current !== null) {
      return { count: current, source: 'remote' }
    }
  } catch {
    // 后端不可用 / 网络异常 / 权限不足：静默降级
  }

  return { count: staticBase, source: 'static' }
}
