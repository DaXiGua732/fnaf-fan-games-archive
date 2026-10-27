# 测试与质量门禁

开发期间无法靠人工在浏览器里逐页验收，所以用自动化关卡替代。
`npm run verify` 必须全绿才允许提交；CI 部署前跑同一组检查。

## 1. 门禁一览

| 关卡 | 覆盖什么 | 抓不到什么 |
| --- | --- | --- |
| `typecheck` | 类型错误、拼错的属性名 | 运行时逻辑 |
| `test:gamejolt` | GameJolt 链接解析 / 富文本转换 / 图片选择 / 网络降级 / 扩展 ZIP 打包 | 真实接口改版（靠失败提示兜底） |
| `test:catalog` | 数据仓文档解析 / 序列化；未知顶层字段与 `taxonomy` 必须原样保留 | 真实 GitHub 并发（由 selftest 的 409 桩覆盖） |
| `test:data-quality` | `check:data --strict` 退出码语义：error 必须真的让门禁失败 | 真实生产数据内容（合成夹具） |
| `build:extension` | 扩展能否打包、manifest / 图标 / 依赖是否齐全 | 真实浏览器里的扩展行为 |
| `selftest` | 深模块行为 + 结构化字段 / 词表 / 关系 / 仓储契约 + 异常输入与原始 ID 安全 | 真实浏览器交互 |
| `check:data --strict` | 当前快照是否存在结构性数据 error（warning 不阻断） | `data:pull` 是否成功（由日志区分） |
| `test:ui:ci-launcher` | 端口被占用时不误连旧服务 | 真实浏览器（只验证启动器） |
| `test:ui:ci` | 真实 Chromium 点击：主题 / 筛选 / 后台编辑 / 批量 / 上传 / 催资源 / GameJolt 导入 / 关系 | 真实 GitHub / Supabase 写入（网络层桩） |
| `smoke` | 每条路由能否真实渲染出 DOM（**防白屏**） | 样式是否正确 |
| `build` | 生产构建能否通过、代码分割是否正常 | — |

```
npm run verify
# = typecheck + test:gamejolt + test:catalog + test:data-quality + build:extension
#   + selftest + check:data --strict + test:ui:ci-launcher + test:ui:ci + smoke + build
```

> 运行输出里的条数会随断言增长，以运行结果为准；**不要在文档里写死断言条数**。

## 2. `selftest`

断言集在 `src/dev/`，共八份：

| 文件 | 覆盖的深模块 |
| --- | --- |
| `libraryAssertions.ts` | 前台 `useGameLibrary`（搜索 / 交叉过滤 / 排序 / 分页） |
| `adminAssertions.ts` | 后台 `useAdminGames`（状态统计 / 筛选 / 排序 / 分页 / 勾选），启动时注入合成 fixture |
| `viewCounterAssertions.ts` | 浏览量适配器（请求形状 / 响应解析 / 非法 id / 降级；注入 fetch） |
| `themeAssertions.ts` | 模式解析、强调色白名单、主题清单稳定性（纯函数，不依赖 DOM） |
| `requestAssertions.ts` | 催资源标题归一化 / 精确匹配、本机仓储去重与每日上限、Supabase 请求形状与错误映射 |
| `filterUrlAssertions.ts` | 筛选 URL 的解析 / 序列化 / 签名 |
| `structuredDataAssertions.ts` | 新字段默认值 / 关系方向与校验 / 词表归一化与合并删除 / 两套仓储的原子写入、409 重放、未知字段保留 |
| `dataQualityAssertions.ts` | 资料质量检查：异常输入不崩溃且明确报告、只读性、字段契约与时间戳格式 |

同一支脚本还跑**静态守卫**（扫源码，失败即中断）：

- 只有仓储能读 `db.json`；后台视图不引具体仓储实现；只有 `repositories/index.ts` 实例化仓储
- 催资源仓储只能装配一次；Supabase SQL 的安全不变量（RLS / security definer / 不暴露身份列 /
  不出现 `service_role`）
- `.vue` 不写死 hex 颜色、不用固定 Tailwind 调色板
- 前端不出现 `service_role`
- `index.html` 与 `useTheme` 使用同一组 storage key

实现方式：`esbuild` 把 `scripts/selftest.mts` 打成 `.tmp/selftest.mjs`（`--external:vue`），
Node 直接跑。**不需要 vitest / jsdom**。

