# HANDOVER — 交接文档（新上下文从这里开始）

> **这份文档的用途**：让一个新的上下文窗口（或一位新协作者）在 10 分钟内接手这个项目。
> 它是**地图**，不是百科 —— 细节都在 `README.md`（项目手册）与本文件引用的位置。
>
> **阅读顺序**：本文件 → `README.md` → `admin_backend_development_plan.md`（计划书）
> → `.workbuddy/memory/MEMORY.md`（长期记忆，含全部踩坑记录）。

---

## 1. 一句话说清项目

**FNAF 同人游戏资源站**：纯前端静态站（Vue 3 + Vite + Tailwind，GitHub Pages 托管）+
一个**能真正改线上数据**的后台管理系统。数据与代码**分仓**，后台通过 GitHub API 读写数据仓。

- 线上地址：`https://daxigua732.github.io/fnaf-fan-games-archive/`
- 代码仓：`DaXiGua732/fnaf-fan-games-archive`（Public，只有站长有写权限）
- 数据仓：`DaXiGua732/fnaf-fan-games-data`（Public，管理员有写权限；`db.json` + `images/`）

## 2. 当前状态快照（2026-10-27）

| 项 | 状态 |
| --- | --- |
| 原计划书 20 个阶段 | ✅ **全部完成**（0–20，Phase 20 测试由贯穿全程的门禁体系覆盖） |
| 结构化资料库升级 | ✅ **Phase 0–6 全部完成**：数据层、词表与编辑器、前台索引 + URL、八组组合筛选、作品关系、只读质量检查；已加固异常输入处理、原始 ID 安全边界与关系持久化 |
| 线上部署 | ✅ 此前版本已部署；本轮改动已通过完整 `npm run verify`（含 build），发布状态以远程仓库 / Actions 为准 |
| 后台能力 | ✅ 增删改查 / 批量 / 标签与作者合并管理 / 图片上传（自动 WebP 压缩）/ 预览 / 永久删除 / 操作署名 / **GameJolt 扩展 ZIP 导入 + 本机助手备用** |
| 前台能力 | ✅ **主题系统**（跟随系统 / 日间 / 夜间 + 5 种低饱和强调色）与首页公开**「催资源」榜**（Supabase 全站共享或本机模式） |
| 交互层 | ✅ 编辑器吸顶操作条 + 分区锚点 + 发布概览 + Ctrl/Cmd+S；列表行内快捷上下线 / 永久删除；详情页截图灯箱；主题下拉 + 催资源弹窗 |
| 数据架构 | ✅ 游戏目录仍以 **GitHub 数据仓 `db.json`** 为唯一事实来源；`taxonomy` 与 `games` 同文件、同一提交；Supabase **只**承载公开请求榜，不参与构建，也不存游戏数据 |
| 代码仓提交 | 最新已推送提交见 `git log -1`；主题 / 催资源 / 结构化 Phase 1–6 改动是否已提交以 `git status` 为准 |
| 测试基线 | ✅ 完整 `npm run verify` 通过（含严格资料检查、真实浏览器 UI 与 build）；**typecheck 通过、test:catalog 3/3、test:data-quality 1/1、selftest 1120/1120、smoke 16/16、UI 点击 99/99、UI 启动器回归 1/1**；`test:gamejolt` 仍为 22 项 |
| 已知缺口 | 数据仓未加其他协作者；评论区已按产品决策移除；催资源 SQL **尚未在真实 Supabase 项目执行**；远程榜最多 50 条；本机模式数据不会自动迁移到 Supabase；client id 不是反滥用；质量检查只报告，分类与关系仍需管理员按资料逐条录入 |

> ⚠️ **断言已改成从数据推导期望值**：`selftest` 会在 `data:pull` 之后跑，
> 所以不允许再写死「6 款」「5 位作者」「封面一定是某个路径」。新增断言时先问一句：
> 「后台改一条正常的数据，这条断言会不会挂？」会挂就说明它编码了数据内容。

**本轮新增文件（主题 / 催资源 / 结构化 Phase 1–2）**：

- 主题：`src/composables/useTheme.ts`、`src/components/ThemeSwitcher.vue`、
  `src/dev/themeAssertions.ts`；另改 `src/styles/index.css`、`tailwind.config.js`、`index.html`、
  `src/main.ts`、两套 Layout。
