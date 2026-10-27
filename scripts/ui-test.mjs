/**
 * 真实浏览器 UI 点击测试
 *
 * 覆盖 SSR 冒烟测不到的部分：主题、筛选、后台编辑 / 批量 / 上传 / 预览 / 删除、
 * 催资源本机模式、GameJolt 导入与关系展示。
 *
 * 运行方式（二选一）：
 *   1. `npm run test:ui`：另开终端 `npm run dev`；默认使用 Playwright Chromium，
 *      首次先执行 `npx playwright install chromium`
 *   2. `npm run test:ui:ci`：自动启动 / 清理 Vite，供本地一次性验证与 CI 使用
 *
 * 本地想用系统 Chrome：`UI_BROWSER=chrome npm run test:ui`（或 test:ui:ci）。
 * 截图：`.tmp/ui-shots`（不纳入版本管理）
 *
 * 两个必须注意的坑（第一版脚本就栽在这上面）：
 *   1. `innerText` 会反映 CSS 的 `text-transform`。卡片标题带 `uppercase`，
 *      所以 innerText 是全大写的 —— 所有文本断言必须大小写不敏感。
 *   2. 状态 chip 的可访问名包含使用次数（「草稿 0」），`exact: true` 匹配不到，
 *      必须用 `^前缀` 正则。
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strToU8, zipSync } from 'fflate'
import { chromium } from 'playwright'

/** 项目根目录 —— 从脚本位置推导，不依赖启动时的 cwd */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const BASE = process.env.BASE ?? 'http://localhost:5173'
/** 生产构建下没有 DEV 门槛的视觉哨兵，跳过那一组 */
const PROD = process.env.PROD === '1'
const SHOTS = resolve(ROOT, `.tmp/ui-shots${PROD ? '-prod' : ''}`)
mkdirSync(SHOTS, { recursive: true })

const results = []
const consoleErrors = []
const badResponses = []

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function step(name, fn) {
  try {
    await fn()
    results.push({ name, pass: true })
    console.log(`[PASS] ${name}`)
  } catch (error) {
    results.push({ name, pass: false, error: error.message })
    console.log(`[FAIL] ${name}\n        ${error.message}`)
  }
}

const browserChannel = process.env.UI_BROWSER === 'chrome' ? 'chrome' : undefined
const browser = await chromium.launch({
  headless: true,
  ...(browserChannel ? { channel: browserChannel } : {}),
})
// ⚠️ 用 context 挂拦截，而不是 page —— 预览功能会开新标签页，
//    page.route 只对本页生效，新标签页里的请求就没人拦了。
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()

/**
 * 有一段测试会**故意**打出 401（验证「令牌无效」时的报错文案是不是人话）。
 * 那段时间里把监听摘掉 —— 否则最后那条「控制台无报错」会被自己的测试污染，
 * 得到一个既不是真问题、又解释不清的失败。
 * 用开关而不是放宽断言：断言本身不能变松。
 */
let testingFailurePath = false

page.on('pageerror', (e) => {
  if (!testingFailurePath) consoleErrors.push(`pageerror: ${e.message}`)
})
page.on('console', (m) => {
  if (m.type() === 'error' && !testingFailurePath) {
    consoleErrors.push(`console.error: ${m.text()}`)
  }
})
page.on('response', (r) => {
  if (r.status() >= 400 && !testingFailurePath) {
    badResponses.push(`${r.status()} ${new URL(r.url()).pathname}`)
  }
})

const hash = (p) => `${BASE}/#${p}`
/**
 * 打开一个页面，**保证是一次干净的加载**。
 *
 * ⚠️ 只改 hash 时浏览器不会刷新文档，而筛选条件、草稿、结果提示条都是模块级状态 ——
 * 于是 `go('/')` 之后上一轮的年份筛选还挂着，搜索会得到 0 条；
 * `go('/admin/taxonomy')` 之后上一轮的重命名提示条还在，断言「旧标签名不再出现」就会假失败。
 * 原先的 `page.goto` 在「目标 URL 与当前 URL 完全相同」时甚至什么都不做。
 * 因此这里在 goto 之后强制 reload：go 的语义是「重新进入」，需要保留内存状态时用 nav()。
 */
async function go(p, waitText) {
  await page.goto(hash(p), { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  if (waitText) await page.getByText(waitText, { exact: false }).first().waitFor({ timeout: 8000 })
  await page.waitForTimeout(250)
}

/**
 * 页内导航：只改 hash，**不刷新页面**。
 *
 * ⚠️ 需要保持内存状态时必须用它。后台的写入目前只存在内存里，
 * 一次刷新就会丢 —— 所以「后台改状态 → 前台立刻受影响」这类测试
 * 绝不能中途 goto/reload。
 */
async function nav(p, waitText) {
  await page.evaluate((target) => {
    window.location.hash = target
  }, `#${p}`)
  if (waitText) await page.getByText(waitText, { exact: false }).first().waitFor({ timeout: 8000 })
  await page.waitForTimeout(300)
}
const body = () => page.locator('body').innerText()

/** 大小写不敏感的包含判断 */
async function has(needle) {
  const t = await body()
  return t.toLowerCase().includes(needle.toLowerCase())
}
async function need(needle) {
  assert(await has(needle), `页面未包含「${needle}」`)
}
async function needNot(needle) {
  assert(!(await has(needle)), `页面不应包含「${needle}」`)
}

const rowCount = () => page.locator('table tbody tr').count()
const btn = (name) => page.getByRole('button', { name, exact: true }).first()
/** 状态 chip：可访问名形如「草稿 0」，用前缀正则匹配 */
const chip = (label) => page.getByRole('button', { name: new RegExp(`^${label}`) }).first()
const link = (name) => page.getByRole('link', { name, exact: true }).first()
const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })

/* ======================================================================
   拦截 GitHub API —— 用一个内存里的「假数据仓」应答
   ======================================================================
   登录之后后台的数据源就是真实的远程仓储，它会去打 api.github.com。
   测试里既不该用真令牌、也不该真的往数据仓写东西，
   所以在网络层拦下来，让后台用例走的**仍然是真实那条代码路径**。
   顺带还让「刷新后改动仍在」变成真的跨刷新验证 —— 假数据仓活在测试进程里。
   ====================================================================== */
const localDb = JSON.parse(
  readFileSync(resolve(ROOT, 'src/data/db.json'), 'utf8'),
)

/**
 * 起点数量从数据推导，不写死。
 *
 * ⚠️ `src/data/db.json` 是「上次构建用的快照」，会随 `data:pull` 变化；
 * 写死「6 款」会让一次正常的数据更新把 UI 测试弄挂。
 */
const isPublished = (game) => (game.status ?? 'published') === 'published'
const VISIBLE_GAMES = localDb.games.filter((game) => isPublished(game) && !game.archived)
/** 后台列表默认视图 = 未归档的全部状态 */
const ADMIN_GAMES = localDb.games.filter((game) => !game.archived)
const TOTAL_COUNT = ADMIN_GAMES.length
const VISIBLE_COUNT = VISIBLE_GAMES.length
const DRAFT_COUNT = ADMIN_GAMES.filter((game) => game.status === 'draft').length
const ARCHIVED_COUNT = localDb.games.filter((game) => game.archived).length

/**
 * 测试主对象：优先选一条「封面 / Banner / 至少 2 张图库 / 至少 2 个下载」的可见作品，
 * 因为后续要测图库排序、下载行排序、发布状态。
 * 数据被编辑到不满足条件时退回第一款可见作品，测试里的分支会相应降级。
 */
const TEST_GAME =
  VISIBLE_GAMES.find(
    (game) =>
      game.coverImage &&
      game.bannerImage &&
      (game.gallery?.length ?? 0) >= 2 &&
      (game.downloads?.length ?? 0) >= 2,
  ) ??
  VISIBLE_GAMES.find((game) => game.coverImage && game.bannerImage) ??
  VISIBLE_GAMES[0] ??
  localDb.games[0]
const TEST_GAME_ID = TEST_GAME?.id ?? ''
const TEST_GAME_TITLE = TEST_GAME?.title ?? ''
const TEST_GAME_GALLERY = TEST_GAME?.gallery?.length ?? 0
const TEST_GAME_DOWNLOADS = TEST_GAME?.downloads?.length ?? 0

/** 用于「改状态 → 刷新仍在」的另一个可见作品（尽量不与主对象重合） */
const OTHER_GAME = VISIBLE_GAMES.find((game) => game.id !== TEST_GAME_ID) ?? TEST_GAME

/** 前台年份筛选探针：取可见作品里最新的年份，命中数从数据推导 */
const YEAR_PROBE = [...new Set(VISIBLE_GAMES.map((game) => game.releaseYear))].sort(
  (a, b) => b - a,
)[0]
const YEAR_PROBE_COUNT = VISIBLE_GAMES.filter((game) => game.releaseYear === YEAR_PROBE).length

/** 前台搜索探针：用完整标题，命中数从数据推导（避免标题互为子串时写死 1） */
const SEARCH_PROBE = TEST_GAME_TITLE
const SEARCH_PROBE_COUNT = VISIBLE_GAMES.filter((game) =>
  game.title.toLowerCase().includes(SEARCH_PROBE.toLowerCase()),
).length

/** 至少两张图库的详情页探针（灯箱需要前后切换） */
const LIGHTBOX_GAME = VISIBLE_GAMES.find((game) => (game.gallery?.length ?? 0) >= 2)

/** 后台搜索探针：用完整标题，命中数按后台搜索字段口径推导（不含归档） */
const ADMIN_SEARCH_PROBE = TEST_GAME_TITLE
const ADMIN_SEARCH_COUNT = ADMIN_GAMES.filter((game) =>
  `${game.title} ${game.author} ${game.ipSeries} ${game.engine} ${(game.tags ?? []).join(' ')}`
    .toLowerCase()
    .includes(ADMIN_SEARCH_PROBE.toLowerCase()),
).length

let fakeDb = JSON.parse(JSON.stringify(localDb))
let fakeSha = 'sha-1'
let fakeCommits = 0

/**
 * 排序测试专用合成记录。
 *
 * 只临时追加到内存假数据仓（fakeDb），不会写入生产快照或真实 GitHub；
 * 步骤结束（含失败）时恢复原数组，避免影响后续用例的数量 / 搜索断言。
 */
function sortProbeGame(id, title) {
  return {
    id,
    title,
    author: 'UI Sort Fixture',
    releaseYear: 2020,
    ipSeries: '',
    engine: '',
    coverImage: '',
    bannerImage: '',
    gallery: [],
    description: 'Synthetic sorting fixture.',
    downloads: [],
    metrics: { fakeViews: 0, score: 0 },
    tags: [],
    altTitles: [],
    gameplayTypes: [],
    mechanics: [],
    platforms: [],
    relations: [],
    developmentStatus: 'unknown',
    status: 'draft',
    featured: false,
    archived: false,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    publishedAt: '',
  }
}

const toBase64 = (text) => Buffer.from(text, 'utf8').toString('base64')

