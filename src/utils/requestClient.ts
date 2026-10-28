/**
 * 催资源的「浏览器身份」
 *
 * 这不是安全机制，只是去重身份：同一浏览器对同一条请求只计一票，
 * 因此一个随机 UUID 就够。它会被写进 localStorage，也会发给 Supabase，
 * **不要**在这里放任何个人信息。
 */
import { getLocalStorage } from './localStorage'

export const REQUEST_CLIENT_ID_KEY = 'fnaf-archive:request-client:v1'

let sessionClientId: string | null = null

function isValidClientId(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value !== value.trim()) return false
  return value.length >= 8 && value.length <= 64
}

function createClientId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // 非安全上下文 / 老浏览器：走下面的兜底
  }
  const time = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 10).padEnd(8, '0')
  return `client-${time}-${random}`
}

/**
 * 读取或生成本机 client id。
 *
 * - localStorage 可用：持久化，刷新后仍是同一身份；
 * - 不可用 / 配额写满：退化为**本页有效**的 session id，至少本页内去重仍然成立。
 */
export function getRequestClientId(): string {
  if (sessionClientId) return sessionClientId

  const storage = getLocalStorage()
  if (storage) {
    try {
      const stored = storage.getItem(REQUEST_CLIENT_ID_KEY)
      if (isValidClientId(stored)) {
        sessionClientId = stored
        return stored
      }
    } catch {
      // 读失败就生成新的，不阻断用户操作
    }
  }

  const generated = createClientId()
  sessionClientId = generated

  if (storage) {
    try {
      storage.setItem(REQUEST_CLIENT_ID_KEY, generated)
      // 两个全新标签页同时首次使用可能各自生成一个 ID（localStorage 没有 CAS）。
      // 写入后回读一次，尽量让后写者与先写者收敛到同一个身份；
      // 极端并发窗口仍可能留下两个 ID，但这是去重身份、不是安全边界。
      const confirmed = storage.getItem(REQUEST_CLIENT_ID_KEY)
      if (isValidClientId(confirmed)) sessionClientId = confirmed
    } catch {
      // 写不进去也不影响当前页面使用
    }
  }

  return sessionClientId
}