- 催资源：`supabase/resource_requests.sql`、`src/config/requests.ts`、
  `src/types/resourceRequest.ts`、`src/utils/requestMatch.ts`、`src/utils/requestClient.ts`、
  `src/repositories/localResourceRequestRepository.ts`、
  `src/repositories/supabaseResourceRequestRepository.ts`、`src/composables/useResourceRequests.ts`、
  `src/components/ResourceRequestBoard.vue`、`src/components/ResourceRequestDialog.vue`、
  `src/dev/requestAssertions.ts`；另改 `src/repositories/index.ts`、`src/views/Home.vue`。
- 测试 / 门禁：`scripts/selftest.mts`（新增主题 / 催资源两组 + SQL 安全静态守卫）、
  `scripts/smoke.ts`（首页新增主题 / 资源请求标记）、`scripts/ui-test.mjs`（主题与催资源步骤）。
- 结构化 Phase 1：`src/types/taxonomy.ts`、`src/config/taxonomy.ts`、`src/utils/taxonomy.ts`、
  `src/utils/relations.ts`、`scripts/catalog-document.mjs`、`scripts/catalog.test.mjs`、
  `src/dev/structuredDataAssertions.ts`、`structured_data_phase0_design_freeze.md`；
  另改 `src/types/game.ts`、`src/types/admin.ts`、`src/utils/gameDefaults.ts`、
  `src/utils/gameFactory.ts`、四个仓储文件、`scripts/pull-data.mjs`、`package.json`、
  `.github/workflows/deploy.yml`。**没有改 `src/data/db.json`，也没有批量标注任何作品。**
- 结构化 Phase 2：`src/views/admin/AdminVocabulary.vue`、
  `src/components/admin/AdminVocabularyPicker.vue`、`src/components/admin/AdminAltTitleEditor.vue`、
  `src/composables/useVocabulary.ts`；另改 `src/composables/useAdminGameDraft.ts`、
  `src/composables/useGameLibrary.ts`、`src/views/admin/AdminGameEditor.vue`、
  `src/views/GameDetail.vue`、`src/components/admin/AdminNav.vue`、`src/router/routes.ts`、
  `src/types/admin.ts`、`src/types/taxonomy.ts`、`src/dev/adminAssertions.ts`、
  `scripts/smoke.ts`、`scripts/ui-test.mjs`。
- 结构化 Phase 3：`src/utils/filterUrl.ts`、`src/dev/filterUrlAssertions.ts`；另改
  `src/composables/useGameLibrary.ts`、`src/views/Home.vue`、`src/views/GameDetail.vue`、
  `src/components/FilterPanel.vue`、`src/router/index.ts`、`src/dev/libraryAssertions.ts`、
  `scripts/selftest.mts`、`scripts/smoke.ts`、`scripts/ui-test.mjs`。
- 结构化 Phase 4：`src/components/FilterPanel.vue` 扩为八组（空分组不渲染、同维多选）；
  另改 `src/dev/libraryAssertions.ts`、`scripts/smoke.ts`、`scripts/ui-test.mjs`。
- 结构化 Phase 5：`src/components/admin/AdminRelationEditor.vue`；另改
  `src/composables/useAdminGameDraft.ts`、`src/utils/relations.ts`、
  `src/views/admin/AdminGameEditor.vue`、`src/views/GameDetail.vue`、
  `src/types/admin.ts`、`src/types/game.ts`、`src/dev/adminAssertions.ts`、
  `src/dev/structuredDataAssertions.ts`、`scripts/smoke.ts`、`scripts/ui-test.mjs`。
- 结构化 Phase 6：`src/utils/dataQuality.ts`、`scripts/data-quality.mts`、
  `src/dev/dataQualityAssertions.ts`、`src/utils/visibility.ts`、`src/utils/guards.ts`；
  另改 `src/composables/useGameLibrary.ts`、`src/utils/relations.ts`、
  `src/utils/taxonomy.ts`、`scripts/selftest.mts`、`package.json`。

## 3. 架构：数据流（最核心的一张图）

```
数据仓 db.json ──构建时写入──▶ 构建期快照（打进 dist）
                                      │ 首屏 / 断网兜底
                                      ▼
                              publicGameRepository
                                      ▲
                                      │ 公开页挂载 / 重新可见时 fetch 最新 db.json
数据仓 db.json ───────────────────────┘

后台（登录管理员）：数据仓 db.json ◀──读写──▶ GitHubGameRepository
```

