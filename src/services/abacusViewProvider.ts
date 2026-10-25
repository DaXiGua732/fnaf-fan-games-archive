/**
 * ============================================================================
 * Abacus 浏览量 provider —— 免费、免注册、CORS 开放的公开计数服务
 * ============================================================================
 * 纯静态站没有自己的后端；详情页打开时向 Abacus 发一次 `/hit`（自增并返回新值），
 * 失败由 `trackView()` 静默降级为 db.json 的静态基数，页面永远不会被统计拖慢。
 *
 * 文档：https://v2.jasoncameron.dev/abacus/
 * - `/hit/:namespace/:key` 自增并返回 { value }，key 不存在时自动创建
 * - `/get/:namespace/:key` 只读；不存在时 404
 * - 免费、无需令牌；限流 30 次 / 10 秒 / IP，单次浏览只发 1 个请求
 *
 * 【为什么不自己存】任何自建写入都要把写权限放进公开前端，等于把数据仓交给所有人。
 * 计数是易失指标，放在公开计数服务里，坏了就退回静态基数，不影响站点。
 *
 * shortcut: `/hit` 自动建 key、不返回 admin key，因此**无法重置 / 删除**被刷的计数。
 * 需要可管理的计数时，改用 `/create` 预建 key，并把 admin key 存在数据仓之外。
 * ============================================================================
 */
import type { ViewProvider } from './viewCounter'

/** Abacus 对 key / namespace 的要求：3–64 位，只允许这些字符 */
const KEY_PATTERN = /^[A-Za-z0-9_.-]{3,64}$/
const DEFAULT_BASE_URL = 'https://abacus.jasoncameron.dev'
/** 统计失败必须快速降级，不能挂着「载入中…」 */
const DEFAULT_TIMEOUT_MS = 4_000

export interface AbacusViewProviderOptions {
  /** 全站唯一命名空间，建议用仓库名 / 域名 —— 避免和其他站点撞 key */
  namespace: string
  /** 测试注入用 */
  baseUrl?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export function createAbacusViewProvider(options: AbacusViewProviderOptions): ViewProvider {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const doFetch = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  async function call(action: 'get' | 'hit', gameId: string): Promise<number | null> {
    // 非法 id 不发请求：Abacus 会直接 400，既浪费一次限流额度也没有意义
    if (!KEY_PATTERN.test(gameId)) return null

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      // /hit 是 GET：浏览器 / CDN 缓存一次就等于少计一次浏览。
      // `cache: 'no-store'` 之外再加时间戳，防止中间的代理不认 fetch 的缓存指令。
      const url = `${baseUrl}/${action}/${options.namespace}/${gameId}?t=${Date.now()}`
      const response = await doFetch(url, {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })
      if (!response.ok) return null

      const body = (await response.json()) as { value?: unknown }
      const value = Number(body.value)
      return Number.isInteger(value) && value >= 0 ? value : null
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    id: 'abacus',
    read: (gameId) => call('get', gameId),
    increment: (gameId) => call('hit', gameId),
  }
}
