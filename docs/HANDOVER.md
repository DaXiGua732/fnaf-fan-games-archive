# 交接文档

> **用途**：让一个新的上下文窗口（或新协作者）在 10 分钟内接手。
> 这是**地图**，不是百科 —— 细节在 `docs/` 里对应的文件。
>
> **阅读顺序**：本文件 → [`ARCHITECTURE.md`](ARCHITECTURE.md) → 需要改哪块再读对应文档
> → [`PITFALLS.md`](PITFALLS.md)（动手前扫一遍）。

## 1. 一句话

**FNAF 同人游戏资源站**：纯前端静态站（Vue 3 + Vite + Tailwind，GitHub Pages）+
一个**能真正改线上数据**的后台。数据与代码**分仓**，后台通过 GitHub API 读写数据仓。

- 线上：`https://daxigua732.github.io/fnaf-fan-games-archive/`
- 代码仓：`DaXiGua732/fnaf-fan-games-archive`（只有站长有写权限）
- 数据仓：`DaXiGua732/fnaf-fan-games-data`（`db.json` + `images/`）

## 2. 当前状态

| 项 | 状态 |
| --- | --- |
| 后台（计划书 Phase 0–20） | ✅ 全部完成并线上使用 |
| 结构化资料库（Phase 0–6） | ✅ 数据层、词表、前台索引、八组筛选、关系、只读质量检查 |
| 前台 | ✅ 主题系统（跟随系统 / 日间 / 夜间 + 6 种歌姬色 / 自定义取色）、催资源榜、截图灯箱、GameJolt 导入入口 |
| 后台能力 | ✅ CRUD / 批量 / 标签作者 / 词表 / 关系 / 图片上传（WebP）/ 预览 / 永久删除 / 署名 |
| 部署 | ✅ push `main` 即构建；数据仓提交不触发，公开页运行时同步 |
| 测试 | ✅ `npm run verify` 全绿（含真实浏览器 UI、严格资料检查、build）；条数以运行输出为准 |
| 文档 | 入口 README；细节 `docs/`；过程文档只在 git 历史里 |

**已知缺口**（详见 [`INTEGRATIONS.md`](INTEGRATIONS.md)）：

- 催资源 SQL **尚未在真实 Supabase 项目执行**；远程榜最多 50 条；本机模式数据不自动迁移；
  client id 不是反滥用。
- 浏览量依赖 Abacus 第三方且无防刷；列表「热度」排序仍用 `fakeViews`。
- 数据仓未加其他协作者。
- 扩展当前靠「加载已解压扩展」分发，更新需手动重载。
- 质量检查只报告，分类与关系仍需管理员按资料逐条录入。

## 3. 架构（一张图）

```
数据仓 db.json ──构建时 data:pull──▶ 构建期快照 ──▶ publicGameRepository ──▶ 公开站
       ▲                                              ▲
       │ 公开页挂载 / 重新可见时 fetch 最新 db.json ────┘
       │
后台（登录）：GitHubGameRepository ◀──读写 / 409 重放──▶ 数据仓 db.json
催资源（侧链路）：访客 ◀──▶ Supabase（未配置则本机 localStorage）

游戏目录始终以 GitHub 数据仓为唯一事实来源。
```

**前台是「快照兜底 + 非阻塞同步」**：首屏不等网络、断网可用；公开页挂载或标签页重新可见时
拉一次数据仓替换内存目录。**不要**改成阻塞式运行时查库 —— 那会赔掉首屏与离线能力。

详见 [`ARCHITECTURE.md`](ARCHITECTURE.md)、[`DATA.md`](DATA.md)。

## 4. 运维速查