**前台是「快照兜底 + 非阻塞同步」**：首屏不等网络、断网也能看；公开页挂载或
标签页重新可见时拉一次数据仓，替换内存目录。后台改完不需要等构建，
两个页面看到的是同一份数据。**不要**把同步改成阻塞式运行时查库 —— 那会赔掉首屏与离线能力。

详见 `README.md` §「前后台的数据源」与 §「数据同步」。

**本轮新增一条独立侧链路（不改变游戏目录）**：

```
游戏目录（仍是唯一事实来源）
数据仓 db.json ──构建期写入──▶ 构建期快照 ──▶ publicGameRepository ──▶ 前台
后台（登录后）◀──读写──▶ GitHubGameRepository ◀──▶ 数据仓 db.json

催资源（公开请求榜）
访客浏览器 ──▶ Supabase（anon public key + RLS / security definer RPC）
             └─ 未配置 Supabase ──▶ 本机 localStorage（本机模式）
```

**游戏目录仍然以 GitHub 数据仓为唯一事实来源**；Supabase 只存公开请求，
不存 games / authors / tags / downloads，也不参与构建。Supabase 不可用时，
游戏目录完全不受影响，请求榜退回「最近一次缓存 + 写操作报错」。
详见 `README.md` §7.4 与 `admin_phase13_persistence_decision.md` §17。

## 4. 运维速查

```bash
npm run dev            # 本地开发（读 src/data/db.json —— 可能是旧快照，见下）
npm run data:pull      # 从数据仓同步 db.json 到本地（部署前自动执行；本地开发需手动）
npm run verify         # 全部门禁：typecheck + test:gamejolt + test:catalog + test:data-quality + build:extension + selftest + check:data --strict + test:ui:ci-launcher + test:ui:ci + smoke + build
npm run test:ui        # 复用已启动的 dev server；默认 Playwright Chromium（UI_BROWSER=chrome 可切换）
npm run test:ui:ci     # 自动启动 / 清理 Vite 后运行同一套 UI 测试（verify / CI 使用）
npm run test:ui:ci-launcher # 端口占用回归（旧服务的 HTTP 200 不得当作 ready）
npm run test:gamejolt  # GameJolt 解析 / 网络层 / 扩展打包测试（22 项，不出网）
npm run test:catalog   # 数据仓文档解析 / 序列化测试（3 项，保留未知顶层字段）
npm run build:extension # 构建扩展到 extension/dist（Chrome/Edge 加载已解压）
npm run test:extension # 扩展 E2E：同源抓取 → 图片 → ZIP 下载（需要系统 Chrome）
npm run gamejolt:helper # 本机助手（127.0.0.1:4317，开发备用；运维主路径是扩展 ZIP）
npm run smoke          # 只跑 SSR 冒烟（16 条路由）
npm run selftest       # 只跑断言集（1120 项，含八组断言 + 静态守卫）
npm run check:data     # 只读资料质量检查（默认 src/data/db.json；支持 --file / --json / --strict）
npm run test:data-quality # check:data --strict 的退出码契约（合成夹具，不碰生产数据）
```

> 环境变量写法：PowerShell 用 `$env:UI_BROWSER = 'chrome'`、`$env:BASE = '...'`、
> `$env:PROD = '1'`；Bash 用 `UI_BROWSER=chrome`、`BASE=... PROD=1`。
> `test:ui` 复用已启动的 dev server，`test:ui:ci` 自动启动 / 清理 Vite；
> `UI_BROWSER` 只是可选的系统 Chrome 切换，不是运行测试的必需条件。

**催资源（可选，Supabase）**：

```bash
# 1) Supabase Dashboard → SQL Editor 执行 supabase/resource_requests.sql
# 2) 根目录 .env.local（不要提交）：
#    VITE_SUPABASE_URL=https://<project-ref>.supabase.co
#    VITE_SUPABASE_ANON_KEY=<anon public key>
# 3) 重启 npm run dev / 重新 build
# 4) 若 PostgREST 报找不到函数 / 视图：SQL Editor 执行
#    notify pgrst, 'reload schema';
```

