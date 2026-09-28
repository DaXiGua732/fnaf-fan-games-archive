# FNAF Fan Games Archive

Five Nights at Freddy's **同人游戏资源导航站**。纯前端静态站，零成本托管于 GitHub Pages，
资源统一跳转第三方网盘，视觉上严格遵循 **Swiss International Style**（瑞士国际风格）。

| 项目信息 |  |
| --- | --- |
| 线上地址 | https://daxigua732.github.io/fnaf-fan-games-archive/ |
| 代码仓库 | https://github.com/DaXiGua732/fnaf-fan-games-archive |
| 原始需求文档 | [`fnaf_fan_game_website_technical_specification.md`](./fnaf_fan_game_website_technical_specification.md) |
| 当前提交 | `851ddf7`（本地与远程 SHA 完全一致） |
| 包名 | `fnaf-fan-game-archive` |

---

## 0. 给接手者（尤其是 AI 上下文）的先读段落

这个项目有**三条不能踩的红线**，其余都是常规工程：

1. **视觉规范是硬约束，不是审美偏好。** 零圆角、零阴影、零渐变、纯无衬线、文本左对齐。
   项目已经用三层机制把它们**从编译层禁掉**了（见 §5）。不要试图"加个好看的圆角"。
2. **视图层（`.vue`）里禁止手写 `.filter()` / `.sort()`。** 所有数据加工都在深模块
   `useGameLibrary` 内（见 §4.2）。
3. **本环境不能 `git push`**（沙箱只放行 `api.github.com`）。要发布请看 §8。这是环境限制，
   不是项目配置问题。

另外：**改完必须跑 `npm run verify`**，四道关卡全绿才算完成（见 §2）。

---

## 1. 快速开始

```bash
# 安装依赖（--ignore-scripts 是必须的，原因见 §9.1）
npm install --ignore-scripts

# 启动开发服务器 → http://localhost:5173/
npm run dev

# 完整质量门禁（改完代码必须跑）
npm run verify
```

