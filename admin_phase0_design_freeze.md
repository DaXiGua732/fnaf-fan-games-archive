# Phase 0 — 项目审计与设计冻结

> 对应 `admin_backend_development_plan.md` 的 Phase 0。
> 本文件是**开工前的一次性交付物**，只做审计与设计，不含任何后台业务代码。
> 审计基准提交：`f42fb32`；基线质量门禁：见 §1.1。

---

## 1. 审计结论

### 1.1 审计范围与基线

逐份读取了以下文件：

| 文件 | 审计要点 |
| --- | --- |
| `package.json` | 脚本链、依赖、`optionalDependencies` 平台包锁定 |
| `vite.config.ts` | `base` 按 `command` 区分（build 子路径 / serve 根路径） |
| `tailwind.config.js` | **覆盖式** theme（非 extend），四种违规工具类从编译层删除 |
| `src/styles/index.css` | 全局硬重置 `border-radius:0!important` / `box-shadow:none!important` |
| `src/types/game.ts` | 领域模型契约，当前 **9 个必填字段，零可选字段** |
| `src/data/db.json` | 单一事实来源：6 款游戏 / 5 位作者 / 4 个年份 / 2 个系列 / 4 家网盘 |
| `src/composables/useGameLibrary.ts` | 深模块单例；`const ALL_GAMES` 模块加载时快照一次 |
| `src/router/routes.ts` + `index.ts` | Hash history；路由表与实例分离（为 SSR 冒烟复用） |
| `src/App.vue` | ⚠️ **硬编码 `<Layout>` 包裹 `<RouterView />`** |
| `src/layouts/Layout.vue` | 公开站骨架：Header + slot + Footer |
| `src/components/*` | `Button.vue` / `Card.vue` 可直接复用于后台 |
| `scripts/smoke.ts` | ⚠️ **`LAYOUT_MARKERS` 是全局常量，对所有路由生效** |
| `src/dev/libraryAssertions.ts` | ⚠️ 断言里**写死了计数**（6 / 2 / 1 / 2015–2019 等） |
| `README.md` | 三条红线、四道门禁、部署绕行方案 |

**基线门禁结果**（本次实测，后台开工前证明前台是绿的）：

```
npm run typecheck   PASS   0 错误
npm run selftest    PASS   Deep module self-test: 29/29
npm run smoke       PASS   SSR smoke: 6/6 —
                           home 18087B / game 13580B / game-404 5405B
                           debug 17825B / style 14797B / not-found 5424B
npm run build       PASS   63 modules transformed
                           index-oqf25k6v.js 116.75 kB (gzip 45.43 kB)
                           index-0khblYCn.css 18.99 kB (gzip 4.47 kB)
```

> 这组数字是后续每个阶段的**回归基准**：改动后若某个路由的 HTML 体积或产物结构出现非预期变化，说明前台被动到了。

### 1.2 可以复用的东西

| 资产 | 复用方式 |
| --- | --- |
| `Button.vue` | 后台主按钮/次按钮直接复用（`solid` / `outline` / `ghost` × `md` / `lg`，自带 `block` 与箭头位移） |
| `Card.vue` | 后台卡片容器（`interactive` 悬停左边框变红） |
| `Layout.vue` 的 `linkClass()` 模式 | AdminLayout 侧栏导航照抄这套「2px 下边框常驻占位 + 激活变红」的写法，避免布局抖动 |
| `routes.ts` / router 实例分离 | 后台路由继续放在同一个 `routes.ts`，SSR 冒烟才能一并覆盖 |
| `assetUrl()` | 后台所有图片预览**必须**经过它，否则 GH Pages 子路径下 404 |
| `StyleAuditBadge.vue` | 挂进 AdminLayout，后台也接受运行期视觉哨兵 |
| 四道质量门禁 | 后台每一阶段收尾照跑 |

### 1.3 必须抽象 / 必须新增的东西

| 缺口 | 说明 |
| --- | --- |
| **Layout 无法共存** | `App.vue` 写死 `<Layout>`，后台会被迫套上公开站的 Header/Footer。**必须先重构为嵌套路由**（§3.1） |
| **深模块不可写** | `useGameLibrary` 是只读单例，`ALL_GAMES` 是模块加载时的 `const` 快照，且契约是「视图层禁写 filter/sort」。后台**不能复用**它，需要独立 `useAdminGames` |
| **模型缺 9 个管理字段** | `status` / `tags` / `featured` / `sortOrder` / 时间戳等，见 §4 |
| **无 Repository 层** | 后台直接 import `db.json` 会锁死在构建期数据上，必须尽早立契（§3.3） |
| **测试设施需扩展** | `smoke.ts` 的全局 `LAYOUT_MARKERS` 会让后台路由必然 FAIL；`libraryAssertions.ts` 的写死计数在「按状态过滤」上线后会被打穿（§6） |

