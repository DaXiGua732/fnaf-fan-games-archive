/**
 * ============================================================================
 * useResourceRequests —— 催资源深模块（模块级单例）
 * ============================================================================
 * 视图层只拿「已排好序的待上传 / 已收录列表」和几个动作，
 * 不自己算匹配、不自己合并投票结果、不自己读写缓存。
 *
 * 数据源由 `resourceRequestRepository` 决定：
 *   - 配了 Supabase → 全站共享；失败时展示最近一次缓存
 *   - 没配         → 本机 localStorage
 * ============================================================================
 */
import { computed, ref } from 'vue'
import { useGameLibrary } from './useGameLibrary'
import { resourceRequestRepository } from '../repositories'
import { RESOURCE_REQUEST_STORAGE_KEY } from '../repositories/localResourceRequestRepository'
import type { Game } from '../types/game'
import type {
  RequestSubmitResult,
  RequestVoteResult,
  ResourceRequest,
} from '../types/resourceRequest'
import {
  RESOURCE_REQUEST_LIMITS,
  ResourceRequestError,
} from '../types/resourceRequest'
import { getRequestClientId } from '../utils/requestClient'
import { isRecord } from '../utils/guards'
import { getLocalStorage } from '../utils/localStorage'
import {
  compareResourceRequests,
  matchFulfilledGameForTitle,
  normalizeRequestTitle,
  sortResourceRequestsByPriority,
} from '../utils/requestMatch'

const CACHE_KEY = 'fnaf-archive:resource-requests-cache:v1'
const VOTED_KEY = 'fnaf-archive:request-voted:v1'
const CACHE_ERROR = '暂时连不上请求服务，当前显示最近一次缓存。'
const GENERIC_ERROR = '请求服务暂时不可用，请稍后再试。'

interface CachedRequests {
  at: number
  requests: ResourceRequest[]
}

function isRequest(value: unknown): value is ResourceRequest {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.title === 'string' &&
    typeof value.votes === 'number' &&
    Number.isInteger(value.votes) &&
    value.votes >= 0 &&
    typeof value.createdAt === 'string' &&
    value.createdAt.length > 0
  )
}

function parseRequestList(value: unknown): ResourceRequest[] | null {
  if (!Array.isArray(value) || !value.every(isRequest)) return null
  return value.map((item) => ({
    id: item.id,
    title: item.title,
    votes: item.votes,
    createdAt: item.createdAt,
  }))
}

function readVotedIds(): Set<string> {
  const storage = getLocalStorage()
  if (!storage) return new Set()
  try {
    const raw = storage.getItem(VOTED_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((value): value is string => typeof value === 'string'))
  } catch {
    return new Set()
  }
}

function persistVotedIds(ids: Set<string>): void {
  const storage = getLocalStorage()
  if (!storage) return
  try {
    storage.setItem(VOTED_KEY, JSON.stringify([...ids]))
  } catch {
    // 投票去重是体验优化，存储写失败不该阻断操作
  }
}

function readCache(): ResourceRequest[] | null {
  const storage = getLocalStorage()
  if (!storage) return null
  try {
    const raw = storage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || typeof parsed.at !== 'number') return null
    return parseRequestList(parsed.requests)
  } catch {
    return null
  }
}

function writeCache(requests: ResourceRequest[]): void {
  const storage = getLocalStorage()
  if (!storage) return
  const payload: CachedRequests = { at: Date.now(), requests }
  try {
    storage.setItem(CACHE_KEY, JSON.stringify(payload))
  } catch {
    // 配额满时放弃缓存；当前内存列表仍然可用
  }
}

function describeError(cause: unknown): string {
  return cause instanceof ResourceRequestError && cause.message
    ? cause.message
    : GENERIC_ERROR
}

/* ---------------------------------------------------------------------------
   状态（模块级，全站共享）
   --------------------------------------------------------------------------- */
const { visibleGames } = useGameLibrary()

const requests = ref<ResourceRequest[]>([])
const isLoading = ref(true)
const error = ref('')
const votedIds = ref<Set<string>>(readVotedIds())
const pendingVotes = ref<Set<string>>(new Set())
const isSubmitting = ref(false)
const usingCache = ref(false)
const isRemote = computed(() => resourceRequestRepository.kind === 'remote')

let loadPromise: Promise<void> | null = null
let storageListenerInstalled = false
/** 提交 / 投票成功后递增；用于丢弃「在这些写操作之前发出」的过期 list 响应 */
let stateRevision = 0
/** 每次 requests 被替换或更新时递增；失败回滚前用它判断是否已有更新的数据 */
let dataVersion = 0
/** 当前 list 在途时，标记结束后再拉一次，避免过期响应的局部数据留在榜上 */
let reloadScheduled = false
/** 是否已经拿到过一次完整的服务端列表（缓存回退不算） */
let hasAuthoritativeList = false

