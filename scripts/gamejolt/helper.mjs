/**
 * ============================================================================
 * GameJolt 导入助手 —— 只监听 127.0.0.1 的小型 CORS 代理
 * ============================================================================
 * 用法：
 *
 *   npm run gamejolt:helper
 *
 * 然后回到后台「新增游戏 / 编辑游戏」页，把 GameJolt 作品页链接粘进
 * 「从 GameJolt 导入」区块。助手只做三件事：
 *
 *   1. 校验输入确实是 gamejolt.com 的作品链接 / 数字 ID；
 *   2. 由 Node 去请求 GameJolt 的站内 JSON 接口（浏览器直接请求会被跨域拦下）；
 *   3. 把**已经转换好**的字段返回给后台页面。
 *
 * 【安全边界】
 *   - 只绑定 127.0.0.1，不暴露到局域网；
 *   - 只允许本站后台与 localhost 开发页的 Origin（可用 GAMEJOLT_ALLOWED_ORIGIN 追加）；
 *   - 只按解析出的作品 ID 拼 GameJolt 固定地址，不会请求用户传入的任意 URL。
 *
 * 【它不是什么】
 *   不下载游戏文件、不写入数据仓、不保存任何凭据。图片由浏览器从 GameJolt CDN
 *   直接下载后走现有的 GitHub 上传链路 —— 助手完全碰不到数据仓令牌。
 * ============================================================================
 */
import http from 'node:http'
import { fetchGameJoltGame } from './fetch.mjs'
import { GameJoltInputError } from './parse.mjs'

const DEFAULT_PORT = 4317
const HOST = '127.0.0.1'
/** 同一个作品在 1 分钟内重复抓取时直接复用，避免反复打 GameJolt */
const CACHE_TTL_MS = 60_000
const cache = new Map()

function readPort() {
  const flagIndex = process.argv.indexOf('--port')
  const raw = flagIndex >= 0 ? process.argv[flagIndex + 1] : process.env.PORT
  const port = Number(raw || DEFAULT_PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`端口不合法：${raw}。请使用 1–65535 之间的整数。`)
    process.exit(1)
  }
  return port
}

/* --------------------------------------------------------------------------
   CORS
   --------------------------------------------------------------------------
   线上后台是 https://daxigua732.github.io，开发页是 http://localhost:<任意端口>。
   Chrome 从 HTTPS 页面访问 127.0.0.1 时还会发 Private Network Access 预检，
   必须显式回 Access-Control-Allow-Private-Network: true，否则请求会被静默拦下。
   -------------------------------------------------------------------------- */
const FIXED_ORIGINS = new Set(['https://daxigua732.github.io'])
const EXTRA_ORIGINS = (process.env.GAMEJOLT_ALLOWED_ORIGIN || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)

function isAllowedOrigin(origin) {
  if (!origin) return false
  if (FIXED_ORIGINS.has(origin) || EXTRA_ORIGINS.includes(origin)) return true

  try {
    const parsed = new URL(origin)
    const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
    return (
      localHosts.has(parsed.hostname) &&
      (parsed.protocol === 'http:' || parsed.protocol === 'https:')
    )
  } catch {
    return false
  }
}

function applyCors(req, res) {
  const origin = req.headers.origin
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Max-Age', '600')

  if (req.headers['access-control-request-private-network'] === 'true') {
    res.setHeader('Access-Control-Allow-Private-Network', 'true')
  }
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function describeError(error) {
  if (error instanceof GameJoltInputError) return { status: 400, message: error.message }
  if (error && typeof error.status === 'number') {
    return { status: error.status, message: error.message || '抓取失败' }
  }
  return {
    status: 502,
    message: error instanceof Error ? error.message : '抓取失败，请稍后重试。',
  }
}

async function handleGameJolt(res, input) {
  const raw = String(input ?? '').trim()
  if (!raw) {
    sendJson(res, 400, { ok: false, error: '缺少 url 参数（GameJolt 作品页链接或作品 ID）。' })
    return
  }

  const cached = cache.get(raw)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    console.log(`[gamejolt] 缓存命中：${raw}`)
    sendJson(res, 200, { ok: true, data: cached.data })
    return
  }

  console.log(`[gamejolt] 抓取：${raw}`)
  const data = await fetchGameJoltGame(raw)
  cache.set(raw, { at: Date.now(), data })
  console.log(`[gamejolt] 成功：#${data.gameJoltId} ${data.title}`)
  sendJson(res, 200, { ok: true, data })
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin

  // 浏览器带着不认识的 Origin 来：直接拒绝。没有 Origin 的是 curl / 本机探测，放行。
  if (origin && !isAllowedOrigin(origin)) {
    sendJson(res, 403, { ok: false, error: '不允许的来源。' })
    return
  }

  applyCors(req, res)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, error: '只支持 GET。' })
    return
  }

  let requestUrl
  try {
    requestUrl = new URL(req.url ?? '/', `http://${HOST}`)
  } catch {
    sendJson(res, 400, { ok: false, error: '请求地址不合法。' })
    return
  }

  try {
    if (requestUrl.pathname === '/health') {
      sendJson(res, 200, { ok: true, name: 'fnaf-gamejolt-helper', version: 1 })
      return
    }

    if (requestUrl.pathname === '/api/gamejolt') {
      await handleGameJolt(res, requestUrl.searchParams.get('url'))
      return
    }

    sendJson(res, 404, { ok: false, error: '没有这个接口。' })
  } catch (error) {
    const { status, message } = describeError(error)
    console.error(`[gamejolt] 失败：${message}`)
    sendJson(res, status, { ok: false, error: message })
  }
})

const port = readPort()

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error('')
    console.error(`端口 ${port} 已被占用。`)
    console.error('可能已经有一个助手在运行；或者用 --port 换一个端口，并在后台构建时设置 VITE_GAMEJOLT_HELPER。')
    process.exit(1)
  }
  console.error(error)
  process.exit(1)
})

server.listen(port, HOST, () => {
  console.log('')
  console.log('GameJolt 导入助手已启动')
  console.log(`  地址：http://${HOST}:${port}`)
  console.log('')
  console.log('现在回到后台「新增游戏」页，把 GameJolt 作品链接粘进「从 GameJolt 导入」。')
  console.log('保持这个窗口开启；按 Ctrl+C 停止。')
  console.log('')
})

function shutdown() {
  console.log('\n正在停止 GameJolt 导入助手……')
  server.close(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
