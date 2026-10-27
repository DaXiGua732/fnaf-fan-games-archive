/**
 * UI 启动器的端口竞争回归。
 *
 * 在测试进程里先占用一个端口并返回 HTTP 200（模拟“旧的 Vite 服务”），
 * 再让 `run-ui-test-ci.mjs` 使用同一端口启动。启动器必须：
 *   - 非零退出；
 *   - 不访问旧服务的 HTTP 200 当作 ready；
 *   - 不启动浏览器测试。
 *
 * 使用随机空闲端口（UI_CI_PORT），避免和本机正在运行的 dev server 抢 5173。
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function runRunner(port) {
  const child = spawn(process.execPath, [resolve(ROOT, 'scripts/run-ui-test-ci.mjs')], {
    cwd: ROOT,
    env: { ...process.env, UI_CI_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })
  return new Promise((resolveRun) => {
    child.on('error', (error) =>
      resolveRun({ code: 1, signal: null, output: `${output}\n${error.message}` }),
    )
    child.on('exit', (code, signal) =>
      resolveRun({ code: code ?? (signal ? 1 : 0), signal, output }),
    )
  })
}

test(
  'UI 启动器：端口被占用时失败，不把旧服务的 HTTP 200 当作 ready',
  { timeout: 20_000 },
  async () => {
    let requests = 0
    const blocker = createServer((_request, response) => {
      requests += 1
      response.writeHead(200, { 'Content-Type': 'text/html' })
      response.end('<html><body>old vite server</body></html>')
    })
    blocker.listen(0, '127.0.0.1')
    await once(blocker, 'listening')
    const address = blocker.address()
    assert.ok(address && typeof address === 'object', '测试服务器没有拿到端口')

    try {
      const result = await runRunner(address.port)
      assert.notEqual(result.code, 0, `端口占用时启动器应失败：\n${result.output}`)
      assert.equal(requests, 0, '启动器不应访问占用端口的旧 HTTP 服务')
      assert.match(result.output, new RegExp(`端口 ${address.port}|Port ${address.port}`))
      assert.doesNotMatch(result.output, /Vite 已就绪|UI 测试退出码|UI 点击测试/)
    } finally {
      blocker.close()
      await once(blocker, 'close')
    }
  },
)
