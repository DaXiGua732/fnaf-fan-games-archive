# 踩坑清单

全部实际踩过。按「再踩一次的代价」排序，分环境 / 构建 / 运行时 / 数据四类。

## 环境与工具链

1. **Windows 下 `npm install` 必须加 `--ignore-scripts`。**
   esbuild 的 postinstall 会 spawn `node.exe` 校验版本，在本环境报 **EBUSY**；失败回滚后
   `@esbuild/win32-x64`、`@rollup/rollup-win32-x64-msvc` 不会装入 `node_modules`，
   `package-lock.json` 也不记录，导致 `vite build` 直接崩。
   已把四个平台包显式写进 `optionalDependencies`（Windows + Linux 各一对），安装一律 `--ignore-scripts`。

2. **沙箱有批量删除保护**：单轮次删除超过 50 个文件会被拦截
   （`SAFE_DELETE_BULK_CONFIRM_REQUIRED`）。`vite build` 清 `dist/`（约 20 个文件）正常；
   smoke 已用 `emptyOutDir: false` 避免累计超限。
   **需要清空临时目录时不要 `rm -rf`，换个新目录名**（`.tmp/exp2`、`.tmp/exp3`），
   `.tmp/` 已被 gitignore。

3. **Vite 浏览器 target 不含 top-level await**：`scripts/` 下的脚本用 TLA 会被 esbuild 拒绝
   （`Top-level await is not available in the configured target environment`）。
   包进 `async function main()`。

4. **`--emptyOutDir` 关不掉**：`outDir` 位于项目根内时默认为 true，要关必须在配置文件里
   显式写 `emptyOutDir: false`。

5. **默认沙箱里 `git push` 连不上 `github.com:443`**（只放行 `api.github.com`）——
   在允许网络的环境重试即可；仍失败时用 API 发布（见 [`DEPLOYMENT.md`](DEPLOYMENT.md)）。

6. **`gh` / API 提交后本地 SHA 对不上**：GitHub 存的是 `+0800` 时区，且提交消息结尾无换行。
   见 [`DEPLOYMENT.md`](DEPLOYMENT.md) 的「让本地与远程 SHA 一致」。

7. **GitHub 不能删除默认分支**（`Cannot delete the default branch` 422）。

## 构建

8. **Tailwind 内容提取器会扫描注释**：源码注释里出现 "box-shadow" 一词曾被拆出 `shadow`
   候选，命中 `theme.boxShadow.DEFAULT`，意外生成 `.shadow{...}`。
   已解决：`borderRadius` / `boxShadow` / `backgroundImage` / `fontFamily` 四个 theme key
   **一律不留 `DEFAULT`**。审计脚本要连裸 `.shadow` 一起查。

9. **Vue 模板注释必须 `<!-- -->` 闭合**。把结尾写成 `*/` 会把后面的 `<td>` / 组件吞进注释，
   表现为「这一列凭空消失」，而类型检查、构建、SSR 冒烟**全部通过**（它确实是合法注释），
   只有 UI 点击测试或真实浏览器能抓到。

10. **`structuredClone` 不能复制 Vue 响应式代理**：仓储 `hydrate()` 传 `listGames()` 的响应式
    条目会抛 `DataCloneError`。数据本来就是 JSON，用 `JSON.parse(JSON.stringify(...))`。

11. **扩展的 content script 必须打包成 IIFE**：`content_scripts` 不支持 `"type": "module"`，
    直接写 `import` 会在页面里报语法错误。加载的是 `extension/dist/`，不是 `extension/src/`。
    同源抓取只成立在 content script（popup / background 是扩展自己的 origin）。

## 运行时行为

12. **涉及浏览器权限类 API 必须有降级路径**：提取码复制曾「点击无反应」——
    `navigator.clipboard.writeText` 需要安全上下文（iframe 内还需外层授权），
    而 `catch` 静默失败，导致失败与「没点到」无法区分。
    `src/utils/clipboard.ts` 的 `copyText()` 提供两级回退（Clipboard API → 临时 textarea +
    `execCommand`），返回 `boolean`，**强制调用方给出可见反馈**。
    > 通用原则：任何用户触发的异步操作，失败路径都必须有可见反馈。

13. **`sessionStorage` 不跟着 `window.open` 的新标签页走**（预览页拿到 null）。
    跨标签页传数据用 **localStorage**，且**读完即清**。

14. **受控输入回写会重置光标**：`:value` + `@input` 在框架把模型值回写 DOM 时，
    反向选中后打字会变成倒序。搜索框一律走 `useSearchField`（本地 ref 驱动 `v-model`，
    打字过程中不存在回写）。