/* ---------------------------------------------------------------------------
   内部工具
   --------------------------------------------------------------------------- */
function findRequest(id: string): ResourceRequest | undefined {
  return requests.value.find((request) => request.id === id)
}

function upsertRequest(next: ResourceRequest): void {
  const index = requests.value.findIndex((request) => request.id === next.id)
  requests.value =
    index === -1
      ? [next, ...requests.value]
      : requests.value.map((request, current) => (current === index ? next : request))
  dataVersion += 1
}

/** 缓存回退时保留本次会话里刚写入的请求，避免「提交成功却从榜上消失」 */
function mergeRequests(
  current: ResourceRequest[],
  cached: ResourceRequest[],
): ResourceRequest[] {
  const byId = new Map(current.map((request) => [request.id, request]))
  for (const request of cached) {
    if (!byId.has(request.id)) byId.set(request.id, request)
  }
  return [...byId.values()]
}

function markVoted(id: string): void {
  if (votedIds.value.has(id)) return
  const next = new Set(votedIds.value)
  next.add(id)
  votedIds.value = next
  persistVotedIds(next)
}

function addPendingVote(id: string): void {
  const next = new Set(pendingVotes.value)
  next.add(id)
  pendingVotes.value = next
}

function removePendingVote(id: string): void {
  const next = new Set(pendingVotes.value)
  next.delete(id)
  pendingVotes.value = next
}

/**
 * 排队一次强制刷新。
 *
 * list 在途时不能直接再发一个（load 会复用同一个 Promise），所以先记标记，
 * 由当前 load 的 finally 在清掉 loadPromise 后启动。
 */
function scheduleReload(): void {
  reloadScheduled = true
  if (loadPromise) return
  reloadScheduled = false
  void load({ force: true })
}

/** 写成功后：只有「还没有完整列表」或「有 list 在途」才需要补一次全量刷新 */
function refreshAfterWrite(): void {
  if (!hasAuthoritativeList || loadPromise) scheduleReload()
}

function installStorageListener(): void {
  if (typeof window === 'undefined' || storageListenerInstalled) return
  storageListenerInstalled = true

  window.addEventListener('storage', (event) => {
    if (event.key === VOTED_KEY || event.key === null) {
      votedIds.value = readVotedIds()
    }
    if (
      !isRemote.value &&
      (event.key === RESOURCE_REQUEST_STORAGE_KEY || event.key === null)
    ) {
      void load({ force: true })
    }
  })
}

/* ---------------------------------------------------------------------------
   动作
   --------------------------------------------------------------------------- */
function load(options: { force?: boolean } = {}): Promise<void> {
  // 同一时刻只允许一个请求；并发调用复用同一个 Promise
  if (loadPromise) return loadPromise
  if (options.force) error.value = ''
  isLoading.value = true
  const revisionAtStart = stateRevision

  loadPromise = (async () => {
    try {
      const latest = await resourceRequestRepository.list()
      // 请求期间若提交 / 投票成功，旧列表可能不含刚写入的行（或票数已过期）。
      // 先丢弃它，再在 finally 里补一次全量请求 —— 不能只留下刚写入的那一条。
      if (revisionAtStart !== stateRevision) {
        scheduleReload()
        return
      }
      requests.value = latest
      dataVersion += 1
      hasAuthoritativeList = true
      error.value = ''
      usingCache.value = false
      if (isRemote.value) writeCache(latest)
    } catch (cause) {
      if (revisionAtStart !== stateRevision) {
        scheduleReload()
        return
      }
      hasAuthoritativeList = false
      const cached = readCache()
      if (cached !== null) {
        // 空缓存也是有效缓存：merging 后仍要显示空状态 + 缓存提示。
        requests.value = mergeRequests(requests.value, cached)
        dataVersion += 1
        usingCache.value = true
        error.value = CACHE_ERROR
      } else {
        usingCache.value = false
        error.value = describeError(cause)
      }
    } finally {
      isLoading.value = false
      loadPromise = null
      if (reloadScheduled) {
        reloadScheduled = false
        void load({ force: true })
      }
    }
  })()

  return loadPromise
}

