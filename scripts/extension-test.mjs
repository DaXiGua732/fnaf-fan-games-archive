/**
 * ============================================================================
 * 浏览器扩展的端到端测试（本地运行，不进 CI）
 * ============================================================================
 * 不加载真实扩展（headless Chrome 对 MV3 扩展支持有限），而是把构建好的
 * `extension/dist/content.js` 注入一个被 Playwright 接管的 gamejolt.com 页面。
 *
 * 这样测到的仍然是扩展的真实代码路径：
 *   同源抓取 /site-api → 下载 CDN 图片 → 打包 ZIP → 触发下载
 * 只是跳过了「扩展安装」和「content script 隔离世界」这两层。
 *
 * 运行：npm run test:extension（会先构建扩展）
 * ============================================================================
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'
import { chromium } from 'playwright'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GAME_URL = 'https://gamejolt.com/games/test-game/123456'

const DETAIL = {
  payload: {
    game: {
      id: 123456,
      slug: 'test-game',
      title: 'Test Game',
      developer: { display_name: 'Tester' },
      published_on: Date.UTC(2021, 0, 1),
      creation_tool_human: 'Unity',
      category: 'Horror',
      description_content: 'A FNAF fan game used by the extension test.',
      thumbnail_media_item: {
        img_url: 'https://m.gjcdn.net/game-thumbnail/1000/cover.png',
        width: 1000,
      },
      header_media_item: {
        img_url: 'https://m.gjcdn.net/game-header/1600/banner.png',
        width: 1600,
      },
    },
  },
}

const OVERVIEW = {
  payload: {
    metaDescription: 'A FNAF fan game used by the extension test.',
    mediaItems: [
      {
        media_type: 'image',
        media_item: {
          img_url: 'https://m.gjcdn.net/game-screenshot/1600/one.png',
          width: 1600,
        },
      },
      {
        media_type: 'image',
        media_item: {
          img_url: 'https://m.gjcdn.net/game-screenshot/1600/two.png',
          width: 1600,
        },
      },
    ],
  },
}

// 一张 1000×600 的真实 PNG 夹具，用 canvas 生成，避免 SVG / 1×1 的坑
async function makePng(page) {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 1000
    canvas.height = 600
    const context = canvas.getContext('2d')
    context.fillStyle = '#ff0000'
    context.fillRect(0, 0, 1000, 600)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result.split(',')[1])
      reader.readAsDataURL(blob)
    })
  })
  return Buffer.from(base64, 'base64')
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ acceptDownloads: true })
const page = await context.newPage()

const png = await makePng(page)

await context.route('https://gamejolt.com/**', async (route) => {
  const url = new URL(route.request().url())

  if (url.pathname === '/games/test-game/123456') {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><body><h1>GameJolt Game Page</h1></body></html>',
    })
    return
  }

  if (url.pathname === '/site-api/web/discover/games/123456') {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(DETAIL),
    })
    return
  }

  if (url.pathname === '/site-api/web/discover/games/overview/123456') {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(OVERVIEW),
    })
    return
  }

  await route.fulfill({ status: 404, body: 'not found' })
})

await context.route('https://m.gjcdn.net/**', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'image/png',
    headers: { 'access-control-allow-origin': '*' },
    body: png,
  })
})

try {
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded' })
  await page.addScriptTag({ path: resolve(ROOT, 'extension/dist/content.js') })

  const button = page.getByRole('button', { name: '导出到 FNAF 档案', exact: true })
  await button.waitFor({ state: 'visible', timeout: 10_000 })

  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 })
  await button.click()

  const download = await downloadPromise
  const path = await download.path()
  assert.ok(path, '扩展没有触发 ZIP 下载')

  const files = unzipSync(new Uint8Array(readFileSync(path)))
  const manifest = JSON.parse(strFromU8(files['manifest.json']))
  const capture = JSON.parse(strFromU8(files['capture.json']))

  assert.equal(manifest.format, 'fnaf-archive-gamejolt-capture')
  assert.equal(manifest.version, 1)
  assert.equal(manifest.gameJoltId, 123456)
  assert.equal(capture.title, 'Test Game')
  assert.equal(capture.author, 'Tester')
  assert.equal(capture.releaseYear, 2021)
  assert.equal(capture.gallery.length, 2)
  assert.equal(manifest.images.length, 4)
  assert.ok(files['images/cover.png'])
  assert.ok(files['images/banner.png'])
  assert.ok(files['images/gallery-1.png'])
  assert.ok(files['images/gallery-2.png'])

  // 成功率提示由 content script 写在浮层里
  await page.getByText('已打包 4 张图片', { exact: false }).waitFor({ timeout: 10_000 })

  console.log('[PASS] 扩展 · 同源抓取 → 下载图片 → 打包 ZIP → 触发下载')
} finally {
  await browser.close()
}