> 只使用 **anon public key**；`service_role` 绝不能进前端 / 仓库 / 文档。
> `.env.local` 只影响本地 `dev` / `build`，不会带到线上。线上 Pages 的 `deploy.yml`
> 已从仓库 Variables 读取 `${{ vars.VITE_SUPABASE_URL }}` / `${{ vars.VITE_SUPABASE_ANON_KEY }}`；
> 需要在 GitHub → Settings → Secrets and variables → Actions → **Variables** 配置这两项。
> anon key 是公开的，放 Variables 即可；任一变量缺失时线上构建就是**本机模式**。

- **部署**：推 `main` 即自动构建发布（`.github/workflows/deploy.yml`，构建前自动 `data:pull`）
- **数据更新后的上线时机**：公开页打开 / 切回时自动同步数据仓（通常几秒）；
  数据仓提交不触发代码仓 workflow，每小时定时构建只负责刷新首屏 / 离线快照
- **回滚**：对数据仓做 `git revert`（数据仓历史就是完整审计日志）；代码回滚同理

## 5. 关键设计决策与"为什么"（每条都在 README 有详细章节）

| 决策 | 为什么 | 详见 |
| --- | --- | --- |
| **两仓分离** | 让管理员「能改数据、碰不到代码」—— 权限边界由 GitHub 仓库权限天然给出，不用自建服务 | README §0.1；决策书 §12 |
| **前台快照兜底 + 运行时同步** | 首屏秒开、断网可用；公开页挂载 / 重新可见时再拉数据仓，后台改完不用等构建 | README §4.1 |
| **Repository 层**（本地 + 远程两个实现） | 前后台只依赖接口；换存储 = 换实现，深模块与组件零改动 | README §2.x |
| **认证 = GitHub 细粒度令牌**（只授权数据仓 + Contents 读写） | 「能改数据、碰不到代码」由**凭据权限本身**保证，不靠我们写的判断 | README §后台认证 |
| **审计不做独立文件** | **git 历史就是完整审计日志**（谁/改了什么/何时/revert），再维护一份是冗余 | README §操作署名 |
| **写路径必须「读最新 → 重放 → 409 重试」** | `db.json` 是**单个文件**，任意两人同时保存都会冲突；敢直接重试是因为重放**永远正确**（改的是字段，不是文本 diff） | README §后台的写入落在哪里 |
| **图片文件名带时间戳** | 图片会被浏览器/CDN 缓存；换名即换地址，缓存自然失效 | README §图片上传 |
| **预览复用 `GameDetail` 本身**（注入草稿） | 另写一个"像前台"的预览页迟早分叉，分叉后预览就在骗人 | README §预览功能 |
| **浏览量走 Abacus，不写数据仓** | 公开站没有安全的写入通道：把写令牌放进前端等于把数据仓交给所有人。计数是易失指标，第三方服务挂了就回退静态基数，站点照常可用 | README §7.1 |
| **不再提供评论区** | 产品决策：评论需要审核、滥用处理与独立的数据归属；没有这些能力时，一个空评论区只是在制造维护负担 | README §7.2 |
| **标签与作者合并为一个页面** | 两者都是由作品数据派生的分类维度；分成两页只会让管理员在两张几乎相同的表格之间来回切换 | README §后台路由 |
| **GameJolt 导入：扩展 ZIP 为主，本机助手为开发备用** | 扩展 content script 运行在 gamejolt.com 页面内，`/site-api` 是同源请求，运维不需要 Node / 终端；图片 CDN 开放跨域，可直接走现有上传链路。ZIP 是本地可审计的交换文件，后台仍负责归一化 / 校验 / 上传，扩展接触不到 GitHub 令牌。游戏资源与网盘链接是策展决定，自动化只做「信息搬运」 | README §7.3 |
| **主题走 CSS 变量 + 语义 token** | 只改颜色、不改形状，才能在保留 Swiss 红线的前提下支持浅色 / 深色 / 5 种强调色；组件不写死色值，换主题时不需要批量改组件 | README §5.4 |
| **`white` / `black` 重映射为 `paper` / `ink`** | 存量组件里的 `bg-white` / `text-black` 能自动随主题反转，避免一次大范围机械改写；代价是强调色 / 反色底上必须改用 `on-accent` / `inverse-fg`，不能再用 white/black 当前景 | README §5.4 |
| **催资源用 Supabase anon + RLS/RPC（可选）** | 公开请求需要跨访客共享，但游戏目录不能因此变成运行时依赖。Supabase 只承载这一条低价值侧链路；未配置时退回本机 localStorage，游戏目录继续由 GitHub 数据仓提供 | README §7.4；决策书 §17 |
| **已收录只认归一化标题完全相等** | 包含匹配会把《Jolly》误判成《Jolly 4》已收录，从待上传榜静默消失；宁可多留一条请求，也不能吞掉真实需求 | README §7.4 |
| **请求数据不进 git** | 游戏目录仍以数据仓为唯一事实来源；请求是匿名投票数据，放进 GitHub 要么产生大量提交、要么需要给前端写权限，不划算。代价是没有 git 审计 / 回滚，Supabase 免费版也没有自动备份 | README §7.4 |

