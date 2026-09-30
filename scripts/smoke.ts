/**
 * SSR 冒烟测试：npm run smoke
 *
 * 目的：验证每个路由都能**真实渲染出 DOM**，而不是编译通过却在浏览器里白屏。
 * 做法：用 vue/server-renderer 在 Node 中把整棵组件树渲染一遍（含 Layout 骨架），
 *       再用 memory history 复用生产路由表，逐条断言页面里的关键内容。
 *
 * 【Phase 1 扩展】用例新增 `shell` 维度（public / admin）：
 *   ① 按外壳断言该出现的标记（SHELL_MARKERS）
 *   ② 反向断言**不该**出现的另一套外壳标记（SHELL_FORBIDDEN），验证 Layout 分离未串台
 *
 * 为什么用 SSR 而不是 jsdom：jsdom 无法执行 ES module bundle，
 * 而 SSR 渲染同样会执行每个组件的 setup() 与模板，足以捕获绝大多数运行时错误。
 *
 * ⚠️ 写 expect 断言时的坑：Vue 的 SSR 会把 `&` `<` `>` `"` `'` 转义成 HTML 实体
 *    （例如 `Freddy's` 会渲染成 `Freddy&#39;s`）。**断言里不要放需要转义的字符**，
 *    否则会得到「页面明明渲染了却说缺内容」的假失败。
 */
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createMemoryHistory, createRouter } from 'vue-router'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import App from '../src/App.vue'
import { ADMIN_TOKEN_KEY, reloadStoredToken } from '../src/composables/useAdminAuth'
import { installAuthGuard } from '../src/router/authGuard'
import { routes } from '../src/router/routes'

/**
 * 从数据文件里取一条真实存在的作品标题。
 *
 * ⚠️ **不要在这里写死标题。** 后台的意义就是让人随时改数据 ——
 * 原先写死了 "Dayshift at Freddy's"，结果站长把那条作品的标题改掉之后，
 * 冒烟就假失败了（页面渲染得好好的，只是内容变了）。
 * 想断言「表格真的列出了作品」，就该去数据里拿一个真实标题。
 */
function anyGameTitle(index = 0): string {
  const db = JSON.parse(readFileSync(join(process.cwd(), 'src/data/db.json'), 'utf8')) as {
    games: { title: string }[]
  }
  return db.games[index]?.title ?? ''
}

interface SmokeCase {
  path: string
  name: string
  /** 该路由应挂载哪一套外壳（Phase 1 起存在公开站 / 后台两套） */
  shell: 'public' | 'admin'
  /** 该路由必须出现的内容 */
  expect: string[]
  /**
   * 渲染时本机是否持有登录令牌（Phase 15）。
   * 不写 = 未登录。后台页面一律要写 `true`，
   * 否则会被登录门禁拦到登录页 —— 那样断言就测错了对象。
   */
  token?: boolean
}

/**
 * SSR/Node 里没有 localStorage，而认证状态、以及后台的本地仓储都要用它。
 * 装一个内存桩，好让「登录门禁」这件事在冒烟里**真的被验证**，
 * 而不是因为构造了一个不含守卫的 router 而绕过去。
 */
function installLocalStorageStub(): void {
  const map = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value)
      },
      removeItem: (key: string) => {
        map.delete(key)
      },
      clear: () => map.clear(),
    },
  })
}

/** 切换本机令牌并让认证模块重新读取 */
function useToken(value: boolean): void {
  const store = globalThis.localStorage
  if (value) store.setItem(ADMIN_TOKEN_KEY, 'smoke-test-token')
  else store.removeItem(ADMIN_TOKEN_KEY)
  reloadStoredToken()
}

/**
 * SSR 里没有 GitHub —— 装一个最小的 `fetch` 桩，按 Contents API 的形状回答读文件请求。
 *
 * 【为什么要装】带上令牌之后，后台的数据源会切成**远程仓储**。
 * 不装桩的话那些用例只会渲染出「数据加载失败」，断言就测错了对象；
 * 而如果把数据源强行留在本地，后台用例走的就**不是**线上那条路径了。
 * 装了桩之后，**远程仓储的加载路径本身也被冒烟覆盖到**。
 */
function installFetchStub(): void {
  const dbText = readFileSync(join(process.cwd(), 'src/data/db.json'), 'utf8')
  const content = Buffer.from(dbText, 'utf8').toString('base64')

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: unknown) => {
      if (String(input).includes('/contents/')) {
        return new Response(JSON.stringify({ content, sha: 'smoke-stub-sha' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ message: 'smoke stub: 未实现的请求' }), { status: 404 })
    },
  })
}

/**
 * 每套外壳的稳定标记。
 *
 * 【Phase 1 扩展】原实现是一个全局 `LAYOUT_MARKERS` 常量，隐含假设「所有路由都挂公开站外壳」；
 * 后台加入后该假设不再成立，于是把「外壳」提升为每个用例的一个维度。
 * 标记只增不减，断言强度不降低。
 */
