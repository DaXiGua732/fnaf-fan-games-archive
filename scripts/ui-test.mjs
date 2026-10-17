/**
 * 后台 UI 点击测试（真实浏览器）
 *
 * 覆盖 SSR 冒烟测不到的部分：勾选、批量、二次确认、保存、未保存拦截、
 * 标签录入 / 重命名、图片上传与自动压缩、预览、永久删除。
 *
 * 前置：
 *   1. `npm run dev`（默认 http://localhost:5173，可用 BASE 覆盖）
 *   2. 本机安装 Chrome —— 用 `channel: 'chrome'`，不下载 Playwright 自带浏览器
 *   3. `npm i`（playwright 在 devDependencies 里；本项目的安装惯例是 --ignore-scripts）
 *
 * 运行：`npm run test:ui`
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

const browser = await chromium.launch({ channel: 'chrome', headless: true })
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
async function go(p, waitText) {
  await page.goto(hash(p), { waitUntil: 'domcontentloaded' })
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
const TOTAL_COUNT = localDb.games.length
const VISIBLE_COUNT = localDb.games.filter(
  (game) => (game.status ?? 'published') === 'published' && !game.archived,
).length
let fakeDb = JSON.parse(JSON.stringify(localDb))
let fakeSha = 'sha-1'
let fakeCommits = 0

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
  await need('The Joy of Creation: Reborn')
  const cards = await page.locator('article').count()
  assert(cards === VISIBLE_COUNT, `首页卡片数应为 ${VISIBLE_COUNT}，实际 ${cards}`)
  await shot('01-home')
})

await step('公开站 · 筛选：点年份 2015 → 命中 2 款', async () => {
  await go('/', '游戏库')
  await btn('2015').click()
  await page.getByText('命中 2 款', { exact: false }).first().waitFor({ timeout: 5000 })
  await shot('02-home-filter-2015')
})

await step('公开站 · 搜索 flumpty → 只剩 1 张卡片', async () => {
  await page.fill('#library-search', 'flumpty')
  await page.getByText('命中 1 款', { exact: false }).first().waitFor({ timeout: 5000 })
  const cards = await page.locator('article').count()
  assert(cards === 1, `应剩 1 张卡片，实际 ${cards}`)
})

await step('公开站 · 点卡片进入详情页', async () => {
  // 链接是包在 article **外面**的（RouterLink > Card > article），所以点 article 本身
  await page.locator('article').first().click()
  await page.getByText('资源下载', { exact: false }).first().waitFor({ timeout: 8000 })
  assert(page.url().includes('/game/'), `URL 未跳到详情页：${page.url()}`)
  await shot('03-detail')
})

await step('详情页 · 截图灯箱支持键盘切换与关闭', async () => {
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
  await need('未选择任何作品')
  await need('已上线')
  await shot('04-admin-games')
})

await step('Phase 2 · 搜索 unreal → 2 行', async () => {
  await page.fill('#admin-search', 'unreal')
  await page.waitForTimeout(300)
  const n = await rowCount()
  assert(n === 2, `应有 2 行，实际 ${n}`)
})

await step('Phase 2 · 状态筛选「草稿」→ 空状态', async () => {
  await page.fill('#admin-search', '')
  await page.waitForTimeout(200)
  await chip('草稿').click()
  await page.waitForTimeout(300)
  await need('No Results')
  const n = await rowCount()
  assert(n === 1, `空状态应只有 1 行提示，实际 ${n}`)
  await chip('全部').click()
  await page.waitForTimeout(300)
})

await step('Phase 2 · 排序切「游戏名称」→ 首行是标题最小的那条', async () => {
  await page.locator('#admin-filter-sort').selectOption('title')
  await page.waitForTimeout(400)

  // ⚠️ 断言**排序规则**而不是某个写死的标题。
  //    原先写死「Dayshift at Freddy」，站长把那条作品的标题一改，这里就假失败了。
  //    正确做法：首行应等于当前列表里标题最小的那一个（用同一份数据自行推导）。
  // 名称列的第 3 个 td；标题现在是通往编辑页的链接，取链接文本才是纯标题
  const cells = await page.locator('table tbody tr td:nth-child(3) a').allInnerTexts()
  const titles = cells.map((text) => text.replace(/\s+/g, ' ').trim())
  const ascending = [...titles].sort((a, b) => a.localeCompare(b, 'en'))
  assert(titles.length > 1, '列表里至少应有两条作品才谈得上排序')
  assert(
    titles[0] === ascending[0],
    `首行应是标题升序的第一个：期望 ${JSON.stringify(ascending[0])}，实际 ${JSON.stringify(titles[0])}`,
  )
})

await step('Phase 2 · 每页条数可调小 → 分页控件出现并能前后翻页', async () => {
  const options = await page.locator('#admin-page-size option').allTextContents()
  assert(options.join(',') === '5,10,20,50,100', `每页选项不符：${options.join(',')}`)

  await page.locator('#admin-page-size').selectOption('5')
  await page.waitForTimeout(400)
  const PAGE_COUNT = Math.ceil(TOTAL_COUNT / 5)
  let n = await rowCount()
  assert(n === Math.min(5, TOTAL_COUNT), `每页 5 条时应有 ${Math.min(5, TOTAL_COUNT)} 行，实际 ${n}`)
  await need(`1 / ${PAGE_COUNT}`)
  await shot('05a-admin-paging')

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
  assert(archivedRows === 2, `已归档筛选应有 2 行，实际 ${archivedRows}`)
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
  await go('/admin/games', '收录作品')
  await link('编辑').click()
  await page.getByText('基本信息', { exact: false }).first().waitFor({ timeout: 8000 })
  assert(page.url().includes('/edit'), `未进入编辑页：${page.url()}`)
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
  await go('/admin/tags', '标签管理')
  await need('恐怖')
  await need('3D')
  await shot('15-tags')
})

await step('Phase 6 · 编辑页录入标签并保存', async () => {
  await go('/admin/games/tjoc-reborn/edit', '基本信息')
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
  await go('/admin/tags', '标签管理')
  await page.fill('#tag-search', '3d')
  await page.waitForTimeout(300)
  await need('命中 1 /')
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

await step('Phase 6 · 重命名确实改到了作品上', async () => {
  await go('/admin/games/tjoc-reborn/edit', '基本信息')
  await need('三维')
  await needNot('3D')
})

await step('Phase 6 · 删除标签：页内确认 → 标签消失、作品保留', async () => {
  await go('/admin/tags', '标签管理')
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

/* ======================================================================
   六·五、Phase 7 —— 图片管理 UI
   ====================================================================== */
