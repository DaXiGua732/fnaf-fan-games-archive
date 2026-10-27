/**
 * 一次性的真实浏览器 UI 测试入口（本地 / CI 共用）。
 *
 * 负责三件事，避免 workflow 里堆脆弱的 sleep / 手工后台进程：
 *   1. 用 `vite/bin/vite.js` 启动固定 `127.0.0.1:5173` 的开发服务器（strictPort）；
 *   2. 只认**本次子进程 stdout 的 ready 信号**（不靠端口 HTTP 200），再用 `BASE` 启动 UI 测试；
 *   3. 无论测试成功、失败还是收到中断信号，都清理自己启动的 Vite 进程。
 *
 * ⚠️ 测试必须保持“本机模式”：这里会清空 VITE_SUPABASE_*，避免 UI 用例把
 * 探针数据写进真实共享榜单。GitHub API 由 ui-test.mjs 在浏览器层拦截。
 *
 * Vite 输出完整写入 `.tmp/ui-ci-vite.log`，失败时随 UI 截图一起上传。
 */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createWriteStream, mkdirSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HOST = '127.0.0.1'
const PORT = Number(process.env.UI_CI_PORT ?? 5173)
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error(`UI_CI_PORT 不是合法端口：${process.env.UI_CI_PORT}`)
}
const BASE = `http://${HOST}:${PORT}`
const LOG_FILE = resolve(ROOT, '.tmp/ui-ci-vite.log')
const READY_TIMEOUT_MS = 30_000
const STOP_TIMEOUT_MS = 5_000

mkdirSync(dirname(LOG_FILE), { recursive: true })
const log = createWriteStream(LOG_FILE, { flags: 'w' })

let server = null
let uiProcess = null
let serverSpawnError = null
let interrupted = false
/** 只累积本次 Vite 子进程的输出，用于判断它是否真的 ready */
let viteOutput = ''
let viteReady = false

function writeLog(chunk, stream) {
  log.write(chunk)
  stream.write(chunk)
}

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms))
}

/** 子进程环境：显式关闭 Supabase，确保催资源榜落在本机模式 */
function isolatedEnv(extra = {}) {
  const env = { ...process.env, ...extra }
  for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']) {
    if (process.env[key]) {
      console.warn(`[ui-ci] 忽略外部 ${key}：UI 测试必须运行在本机模式`)
    }
    env[key] = ''
  }
  return env
}

function appendViteOutput(chunk) {
  viteOutput += chunk.toString()
  // 只保留尾部，避免长时间运行时无限增长；最后 20k 足够定位启动错误
  if (viteOutput.length > 20_000) viteOutput = viteOutput.slice(-20_000)
}

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

/**
 * Vite 的 ready 信号必须来自**本次子进程**的 stdout：
 * 同时看到 `ready in` 与本次监听地址，才认为就绪。
 * 绝不能仅凭端口返回 HTTP 200 判断 —— 那可能是别的开发服务器。
 */
function inspectViteOutput(chunk) {
  appendViteOutput(chunk)
  const text = stripAnsi(viteOutput)
  if (/ready in/i.test(text) && text.includes(`${HOST}:${PORT}`)) {
    viteReady = true
  }
}

function viteOutputTail() {
  const text = stripAnsi(viteOutput).trim()
  return text ? `\n--- Vite 输出（尾部）---\n${text.slice(-4_000)}` : ''
}

async function waitForReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (serverSpawnError) throw serverSpawnError
    if (server.exitCode !== null) {
      throw new Error(
        `Vite 在就绪前退出（退出码 ${String(server.exitCode)}）；` +
          `常见原因是端口 ${PORT} 已被占用或启动参数错误。` +
          viteOutputTail(),
      )
    }
    if (viteReady) return
    await wait(100)
  }
  throw new Error(
    `Vite 在 ${READY_TIMEOUT_MS / 1000} 秒内没有输出 ready（${HOST}:${PORT}）。` +
      viteOutputTail(),
  )
}

async function stopServer() {
  if (!server || server.exitCode !== null) return
  try {
    server.kill('SIGTERM')
  } catch {
    // 已经退出或无法发信号，下面继续确认
  }
  await Promise.race([once(server, 'exit'), wait(STOP_TIMEOUT_MS)])
  if (server.exitCode === null) {
    try {
      server.kill('SIGKILL')
    } catch {
      // 同上
    }
    await Promise.race([once(server, 'exit'), wait(1_000)])
  }
}

function runUiTest() {
  const child = spawn(process.execPath, [resolve(ROOT, 'scripts/ui-test.mjs')], {
    cwd: ROOT,
    env: isolatedEnv({ BASE }),
    stdio: 'inherit',
  })
  uiProcess = child

  return new Promise((resolveRun) => {
    child.on('error', (error) => resolveRun({ code: 1, error }))
    child.on('exit', (code, signal) =>
      resolveRun({ code: code ?? (signal ? 1 : 0), signal }),
    )
  })
}

async function main() {
  const viteBin = resolve(ROOT, 'node_modules/vite/bin/vite.js')
  console.log(
    `[ui-ci] 启动 Vite：${BASE}（日志：${relative(ROOT, LOG_FILE)}）`,
  )
  server = spawn(
    process.execPath,
    [viteBin, '--host', HOST, '--port', String(PORT), '--strictPort'],
    {
      cwd: ROOT,
      env: isolatedEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  server.on('error', (error) => {
    serverSpawnError = error
  })
  server.stdout.on('data', (chunk) => {
    inspectViteOutput(chunk)
    writeLog(chunk, process.stdout)
  })
  server.stderr.on('data', (chunk) => {
    appendViteOutput(chunk)
    writeLog(chunk, process.stderr)
  })

  await waitForReady()
  console.log('[ui-ci] Vite 已就绪，启动浏览器测试')

  const result = await runUiTest()
  if (result.error) throw result.error
  console.log(`[ui-ci] UI 测试退出码 ${result.code}`)
  return result.code
}

async function onSignal(signal) {
  if (interrupted) return
  interrupted = true
  console.error(`[ui-ci] 收到 ${signal}，清理 Vite 进程`)
  uiProcess?.kill('SIGTERM')
  await stopServer()
  log.end(() => process.exit(1))
}

process.once('SIGINT', () => void onSignal('SIGINT'))
process.once('SIGTERM', () => void onSignal('SIGTERM'))

let exitCode = 1
try {
  exitCode = await main()
} catch (error) {
  console.error(
    `[ui-ci] 失败：${error instanceof Error ? error.message : String(error)}`,
  )
  console.error(`[ui-ci] Vite 日志：${relative(ROOT, LOG_FILE)}`)
} finally {
  await stopServer()
  await new Promise((resolveEnd) => log.end(resolveEnd))
}

process.exitCode = exitCode