await context.route('https://api.github.com/**', async (route) => {
  const request = route.request()
  const url = request.url()
  const auth = request.headers()['authorization'] ?? ''
  const json = (body, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

  // 登录校验走的两个端点
  if (url.endsWith('/user')) {
    // 只有植入的那枚「测试令牌」被认作有效；其余一律 401（用来验错误文案）
    return auth.includes('github_pat_test_only_not_a_real_token')
      ? json({ login: 'test-admin' })
      : json({ message: 'Bad credentials' }, 401)
  }

  if (request.method() === 'PUT') {
    const body = JSON.parse(request.postData())

    // ⚠️ 按路径区分：只有 db.json 才是「数据」。图片上传写的是另一个文件，
    //    拿它去覆盖数据内容的话，后续读取会把一张 PNG 当 JSON 解析。
    if (!url.endsWith('/db.json')) {
      return json({ content: { sha: 'sha-image' } })
    }

    fakeDb = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'))
    fakeSha = `sha-${(fakeCommits += 1) + 1}`
    return json({ content: { sha: fakeSha } })
  }

  return json({ content: toBase64(JSON.stringify(fakeDb)), sha: fakeSha })
})

/**
 * 把本地存档清干净，回到出厂数据。
 *
 * ⚠️ Phase 12 起后台改动会落在 `localStorage` 里、刷新不丢 ——
 * 所以每次跑测试都必须先清一次，否则第二次跑会读到上一次留下的数据，
 * 断言「起点 6 款」之类的就会假失败。
 */
async function resetLocalData() {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(300)
}

// 整个测试从出厂数据开始（此时**未登录**，正好用来验门禁）
await resetLocalData()

/* ======================================================================
   〇、主题系统 —— 模式 / 强调色 / 持久化 / 深色首屏
   ====================================================================== */
await step('主题 · 切夜间 + 靛蓝，颜色与设置都持久化', async () => {
  await go('/', 'FNAF Fan Games')
  const themeButton = page.getByRole('button', { name: '主题', exact: true }).first()

  await themeButton.click()
  await page.getByRole('button', { name: '夜间', exact: true }).click()
  await page.getByRole('button', { name: '靛蓝', exact: true }).click()
  // body 的颜色过渡是 150ms，等它落定再读 computed style
  await page.waitForTimeout(250)

  const darkState = await page.evaluate(() => ({
    mode: document.documentElement.dataset.mode,
    theme: document.documentElement.dataset.theme,
    colorScheme: document.documentElement.style.colorScheme,
    bodyBg: getComputedStyle(document.body).backgroundColor,
  }))
  assert(darkState.mode === 'dark', `data-mode 应为 dark，实际 ${darkState.mode}`)
  assert(darkState.theme === 'blue', `data-theme 应为 blue，实际 ${darkState.theme}`)
  assert(darkState.colorScheme === 'dark', 'color-scheme 应同步为 dark')
  assert(
    darkState.bodyBg === 'rgb(20, 20, 19)',
    `夜间 body 背景应取深纸色，实际 ${darkState.bodyBg}`,
  )

  // 刷新后由 index.html 的早期脚本恢复，不能先闪回日间
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(250)
  const persisted = await page.evaluate(() => ({
    mode: document.documentElement.dataset.mode,
    theme: document.documentElement.dataset.theme,
  }))
  assert(persisted.mode === 'dark', `刷新后 data-mode 应为 dark，实际 ${persisted.mode}`)
  assert(persisted.theme === 'blue', `刷新后 data-theme 应为 blue，实际 ${persisted.theme}`)

  // 复位到默认浅色 + 赤红，保证后续截图与对比度断言稳定
  await page.getByRole('button', { name: '主题', exact: true }).first().click()
  await page.getByRole('button', { name: '日间', exact: true }).click()
  await page.getByRole('button', { name: '赤红', exact: true }).click()
  await page.keyboard.press('Escape')
  const reset = await page.evaluate(() => ({
    mode: document.documentElement.dataset.mode,
    theme: document.documentElement.dataset.theme,
  }))
  assert(reset.mode === 'light' && reset.theme === 'red', '主题应复位为 light/red')
  await shot('02-theme')
})

/* ======================================================================
   〇、催资源 —— 先搜站内、再提交、+1 与自动已收录（本机模式）
   ====================================================================== */
const REQUEST_TITLE = 'ZZZ UI Resource Request Probe'

await step('催资源 · 站内精确命中时只给详情入口，不引导提交', async () => {
  await go('/', '游戏库')
  // 这些用例会写本机 localStorage；如果开发服务器配了 Supabase，
  // 必须在这里停住，否则探针数据会写进真实共享榜单。
  const modeNote = await page.locator('#request-board').innerText()
  assert(
    modeNote.includes('本机模式'),
    '催资源 UI 测试必须在本机模式运行（不要给测试用 dev server 配置 Supabase）',
  )

  await page.getByRole('button', { name: /催一个资源/ }).first().click()
  const dialog = page.getByRole('dialog')
  const input = dialog.getByLabel('想要什么资源？')

  // 只有符号的输入不应被允许提交
  await input.fill('★★')
  const submit = dialog.getByRole('button', { name: /提交催资源/ })
  assert(await submit.isDisabled(), '只有符号时提交按钮应禁用')
  await dialog.getByText('请至少输入一个文字或数字。').waitFor()

  // 输入法组合中的 Escape 只取消候选词，不能关掉弹窗
  await input.fill('Jolly')
  await page.evaluate(() => {
    const el = document.querySelector('#resource-request-input')
    if (!el) return
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    Object.defineProperty(event, 'isComposing', { value: true })
    el.dispatchEvent(event)
  })
  await page.waitForTimeout(100)
  assert((await page.getByRole('dialog').count()) === 1, '输入法组合中的 Escape 不应关闭弹窗')

  // 用「去掉冒号 / 追加标点」的写法命中同一款作品，验证归一化匹配
  const punctuatedTitle = `${TEST_GAME_TITLE}!!`
  await input.fill(punctuatedTitle)
  await dialog.getByText('站内已收录').waitFor({ timeout: 5000 })
  await dialog.getByText('打开详情').waitFor()
  const submitButtons = await dialog.getByRole('button', { name: /提交催资源/ }).count()
  assert(submitButtons === 0, '站内已精确命中时不应出现提交按钮')

  // 「在游戏库中筛选」必须落到作品本身，而不是原始带标点的输入
  await dialog.getByRole('button', { name: '在游戏库中筛选' }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  await page.waitForFunction(() => document.activeElement?.id === 'library-search')
  const libraryQuery = await page.inputValue('#library-search')
  assert(libraryQuery === TEST_GAME_TITLE, `游戏库搜索词应为作品标题，实际 ${libraryQuery}`)
  await page.locator('#library').getByText(TEST_GAME_TITLE, { exact: false }).first().waitFor()
  assert((await page.getByText('No Results').count()) === 0, '站内已命中时游戏库不应显示无结果')

  // 清掉搜索，避免影响后面的「首页渲染全部作品」用例
  await page.getByRole('button', { name: '清除全部筛选' }).click()
  await page.waitForFunction(
    (count) => document.querySelectorAll('article').length === count,
    VISIBLE_COUNT,
  )
})

await step('催资源 · 提交后在排行榜出现，且同浏览器不能重复投票', async () => {
  await go('/', '游戏库')
  await page.getByRole('button', { name: /催一个资源/ }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('想要什么资源？').fill(REQUEST_TITLE)
  await dialog.getByRole('button', { name: /提交催资源/ }).click()
  await dialog.getByText('已记录').waitFor({ timeout: 5000 })
  await need(REQUEST_TITLE)
  await dialog.getByRole('button', { name: '完成', exact: true }).click()

  const item = page.locator('#request-board li').filter({ hasText: REQUEST_TITLE }).first()
  await item.waitFor({ timeout: 5000 })
  assert((await item.innerText()).includes('1 人催'), '新请求应显示 1 人催')

  // 再打开对话框：应识别为已有请求，并因本浏览器已投过而禁用 +1
  await page.getByRole('button', { name: /催一个资源/ }).first().click()
  const again = page.getByRole('dialog')
  await again.getByLabel('想要什么资源？').fill(REQUEST_TITLE)
  await again.getByText('已有 1 人催过').waitFor({ timeout: 5000 })
  const votedButton = again.getByRole('button', { name: /加一票/ })
  assert(await votedButton.isDisabled(), '同一浏览器重复催同一资源时 +1 应禁用')
  assert(
    (await votedButton.innerText()).includes('你已催过'),
    '同浏览器已投时按钮文案应为「你已催过」',
  )
  assert(
    (await again.getByRole('button', { name: /提交催资源/ }).count()) === 0,
    '已有同标题请求时不应再显示提交按钮',
  )
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'detached' })
})

await step('催资源 · 换一个浏览器身份 +1，票数增加到 2', async () => {
  // 清掉浏览器身份与「已投」标记，模拟另一位访客；请求本身保留
  await page.evaluate(() => {
    localStorage.removeItem('fnaf-archive:request-client:v1')
    localStorage.removeItem('fnaf-archive:request-voted:v1')
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(300)

  const item = page.locator('#request-board li').filter({ hasText: REQUEST_TITLE }).first()
  await item.waitFor({ timeout: 5000 })
  const voteButton = item.getByRole('button', { name: /加一票/ })
  await voteButton.click()
  await page.getByText(`已为《${REQUEST_TITLE}》加一票。`).waitFor({ timeout: 5000 })
  assert((await item.innerText()).includes('2 人催'), '第二位访客 +1 后应显示 2 人催')
  assert(await voteButton.isDisabled(), '+1 成功后按钮应禁用')
  assert((await voteButton.innerText()).includes('已催'), '+1 成功后按钮应显示「已催」')
})

await step('催资源 · 站内出现同名作品后自动移入「已收录」', async () => {
  await page.evaluate((gameTitle) => {
    const key = 'fnaf-archive:resource-requests:v1'
    const fallback = { version: 1, requests: [], votes: {} }
    let state
    try {
      state = JSON.parse(localStorage.getItem(key) || 'null') || fallback
    } catch {
      state = fallback
    }
    const id = 'ui-fulfilled-request'
    state.requests = (state.requests || []).filter((request) => request.id !== id)
    state.requests.push({
      id,
      title: gameTitle,
      votes: 3,
      createdAt: new Date().toISOString(),
      createdBy: 'ui-fulfilled-client',
    })
    state.votes = state.votes || {}
    state.votes[id] = ['ui-fulfilled-client']
    localStorage.setItem(key, JSON.stringify(state))
  }, TEST_GAME_TITLE)

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(300)
  const details = page.locator('#request-board details')
  await details.waitFor({ timeout: 5000 })
  assert((await details.innerText()).includes('已收录'), '同名作品出现后应显示已收录折叠区')
  // 折叠状态下 innerText 不含内部内容，先展开再断言标题与详情链接
  await details.locator('summary').click()
  assert((await details.innerText()).includes(TEST_GAME_TITLE), '已收录区应链接到同名作品')
  await shot('03-request-board')
})

/**
 * 用浏览器自己的 canvas 生成一张**指定尺寸的真实 PNG**。
 *
 * ⚠️ 不要用 SVG 当夹具：`createImageBitmap` 在 Chrome 里解不了 SVG blob，
 * 会走「读不出尺寸」那条分支 —— 于是你以为在测尺寸校验，其实测的是解码失败。
 * 也别用手写的 1×1 PNG：尺寸校验就是要拦小图，1×1 会被拦下来（这正是它该做的）。
 */
async function makePng(width, height) {
  const base64 = await page.evaluate(
    async ({ w, h }) => {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ff0000'
      ctx.fillRect(0, 0, w, h)
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      return await new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result.split(',')[1])
        reader.readAsDataURL(blob)
      })
    },
    { w: width, h: height },
  )
  return Buffer.from(base64, 'base64')
}

/**
 * 给测试植入一个假令牌，让登录门禁放行。
 *
 * ⚠️ **必须配合一次真刷新**：认证状态是模块级 ref，只在模块加载时读一次 localStorage，
 *    所以植入之后不刷新的话，内存里仍然是「未登录」。
 *
 * ⚠️ 这是**为了测后台 UI**，不是测真实的 GitHub 写入 —— 真令牌不该进测试脚本。
 *    真实的写入路径由站长自己用真令牌在浏览器里验一次。
 *    （等接上远程仓储后，这里要改用 page.route 拦截网络请求。）
 */
async function plantToken() {
  await page.evaluate(
    (key) => localStorage.setItem(key, 'github_pat_test_only_not_a_real_token'),
    'fnaf-archive:admin-token:v1',
  )
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(300)
}

/* ======================================================================
   一·五、Phase 15 —— 登录门禁
   ====================================================================== */
await step('Phase 15 · 未登录访问后台会被拦到登录页', async () => {
  await nav('/admin/games', '管理登录')
  await need('细粒度访问令牌')
  await need('粘贴令牌')
  assert(page.url().includes('/admin/login'), `应跳到登录页，实际：${page.url()}`)
  // 后台内容不该漏出来
  await needNot('收录作品')
  await shot('37-login-gate')
})

await step('Phase 15 · 令牌无效时给出可照着做的报错', async () => {
  testingFailurePath = true
  await page.fill('input[type=password]', 'github_pat_this_is_not_a_real_token_at_all')
  await btn('登录').click()
  // 会真打一次 GitHub API：401 必须被翻译成人话，而不是甩个状态码
  await page.waitForTimeout(5000)
  await need('令牌无效或已过期')
  assert(page.url().includes('/admin/login'), '校验失败时不该放行')
  await shot('38-login-error')
  testingFailurePath = false
})

await step('Phase 15 · 有令牌时后台恢复可用', async () => {
  await plantToken()
  await nav('/admin/games', '收录作品')
  await need('已登录')
  await need('登出')
  await shot('39-logged-in')
})

/* ======================================================================
   一、公开站回归 —— 后台做了 6 个阶段，前台必须一点没变
   ====================================================================== */
await step('公开站 · 首页渲染出全部可见作品', async () => {
  await go('/', 'FNAF Fan Games')
  await page.waitForTimeout(400)
  await need('游戏库')
  await need('关键词搜索')
  await need(TEST_GAME_TITLE)
  const cards = await page.locator('article').count()
  assert(cards === VISIBLE_COUNT, `首页卡片数应为 ${VISIBLE_COUNT}，实际 ${cards}`)
  await shot('01-home')
})

await step(`公开站 · 筛选：点年份 ${YEAR_PROBE} → 命中 ${YEAR_PROBE_COUNT} 款`, async () => {
  await go('/', '游戏库')
  await btn(String(YEAR_PROBE)).click()
  await page
    .getByText(`命中 ${YEAR_PROBE_COUNT} 款`, { exact: false })
    .first()
    .waitFor({ timeout: 5000 })
  await shot('02-home-filter-year')
})

await step(`公开站 · 搜索完整标题 → 命中 ${SEARCH_PROBE_COUNT} 款`, async () => {
  // 上一步的年份筛选是会话内状态，先回到干净首页再搜索。
  await go('/', '游戏库')
  await page.fill('#library-search', SEARCH_PROBE)
  await page
    .getByText(`命中 ${SEARCH_PROBE_COUNT} 款`, { exact: false })
    .first()
    .waitFor({ timeout: 5000 })
  const cards = await page.locator('article').count()
  assert(cards === SEARCH_PROBE_COUNT, `应剩 ${SEARCH_PROBE_COUNT} 张卡片，实际 ${cards}`)
})

await step('公开站 · 点卡片进入详情页', async () => {
  // 链接是包在 article **外面**的（RouterLink > Card > article），所以点 article 本身
  await go('/', '游戏库')
  await page.locator('article').first().click()
  await page.getByText('资源下载', { exact: false }).first().waitFor({ timeout: 8000 })
  assert(page.url().includes('/game/'), `URL 未跳到详情页：${page.url()}`)
  await shot('03-detail')
})