const SHELL_MARKERS: Record<SmokeCase['shell'], string[]> = {
  // 「后台管理」是公开站 Header 的导航项（同时出现在移动端菜单与页脚），每条公开路由都该有
  public: ['跳到主内容', '非商业性质的粉丝向资源导航站', '后台管理'],
  // 「Sections」是后台侧栏的小标题；它**在登录与未登录两种状态下都存在**，
  // 所以适合做外壳标记（「登录 / 已登录」这类会随状态变化的文本不行）。
  admin: ['跳到后台主内容', '返回站点', 'Sections'],
}

/**
 * 反向断言：该外壳下**必须不出现**另一套外壳的内容。
 *
 * 用于验证 Layout 分离没有串台（后台不得继承公开站 Footer；公开站不得出现后台 Header）。
 * 这是原实现完全缺失的一个维度 —— 属于补齐能力，不是放宽断言。
 */
const SHELL_FORBIDDEN: Record<SmokeCase['shell'], string[]> = {
  public: ['跳到后台主内容', '返回站点', 'Sections'],
  admin: ['跳到主内容', '非商业性质的粉丝向资源导航站'],
}

const CASES: SmokeCase[] = [
  /* ------------------------- 公开站 ------------------------- */
  {
    path: '/',
    name: '首页',
    shell: 'public',
    expect: ['FNAF Fan Games', '游戏库', '关键词搜索', 'The Joy of Creation: Reborn', 'POPGOES'],
  },
  {
    path: '/game/tjoc-reborn',
    name: '详情页（命中）',
    shell: 'public',
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
    shell: 'public',
    expect: ['没有这个游戏', 'does-not-exist'],
  },
  {
    path: '/debug',
    name: '调试台',
    shell: 'public',
    expect: ['Debug Console', 'Interface Self-Test'],
  },
  {
    path: '/style',
    name: '样式验收页',
    shell: 'public',
    expect: ['Color Palette', 'Helvetica Bold'],
  },
  {
    path: '/a/b/c/d',
    name: '404 兜底',
    shell: 'public',
    expect: ['Error 404', '这是'],
  },

  /* ------------------------- 后台 ------------------------- */
  {
    // 登录页是唯一豁免门禁的后台路由 —— 未登录时必须能进
    path: '/admin/login',
    name: '后台·登录页',
    shell: 'admin',
    expect: ['管理登录', '细粒度访问令牌', '粘贴令牌', 'github_pat_', 'Contents'],
  },
  {
    path: '/admin/preview',
    name: '后台·预览页',
    shell: 'admin',
    // ⚠️ 预览页受门禁保护 —— 不带令牌测的是登录页，不是预览页
    token: true,
    // ⚠️ SSR 里没有 sessionStorage → 预览内容必然为空，渲染空状态。
    //    「带着草稿渲染真实前台详情页」这条由 UI 点击测试在真实浏览器里验。
    expect: ['预览 · 未保存', '没有可预览的内容'],
  },
  {
    // ⚠️ 这条**不带令牌**：验证登录门禁真的把受保护的页面拦下来了。
    //    它渲染的其实是 /admin/login，只是地址栏还停在 /admin/games。
    path: '/admin/games',
    name: '后台·未登录被拦',
    shell: 'admin',
    expect: ['管理登录', '粘贴令牌'],
  },
  {
    path: '/admin',
    name: '后台·根路径',
    shell: 'admin',
    // 后台页面必须带令牌，否则会被登录门禁拦到登录页
    token: true,
    expect: ['游戏管理', '收录作品'],
  },
  {
    path: '/admin/games',
    name: '后台·游戏管理',
    shell: 'admin',
    // 后台页面必须带令牌，否则会被登录门禁拦到登录页
    token: true,
    expect: [
      // 页头与工具栏
      '游戏管理',
      '收录作品',
      '新增游戏',
      '关键词搜索',
      '全部作者',
      '全部标签',
      '清除全部条件',
      // 状态筛选 chip（含归档档位；缺省数据全部是 published）
      '已上线',
      '草稿',
      '已下线',
      '已归档',
      // 批量操作条（未选择态的细提示；「已选择」态需要点击才出现，靠浏览器验收 + 深模块断言覆盖）
      '未选择任何作品',
      // 表头
      '封面',
      '游戏名称',
      '更新时间',
      '操作',
      // 列表数据（排序首尾两条，验证「顺序确定」与真实渲染）
      //    `&#39;`，写成完整标题会永远断言失败。断言里不要放需要 HTML 转义的字符。
      // 从数据里取真实标题，而不是写死 —— 见 anyGameTitle 的说明
      anyGameTitle(0),
      anyGameTitle(5),
      // 行操作（编辑入口在 Phase 4 已接通到编辑器路由）
      '预览',
      '编辑',
    ],
  },
  {
    path: '/admin/games/new',
    name: '后台·新增游戏',
    shell: 'admin',
    // 后台页面必须带令牌，否则会被登录门禁拦到登录页
    token: true,
    expect: [
      '新增游戏',
      '新作品',
      '返回列表',
      '撤销修改',
      '保存',
      '发布',
      // 基本信息（Phase 5 已接入的字段标签）
      '基本信息',
      '游戏名称',
      '发行年份',
      'IP 系列',
      '开发引擎',
      '视频 URL',
      '简介',
      // Phase 7 已接入的图片区块（新建模式：都是空的）
      '封面与宣传图',
      'Banner 宣传图',
      '尚未设置',
      '图库',
      '图库还是空的',
      // Phase 8 已接入的下载区块（新建模式：没有渠道）
      '下载资源',
      '还没有下载渠道',
      '添加下载渠道',
      // Phase 9 已接入的右栏区块
      '标签',
      '发布设置',
      '已上线',
      '已下线',
      '归档',
      '推荐与排序',
      '首页推荐位',
      '排序权重',
    ],
  },
  {
    path: '/admin/games/tjoc-reborn/edit',
    name: '后台·编辑游戏',
    shell: 'admin',
    // 后台页面必须带令牌，否则会被登录门禁拦到登录页
    token: true,
    expect: [
      '编辑游戏',
      'tjoc-reborn',
      'The Joy of Creation: Reborn',
      '返回列表',
      '保存',
      '发布',
      '基本信息',
      // 已加载进输入框的真实数据
      'Nikson',
      'Unreal Engine 4',
      // 标签区块（Phase 6 已接入）
      '本条作品还没有标签',
      // 图片区块（Phase 7 已接入）：该作品有封面 + 2 张图库
      '封面与宣传图',
      'Banner 宣传图',
      '图库',
      'NO.01',
      '上移',
      '下移',
      '查看',
      // 下载区块（Phase 8 已接入）：该作品有 123云盘 + 百度网盘
      '下载资源',
      '123云盘',
      '百度网盘',
      '提取码',
      // 发布设置与推荐排序（Phase 9 已接入）
      '发布设置',
      '推荐与排序',
      '未归档',
      '未推荐',
    ],
  },
  {
    path: '/admin/tags',
    name: '后台·标签管理',
    shell: 'admin',
    // 后台页面必须带令牌，否则会被登录门禁拦到登录页
    token: true,
    expect: [
      '标签管理',
      '关键词搜索',
      '标签名称',
      '使用数量',
      '创建时间',
      '操作',
      // db.json 里没有任何标签 → 空状态
      '还没有任何标签',
      // 标签没有独立存储这件事必须写在页面上
      'Phase 14',
    ],
  },
  {
    path: '/admin/games/does-not-exist/edit',
    name: '后台·编辑不存在的作品',
    shell: 'admin',
    // 后台页面必须带令牌，否则会被登录门禁拦到登录页
    token: true,
    expect: ['找不到这个作品', 'does-not-exist', '返回游戏管理'],
  },
  {
    path: '/admin/nowhere',
    name: '后台·404 兜底',
    shell: 'admin',
    // 后台页面必须带令牌，否则会被登录门禁拦到登录页
    token: true,
    expect: ['后台没有这个页面', '前往游戏管理'],
  },
]