15. **`innerText` 会反映 CSS `text-transform`**：卡片标题与 `.swiss-meta` 都是 `uppercase`。
    UI 测试的文本断言必须大小写不敏感（smoke 断言原始 HTML，不受影响）。

16. **状态 chip 的可访问名包含使用次数**（如「草稿 0」）：
    `getByRole(..., { exact: true })` 匹配不到，用 `^前缀` 正则。

17. **`createImageBitmap` 解不了 SVG blob**（Chrome 里会走「读不出尺寸」分支）；
    手写的 1×1 PNG 会被尺寸校验拦下。图片夹具要在浏览器里用 canvas 生成**指定尺寸的真实 PNG**。

18. **懒加载图片的检查要给足等待**，并用 `image.complete` 区分「仍在加载」与「真裂图」
    （407 KB 的图 2.5s 不够）。

19. **时间戳列按查看者本地时区渲染**：不要在 SSR 断言里写具体时间字符串。

20. **Abacus `/hit` 是 GET**：被浏览器 / CDN 缓存一次就少计一次浏览。
    provider 同时用 `cache: 'no-store'` 与时间戳兜底，别删这两道防线。

21. **主题 storage key 有两个读者**：`index.html` 的防闪白内联脚本与 `useTheme.ts`
    （模式 / 强调色 id / 自定义色三个 key）。改 key 必须同时改两处；
    `selftest` 有静态守卫比对。
    强调色 id 有三处读者（`useTheme.ts` 的联合类型 / `index.html` 的白名单 /
    `src/styles/index.css` 的 `[data-theme]` 选择器），增删歌姬必须三处一起改，
    否则会出现「选了没反应」或「属性正确但颜色不变」。
    自定义色的派生算法还有两份实现（`src/utils/themeColor.ts` 与 `index.html`
    内联脚本），改对比度阈值或推导规则必须同步；漏改的表现是「刷新前后颜色不一样」。

22. **`white` / `black` 已被重映射**为 `paper` / `ink`：不要在 `bg-accent*` 上用
    `text-white` / `text-black` 当前景，否则深色模式会反向；用 `text-on-accent`，
    页脚 / 灯箱用 `inverse` / `inverse-fg`。

23. **反向箭头用 `.u-arrow-back`**，不要拼 `u-arrow rotate-180`（优先级会被悬停态覆盖）。

24. **守卫不能从 `router/index.ts` 导出**（那里创建带 hash history 的 router，Node 里没有
    `location`）—— 单独放 `src/router/authGuard.ts`。

## 数据与测试

25. **CI 上的 selftest 用的是「数据仓里被编辑过的数据」**（deploy 会先 `data:pull`）——
    本地全绿 ≠ CI 全绿。断言不得编码数据内容（标题 / 数量 / 图片路径），只断言规则。

26. **`btoa` 只吃 latin1**：中文要先编 UTF-8 字节（`encodeBase64`，已抽出共用）。
    文本走 `putFile`，图片字节走 `putBinaryFile`，不能混。

27. **测试桩不能把所有 PUT 都当改 `db.json`**：图片上传写的是另一个文件。
    假 GitHub 与 `page.route` 拦截器都按路径区分。

28. **`localStorage` 跨测试运行会累积**：UI 测试开头必须 `localStorage.clear()`。

29. **后台 UI 用例必须 `page.route` 拦 GitHub API**；预览开新标签页，拦截要挂 `context.route`。
    真令牌不进测试脚本。

30. **后台用例必须 `token: true`**，否则测的是登录页而不是目标页。

31. **图片上传文件名必须毫秒 + 随机后缀**：只到秒时同一秒内连传两张会撞同一路径，
    第二张覆盖第一张，图库凭空少一张。

32. **ZIP 导入必须当不可信输入**：只认固定格式标识、版本、GameJolt 来源和白名单条目，
    限制压缩包 64 MB / 解压后 128 MB / 40 个条目；图片仍走解码与尺寸校验；
    不要渲染包内 HTML / JS。

33. **「已收录」必须用归一化标题完全相等**：包含匹配会让请求《Jolly》因站内已有《Jolly 4》
    而被静默移出待上传榜。

34. **`service_role` 绝不能进前端**：它绕过 RLS。前端只用 anon public key，`selftest` 有守卫。

35. **Supabase SQL 要手动执行**：`supabase/resource_requests.sql` 不会随构建运行。
    执行后若 PostgREST 报找不到函数 / 视图，先 `notify pgrst, 'reload schema';`。

36. **client id 不是反滥用机制**：它只是 localStorage 随机 ID，清掉就能重投。

37. **CRLF 行尾**：脚本里做文本匹配时若匹配不上，先怀疑行尾；按行处理最稳。