### 1.4 不能碰的东西

- `src/data/db.json` —— Phase 0 一行都不改（新增字段走「可选字段 + 默认值」而非数据迁移）。
- `src/composables/useGameLibrary.ts` —— 前台数据链路在 Phase 10 之前保持原样。
- `tailwind.config.js` / `styles/index.css` —— 视觉规范三层强制机制不动。
- 公开站的 Header / Footer 文案、导航项、Footer 免责声明 —— Rule 6 保护对象。
- `/debug`、`/style` 两个开发入口 —— 保持现状，供后台开发期继续用。

---

## 2. 后台架构说明

### 2.1 目标分层

```
                    ┌─────────────────────┐
                    │    Admin UI         │   views/admin/*.vue
                    │ Games / Editor/Tags │   components/admin/*.vue
                    └──────────┬──────────┘
                               │  只调用，不加工
                               ↓
                    ┌─────────────────────┐
                    │  Admin Composables  │   composables/useAdminGames.ts
                    │  useAdminGames      │   composables/useAdminTags.ts
                    └──────────┬──────────┘
                               │
                               ↓
                    ┌─────────────────────┐
                    │   Repository Layer  │   repositories/*
                    │   GameRepository    │   ← 唯一允许碰数据源的地方
                    └──────────┬──────────┘
                               │
               ┌───────────────┴───────────────┐
               ↓                               ↓
      LocalRepository                 RemoteRepository
      （Phase 12 立即可用）              （Phase 13+ 决策后）
               │                               │
          db.json 只读种子                     DB + Storage + Auth
```

三条硬约束：

1. **`.vue` 文件里禁止 `import ... from '../data/db.json'`**（Phase 11 起为强制，Phase 2 起即按此设计）。
2. **`.vue` 文件里禁止手写 `.filter()` / `.sort()`**（延续前台既有铁律）。
3. 数据源替换（Local → Remote）**只允许影响 `repositories/` 目录**，`useAdminGames` 之上的层不得感知。

### 2.2 为什么后台不复用 `useGameLibrary`

| 维度 | `useGameLibrary`（前台） | `useAdminGames`（后台） |
| --- | --- | --- |
| 数据范围 | 只有「前台可见」的游戏 | **全部**游戏（含 draft / offline） |
| 状态 | 模块级只读单例 | 可写，需支持增删改与乐观更新 |
| 筛选维度 | author × year × series | status × author × tag × 关键词 |
| 输出形态 | 分页网格数据 | 表格行 + 勾选态 + 状态计数 |
| 生命周期 | 应用级长驻 | 后台路由级（离开即释放） |

结论：**新增独立 composable，前台深模块一行不动。** 两者未来在 Repository 层汇合（Phase 11–12），而不是在组件层复用。

### 2.3 后台的状态联动策略（Phase 10 冻结）

```
status = 'published'  →  前台可见，后台可见
status = 'draft'      →  前台完全不可见，后台可见
status = 'offline'    →  前台完全不可见，后台保留（不删数据）
```

前台隐藏的实现位置：**深模块 `useGameLibrary` 内部**（在 `filtered` 计算的第一步就排除 `status !== 'published'`），
而不是在视图层做二次过滤 —— 这样搜索、筛选、分页、首页统计会**自动一致**，不会出现「首页看不到但搜索得到」的裂缝。

> `lib.metrics.fakeViews` 等统计字段不受 status 影响；`catalogSize` 需同步改为「仅统计 published」，否则 Hero 的「收录作品」会出现虚高。

---

## 3. 关键设计决策（需你确认）

### 3.1 【决策 A｜最高优先级】Layout 分离方式

**问题**：`src/App.vue` 当前是

```vue
<Layout>
  <RouterView />
</Layout>
```

公开站骨架被写死在应用根组件，后台路由一旦存在就必然被套上公开站的 Header/Footer。

**方案一（推荐）：嵌套路由 + 双 Layout 路由记录**

