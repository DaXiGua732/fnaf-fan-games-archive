/**
 * ============================================================================
 * LocalResourceRequestRepository —— 本机模式（Supabase 未配置时的真实降级）
 * ============================================================================
 * 这不是 mock：刷新不丢、去重、每日上限都真的生效，只是数据只存在
 * 当前这台设备的浏览器里，别的访客看不到。
 *
 * 存储形状：
 *   { version: 1, requests: StoredRequest[], votes: { [requestId]: clientId[] } }
 *
 * 为什么同时存 votes 明细：页面上的 votes 只是计数，去重必须知道「谁投过」。
 * 两个字段在同一个 JSON 里落盘，避免半写状态。
 * ============================================================================
 */
import type {
  RequestSubmitResult,
  RequestVoteResult,
  ResourceRequest,
  ResourceRequestRepository,
} from '../types/resourceRequest'
import {
  RESOURCE_REQUEST_LIMITS,
  ResourceRequestError,
} from '../types/resourceRequest'
import {
  normalizeRequestTitle,
  sortResourceRequestsByPriority,
} from '../utils/requestMatch'
import type { StorageLike } from './localGameRepository'

export const RESOURCE_REQUEST_STORAGE_KEY = 'fnaf-archive:resource-requests:v1'

const DAY_MS = 24 * 60 * 60 * 1000

interface StoredRequest extends ResourceRequest {
  createdBy?: string
}

interface StoredState {
  version: 1
  requests: StoredRequest[]
  votes: Record<string, string[]>
}

export interface LocalResourceRequestRepositoryOptions {
  storage?: StorageLike | null
  now?: () => number
  uuid?: () => string
}

function emptyState(): StoredState {
  return { version: 1, requests: [], votes: {} }
}

function resolveBrowserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/**
 * Web Locks 让同一浏览器的多个标签页串行化「读 → 改 → 写」。
 * 没有该 API 的旧环境仍会退化为后写覆盖 —— 本机模式不是共享存储，
 * 这里的目标只是尽量避免同时提交 / 投票互相吞掉。
 */
type LockManagerLike = {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>
}

function getLockManager(): LockManagerLike | null {
  if (typeof navigator === 'undefined') return null
  const locks = (navigator as Navigator & { locks?: LockManagerLike }).locks
  return locks && typeof locks.request === 'function' ? locks : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStoredRequest(value: unknown): value is StoredRequest {
  if (!isRecord(value)) return false
  if (typeof value.id !== 'string' || value.id.length === 0) return false
  if (typeof value.title !== 'string' || value.title.length === 0) return false
  if (typeof value.votes !== 'number' || !Number.isInteger(value.votes) || value.votes < 0) {
    return false
  }
  if (typeof value.createdAt !== 'string' || value.createdAt.length === 0) return false
  if (value.createdBy !== undefined && typeof value.createdBy !== 'string') return false
  return true
}

function parseState(raw: string): StoredState | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.version !== 1) return null
    if (!Array.isArray(parsed.requests)) return null
    if (!parsed.requests.every(isStoredRequest)) return null
    if (!isRecord(parsed.votes)) return null

    const votes: Record<string, string[]> = {}
    for (const [id, value] of Object.entries(parsed.votes)) {
      if (!Array.isArray(value) || !value.every((client) => typeof client === 'string')) {
        return null
      }
      votes[id] = [...new Set(value as string[])]
    }

    return {
      version: 1,
      requests: parsed.requests.map((request) => ({ ...request })),
      votes,
    }
  } catch {
    return null
  }
}

type StorageRead = { ok: true; state: StoredState | null } | { ok: false }

function readState(storage: StorageLike): StorageRead {
  try {
    const raw = storage.getItem(RESOURCE_REQUEST_STORAGE_KEY)
    if (raw === null || raw.trim() === '') return { ok: true, state: null }
    return { ok: true, state: parseState(raw) }
  } catch {
    return { ok: false }
  }
}

function isUsableClientId(value: string): boolean {
  return value.length >= 8 && value.length <= 64
}

