/**
 * 催资源（Resource Request）领域模型
 *
 * 访客在首页提交「想要但站内还没有」的资源；同一浏览器对同一条请求只计一票。
 * 请求在数据层只有「开放 / 已收录 / 隐藏」三种去向，其中「已收录」由前台
 * 用当前可见目录**实时推导**，不需要人工在后台改状态。
 */

export interface ResourceRequest {
  id: string
  title: string
  votes: number
  createdAt: string
}

export interface RequestSubmitResult {
  request: ResourceRequest
  created: boolean
  voted: boolean
}

export interface RequestVoteResult {
  request: ResourceRequest
  added: boolean
}

export type ResourceRequestRepositoryKind = 'remote' | 'local'

export interface ResourceRequestRepository {
  readonly kind: ResourceRequestRepositoryKind
  list(): Promise<ResourceRequest[]>
  submit(title: string, clientId: string): Promise<RequestSubmitResult>
  vote(id: string, clientId: string): Promise<RequestVoteResult>
}

/** 标题与「每日新请求」的共享上限 —— UI 与两个仓储都读这一份，避免三处漂移 */
export const RESOURCE_REQUEST_LIMITS = {
  titleMin: 2,
  titleMax: 80,
  maxNewPerDay: 5,
} as const

export type ResourceRequestErrorCode =
  | 'DAILY_LIMIT'
  | 'REQUEST_NOT_FOUND'
  | 'INVALID'
  | 'FORBIDDEN'
  | 'UNAVAILABLE'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'BAD_RESPONSE'

/**
 * 仓储层错误。
 *
 * `message` 始终是**可以直接展示给访客的中文**；`code` 供测试与上层判断。
 * 不把 Supabase / fetch 的原始错误直接抛给 UI，避免出现英文堆栈或泄露配置细节。
 */
export class ResourceRequestError extends Error {
  readonly code: ResourceRequestErrorCode

  constructor(code: ResourceRequestErrorCode, message: string) {
    super(message)
    this.name = 'ResourceRequestError'
    this.code = code
  }
}