```ts
// src/router/routes.ts
export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: Layout,                       // 公开站骨架
    children: [
      { path: '',             name: 'home',    component: Home,                        meta: { title: '首页' } },
      { path: 'game/:id',     name: 'game',    component: () => import('../views/GameDetail.vue'), props: true, meta: { title: '游戏详情' } },
      { path: 'debug',        name: 'debug',   component: () => import('../views/DebugLibrary.vue'), meta: { title: '调试台' } },
      { path: 'style',        name: 'style',   component: () => import('../views/StyleSpecimen.vue'), meta: { title: '样式规范' } },
      { path: ':pathMatch(.*)*', name: 'not-found', component: () => import('../views/NotFound.vue'), meta: { title: '页面不存在' } },
    ],
  },
  {
    path: '/admin',
    component: () => import('../layouts/AdminLayout.vue'),   // 后台骨架
    meta: { layout: 'admin' },
    children: [ /* 见 §5 */ ],
  },
]
```

`App.vue` 收缩为：

```vue
<template>
  <RouterView />
</template>
```

- ✅ 路由表仍是唯一事实来源，SSR 冒烟可一并覆盖后台
- ✅ 公开站 URL **完全不变**（`/#/`、`/#/game/xxx`、`/#/a/b/c/d` 全部照旧，404 仍渲染在公开站骨架内）
- ✅ 公开站渲染结果**视觉零变化**（同一份 `Layout`；差异已逐字节核对，见下方「准确性更正」）
- ⚠️ 改动面：`App.vue` + `routes.ts` + **`Layout.vue` 的一行**（`<slot />` → `<RouterView />`）。
  三者都属于前台共享文件，需要你点头

> **准确性更正**：本节初稿写的是「渲染结果逐字节等价」。Phase 1 实测后该表述**不准确**，
> 已用 `git stash` 采集旧代码基线并做逐字节 diff，实际差异是**完全封闭的两类、且都不影响渲染**：
>
> 1. **少了一对 slot 片段锚点** `<!--[-->` … `<!--]-->`（HTML 注释，无渲染效果）。
>    这是 `Layout.vue` 从「App 传 slot 进来的被动容器」变为路由组件后必然产生的。
> 2. **`<a href="/">` 上多了 `router-link-active` 类**。原因是 `/` 从顶层路由变成了
>    `/game/:id` 等路由的**父记录**，vue-router 的 `isActive` 判定因此把它标为激活。
>    已全仓检索确认：**没有任何样式表命中 `.router-link-active` / `.router-link-exact-active`**，
>    因此该 class 是惰性的，视觉零影响。（公开站导航项用的是 `custom` + `isExactActive`，未被波及。）
>
> 结论：**视觉零变化，但 HTML 不是字节等价** —— 上表第 3 条已按此改写。

**方案二：`App.vue` 读 `route.meta.layout` 切换**

```vue
<component :is="route.meta.layout === 'admin' ? AdminLayout : Layout">
  <RouterView />
</component>
```

- ✅ 改动最小（不动 `routes.ts` 层级结构）
- ❌ Layout 选择逻辑混进根组件；路由表不再是自解释的；`<RouterView />` 的复用/嵌套能力受限

**Phase 0 建议：采方案一。**
这是唯一需要修改**前台共享文件**的一项，所以单独拎出来请你确认。除此之外 Phase 1 不碰前台任何文件。

---

### 3.2 【决策 B】新组件落在哪里

计划书 §28 的目标结构是把 `components/` 拆成 `public/` + `admin/`。**不建议现在搬**：
搬动 7 个公开站组件会改动 10+ 处 import，收益为零，风险却实打实（Rule 3：一次别动太多核心模块）。

**冻结为**：

```
src/components/          # 公开站组件，留在原地不动（现有 7 个）
src/components/admin/    # 新增目录，只放后台专用组件
```

`public/` 子目录留到「上线前清理 `/debug` `/style`」那一轮再一并处理。

---

### 3.3 【决策 C】Repository 的引入时机

计划书 Phase 11 才立 Repository，但 Phase 2 的 `useAdminGames` 就需要数据源。
**冻结为「单行可替换」策略**，既不跨阶段也不写废代码：

```ts
// composables/useAdminGames.ts
// Phase 2–12：数据源是一行 import，仅此一处
import rawDb from '../data/db.json'
const state = ref<AdminGame[]>(normalizeGames(rawDb.games))

// Phase 11 落地后：仅把上面那一行换成下面这一行，其余逻辑零改动
// const state = ref<AdminGame[]>(await localGameRepository.listGames())
```

同时 Phase 4/5 的 `saveGame(game)` 也**先做接口、先不接线**：

