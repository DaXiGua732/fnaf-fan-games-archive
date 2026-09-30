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

## 2. 当前状态快照（2026-09-30）

| 项 | 状态 |
| --- | --- |
| 计划书 20 个阶段 | ✅ **全部完成**（0–19，Phase 20 测试由贯穿全程的门禁体系覆盖） |
| 线上部署 | ✅ 已部署并**用真实浏览器验证通过**（前台数据渲染 + 后台门禁生效） |
| 代码仓提交 | ✅ `f1e7b0d`（后台 Phase 1–19，62 files / +13701）+ `9053f82`（API 应用的断言修复） |
| **⚠️ 本地与远端分叉** | **待收敛**：本地多 2 个提交（`690d0ee` docs + `fb23d2d` fix），远端多 1 个内容相同的 API 提交。**在用户自己的终端执行**：`git pull --rebase origin main && git push origin main` |
| 已知缺口 | 图库内「删除 / 排序」的 **UI 层**断言（组件已实现）；本地仓的写入路径在生产上不可达（见 §7） |

## 3. 架构：数据流（最核心的一张图）

```
                    ┌─ 前台（访客）───────────────────────────────────┐
数据仓 db.json ──构建时同步──▶ publicGameRepository（本地仓，只读快照）
                    └────────────────────────────────────────────────┘
                    ┌─ 后台（登录的管理员）───────────────────────────┐
数据仓 db.json ◀────读写────▶ adminGameRepository = GitHubGameRepository
                    └────────────────────────────────────────────────┘
```

**两边读的不是同一份数据，这是刻意的**（前台要秒开/离线可用，后台要改线上数据）。
代价：后台改完，前台要等**下一次重新构建**（约 1 分钟）—— 已把这条语义钉进 UI 断言。
**绝不要**为了"立刻生效"把前台改成运行时查库。

详见 `README.md` §「前后台的数据源」与 §「数据同步」。

## 4. 运维速查

```bash
npm run dev            # 本地开发（读 src/data/db.json —— 可能是旧快照，见下）
npm run data:pull      # 从数据仓同步 db.json 到本地（部署前自动执行；本地开发需手动）
npm run verify         # 全部门禁：typecheck + selftest + smoke + build（提交/推送前必跑）
npm run smoke          # 只跑 SSR 冒烟（16 条路由）
npm run selftest       # 只跑断言集（433 项，含静态守卫）
```

- **部署**：推 `main` 即自动构建发布（`.github/workflows/deploy.yml`，构建前自动 `data:pull`）
- **回滚**：对数据仓做 `git revert`（数据仓历史就是完整审计日志）；代码回滚同理

## 5. 关键设计决策与"为什么"（每条都在 README 有详细章节）

| 决策 | 为什么 | 详见 |
| --- | --- | --- |
| **两仓分离** | 让管理员「能改数据、碰不到代码」—— 权限边界由 GitHub 仓库权限天然给出，不用自建服务 | README §0.1；决策书 §12 |
| **前台保持静态**（不运行时查库） | 秒开、断网可用、无第三方运行时依赖。后台改完要等重新构建，这是静态站的固有性质 | README §4.1 |
| **Repository 层**（本地 + 远程两个实现） | 前后台只依赖接口；换存储 = 换实现，深模块与组件零改动 | README §2.x |
| **认证 = GitHub 细粒度令牌**（只授权数据仓 + Contents 读写） | 「能改数据、碰不到代码」由**凭据权限本身**保证，不靠我们写的判断 | README §后台认证 |
| **审计不做独立文件** | **git 历史就是完整审计日志**（谁/改了什么/何时/revert），再维护一份是冗余 | README §操作署名 |
| **写路径必须「读最新 → 重放 → 409 重试」** | `db.json` 是**单个文件**，任意两人同时保存都会冲突；敢直接重试是因为重放**永远正确**（改的是字段，不是文本 diff） | README §后台的写入落在哪里 |
| **图片文件名带时间戳** | 图片会被浏览器/CDN 缓存；换名即换地址，缓存自然失效 | README §图片上传 |
| **预览复用 `GameDetail` 本身**（注入草稿） | 另写一个"像前台"的预览页迟早分叉，分叉后预览就在骗人 | README §预览功能 |

## 6. 改动前必读的铁律

**视觉（Swiss International Style，违反即严重 Bug）**：零圆角、零阴影、零渐变、
零居中、纯无衬线、动效上限 `duration-150` 且 hover 只改颜色、留白优先。
反向箭头必须用 `.u-arrow-back`（详见 README 视觉规范章节）。

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