await step('Phase 7 · 封面与图库带出真实数据', async () => {
  await go('/admin/games/tjoc-reborn/edit', '基本信息')
  await need('封面与宣传图')
  await need('Banner 宣传图')
  await need('或直接填图片地址')
  const cover = await page.inputValue('#f-cover-url')
  // 只校验末段文件名：地址形态会随数据来源变化（站内路径 / 数据仓绝对外链），
  // 写死整串会在数据换源时假失败。
  assert(
    cover.endsWith('tjoc-reborn-cover.svg'),
    `封面地址末段不符：${cover}`,
  )
  assert(cover.length > 0, '封面地址不应为空')
  await need('图库')
  await need('NO.01')
  await need('2 / 8 张')
  await shot('21-images')
})

await step('Phase 7 · 封面地址校验：非法拒绝、合法通过', async () => {
  await page.fill('#f-cover-url', 'nope')
  await page.waitForTimeout(300)
  await need('请填写站内路径（以 / 开头）或 http(s) 图片地址')
  await shot('22-cover-error')
  await page.fill('#f-cover-url', '/images/tjoc-reborn-cover.svg')
  await page.waitForTimeout(300)
  await needNot('请填写站内路径（以 / 开头）或 http(s) 图片地址')
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
  await page.fill('#gallery-url', 'not a path')
  await btn('加入图片').click()
  await page.waitForTimeout(300)
  await need('请填写站内路径（以 / 开头）或 http(s) 图片地址')

  await page.fill('#gallery-url', '/images/ui-test-gallery.png')
  await btn('加入图片').click()
  await page.waitForTimeout(300)
  await need('3 / 8 张')
  await shot('23-gallery')

  await page.locator('figure').nth(2).getByRole('button', { name: '删除第 3 张' }).click()
  await page.waitForTimeout(300)
  await need('2 / 8 张')

  await page.fill('#gallery-url', '/images/ui-test-gallery.png')
  await btn('加入图片').click()
  await page.waitForTimeout(300)
  await need('3 / 8 张')
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
  await go('/admin/games/tjoc-reborn/edit', '基本信息')
  await need('下载资源')
  const provider0 = await page.inputValue('#dl-0-provider')
  assert(provider0 === '123云盘', `第 1 行服务商不符：${provider0}`)
  const url0 = await page.inputValue('#dl-0-url')
  assert(url0.startsWith('https://'), `第 1 行地址不符：${url0}`)
  const pwd0 = await page.inputValue('#dl-0-password')
  assert(pwd0 === 'tjoc', `第 1 行提取码不符：${pwd0}`)
  await need('2 / 8 个渠道')
  await shot('25-downloads')
})

await step('Phase 8 · 新增渠道：空行不飘红，开始填才实时提示', async () => {
  await btn('添加下载渠道').click()
  await page.waitForTimeout(300)
  await need('3 / 8 个渠道')
  // 刚加的空行不该立刻报错 —— 那是噪音
  await needNot('服务商不能为空')

  await page.fill('#dl-2-provider', '夸克网盘')
  await page.waitForTimeout(300)
  await need('下载地址不能为空')

  await page.fill('#dl-2-url', 'www.quark.cn')
  await page.waitForTimeout(300)
  await need('下载地址必须是 http:// 或 https:// 开头的完整链接')
  await shot('26-download-error')

  await page.fill('#dl-2-url', 'https://pan.quark.cn/s/ui-test')
  await page.fill('#dl-2-password', 'ui9')
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

  await page.getByRole('button', { name: '删除第 3 个渠道' }).click()
  await page.waitForTimeout(300)
  await need('2 / 8 个渠道')
  await btn('保存').click()
  await page.waitForTimeout(700)
  await need('保存结果')
})