> ⚠️ **后台断言不依赖线上数据内容**：`runAdminAssertions` 先向本地仓储注入合成 fixture，
> 再跑状态统计 / 批量 / 标签 / 作者等断言。CI 在 `data:pull` 之后运行，站长随时可能删改真实条目。

> ⚠️ 催资源的 **SQL 本身没有自动化测试**：selftest 只验证客户端仓储与请求形状，
> 真实 RLS / RPC / PostgREST 行为必须按 [`INTEGRATIONS.md`](INTEGRATIONS.md) 实测。

## 3. `smoke`

`scripts/smoke.ts` 用 `vue/server-renderer` 在 Node 里把整棵组件树（含 Layout 骨架）
对每条路由真实渲染一遍，再断言页面里的关键内容。

**为什么不用 jsdom**：jsdom 无法执行 ES module bundle；SSR 同样会跑每个组件的 `setup()`
与模板，足以捕获绝大多数运行时错误。

配置在 `vite.smoke.config.ts`，与生产构建分离：`publicDir: false`、`emptyOutDir: false`、
`inlineDynamicImports: true`（产物恒为单个 `smoke.js`）。

- `useGameLibrary` 在模块加载时开始 160ms 模拟延迟，SSR 首帧 `isLoading` 为 `true`；
  脚本在渲染循环前 `await sleep(400)`。
- 后台的 `useAdminGames` 没有模拟延迟，首帧就是终态。
- `SmokeCase` 带 `shell: 'public' | 'admin'`：`SHELL_MARKERS` 断言该有的外壳标记，
  `SHELL_FORBIDDEN` **反向断言不出现另一套外壳的标记**。新增路由务必挂对 `shell`。
- 后台用例必须 `token: true`，否则测的是登录页而不是目标页。

## 4. UI 点击测试

`npm run smoke` 只验证「路由能渲染出 DOM」，验证不了「点下去会发生什么」。
勾选、批量执行、二次确认、保存、未保存拦截、标签增删、主题持久化、催资源提交 ——
这些只能靠真实浏览器点。

脚本 `scripts/ui-test.mjs`（已纳入版本管理），`playwright` 在 `devDependencies`。
默认 Playwright Chromium；首次运行：

```bash
npx playwright install chromium
```

**PowerShell**

```powershell
npm run test:ui:ci              # A. runner 自动启动 / 清理 Vite（verify 与 CI 用这条）
npm run dev                     # B. 终端 1：复用已有 dev server
npm run test:ui                 #    终端 2

$env:UI_BROWSER = 'chrome'      # 可选：用系统 Chrome
npm run test:ui

$env:BASE = 'http://localhost:4173/fnaf-fan-games-archive'
$env:PROD = '1'                 # 对生产构建预览（先 build + preview）
npm run test:ui
```

**Bash**

```bash
npm run test:ui:ci
npm run dev & npm run test:ui
UI_BROWSER=chrome npm run test:ui
BASE=http://localhost:4173/fnaf-fan-games-archive PROD=1 npm run test:ui
```

`test:ui:ci` 由 `scripts/run-ui-test-ci.mjs` 固定启动 `127.0.0.1:5173` 的 Vite（strictPort），
**只认本次子进程 stdout 的 ready 信号**（不把端口 HTTP 200 当就绪），结束后清理；
`test:ui:ci-launcher` 专门回归端口占用时不得误连旧服务。
失败时 CI 上传 `.tmp/ui-shots/` 与 `.tmp/ui-ci-vite.log`。

- GameJolt 导入两步都在 Playwright 层 mock / 构造夹具：助手与 CDN 响应被路由拦下，
  ZIP 导入用 `fflate` 现场生成真实压缩包。**不依赖外网**，也不向真实数据仓上传图片。
- 催资源 UI 用例开头断言首页显示「本机模式」。`test:ui:ci` 会自动清空 `VITE_SUPABASE_*`；
  手工启动 dev server 时不要配置它们，否则测试会在写入前失败（避免探针数据进真实榜单）。
- 远程 Supabase 路径**不连真实项目**，由 selftest 的注入 fetch 覆盖。
- 扩展本身的端到端流程（同源抓取 → 下载图片 → 打包 ZIP）用 `npm run test:extension` 单独跑，
  需要系统 Chrome，**不进 verify / CI**。

### UI 测试的三个坑

1. **脚本必须自己定位项目根目录**（`import.meta.url`），不要依赖 cwd ——
   从 `scripts/` 或仓库根启动时，读 `db.json` 与写截图的相对路径基准不同。