**测试**：

8. UI 测试开头必须 `localStorage.clear()`（改动会跨运行累积）
9. 后台用例靠 `page.route` 拦 GitHub API 才有数据（**真令牌不进测试脚本**）；
   拦截要挂 `context.route`（预览会开新标签页）
10. 图片测试夹具：用 canvas 在浏览器里生成**指定尺寸的真实 PNG** ——
    SVG 喂给 `createImageBitmap` 会失败，1×1 PNG 会被尺寸校验拦下
11. 公开站产物有**逐字节基线**（`.tmp/public-baseline`）：任何变化都必须解释清楚
    （数据变化 or 代码变化），标准做法见 README §测试覆盖对照

## 7. 踩坑清单（全部踩过，别再踩）

按"再踩一次的代价"排序，完整版见 `.workbuddy/memory/MEMORY.md`：

1. **CI 上的 selftest 用的是「数据仓里被编辑过的数据」**（deploy 会先 `data:pull`）——
   本地全绿 ≠ CI 全绿。凡是**前提隐含在数据里**的断言都会假失败
2. **sessionStorage 不跟着 `window.open` 的新标签页走**（预览页拿到 null）——
   跨标签页传数据用 **localStorage**，且**读完即清**
3. **`git push` 在这个环境推不了**（沙箱代理 502；清掉代理又直连超时）——
   推送要用户在自己终端做；**小改动可用 Contents API 应用到远端**（带 sha 乐观锁），
   但会产生分叉，之后 `git pull --rebase` 收敛
4. **守卫不能从 `router/index.ts` 导出**（它创建带 hash history 的 router，Node 里没有
   `location`）—— 单独放 `src/router/authGuard.ts`
5. **新冒烟用例（后台）必须 `token: true`** —— 漏了测的是登录页而非目标页
6. **`createImageBitmap` 解不了 SVG blob**；1×1 PNG 会被尺寸校验拦下 —— 图片夹具用 canvas 生成
7. **`btoa` 只吃 latin1**，中文要先编 UTF-8 字节（`encodeBase64`，已抽出来共用）
8. **CRLF 行尾**：Python 的文本替换匹配不上时，先怀疑行尾；按行处理最稳
9. **Vite 清空 dist 触发批量删除守卫** → 先 `git clean -fdxq dist` 再 `npm run build`
10. **懒加载图片的检查要给足等待**，并用 `complete` 区分「仍在加载」与「真裂图」
    （407KB 的图 2.5s 不够）

## 8. 已知缺口与待办

| 项 | 说明 |
| --- | --- |
| 图库内「删除 / 排序」的 UI 断言 | 组件已实现（`AdminGalleryEditor`），缺 UI 层用例 |
| 本地仓的写入路径在生产不可达 | 未登录进不了后台 → `publicGameRepository` 实际只承担前台只读。其写入 / 存档 / 重置能力暂留（断言覆盖着），Phase 19/20 曾标记可清理 |
| 「删除游戏」未提供 | 数据会孤儿化其图片；当前 UI 刻意不暴露删除（下线用 `unpublishGame`） |
| 图片的 WebP 转换 / 尺寸检查自动裁剪 | 计划书 Phase 17 建议项，按"无实际需求不引入复杂处理"暂缓 |
| 多管理员 | 数据仓还没加协作者；加人命令见 `admin_phase13_persistence_decision.md` §15 |

## 9. 质量门禁（改动之后必须全绿）

```
npm run verify
# = typecheck + selftest(433) + smoke(16) + build
```

- `selftest`：深模块断言 + **静态守卫**（扫源码的三条红线）+ 仓储/持久化/上传契约
- `smoke`：SSR 渲染 16 条路由（公开 6 + 后台 10），断言外壳分离与关键内容
- `UI 点击测试`（`.tmp/ui-test.mjs`，非版本管理）：68 步真实浏览器点击，
  覆盖计划书 §21 后台专项与 §22 前台回归
- **公开站逐字节基线**（`.tmp/public-baseline`）：公开站产物有任何变化都必须解释

## 10. 新会话怎么开始

1. 读本文件 → 读 `README.md`（项目手册，最完整）
2. `npm run verify` 确认全绿，`npm run dev` 起本地
3. 有疑问先查 `README.md` 对应章节，再查 `.workbuddy/memory/MEMORY.md` 的踩坑记录
4. 改动之后：`npm run verify` 全绿 → 按阶段提交（**不要攒大批量**，见计划书 §23 的教训）
5. 涉及数据仓 / 部署的操作，先读 `admin_phase13_persistence_decision.md`