## 6. 改动前必读的铁律

**视觉（Swiss International Style，违反即严重 Bug）**：零圆角、零阴影、零渐变、
零居中、纯无衬线、动效上限 `duration-150` 且 hover 只改颜色、留白优先。
反向箭头必须用 `.u-arrow-back`（详见 README 视觉规范章节）。

**主题**：只改颜色，不改形状。颜色一律走语义 token（`ink` / `paper` / `line` / `surface` /
`accent` / `accent-surface` / `on-accent` / `inverse` / `inverse-fg` / `overlay`）；
`.vue` 里不写死 hex、不用 Tailwind 固定调色板（静态守卫在扫）。
`bg-accent*` 必须配 `text-on-accent`；`white` / `black` 已重映射为 `paper` / `ink`，
不要在强调色 / 反色底上拿它们当前景。

**代码**：

1. 后台 `.vue` 里禁止 `import db.json`、禁止手写 `.filter()` / `.sort()` —— 一律走
   `useAdminGames`（**有静态守卫在扫**，`scripts/selftest.mts` 的「静态守卫」组）
2. 只有 `repositories/index.ts` 能实例化仓储；只有 `localGameRepository.ts` 能读 `db.json`
3. 新数据字段**全部 optional**，`status` 缺省 `published`（否则一次联动会清空前台的旧数据）
4. 前台可见性判据 = `status === 'published' && !archived`，收敛在 `isPubliclyVisible()`
5. **搜索输入框用 `useSearchField`，不要用 `:value` + `@input`** ——
   受控输入的回写会让浏览器重置光标，"反向选中后打字"会变成倒序（README §输入框的绑定方式）
6. **断言不得编码数据内容** —— 后台的意义就是让人随时改数据，写死内容 = 改一条数据测试就挂。
   断言**规则**（如"首位是标题最小的那条"），从数据里自行推导期望值（README §断言不能把数据内容写死）
7. 后台视图渲染数据源内容前，必须用 `dataOk` 做「状态 / 内容」二选一（加载中渲染空列表
   看起来就像"数据全没了"）
8. 催资源仓储同样只能在 `repositories/index.ts` 实例化一次；标题归一化前端与 SQL 各一份，
   改一处必须同步另一处（`src/utils/requestMatch.ts` ↔ `supabase/resource_requests.sql`）

**测试**：

9. UI 测试开头必须 `localStorage.clear()`（改动会跨运行累积）
10. 后台用例靠 `page.route` 拦 GitHub API 才有数据（**真令牌不进测试脚本**）；
    拦截要挂 `context.route`（预览会开新标签页）
11. 图片测试夹具：用 canvas 在浏览器里生成**指定尺寸的真实 PNG** ——
    SVG 喂给 `createImageBitmap` 会失败，1×1 PNG 会被尺寸校验拦下
12. 公开站产物做**逐字节回归**时，先构建一份快照再比对；Phase 19 用过的
    `.tmp/public-baseline` 属于一次性临时产物，不纳入版本管理（已随 `.tmp/` 清理）

## 7. 踩坑清单（全部踩过，别再踩）

按"再踩一次的代价"排序，完整版见 `.workbuddy/memory/MEMORY.md`：

1. **CI 上的 selftest 用的是「数据仓里被编辑过的数据」**（deploy 会先 `data:pull`）——
   本地全绿 ≠ CI 全绿。凡是**前提隐含在数据里**的断言都会假失败。
   现有断言已改成从数据推导期望值；新增断言必须继续守这条规则。