2. **`innerText` 会反映 CSS 的 `text-transform`**：卡片标题与 `.swiss-meta` 都是 `uppercase`，
   文本断言必须大小写不敏感。（`smoke.ts` 断言原始 HTML，不受此影响。）
3. **状态 chip 的可访问名包含使用次数**（如「草稿 0」）：`getByRole(..., { exact: true })`
   匹配不到，要用 `^前缀` 正则。
4. `GameCard` 的链接是**包在 `<article>` 外面**的（`RouterLink > Card > article`），
   选择器是 `a article`。

## 5. 断言规则（最容易写错的部分）

### 不得编码数据内容

后台的意义就是让人随时改数据，所以断言不该编码具体内容，否则「管理员改了一条作品」=
「测试挂了」。真实踩过的例子：

| 写死的断言 | 后果 |
| --- | --- |
| `expect title === "Dayshift at Freddy's"` | 站长改标题 → 3 条排序断言 + 1 条冒烟用例假失败 |
| `expect gallery === '/images/a.svg,/images/b.svg'` | 数据换源成数据仓绝对地址 → 假失败 |

**改为断言规则**：首位应是**当前列表里标题最小的那一个**（用同一份数据自行推导）；
图片地址只校验**末段文件名**（兼容站内路径与绝对外链）；冒烟需要「页面确实列出了作品」时，
从 `src/data/db.json` 里取一个真实标题。

判断标准：**同一份代码在别人改过数据之后还成立吗？**

### SSR 断言的转义与时区

- Vue SSR 会把 `& < > " '` 转义成 HTML 实体（`Dayshift at Freddy's` → `Dayshift at Freddy&#39;s`），
  `expect` 里不要放需要转义的字符。
- 不要断言依赖运行时环境的渲染结果：时间戳列按查看者本地时区渲染，
  `new Date()` / `toLocaleString()` / `Intl` 同理 —— 只断言列存在。
  标准：**同一个字符串在不同机器上会不会不一样？会，就别写进断言。**

### 状态累积

- UI 测试开头必须 `localStorage.clear()`（改动跨运行累积）。
- 后台用例靠 `page.route` 拦 GitHub API 才有数据；**真令牌不进测试脚本**。
  预览会开新标签页，所以拦截要挂 `context.route`。
- 图片测试夹具：在浏览器里用 canvas 生成**指定尺寸的真实 PNG**（理由见 [`PITFALLS.md`](PITFALLS.md)）。

## 6. 覆盖对照（后台）

计划书 §21 / §22 的逐项对照（`selftest` = 纯函数与深模块断言，`UI` = 真实浏览器点击）：

| 要求 | selftest | UI |
| --- | --- | --- |
| 列表：搜索 / 筛选 / 排序 / 分页 / 全选 | ✅ | ✅ |
| 列表：行内上线 / 下线 / 永久删除 | ✅ | ✅ |
| 批量：上下线 / 加删标签 / 改作者 | ✅ | ✅ |
| 标签与作者：搜索 / 重命名 / 合并 | ✅ | ✅ |
| 编辑：新建 / 修改 / 取消 / 保存 / 发布 / 未保存拦截 | ✅ | ✅ |
| `Ctrl/Cmd + S` 保存、预览、状态三态联动 | — | ✅ |
| 图片：上传 / 替换 / 尺寸不合格 / 重试 / 排序 / 压缩 / 删除 | ✅ | ✅ |
| 下载：增删改 / 错误 URL / 空提取码 | ✅ | ✅ |
| 作品永久删除、截图灯箱 | — | ✅ |
| 登录门禁 / 无效令牌 / 数据源三态 / 操作署名 | ✅ | ✅ |
| 公开站产物逐字节回归 | — | 手动（基线属一次性临时产物） |

**前台回归的执行方式**：Phase 19 收尾时把公开站产物与基线逐字节对比，任何变化都必须解释清楚
（数据变化 / 代码变化）；首页仅剩卡片顺序差异时，用「与顺序无关的多重集比较」证明可见文本一致。

## 7. 视觉哨兵

`src/components/StyleAuditBadge.vue` 在运行时全量扫描 DOM，比对 `border-radius` 与
`box-shadow`，页面顶部显示 PASS / FAIL + 违规元素列表（挂在 `AdminLayout`）。
公开站的视觉红线由 Tailwind 覆盖配置、全局重置与 UI 测试的视觉哨兵共同保证。