```ts
// repositories/gameRepository.ts —— Phase 11 落地接口，Phase 4 先按此签名写调用方
export interface GameRepository {
  listGames(): Promise<AdminGame[]>
  getGame(id: string): Promise<AdminGame | undefined>
  createGame(input: GameDraft): Promise<AdminGame>
  updateGame(id: string, patch: Partial<GameDraft>): Promise<AdminGame>
  deleteGame(id: string): Promise<void>
  publishGame(id: string): Promise<void>
  unpublishGame(id: string): Promise<void>
}
```

> 后台 UI 只认这个接口。Phase 12 之前由 `LocalGameRepository`（内存）实现，
> `saveGame()` 允许「写内存 + 提示未持久化」，**不得伪装成已保存到生产数据**。

---

## 4. 数据模型变更说明

### 4.1 现状

```ts
Game {                       // 9 个字段，全部必填，零可选
  id, title, author, releaseYear, ipSeries, engine,
  coverImage, bannerImage, gallery, videoUrl?, description,
  downloads[], metrics
}
```

缺：分类标签、发布状态、推荐标记、排序权重、时间戳、短简介。

### 4.2 增量方案（**全部新增字段可选**）

```ts
/** 发布状态 */
export type GameStatus = 'draft' | 'published' | 'offline'

export interface Game {
  /* ---- 现有字段保持不变 ---- */
  id: string
  title: string
  author: string
  releaseYear: number
  ipSeries: string
  engine: string
  coverImage: string
  bannerImage: string
  gallery: string[]
  videoUrl?: string
  description: string
  downloads: DownloadLink[]
  metrics: GameMetrics

  /* ---- Phase 4 起新增：全部 optional，旧数据零迁移 ---- */
  /** 列表页/搜索卡片用的一句话简介 */
  shortDescription?: string
  /** 自由标签（与 ipSeries 并列，不是替代关系） */
  tags?: string[]
  /** 支持平台，如 ['Windows', 'Android'] */
  platforms?: string[]
  /** 发布状态；缺省视为 'published'（保证旧数据仍在前台可见） */
  status?: GameStatus
  /** 首页推荐位 */
  featured?: boolean
  /** 手动排序权重，越大越靠前 */
  sortOrder?: number
  /** ISO 8601 时间戳 */
  createdAt?: string
  updatedAt?: string
  publishedAt?: string
}
```

**归一化器**（新增 `src/utils/gameDefaults.ts`）——后台读到的永远是补齐后的 `AdminGame`：

```ts
/** 后台内部使用的「字段已补齐」视图模型 */
export type AdminGame = Game & {
  status: GameStatus          // 缺省 → 'published'
  tags: string[]              // 缺省 → []
  gallery: string[]
  platforms: string[]
  featured: boolean           // 缺省 → false
  sortOrder: number           // 缺省 → 0
  createdAt: string           // 缺省 → 由 id 派生稳定的占位值
  updatedAt: string
}

export function normalizeGame(raw: Game): AdminGame { /* 补默认值，不修改原对象 */ }
export function normalizeGames(raw: Game[]): AdminGame[]
```

> **为什么 `status` 缺省是 `published`**：db.json 现有 6 条数据全部是线上作品。
> 若缺省成 `draft`，一次 Phase 10 的联动上线会让**整个前台瞬间清空** —— 这是最危险的一幕。
> 缺省 `published` 则保证「不给数据加字段」和「给数据加 `status: 'published'`」两种状态渲染完全一致。

### 4.3 标签与系列的边界（Phase 6 冻结）

| | `ipSeries` | `tags[]` |
| --- | --- | --- |
| 语义 | 世界观归属（单选） | 玩法/风格特征（多选） |
| 取值示例 | `FNAF 主线同人`、`玩梗向混搭` | `3D`、`恐怖`、`剧情`、`生存`、`高难度` |
| 存储 | `Game.ipSeries: string` | `Game.tags: string[]`；全局标签表 Phase 14 才建 |
| 筛选 | 前台已有（`setFilter('series', …)`） | 仅后台，前台是否暴露留待产品决定 |

**Phase 4–9 期间标签不建独立存储**：标签就是 `Game.tags` 字符串数组的去重并集，
`useAdminTags` 从这个并集派生（含使用计数）。Phase 14 若上远程库，再拆 `tags` / `game_tags` 关联表。

### 4.4 变更影响面

| 文件 | 是否改 | 何时 |
| --- | --- | --- |
| `src/types/game.ts` | +9 个可选字段 + `GameStatus` | Phase 4 |
| `src/utils/gameDefaults.ts` | 新建 | Phase 4 |
| `src/data/db.json` | **不改**（可选字段缺省即兼容） | — |
| `src/composables/useGameLibrary.ts` | Phase 10 加一行 status 过滤 | Phase 10 |
| `src/dev/libraryAssertions.ts` | Phase 10 后需补「draft 不可见」断言 | Phase 10 |
| 前台视图 | **不改** | — |