await step('详情页 · 截图灯箱支持键盘切换与关闭', async () => {
  if (!LIGHTBOX_GAME) {
    console.log('        （当前数据没有 ≥2 张图库的作品，跳过灯箱切换）')
    return
  }
  await go(`/game/${LIGHTBOX_GAME.id}`, '资源下载')
  const thumbs = page.getByRole('button', { name: /查看第 \d+ 张截图的大图/ })
  const count = await thumbs.count()
  assert(count >= 2, `详情页应至少渲染 2 张截图，实际 ${count}`)

  await thumbs.first().click()
  await page.getByText(new RegExp(`截图 1 / ${count}`)).waitFor({ timeout: 5000 })

  await page.keyboard.press('ArrowRight')
  await page.getByText(new RegExp(`截图 2 / ${count}`)).waitFor({ timeout: 5000 })

  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  assert((await page.getByRole('dialog').count()) === 0, '按 Esc 后灯箱应关闭')
  await shot('03b-lightbox')
})

await step('前台导航有「后台管理」入口，点击即可进后台', async () => {
  await go('/', '游戏库')
  const entry = page.getByRole('link', { name: '后台管理', exact: true }).first()
  assert((await entry.count()) > 0, '前台 Header 里找不到「后台管理」入口')
  const href = await entry.getAttribute('href')
  assert(href === '#/admin/games', `入口 href 不对：${href}`)

  await entry.click()
  // ⚠️ 等待文案必须**只属于后台** —— 用「收录作品」会立刻命中前台 Hero 的统计标签，
  //    等于没等导航完成，随后读到的 URL 还是前台的。
  await page.getByText('Sections', { exact: false }).first().waitFor({ timeout: 8000 })
  await page.waitForTimeout(300)
  assert(page.url().includes('/admin/games'), `点击后未进入后台：${page.url()}`)
  await need('收录作品')
  await shot('33-admin-entry')
})

/* ======================================================================
   二、Phase 1 —— 两套外壳完全分离
   ====================================================================== */
await step('Phase 1 · 后台不继承公开站 Footer', async () => {
  await go('/admin/games', '游戏管理')
  await need('Sections')
  await needNot('非商业性质的粉丝向资源导航站')
})

await step('Phase 1 · 公开站不出现后台 Header', async () => {
  await go('/', '游戏库')
  await needNot('Sections')
  await needNot('跳到后台主内容')
})

await step('Phase 1 · 输错的后台地址落在后台 404', async () => {
  await go('/admin/nowhere', '后台没有这个页面')
  await need('前往游戏管理')
  await needNot('非商业性质的粉丝向资源导航站')
})

/* ======================================================================
   三、Phase 2 —— 游戏管理列表
   ====================================================================== */
await step('Phase 2 · 列表默认展示全部作品', async () => {
  await go('/admin/games', '收录作品')
  const n = await rowCount()
  assert(n === TOTAL_COUNT, `应有 ${TOTAL_COUNT} 行，实际 ${n}`)
  await need('还没选中作品')
  await need('已上线')
  await shot('04-admin-games')
})

await step(`Phase 2 · 搜索完整标题 → ${ADMIN_SEARCH_COUNT} 行`, async () => {
  await page.fill('#admin-search', ADMIN_SEARCH_PROBE)
  await page.waitForTimeout(300)
  const n = await rowCount()
  assert(n === ADMIN_SEARCH_COUNT, `应有 ${ADMIN_SEARCH_COUNT} 行，实际 ${n}`)
})

await step(`Phase 2 · 状态筛选「草稿」→ ${DRAFT_COUNT} 行`, async () => {
  await page.fill('#admin-search', '')
  await page.waitForTimeout(200)
  await chip('草稿').click()
  await page.waitForTimeout(300)
  if (DRAFT_COUNT === 0) {
    await need('No Results')
    const n = await rowCount()
    assert(n === 1, `空状态应只有 1 行提示，实际 ${n}`)
  } else {
    const n = await rowCount()
    assert(n === DRAFT_COUNT, `草稿应有 ${DRAFT_COUNT} 行，实际 ${n}`)
  }
  await chip('全部').click()
  await page.waitForTimeout(300)
})

await step('Phase 2 · 排序切「游戏名称」→ 两条合成记录真正升序', async () => {
  // 只用临时合成 fixture 验证排序，不依赖生产数据里有哪些标题 / 多少条。
  // 插入顺序故意是 B → A；若排序实现失效（保留插入顺序），下面的断言必须失败。
  const originalGames = fakeDb.games
  try {
    fakeDb.games = [
      ...originalGames,
      sortProbeGame('ui-sort-probe-b', 'ZZZ Sort Probe B'),
      sortProbeGame('ui-sort-probe-a', 'ZZZ Sort Probe A'),
    ]

    // 重新加载后台，让远程仓储读取到含合成记录的假数据仓
    await go('/admin/games', '收录作品')
    await page.fill('#admin-search', 'ZZZ Sort Probe')
    await page.waitForTimeout(600)
    assert((await rowCount()) === 2, `合成排序记录应有 2 行，实际 ${await rowCount()}`)

    await page.locator('#admin-filter-sort').selectOption('title')
    await page.waitForTimeout(400)
    const cells = await page.locator('table tbody tr td:nth-child(3) a').allInnerTexts()
    const titles = cells.map((text) => text.replace(/\s+/g, ' ').trim())
    assert(
      titles.join('|') === 'ZZZ Sort Probe A|ZZZ Sort Probe B',
      `标题升序应为 A → B，实际 ${JSON.stringify(titles)}`,
    )
  } finally {
    // 永远恢复假数据仓，避免污染后续的数量 / 搜索 / 分页断言
    fakeDb.games = originalGames
    await go('/admin/games', '收录作品')
  }
})

await step('Phase 2 · 每页条数可调小 → 分页控件随数据出现', async () => {
  const options = await page.locator('#admin-page-size option').allTextContents()
  assert(options.join(',') === '5,10,20,50,100', `每页选项不符：${options.join(',')}`)

  await page.locator('#admin-page-size').selectOption('5')
  await page.waitForTimeout(400)
  const PAGE_COUNT = Math.ceil(TOTAL_COUNT / 5)
  let n = await rowCount()
  assert(n === Math.min(5, TOTAL_COUNT), `每页 5 条时应有 ${Math.min(5, TOTAL_COUNT)} 行，实际 ${n}`)
  await need(`1 / ${PAGE_COUNT}`)
  await shot('05a-admin-paging')

  if (PAGE_COUNT > 1) {
    await btn('下一页').click()
    await page.waitForTimeout(400)
    n = await rowCount()
    const secondPageRows = TOTAL_COUNT - 5
    assert(n === secondPageRows, `第 2 页应有 ${secondPageRows} 行，实际 ${n}`)
    await need(`2 / ${PAGE_COUNT}`)
    assert(await btn('下一页').isDisabled(), '末页时「下一页」应禁用')

    await btn('上一页').click()
    await page.waitForTimeout(400)
    await need(`1 / ${PAGE_COUNT}`)
  } else {
    console.log('        （当前数据不足 6 条，分页只有一页；翻页分支跳过）')
    assert(await btn('下一页').isDisabled(), '只有一页时「下一页」应禁用')
  }
  assert(await btn('上一页').isDisabled(), '首页时「上一页」应禁用')

  await page.locator('#admin-page-size').selectOption('20')
  await page.waitForTimeout(400)
  await need('1 / 1')
  await shot('05b-admin-paging')
})

/* ======================================================================
   四、Phase 3 —— 批量操作
   ====================================================================== */
await step('上一页箭头动画 = 下一页的镜像（旋转不丢、向左滑出）', async () => {
  await page.locator('#admin-page-size').selectOption('5')
  await page.waitForTimeout(300)
  if (Math.ceil(TOTAL_COUNT / 5) <= 1) {
    console.log('        （当前数据不足 6 条，没有第二页可翻；动画分支跳过）')
    await page.locator('#admin-page-size').selectOption('20')
    await page.waitForTimeout(300)
    return
  }
  await btn('下一页').click()
  await page.waitForTimeout(300)

  const prevArrow = page.locator('button:has-text("上一页") .u-arrow-back').first()
  const nextArrow = page.locator('button:has-text("下一页") .u-arrow').first()
  const readTransform = (loc) => loc.evaluate((el) => getComputedStyle(el).transform)
  const parse = (t) => {
    const m = t.match(/^matrix\(([^)]+)\)$/)
    return m ? m[1].split(',').map((v) => Number(v.trim())) : null
  }

  const idle = parse(await readTransform(prevArrow))
  assert(idle, `无法解析静止态 transform`)
  assert(idle[0] === -1 && idle[3] === -1, `上一页箭头静止时就该指向左（rotate 180），实际 ${idle}`)
  assert(idle[4] === 0, `上一页箭头静止时不该有位移，实际 tx=${idle[4]}`)

  await prevArrow.hover()
  await page.waitForTimeout(300)
  const prevHover = parse(await readTransform(prevArrow))
  // 这一条就是回归守卫：修之前是 matrix(1,0,0,1,8,0) —— 旋转被 translate 覆盖掉了
  assert(
    prevHover[0] === -1 && prevHover[3] === -1,
    `悬停后旋转丢了（a/d 应为 -1），实际 ${prevHover}`,
  )
  assert(prevHover[4] < 0, `悬停后应向左滑，实际 tx=${prevHover[4]}`)

  await nextArrow.hover()
  await page.waitForTimeout(300)
  const nextHover = parse(await readTransform(nextArrow))
  assert(nextHover[0] === 1 && nextHover[3] === 1, `下一页悬停时不该有旋转，实际 ${nextHover}`)
  assert(nextHover[4] > 0, `下一页悬停时应向右滑，实际 tx=${nextHover[4]}`)
  assert(
    Math.abs(nextHover[4]) === Math.abs(prevHover[4]),
    `两侧位移幅度应一致：${prevHover[4]} vs ${nextHover[4]}`,
  )

  await shot('05c-arrow-animation')
  await page.locator('#admin-page-size').selectOption('20')
  await page.waitForTimeout(300)
})

await step('Phase 3 · 勾选 2 行 → 批量条展开 7 个动作', async () => {
  // ⚠️ 默认列表可能包含已下线的作品（数据里本来就有），直接取前两行会选到它们，
  //    「下线」就会变成「跳过」而不是「改动」。先筛到已上线，选完再切回全部。
  await page.locator('#admin-filter-sort').selectOption('updatedAt')
  await page.waitForTimeout(300)
  await chip('已上线').click()
  await page.waitForTimeout(400)
  await page.locator('tbody input[type=checkbox]').nth(0).check()
  await page.locator('tbody input[type=checkbox]').nth(1).check()
  await page.waitForTimeout(300)
  await need('已选择 2 项')
  for (const label of ['上线', '下线', '归档', '取消归档', '添加标签', '移除标签', '修改作者']) {
    assert(
      (await page.getByRole('button', { name: label, exact: true }).count()) > 0,
      `缺少批量按钮「${label}」`,
    )
  }
  await shot('06-batch-bar')

  // 切回全部：勾选按 id 保持，随后下线会让这两条因 updatedAt 排到最前，
  // 下一步「重复下线」才能重新选中同一批。
  await chip('全部').click()
  await page.waitForTimeout(400)
})

await step('Phase 3 · 点「下线」出现二次确认，确认后生效', async () => {
  await btn('下线').click()
  await page.waitForTimeout(300)
  await need('确认执行「下线」')
  await shot('07-batch-confirm')
  await btn('确认执行').click()
  await page.waitForTimeout(400)
  await need('操作结果')
  await need('实际改动 2 项')
  await need('数据仓')
  await need('已下线')
  await shot('08-batch-result')
})

await step('Phase 3 · 重复下线同样 2 行 → 记为跳过而非改动', async () => {
  await page.locator('tbody input[type=checkbox]').nth(0).check()
  await page.locator('tbody input[type=checkbox]').nth(1).check()
  await page.waitForTimeout(200)
  await btn('下线').click()
  await page.waitForTimeout(200)
  await btn('确认执行').click()
  await page.waitForTimeout(400)
  await need('实际改动 0 项')
  await need('跳过 2 项')
})

await step('Phase 3 · 批量上线复原', async () => {
  await page.locator('tbody input[type=checkbox]').nth(0).check()
  await page.locator('tbody input[type=checkbox]').nth(1).check()
  await page.waitForTimeout(200)
  await btn('上线').click()
  await page.waitForTimeout(400)
  await need('实际改动 2 项')
})

await step('Phase 3 · 批量添加标签', async () => {
  await page.locator('tbody input[type=checkbox]').nth(0).check()
  await page.locator('tbody input[type=checkbox]').nth(1).check()
  await page.waitForTimeout(200)
  await btn('添加标签').click()
  await page.waitForTimeout(300)
  await page.fill('#admin-batch-tags', '恐怖, 3D')
  await page.waitForTimeout(200)
  await btn('确认添加').click()
  await page.waitForTimeout(400)
  await need('批量添加标签')
  await need('恐怖')
  await shot('09-batch-tags')
})