2. **sessionStorage 不跟着 `window.open` 的新标签页走**（预览页拿到 null）——
   跨标签页传数据用 **localStorage**，且**读完即清**
3. **默认沙箱里 `git push` 连不上 github.com:443**（2026-10-24 实测）——
   在允许网络的环境（用户终端 / 免沙箱执行）重试即可成功；仍失败时再用
   Contents API（带 sha 乐观锁），但会产生分叉，之后 `git pull --rebase` 收敛
4. **守卫不能从 `router/index.ts` 导出**（它创建带 hash history 的 router，Node 里没有
   `location`）—— 单独放 `src/router/authGuard.ts`
5. **新冒烟用例（后台）必须 `token: true`** —— 漏了测的是登录页而非目标页
6. **`createImageBitmap` 解不了 SVG blob**；1×1 PNG 会被尺寸校验拦下 —— 图片夹具用 canvas 生成
7. **`btoa` 只吃 latin1**，中文要先编 UTF-8 字节（`encodeBase64`，已抽出来共用）
8. **CRLF 行尾**：Python 的文本替换匹配不上时，先怀疑行尾；按行处理最稳
9. **Vite 清空 dist 触发批量删除守卫** → 先 `git clean -fdxq dist` 再 `npm run build`
10. **懒加载图片的检查要给足等待**，并用 `complete` 区分「仍在加载」与「真裂图」
    （407KB 的图 2.5s 不够）
11. **MV3 的 content_scripts 不支持 ES module**：扩展源码必须用 esbuild 打成 IIFE，
    加载 `extension/dist/`；同源抓取只成立在 content script（popup/background 是扩展 origin）
12. **ZIP 是不可信输入**：只认格式/版本/GameJolt 来源，白名单条目 + 大小/条目数限制，
    图片仍走 `createImageBitmap` 与尺寸校验；不要渲染包内 HTML/JS
13. **Abacus 的 `/hit` 是 GET**：被浏览器 / CDN 缓存一次就少计一次浏览 ——
    provider 同时用 `cache: 'no-store'` 与时间戳兜底，改计数实现时别删这两道防线
14. **主题 storage key 有两个读者**：`index.html` 的防闪白内联脚本与 `useTheme.ts`。
    改 key 必须同时改两处；`selftest` 有静态守卫比对，漏一处会直接失败
15. **`white` / `black` 已被重映射**为 `paper` / `ink`：不要在 `bg-accent*` 上用
    `text-white` / `text-black` 当前景，否则深色模式会反向；用 `text-on-accent`。
    页脚 / 灯箱等反色区域用 `inverse` / `inverse-fg`
16. **「已收录」必须用归一化标题完全相等**（`matchFulfilledGameForTitle`），
    不能用包含匹配：请求《Jolly》会因站内已有《Jolly 4》而被静默移出待上传榜
17. **`service_role` 绝不能进前端**：它绕过 RLS，等于把整个数据库的写权限公开。
    前端只用 anon public key；`selftest` 有静态守卫扫源码
18. **Supabase SQL 要手动执行**：`supabase/resource_requests.sql` 不会随构建自动运行。
    执行后若 PostgREST 还报找不到函数 / 视图，在 SQL Editor 执行
    `notify pgrst, 'reload schema';`
19. **client id 不是反滥用机制**：它只是 localStorage 里的浏览器生成随机 ID，清掉就能重投。
    它保证的是「正常访客同一浏览器只计一票」，不是抵御恶意刷票

## 8. 已知缺口与待办

