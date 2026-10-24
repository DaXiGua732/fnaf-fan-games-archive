/**
 * ============================================================================
 * GameJolt 抓取 —— 只负责网络，不做字段转换
 * ============================================================================
 * 两个端点都是 GameJolt 前台自己在用的站内接口：
 *
 *   /site-api/web/discover/games/<id>              → 标题 / 作者 / 简介 / 图片元数据
 *   /site-api/web/discover/games/overview/<id>     → 截图、视频、下载数等
 *
 * 【为什么需要本地助手】
 *   这两个接口不返回可跨域读取的 CORS 头，浏览器直接 fetch 会被拦下。
 *   助手跑在 127.0.0.1，由它去请求 GameJolt，再把 JSON 交给后台页面。
 *   它**不代理图片** —— GameJolt 的 m.gjcdn.net 本身带 `Access-Control-Allow-Origin: *`，
 *   图片由浏览器直接下载更省事，也少一条要维护的转发路径。
 *
 * 【接口是内部的】
 *   这不是官方公开 API，GameJolt 随时可能改字段。转换层对缺失字段一律降级，
 *   并在 warnings 里说清楚，绝不因为少了某个字段就整条导入失败。
 * ============================================================================
 */
import {
  GameJoltInputError,
  normalizeGameJoltData,
  parseGameJoltInput,
} from './parse.mjs'

const GAMEJOLT_BASE = 'https://gamejolt.com'
const REQUEST_TIMEOUT_MS = 20_000

/** 带一点浏览器气味：默认 Node UA 更容易被 Cloudflare 拦下 */
const REQUEST_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.8',
  referer: `${GAMEJOLT_BASE}/`,
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
}

class GameJoltFetchError extends Error {
  constructor(message, status = 502) {
    super(message)
    this.name = 'GameJoltFetchError'
    this.status = status
  }
}

async function requestJson(url, fetchImpl, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let response
  try {
    response = await fetchImpl(url, {
      headers: REQUEST_HEADERS,
      redirect: 'follow',
      signal: controller.signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new GameJoltFetchError('请求 GameJolt 超时，请检查网络后重试。', 504)
    }
    throw new GameJoltFetchError(`无法连接 GameJolt：${error?.message ?? '未知网络错误'}`, 502)
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new GameJoltFetchError('GameJolt 上找不到这个作品（可能已删除或下架）。', 404)
    }
    if (response.status === 403 || response.status === 429) {
      throw new GameJoltFetchError('GameJolt 暂时拒绝了请求，请稍后再试。', 502)
    }
    throw new GameJoltFetchError(`GameJolt 返回 HTTP ${response.status}。`, 502)
  }

  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new GameJoltFetchError('GameJolt 返回的不是合法 JSON，接口可能改版了。', 502)
  }
}

/**
 * 抓取并转换一条 GameJolt 作品。
 *
 * @param {string} input 作品页链接或裸 ID
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} options
 */
export async function fetchGameJoltGame(input, options = {}) {
  const parsed = parseGameJoltInput(input)
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS

  if (typeof fetchImpl !== 'function') {
    throw new GameJoltFetchError('当前 Node 没有可用的 fetch，请升级到 Node 18 或更高版本。', 500)
  }

  const detailUrl = `${GAMEJOLT_BASE}/site-api/web/discover/games/${parsed.id}`
  const overviewUrl = `${GAMEJOLT_BASE}/site-api/web/discover/games/overview/${parsed.id}?ignore`

  const warnings = []
  const [detailResult, overviewResult] = await Promise.allSettled([
    requestJson(detailUrl, fetchImpl, timeoutMs),
    requestJson(overviewUrl, fetchImpl, timeoutMs),
  ])

  if (detailResult.status === 'rejected') throw detailResult.reason

  let overview = {}
  if (overviewResult.status === 'rejected') {
    warnings.push(
      `截图 / 视频信息没有取到（${overviewResult.reason?.message ?? '未知原因'}），封面仍会尝试使用作品缩略图。`,
    )
  } else {
    overview = overviewResult.value
  }

  return normalizeGameJoltData(detailResult.value, overview, parsed, warnings)
}

export { GameJoltFetchError, GameJoltInputError }