---

## 5. 路由规划

### 5.1 路由表

| 路径（Hash 形态） | name | 组件 | 阶段 |
| --- | --- | --- | --- |
| `/#/admin` | — | `redirect → admin-games` | Phase 1 |
| `/#/admin/games` | `admin-games` | `views/admin/AdminGames.vue` | Phase 1（占位）/ Phase 2（实体） |
| `/#/admin/games/new` | `admin-game-new` | `views/admin/AdminGameEditor.vue` | Phase 4 |
| `/#/admin/games/:id/edit` | `admin-game-edit` | `views/admin/AdminGameEditor.vue` | Phase 4 |
| `/#/admin/tags` | `admin-tags` | `views/admin/AdminTags.vue` | Phase 6 |
| `/#/admin/authors` | `admin-authors` | `views/admin/AdminAuthors.vue` | 延伸（未排期） |
| `/#/admin/settings` | `admin-settings` | `views/admin/AdminSettings.vue` | 最后 |
| `/#/admin/:pathMatch(.*)*` | `admin-not-found` | 后台 404（可复用精简版） | Phase 1（可选） |

约定：

- 除 `AdminGames.vue` 外，后台视图**全部懒加载**（`() => import(...)`），不打进首屏包。
- 后台路由 `meta.title` 沿用现有 `router.afterEach` 的标签页标题机制。
- `/admin` 一级路径挂 `meta: { layout: 'admin' }`，供 SSR 冒烟区分外壳（§6.2）。
- **Phase 15 之前 `/admin` 无认证拦截**，仅在 AdminLayout 上显示「未接入认证」的显式提示条 —— 不做假登录页，也不假装安全。

### 5.2 导航可见性与实现状态解耦

AdminLayout 的导航项带 `ready: boolean`，未实现的阶段显示为**禁用态 + `PLANNED` 角标**，
而不是隐藏 —— 让「这个后台将来长什么样」从一开始就可见（对应计划书 §30 的成功标准）。

```ts
const NAV_ITEMS = [
  { to: '/admin/games',    label: '游戏管理', ready: true  },
  { to: '/admin/tags',     label: '标签管理', ready: false },
  { to: '/admin/authors',  label: '作者管理', ready: false },
  { to: '/admin/settings', label: '系统设置', ready: false },
]
```

---

## 6. 测试设施改造规划（不弱化、只扩展）

### 6.1 现状风险

`scripts/smoke.ts` 里：

```ts
const LAYOUT_MARKERS = ['跳到主内容', '非商业性质的粉丝向资源导航站']   // 对每条路由全局生效
```

这两条都只存在于**公开站 Layout**。后台路由一旦加入 `CASES`，必然 FAIL。
注意：这里**不是**「改测试让它通过」，而是测试**少了一个维度**（外壳类型），属于能力补齐。

### 6.2 改造方案

```ts
interface SmokeCase {
  path: string
  name: string
  shell: 'public' | 'admin'        // ← 新增维度
  expect: string[]
}

const SHELL_MARKERS: Record<SmokeCase['shell'], string[]> = {
  public: ['跳到主内容', '非商业性质的粉丝向资源导航站'],
  admin:  ['FNAF / ADMIN', '返回站点'],          // AdminLayout 的稳定标记
}
```

并**新增断言**（同样只加不减）：
- 后台路由**不得**出现公开站 Footer 的免责声明 → 反向断言「Layout 已分离」。
- 公开站路由**不得**出现 `FNAF / ADMIN` → 反向断言「后台没污染前台」。

### 6.3 `libraryAssertions.ts` 的写死计数

现有断言含 `check('清除筛选后返回全量', lib.total.value, 6)` 等硬编码值。
Phase 0–9 **不需要改**（新增字段是可选且缺省 `published`，过滤结果不变）。
**Phase 10 之后**需要补：draft / offline 对前台的可见性断言、`catalogSize` 只计 published 的断言。
届时若 `selftest` 计数因数据调整而失败，会**先说明原因再改期望值**，不会静默放宽。

### 6.4 后台专项测试（Phase 2 起逐阶段累加）

沿用「断言集与调试视图共用一份实现」的既有设计，新增 `src/dev/adminAssertions.ts`，
被 `scripts/selftest.mts` 与后台调试面板共用。覆盖计划书 §21 的六类：
列表（搜索/筛选/排序/分页/全选）、批量（上线/下线/加标签/删标签）、
编辑（新建/修改/取消/保存/预览/发布）、状态三态、图片、下载链接。