await step('Phase 3 · 归档后默认列表隐藏，切「已归档」可见', async () => {
  await page.locator('tbody input[type=checkbox]').nth(0).check()
  await page.locator('tbody input[type=checkbox]').nth(1).check()
  await page.waitForTimeout(200)
  await btn('归档').click()
  await page.waitForTimeout(200)
  await btn('确认执行').click()
  await page.waitForTimeout(400)
  const afterArchive = await rowCount()
  assert(
    afterArchive === TOTAL_COUNT - 2,
    `归档后默认列表应剩 ${TOTAL_COUNT - 2} 行，实际 ${afterArchive}`,
  )
  await chip('已归档').click()
  await page.waitForTimeout(400)
  const archivedRows = await rowCount()
  assert(
    archivedRows === ARCHIVED_COUNT + 2,
    `已归档筛选应有 ${ARCHIVED_COUNT + 2} 行，实际 ${archivedRows}`,
  )
  await shot('10-archived')
})

await step('Phase 3 · 取消归档后数据复原', async () => {
  await page.locator('tbody input[type=checkbox]').nth(0).check()
  await page.locator('tbody input[type=checkbox]').nth(1).check()
  await page.waitForTimeout(200)
  await btn('取消归档').click()
  await page.waitForTimeout(400)
  await chip('全部').click()
  await page.waitForTimeout(400)
  const n = await rowCount()
  assert(n === TOTAL_COUNT, `复原后应有 ${TOTAL_COUNT} 行，实际 ${n}`)
})

/* ======================================================================
   五、Phase 4 / 5 —— 编辑页（含上一轮修的三个缺陷）
   ====================================================================== */
await step('Phase 5 · 列表「编辑」进入编辑页并带出真实数据', async () => {
  // ⚠️ 不能点「第一行」：缺省排序是 updatedAt 降序，前面批量操作刷新过时间戳，
  //    第一行是哪条作品并不确定。后面会用 TEST_GAME_ID 做一堆断言，
  //    这里就必须先按标题定位到**同一条**作品，否则改的是别的条目。
  await go('/admin/games', '收录作品')
  await page.fill('#admin-search', TEST_GAME_TITLE)
  await page.waitForTimeout(400)
  const row = page
    .locator('tbody tr')
    .filter({ has: page.getByRole('link', { name: TEST_GAME_TITLE, exact: true }) })
    .first()
  await row.getByRole('link', { name: '编辑', exact: true }).click()
  await page.getByText('基本信息', { exact: false }).first().waitFor({ timeout: 8000 })
  assert(
    page.url().includes(`/games/${TEST_GAME_ID}/edit`),
    `进入的不是目标作品的编辑页：${page.url()}`,
  )
  assert((await page.inputValue('#f-title')).length > 0, '标题输入框为空')
  assert((await page.inputValue('#f-author')).length > 0, '作者输入框为空')
  await shot('11-editor')
})

await step('Phase 5 · 改动后出现「未保存的修改」且保存按钮可用', async () => {
  await page.fill('#f-title', 'UI 测试临时标题')
  await page.waitForTimeout(300)
  await need('未保存的修改')
  assert(!(await btn('保存').isDisabled()), '保存按钮应可点')
})

await step('缺陷 5 已修 · 年份填 1800 立刻报「不能早于 1990」', async () => {
  await page.fill('#f-year', '1800')
  await page.waitForTimeout(300)
  await need('发行年份不能早于 1990')
  await shot('12-year-error')
})

await step('缺陷 5 已修 · 年份填 2099 报「不能晚于」', async () => {
  await page.fill('#f-year', '2099')
  await page.waitForTimeout(300)
  await need('发行年份不能晚于')
})

await step('缺陷 5 已修 · 年份填 abc 报「必须是 4 位数字」', async () => {
  await page.fill('#f-year', 'abc')
  await page.waitForTimeout(300)
  await need('发行年份必须是 4 位数字')
})

await step('缺陷 7 已修 · 年份改回合法值后保存，出现保存结果提示条', async () => {
  await page.fill('#f-year', '2017')
  await page.waitForTimeout(200)
  await btn('保存').click()
  await page.waitForTimeout(700)
  await need('保存结果')
  await need('数据仓')
  await shot('13-save-result')
})

await step('Phase 5 · 撤销修改把改动丢弃', async () => {
  await page.fill('#f-title', '另一个临时标题')
  await page.waitForTimeout(300)
  await btn('撤销修改').click()
  await page.waitForTimeout(400)
  const title = await page.inputValue('#f-title')
  assert(title === 'UI 测试临时标题', `撤销后应回到上次保存值，实际：${title}`)
})

await step('缺陷 9 已修 · 有未保存改动时点「返回列表」出现页内确认条', async () => {
  await page.fill('#f-title', '第三个临时标题')
  await page.waitForTimeout(300)
  await link('返回列表').click()
  await page.waitForTimeout(400)
  await need('有未保存的修改')
  assert(page.url().includes('/edit'), '未确认却已经离开了页面')
  await shot('14-leave-confirm')
  await btn('留在本页').click()
  await page.waitForTimeout(300)
  await needNot('有未保存的修改')
})

await step('Phase 5 · 确认离开后正常跳回列表', async () => {
  await link('返回列表').click()
  await page.waitForTimeout(300)
  await btn('放弃修改并离开').click()
  await page.waitForTimeout(900)
  assert(!page.url().includes('/edit'), `应已离开编辑页，实际：${page.url()}`)
})

/* ======================================================================
   六、Phase 6 —— 标签
   ====================================================================== */
await step('Phase 6 · 批量加的标签已出现在标签页', async () => {
  await go('/admin/taxonomy', '标签与作者')
  await need('恐怖')
  await need('3D')
  await shot('15-tags')
})

await step('Phase 6 · 编辑页录入标签并保存', async () => {
  await go(`/admin/games/${TEST_GAME_ID}/edit`, '基本信息')
  await page.fill('input[placeholder*="输入标签名"]', '剧情')
  await page.press('input[placeholder*="输入标签名"]', 'Enter')
  await page.waitForTimeout(300)
  await need('剧情')
  await need('已修改')
  await btn('保存').click()
  await page.waitForTimeout(700)
  await need('保存结果')
  await shot('16-editor-tags')
})

await step('Phase 6 · 重复标签被拒绝并给出红字提示', async () => {
  await page.fill('input[placeholder*="输入标签名"]', '剧情')
  await page.press('input[placeholder*="输入标签名"]', 'Enter')
  await page.waitForTimeout(300)
  await need('已经在本条作品上了')
})

await step('Phase 6 · 标签页搜索', async () => {
  await go('/admin/taxonomy', '标签与作者')
  await page.fill('#tag-search', '3d')
  await page.waitForTimeout(300)
  await need('找到 1 /')
  await page.fill('#tag-search', 'zzz')
  await page.waitForTimeout(300)
  await need('没有匹配的标签')
  await btn('清除').click()
  await page.waitForTimeout(300)
})

await step('Phase 6 · 重命名标签并同步到作品', async () => {
  const row = page.locator('table tbody tr', { hasText: '3D' }).first()
  await row.getByRole('button', { name: '重命名', exact: true }).click()
  await page.waitForTimeout(300)
  await page.locator('tbody input[type=text]').first().fill('三维')
  await page.waitForTimeout(200)
  await page.locator('tbody').getByRole('button', { name: '保存', exact: true }).first().click()
  await page.waitForTimeout(700)
  await need('重命名标签「3D」→「三维」')
  await shot('17-tag-rename')
})

await step('Phase 6 · 重命名确实改到了作品上（使用次数保持）', async () => {
  await go('/admin/taxonomy', '标签与作者')
  const row = page
    .locator('section[aria-labelledby="tag-section-title"] tbody tr', { hasText: '三维' })
    .first()
  const text = await row.innerText()
  assert(text.includes('2 款'), `重命名后使用次数应为 2，实际行内容：${text}`)
  assert(!(await body()).includes('3D'), '旧标签名「3D」不应再出现')
})

await step('Phase 6 · 删除标签：页内确认 → 标签消失、作品保留', async () => {
  await go('/admin/taxonomy', '标签与作者')
  const row = page.locator('table tbody tr', { hasText: '恐怖' }).first()
  await row.getByRole('button', { name: '删除', exact: true }).click()
  await page.waitForTimeout(300)
  await need('确认删除标签「恐怖」')
  await shot('18-tag-delete-confirm')
  await btn('确认删除').click()
  await page.waitForTimeout(700)
  await need('删除标签「恐怖」')
  // 注意：结果提示条里就写着「恐怖」，所以只能断言表格里没有这一行
  const remaining = await page.locator('table tbody tr', { hasText: '恐怖' }).count()
  assert(remaining === 0, `表格里仍有 ${remaining} 行包含「恐怖」`)
  await need('三维')
})

await step('Phase 6 · 作者管理：重命名并同步到作品，再复原', async () => {
  const originalAuthor = TEST_GAME.author ?? ''
  const temporaryAuthor = 'UI 测试作者'

  await go('/admin/taxonomy', '标签与作者')
  const authorSection = page.locator('section[aria-labelledby="author-section-title"]')
  let row = authorSection.locator('tbody tr', { hasText: originalAuthor }).first()
  await row.getByRole('button', { name: '重命名', exact: true }).click()
  await authorSection.locator('tbody input[type=text]').first().fill(temporaryAuthor)
  await authorSection.getByRole('button', { name: '保存', exact: true }).first().click()
  await page.waitForTimeout(700)
  await need(`重命名作者「${originalAuthor}」→「${temporaryAuthor}」`)

  await go(`/admin/games/${TEST_GAME_ID}/edit`, '基本信息')
  assert(
    (await page.inputValue('#f-author')) === temporaryAuthor,
    '作者重命名后，作品编辑页的作者没有同步',
  )

  await go('/admin/taxonomy', '标签与作者')
  row = authorSection.locator('tbody tr', { hasText: temporaryAuthor }).first()
  await row.getByRole('button', { name: '重命名', exact: true }).click()
  await authorSection.locator('tbody input[type=text]').first().fill(originalAuthor)
  await authorSection.getByRole('button', { name: '保存', exact: true }).first().click()
  await page.waitForTimeout(700)
  await need(`重命名作者「${temporaryAuthor}」→「${originalAuthor}」`)
})
/* ======================================================================
   六·四、Phase 2 —— 玩法与机制词表 + 编辑器结构化字段
   ====================================================================== */
const vocabSection = (collection) => page.locator(`section#vocab-${collection}`)
const MECH_A = 'UI 断言机制甲'
const MECH_A_RENAMED = 'UI 断言机制甲改'
const MECH_B = 'UI 断言机制乙'

await step('Phase 2 · 词表页列出三分区与内置词条', async () => {
  await go('/admin/vocabulary', '玩法与机制')
  await need('玩法类型')
  await need('游戏机制')
  await need('支持平台')
  await need('未标玩法')
  // 数据仓还没有 taxonomy 时，用内置初始词表兜底
  await need('传统守夜式')
  await need('监控摄像头')
  await need('Windows')
  await need('使用数量')
  await shot('18a-vocabulary')
})

await step('Phase 2 · 新建并编辑机制词条', async () => {
  const section = vocabSection('mechanics')
  await page.fill('#vocab-mechanics-name', MECH_A)
  await page.fill('#vocab-mechanics-desc', '仅用于 UI 断言，稍后会删除')
  await section.getByRole('button', { name: '新建', exact: true }).click()
  await page.waitForTimeout(700)

  await need(`已新建游戏机制「${MECH_A}」`)
  let row = section.locator('tbody tr', { hasText: MECH_A }).first()
  assert((await row.count()) === 1, '新建的机制没有出现在列表里')
  assert((await row.innerText()).includes('0 款'), '新机制的使用次数应为 0')

  await row.getByRole('button', { name: '编辑', exact: true }).click()
  await page.waitForTimeout(200)
  await section.locator('tbody input[aria-label="游戏机制名称"]').first().fill(MECH_A_RENAMED)
  await section.getByRole('button', { name: '保存', exact: true }).first().click()
  await page.waitForTimeout(700)
  await need(`已更新游戏机制「${MECH_A_RENAMED}」`)

  row = section.locator('tbody tr', { hasText: MECH_A_RENAMED }).first()
  assert((await row.count()) === 1, '改名后列表里找不到新名称')
})

await step('Phase 2 · 合并词条：来源消失、目标保留', async () => {
  const section = vocabSection('mechanics')
  await page.fill('#vocab-mechanics-name', MECH_B)
  await section.getByRole('button', { name: '新建', exact: true }).click()
  await page.waitForTimeout(700)

  const sourceRow = section.locator('tbody tr', { hasText: MECH_A_RENAMED }).first()
  await sourceRow.getByRole('button', { name: '合并', exact: true }).click()
  await page.waitForTimeout(200)
  await section
    .locator('select[aria-label="选择合并目标"]')
    .selectOption({ label: MECH_B })
  await section.getByRole('button', { name: '确认合并', exact: true }).click()
  await page.waitForTimeout(700)

  await need('合并到')
  const tableText = await section.locator('tbody').innerText()
  assert(!tableText.includes(MECH_A_RENAMED), '合并后来源词条仍在列表里')
  assert(tableText.includes(MECH_B), '合并后目标词条应保留')
  await shot('18b-vocabulary-merge')
})