async function submit(title: string): Promise<RequestSubmitResult> {
  const clean = title.trim()
  if (
    clean.length < RESOURCE_REQUEST_LIMITS.titleMin ||
    clean.length > RESOURCE_REQUEST_LIMITS.titleMax
  ) {
    throw new ResourceRequestError(
      'INVALID',
      `请求内容需为 ${RESOURCE_REQUEST_LIMITS.titleMin}–${RESOURCE_REQUEST_LIMITS.titleMax} 个字符。`,
    )
  }

  isSubmitting.value = true

  try {
    const result = await resourceRequestRepository.submit(clean, getRequestClientId())
    stateRevision += 1
    upsertRequest(result.request)
    // 提交成功必然意味着已为该请求计过票（新建或此前投过），同步本机去重状态
    markVoted(result.request.id)
    refreshAfterWrite()
    return result
  } finally {
    isSubmitting.value = false
  }
}

async function vote(id: string): Promise<RequestVoteResult> {
  const current = findRequest(id)
  if (votedIds.value.has(id)) {
    if (!current) {
      throw new ResourceRequestError(
        'REQUEST_NOT_FOUND',
        '这条请求已经不存在了，刷新后再看。',
      )
    }
    return { request: current, added: false }
  }

  if (pendingVotes.value.has(id)) {
    if (!current) {
      throw new ResourceRequestError(
        'REQUEST_NOT_FOUND',
        '这条请求已经不存在了，刷新后再看。',
      )
    }
    return { request: current, added: false }
  }

  if (!current) {
    throw new ResourceRequestError(
      'REQUEST_NOT_FOUND',
      '这条请求已经不存在了，刷新后再看。',
    )
  }

  addPendingVote(id)

  // 乐观更新：先给用户看到票数 +1；失败时再回滚到操作前的快照
  const optimistic: ResourceRequest = { ...current, votes: current.votes + 1 }
  upsertRequest(optimistic)
  const versionAfterOptimistic = dataVersion

  try {
    const result = await resourceRequestRepository.vote(id, getRequestClientId())
    stateRevision += 1
    upsertRequest(result.request)
    // added=false 表示服务端确认本浏览器此前已投过，同样要禁掉重复点击
    markVoted(id)
    refreshAfterWrite()
    return result
  } catch (cause) {
    // 只回滚自己这一次乐观更新。若期间列表 / 另一票已经改过数据，
    // 按票数比较会误删别人的票；这种情况下改为拉一次权威列表。
    if (dataVersion === versionAfterOptimistic) {
      upsertRequest(current)
    } else {
      scheduleReload()
    }
    throw cause
  } finally {
    removePendingVote(id)
  }
}

function refresh(): Promise<void> {
  return load({ force: true })
}

/* ---------------------------------------------------------------------------
   派生
   --------------------------------------------------------------------------- */

/**
 * 待上传榜单：只把**精确标题相同**的可见作品视为「已收录」。
 * 包含匹配会把《Jolly》误判成《Jolly 4》已收录，所以这里不用 matchGameForTitle。
 */
const pendingRequests = computed<ResourceRequest[]>(() => {
  const games = visibleGames.value
  return sortResourceRequestsByPriority(
    requests.value.filter(
      (request) => !matchFulfilledGameForTitle(request.title, games),
    ),
  )
})

const fulfilledRequests = computed<{ request: ResourceRequest; game: Game }[]>(() => {
  const games = visibleGames.value
  const pairs: { request: ResourceRequest; game: Game }[] = []

  for (const request of requests.value) {
    const game = matchFulfilledGameForTitle(request.title, games)
    if (game) pairs.push({ request, game })
  }

  return pairs.sort((a, b) => compareResourceRequests(a.request, b.request))
})

function existingRequestFor(title: string): ResourceRequest | undefined {
  const normalized = normalizeRequestTitle(title)
  if (!normalized) return undefined
  return requests.value.find(
    (request) => normalizeRequestTitle(request.title) === normalized,
  )
}

/* ---------------------------------------------------------------------------
   对外接口
   --------------------------------------------------------------------------- */
export interface ResourceRequestsAPI {
  requests: typeof requests
  isLoading: typeof isLoading
  error: typeof error
  votedIds: typeof votedIds
  pendingVotes: typeof pendingVotes
  isSubmitting: typeof isSubmitting
  usingCache: typeof usingCache
  isRemote: typeof isRemote
  pendingRequests: typeof pendingRequests
  fulfilledRequests: typeof fulfilledRequests
  load: typeof load
  refresh: typeof refresh
  submit: typeof submit
  vote: typeof vote
  existingRequestFor: typeof existingRequestFor
}

export function useResourceRequests(): ResourceRequestsAPI {
  installStorageListener()

  return {
    requests,
    isLoading,
    error,
    votedIds,
    pendingVotes,
    isSubmitting,
    usingCache,
    isRemote,
    pendingRequests,
    fulfilledRequests,
    load,
    refresh,
    submit,
    vote,
    existingRequestFor,
  }
}
