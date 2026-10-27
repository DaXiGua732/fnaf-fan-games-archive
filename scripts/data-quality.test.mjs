/**
 * 资料质量检查 CLI 的退出码契约。
 *
 * 函数级断言只能证明 analyzeCatalog 报告正确；部署门禁依赖的是
 * `npm run check:data -- --strict` 在存在 error 时真的返回非零。
 * 这里用合成夹具跑真实命令，不读取、也不改写生产数据仓。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function cleanGame(overrides = {}) {
  return {
    id: 'clean',
    title: 'Clean Game',
    author: 'Clean Author',
    releaseYear: 2020,
    ipSeries: 'Clean Series',
    engine: 'Godot',
    coverImage: '/images/clean.png',
    bannerImage: '/images/clean-banner.png',
    gallery: [],
    description: 'Clean fixture.',
    downloads: [{ provider: 'Drive', url: 'https://example.com/clean' }],
    metrics: { fakeViews: 0, score: 0 },
    status: 'published',
    tags: [],
    altTitles: [],
    gameplayTypes: [],
    mechanics: [],
    platforms: [],
    relations: [],
    ...overrides,
  }
}

function catalog(games) {
  return {
    games,
    taxonomy: { gameplayTypes: [], mechanics: [], platforms: [] },
  }
}

/** 运行真实 npm script；返回退出码与合并后的输出 */
function runCheckData(file) {
  const npmExecPath = process.env.npm_execpath
  const command = npmExecPath ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const args = [
    ...(npmExecPath ? [npmExecPath] : []),
    'run',
    'check:data',
    '--',
    `--file=${file}`,
    '--strict',
  ]
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: !npmExecPath && process.platform === 'win32',
  })
  assert.equal(result.error, undefined, `无法启动 check:data：${result.error?.message}`)
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

test('check:data --strict：无 error 时退出 0，有 error 时退出非零', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fnaf-data-quality-'))
  try {
    const cleanFile = join(dir, 'clean.json')
    const brokenFile = join(dir, 'broken.json')
    writeFileSync(cleanFile, JSON.stringify(catalog([cleanGame()])), 'utf8')
    writeFileSync(
      brokenFile,
      JSON.stringify(catalog([cleanGame({ title: null })])),
      'utf8',
    )

    const clean = runCheckData(cleanFile)
    assert.equal(clean.status, 0, `干净夹具应退出 0：${clean.output}`)
    assert.match(clean.output, /error 0/)

    const broken = runCheckData(brokenFile)
    assert.equal(broken.status, 1, `含 error 的夹具应退出 1：${broken.output}`)
    assert.match(broken.output, /invalid-title/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