async function main(): Promise<void> {
  let failed = 0

  installLocalStorageStub()
  installFetchStub()

  // 深模块在模块加载时就开始了一段模拟网络延迟，首帧 isLoading 为 true（首页会渲染骨架屏）。
  // 冒烟测试要断言真实内容，所以先等首次加载落地。
  await new Promise((resolve) => setTimeout(resolve, 400))

  for (const item of CASES) {
    useToken(Boolean(item.token))
    // 切到远程仓之后，db.json 是**异步**拉下来的；等一拍再渲染，
    // 否则用例会渲染出「数据加载中」而不是真实内容。
    await new Promise((resolve) => setTimeout(resolve, 30))

    const router = createRouter({ history: createMemoryHistory(), routes })
    // ⚠️ 装上**同一套**登录守卫。不装的话，后台用例会因为「测试自己建了个不带守卫的 router」
    //    而把受保护的页面渲染出来 —— 门禁等于从来没被测过。
    installAuthGuard(router)
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

    const missing = [...SHELL_MARKERS[item.shell], ...item.expect].filter(
      (needle) => !html.includes(needle),
    )
    const leaked = SHELL_FORBIDDEN[item.shell].filter((needle) => html.includes(needle))
    const routeName = String(router.currentRoute.value.name)

    if (missing.length === 0 && leaked.length === 0) {
      console.log(
        `[PASS] ${item.name.padEnd(16, '　')} ${item.path.padEnd(22)} route=${routeName.padEnd(16)} html=${html.length}B`,
      )
    } else {
      if (missing.length > 0) {
        console.error(`[FAIL] ${item.name} (${item.path}) —— 缺少内容: ${missing.join(' / ')}`)
      }
      if (leaked.length > 0) {
        console.error(
          `[FAIL] ${item.name} (${item.path}) —— 外壳串台，出现了不该有的内容: ${leaked.join(' / ')}`,
        )
      }
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
