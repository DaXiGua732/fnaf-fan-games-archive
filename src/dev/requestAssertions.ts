/**
 * 催资源断言集（开发期工具）
 *
 * 可在 scripts/selftest.mts 或独立 .tmp 脚本中调用。仓储测试全部注入内存 storage / fetch 桩，
 * **不出网**；数据相关断言从当前目录自行推导，不写死具体作品。
 */
import { nextTick } from 'vue'
import { useGameLibrary } from '../composables/useGameLibrary'
import {
  RESOURCE_REQUEST_CACHE_KEY,
  createResourceRequestStore,
} from '../composables/resourceRequestStore'
import { createLocalResourceRequestRepository, RESOURCE_REQUEST_STORAGE_KEY } from '../repositories/localResourceRequestRepository'
import { createSupabaseResourceRequestRepository } from '../repositories/supabaseResourceRequestRepository'
import type { Game } from '../types/game'
import {
  RESOURCE_REQUEST_LIMITS,
  ResourceRequestError,
  type ResourceRequest,
  type ResourceRequestRepository,
} from '../types/resourceRequest'
import type { StorageLike } from '../repositories/localGameRepository'
import {
  isSameRequestTitle,
  matchExactGameForTitle,
  matchFulfilledGameForTitle,
  matchGameForTitle,
  normalizeRequestTitle,
} from '../utils/requestMatch'
import type { Assertion } from './libraryAssertions'

interface FetchCall {
  url: string
  init?: RequestInit
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

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

function memoryStorage(initial: Record<string, string> = {}): {
  storage: StorageLike
  map: Map<string, string>
} {
  const map = new Map(Object.entries(initial))
  return {
    map,
    storage: {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        map.set(key, value)
      },
    },
  }
}

function uuidFactory(): () => string {
  let index = 0
  return () => {
    index += 1
    return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
  }
}

function fixtureGame(id: string, title: string, extra: Partial<Game> = {}): Game {
  return {
    id,
    title,
    author: 'Fixture Author',
    releaseYear: 2020,
    ipSeries: 'Fixture Series',
    engine: 'Fixture Engine',
    coverImage: '/images/fixture.svg',
    bannerImage: '/images/fixture-banner.svg',
    gallery: [],
    description: '',
    downloads: [],
    metrics: { fakeViews: 0, score: 0 },
    ...extra,
  }
}

const DAILY_MESSAGE = '今天提交的请求太多了，请明天再试。'
const NOT_FOUND_MESSAGE = '这条请求已经不存在了，刷新后再看。'
const INVALID_MESSAGE = '请求内容不合法，请修改后重试。'
const FORBIDDEN_MESSAGE = '没有权限（请检查 Supabase 配置）。'
const UNAVAILABLE_MESSAGE = '请求服务暂时不可用，请稍后再试。'