---

## 7. Admin Layout 方案

### 7.1 结构

```
┌──────────────────────────────────────────────────────────────┐
│ FNAF / ADMIN                         未接入认证 · 返回站点 → │  ← 1px 黑下边框
├──────────────────┬───────────────────────────────────────────┤
│                  │                                           │
│  游戏管理   ●    │                                           │
│  标签管理 PLANNED│            Admin Content（slot）           │
│  作者管理 PLANNED│                                           │
│  系统设置 PLANNED│                                           │
│                  │                                           │
│  ─────────────   │                                           │
│  收录 6 / DRAFT 0│                                           │
│  OFFLINE 0       │                                           │
└──────────────────┴───────────────────────────────────────────┘
   ← 固定 240px →     ← 内容区 max-w-[1280px] + 大留白 →
```

- 桌面端：左侧固定导航（`md:` 起 `grid-cols-[240px_minmax(0,1fr)]`），右侧内容区。
- 移动端：顶部横向可滚动导航条（`<md` 折叠），内容全宽。
- 结构上用 `grid` 而非 `position: fixed`，避免移动端遮挡与滚动耦合。

### 7.2 视觉规范落地清单（逐条对齐 §5）

| 规范 | 后台做法 |
| --- | --- |
| 零圆角/零阴影/零渐变 | 不写即默认安全（Tailwind 覆盖式配置已删类） |
| 唯一色彩 | 纸 `#ffffff` / 墨 `#000000` / 强调 `#ff0000` / 辅助线 `#cccccc` / 悬停底 `#f9f9f9` |
| 分隔手段 | 一律 1px `border`（`border-black` 作主分隔、`border-[#cccccc]` 作次分隔），**禁止**用底色块或阴影分层 |
| 文本对齐 | 全部左对齐；**数字列右对齐**（表格唯一例外，用 `text-right`+`tabular-nums`，属表格语义而非「居中」） |
| 动效 | `duration-150 ease-out`，悬停只改色；侧栏激活态用「常驻 2px 透明下边框 → 激活变红」（照抄 `Layout.vue` 的抖动规避手法） |
| 留白 | 内容区 `px-6 md:px-12 py-12 md:py-16`；区块之间用 `mb-12` 级间距而非分隔线 |
| 字体层级 | 页标题 `text-2xl font-bold uppercase tracking-tight`；区块标签沿用 `.swiss-meta`；表格正文 `text-sm` |
| **反面清单** | 不做侧栏图标按钮、不做彩色状态胶囊（状态用**文字 + 左侧 4px 色条/黑底反白**表达）、不做悬浮卡片、不做面包屑阴影 |

> 关键点：后台**不引入新的颜色**。`draft / published / offline` 三态**不用**黄/绿/灰胶囊，
> 而是「黑底白字（已上线）/ 黑框白底（草稿）/ 灰字 + 删除线（已下线）」这类**同色系对比**表达，
> 保证后台看起来仍然属于 FNAF FAN GAMES ARCHIVE，而不是通用 SaaS 模板。

### 7.3 视觉哨兵

`AdminLayout` 在 `import.meta.env.DEV` 下挂载 `StyleAuditBadge`，
让后台的圆角/阴影违规在开发期就能被运行时抓到（生产构建自动剔除）。

---

## 8. `/admin/games` 信息架构（Phase 2 蓝图）

### 8.1 区块顺序

```
① 页头
   游戏管理                                        [ + 新增游戏 → ]
   管理本站收录的所有游戏资源。

② 状态统计（同色系对比，不用彩色胶囊）
   全部 6 · 已上线 6 · 草稿 0 · 已下线 0          ← 点击即切换状态筛选

③ 工具栏（一行，可换行）
   [ 搜索：标题/作者/系列/引擎… ]  [ 状态 ▾ ] [ 作者 ▾ ] [ 标签 ▾ ] [ 排序 ▾ ]

④ 批量操作条（仅在有勾选时替换 ③ 的位置）
   已选择 4 项   [上线] [下线] [添加标签] [移除标签] [归档] [取消选择]

⑤ 数据表格（12 列网格衍生）
   □ | 封面 | 游戏名称 | 作者 | 系列 | 标签 | 状态 | 更新时间 | 操作
   ▸ 表头 □ 支持全选 + 半选态（indeterminate = 已选部分当前页）
   ▸ 行操作：编辑 / 预览

⑥ 分页（沿用首页的分页组件写法）
   第 1 / 1 页 · 每页 20 条                       [ ← 上一页 ] [ 下一页 → ]
```

