/**
 * SSR 冒烟测试：npm run smoke
 *
 * 目的：验证每个路由都能**真实渲染出 DOM**，而不是编译通过却在浏览器里白屏。
 * 做法：用 vue/server-renderer 在 Node 中把整棵组件树渲染一遍（含 Layout 骨架），
 *       再用 memory history 复用生产路由表，逐条断言页面里的关键内容。
 *
 * 为什么用 SSR 而不是 jsdom：jsdom 无法执行 ES module bundle，
 * 而 SSR 渲染同样会执行每个组件的 setup() 与模板，足以捕获绝大多数运行时错误。
 */
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createMemoryHistory, createRouter } from 'vue-router'
import App from '../src/App.vue'
import { routes } from '../src/router/routes'

interface SmokeCase {
  path: string
  name: string
  expect: string[]
}

/** 每个页面都必须含有的外壳标记（验证 Layout 生效） */
const LAYOUT_MARKERS = ['跳到主内容', '非商业性质的粉丝向资源导航站']

const CASES: SmokeCase[] = [
  {
    path: '/',
    name: '首页',
    expect: ['FNAF Fan Games', '游戏库', '关键词搜索', 'The Joy of Creation: Reborn', 'POPGOES'],
  },
  {
    path: '/game/tjoc-reborn',
    name: '详情页（命中）',
    expect: [
      'The Joy of Creation: Reborn',
      'Unreal Engine 4',
      '作品简介',
      '作品信息',
      '资源下载',
      '提取码',
      '123云盘下载',
      '浏览',
      '评论区',
      '评论功能待接入',
    ],
  },
  {
    path: '/game/does-not-exist',
    name: '详情页（空状态）',
    expect: ['没有这个游戏', 'does-not-exist'],
  },
  {
    path: '/debug',
    name: '调试台',
    expect: ['Debug Console', 'Interface Self-Test'],
  },
  {
    path: '/style',
    name: '样式验收页',
    expect: ['Color Palette', 'Helvetica Bold'],
  },
  {
    path: '/a/b/c/d',
    name: '404 兜底',
    expect: ['Error 404', '这是'],
  },
]

async function main(): Promise<void> {
  let failed = 0

  // 深模块在模块加载时就开始了一段模拟网络延迟，首帧 isLoading 为 true（首页会渲染骨架屏）。
  // 冒烟测试要断言真实内容，所以先等首次加载落地。
  await new Promise((resolve) => setTimeout(resolve, 400))

  for (const item of CASES) {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push(item.path)
    await router.isReady()

    const app = createSSRApp(App)
    app.use(router)

    let html = ''
    try {
      html = await renderToString(app)
    } catch (error) {
      console.error(`[FAIL] ${item.name} (${item.path}) —— 渲染抛错`)
      console.error(error instanceof Error ? error.stack : error)
      failed += 1
      continue
    }

    const missing = [...LAYOUT_MARKERS, ...item.expect].filter((needle) => !html.includes(needle))
    const routeName = String(router.currentRoute.value.name)

    if (missing.length === 0) {
      console.log(
        `[PASS] ${item.name.padEnd(14, '　')} ${item.path.padEnd(24)} route=${routeName.padEnd(12)} html=${html.length}B`,
      )
    } else {
      console.error(`[FAIL] ${item.name} (${item.path}) —— 缺少内容: ${missing.join(' / ')}`)
      failed += 1
    }
  }

  console.log('')
  if (failed > 0) {
    console.error(`SSR smoke: ${CASES.length - failed}/${CASES.length} passed`)
    process.exit(1)
  }
  console.log(`SSR smoke: ${CASES.length}/${CASES.length} passed — ALL PASS`)
}

void main()