function defaultUuid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // fall through
  }
  return `request-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function toPublicRequest(request: StoredRequest): ResourceRequest {
  return {
    id: request.id,
    title: request.title,
    votes: request.votes,
    createdAt: request.createdAt,
  }
}

export function createLocalResourceRequestRepository(
  options: LocalResourceRequestRepositoryOptions = {},
): ResourceRequestRepository {
  const backend =
    options.storage === undefined ? resolveBrowserStorage() : (options.storage ?? null)
  const now = options.now ?? Date.now
  const uuid = options.uuid ?? defaultUuid

  const initialRead = backend ? readState(backend) : { ok: false as const }
  let state = initialRead.ok && initialRead.state ? initialRead.state : emptyState()
  /** 写失败（配额 / 隐私模式）后不再从存储回读，避免用旧数据覆盖本页内存 */
  let persistFailed = false

  const LOCK_NAME = 'fnaf-archive:resource-requests:v1'

  async function withStorageLock<T>(task: () => T | Promise<T>): Promise<T> {
    const locks = getLockManager()
    if (!locks) return task()
    return locks.request(LOCK_NAME, async () => task())
  }

  function persist(): void {
    if (!backend) return
    try {
      backend.setItem(RESOURCE_REQUEST_STORAGE_KEY, JSON.stringify(state))
      persistFailed = false
    } catch {
      // 保持内存态可继续使用；本页内的提交与投票仍然有效
      persistFailed = true
    }
  }

  /** 其他标签页可能刚写过同一个 key：每次操作前吸收最新内容 */
  function syncFromStorage(): void {
    if (!backend || persistFailed) return
    const read = readState(backend)
    if (!read.ok) return
    state = read.state ?? emptyState()
  }

  function validateTitle(title: string): string {
    const clean = title.trim()
    if (clean.length < RESOURCE_REQUEST_LIMITS.titleMin || clean.length > RESOURCE_REQUEST_LIMITS.titleMax) {
      throw new ResourceRequestError(
        'INVALID',
        `请求内容需为 ${RESOURCE_REQUEST_LIMITS.titleMin}–${RESOURCE_REQUEST_LIMITS.titleMax} 个字符。`,
      )
    }
    const normalized = normalizeRequestTitle(clean)
    if (!normalized) {
      throw new ResourceRequestError('INVALID', '请求内容不合法，请修改后重试。')
    }
    return clean
  }

  function validateClient(clientId: string): void {
    if (!isUsableClientId(clientId)) {
      throw new ResourceRequestError('INVALID', '请求内容不合法，请修改后重试。')
    }
  }

  function nextId(): string {
    let id = uuid()
    let guard = 0
    while (state.requests.some((request) => request.id === id) && guard < 5) {
      id = uuid()
      guard += 1
    }
    return id
  }

  function findExisting(normalized: string): StoredRequest | undefined {
    return state.requests.find(
      (request) => normalizeRequestTitle(request.title) === normalized,
    )
  }

  function addVote(request: StoredRequest, clientId: string): boolean {
    const voters = state.votes[request.id] ?? []
    if (voters.includes(clientId)) {
      state.votes[request.id] = voters
      return false
    }
    state.votes[request.id] = [...voters, clientId]
    request.votes += 1
    return true
  }

  async function list(): Promise<ResourceRequest[]> {
    return withStorageLock(() => {
      syncFromStorage()
      return sortResourceRequestsByPriority(state.requests).map(toPublicRequest)
    })
  }

  async function submit(title: string, clientId: string): Promise<RequestSubmitResult> {
    return withStorageLock(() => {
      const clean = validateTitle(title)
      validateClient(clientId)
      syncFromStorage()

      const existing = findExisting(normalizeRequestTitle(clean))
      if (existing) {
        const voted = addVote(existing, clientId)
        if (voted) persist()
        return { request: toPublicRequest(existing), created: false, voted }
      }

      const nowMs = now()
      const recentCount = state.requests.filter((request) => {
        if (request.createdBy !== clientId) return false
        const created = Date.parse(request.createdAt)
        return Number.isFinite(created) && nowMs - created < DAY_MS
      }).length

      if (recentCount >= RESOURCE_REQUEST_LIMITS.maxNewPerDay) {
        throw new ResourceRequestError(
          'DAILY_LIMIT',
          '今天提交的请求太多了，请明天再试。',
        )
      }

      const createdRequest: StoredRequest = {
        id: nextId(),
        title: clean,
        votes: 0,
        createdAt: new Date(nowMs).toISOString(),
        createdBy: clientId,
      }
      state.requests = [...state.requests, createdRequest]
      state.votes[createdRequest.id] = [clientId]
      createdRequest.votes = 1
      persist()

      return {
        request: toPublicRequest(createdRequest),
        created: true,
        voted: true,
      }
    })
  }

  async function vote(id: string, clientId: string): Promise<RequestVoteResult> {
    return withStorageLock(() => {
      validateClient(clientId)
      syncFromStorage()

      const request = state.requests.find((item) => item.id === id)
      if (!request) {
        throw new ResourceRequestError('REQUEST_NOT_FOUND', '这条请求已经不存在了，刷新后再看。')
      }

      const added = addVote(request, clientId)
      if (added) persist()
      return { request: toPublicRequest(request), added }
    })
  }

  return {
    kind: 'local',
    list,
    submit,
    vote,
  }
}
