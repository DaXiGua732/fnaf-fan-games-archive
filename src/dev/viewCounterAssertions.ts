/**
 * 浏览量服务断言集（开发期工具）
 *
 * 由 `scripts/selftest.mts` 消费。所有 fetch 都是注入的桩 —— **不出网**，
 * 也不消耗 Abacus 的限流额度。
 *
 * 覆盖两件事：
 *   1. Abacus provider 的请求形状 / 响应解析 / 非法输入
 *   2. `trackView()` 的降级路径（自增失败读旧值、抛错 / 超时回静态基数）
 */
import type { Assertion } from './libraryAssertions'
import { createAbacusViewProvider } from '../services/abacusViewProvider'
import {
  getActiveProviderId,
  isRemoteViewEnabled,
  registerViewProvider,
  trackView,
  type ViewProvider,
} from '../services/viewCounter'

interface FetchCall {
  url: string
  init?: RequestInit
}

/** 记录请求、返回预置响应的 fetch 桩 */
function stubFetch(handler: (url: string, init?: RequestInit) => Response): {
  calls: FetchCall[]
  fetchImpl: typeof fetch
} {
  const calls: FetchCall[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    return handler(url, init)
  }) as typeof fetch
  return { calls, fetchImpl }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function runViewCounterAssertions(): Promise<Assertion[]> {
  const results: Assertion[] = []
  const check = (name: string, actual: unknown, expected: unknown): void => {
    const a = String(actual)
    const e = String(expected)
    results.push({ name, expected: e, actual: a, pass: a === e })
  }

  /* ------------------------- Abacus provider ------------------------- */
  {
    const { calls, fetchImpl } = stubFetch(() => json({ value: 7 }))
    const provider = createAbacusViewProvider({ namespace: 'test.ns', fetchImpl })
    check('Abacus · provider id', provider.id, 'abacus')
    check('Abacus · /hit 返回新值', await provider.increment('game-1'), 7)
    check(
      'Abacus · /hit 走对地址',
      calls[0]?.url.startsWith('https://abacus.jasoncameron.dev/hit/test.ns/game-1?t='),
      true,
    )
    check('Abacus · 请求绕过浏览器缓存', calls[0]?.init?.cache, 'no-store')
  }

  {
    const { calls, fetchImpl } = stubFetch(() => json({ value: 42 }))
    const provider = createAbacusViewProvider({ namespace: 'test.ns', fetchImpl })
    check('Abacus · /get 返回当前值', await provider.read('game-1'), 42)
    check(
      'Abacus · /get 走对地址',
      calls[0]?.url.includes('/get/test.ns/game-1?'),
      true,
    )
  }

  {
    const provider = createAbacusViewProvider({
      namespace: 'test.ns',
      fetchImpl: stubFetch(() => json({ error: 'Key not found' }, 404)).fetchImpl,
    })
    check('Abacus · 404 视为尚无记录', await provider.read('game-1'), null)
  }

  {
    const provider = createAbacusViewProvider({
      namespace: 'test.ns',
      fetchImpl: stubFetch(() => json({ error: 'boom' }, 500)).fetchImpl,
    })
    check('Abacus · 5xx 视为失败', await provider.increment('game-1'), null)
  }

  {
    const provider = createAbacusViewProvider({
      namespace: 'test.ns',
      fetchImpl: stubFetch(() => json({ value: 'not-a-number' })).fetchImpl,
    })
    check('Abacus · 非数字 value 视为失败', await provider.increment('game-1'), null)
  }

  {
    const { calls, fetchImpl } = stubFetch(() => json({ value: 1 }))
    const provider = createAbacusViewProvider({ namespace: 'test.ns', fetchImpl })
    check('Abacus · 过短 id 不发请求', await provider.increment('ab'), null)
    check('Abacus · 中文 id 不发请求', await provider.increment('中文作品'), null)
    check('Abacus · 超长 id 不发请求', await provider.increment('a'.repeat(65)), null)
    check('Abacus · 非法 id 的请求次数', calls.length, 0)
  }

  /* ------------------------- trackView 降级 ------------------------- */
  const remote: ViewProvider = {
    id: 'stub',
    increment: async () => 9,
    read: async () => null,
  }
  registerViewProvider(remote)
  check('注册后 isRemoteViewEnabled', isRemoteViewEnabled(), true)
  check('注册后 providerId 跟随 provider', getActiveProviderId(), 'stub')

  const hitOk = await trackView('game-1', 5)
  check('trackView · 自增成功走 remote', `${hitOk.count}/${hitOk.source}`, '9/remote')

  registerViewProvider({ id: 'stub', increment: async () => null, read: async () => 12 })
  const readBack = await trackView('game-1', 5)
  check('trackView · 自增失败时读旧值', `${readBack.count}/${readBack.source}`, '12/remote')

  registerViewProvider({
    id: 'stub',
    increment: async () => {
      throw new Error('service down')
    },
    read: async () => null,
  })
  const failed = await trackView('game-1', 5)
  check('trackView · 请求抛错降级为静态基数', `${failed.count}/${failed.source}`, '5/static')

  // 永不 resolve 的 fetch：验证超时后同样降级，而不是把页面挂在「载入中…」
  const hangingFetch = ((_: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    })) as typeof fetch
  registerViewProvider(
    createAbacusViewProvider({ namespace: 'test.ns', fetchImpl: hangingFetch, timeoutMs: 10 }),
  )
  const timedOut = await trackView('game-1', 5)
  check('trackView · 超时降级为静态基数', `${timedOut.count}/${timedOut.source}`, '5/static')

  registerViewProvider(null)
  check('未注册 provider 时 isRemoteViewEnabled', isRemoteViewEnabled(), false)
  const noProvider = await trackView('game-1', 5)
  check('trackView · 未注册 provider 用静态基数', `${noProvider.count}/${noProvider.source}`, '5/static')

  return results
}