await step('Phase 2 · 删除保护：被作品引用时不能直接删', async () => {
  // 先把这个机制挂到作品上
  await go(`/admin/games/${TEST_GAME_ID}/edit`, '基本信息')
  await page.getByRole('button', { name: `+ ${MECH_B}`, exact: true }).click()
  await page.waitForTimeout(300)
  await btn('保存').click()
  await page.waitForTimeout(900)
  await need('保存结果')

  await go('/admin/vocabulary', '玩法与机制')
  const section = vocabSection('mechanics')
  const row = section.locator('tbody tr', { hasText: MECH_B }).first()
  await row.getByRole('button', { name: '删除', exact: true }).click()
  await page.waitForTimeout(300)
  await need('仍被 1 款作品使用')
  await need('从作品移除并删除')
  await shot('18c-vocabulary-delete-protected')

  await section.getByRole('button', { name: '从作品移除并删除', exact: true }).click()
  await page.waitForTimeout(700)
  await need('并从 1 款作品上移除')

  // 作品上的引用也应同步消失
  await go(`/admin/games/${TEST_GAME_ID}/edit`, '基本信息')
  await needNot(MECH_B)
})

await step('Phase 2 · 编辑器结构化字段保存后重新读取一致', async () => {
  const ALIAS = 'UI 上的另一个名字'
  const SOURCE = 'https://example.com/ui-test-source'

  await go(`/admin/games/${TEST_GAME_ID}/edit`, '基本信息')
  await page.getByRole('button', { name: '+ 传统守夜式', exact: true }).click()
  await page.getByRole('button', { name: '+ 监控摄像头', exact: true }).click()
  await page.getByRole('button', { name: '+ Windows', exact: true }).click()
  await page.fill('#f-alt-title-input', ALIAS)
  await page.locator('#f-alt-title-input').press('Enter')
  await page.fill('#f-source', SOURCE)
  await page.selectOption('#f-development', 'in-development')
  await page.waitForTimeout(300)

  // 玩法第一项必须带「主要」标记
  const gameplayText = await page.locator('#section-vocab').innerText()
  assert(gameplayText.includes('主要'), '第一个玩法类型没有标出「主要」')

  await btn('保存').click()
  await page.waitForTimeout(900)
  await need('保存结果')
  await shot('18d-structured-saved')

  // —— 重新加载，确认不是只改了内存里的草稿 ——
  await go(`/admin/games/${TEST_GAME_ID}/edit`, '基本信息')
  assert(
    (await page.inputValue('#f-source')) === SOURCE,
    '来源页没有保存成功',
  )
  assert(
    (await page.inputValue('#f-development')) === 'in-development',
    '开发状态没有保存成功',
  )
  await need('传统守夜式')
  await need('监控摄像头')
  await need('Windows')
  await need(ALIAS)

  await shot('18e-structured-reloaded')
})

await step('Phase 2 · 预览用真实详情页展示新字段', async () => {
  await go(`/admin/games/${TEST_GAME_ID}/edit`, '基本信息')
  const [previewPage] = await Promise.all([
    context.waitForEvent('page'),
    btn('预览').click(),
  ])
  await previewPage.waitForLoadState('domcontentloaded')
  await previewPage
    .getByText('预览 · 未保存', { exact: false })
    .first()
    .waitFor({ timeout: 10000 })
  await previewPage.getByText('传统守夜式', { exact: false }).first().waitFor({ timeout: 10000 })

  const text = await previewPage.locator('body').innerText()
  assert(text.includes('监控摄像头'), '预览里没有显示机制')
  assert(text.includes('Windows'), '预览里没有显示平台')
  assert(text.includes('开发中'), '预览里没有显示开发状态')
  assert(text.includes('UI 上的另一个名字'), '预览里没有显示其他名称')
  assert(text.includes('example.com/ui-test-source'), '预览里没有显示来源页')
  await previewPage.screenshot({ path: `${SHOTS}/18f-structured-preview.png`, fullPage: true })
  await previewPage.close()
})

/* ======================================================================
   六·五、Phase 7 —— 图片管理 UI
   ====================================================================== */
await step('Phase 7 · 封面与图库带出真实数据', async () => {
  await go(`/admin/games/${TEST_GAME_ID}/edit`, '基本信息')
  await need('封面与宣传图')
  await need('Banner 宣传图')
  await need('或直接填图片地址')
  const cover = await page.inputValue('#f-cover-url')
  // 与数据里的原值比较，而不是写死某个文件名 —— 数据仓随时会换图。
  assert(cover === (TEST_GAME.coverImage ?? ''), `封面地址不符：期望 ${TEST_GAME.coverImage}，实际 ${cover}`)
  assert(cover.length > 0, '封面地址不应为空')
  await need('图库')
  if (TEST_GAME_GALLERY > 0) {
    await need('NO.01')
    await need(`${TEST_GAME_GALLERY} / 8 张`)
  } else {
    await need('图库还是空的')
  }
  await shot('21-images')
})

await step('Phase 7 · 封面地址校验：非法拒绝、合法通过', async () => {
  await page.fill('#f-cover-url', 'nope')
  await page.waitForTimeout(300)
  await need('请填写网站内的图片路径（以 / 开头），或完整的 http(s) 图片地址')
  await shot('22-cover-error')
  await page.fill('#f-cover-url', TEST_GAME.coverImage ?? '')
  await page.waitForTimeout(300)
  await needNot('请填写网站内的图片路径（以 / 开头），或完整的 http(s) 图片地址')
})

await step('Phase 7 · 图库上移改变顺序、下移还原', async () => {
  const firstBefore = await page.locator('figure').first().locator('img').getAttribute('src')
  await page.locator('figure').nth(1).getByRole('button', { name: '把第 2 张上移' }).click()
  await page.waitForTimeout(300)
  const afterUp = await page.locator('figure').first().locator('img').getAttribute('src')
  assert(afterUp !== firstBefore, '上移后首位没有变化')
  await page.locator('figure').nth(0).getByRole('button', { name: '把第 1 张下移' }).click()
  await page.waitForTimeout(300)
  const restored = await page.locator('figure').first().locator('img').getAttribute('src')
  assert(restored === firstBefore, '下移没有还原顺序')
})

await step('Phase 7 · 图库地址校验与增删', async () => {
  if (TEST_GAME_GALLERY >= 8) {
    console.log('        （图库已满 8 张，跳过增删分支）')
    return
  }

  /** 失败时带上页面实际的张数标记，别让报错只说「没包含」 */
  const galleryCountLine = async () => {
    const lines = (await body()).split('\n')
    return lines.find((line) => line.includes('/ 8 张')) ?? '（页面上找不到张数标记）'
  }

  await page.fill('#gallery-url', 'not a path')
  await btn('加入图片').click()
  await page.waitForTimeout(300)
  await need('请填写网站内的图片路径（以 / 开头），或完整的 http(s) 图片地址')

  await page.fill('#gallery-url', '/images/ui-test-gallery.png')
  await btn('加入图片').click()
  await page.waitForTimeout(300)
  assert(
    await has(`${TEST_GAME_GALLERY + 1} / 8 张`),
    `加入一张后应显示 ${TEST_GAME_GALLERY + 1} / 8 张，实际：${await galleryCountLine()}`,
  )
  await shot('23-gallery')

  // ⚠️ 删「新增的那一张」（最后一张），不是固定第 3 张：
  //    后面还要把同一个地址再加回来验证复原。删中间那张的话，
  //    新增的图仍在图库里，再添加会被「已经在图库里了」拦下。
  const addedIndex = TEST_GAME_GALLERY + 1
  await page
    .locator('figure')
    .nth(addedIndex - 1)
    .getByRole('button', { name: `删除第 ${addedIndex} 张` })
    .click()
  await page.waitForTimeout(300)
  assert(
    await has(`${TEST_GAME_GALLERY} / 8 张`),
    `删除后应回到 ${TEST_GAME_GALLERY} / 8 张，实际：${await galleryCountLine()}`,
  )

  await page.fill('#gallery-url', '/images/ui-test-gallery.png')
  await btn('加入图片').click()
  await page.waitForTimeout(300)
  assert(
    await has(`${TEST_GAME_GALLERY + 1} / 8 张`),
    `再次加入后应显示 ${TEST_GAME_GALLERY + 1} / 8 张，实际：${await galleryCountLine()}`,
  )
})

await step('Phase 7 · 保存图片改动', async () => {
  await btn('保存').click()
  await page.waitForTimeout(700)
  await need('保存结果')
  await shot('24-images-saved')
})

/* ======================================================================
   六·六、Phase 8 —— 下载资源管理
   ====================================================================== */
await step('Phase 8 · 下载区块带出真实渠道', async () => {
  await go(`/admin/games/${TEST_GAME_ID}/edit`, '基本信息')
  await need('下载资源')
  const firstDownload = TEST_GAME.downloads?.[0] ?? {}
  const provider0 = await page.inputValue('#dl-0-provider')
  assert(provider0 === (firstDownload.provider ?? ''), `第 1 行服务商不符：${provider0}`)
  const url0 = await page.inputValue('#dl-0-url')
  assert(url0 === (firstDownload.url ?? ''), `第 1 行地址不符：${url0}`)
  const pwd0 = await page.inputValue('#dl-0-password')
  assert(pwd0 === (firstDownload.password ?? ''), `第 1 行提取码不符：${pwd0}`)
  await need(`${TEST_GAME_DOWNLOADS} / 8 个渠道`)
  await shot('25-downloads')
})

await step('Phase 8 · 新增渠道：空行不飘红，开始填才实时提示', async () => {
  const newIndex = TEST_GAME_DOWNLOADS
  await btn('添加下载渠道').click()
  await page.waitForTimeout(300)
  await need(`${TEST_GAME_DOWNLOADS + 1} / 8 个渠道`)
  // 刚加的空行不该立刻报错 —— 那是噪音
  await needNot('服务商不能为空')

  await page.fill(`#dl-${newIndex}-provider`, '夸克网盘')
  await page.waitForTimeout(300)
  await need('下载地址不能为空')

  await page.fill(`#dl-${newIndex}-url`, 'www.quark.cn')
  await page.waitForTimeout(300)
  await need('下载地址必须是 http:// 或 https:// 开头的完整链接')
  await shot('26-download-error')

  await page.fill(`#dl-${newIndex}-url`, 'https://pan.quark.cn/s/ui-test')
  await page.fill(`#dl-${newIndex}-password`, 'ui9')
  await page.waitForTimeout(300)
  await needNot('下载地址必须是 http:// 或 https:// 开头的完整链接')
  await needNot('服务商不能为空')
})

await step('Phase 8 · 渠道上移/下移交换与还原', async () => {
  const first = await page.inputValue('#dl-0-provider')
  const second = await page.inputValue('#dl-1-provider')
  await page.getByRole('button', { name: '把第 2 个渠道上移' }).click()
  await page.waitForTimeout(300)
  assert((await page.inputValue('#dl-0-provider')) === second, '上移后首位没有变化')
  await page.getByRole('button', { name: '把第 1 个渠道下移' }).click()
  await page.waitForTimeout(300)
  assert((await page.inputValue('#dl-0-provider')) === first, '下移没有还原顺序')
})

await step('Phase 8 · 保存渠道改动，再删除复原', async () => {
  await btn('保存').click()
  await page.waitForTimeout(700)
  await need('保存结果')
  await shot('27-downloads-saved')

  await page
    .getByRole('button', { name: `删除第 ${TEST_GAME_DOWNLOADS + 1} 个渠道` })
    .click()
  await page.waitForTimeout(300)
  await need(`${TEST_GAME_DOWNLOADS} / 8 个渠道`)
  await btn('保存').click()
  await page.waitForTimeout(700)
  await need('保存结果')
})

/* ======================================================================
   六·七、Phase 9 —— 发布状态 / 归档 / 推荐排序
   ====================================================================== */
await step('Phase 9 · 发布设置与推荐排序区块渲染', async () => {
  await go(`/admin/games/${TEST_GAME_ID}/edit`, '基本信息')
  await need('发布设置')
  await need('推荐与排序')
  await need('已下线')
  await need('未归档')
  await need('未推荐')
  // 当前已是「已上线」且内容完整 → 不该出现缺口提示
  await needNot('还差这些才能上线')
  await shot('28-publish-settings')
})

await step('Phase 9 · 缺封面时「已上线」列出缺口并拦下保存', async () => {
  await page.fill('#f-cover-url', '')
  await page.waitForTimeout(300)
  await need('还差这些才能上线')
  await need('还没有封面图')

  await btn('保存').click()
  await page.waitForTimeout(500)
  await need('保存被拦下了')
  await need('未保存的修改')
  await shot('29-publish-blocked')
})

await step('Phase 9 · 切回「草稿」就能保存', async () => {
  await page.getByRole('button', { name: '草稿', exact: true }).click()
  await page.waitForTimeout(300)
  await needNot('还差这些才能上线')
  await btn('保存').click()
  await page.waitForTimeout(700)
  await need('保存结果')
  assert(
    (await page.getByRole('button', { name: '草稿', exact: true }).getAttribute('aria-pressed')) ===
      'true',
    '保存后「草稿」应处于选中态',
  )
})

await step('Phase 9 · 「发布」把状态切回已上线并保存', async () => {
  await page.fill('#f-cover-url', TEST_GAME.coverImage ?? '')
  await page.waitForTimeout(300)
  await btn('发布').click()
  await page.waitForTimeout(800)
  await need('保存结果')
  assert(
    (await page.getByRole('button', { name: '已上线', exact: true }).getAttribute('aria-pressed')) ===
      'true',
    '「发布」后「已上线」应处于选中态',
  )
  await needNot('还差这些才能上线')
  await shot('30-published')
})