| 项 | 说明 |
| --- | --- |
| 浏览量 | 详情页已是 **Abacus 实时计数**，但**依赖第三方**且没有防刷能力（纯静态站拿不到可信访客身份）；`/hit` 自动建的 key 无 admin key、被刷无法重置。列表「热度」排序仍用 `fakeViews` 静态值。详见 README §7.1 |
| 评论 | 已按产品决策移除：`CommentSection.vue`、`src/config/giscus.ts`、`public/giscus-swiss.css` 与全部相关文案/测试均已删除 |
| 多管理员 | 数据仓还没加协作者；加人命令见 `admin_phase13_persistence_decision.md` §15 |
| 数据更新延迟 | 公开页挂载 / 切回时自动同步（通常几秒）；断网时退回构建期快照，最长等 1 小时的定时构建刷新快照 |
| 图片处理 | 已做长边缩放 + WebP；**未做自动裁剪**（按比例留白是设计选择，不是缺陷） |
| GameJolt 导入 | 依赖对方**内部站内接口**（`/site-api/web/discover/games/<id>`），改版即可能失效；失败会显式报错，不会写入半条数据。导入只填草稿，不碰下载渠道，仍需人工点保存 |
| 扩展分发 | 目前是「加载已解压扩展」，更新要手动重载；要给非技术运维并自动更新，需把 `extension/dist/` 上架 Chrome Web Store / Edge Add-ons 的不公开条目 |
| 催资源 · 远程模式 | **SQL 尚未在真实 Supabase 项目执行过**；需要按 README §7.4 在 SQL Editor 跑通后，实测 RLS / 视图 / RPC / PostgREST 缓存。当前远程路径只由注入 fetch 的 selftest 覆盖 |
| 催资源 · 线上配置 | `deploy.yml` 已从仓库 Variables 读取 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`；需在 GitHub → Settings → Secrets and variables → Actions → **Variables** 配置，任一缺失则线上构建为**本机模式**。anon key 可放 Variables，绝不放 `service_role` |
| 催资源 · 榜单容量 | 远程榜单一次最多读 50 条（按票数降序），第 51 条之后不可见；本机模式无此上限 |
| 催资源 · 数据迁移 | **本机模式的数据不会自动迁移到 Supabase**：后来配置远程模式时，之前存在某台浏览器里的请求 / 投票仍只在那台浏览器，不会出现在全站榜；没有内置迁移工具 |
| 催资源 · 审核 / 公平性 | 没有后台审核页或限流面板；隐藏 / 标记完成只能进 SQL Editor。client id 可被清空重投，不是反滥用 |
| 催资源 · 归一化边界 | SQL 的 POSIX `[[:punct:]]` 对 emoji / 非 ASCII 符号的覆盖依赖数据库 locale，可能与前端 `\p{S}` 不一致；这类标题需在真实 Supabase 项目实测，必要时人工合并 |
| 主题 | 只保存在当前设备，不跨设备同步；没有自动化对比度测试，深色模式视觉效果仍需人工 / UI 测试检查 |
| 结构化资料 · 前台 | Phase 3 已做可点击索引与 URL 状态；**筛选面板仍是作者 / 年份 / 系列三组，同维多选的 UI、搜索增强与作品关系**分别属于 Phase 4 / 5 |
| 结构化资料 · 数据 | **没有批量标注任何作品**（当前数据稀疏，自动分类会造假）。玩法类型 / 机制 / 平台 / 关系都需要管理员按证据手工录入 |

## 9. 质量门禁（改动之后必须全绿）

```
npm run verify
# = typecheck + test:gamejolt(22) + test:catalog(3) + test:data-quality(1)
#   + build:extension + selftest(1120) + check:data --strict + test:ui:ci-launcher + test:ui:ci + smoke(16) + build
```

> ✅ 本轮完整 `npm run verify` 已通过（end-to-end，含 build）：`typecheck` 通过、
> `test:catalog` 3/3、`test:data-quality` 1/1、`selftest` 1120/1120、`smoke` 16/16；
> `check:data --strict` 在当前快照 error 0；UI 点击测试 99/99（同一套测试已纳入 verify / CI）。

- `test:gamejolt`：URL 解析 / 富文本 / 图片选型与尺寸升级 / 网络错误分支 / 扩展 ZIP 打包
  （`node --test`，夹具注入 fetch，不出网）
- `test:catalog`：数据仓文档解析 / 序列化，必须保留 `taxonomy` 与未知顶层字段
  （`node --test`，不联网）
- `build:extension`：esbuild 把扩展 content script 打成 IIFE，产出 `extension/dist/`
- `selftest`：八组断言 + **静态守卫**（源码扫描：仓储实例化、Supabase SQL 安全不变量、
  `.vue` 写死颜色 / 固定调色板、`service_role`、主题 storage key 一致性）+ 仓储/持久化/上传契约
  + 浏览量适配器 + 主题纯函数 + 催资源归一化 / 本机仓储 / Supabase 请求形状
  + 结构化字段 / 词表 / 关系与两套仓储的原子写入 / 409 重放（storage 与 fetch 均用桩，不出网）
  + 关系持久化（无关字段编辑 / 显式关系编辑 / 删除清理 / 词表合并，原始数据不被静默改写）
  + 筛选 URL 的解析 / 序列化 / 签名
  + 资料质量检查（异常输入不崩溃且明确报告、只读性、Game 契约字段 / 可选字段 / 枚举 / 时间戳、
    未分类 / 失效词条 / 关系异常 / 重复项 / 缺图缺下载）
  + 原始 ID 安全（缺失 / 空白 / 非法 / 重复 id 时远程与本地一致地拒绝写入，零提交 / 零落盘）
- `smoke`：SSR 渲染 16 条路由（公开 5 + 后台 11），断言外壳分离与关键内容
- `UI 点击测试`（`scripts/ui-test.mjs` + `scripts/run-ui-test-ci.mjs`，**已纳入 verify / CI**）：
  **99 步真实浏览器点击**，默认 Playwright Chromium；覆盖计划书 §21 后台专项、§22 前台回归、
  GameJolt 助手导入与 ZIP 导入，以及主题持久化、本机模式催资源提交 / +1 / 自动已收录
- `npm run test:extension`：扩展 E2E（同源抓取 → 下载图片 → 打包 ZIP），需要系统 Chrome，
  **不进 verify / CI**，改扩展代码时本地跑
- `test:data-quality`：真实执行 `npm run check:data -- --file=... --strict`，
  断言“无 error 退出 0、有 error 退出 1”（临时合成夹具，不读写生产数据）
- `check:data --strict`：已纳入 `npm run verify` 与部署 workflow；只对 error 失败，
  warning 允许存在。检查的是 `data:pull` 之后的快照；拉取失败时日志会明确说明
  “本次检查的是旧快照，不是数据仓最新内容”
  `--strict` 通过只证明当前快照没有 error，不证明最新同步成功；拉取失败仍按
  既有策略用旧快照部署，这是有意保留的可用性取舍。
- `test:ui:ci-launcher`：先占用一个端口并返回 HTTP 200，启动器必须非零退出、不访问旧服务、
  不启动 UI 测试；这是端口竞争的自动化回归
- `test:ui:ci`：自动启动固定 `127.0.0.1:5173` 的 Vite（strictPort），只认本次子进程
  stdout 的 ready 信号，再运行 UI 测试并在成功 / 失败 / 中断时清理进程；
  默认 Playwright Chromium，CI 负责安装浏览器与系统依赖；
  失败时上传 `.tmp/ui-shots/` 与 `.tmp/ui-ci-vite.log`
- **催资源 SQL / 真实 Supabase 行为不在自动化门禁内**，必须按 README §7.4 手动验证
- **公开站回归**：Phase 19 曾用逐字节基线；快照属 `.tmp/` 临时产物，不纳入版本管理，
  需要时重新构建一份即可

## 10. 新会话怎么开始

1. 读本文件 → 读 `README.md`（项目手册，最完整）
2. `npm run verify` 确认全绿（含真实浏览器 UI）；日常开发可只跑 `npm run dev`，
   涉及交互时跑 `npm run test:ui` 或 `npm run test:ui:ci`；扩展改动跑 `npm run test:extension`
3. 有疑问先查 `README.md` 对应章节，再查 `.workbuddy/memory/MEMORY.md` 的踩坑记录
4. 改主题：先读 README §5.4 与 `src/styles/index.css`，颜色只加语义 token，不要往 `.vue` 写 hex；
   改催资源：先读 README §7.4、`supabase/resource_requests.sql` 与 `src/config/requests.ts`，
   标题归一化前端 / SQL 必须同步改
5. 做结构化资料：先读 `structured_data_phase0_design_freeze.md` 与 README「结构化资料库地基」；
  Phase 0–6 已全部完成；质量检查只报告，仍需管理员按资料逐条补分类与关系
6. 改动之后：`npm run verify` 全绿 → 按阶段提交（**不要攒大批量**，见计划书 §23 的教训）
7. 涉及数据仓 / 部署的操作，先读 `admin_phase13_persistence_decision.md`；
   涉及 Supabase 时先确认 SQL 已在真实项目执行、GitHub Actions **Variables** 已配置两个
   `VITE_` 变量（缺失时线上构建为本机模式）