### 8.2 勾选语义冻结

| 行为 | 定义 |
| --- | --- |
| 表头复选框 | 全选**当前页可见行**（不是全库、不是全部筛选结果） |
| 半选态 | 当前页有部分行被选中 → `indeterminate` |
| 跨页保持 | 翻页**不清空**已选（与 Bilibili 一致），但计数始终显示真实选中数 |
| 危险操作 | `删除` 必须二次确认（弹确认层，含受影响条目清单）；`归档` 不需要二次确认 |
| 批量执行后 | 保留筛选条件与页码，清空勾选，顶部给出结果提示条（成功/失败条数） |

### 8.3 与深模块的边界

```ts
// composables/useAdminGames.ts —— Phase 2 的对外接口（先冻结，后实现）
useAdminGames(): {
  // 状态
  games: Ref<AdminGame[]>          // 筛选 + 排序 + 分页后
  filtered: Ref<AdminGame[]>       // 未分页的完整结果
  total: Ref<number>
  totalPages: Ref<number>
  currentPage: Ref<number>
  isLoading: Ref<boolean>

  // 元数据 / 统计
  statusCounts: Ref<Record<'all' | GameStatus, number>>
  availableAuthors: Ref<string[]>
  availableTags: Ref<string[]>
  allTags: Ref<{ name: string; usage: number }[]>   // 供 Phase 6 标签页复用

  // 查询状态
  activeQuery: Ref<AdminGameQuery>
  hasActiveQuery: Ref<boolean>

  // 查询操作
  setSearchQuery(q: string): void
  setStatusFilter(s: GameStatus | 'all'): void
  setAuthorFilter(a: string | null): void
  setTagFilter(t: string | null): void
  setSortBy(k: AdminSortKey): void
  setPage(p: number): void
  setPageSize(n: number): void
  clearQuery(): void

  // 勾选
  selectedIds: Ref<string[]>
  selectedCount: Ref<number>
  isSelected(id: string): boolean
  toggleSelect(id: string): void
  toggleSelectAllOnPage(): void
  clearSelection(): void

  // 写入（Phase 4 起接线到 Repository）
  getGameById(id: string): AdminGame | undefined
  batchSetStatus(ids: string[], status: GameStatus): Promise<void>
  batchAddTags(ids: string[], tags: string[]): Promise<void>
  batchRemoveTags(ids: string[], tags: string[]): Promise<void>
  saveGame(input: GameDraft, id?: string): Promise<AdminGame>
  deleteGame(id: string): Promise<void>
}
```

`AdminSortKey`：`'updatedAt' | 'createdAt' | 'title' | 'releaseYear' | 'sortOrder' | 'views' | 'score'`（默认 `'updatedAt'` 降序）。

**铁律不变**：`views/admin/*.vue` 只调这些方法 + 遍历 `games`，不写 `.filter()` / `.sort()`。

---

## 9. 文件结构规划（按阶段增量落地）

```
src/
├── components/
│   ├── (现有 7 个公开组件，原地不动)
│   └── admin/                      ← Phase 1 起新增
│       ├── AdminNav.vue            ← Phase 1
│       ├── AdminStatusTag.vue      ← Phase 2（状态标记，同色系对比）
│       ├── AdminToolbar.vue        ← Phase 2（搜索/筛选/排序）
│       ├── AdminBatchBar.vue       ← Phase 3
│       ├── AdminGameTable.vue      ← Phase 2
│       ├── AdminFieldInput.vue     ← Phase 4（表单原子件）
│       ├── AdminTagEditor.vue      ← Phase 6
│       ├── AdminImageSlot.vue      ← Phase 7
│       └── AdminDownloadEditor.vue ← Phase 8
├── composables/
│   ├── useGameLibrary.ts           （前台，不动）
│   ├── useViewCounter.ts           （不动）
│   ├── useAdminGames.ts            ← Phase 2
│   ├── useAdminTags.ts             ← Phase 6
│   └── useAuth.ts                  ← Phase 15
├── layouts/
│   ├── Layout.vue                  （不动）
│   └── AdminLayout.vue             ← Phase 1
├── repositories/                   ← Phase 11 目录；Phase 2 只由 useAdminGames 内部单行对接
│   ├── gameRepository.ts           （接口 + GameRepository 契约）
│   ├── localGameRepository.ts      ← Phase 12
│   └── remoteGameRepository.ts     ← Phase 13+
├── services/
│   ├── viewCounter.ts              （不动）
│   ├── auth.ts                     ← Phase 15
│   └── storage.ts                  ← Phase 16
├── types/
│   ├── game.ts                     （Phase 4 增量 +9 可选字段 + GameStatus）
│   ├── tag.ts                      ← Phase 6
│   └── admin.ts                    ← Phase 2（AdminGameQuery / AdminSortKey / GameDraft）
├── utils/
│   ├── asset.ts                    （不动）
│   ├── clipboard.ts                （不动）
│   └── gameDefaults.ts             ← Phase 4（normalizeGame / normalizeGames）
├── dev/
│   ├── libraryAssertions.ts        （Phase 10 才动）
│   └── adminAssertions.ts          ← Phase 2
├── views/
│   ├── (现有 5 个公开视图，原地不动)
│   └── admin/                      ← Phase 1 起新增
│       ├── AdminGames.vue          ← Phase 1 占位 / Phase 2 实体
│       ├── AdminGameEditor.vue     ← Phase 4
│       ├── AdminTags.vue           ← Phase 6
│       ├── AdminAuthors.vue        ← 延伸
│       └── AdminSettings.vue       ← 最后
└── router/
    └── routes.ts                   ← Phase 1 起按 §3.1 方案一改造
```