await step('Phase 9 · 归档与推荐开关可切换并保存', async () => {
  await page.locator('#f-archived').check()
  await page.locator('#f-featured').check()
  await page.fill('#f-sort-order', '9')
  await page.waitForTimeout(300)
  await need('已归档')
  await need('已设为推荐')
  await btn('保存').click()
  await page.waitForTimeout(700)
  await need('保存结果')

  // 复原，避免影响后续步骤
  await page.locator('#f-archived').uncheck()
  await page.locator('#f-featured').uncheck()
  await page.fill('#f-sort-order', '')
  await btn('保存').click()
  await page.waitForTimeout(700)
  await need('未归档')
  await need('未推荐')
})

await step('Phase 9 · 排序权重非整数会报错', async () => {
  await page.fill('#f-sort-order', '1.5')
  await page.waitForTimeout(300)
  await need('排序权重必须是整数')
  await page.fill('#f-sort-order', '-3')
  await page.waitForTimeout(300)
  await needNot('排序权重必须是整数')
  await page.fill('#f-sort-order', '')
  await page.waitForTimeout(300)
})

/* ======================================================================
   七、Phase 5 —— 新建流程
   ====================================================================== */
await step('Phase 5 · 新建作品：保存后跳到编辑路由并保留提示条', async () => {
  await go('/admin/games/new', '新增游戏')
  await page.fill('#f-title', 'UI Test Sample')
  await page.fill('#f-author', '测试作者')
  await page.fill('#f-year', '2021')
  await page.fill('#f-series', 'FNAF 主线同人')
  await page.fill('#f-engine', 'Godot 4')
  await page.fill('#f-desc', '这是 UI 测试创建的临时条目。')
  await page.waitForTimeout(300)
  await btn('保存').click()
  await page.waitForTimeout(1000)
  assert(page.url().includes('/ui-test-sample/edit'), `未跳到编辑路由，实际：${page.url()}`)
  await need('保存结果')
  await need('已新建')
  await shot('19-created')
})

await step('新建的作品默认是草稿（不默认对外可见）', async () => {
  await go('/admin/games', '收录作品')
  await chip('草稿').click()
  await page.waitForTimeout(400)
  await need('UI Test Sample')
  await shot('20-new-is-draft')
})

await step('编辑器 · Ctrl+S 直接保存当前草稿', async () => {
  await go('/admin/games/ui-test-sample/edit', '基本信息')
  await page.fill('#f-title', 'UI Test Sample Saved')
  await page.waitForTimeout(250)
  await page.keyboard.press('Control+s')
  await page.waitForTimeout(1000)
  await need('保存结果')
  await need('已更新')
  await need('UI Test Sample Saved')
})

await step('列表 · 行内快捷上线 / 下线', async () => {
  await go('/admin/games', '收录作品')
  // 过滤器是模块级单例状态，会跨路由保留；先切回「全部」再测行内快捷操作
  await chip('全部').click()
  await page.waitForTimeout(300)
  await page.fill('#admin-search', 'UI Test Sample')
  await page.waitForTimeout(500)

  await btn('上线这条').click()
  await page.waitForTimeout(900)
  await need('实际改动 1 项')
  assert(
    (await page.locator('tbody tr').first().innerText()).includes('已上线'),
    '快捷上线后该行状态应为已上线',
  )

  await btn('下线这条').click()
  await page.waitForTimeout(900)
  assert(
    (await page.locator('tbody tr').first().innerText()).includes('已下线'),
    '快捷下线后该行状态应为已下线',
  )
})

await step('列表 · 删除入口弹出二次确认，取消不会删数据', async () => {
  await btn('删除这条').click()
  await page.waitForTimeout(400)
  await need('确认永久删除？')
  await need('UI Test Sample Saved')

  await btn('取消').click()
  await page.waitForTimeout(400)
  await needNot('确认永久删除？')
  assert(
    (await page.locator('tbody tr').first().innerText()).includes('UI Test Sample Saved'),
    '取消删除后条目应仍在',
  )
})

await step('永久删除 · 二次确认后删除，回到列表且条目消失', async () => {
  await go('/admin/games', '收录作品')
  await chip('全部').click()
  await page.waitForTimeout(300)
  await page.fill('#admin-search', 'UI Test Sample')
  await page.waitForTimeout(500)
  await page.getByRole('link', { name: '编辑', exact: true }).first().click()
  await page.waitForTimeout(700)
  await need('永久删除这条作品')

  await btn('删除这条作品').click()
  await page.waitForTimeout(400)
  await need('确认永久删除？')
  await need('ui-test-sample')

  await btn('确认永久删除').click()
  await page.waitForTimeout(1000)

  // 回到列表，并有如实的结果提示
  assert(page.url().includes('/admin/games'), `删除后应回到列表，实际：${page.url()}`)
  await need('已永久删除')
  await need('UI Test Sample')

  // 再搜同一条 → 表格进入空状态（空状态本身也占一行，所以断言文案而不是行数）
  await page.fill('#admin-search', 'UI Test Sample')
  await page.waitForTimeout(600)
  await need('没有找到符合条件的游戏')
  await shot('45-deleted')
})

/* ======================================================================
   八、Phase 16 —— 改动提交到数据仓（开发环境前台仍读快照）
   ====================================================================== */
await step('Phase 16 · 后台改状态会提交到数据仓（开发环境前台仍读快照）', async () => {
  // ⚠️ 先强刷。筛选 / 搜索是**会话内**状态，上一步留下的条件会把目标作品挡在外面
  //    （我重写这一步时漏掉过这句，结果目标作品被残留筛选挡住、表格里一行都没有）。
  await page.goto(hash('/admin/games'), { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByText('收录作品', { exact: false }).first().waitFor({ timeout: 8000 })

  const targetRow = () =>
    page
      .locator('tbody tr')
      .filter({ has: page.getByRole('link', { name: OTHER_GAME.title, exact: true }) })
      .first()

  await page.fill('#admin-search', OTHER_GAME.title)
  await page.waitForTimeout(400)
  try {
    await targetRow().locator('input[type=checkbox]').check({ timeout: 8000 })
  } catch {
    throw new Error(
      `表格里找不到「${OTHER_GAME.title}」这一行。当前表格内容：\n${await page.locator('tbody').innerText()}`,
    )
  }
  await page.waitForTimeout(200)
  await btn('下线').click()
  await page.waitForTimeout(200)
  await btn('确认执行').click()
  await page.waitForTimeout(600)
  await need('实际改动 1 项')

  // 真刷新 —— 状态仍然在，说明它确实写进了「数据仓」，而不是只躺在本机内存里
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByText('收录作品', { exact: false }).first().waitFor({ timeout: 8000 })
  await page.fill('#admin-search', OTHER_GAME.title)
  await page.waitForTimeout(600)
  assert(
    (await targetRow().innerText()).includes('已下线'),
    '刷新后目标作品的「已下线」状态丢了',
  )
  await shot('31-committed-to-data-repo')

  // ✅ 开发环境不执行运行时同步（避免测试依赖网络），所以前台仍是构建期快照；
  //    生产环境会在公开页挂载 / 切回时从数据仓同步。
  //    这是静态站的固有性质，不是缺陷 —— 这条断言把「异步生效」这个语义钉住，
  //    防止哪天有人悄悄把前台改成运行时查库。
  await nav('/', '游戏库')
  await page.waitForTimeout(500)
  const stillCards = await page.locator('article').count()
  assert(stillCards === VISIBLE_COUNT, `前台此时应仍是快照中的 ${VISIBLE_COUNT} 款，实际 ${stillCards}`)
  await shot('32-public-unchanged-in-dev')

  // 复原：把目标作品放回上线
  await nav('/admin/games', '收录作品')
  await page.fill('#admin-search', OTHER_GAME.title)
  await page.waitForTimeout(400)
  await targetRow().locator('input[type=checkbox]').check()
  await page.waitForTimeout(200)
  await btn('上线').click()
  await page.waitForTimeout(600)
})

/* ======================================================================
   九、Phase 12 —— 本机持久化（刷新不丢）+ 逃生舱
   ====================================================================== */
await step('Phase 12 · 提示条如实说明改动写到了哪里', async () => {
  await go('/admin/games', '收录作品')
  await need('数据存在哪里')
  // 远程模式下说明的是「提交到数据仓」，不再说「存在这台设备的浏览器里」
  await need('数据仓')
  await needNot('这台设备的浏览器')
})

await step('Phase 12 · 改动在真刷新之后仍然存在', async () => {
  await go(`/admin/games/${TEST_GAME_ID}/edit`, '基本信息')
  await page.fill('#f-title', '持久化探针标题')
  await btn('保存').click()
  await page.waitForTimeout(700)
  await need('保存结果')
  await need('数据仓')

  // 真刷新 —— Phase 12 之前这里必然丢
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByText('基本信息', { exact: false }).first().waitFor({ timeout: 8000 })
  await page.waitForTimeout(500)
  const title = await page.inputValue('#f-title')
  assert(title === '持久化探针标题', `刷新后标题丢了：${title}`)
  await shot('34-persisted')

  // 复原
  await page.fill('#f-title', TEST_GAME_TITLE)
  await btn('保存').click()
  await page.waitForTimeout(700)
})

await step('Phase 16 · 远程模式下不提供「恢复出厂数据」', async () => {
  await go('/admin/games', '收录作品')
  await need('数据存在哪里')
  await need('数据仓')

  // ⚠️ 这个按钮在远程模式下必须消失：它等于「用出厂内容覆盖线上数据仓」，
  //    不是后台该有的能力。要回滚请对数据仓做 git revert。
  await needNot('恢复出厂数据')
  await need('改动会保存到线上')
  await shot('36-remote-no-reset')
})

/* ======================================================================
   十、Phase 16 —— 图片上传到数据仓
   ====================================================================== */
await step('Phase 16 · 选图会真的上传，并把完整外链写进草稿', async () => {
  await go(`/admin/games/${TEST_GAME_ID}/edit`, '基本信息')
  await page.waitForTimeout(500)

  const original = await page.inputValue('#f-cover-url')

  // 一张**尺寸合格**的真实 PNG —— 尺寸校验会拦掉太小的图，夹具必须过得去
  await page.setInputFiles('#f-cover-file', {
    name: 'cover.png',
    mimeType: 'image/png',
    buffer: await makePng(1280, 720),
  })
  await page.waitForTimeout(1500)

  const uploaded = await page.inputValue('#f-cover-url')
  assert(
    uploaded.startsWith(
      `https://daxigua732.github.io/fnaf-fan-games-data/images/games/${TEST_GAME_ID}/cover-`,
    ),
    `上传后地址不是数据仓的完整外链：${uploaded}`,
  )
  // Phase 17：上传前会把 PNG 转成 WebP（长边未超限则只转码、不缩放）
  assert(uploaded.endsWith('.webp'), `上传前应转成 WebP：${uploaded}`)
  await need('已自动处理')
  await shot('40-uploaded')

  // ⚠️ 复原：这一步只验上传链路，不保存。
  //    草稿留着改动的话，后面进编辑页会被「未保存拦截」挡住。
  await page.fill('#f-cover-url', original)
  await page.waitForTimeout(300)
})

await step('Phase 17 · 尺寸不合格的图会被拦下，且不写进地址', async () => {
  await go(`/admin/games/${TEST_GAME_ID}/edit`, '基本信息')
  await page.waitForTimeout(500)
  const original = await page.inputValue('#f-cover-url')

  // 10×10 的真实 PNG —— 远低于封面要求的最小宽度，必须被拦下
  await page.setInputFiles('#f-cover-file', {
    name: 'tiny.png',
    mimeType: 'image/png',
    buffer: await makePng(10, 10),
  })
  await page.waitForTimeout(1500)

  // 必须说清「为什么不行」，而不是默默不响应
  await need('图片太小了')
  assert(
    (await page.inputValue('#f-cover-url')) === original,
    '被拦下的图不该写进地址栏',
  )
  await shot('41-too-small')
})

/* ======================================================================
   十一·五、Phase 18 —— 预览：新标签页渲染真实前台详情页
   ====================================================================== */
const PREVIEW_TITLE = '预览探针标题'

await step('Phase 18 · 预览新标签页渲染出未保存的草稿，编辑页不受影响', async () => {
  await go(`/admin/games/${TEST_GAME_ID}/edit`, '基本信息')
  await page.waitForTimeout(400)

  // 改标题但**不保存**
  await page.fill('#f-title', PREVIEW_TITLE)
  await page.waitForTimeout(300)

  const [previewPage] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('button', { name: '预览', exact: true }).click(),
  ])
  await previewPage.waitForLoadState('domcontentloaded')
  await previewPage.getByText('预览 · 未保存', { exact: false }).first().waitFor({ timeout: 10000 })

  // 真实前台详情页渲染出了**未保存**的标题
  await previewPage.getByText(PREVIEW_TITLE, { exact: false }).first().waitFor({ timeout: 10000 })
  await previewPage.screenshot({ path: `${SHOTS}/42-preview.png`, fullPage: true })

  // 编辑页毫发无损：草稿原样还在
  assert(
    (await page.inputValue('#f-title')) === PREVIEW_TITLE,
    '预览不该影响编辑页的草稿',
  )
  await previewPage.close()

  // 还原
  await page.fill('#f-title', TEST_GAME_TITLE)
  await page.waitForTimeout(300)
})