/* ======================================================================
   六·七、Phase 9 —— 发布状态 / 归档 / 推荐排序
   ====================================================================== */
await step('Phase 9 · 发布设置与推荐排序区块渲染', async () => {
  await go('/admin/games/tjoc-reborn/edit', '基本信息')
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
  await page.fill('#f-cover-url', '/images/tjoc-reborn-cover.svg')
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
  await need('当前筛选条件下没有匹配的游戏')
  await shot('45-deleted')
})

/* ======================================================================
   八、Phase 16 —— 改动提交到数据仓（开发环境前台仍读快照）
   ====================================================================== */
await step('Phase 16 · 后台改状态会提交到数据仓（开发环境前台仍读快照）', async () => {
  // ⚠️ 先强刷。筛选 / 搜索是**会话内**状态，上一步留下的条件会把目标作品挡在外面
  //    （我重写这一步时漏掉过这句，结果 popgoes 被残留筛选挡住、表格里一行都没有）。
  await page.goto(hash('/admin/games'), { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByText('收录作品', { exact: false }).first().waitFor({ timeout: 8000 })

  await page.fill('#admin-search', 'popgoes')
  await page.waitForTimeout(400)
  await page.locator('tbody input[type=checkbox]').first().check()
  await page.waitForTimeout(200)
  await btn('下线').click()
  await page.waitForTimeout(200)
  await btn('确认执行').click()
  await page.waitForTimeout(600)
  await need('实际改动 1 项')

  // 真刷新 —— 状态仍然在，说明它确实写进了「数据仓」，而不是只躺在本机内存里
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByText('收录作品', { exact: false }).first().waitFor({ timeout: 8000 })
  await page.fill('#admin-search', 'popgoes')
  await page.waitForTimeout(600)
  await need('已下线')
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

  // 复原：把 popgoes 放回上线
  await nav('/admin/games', '收录作品')
  await page.fill('#admin-search', 'popgoes')
  await page.waitForTimeout(400)
  await page.locator('tbody input[type=checkbox]').first().check()
  await page.waitForTimeout(200)
  await btn('上线').click()
  await page.waitForTimeout(600)
})

/* ======================================================================
   九、Phase 12 —— 本机持久化（刷新不丢）+ 逃生舱
   ====================================================================== */
await step('Phase 12 · 提示条如实说明改动写到了哪里', async () => {
  await go('/admin/games', '收录作品')
  await need('数据现状')
  // 远程模式下说明的是「提交到数据仓」，不再说「存在这台设备的浏览器里」
  await need('数据仓')
  await needNot('这台设备的浏览器')
})

await step('Phase 12 · 改动在真刷新之后仍然存在', async () => {
  await go('/admin/games/tjoc-reborn/edit', '基本信息')
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
  await page.fill('#f-title', 'The Joy of Creation: Reborn')
  await btn('保存').click()
  await page.waitForTimeout(700)
})

await step('Phase 16 · 远程模式下不提供「恢复出厂数据」', async () => {
  await go('/admin/games', '收录作品')
  await need('数据现状')
  await need('数据仓')

  // ⚠️ 这个按钮在远程模式下必须消失：它等于「用出厂内容覆盖线上数据仓」，
  //    不是后台该有的能力。要回滚请对数据仓做 git revert。
  await needNot('恢复出厂数据')
  await need('提交到数据仓')
  await shot('36-remote-no-reset')
})

/* ======================================================================
   十、Phase 16 —— 图片上传到数据仓
   ====================================================================== */
await step('Phase 16 · 选图会真的上传，并把完整外链写进草稿', async () => {
  await go('/admin/games/tjoc-reborn/edit', '基本信息')
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
      'https://daxigua732.github.io/fnaf-fan-games-data/images/games/tjoc-reborn/cover-',
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
  await go('/admin/games/tjoc-reborn/edit', '基本信息')
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
  await go('/admin/games/tjoc-reborn/edit', '基本信息')
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
  await page.fill('#f-title', 'The Joy of Creation: Reborn')
  await page.waitForTimeout(300)
})

/* ======================================================================
   十一、视觉规范哨兵 + 控制台
   ====================================================================== */
for (const [label, path, wait] of [
  ['游戏列表', '/admin/games', '收录作品'],
  ['编辑页', '/admin/games/tjoc-reborn/edit', '基本信息'],
  ['标签页', '/admin/tags', '标签管理'],
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