**明确不做**（计划书 §27）：复杂权限 / 多管理员 / 用户系统 / 评论后台 / 分析 Dashboard /
日志系统 / 全文搜索 / 推荐算法 / 图片 CDN / 审核流 / 邮件系统。

---

## 10. Phase 1 的改动预告（等你确认后执行）

| 类型 | 文件 | 说明 |
| --- | --- | --- |
| 修改 | `src/App.vue` | 收缩为 `<RouterView />`（**前台共享文件，需你批准**） |
| 修改 | `src/router/routes.ts` | 改为双 Layout 嵌套结构，公开站 URL 不变、视觉零变化 |
| 修改 | `src/layouts/Layout.vue` | **一行**：`<slot />` → `<RouterView />`（升级为路由组件的必然结果） |
| 新增 | `src/layouts/AdminLayout.vue` | 后台骨架（§7） |
| 新增 | `src/components/admin/AdminNav.vue` | 侧栏/顶部导航 |
| 新增 | `src/views/admin/AdminGames.vue` | 静态占位页（页头 + 空列表区，**无数据逻辑**） |
| 新增 | `src/views/admin/AdminNotFound.vue` | 后台 404 兜底（防止输错的后台地址掉回公开站外壳） |
| 修改 | `scripts/smoke.ts` | `CASES` 增加 `shell` 维度 + 反向串台断言 + 3 条后台用例 |
| **不改** | `db.json` / `useGameLibrary.ts` / `tailwind.config.js` / `styles/index.css` / 全部公开视图与公开组件 | — |

Phase 1 结束后**必须停下**，等你在浏览器里检查：

1. `/#/` 首页外观、筛选、分页与现在**完全一致**
2. `/#/game/tjoc-reborn` 详情页正常
3. `/#/admin/games` 后台骨架出现，**没有**公开站 Header/Footer
4. 后台无圆角 / 无阴影 / 无渐变；字体、颜色、边框符合 Swiss
5. 移动端（窄窗口）后台导航可用

---

## 11. 遗留风险与待你决策项

| # | 事项 | 我的建议 | 需要你 |
| --- | --- | --- | --- |
| 1 | Layout 分离方式 | 采**方案一**（嵌套路由） | ✅ 确认 |
| 2 | Phase 1 会改 `App.vue` + `routes.ts` 两个前台共享文件 | 视觉零变化（已逐字节核对，见 §3.1 更正），另需改 `Layout.vue` 一行 | ✅ 确认 |
| 3 | `components/` 是否现在就拆 `public/` + `admin/` | **暂不拆**，只新增 `components/admin/` | ✅ 确认 |
| 4 | 表格数字列右对齐 | 视作表格语义例外，不算违反「禁止居中/右对齐」 | ✅ 确认 |
| 5 | `status` 缺省值 | **`published`**（避免一次联动把前台清空） | ✅ 确认 |
| 6 | 后台导航显示未实现项 | 显示为禁用 + `PLANNED` 角标 | 知悉即可 |
| 7 | 前台是否暴露标签筛选 | Phase 6 之后再议，Phase 0 不定 | 留空 |

**Phase 0 到此为止。请审查以上内容。**

确认无误后回复「**继续**」，我再开始 Phase 1（Admin Layout）。
若对第 1–5 项有任何不同意见，请直接指出，我会先改设计再动代码。