/* ======================================================================
   十一、视觉规范哨兵 + 控制台
   ====================================================================== */
for (const [label, path, wait] of [
  ['游戏列表', '/admin/games', '收录作品'],
  ['编辑页', `/admin/games/${TEST_GAME_ID}/edit`, '基本信息'],
  ['标签与作者页', '/admin/taxonomy', '标签与作者'],
]) {
  if (PROD) break // 哨兵挂在 import.meta.env.DEV 下，生产构建里本就不该出现
  await step(`视觉哨兵 · ${label} 无圆角 / 无阴影`, async () => {
    await go(path, wait)
    await page.waitForTimeout(800)
    // .swiss-meta 带 uppercase，innerText 会给全大写 —— 必须大小写不敏感
    await need('compliance')
    const text = await body()
    assert(
      text.toUpperCase().includes('PASS'),
      `${label} 哨兵未 PASS：${text.match(/FAIL[^\n]*/)?.[0] ?? '未知'}`,
    )
  })
}

/* ======================================================================
   十二、GameJolt 半自动导入
   ======================================================================
   两段外部请求都在 Playwright 层拦掉：
     - 本机助手（127.0.0.1:4317）→ 固定夹具
     - GameJolt CDN（m.gjcdn.net）→ 一张真实的 1000×600 PNG
   这样断言的是「后台自己的抓取预览 / 字段映射 / 图片上传 / 保存」，
   而不是 GameJolt 今天是否在线、某张截图是否还挂在 CDN 上。
   ====================================================================== */
await step('GameJolt 导入 · 抓取预览 → 填表 → 传图 → 保存草稿', async () => {
  const fixture = {
    sourceUrl: 'https://gamejolt.com/games/gamejolt-import-test/999999',
    gameJoltId: 999999,
    title: 'GameJolt Import Test',
    author: 'GameJolt Tester',
    releaseYear: 2021,
    engine: 'Unity',
    ipSeries: 'FNAF',
    description: 'A test description imported from GameJolt.',
    shortDescription: 'A test game imported from GameJolt.',
    coverImage: 'https://m.gjcdn.net/test/cover.webp',
    bannerImage: 'https://m.gjcdn.net/test/banner.webp',
    gallery: ['https://m.gjcdn.net/test/gallery-1.webp', 'https://m.gjcdn.net/test/gallery-2.webp'],
    videoUrl: 'https://www.youtube.com/watch?v=test',
    tags: ['horror', 'fangame'],
    warnings: [],
  }

  const png = await makePng(1000, 600)
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-private-network': 'true',
  }

  const helperHandler = async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    await route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, data: fixture }),
    })
  }

  const imageHandler = async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'image/png', 'access-control-allow-origin': '*' },
      body: png,
    })
  }

  await context.route('http://127.0.0.1:4317/**', helperHandler)
  await context.route('https://m.gjcdn.net/**', imageHandler)

  try {
    await go('/admin/games/new', '从 GameJolt 导入')

    await page.fill('#gamejolt-url', fixture.sourceUrl)
    await btn('抓取信息').click()
    await page.getByText(fixture.title, { exact: false }).first().waitFor({ timeout: 10000 })
    await need('GameJolt #999999')

    await btn('填入表单并上传图片').click()
    await page.getByText('导入结果', { exact: false }).first().waitFor({ timeout: 20000 })
    await page.waitForTimeout(800)

    assert((await page.inputValue('#f-title')) === fixture.title, '标题没有填进草稿')
    assert((await page.inputValue('#f-author')) === fixture.author, '作者没有填进草稿')
    assert((await page.inputValue('#f-year')) === '2021', '年份没有填进草稿')
    assert((await page.inputValue('#f-series')) === 'FNAF', 'IP 系列没有填进草稿')
    assert((await page.inputValue('#f-engine')) === 'Unity', '引擎没有填进草稿')

    // 1 封面 + 1 Banner + 2 截图 = 4 张；图片走的是现有的 uploadImage 链路
    await need('已填入表单并上传 4 张图片')
    const cover = await page.inputValue('#f-cover-url')
    assert(
      cover.includes('/images/games/gamejolt-import-test/cover-'),
      `封面没有上传到按标题生成的目录：${cover}`,
    )
    assert(cover.endsWith('.webp'), `上传前应转成 WebP：${cover}`)

    await btn('保存').click()
    await page.getByText('保存结果', { exact: false }).first().waitFor({ timeout: 10000 })
    await page.waitForTimeout(500)

    const created = fakeDb.games.find((game) => game.id === 'gamejolt-import-test')
    assert(Boolean(created), '数据仓里没有新建的 GameJolt 条目')
    assert(created.status === 'draft', `导入后应是草稿，实际 ${created.status}`)
    assert(created.downloads.length === 0, '下载渠道必须保持为空，等待人工补充')
    assert(created.gallery.length === 2, `图库应有 2 张，实际 ${created.gallery.length}`)
    await shot('43-gamejolt-import')
  } finally {
    await context.unroute('http://127.0.0.1:4317/**', helperHandler)
    await context.unroute('https://m.gjcdn.net/**', imageHandler)
    // 这一条会往假数据仓里多写一条；复原，避免影响后续任何计数断言
    fakeDb = JSON.parse(JSON.stringify(localDb))
    fakeSha = 'sha-1'
  }
})

await step('GameJolt 导入 · 扩展 ZIP 拖入 → 预览 → 传图 → 保存草稿', async () => {
  const fixture = {
    sourceUrl: 'https://gamejolt.com/games/gamejolt-zip-test/999998',
    gameJoltId: 999998,
    title: 'GameJolt ZIP Import Test',
    author: 'ZIP Tester',
    releaseYear: 2022,
    engine: 'Godot',
    ipSeries: 'FNAF',
    description: 'A test description imported from a capture ZIP.',
    shortDescription: 'A test game imported from a capture ZIP.',
    coverImage: 'https://m.gjcdn.net/zip/cover.png',
    bannerImage: 'https://m.gjcdn.net/zip/banner.png',
    gallery: ['https://m.gjcdn.net/zip/gallery-1.png', 'https://m.gjcdn.net/zip/gallery-2.png'],
    videoUrl: '',
    tags: ['zip-test'],
    warnings: [],
  }

  const png = await makePng(1000, 600)
  const manifest = {
    format: 'fnaf-archive-gamejolt-capture',
    version: 1,
    sourceUrl: fixture.sourceUrl,
    gameJoltId: fixture.gameJoltId,
    title: fixture.title,
    fetchedAt: '2026-10-24T12:34:56.000Z',
    generator: 'test/1.0.0',
    images: [
      { url: fixture.coverImage, file: 'images/cover.png', role: 'cover', contentType: 'image/png' },
      { url: fixture.bannerImage, file: 'images/banner.png', role: 'banner', contentType: 'image/png' },
      {
        url: fixture.gallery[0],
        file: 'images/gallery-1.png',
        role: 'gallery-1',
        contentType: 'image/png',
      },
      {
        url: fixture.gallery[1],
        file: 'images/gallery-2.png',
        role: 'gallery-2',
        contentType: 'image/png',
      },
    ],
  }

  const zip = zipSync(
    {
      'manifest.json': strToU8(JSON.stringify(manifest)),
      'capture.json': strToU8(JSON.stringify(fixture)),
      'README.txt': strToU8('test capture'),
      'images/cover.png': png,
      'images/banner.png': png,
      'images/gallery-1.png': png,
      'images/gallery-2.png': png,
    },
    { level: 0 },
  )

  try {
    await go('/admin/games/new', '从 GameJolt 导入')

    await page.setInputFiles('#gamejolt-zip', {
      name: 'gamejolt-capture.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from(zip),
    })

    await page.getByText(fixture.title, { exact: false }).first().waitFor({ timeout: 10000 })
    await need('GameJolt #999998')
    await need('来源：扩展 ZIP')
    await need('已读取：gamejolt-capture.zip')

    await btn('填入表单并上传图片').click()
    await page.getByText('导入结果', { exact: false }).first().waitFor({ timeout: 20000 })
    await page.waitForTimeout(800)

    assert((await page.inputValue('#f-title')) === fixture.title, 'ZIP 标题没有填进草稿')
    assert((await page.inputValue('#f-author')) === fixture.author, 'ZIP 作者没有填进草稿')
    assert((await page.inputValue('#f-year')) === '2022', 'ZIP 年份没有填进草稿')
    assert((await page.inputValue('#f-engine')) === 'Godot', 'ZIP 引擎没有填进草稿')

    // 1 封面 + 1 Banner + 2 截图 = 4 张；图片来自 ZIP，不再请求 CDN
    await need('已填入表单并上传 4 张图片')
    const cover = await page.inputValue('#f-cover-url')
    assert(
      cover.includes('/images/games/gamejolt-zip-import-test/cover-'),
      `ZIP 封面没有上传到按标题生成的目录：${cover}`,
    )
    assert(cover.endsWith('.webp'), `ZIP 图片上传前应转成 WebP：${cover}`)

    await btn('保存').click()
    await page.getByText('保存结果', { exact: false }).first().waitFor({ timeout: 10000 })
    await page.waitForTimeout(500)

    const created = fakeDb.games.find((game) => game.id === 'gamejolt-zip-import-test')
    assert(Boolean(created), '数据仓里没有新建的 ZIP 导入条目')
    assert(created.status === 'draft', `ZIP 导入后应是草稿，实际 ${created.status}`)
    assert(created.downloads.length === 0, 'ZIP 导入不应碰下载渠道')
    assert(created.gallery.length === 2, `ZIP 图库应有 2 张，实际 ${created.gallery.length}`)
    await shot('44-gamejolt-zip-import')
  } finally {
    fakeDb = JSON.parse(JSON.stringify(localDb))
    fakeSha = 'sha-1'
  }
})
/* ======================================================================
   十三、Phase 3 —— 前台可点击索引 / URL 状态
   ======================================================================
   这一组直接在 **本机仓储** 里放两条一次性可见作品 + 一条草稿：
     - 公共前台在 dev 下读的就是 localStorage 里的目录；
     - 草稿用来验证「索引不绕过公开可见性」；
     - 结束后不再还原，因为这是测试的最后一段（下一次运行会先 resetLocalData）。
   ====================================================================== */
const indexTaxonomy = {
  gameplayTypes: [
    { id: 'traditional-night-watch', name: '传统守夜式', description: '' },
    { id: 'exploration', name: '探索式', description: '' },
    { id: 'unused-style', name: '未使用玩法', description: '' },
  ],
  mechanics: [{ id: 'security-cameras', name: '监控摄像头', description: '' }],
  platforms: [
    { id: 'windows', name: 'Windows', description: '' },
    { id: 'web', name: 'Web', description: '' },
  ],
}

const indexGameA = {
  ...JSON.parse(JSON.stringify(TEST_GAME)),
  id: 'index-probe-a',
  title: '索引探针甲',
  author: '索引作者甲',
  releaseYear: 2019,
  status: 'published',
  archived: false,
  altTitles: ['索引别名'],
  gameplayTypes: ['traditional-night-watch'],
  mechanics: ['security-cameras'],
  platforms: ['windows'],
}
const indexGameB = {
  ...indexGameA,
  id: 'index-probe-b',
  title: '索引探针乙',
  author: '索引作者乙',
  releaseYear: 2021,
  altTitles: [],
  gameplayTypes: ['exploration'],
  mechanics: [],
  platforms: ['web'],
  tags: ['ProbeTag'],
}
const indexDraft = {
  ...indexGameA,
  id: 'index-probe-draft',
  title: '不可见索引探针',
  status: 'draft',
}

await step('Phase 3 · 详情页属性可点击 → 首页索引结果', async () => {
  await page.evaluate(
    ({ games, taxonomy }) => {
      localStorage.setItem('fnaf-archive:admin-catalog:v1', JSON.stringify(games))
      localStorage.setItem('fnaf-archive:taxonomy:v1', JSON.stringify(taxonomy))
    },
    { games: [indexGameA, indexGameB, indexDraft], taxonomy: indexTaxonomy },
  )

  await go(`/game/${indexGameA.id}`, indexGameA.title)
  const facts = page.locator('table')
  await facts.getByRole('button', { name: '传统守夜式', exact: true }).click()
  await page.waitForTimeout(600)

  assert(
    page.url().includes('gameplay=traditional-night-watch'),
    `URL 没有带上玩法条件：${page.url()}`,
  )
  await need('当前索引条件')
  await need('命中 1 款')
  await need(indexGameA.title)
  await needNot(indexGameB.title)
  await needNot(indexDraft.title)
  await shot('45-index-gameplay')
})

await step('Phase 3 · 平台 / 机制 / 标签 / 作者都是索引入口', async () => {
  const clickFactThenCheck = async (label, expectedParam, expectedHits) => {
    await go(`/game/${indexGameA.id}`, indexGameA.title)
    await page.locator('table').getByRole('button', { name: label, exact: true }).click()
    await page.waitForTimeout(600)
    assert(page.url().includes(expectedParam), `URL 缺少 ${expectedParam}：${page.url()}`)
    await need(`命中 ${expectedHits} 款`)
  }

  await clickFactThenCheck('Windows', 'platform=windows', 1)
  await clickFactThenCheck('监控摄像头', 'mechanic=security-cameras', 1)
  await clickFactThenCheck(indexGameA.author, 'author=', 1)
  await clickFactThenCheck('2019', 'year=2019', 1)

  const tag = indexGameA.tags?.[0]
  if (tag) {
    await go(`/game/${indexGameA.id}`, indexGameA.title)
    await page
      .locator('ul[aria-label="作品标签"]')
      .getByRole('button', { name: tag, exact: true })
      .click()
    await page.waitForTimeout(600)
    assert(page.url().includes('tag='), `标签没有进入 URL：${page.url()}`)
    await need('命中 1 款')
  }
})