```bash
npm install --ignore-scripts   # 必须（PITFALLS 第 1 条）
npm run dev                    # 本地开发（首屏读快照，可能是旧的）
npm run data:pull              # 从数据仓同步 db.json（部署前自动，本地需手动）
npm run verify                 # 全部门禁，改完必须全绿

npm run selftest               # 深模块断言 + 静态守卫
npm run smoke                  # SSR 逐路由冒烟
npm run test:ui                # 复用已启动的 dev server
npm run test:ui:ci             # 自动启动 / 清理 Vite（verify / CI 用）
npm run check:data             # 只读资料质量检查（--file / --json / --strict）
npm run test:extension         # 扩展 E2E（系统 Chrome，不进 CI）
npm run build:extension        # 产物到 extension/dist/
```

环境变量写法：PowerShell `$env:UI_BROWSER='chrome'` / `$env:BASE='...'` / `$env:PROD='1'`；
Bash `UI_BROWSER=chrome` / `BASE=... PROD=1`。

**催资源（可选 Supabase）**：SQL Editor 执行 `supabase/resource_requests.sql` →
根目录 `.env.local` 配 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` → 重启 dev / 重新 build →
报找不到函数时 `notify pgrst, 'reload schema';`。线上在 GitHub **Actions Variables** 配同样两项。
只使用 anon public key，`service_role` 绝不进前端。

- **回滚**：数据仓 / 代码仓都做 `git revert`（数据仓历史就是审计日志）。
- **数据更新上线时机**：公开页打开 / 切回自动同步（几秒）；断网退回快照，最长等 1 小时定时构建。

## 5. 关键决策与「为什么」

| 决策 | 为什么 | 详见 |
| --- | --- | --- |
| 两仓分离 | 「能改数据、碰不到代码」由仓库 / 令牌权限保证，不用自建服务 | [`ADMIN.md`](ADMIN.md) |
| 前台快照 + 运行时同步 | 首屏秒开、断网可用；后台改完不用等构建 | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| Repository 层 | 前后台只依赖接口；换存储 = 换实现 | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| 认证 = GitHub 细粒度 PAT | 权限边界由凭据本身保证，判断逻辑写错也漏不出去 | [`ADMIN.md`](ADMIN.md) |
| 审计不做独立文件 | git 历史就是审计日志（谁 / 改了什么 / 何时 / revert） | [`ADMIN.md`](ADMIN.md) |
| 写路径「读最新 → 重放 → 409 重试」 | `db.json` 是单文件，任意两人同时保存都会冲突；重放改的是字段而非文本 diff，永远正确 | [`ADMIN.md`](ADMIN.md) |
| 图片文件名带毫秒时间戳 | 换名即换地址，缓存自然失效；只到秒会撞名覆盖 | [`ADMIN.md`](ADMIN.md) |
| 预览复用 `GameDetail` | 另写「像前台」的副本迟早分叉，分叉后预览就在骗人 | [`ADMIN.md`](ADMIN.md) |
| 浏览量走 Abacus、不写数据仓 | 公开站没有安全的写入通道；计数易失，服务挂了回退静态基数 | [`INTEGRATIONS.md`](INTEGRATIONS.md) |
| 不提供评论区 | 评论需要审核、滥用处理与数据归属；没有这些能力只是维护负担 | [`INTEGRATIONS.md`](INTEGRATIONS.md) |
| 标签与作者合并一页 | 两者都是派生分类维度，分两页只让管理员来回切换 | [`ADMIN.md`](ADMIN.md) |
| GameJolt：扩展 ZIP 为主 | content script 同源、运维不需要 Node；ZIP 本地可审计，扩展碰不到令牌 | [`INTEGRATIONS.md`](INTEGRATIONS.md) |
| 主题只改颜色（CSS 变量） | 保留 Swiss 红线的前提下支持深浅色与强调色；组件不写死色值 | [`DESIGN.md`](DESIGN.md) |
| `white` / `black` 重映射 | 存量组件自动随主题反转；代价是强调 / 反色底要用 `on-accent` / `inverse-fg` | [`DESIGN.md`](DESIGN.md) |
| 催资源用 Supabase anon + RLS/RPC | 公开请求需跨访客共享，但游戏目录不能变成运行时依赖 | [`INTEGRATIONS.md`](INTEGRATIONS.md) |
| 「已收录」只认归一化标题完全相等 | 包含匹配会把《Jolly》误判成《Jolly 4》已收录，静默消失 | [`INTEGRATIONS.md`](INTEGRATIONS.md) |
| 请求数据不进 git | 匿名投票放进 GitHub 需要前端写权限或大量提交；代价是没有 git 审计 | [`INTEGRATIONS.md`](INTEGRATIONS.md) |

## 6. 铁律

**视觉**：零圆角、零阴影、零渐变、零居中、纯无衬线、动效 ≤ `duration-150` 且 hover 只改颜色、
留白优先。反向箭头用 `.u-arrow-back`。见 [`DESIGN.md`](DESIGN.md)。

**主题**：颜色只走语义 token（`ink` / `paper` / `line` / `surface` / `accent` / `accent-surface` /
`on-accent` / `inverse` / `inverse-fg` / `overlay`）；`.vue` 不写 hex、不用固定调色板（有守卫）。

**代码**

1. 后台 `.vue` 禁止 `import db.json`、禁止手写 `.filter()` / `.sort()` —— 一律走深模块。
2. 只有 `repositories/index.ts` 实例化仓储；只有 `localGameRepository.ts` 读 `db.json`。
3. 新数据字段**全部 optional**，`status` 缺省 `published`（否则一次联动会清空前台）。
4. 前台可见性判据 = `status === 'published' && !archived`，收敛在 `isPubliclyVisible()`。
5. 搜索框用 `useSearchField`，不要 `:value` + `@input`。
6. **断言不得编码数据内容** —— 断言规则，从数据推导期望值。
7. 后台渲染数据源内容前必须用 `dataOk` 做状态 / 内容二选一。
8. 催资源仓储只在 `repositories/index.ts` 实例化一次；标题归一化前端与 SQL 各一份，
   改一处必须同步另一处。

**测试**

9. UI 测试开头 `localStorage.clear()`。
10. 后台用例靠 `page.route` 拦 GitHub API（真令牌不进脚本）；预览开新标签页，拦截挂 `context.route`。
11. 图片夹具用 canvas 生成指定尺寸的真实 PNG（SVG 解不了，1×1 会被拦）。
12. 后台冒烟用例必须 `token: true`。

## 7. 质量门禁

```
npm run verify
# = typecheck + test:gamejolt + test:catalog + test:data-quality + build:extension
#   + selftest + check:data --strict + test:ui:ci-launcher + test:ui:ci + smoke + build
```

`check:data --strict` 只对 error 失败；它证明当前**快照**没有 error，不证明 `data:pull` 成功
（拉取失败仍用旧快照部署，是可用性取舍）。催资源 SQL / 真实 Supabase 行为**不在门禁内**。
详见 [`TESTING.md`](TESTING.md)。

## 8. 新会话怎么开始

1. 读本文件 → [`ARCHITECTURE.md`](ARCHITECTURE.md) → 需要改的部分对应文档。
2. `npm run verify` 确认全绿；日常开发 `npm run dev`，涉及交互跑 `npm run test:ui` /
   `npm run test:ui:ci`；改扩展跑 `npm run test:extension`。
3. 动手前扫 [`PITFALLS.md`](PITFALLS.md)。
4. 改主题先读 [`DESIGN.md`](DESIGN.md) 与 `src/styles/index.css`；
   改催资源先读 [`INTEGRATIONS.md`](INTEGRATIONS.md)、`supabase/resource_requests.sql`
   与 `src/config/requests.ts`。
5. 改完 `npm run verify` 全绿 → 按阶段提交（**不要攒大批量**）。
6. 涉及部署先读 [`DEPLOYMENT.md`](DEPLOYMENT.md)；涉及 Supabase 先确认 SQL 已执行、
   Actions Variables 已配置。
