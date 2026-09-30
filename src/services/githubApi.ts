/**
 * ============================================================================
 * GitHub REST API 的最小封装
 * ============================================================================
 * 只做三件事：带凭据发请求、把 HTTP 状态码翻译成**能让人行动**的中文、
 * 把状态码保留下来供上层判断（比如 409 冲突要重试）。
 *
 * 【为什么错误信息不能只甩状态码】
 * 后台的失败路径全在这里收口。用户看到的如果只是「403」，他没有任何下一步可做；
 * 必须直接告诉他「令牌没勾选这个仓库」或者「Contents 权限要给 Read and write」。
 * 这是这个后台唯一一处会跟外部服务打交道的地方，值得把话说明白。
 * ============================================================================
 */

const API_BASE = 'https://api.github.com'

/** 数据仓在 GitHub 上的坐标 */
export interface GithubRepoRef {
  owner: string
  repo: string
  /** 分支名 */
  branch: string
  /** 文件在仓库里的路径，如 `db.json` */
  path: string
}

/**
 * 带状态码的 API 错误。
 * 上层靠 `status` 区分「可重试的冲突(409)」与「凭据问题(401/403)」。
 */
export class GithubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'GithubApiError'
  }
}

/** 把状态码翻译成用户能照着做的话 */
function describeError(status: number, detail: string): string {
  switch (status) {
    case 401:
      return '令牌无效或已过期。请到 GitHub 重新生成一个再登录。'
    case 403:
      return '这枚令牌没有执行该操作的权限。请确认它已授权数据仓，且 Contents 权限为 Read and write。'
    case 404:
      return '找不到数据仓或其中的文件。请确认令牌已授权数据仓，且仓库里存在 db.json。'
    case 409:
      return '数据刚刚被别处改动过（冲突）。已经重新读取，请再试一次。'
    case 422:
      return '请求被 GitHub 拒绝，通常是提交内容不合法。'
    default:
      return `GitHub 返回 ${status}${detail ? `：${detail}` : ''}`
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string }
    return body.message ?? ''
  } catch {
    // 响应不是 JSON（例如网络中间层返回的错误页）—— 没有细节可用，交给状态码兜底
    return ''
  }
}

/** 发一次带凭据的请求并解析 JSON */
export async function githubRequest<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path.startsWith('http') ? path : `${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    const detail = await readErrorMessage(response)
    throw new GithubApiError(response.status, describeError(response.status, detail))
  }

  return (await response.json()) as T
}

/* ---------------------------------------------------------------------------
   Contents API —— 读写仓库里的单个文件
   ---------------------------------------------------------------------------
   这是这个项目**唯一的写路径**：后台保存 = 提交一次 db.json。
   --------------------------------------------------------------------------- */

/**
 * 文本 ⇄ base64。
 *
 * ⚠️ 不能直接 `btoa(text)`：`btoa` 只接受 latin1，中文会直接抛错。
 * 必须先编成 UTF-8 字节再逐字节转字符。
 * 导出是给测试桩复用的 —— 双方各写一份的话，编码写错反而两边一起错、互相掩盖。
 */
export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function decodeBase64(value: string): string {
  // GitHub 返回的 base64 带换行，得先去掉
  const binary = atob(value.replace(/\n/g, ''))
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder('utf-8').decode(bytes)
}

interface ContentResponse {
  /** base64 编码的文件内容（含换行） */
  content: string
  /** 该次提交后文件的新版本号 —— 下次写入必须带上它做乐观锁 */
  sha: string
}

/** 读文件。返回解码后的内容与版本号 */
export async function fetchFile(
  ref: GithubRepoRef,
  token: string,
): Promise<{ text: string; sha: string }> {
  const data = await githubRequest<ContentResponse>(
    `/repos/${ref.owner}/${ref.repo}/contents/${ref.path}?ref=${encodeURIComponent(ref.branch)}`,
    token,
  )
  return { text: decodeBase64(data.content), sha: data.sha }
}

/**
 * 提交文件。
 * `sha` 是**必须**的乐观锁参数：不带或带错都会被 GitHub 以 409 拒绝，
 * 从而避免两个管理员互相覆盖。
 */
export async function putFile(
  ref: GithubRepoRef,
  token: string,
  text: string,
  sha: string,
  message: string,
): Promise<string> {
  const result = await githubRequest<{ content: { sha: string } }>(
    `/repos/${ref.owner}/${ref.repo}/contents/${ref.path}`,
    token,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        content: encodeBase64(text),
        sha,
        branch: ref.branch,
      }),
    },
  )
  return result.content.sha
}

/** 读一个文件的 sha；文件不存在时返回 null（用于「覆盖上传」前先看看有没有旧文件） */
export async function fetchFileSha(ref: GithubRepoRef, token: string): Promise<string | null> {
  try {
    const data = await githubRequest<{ sha: string }>(
      `/repos/${ref.owner}/${ref.repo}/contents/${ref.path}` +
        `?ref=${encodeURIComponent(ref.branch)}`,
      token,
    )
    return data.sha
  } catch (error) {
    if (error instanceof GithubApiError && error.status === 404) return null
    throw error
  }
}

/**
 * 上传**二进制**文件（图片）。
 *
 * 与 `putFile` 的区别：内容已经是 base64 原样上送，**不经过 UTF-8 编码** ——
 * 把 JPEG 字节当文本处理会直接损坏文件。
 * `sha` 可选：带上表示覆盖已有文件，不带表示新建。
 *
 * 路径里带时间戳（由调用方决定），所以正常情况下永远是「新建」，
 * 也就不会踩到浏览器 / CDN 的图片缓存。
 */
export async function putBinaryFile(
  ref: GithubRepoRef,
  token: string,
  base64: string,
  message: string,
  sha?: string,
): Promise<string> {
  const result = await githubRequest<{ content: { sha: string } }>(
    `/repos/${ref.owner}/${ref.repo}/contents/${ref.path}`,
    token,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        content: base64,
        branch: ref.branch,
        ...(sha ? { sha } : {}),
      }),
    },
  )
  return result.content.sha
}

/**
 * 删除仓库里的一个文件。
 *
 * ⚠️ 删除**同样要带 sha**（Contents API 的删除也是乐观锁）——
 * 不带的话，如果这个文件刚被别处改过，就会删错版本。
 */
export async function deleteFile(
  ref: GithubRepoRef,
  token: string,
  sha: string,
  message: string,
): Promise<void> {
  await githubRequest(
    `/repos/${ref.owner}/${ref.repo}/contents/${ref.path}`,
    token,
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sha, branch: ref.branch }),
    },
  )
}

/** Blob → base64（不含 data URL 前缀）。图片上传用 */export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  // 分块拼接，避免超大文件时 `String.fromCharCode(...bytes)` 爆栈
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