Node 版本 22+。本项目在 `C:\Users\wangjinling\.workbuddy\binaries\node\versions\22.22.2-3\` 下验证通过。

### 全部可用脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发服务器（base = `/`） |
| `npm run build` | 生产构建（base = `/fnaf-fan-games-archive/`），输出到 `dist/` |
| `npm run preview` | 预览生产产物 |
| `npm run typecheck` | `vue-tsc --noEmit` 类型检查 |
| `npm run selftest` | 深模块行为断言（29 项） |
| `npm run smoke` | SSR 冒烟：逐路由真实渲染并断言内容（6 条路由） |
| `npm run assets` | 按 `db.json` 重新生成占位图到 `public/images/` |
| `npm run verify` | `typecheck` + `selftest` + `smoke` + `build` |

---

## 2. 质量门禁：为什么有四道关卡

本项目开发期间**无法在浏览器里手动点击验证**，所以用四个自动化关卡替代人工验收。
`npm run verify` 必须全绿才允许提交，CI 里也会跑同样四步（见 `.github/workflows/deploy.yml`）。

| 关卡 | 覆盖什么 | 抓不到什么 |
| --- | --- | --- |
| `typecheck` | 类型错误、拼写错误的属性名 | 运行时逻辑 |
| `selftest` | 深模块的搜索/过滤/排序/分页逻辑是否正确 | UI |
| `smoke` | 每个路由能否真实渲染出 DOM（**防白屏**） | 样式是否正确 |
| `build` | 生产构建能否通过、代码分割是否正常 | — |

### 2.1 `selftest` 的设计要点

断言集放在 `src/dev/libraryAssertions.ts`，被**两处消费**：

- `src/views/DebugLibrary.vue`（浏览器里的调试台）
- `scripts/selftest.mts`（命令行）

> **这是刻意的设计**：保证"浏览器里看到的自检"与"命令行跑的自检"是同一份实现，
> 永远不会出现两处漂移。新增断言请只改这一个文件。

实现方式：用 `esbuild` 把 `scripts/selftest.mts` 打成 `.tmp/selftest.mjs`（`--external:vue`），
再用 Node 直接跑。**不需要 vitest / jsdom**。

### 2.2 `smoke` 的设计要点

`scripts/smoke.ts` 用 `vue/server-renderer` 在 Node 里把整棵组件树（含 Layout 骨架）
对每条路由真实渲染一遍，再断言页面里的关键内容。

**为什么不用 jsdom**：jsdom 无法执行 ES module bundle；而 SSR 渲染同样会跑每个组件的
`setup()` 与模板，足以捕获绝大多数运行时错误。

配置在 `vite.smoke.config.ts`，与生产构建分离，关键差异：

- `publicDir: false` —— 不把 `public/` 拷进临时目录
- `emptyOutDir: false` —— 不清空输出目录（原因见 §9.2）
- `rollupOptions.output.inlineDynamicImports: true` —— 产物恒为单个 `smoke.js`，不会残留 chunk

> ⚠️ **新增"首屏异步"逻辑时要留意**：`useGameLibrary` 在模块加载时就开始 160ms 模拟延迟，
> 所以 SSR 首帧 `isLoading` 为 `true`（首页渲染的是骨架屏）。
> `scripts/smoke.ts` 在渲染循环前先 `await sleep(400)` 等首次加载落地，否则断言不到卡片内容。

### 2.3 视觉规范哨兵

`src/components/StyleAuditBadge.vue` 会在**运行时全量扫描 DOM**，逐个比对
`border-radius` 与 `box-shadow`，在页面顶部直接显示 `PASS` / `FAIL` + 违规元素列表。
调试台 `/debug` 和样式验收页 `/style` 都挂了这个组件。

---

## 3. 目录结构

```
├── .github/workflows/deploy.yml    # Pages 自动部署（构建前跑三道门禁）
├── public/
│   ├── giscus-swiss.css            # Giscus 自定义主题（唯一能改变评论样式的途径，见 §7.2）
│   └── images/*.svg                # 占位图，由 npm run assets 生成
├── scripts/
│   ├── gen-placeholders.mjs        # 占位图生成器
│   ├── selftest.mts                # 命令行入口：深模块自检
│   └── smoke.ts                    # 命令行入口：SSR 冒烟
├── src/
│   ├── components/                 # 可复用 UI 组件
│   │   ├── Button.vue              # 基础按钮（solid/outline/ghost × md/lg）
│   │   ├── Card.vue                # 基础容器（interactive 模式有悬停左边框变红）
│   │   ├── GameCard.vue            # 格子卡片（复用 Card）
│   │   ├── FilterPanel.vue         # 筛选与排序面板
│   │   ├── DownloadPanel.vue       # 下载区 + 提取码复制
│   │   ├── CommentSection.vue      # Giscus 评论区（未配置时优雅降级）
│   │   └── StyleAuditBadge.vue     # 视觉规范运行期哨兵
│   ├── composables/
│   │   ├── useGameLibrary.ts       # ★ 深模块：搜索/交叉过滤/排序/分页
│   │   └── useViewCounter.ts       # 浏览量（remote / static 双模式）
│   ├── config/giscus.ts            # Giscus 配置 + 启用步骤说明
│   ├── data/db.json                # ★ 单一事实来源：所有游戏数据
│   ├── dev/libraryAssertions.ts    # ★ 断言集（浏览器与命令行共用）
│   ├── layouts/Layout.vue          # 全局骨架：Header + slot + Footer
│   ├── router/
│   │   ├── routes.ts               # 路由表（与实例分离，便于测试复用）
│   │   └── index.ts                # createRouter + Hash history
│   ├── services/viewCounter.ts     # 浏览量适配器（ViewProvider）
│   ├── styles/index.css            # Tailwind 入口 + 全局硬重置（视觉规范最后防线）
│   ├── types/game.ts               # 领域模型 Game / DownloadLink / GameMetrics
│   ├── utils/
│   │   ├── asset.ts                # ★ assetUrl()：拼接 BASE_URL
│   │   └── clipboard.ts            # copyText()：两级回退的剪贴板写入
│   └── views/
│       ├── Home.vue                # 首页：Hero + 筛选 + 网格 + 分页
│       ├── GameDetail.vue          # 详情页：标题 + Banner + 数据表格 + 下载 + 评论
│       ├── NotFound.vue            # 404
│       ├── DebugLibrary.vue        # 调试台（/debug，上线前可移除）
│       └── StyleSpecimen.vue       # 视觉规范验收页（/style，上线前可移除）
├── tailwind.config.js              # ★ 覆盖式配置：违规工具类直接不生成
├── vite.config.ts                  # base 按 command 区分
└── vite.smoke.config.ts            # 冒烟测试专用构建配置
```

---

## 4. 架构

### 4.1 数据流

```
src/data/db.json  →  useGameLibrary（深模块）  →  views / components
                          ↑
                   src/types/game.ts（契约）
```

`db.json` 是**单一事实来源**。加游戏只改它，不用动任何组件。

### 4.2 深模块 `useGameLibrary`

内部消化了：全字段模糊搜索（标题/作者/IP 系列/引擎，大小写不敏感）、
作者 × 年份 × 系列**组间 AND / 组内单选切换**、4 种排序、分页（含页码夹紧）、160ms 模拟异步加载。

**对外接口**（`src/composables/useGameLibrary.ts`）：

```ts
useGameLibrary(): {
  // 状态
  catalogSize: number          // 目录总数（不随筛选变化，供 Hero 统计）
  games: Ref<Game[]>           // 过滤 + 排序 + 分页后的最终展示数据
  filtered: Ref<Game[]>        // 过滤 + 排序后、未分页的完整结果
  isLoading: Ref<boolean>
  total: Ref<number>
  totalPages: Ref<number>
  currentPage: Ref<number>

  // 元数据（供 UI 渲染过滤面板）
  availableAuthors: Ref<string[]>
  availableYears: Ref<number[]>     // 降序
  availableSeries: Ref<string[]>

  // 当前筛选状态
  activeFilters: Ref<{ search; author; year; series; sort; page; pageSize }>
  hasActiveFilters: Ref<boolean>

  // 操作方法
  setSearchQuery(query: string): void
  setFilter(category: 'author' | 'year' | 'series', value: string): void  // 再点同值 = 取消
  clearFilters(): void
  setSortBy(key: 'views' | 'score' | 'title' | 'year'): void
  setPage(page: number): void
  setPageSize(size: number): void
  isFilterActive(category, value): boolean
  getGameById(id: string): Game | undefined
}
```

> **铁律**：`.vue` 文件里**只允许**调用上述方法并遍历 `games`，
> **绝对禁止**手写 `.filter()` / `.sort()`。这条在 §2.1 的断言里间接被保护着。

模块级单例，所有组件共享同一份状态。

### 4.3 路由

`createWebHashHistory()`。**GitHub Pages 是纯静态托管，没有服务端 rewrite，
History 模式刷新子路径必然 404**，Hash 模式是唯一稳妥解。

| 路径 | 组件 | 说明 |
| --- | --- | --- |
| `/` | `Home.vue` | 首页 |
| `/game/:id` | `GameDetail.vue` | 动态路由，`props: true` 把 id 注入组件 |
| `/debug` | `DebugLibrary.vue` | 调试台（上线前可移除） |
| `/style` | `StyleSpecimen.vue` | 视觉规范验收页（上线前可移除） |
| `/:pathMatch(.*)*` | `NotFound.vue` | 404 兜底 |

`routes.ts` 与 router 实例**刻意分离**，这样 `scripts/smoke.ts` 能用 memory history
复用同一份生产路由配置，而不是复制一份。

### 4.4 资源路径：必须走 `assetUrl()`

`db.json` 里图片写成站内绝对路径（`/images/xxx.svg`），但 GitHub Pages 部署在子路径下，
`/images/...` 会指向域名根目录而 404。

**所有图片路径必须经过 `src/utils/asset.ts`**：

```ts
assetUrl(path)  // → `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`
```

`BASE_URL` 由 `vite.config.ts` 的 `base` 决定，本地是 `/`，生产是 `/fnaf-fan-games-archive/`。

---

## 5. 视觉规范（Swiss International Style）

> 规范原文：**「视视觉规范的一致性高于一切创意延展，一旦偏离即视为严重 Bug。」**

### 5.1 绝对禁忌

| 禁止 | 替代方案 |
| --- | --- |
| 任何圆角 `rounded-md/lg/full` | 只能用 `rounded-none` |
| 任何阴影 `shadow-*`、`box-shadow` | 用 1px 边框分隔 |
| 任何渐变 `bg-gradient-to-*` | 纯色块 |
| `font-serif` / `font-mono` | 只用 Helvetica / Arial / sans-serif |
| `text-center` | 一律 `text-left` |
| `hover:scale-*` / `hover:translate-y-*` | 悬停只改颜色 |

**唯一允许的位移**：按钮内部箭头 `group-hover:translate-x-2`（实现为 `.u-arrow`）。

### 5.2 设计系统速查

- **色彩**：纸 `#ffffff` / 墨 `#000000` / 强调红 `#ff0000` / 辅助线 `#cccccc` / 悬停底 `#f9f9f9`
- **网格**：12 列衍生，常用 `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8`
- **动效上限**：`duration-150 ease-out`
- **留白优先**：用大间距（`py-24`、`mb-12`）而非分隔线建立层级
- **`.swiss-meta`**：自定义 component class，`text-[11px] uppercase tracking-[0.18em]`，
  用于年份 / 作者 / 元信息等小字标签

### 5.3 三层强制机制（重点）

规范不是靠自觉遵守的，而是**三层拦截**：

**第一层：Tailwind 覆盖式配置**（`tailwind.config.js`）

用的是**覆盖**而不是 `extend`，直接从编译层删掉工具类：

```js
borderRadius: { none: '0px' },      // rounded-md/lg/full 根本不存在
boxShadow: { none: 'none' },        // shadow-sm/md/lg 不存在
backgroundImage: { none: 'none' },  // bg-gradient-to-* 被杀死
fontFamily: { sans: ['Helvetica', 'Arial', 'sans-serif'] },  // font-serif/mono 不存在
scale: {}, translate: {},           // hover:scale-* / translate-* 不存在
transitionDuration: { DEFAULT: '150ms', 150: '150ms' },
```

> ⚠️ **不要给这四个 theme key 加 `DEFAULT`。** 加了会导致裸类 `.shadow` / `.rounded` 被生成。
> 曾经因为注释里出现 "box-shadow" 一词，Tailwind 的提取器把它当成候选类名生成出了 `.shadow`（详见 §9.3）。

**第二层：全局 CSS 硬重置**（`src/styles/index.css`）

```css
*, *::before, *::after {
  border-radius: 0 !important;
  box-shadow: none !important;
}
```

body 强制 `Helvetica, Arial, sans-serif`，所有文本元素默认 `text-align: left`。
这一层是**为第三方内容准备的**——比如 Giscus 的 iframe 元素本身。

**第三层：运行时哨兵**（`StyleAuditBadge.vue`）
全量扫描 DOM 比对计算结果，页面直接显示 PASS/FAIL。

**审计产物 CSS 的方法**（每次改完样式可以跑一遍）：

```bash
CSS=$(ls dist/assets/*.css)
grep -o 'border-radius:[^;}]*' "$CSS" | sort -u   # 只应出现 0 / 0!important
grep -o 'box-shadow:[^;}]*' "$CSS" | sort -u      # 只应出现 none / none!important
grep -o 'linear-gradient([^)]*)' "$CSS" | sort -u # 应为空
grep -o '\.rounded-md\|\.shadow{\|\.font-serif\|\.font-mono' "$CSS" | sort -u  # 应为空
```

---

## 6. 常见迭代任务怎么做

### 6.1 新增 / 修改一款游戏

只改 `src/data/db.json`，字段契约见 `src/types/game.ts`：

```json
{
  "id": "唯一短横线小写", "title": "英文原名", "author": "作者", "releaseYear": 2017,
  "ipSeries": "FNAF 主线同人", "engine": "Unreal Engine 4",
  "coverImage": "/images/<id>-cover.svg", "bannerImage": "/images/<id>-banner.svg",
  "gallery": ["..."], "videoUrl": "https://...",
  "description": "中文简介...",
  "downloads": [{ "provider": "123云盘", "url": "https://...", "password": "abcd" }],
  "metrics": { "fakeViews": 12540, "score": 4.8 }
}
```

然后 `npm run assets` 生成配套占位图（真实封面替换同名文件即可，`db.json` 不用改）。
**注意**：占位图生成器按数组顺序编号（`NO.01`…），插入新条目会改变后续编号。

改动后 `npm run selftest` 里的计数断言可能需要同步更新
（`libraryAssertions.ts` 里有写死的期望值，如"清除筛选后返回全量 = 6"）。

### 6.2 改文案 / 页脚 / 声明

- 页脚（免责条款、版权、CONTACT）：`src/layouts/Layout.vue`
- 站点名与标签页标题格式：`src/router/index.ts` 的 `SITE_NAME`
- 首页 Hero 文案：`src/views/Home.vue`

### 6.3 调整筛选 / 排序 / 分页行为

改 `src/composables/useGameLibrary.ts`，然后在 `src/dev/libraryAssertions.ts` 补断言，
最后 `npm run selftest` 验证。**不要**在视图里绕开深模块直接处理数据。

### 6.4 新增一个页面

1. 在 `src/views/` 建组件
2. 在 `src/router/routes.ts` 注册路由（首屏之外的用 `() => import(...)` 懒加载）
3. 在 `scripts/smoke.ts` 的 `CASES` 里加一条，断言页面关键内容
4. `npm run verify`

### 6.5 新增一个基础组件

放 `src/components/`。**必须**符合 §5 的规范：直角、无阴影、无渐变、
悬停只改颜色、过渡 `duration-150 ease-out`、文本左对齐。
可以参考 `Button.vue`（箭头位移用 `.u-arrow`）和 `Card.vue`（左边框悬停变红，
左侧永驻 `border-l-4 border-l-transparent` 以避免布局抖动）。

---

## 7. 第三方集成现状

### 7.1 浏览量 —— 适配器模式，**当前未接入后端**

`src/services/viewCounter.ts` 定义了 `ViewProvider { id, read, increment }`。
当前无 provider，`trackView()` 直接返回 `db.json` 里的 `metrics.fakeViews`，**不发任何网络请求**。

**接后端只需两步，组件一行都不用改：**

1. 实现 `ViewProvider`
2. 在 `src/main.ts` 调 `registerViewProvider(yourProvider)`

文件末尾注释里有 **Supabase 的完整参考实现与配套 SQL**（用 `on conflict do update` + rpc，
避免前端"读-改-写"的竞态）。

期望的表结构极简：

```sql
create table views (game_id text primary key, count integer not null default 0);
```

> 关于两种模式：`useViewCounter` 在 **static 模式下同步取值**（否则 SSR 首帧会永远卡在
> "载入中"），remote 模式才走异步 + `isLoading`。

### 7.2 评论 —— Giscus，**配置留空并优雅降级**

`src/config/giscus.ts` 里 `enabled: false`，UI 会渲染一个带编号步骤说明的占位块，
**不报错、不留白**。

**启用步骤**（约 5 分钟）：

1. 建一个**公开**仓库（建议与站点代码仓库分开）
2. 该仓库 Settings → General → Features → 勾选 **Discussions**
3. 在 Discussions 新建分类 `Announcements`（类型选 Announcements，仅维护者可发起）
4. 安装 [giscus App](https://github.com/apps/giscus) 并授权该仓库
5. 打开 [giscus.app/zh-CN](https://giscus.app/zh-CN) 填入仓库名，会生成 `repoId` / `categoryId`
6. 抄进 `src/config/giscus.ts`，把 `enabled` 改 `true`

#### ⚠️ 两个必须知道的坑

**坑一：Hash 路由下 `mapping` 必须保持 `specific`。**
Giscus 的 `mapping: 'pathname'` 取的是 `window.location.pathname`，
而本站是 Hash 路由，pathname **永远是 `/`** → **所有游戏会挤进同一个讨论串**。
代码里已固定 `mapping: 'specific'` + `data-term={game.id}`。

**坑二：跨域 iframe 无法从父页面注入 CSS。**
Giscus 渲染在 `giscus.app` 域下的跨域 iframe 内，父页面 CSS 注入不进去。
**唯一正确途径**是给 giscus 传 `data-theme` = 自定义主题 CSS 的 URL，由它在 iframe 内自己加载。
项目已实现 `public/giscus-swiss.css`（把 GitHub Primer 整套变量压到 白/黑/`#ff0000`/`#cccccc`）。
父页面能控制的**只有 iframe 元素本身**（尺寸/直角/无阴影，在 `index.css` 里约束）。

---

## 8. 部署

### 8.1 机制

`.github/workflows/deploy.yml`：push 到 `main` **或手动触发** → 依次跑
`npm ci --ignore-scripts` → typecheck → selftest → smoke → build → configure-pages
→ upload-pages-artifact → deploy-pages。

**部署前跑三道门禁是刻意的**，保证线上永远不会出现"编译通过但页面白屏"的版本。

Pages 配置：`build_type = workflow`。

### 8.2 `base` 路径

`vite.config.ts` 按 command 区分：

```ts
base: command === 'build' ? '/fnaf-fan-games-archive/' : '/'
```

好处：生产产物带正确子路径前缀，而**本地开发地址仍是 `http://localhost:5173/`**。
若仓库改名，**必须同步修改这里的字符串**，否则资源全 404。

### 8.3 ⚠️ 发布代码：本环境不能 `git push`

沙箱代理**只放行 `api.github.com`**，`github.com` 与直连都不通（免沙箱执行也一样）。
`git push` / `git fetch` 在本环境**不可用**。

**两个选择：**

**A. 在你自己的终端推送（推荐，最省事）**
你的终端没有网络限制，`git push` 可直接使用。

**B. 用 GitHub API 推送**（本次开发全程用这个方法）

```bash
# 1. 暂存并生成 tree 对象（不需要先建本地提交）
git add -A
T=$(git write-tree)

# 2. 导出提交内容 —— 用 git archive 取精确内容，不要读磁盘（行尾差异会导致 blob 不一致）
mkdir -p .tmp/new && git archive "$T" | tar -x -C .tmp/new
git ls-tree -r "$T" > .tmp/ls-tree-new.txt

# 3. 用 Node 脚本拼 JSON（Node 只拼 JSON，绝不 spawn 进程 —— 本环境 spawnSync 会 EBUSY）
#    payload: { "tree": [{ path, mode:"100644", type:"blob", content }] }

# 4. 落库
gh api -X POST repos/DaXiGua732/fnaf-fan-games-archive/git/trees --input .tmp/tree-payload-new.json
gh api -X POST repos/DaXiGua732/fnaf-fan-games-archive/git/commits \
  -f "message=..." -f "tree=$TREE_SHA" -F "parents[]=$PARENT_SHA" \
  -f "author[name]=DaXiGua732" -f "author[email]=91938727+DaXiGua732@users.noreply.github.com"
gh api -X PATCH repos/DaXiGua732/fnaf-fan-games-archive/git/refs/heads/main \
  -f "sha=$COMMIT_SHA" -F force=true
```

**校验点**：API 返回的 tree SHA 必须等于 `git write-tree` 的结果。不等就说明内容有偏差，别往下走。

**首次提交**（仓库为空）：`git/commits` **不带 `parents`**，得到根提交；
`refs` 用 `POST` 创建（若已存在则改 `PATCH ... -F force=true`）。

### 8.4 让本地与远程 SHA 完全一致（关键技巧）

用 API 创建的提交，本地没有对应对象，`git update-ref` 会报
`trying to write ref ... with nonexistent object`；而 `git fetch` 又不可用。

**解法：在本地重建字节级相同的提交对象。**

```bash
TS=$(date -u -d "<远程 author.date>" +%s)
{ printf 'tree %s\n' "$TREE"
  printf 'parent %s\n' "$PARENT"          # 根提交时省略这一行
  printf 'author %s <%s> %s +0800\n' "$NAME" "$MAIL" "$TS"
  printf 'committer %s <%s> %s +0800\n' "$NAME" "$MAIL" "$TS"
  printf '\n'
  printf '%s' "$MSG"; } > obj.txt          # ← 注意：消息结尾【不带】换行
git hash-object -t commit -w --stdin < obj.txt
git update-ref refs/heads/main <得到的 SHA>
git reset --mixed
```

**两条决定 SHA 能否命中的隐藏规则**（踩了两轮才找出来）：

- GitHub 存储的时区偏移是 **`+0800`**，不是 `+0000`
- 提交消息**结尾没有换行符**（而 `git commit-tree -m` 会自动加一个，所以不能用它）

> 实测：遵守这两条后 SHA 一次命中，`851ddf7` 本地与远程完全一致。

---

## 9. 已知坑与环境限制

### 9.1 Windows 下 `npm install` 必须加 `--ignore-scripts`

esbuild 的 postinstall 会做 `validateBinaryVersion`（spawn `node.exe`），在本环境报 **EBUSY**。
且失败回滚后 `@esbuild/win32-x64`、`@rollup/rollup-win32-x64-msvc` 两个平台二进制包**不会被装入
node_modules**，`package-lock.json` 也不会记录它们，导致 `vite build` 直接崩。

**已解决**：把四个平台包显式写进 `package.json` 的 `optionalDependencies`
（Windows + Linux 各一对，保证 CI 可复现），并且安装时一律 `--ignore-scripts`。

### 9.2 沙箱的批量删除保护

沙箱有个安全机制：单轮次内批量删除超过 **50 个文件**会被拦截
（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`）。

- `vite build` 会清空 `dist/`，正常大约 20 个文件，安全
- 但 `verify` 里 smoke 也清目录的话会累计超限 → **已让 smoke 构建不清空目录**（`vite.smoke.config.ts`）
- 若 `build` 仍被拦，需申请一次免沙箱执行（`dist/` 是构建产物，清空是正常行为）
- GitHub 上**不能删除默认分支**（`Cannot delete the default branch` 422）

### 9.3 Tailwind 内容提取器会扫描注释

Tailwind 的提取器会把**注释和字符串里的词**当成候选类名。
曾经因为源码注释里出现了 "box-shadow" 一词，被拆出 `shadow` 候选，
命中了 `theme.boxShadow.DEFAULT`，**意外生成了 `.shadow{...}` 类**。

**已解决**：`borderRadius` / `boxShadow` / `backgroundImage` / `fontFamily`
四个 theme key **一律不留 `DEFAULT`**。
> 教训：审计脚本不能只查 `shadow-*`，要连裸 `.shadow` 一起查。

### 9.4 Vite 浏览器 target 不含 top-level await

`scripts/` 下的脚本若用 TLA，会被 esbuild 拒绝
（`Top-level await is not available in the configured target environment`）。
包进 `async function main()` 即可。

### 9.5 `emptyOutDir` 在 outDir 位于项目根内时默认为 true

`--emptyOutDir` 只能设 true，关不掉。要关必须在配置文件里显式写 `emptyOutDir: false`。

### 9.6 涉及浏览器权限类 API 时必须有降级路径

`DownloadPanel` 的提取码复制曾出现「点击无反应」——原因是
`navigator.clipboard.writeText` 需要①安全上下文 ②若在 iframe 内需外层授予 `clipboard-write` 权限，
而 `catch` 里**静默失败**，导致失败与"没点到"无法区分。

**已解决**：`src/utils/clipboard.ts` 的 `copyText()` 提供两级回退
（Clipboard API → 临时 textarea + `execCommand`），返回 `boolean`，
**强制调用方给出可见反馈**（成功"已复制" / 失败红色提示 + 提取码可点击全选）。

> **通用原则：任何用户触发的异步操作，失败路径都必须有可见反馈。**

---

## 10. 迭代协议

原始需求文档第 5 节明确要求 AI 助手遵守以下协议，**请继续沿用**：

1. **单步执行** —— 一次不得输出超过三个组件的代码，按阶段逐步提交
2. **强制测试** —— 每完成一小步，明确提示用户去浏览器验证，等确认后再继续
3. **拒绝妥协** —— 若用户要求"加个圆角"或"加个阴影"，**必须拒绝**并指出这违反
   Swiss International Style 的绝对红线

### 收尾清单（每次改动）

```bash
npm run verify     # 四道关卡必须全绿
# 若改了样式，再跑 §5.3 的产物 CSS 审计
# 然后按 §8.3 发布
```

---

## 11. 待办

- [ ] **启用评论区** —— 按 §7.2 的 5 步填好 `src/config/giscus.ts`（用户尚无 GitHub 仓库）
- [ ] **接入浏览量后端** —— 按 §7.1 实现 `ViewProvider`（当前为静态基数，数据是假的）
- [ ] 上线前移除 `/debug` 与 `/style` 两个开发入口
  （`src/router/routes.ts` 的对应路由、`Layout.vue` 的 `NAV_ITEMS` 里带 `dev: true` 的两项）
- [ ] 升级 Actions 版本 —— 目前 `actions/checkout@v4` 等仍指向 Node 20，
      有 deprecation annotation（非致命）
- [ ] 补一个 `README` 之外的 `LICENSE` / 贡献说明（可选）

---

## 附：本地辅助知识

- 工作区记忆（**未纳入版本管理**）在 `.workbuddy/memory/`：
  - `MEMORY.md` —— 项目长期约定
  - `YYYY-MM-DD.md` —— 逐日工作日志，含完整的踩坑记录与调试手法
- `D:/CODE` 是一个**独立的仓库**（`start-dsh`），但它用白名单 `.gitignore`（`*` + 三个例外），
  本项目文件**全部被它忽略**，不会被误推。
- git 身份是**仓库级**配置（`D:/CODE` 的配置不会继承）：
  `user.name=DaXiGua732` / `user.email=91938727+DaXiGua732@users.noreply.github.com`