export async function runRequestAssertions(): Promise<Assertion[]> {
  const results: Assertion[] = []
  const check = (name: string, actual: unknown, expected: unknown): void => {
    const a = String(actual)
    const e = String(expected)
    results.push({ name, expected: e, actual: a, pass: a === e })
  }

  /* ---------------------------------------------------------------- 归一化 */
  check(
    '标题归一化 · 空白与标点',
    normalizeRequestTitle('  Jolly  4!! '),
    'jolly4',
  )
  check(
    '标题归一化 · 大小写与连字符',
    normalizeRequestTitle('JOLLY-4'),
    'jolly4',
  )
  check(
    '标题归一化 · 全角 NFKC',
    normalizeRequestTitle('ＪＯＬＬＹ－４'),
    'jolly4',
  )
  check(
    '标题归一化 · 中文标点',
    normalizeRequestTitle('五夜：弗雷迪'),
    '五夜弗雷迪',
  )
  check(
    '标题归一化 · ASCII 符号与 SQL 端对齐',
    normalizeRequestTitle('Jolly+4 & More'),
    'jolly4more',
  )
  check(
    '标题归一化 · 非 ASCII 符号也被移除',
    normalizeRequestTitle('Jolly★4'),
    'jolly4',
  )
  check(
    '标题归一化 · 只有符号时为空',
    normalizeRequestTitle('★★'),
    '',
  )
  check(
    '标题归一化 · isSameRequestTitle 忽略格式',
    isSameRequestTitle('Jolly 4', ' JOLLY-4! '),
    true,
  )

  /* ---------------------------------------------------------------- 匹配 */
  const jolly = fixtureGame('jolly', 'Jolly')
  const jolly4 = fixtureGame('jolly-4', 'Jolly 4')
  const anniversary = fixtureGame(
    'jolly-anniversary',
    'Jolly: Anniversary Edition',
    { author: 'Fixture Author', ipSeries: 'Jolly' },
  )

  check(
    '匹配 · 归一化后精确命中',
    matchGameForTitle(' JOLLY-4! ', [jolly, jolly4])?.id,
    'jolly-4',
  )
  check(
    '匹配 · 长标题允许包含',
    matchGameForTitle('Jolly Anniversary', [anniversary])?.id,
    'jolly-anniversary',
  )
  check(
    '匹配 · 过短请求不做包含匹配',
    matchGameForTitle('a', [fixtureGame('abc', 'ABC')]),
    'undefined',
  )

  // 榜单「已收录」必须保守：请求《Jolly》不能因站内已有《Jolly 4》而消失。
  check(
    '已收录判定 · Jolly 不因 Jolly 4 误判',
    matchFulfilledGameForTitle('Jolly', [jolly4]),
    'undefined',
  )
  check(
    '已收录判定 · 精确标题才成立',
    matchFulfilledGameForTitle(' JOLLY-4! ', [jolly4])?.id,
    'jolly-4',
  )
  check(
    '已收录判定 · 包含匹配不会用于 fulfilled',
    matchFulfilledGameForTitle('Jolly Anniversary', [anniversary]),
    'undefined',
  )
  check(
    '精确匹配 · 不含包含结果',
    matchExactGameForTitle('Jolly', [jolly4, jolly])?.id,
    'jolly',
  )

  /* ---------------------------------------------------------------- 本机仓储 */
  {
    const { storage } = memoryStorage()
    const repo = createLocalResourceRequestRepository({
      storage,
      now: () => Date.UTC(2026, 0, 1, 0, 0, 0),
      uuid: uuidFactory(),
    })

    check('本地仓储 · kind', repo.kind, 'local')

    const first = await repo.submit('Jolly 4', 'client-aaaa')
    check('本地仓储 · 首次提交 created', first.created, true)
    check('本地仓储 · 首次提交 voted', first.voted, true)
    check('本地仓储 · 首次提交票数', first.request.votes, 1)

    const duplicateSameClient = await repo.submit('  jolly-4!! ', 'client-aaaa')
    check('本地仓储 · 同 client 重复标题不新建', duplicateSameClient.created, false)
    check('本地仓储 · 同 client 重复标题不重复计票', duplicateSameClient.voted, false)
    check('本地仓储 · 同 client 重复后票数', duplicateSameClient.request.votes, 1)
    check(
      '本地仓储 · 重复提交复用同一条目',
      duplicateSameClient.request.id,
      first.request.id,
    )

    const duplicateOtherClient = await repo.submit('JOLLY 4', 'client-bbbb')
    check('本地仓储 · 另一 client 重复标题不新建', duplicateOtherClient.created, false)
    check('本地仓储 · 另一 client 计一票', duplicateOtherClient.voted, true)
    check('本地仓储 · 另一 client 后票数', duplicateOtherClient.request.votes, 2)

    const voted = await repo.vote(first.request.id, 'client-cccc')
    check('本地仓储 · vote 计票', voted.added, true)
    check('本地仓储 · vote 后票数', voted.request.votes, 3)

    const votedAgain = await repo.vote(first.request.id, 'client-cccc')
    check('本地仓储 · 同一 client 重复 vote 不再计票', votedAgain.added, false)
    check('本地仓储 · 重复 vote 后票数', votedAgain.request.votes, 3)

    await repo.submit('Popgoes 2', 'client-aaaa')
    const sorted = await repo.list()
    check('本地仓储 · list 条数', sorted.length, 2)
    check('本地仓储 · 按票数降序', sorted[0]?.title, 'Jolly 4')
    check('本地仓储 · 首位票数', sorted[0]?.votes, 3)
    check(
      '本地仓储 · list 不暴露 createdBy',
      Object.prototype.hasOwnProperty.call(sorted[0] ?? {}, 'createdBy'),
      false,
    )

    const restored = await createLocalResourceRequestRepository({ storage }).list()
    check('本地仓储 · 重新实例化后仍能读到', restored.length, 2)
    check('本地仓储 · 重新实例化后票数保留', restored[0]?.votes, 3)
  }

  /* ---------------------------------------------------------------- 每日上限 */
  {
    const { storage } = memoryStorage()
    const repo = createLocalResourceRequestRepository({
      storage,
      now: () => Date.UTC(2026, 0, 1, 0, 0, 0),
      uuid: uuidFactory(),
    })

    for (let index = 1; index <= RESOURCE_REQUEST_LIMITS.maxNewPerDay; index += 1) {
      const result = await repo.submit(`Wanted ${index}`, 'limit-client')
      check(`本地仓储 · 每日上限内第 ${index} 条`, result.created, true)
    }

    let limitCode = 'none'
    let limitMessage = ''
    try {
      await repo.submit('One Too Many', 'limit-client')
    } catch (cause) {
      limitCode = cause instanceof ResourceRequestError ? cause.code : 'wrong-error'
      limitMessage = cause instanceof Error ? cause.message : ''
    }
    check('本地仓储 · 第 6 条新请求被拒绝', limitCode, 'DAILY_LIMIT')
    check('本地仓储 · 每日上限提示', limitMessage, DAILY_MESSAGE)

    const duplicateAfterLimit = await repo.submit('Wanted 1', 'limit-client')
    check('本地仓储 · 达到上限后仍可给已有请求投票', duplicateAfterLimit.created, false)
    check('本地仓储 · 达到上限后重复投票不报错', duplicateAfterLimit.voted, false)
  }

  /* ---------------------------------------------------------------- 损坏 / 写失败 */
  {
    const { storage } = memoryStorage({
      [RESOURCE_REQUEST_STORAGE_KEY]: '{not-json',
    })
    const repo = createLocalResourceRequestRepository({ storage, uuid: uuidFactory() })
    const empty = await repo.list()
    check('本地仓储 · 损坏存档重置为空', empty.length, 0)

    const afterReset = await repo.submit('Fresh Start', 'client-dddd')
    check('本地仓储 · 重置后仍可提交', afterReset.request.votes, 1)
  }

  {
    const failingStorage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded')
      },
    }
    const repo = createLocalResourceRequestRepository({
      storage: failingStorage,
      uuid: uuidFactory(),
    })
    const result = await repo.submit('Memory Only', 'client-eeee')
    check('本地仓储 · 写失败时保留内存态', result.request.votes, 1)
    const list = await repo.list()
    check('本地仓储 · 写失败后本页仍可读取', list.length, 1)
  }

  /* ---------------------------------------------------------------- 远程仓储 */
  {
    const { calls, fetchImpl } = stubFetch(() =>
      json([
        {
          id: 'row-1',
          title: 'Jolly 4',
          votes: 7,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-02T00:00:00Z',
        },
      ]),
    )
    const repo = createSupabaseResourceRequestRepository({
      url: 'https://example.supabase.co/',
      anonKey: 'anon-public-key',
      fetchImpl,
    })

    check('Supabase · kind', repo.kind, 'remote')
    const list = await repo.list()
    check('Supabase · list 解析 id', list[0]?.id, 'row-1')
    check('Supabase · list 解析 votes', list[0]?.votes, 7)
    check('Supabase · list 解析 createdAt', list[0]?.createdAt, '2026-01-01T00:00:00Z')
    check(
      'Supabase · list 地址与排序参数',
      calls[0]?.url,
      'https://example.supabase.co/rest/v1/resource_request_board?select=id,title,votes,created_at&order=votes.desc,created_at.asc&limit=50',
    )
    const listHeaders = calls[0]?.init?.headers as Record<string, string>
    check('Supabase · 请求带 apikey', listHeaders.apikey, 'anon-public-key')
    check(
      'Supabase · 请求带 Bearer anon key',
      listHeaders.Authorization,
      'Bearer anon-public-key',
    )
    check('Supabase · 请求带 Accept', listHeaders.Accept, 'application/json')
  }

  {
    const { calls, fetchImpl } = stubFetch(() =>
      json([
        {
          id: 'row-1',
          title: 'Jolly 4',
          votes: 2,
          created_at: '2026-01-01T00:00:00Z',
          created: true,
          voted: true,
        },
      ]),
    )
    const repo = createSupabaseResourceRequestRepository({
      url: 'https://example.supabase.co',
      anonKey: 'anon-public-key',
      fetchImpl,
    })
    const result = await repo.submit('Jolly 4', 'client-aaaa')
    check('Supabase · submit created', result.created, true)
    check('Supabase · submit voted', result.voted, true)
    check('Supabase · submit 票数', result.request.votes, 2)
    check(
      'Supabase · submit 地址',
      calls[0]?.url,
      'https://example.supabase.co/rest/v1/rpc/submit_resource_request',
    )
    check('Supabase · submit 方法', calls[0]?.init?.method, 'POST')
    const submitHeaders = calls[0]?.init?.headers as Record<string, string>
    check(
      'Supabase · submit Content-Type',
      submitHeaders['Content-Type'],
      'application/json',
    )
    check(
      'Supabase · submit 请求体',
      calls[0]?.init?.body,
      JSON.stringify({ p_title: 'Jolly 4', p_client_id: 'client-aaaa' }),
    )
  }

  {
    const { calls, fetchImpl } = stubFetch(() =>
      json([
        {
          id: 'row-1',
          title: 'Jolly 4',
          votes: 8,
          created_at: '2026-01-01T00:00:00Z',
          added: true,
        },
      ]),
    )
    const repo = createSupabaseResourceRequestRepository({
      url: 'https://example.supabase.co',
      anonKey: 'anon-public-key',
      fetchImpl,
    })
    const result = await repo.vote('row-1', 'client-aaaa')
    check('Supabase · vote added', result.added, true)
    check('Supabase · vote 后票数', result.request.votes, 8)
    check(
      'Supabase · vote 地址',
      calls[0]?.url,
      'https://example.supabase.co/rest/v1/rpc/vote_resource_request',
    )
    check(
      'Supabase · vote 请求体',
      calls[0]?.init?.body,
      JSON.stringify({ p_request_id: 'row-1', p_client_id: 'client-aaaa' }),
    )
  }

  async function remoteErrorMessage(
    handler: (url: string, init?: RequestInit) => Response,
  ): Promise<string> {
    const repo = createSupabaseResourceRequestRepository({
      url: 'https://example.supabase.co',
      anonKey: 'anon-public-key',
      fetchImpl: stubFetch(handler).fetchImpl,
    })
    try {
      await repo.submit('Jolly 4', 'client-aaaa')
      return 'no-error'
    } catch (cause) {
      return cause instanceof ResourceRequestError
        ? cause.message
        : cause instanceof Error
          ? cause.message
          : String(cause)
    }
  }

  check(
    'Supabase · P0001 → 每日上限文案',
    await remoteErrorMessage(() =>
      json({ code: 'P0001', message: 'DAILY_LIMIT', details: null, hint: null }, 400),
    ),
    DAILY_MESSAGE,
  )
  check(
    'Supabase · P0002 → 请求不存在文案',
    await remoteErrorMessage(() =>
      json({ code: 'P0002', message: 'REQUEST_NOT_FOUND', details: null, hint: null }, 404),
    ),
    NOT_FOUND_MESSAGE,
  )
  check(
    'Supabase · 22023 → 内容不合法文案',
    await remoteErrorMessage(() =>
      json({ code: '22023', message: 'invalid title', details: null, hint: null }, 400),
    ),
    INVALID_MESSAGE,
  )
  check(
    'Supabase · 42501 → 权限文案',
    await remoteErrorMessage(() =>
      json({ code: '42501', message: 'permission denied', details: null, hint: null }, 403),
    ),
    FORBIDDEN_MESSAGE,
  )
  check(
    'Supabase · 其他非 2xx → 服务不可用文案',
    await remoteErrorMessage(() => json({ message: 'boom' }, 500)),
    UNAVAILABLE_MESSAGE,
  )

  /* ---------------------------------------------------------------- searchGames */
  const library = useGameLibrary()
  await nextTick()
  const visible = library.visibleGames.value
  check('visibleGames · 与前台可见数一致', visible.length, library.catalogSize.value)
  check('searchGames · 空查询返回空', library.searchGames('   ').length, 0)

  if (visible.length > 0) {
    const sample = visible[0]
    const beforeSearch = library.activeFilters.value.search
    const hits = library.searchGames(sample.title, 100)
    check(
      'searchGames · 命中当前可见作品',
      hits.some((game) => game.id === sample.id),
      true,
    )
    check('searchGames · 不改动首页搜索条件', library.activeFilters.value.search, beforeSearch)

    if (sample.title.toLowerCase() !== sample.title.toUpperCase()) {
      const upperHits = library.searchGames(sample.title.toUpperCase(), 100)
      check(
        'searchGames · 大小写不敏感',
        upperHits.some((game) => game.id === sample.id),
        true,
      )
    }

    const limited = library.searchGames(sample.title, 1)
    check('searchGames · 遵守 limit', limited.length <= 1, true)
  }

  /* ------------------------------------------------- 催资源 store（可构造） */
  const storeStorage = memoryStorage()
  const visibleGame = fixtureGame('jolly', 'Jolly')
  const rows: ResourceRequest[] = [
    { id: 'r1', title: 'Jolly', votes: 2, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'r2', title: 'Wanted Game', votes: 5, createdAt: '2026-01-02T00:00:00.000Z' },
  ]
  let failList = false
  let failVote = false
  const repo: ResourceRequestRepository = {
    kind: 'local',
    async list() {
      if (failList) throw new ResourceRequestError('NETWORK', 'offline')
      return rows.map((row) => ({ ...row }))
    },
    async submit(title) {
      const created: ResourceRequest = {
        id: `r${rows.length + 1}`,
        title,
        votes: 1,
        createdAt: '2026-01-03T00:00:00.000Z',
      }
      rows.push(created)
      return { request: { ...created }, created: true, voted: true }
    },
    async vote(id) {
      if (failVote) throw new ResourceRequestError('UNAVAILABLE', 'vote failed')
      const row = rows.find((item) => item.id === id)
      if (!row) throw new ResourceRequestError('REQUEST_NOT_FOUND', 'missing')
      row.votes += 1
      return { request: { ...row }, added: true }
    },
  }
  const store = createResourceRequestStore({
    repository: repo,
    storage: storeStorage.storage,
    visibleGames: () => [visibleGame],
    clientId: () => 'client-test',
    now: () => 1000,
  })

  const firstLoad = store.load()
  const secondLoad = store.load()
  check('store · 并发 load 复用同一个 Promise', firstLoad === secondLoad, true)
  await firstLoad
  check('store · load 填充列表', store.requests.value.length, 2)
  check(
    'store · 待上传排除已收录',
    store.pendingRequests.value.map((request) => request.id).join(','),
    'r2',
  )
  check('store · 已收录匹配到可见作品', store.fulfilledRequests.value[0]?.game.id, 'jolly')

  const submitted = await store.submit('Brand New')
  check('store · submit 写入请求', store.requests.value.some((request) => request.id === submitted.request.id), true)
  check('store · submit 同步本机已投状态', store.votedIds.value.has(submitted.request.id), true)

  const voted = await store.vote('r2')
  check('store · vote 返回新票数', voted.request.votes, 6)
  const duplicateVote = await store.vote('r2')
  check('store · 重复投票不再加票', duplicateVote.added, false)

  failVote = true
  const beforeVote = store.requests.value.find((request) => request.id === 'r1')?.votes ?? -1
  let voteError = ''
  try {
    await store.vote('r1')
  } catch (cause) {
    voteError = cause instanceof Error ? cause.message : String(cause)
  }
  check('store · 投票失败抛出错误', voteError.length > 0, true)
  check(
    'store · 投票失败回滚乐观票数',
    store.requests.value.find((request) => request.id === 'r1')?.votes,
    beforeVote,
  )
  check('store · 投票失败后移除 pending 标记', store.pendingVotes.value.has('r1'), false)
  failVote = false

  // 列表失败时回退最近一次缓存
  const cachedStorage = memoryStorage({
    [RESOURCE_REQUEST_CACHE_KEY]: JSON.stringify({
      at: 1,
      requests: [{ id: 'cached-1', title: 'Cached', votes: 3, createdAt: '2026-01-01T00:00:00.000Z' }],
    }),
  })
  failList = true
  const cachedStore = createResourceRequestStore({
    repository: repo,
    storage: cachedStorage.storage,
    visibleGames: () => [],
    clientId: () => 'client-cache',
  })
  await cachedStore.load()
  check('store · 列表失败回退缓存', cachedStore.usingCache.value, true)
  check('store · 缓存回退文案', cachedStore.error.value.includes('缓存'), true)
  check('store · 缓存条数', cachedStore.requests.value.length, 1)
  failList = false

  return results
}
