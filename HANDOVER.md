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

## 2. 当前状态快照（2026-10-24）

| 项 | 状态 |
| --- | --- |
| 计划书 20 个阶段 | ✅ **全部完成**（0–20，Phase 20 测试由贯穿全程的门禁体系覆盖） |
| 线上部署 | ✅ 已部署并用真实浏览器验证；**数据仓的改动不会自动触发构建**，现由每小时定时构建兜底 |
| 后台能力 | ✅ 增删改查 / 批量 / 标签与作者合并管理 / 图片上传（自动 WebP 压缩）/ 预览 / 永久删除 / 操作署名 / **GameJolt 扩展 ZIP 导入 + 本机助手备用** |
| 交互层 | ✅ 编辑器吸顶操作条 + 分区锚点 + 发布概览 + Ctrl/Cmd+S；列表行内快捷上下线 / 永久删除；详情页截图灯箱 |
| 代码仓提交 | ✅ 已推送（最新提交见 `git log -1`；删除 / 压缩 / 构建兜底 / 断言去数据耦合 / UI 重构 / 一句话简介 / GameJolt 导入） |
| 测试基线 | ✅ typecheck + **test:gamejolt 22** + **build:extension** + **selftest 481** + **smoke 14** + **UI 点击 76 步** + build 全绿；扩展 E2E 另跑 |
| 已知缺口 | 浏览量仍是静态基数；数据仓未加其他协作者；评论区已按产品决策移除 |

> ⚠️ **断言已改成从数据推导期望值**：`selftest` 会在 `data:pull` 之后跑，
> 所以不允许再写死「6 款」「5 位作者」「封面一定是某个路径」。新增断言时先问一句：
> 「后台改一条正常的数据，这条断言会不会挂？」会挂就说明它编码了数据内容。

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

## 4. 运维速查

```bash
npm run dev            # 本地开发（读 src/data/db.json —— 可能是旧快照，见下）
npm run data:pull      # 从数据仓同步 db.json 到本地（部署前自动执行；本地开发需手动）
npm run verify         # 全部门禁：typecheck + test:gamejolt + build:extension + selftest + smoke + build
npm run test:ui        # 浏览器点击测试（先另开终端 npm run dev；需要系统 Chrome）
npm run test:gamejolt  # GameJolt 解析 / 网络层 / 扩展打包测试（22 项，不出网）
npm run build:extension # 构建扩展到 extension/dist（Chrome/Edge 加载已解压）
npm run test:extension # 扩展 E2E：同源抓取 → 图片 → ZIP 下载（需要系统 Chrome）
npm run gamejolt:helper # 本机助手（127.0.0.1:4317，开发备用；运维主路径是扩展 ZIP）
npm run smoke          # 只跑 SSR 冒烟（14 条路由）
npm run selftest       # 只跑断言集（481 项，含静态守卫）
```

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
| **不再提供评论区** | 产品决策：评论需要审核、滥用处理与独立的数据归属；没有这些能力时，一个空评论区只是在制造维护负担 | README §7.2 |
| **标签与作者合并为一个页面** | 两者都是由作品数据派生的分类维度；分成两页只会让管理员在两张几乎相同的表格之间来回切换 | README §后台路由 |
| **GameJolt 导入：扩展 ZIP 为主，本机助手为开发备用** | 扩展 content script 运行在 gamejolt.com 页面内，`/site-api` 是同源请求，运维不需要 Node / 终端；图片 CDN 开放跨域，可直接走现有上传链路。ZIP 是本地可审计的交换文件，后台仍负责归一化 / 校验 / 上传，扩展接触不到 GitHub 令牌。游戏资源与网盘链接是策展决定，自动化只做「信息搬运」 | README §7.3 |

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
11. 公开站产物做**逐字节回归**时，先构建一份快照再比对；Phase 19 用过的
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

## 8. 已知缺口与待办

| 项 | 说明 |
| --- | --- |
| 浏览量 | `viewCounter.ts` 是适配器 + 静态基数，**未接任何后端**。接真实服务只需实现 `ViewProvider` 并在 `main.ts` 注册 |
| 评论 | 已按产品决策移除：`CommentSection.vue`、`src/config/giscus.ts`、`public/giscus-swiss.css` 与全部相关文案/测试均已删除 |
| 多管理员 | 数据仓还没加协作者；加人命令见 `admin_phase13_persistence_decision.md` §15 |
| 数据更新延迟 | 公开页挂载 / 切回时自动同步（通常几秒）；断网时退回构建期快照，最长等 1 小时的定时构建刷新快照 |
| 图片处理 | 已做长边缩放 + WebP；**未做自动裁剪**（按比例留白是设计选择，不是缺陷） |
| GameJolt 导入 | 依赖对方**内部站内接口**（`/site-api/web/discover/games/<id>`），改版即可能失效；失败会显式报错，不会写入半条数据。导入只填草稿，不碰下载渠道，仍需人工点保存 |
| 扩展分发 | 目前是「加载已解压扩展」，更新要手动重载；要给非技术运维并自动更新，需把 `extension/dist/` 上架 Chrome Web Store / Edge Add-ons 的不公开条目 |

## 9. 质量门禁（改动之后必须全绿）

```
npm run verify
# = typecheck + test:gamejolt(22) + build:extension + selftest(481) + smoke(14) + build
```

- `test:gamejolt`：URL 解析 / 富文本 / 图片选型与尺寸升级 / 网络错误分支 / 扩展 ZIP 打包
  （`node --test`，夹具注入 fetch，不出网）
- `build:extension`：esbuild 把扩展 content script 打成 IIFE，产出 `extension/dist/`
- `selftest`：深模块断言 + **静态守卫**（扫源码的三条红线）+ 仓储/持久化/上传契约
- `smoke`：SSR 渲染 14 条路由（公开 4 + 后台 10），断言外壳分离与关键内容
- `UI 点击测试`（`scripts/ui-test.mjs`，**已纳入版本管理**，`npm run test:ui`）：
  76 步真实浏览器点击，覆盖计划书 §21 后台专项、§22 前台回归、GameJolt 助手导入与 ZIP 导入
  （助手/CDN 均 mock，ZIP 用 fflate 现场生成）
- `npm run test:extension`：扩展 E2E（同源抓取 → 下载图片 → 打包 ZIP），需要系统 Chrome，
  **不进 verify / CI**，改扩展代码时本地跑
- **公开站回归**：Phase 19 曾用逐字节基线；快照属 `.tmp/` 临时产物，不纳入版本管理，
  需要时重新构建一份即可

## 10. 新会话怎么开始

1. 读本文件 → 读 `README.md`（项目手册，最完整）
2. `npm run verify` 确认全绿，`npm run dev` 起本地；涉及交互行为时再跑 `npm run test:ui`，
   涉及扩展时跑 `npm run test:extension`
3. 有疑问先查 `README.md` 对应章节，再查 `.workbuddy/memory/MEMORY.md` 的踩坑记录
4. 改动之后：`npm run verify` 全绿 → 按阶段提交（**不要攒大批量**，见计划书 §23 的教训）
5. 涉及数据仓 / 部署的操作，先读 `admin_phase13_persistence_decision.md`