await step('Phase 3 · 刷新 / 后退 / 前进保留索引状态', async () => {
  await go(`/game/${indexGameA.id}`, indexGameA.title)
  await page.locator('table').getByRole('button', { name: '传统守夜式', exact: true }).click()
  await page.waitForTimeout(600)
  await need('命中 1 款')

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(600)
  await need('当前索引条件')
  await need('命中 1 款')
  assert(page.url().includes('gameplay='), '刷新后 URL 丢了索引条件')

  await page.goBack()
  await page.waitForTimeout(500)
  assert(page.url().includes(`/game/${indexGameA.id}`), `后退没有回到详情页：${page.url()}`)
  await need(indexGameA.title)

  await page.goForward()
  await page.waitForTimeout(600)
  await need('当前索引条件')
  await need('命中 1 款')
})

await step('Phase 3 · 同维多选 OR / 跨维 AND / 搜索别名', async () => {
  await go(`/?year=2019&year=2021`, '游戏库')
  await page.waitForTimeout(600)
  await need('命中 2 款')

  await go(`/?author=${encodeURIComponent(indexGameA.author)}&gameplay=exploration`, '游戏库')
  await page.waitForTimeout(600)
  await need('命中 0 款')

  await go(`/?author=${encodeURIComponent(indexGameB.author)}&gameplay=exploration`, '游戏库')
  await page.waitForTimeout(600)
  await need('命中 1 款')
  await need(indexGameB.title)

  await go('/', '游戏库')
  await page.fill('#library-search', '索引别名')
  await page.waitForTimeout(600)
  await need('命中 1 款')
  assert(decodeURIComponent(page.url()).includes('q=索引别名'), '搜索词没有写进 URL')
  await shot('46-index-search')
})

await step('Phase 3 · 失效索引条件可见、可清除，且不静默显示全部', async () => {
  await go('/?gameplay=deleted-index-entry', '游戏库')
  await page.waitForTimeout(600)
  await need('已失效')
  await need('清除失效条件')
  await need('命中 0 款')
  await shot('47-index-invalid')

  await btn('清除失效条件').click()
  await page.waitForTimeout(600)
  await need('命中 2 款')
  assert(!page.url().includes('deleted-index-entry'), '清除后 URL 里仍有失效条件')
})

await step('Phase 3 · 清除全部筛选恢复完整公开集合', async () => {
  await go('/?gameplay=traditional-night-watch', '游戏库')
  await page.waitForTimeout(600)
  await need('命中 1 款')
  await btn('清除全部筛选').click()
  await page.waitForTimeout(600)
  await need('命中 2 款')
  assert(!page.url().includes('gameplay='), '清除后 URL 仍有筛选条件')
})

/* ======================================================================
   十四、Phase 4 —— 组合筛选 UI（分组 / 多选 / 移动端）
   ====================================================================== */
await step('Phase 4 · 筛选面板展示八个可用分组，空分组不渲染', async () => {
  await go('/', '游戏库')

  for (const label of [
    '玩法类型',
    '游戏机制',
    '支持平台',
    '作者',
    'IP 系列',
    '年份',
    '开发引擎',
    '标签',
  ]) {
    const group = page.getByRole('group', { name: label })
    await group.first().waitFor({ timeout: 5000 })
    assert((await group.count()) === 1, `分组「${label}」出现了 ${await group.count()} 次`)
  }

  // 词表里存在但没有任何可见作品使用的词条不能出现在公开面板里
  await needNot('未使用玩法')

  const gameplayButtons = page
    .getByRole('group', { name: '玩法类型' })
    .getByRole('button')
  assert(
    (await gameplayButtons.count()) === 2,
    `玩法分组应只有 2 个被使用的词条，实际 ${await gameplayButtons.count()}`,
  )
  await shot('48-filter-groups')
})

await step('Phase 4 · 同维多选 OR、跨维 AND、aria-pressed 与 URL', async () => {
  await go('/', '游戏库')
  const gameplay = page.getByRole('group', { name: '玩法类型' })
  const traditional = gameplay.getByRole('button', { name: '传统守夜式', exact: true })

  await traditional.click()
  await page.waitForTimeout(600)
  await need('命中 1 款')
  assert(
    (await traditional.getAttribute('aria-pressed')) === 'true',
    '选中的筛选 chip 没有 aria-pressed=true',
  )

  const exploration = gameplay.getByRole('button', { name: '探索式', exact: true })
  await exploration.click()
  await page.waitForTimeout(600)
  await need('命中 2 款')
  const url = decodeURIComponent(page.url())
  assert(
    url.includes('gameplay=traditional-night-watch') && url.includes('gameplay=exploration'),
    `同维多值没有写进 URL：${url}`,
  )

  const windows = page
    .getByRole('group', { name: '支持平台' })
    .getByRole('button', { name: 'Windows', exact: true })
  await windows.click()
  await page.waitForTimeout(600)
  await need('命中 1 款')
  await need(indexGameA.title)
  await needNot(indexGameB.title)
  await shot('49-filter-combined')
})

await step('Phase 4 · 搜索与筛选叠加、清除全部恢复', async () => {
  await go('/', '游戏库')
  await page.fill('#library-search', '索引探针')
  await page.waitForTimeout(600)
  await need('命中 2 款')

  await page
    .getByRole('group', { name: '玩法类型' })
    .getByRole('button', { name: '传统守夜式', exact: true })
    .click()
  await page.waitForTimeout(600)
  await need('命中 1 款')

  await page.fill('#library-search', '不存在的关键词')
  await page.waitForTimeout(600)
  await need('命中 0 款')

  await btn('清除全部筛选').click()
  await page.waitForTimeout(600)
  await need('命中 2 款')
  assert((await page.inputValue('#library-search')) === '', '清除后搜索框没有清空')
  assert(!page.url().includes('q='), '清除后 URL 仍有搜索词')
})

await step('Phase 4 · 移动端筛选面板可用且无横向溢出', async () => {
  await page.setViewportSize({ width: 390, height: 844 })
  await go('/', '游戏库')

  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewport: innerWidth,
    groups: document.querySelectorAll('[role="group"]').length,
  }))
  assert(
    layout.scrollWidth <= layout.viewport + 1,
    `移动端出现横向溢出：${layout.scrollWidth} > ${layout.viewport}`,
  )
  assert(layout.groups >= 8, `移动端分组数量不足：${layout.groups}`)

  await page
    .getByRole('group', { name: '玩法类型' })
    .getByRole('button', { name: '传统守夜式', exact: true })
    .click()
  await page.waitForTimeout(600)
  await need('命中 1 款')
  await shot('50-filter-mobile')

  await page.setViewportSize({ width: 1440, height: 1000 })
})

/* ======================================================================
   十五、Phase 5 —— 作品关联
   ====================================================================== */
await step('Phase 5 · 后台添加关联、保存、预览、移除', async () => {
  // 让公开详情页能看到目标作品（预览用真实 GameDetail + 公开可见目录）
  await page.evaluate(
    ({ games, taxonomy }) => {
      localStorage.setItem('fnaf-archive:admin-catalog:v1', JSON.stringify(games))
      localStorage.setItem('fnaf-archive:taxonomy:v1', JSON.stringify(taxonomy))
    },
    { games: localDb.games, taxonomy: indexTaxonomy },
  )

  await go(`/admin/games/${TEST_GAME_ID}/edit`, '基本信息')
  const section = page.locator('#section-relations')
  await section.waitFor({ timeout: 5000 })
  await need('还没有关联作品')

  await page.selectOption('#relation-type', 'sequel')
  await section
    .getByRole('button')
    .filter({ hasText: OTHER_GAME.title })
    .first()
    .click()
  await page.waitForTimeout(300)
  await need('续作')
  assert(
    (await section.getByRole('button', { name: `移除关联 ${OTHER_GAME.title}` }).count()) === 1,
    '添加关系后没有出现对应的移除入口',
  )

  await btn('保存').click()
  await page.waitForTimeout(900)
  await need('保存结果')

  // 重新加载后关系仍在
  await go(`/admin/games/${TEST_GAME_ID}/edit`, '基本信息')
  assert(
    (await page.locator(`#section-relations button[aria-label="移除关联 ${OTHER_GAME.title}"]`).count()) === 1,
    '保存后重新加载，关系没有保留',
  )

  // 预览：真实详情页展示关联作品
  const [previewPage] = await Promise.all([
    context.waitForEvent('page'),
    btn('预览').click(),
  ])
  await previewPage.waitForLoadState('domcontentloaded')
  await previewPage.getByText('相关作品', { exact: false }).first().waitFor({ timeout: 10000 })
  const previewText = await previewPage.locator('body').innerText()
  assert(previewText.includes('续作'), '预览里没有关系文案')
  assert(previewText.includes(OTHER_GAME.title), '预览里没有关联目标作品')
  await previewPage.close()

  // 移除并保存，恢复原状
  await go(`/admin/games/${TEST_GAME_ID}/edit`, '基本信息')
  await page.getByRole('button', { name: `移除关联 ${OTHER_GAME.title}` }).click()
  await page.waitForTimeout(300)
  await btn('保存').click()
  await page.waitForTimeout(900)
  await go(`/admin/games/${TEST_GAME_ID}/edit`, '基本信息')
  await need('还没有关联作品')
  await shot('51-relations-editor')
})

await step('Phase 5 · 详情页：方向 / 反向 / 同作者 / 同系列 / 可见性', async () => {
  const gameA = {
    ...indexGameA,
    relations: [{ type: 'sequel', targetId: indexGameB.id }],
  }
  const gameB = { ...indexGameB, relations: [] }
  const gameC = {
    ...indexGameA,
    id: 'index-probe-c',
    title: '索引探针丙',
    ipSeries: 'Other Series',
    relations: [],
    altTitles: [],
  }
  const gameD = {
    ...indexGameA,
    id: 'index-probe-d',
    title: '索引探针丁',
    author: '索引作者丁',
    relations: [],
    altTitles: [],
  }
  const gameE = {
    ...indexGameA,
    id: 'index-probe-e',
    title: '独行探针',
    author: '独行作者',
    ipSeries: '独行系列',
    relations: [],
    altTitles: [],
  }
  const draftPeer = {
    ...indexGameA,
    id: 'index-probe-draft-peer',
    title: '隐藏关联探针',
    status: 'draft',
    relations: [{ type: 'prequel', targetId: indexGameA.id }],
    altTitles: [],
  }

  await page.evaluate(
    ({ games, taxonomy }) => {
      localStorage.setItem('fnaf-archive:admin-catalog:v1', JSON.stringify(games))
      localStorage.setItem('fnaf-archive:taxonomy:v1', JSON.stringify(taxonomy))
    },
    {
      games: [gameA, gameB, gameC, gameD, gameE, draftPeer],
      taxonomy: indexTaxonomy,
    },
  )

  await go(`/game/${gameA.id}`, gameA.title)
  await need('相关作品')
  await need('关联作品')
  await need('续作')
  await need(gameB.title)
  await need('同作者的其他作品')
  await need(gameC.title)
  await need('同系列的其他作品')
  await need(gameD.title)
  await needNot(draftPeer.title)

  // 反向文案：B 页显示 A 是「前传」
  await go(`/game/${gameB.id}`, gameB.title)
  await need('前传')
  await need(gameA.title)

  // 没有关系、没有同作者 / 同系列 → 整个区块不渲染
  await go(`/game/${gameE.id}`, gameE.title)
  await needNot('相关作品')

  // 点击相关作品进入详情页
  await go(`/game/${gameA.id}`, gameA.title)
  await page.getByRole('link', { name: new RegExp(gameB.title) }).first().click()
  await page.waitForTimeout(500)
  assert(page.url().includes(`/game/${gameB.id}`), `相关作品链接没有跳到目标页：${page.url()}`)
  await need('前传')
  await shot('52-related-works')
})

await step('控制台无 JS 报错 / 无业务请求 4xx', async () => {
  const real = consoleErrors.filter((e) => !e.includes('404'))
  assert(real.length === 0, `控制台有 ${real.length} 条报错：\n        ${real.slice(0, 5).join('\n        ')}`)
  const unexpected = badResponses.filter((r) => !r.includes('favicon'))
  assert(
    unexpected.length === 0,
    `有非 favicon 的 4xx 响应：\n        ${unexpected.slice(0, 5).join('\n        ')}`,
  )
})

await browser.close()

const failed = results.filter((r) => !r.pass)
console.log('')
console.log(`UI 点击测试：${results.length - failed.length}/${results.length} 通过`)
console.log(`（浏览器自动请求的 4xx：${[...new Set(badResponses)].join(' | ') || '无'}）`)
if (failed.length) {
  console.log('\n失败项：')
  for (const f of failed) console.log(`- ${f.name}\n  ${f.error}`)
}
console.log(`截图目录：${SHOTS}`)
process.exit(failed.length ? 1 : 0)
