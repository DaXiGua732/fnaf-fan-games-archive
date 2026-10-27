/**
 * ============================================================================
 * SupabaseResourceRequestRepository —— 全站共享模式
 * ============================================================================
 * 直接用 fetch 调 Supabase 的 REST / RPC，不引入 @supabase/supabase-js：
 * 用到的只有两个 RPC 和一个只读视图，多一个运行时依赖不划算。
 *
 * 安全边界：
 *   - 只使用 anon public key（设计上就是公开的）；
 *   - 表启用了 RLS；访客只能 SELECT 视图，写入只能走 security definer 函数；
 *   - 这里**绝不**保存、打印或发送 service_role key。
 *
 * 错误处理：把 PostgREST / PostgreSQL 的错误码翻译成可以直接给访客看的中文。
 * fetch 的原始异常、URL、请求头都不会透传到 UI。
 * ============================================================================
 */
import type {
  RequestSubmitResult,
  RequestVoteResult,
  ResourceRequest,
  ResourceRequestRepository,
} from '../types/resourceRequest'
import { ResourceRequestError } from '../types/resourceRequest'

const DEFAULT_TIMEOUT_MS = 8_000

const BOARD_PATH =
  '/rest/v1/resource_request_board' +
  '?select=id,title,votes,created_at' +
  '&order=votes.desc,created_at.asc' +
  '&limit=50'

const SUBMIT_PATH = '/rest/v1/rpc/submit_resource_request'
const VOTE_PATH = '/rest/v1/rpc/vote_resource_request'

const MESSAGE_DAILY_LIMIT = '今天提交的请求太多了，请明天再试。'
const MESSAGE_NOT_FOUND = '这条请求已经不存在了，刷新后再看。'
const MESSAGE_INVALID = '请求内容不合法，请修改后重试。'
const MESSAGE_FORBIDDEN = '没有权限（请检查 Supabase 配置）。'
const MESSAGE_UNAVAILABLE = '请求服务暂时不可用，请稍后再试。'

export interface SupabaseResourceRequestRepositoryOptions {
  url: string
  anonKey: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unavailable(code: 'UNAVAILABLE' | 'BAD_RESPONSE' = 'UNAVAILABLE'): ResourceRequestError {
  return new ResourceRequestError(code, MESSAGE_UNAVAILABLE)
}

/** 把 PostgREST 返回的 `{ code, message, details, hint }` 翻译成用户能理解的话 */
function mapSupabaseError(payload: unknown, status: number): ResourceRequestError {
  const record = isRecord(payload) ? payload : {}
  const code = typeof record.code === 'string' ? record.code : ''
  const message = typeof record.message === 'string' ? record.message : ''

  if (code === '42501' || status === 401 || status === 403) {
    return new ResourceRequestError('FORBIDDEN', MESSAGE_FORBIDDEN)
  }
  if (code === 'P0001' || /DAILY_LIMIT/i.test(message)) {
    return new ResourceRequestError('DAILY_LIMIT', MESSAGE_DAILY_LIMIT)
  }
  if (code === 'P0002' || /REQUEST_NOT_FOUND/i.test(message)) {
    return new ResourceRequestError('REQUEST_NOT_FOUND', MESSAGE_NOT_FOUND)
  }
  if (code === '22023' || (status === 400 && /\binvalid\b/i.test(message))) {
    return new ResourceRequestError('INVALID', MESSAGE_INVALID)
  }
  return unavailable()
}

function parseRequestRow(row: unknown): ResourceRequest {
  if (!isRecord(row)) throw unavailable('BAD_RESPONSE')
  if (typeof row.id !== 'string' || row.id.length === 0) throw unavailable('BAD_RESPONSE')
  if (typeof row.title !== 'string') throw unavailable('BAD_RESPONSE')
  if (
    typeof row.votes !== 'number' ||
    !Number.isInteger(row.votes) ||
    row.votes < 0
  ) {
    throw unavailable('BAD_RESPONSE')
  }
  if (typeof row.created_at !== 'string' || row.created_at.length === 0) {
    throw unavailable('BAD_RESPONSE')
  }

  return {
    id: row.id,
    title: row.title,
    votes: row.votes,
    createdAt: row.created_at,
  }
}

function firstRpcRow(payload: unknown): Record<string, unknown> {
  if (!Array.isArray(payload) || payload.length === 0 || !isRecord(payload[0])) {
    throw unavailable('BAD_RESPONSE')
  }
  return payload[0]
}

export function createSupabaseResourceRequestRepository(
  options: SupabaseResourceRequestRepositoryOptions,
): ResourceRequestRepository {
  const baseUrl = options.url.replace(/\/+$/, '')
  const anonKey = options.anonKey
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const fetchImpl: typeof fetch =
    options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init))

  async function callApi(
    path: string,
    method: 'GET' | 'POST',
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      Accept: 'application/json',
    }
    if (method === 'POST') headers['Content-Type'] = 'application/json'

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const init: RequestInit = {
        method,
        headers,
        signal: controller.signal,
        cache: 'no-store',
      }
      if (body !== undefined) init.body = JSON.stringify(body)

      const response = await fetchImpl(`${baseUrl}${path}`, init)
      const raw = await response.text()

      let payload: unknown = null
      if (raw.trim() !== '') {
        try {
          payload = JSON.parse(raw)
        } catch {
          payload = null
        }
      }

      if (!response.ok) throw mapSupabaseError(payload, response.status)
      return payload
    } catch (cause) {
      if (cause instanceof ResourceRequestError) throw cause
      if (controller.signal.aborted) {
        throw new ResourceRequestError('TIMEOUT', MESSAGE_UNAVAILABLE)
      }
      throw new ResourceRequestError('NETWORK', MESSAGE_UNAVAILABLE)
    } finally {
      clearTimeout(timer)
    }
  }

  async function list(): Promise<ResourceRequest[]> {
    const payload = await callApi(BOARD_PATH, 'GET')
    if (!Array.isArray(payload)) throw unavailable('BAD_RESPONSE')
    return payload.map(parseRequestRow)
  }

  async function submit(title: string, clientId: string): Promise<RequestSubmitResult> {
    const payload = await callApi(SUBMIT_PATH, 'POST', {
      p_title: title,
      p_client_id: clientId,
    })
    const row = firstRpcRow(payload)
    return {
      request: parseRequestRow(row),
      created: row.created === true,
      voted: row.voted === true,
    }
  }

  async function vote(id: string, clientId: string): Promise<RequestVoteResult> {
    const payload = await callApi(VOTE_PATH, 'POST', {
      p_request_id: id,
      p_client_id: clientId,
    })
    const row = firstRpcRow(payload)
    return {
      request: parseRequestRow(row),
      added: row.added === true,
    }
  }

  return {
    kind: 'remote',
    list,
    submit,
    vote,
  }
}
