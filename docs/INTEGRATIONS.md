# 第三方集成

## 1. 浏览量：适配器 + Abacus 实时计数

详情页浏览量由 [Abacus](https://v2.jasoncameron.dev/abacus/) 实时计数：
生产构建在 `main.ts` 注册 `createAbacusViewProvider({ namespace: 'fnaf-fan-games-archive' })`，
每次打开详情页向 `/hit` 发一次请求（自增并返回新值）；失败 / 超时静默降级为
`db.json` 的 `metrics.fakeViews`。

- **只在生产构建启用**：`npm run dev` / UI 测试不注册 provider，反复打开不会刷线上数字。
  （`npm run preview` 也是生产构建，会真计数；本地批量验证请拦截 Abacus 请求。）
- **后台预览不计数**：预览复用真实 `GameDetail`，`useViewCounter` 以 `track: () => false` 跳过自增。
- **key = 作品 id**：Abacus 只接受 `[A-Za-z0-9_.-]{3,64}`；不合法 id 直接不发请求。
- **4 秒超时**：统计不能把页面挂在「载入中…」。
- **免费、免注册、CORS 开放**，限流 30 次 / 10 秒 / IP；单次浏览只发 1 个请求。
- **没有防刷能力**：纯静态站拿不到可信的访客身份，数值只作参考（页面文案也这么写）。
  `/hit` 自动建 key 且不返回 admin key，被刷后无法重置；要可管理的计数得用 `/create`
  预建 key 并把 admin key 存在数据仓之外。
- ⚠️ **`/hit` 是 GET**：被浏览器 / CDN 缓存一次就少计一次浏览 —— provider 同时用
  `cache: 'no-store'` 与时间戳兜底，改计数实现时别删这两道防线。

换后端只需实现 `ViewProvider { id, read, increment }`，在 `main.ts` 换一行注册，组件不用改。
`src/dev/viewCounterAssertions.ts` 用注入的 fetch 桩覆盖请求形状、响应解析、非法 id、
自增失败读旧值、抛错 / 超时降级 —— **不出网**。

> `metrics.fakeViews` 仍然保留：列表「热度」排序用它（实时数只在详情页取，
> 逐个作品拉全量计数会打满免费服务限流），计数服务不可用时也用它兜底。
>
> `useViewCounter` 在 **static 模式下同步取值**（否则 SSR 首帧永远卡在「载入中」），
> remote 模式才走异步 + `isLoading`。

## 2. 评论区：已按产品决策移除

详情页不再有评论 / Giscus 区块。`CommentSection.vue`、`src/config/giscus.ts`、
`public/giscus-swiss.css`、「讨论」区块及相关断言与文案已全部删除。

如果以后重新引入，先想清楚为什么需要它，并作为新功能重新评估：
Hash 路由下的讨论串映射、跨域 iframe 的样式约束、审核与滥用处理都会重新成为问题。

## 3. GameJolt 半自动导入

**做什么**：在 GameJolt 作品页把标题、作者、发行年份、开发引擎、简介、一句话简介、
视频 URL、标签和图片抓下来，自动填进后台草稿；图片走现有处理链路（缩放 + WebP）上传到数据仓。

**不做什么**：

- **不碰下载渠道**。游戏文件仍由人工下载、上传网盘，再把链接填进后台 ——
  工具不会把 GameJolt 的下载地址伪装成网盘渠道。
- **不自动保存 / 发布**。导入只改草稿，新建条目默认是草稿。

### 方式一：浏览器扩展 + ZIP（运维主路径）

content script 运行在 `gamejolt.com` 页面里，请求 `/site-api` 属于**同源请求**，
因此不需要本机助手、不需要 Node、不需要保持进程。图片 CDN `m.gjcdn.net` 返回
`Access-Control-Allow-Origin: *`，可直接下载。

```bash
npm run build:extension     # 产物在 extension/dist/
```

- Chrome：`chrome://extensions` → 开发者模式 →「加载已解压的扩展程序」→ `extension/dist/`
- Edge：`edge://extensions` → 开发人员模式 →「加载解压缩的扩展」→ `extension/dist/`

**使用**：打开 GameJolt 作品页（`/games/<slug>/<id>`）→ 点右下角「导出到 FNAF 档案」→
得到 `<slug>-<id>-<时间>.zip` → 后台「新增 / 编辑游戏」→「从 GameJolt 导入」→ 拖入 ZIP →
检查预览 →「填入表单并上传图片」→ 手动补下载渠道 →「保存」。

**ZIP 结构**：

```
manifest.json   格式版本 / 来源 / 抓取时间 / 图片 URL → 文件映射
capture.json    已归一化的 GameJoltImportData（与助手路径同一形状）
images/...      封面 / Banner / 截图
README.txt      给人看的导入说明
```

**为什么是 ZIP 不是 RAR**：浏览器端没有可靠的纯 JS RAR 编码器；ZIP 是标准容器。
扩展用 `fflate` 生成 store 模式（图片已压缩，再 deflate 没意义），后台用同一库读取。

**安全边界**：

- 扩展只申请 `gamejolt.com` / `www.gamejolt.com` / `*.gjcdn.net` 的 host 权限，
  **不读取、不发送 GitHub 令牌**；
- 一次点击只抓一个作品，不做批量爬取；
- 后台把 ZIP 当**不可信输入**：只接受固定格式标识与版本、GameJolt 来源域名、白名单条目；
  限制压缩包 64 MB / 解压后 128 MB / 40 个条目；
- 图片仍要通过 `createImageBitmap` 解码与尺寸校验（单文件 4 MB 上限），
  包内 HTML / JS 一律不执行；
- 扩展不上传任何数据，ZIP 只是本地下载文件。

**分发**：内部用「加载已解压扩展」最简单；要给非技术运维并自动更新，可把
`extension/dist/` 上架 Chrome Web Store / Edge Add-ons 的不公开条目。

### 方式二：本机助手（开发 / 调试备用）

GameJolt 的 `/site-api` 不返回可跨域读取的 CORS 头，普通页面直接 `fetch` 会被拦。
助手跑在 `127.0.0.1:4317`，只代理两个 JSON 接口；图片仍由浏览器直接下载。

```bash
npm run gamejolt:helper    # 终端 1
npm run dev                # 终端 2
```

后台「方式二」粘贴链接 → 抓取 → 预览 →「填入表单并上传图片」→ 补下载渠道 → 保存。
线上后台访问 `http://127.0.0.1:4317` 属于回环地址，Chrome / Edge 允许；
助手已处理 Private Network Access 预检。

- 只绑定 `127.0.0.1`，不暴露到局域网；
- 只允许 `https://daxigua732.github.io` 与 `localhost` / `127.0.0.1` 的任意端口作为 Origin，
  可用 `GAMEJOLT_ALLOWED_ORIGIN` 追加；
- 输入只接受 `gamejolt.com` 作品链接或纯数字 ID，请求地址由助手自己拼；
- **助手完全接触不到 GitHub 令牌**。

### 已知限制

- 依赖 GameJolt 的**内部站内接口**，对方改版可能失效；扩展与后台都会给出可见报错，
  不会静默写入半条数据。
- 简介超过 2000 字会截断；图库最多导入 8 张；低于最小尺寸或超过 4 MB 的图片跳过并提示。
- 抓到的文本是原文，不自动翻译；IP 系列只在识别到 FNAF 字样时自动填 `FNAF`。
- 改助手端口：`npm run gamejolt:helper -- --port 4318`，并在构建时设置
  `VITE_GAMEJOLT_HELPER=http://127.0.0.1:4318`。

**相关文件**：`extension/`（MV3 扩展）、`scripts/build-extension.mjs`、
`scripts/gamejolt/`（解析 / 抓取 / 助手 / 测试）、`src/services/gamejoltCapture.ts`（ZIP 读取与安全校验）、
`src/services/gamejoltImport.ts`（字段映射与图片导入）、
`src/components/admin/AdminGameJoltImport.vue`（两种导入方式的 UI）。

## 4. 资源请求（催资源）

访客在首页提交「想要但站内还没有」的游戏；榜单按催更人数排序。
**不写游戏目录、不参与构建**，与 GitHub 数据仓是两条独立链路。

### 用户流程

1. 首页「＋ 催一个资源」打开弹窗。**先搜站内，再提交**。
2. 输入至少 2 个字符后，弹窗列出站内可能相关的作品。
3. **归一化标题精确命中**站内可见作品时，只给详情链接，不出现提交按钮。
4. 已有同标题的开放请求时，只显示「已有 N 人催过」和「+1 催」。
5. 两者都没有才允许提交；提交者自动算第一票。
6. 站内后来出现同名作品时，请求自动移入「已收录」并链接详情页。

### 排名与公平性

- **一票 = 一个不同的浏览器 client id**；同一浏览器对同一请求只计一票。
- 排序：票数降序 → 提交时间升序 → id（最后一项保证稳定）。
- 每个 client **24 小时内最多新建 5 条**；达到上限仍可给已有请求 +1。
- ⚠️ client id 是 localStorage 里的随机 ID，**只是去重身份，不是安全凭据**：
  清掉浏览器存储就能重投。它防的是正常访客的重复点击，不是恶意刷票。

### 两种存储模式

| 场景 | 数据在哪 | 行为 |
| --- | --- | --- |
| 两个 `VITE_` 变量没有同时配置 | 本机 `localStorage` | **本机模式**：刷新不丢、去重与每日上限仍生效，但别的访客看不到；支持 Web Locks 的浏览器会串行化多标签页写入 |
| URL + anon key 都配置 | Supabase | **全站共享**：读公开视图，提交 / 投票走 RPC |
| 配了 Supabase 但连不上 | 最近一次缓存 | 榜单显示缓存 + 明确提示；**提交 / 投票直接报错** |

> 「配了但不可达」时刻意**不退回本机写入**：否则同一台浏览器会同时存在两套互不相干的请求数据，
> 用户以为提交成功、实际上没人能看到。宁可报错，也不制造分叉。

### Supabase 接入

1. Supabase Dashboard → SQL Editor 执行 [`../supabase/resource_requests.sql`](../supabase/resource_requests.sql)。
   脚本可重复运行（`IF NOT EXISTS` / `CREATE OR REPLACE` / 先 DROP 再建策略）。
2. 项目根目录 `.env.local`（**不要提交**）：

   ```bash
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<Project Settings → API → anon public key>
   ```

3. 重启 `npm run dev` 或重新 `npm run build` —— `VITE_*` 是**构建期变量**。
4. PostgREST 报找不到函数 / 视图时，先执行 `notify pgrst, 'reload schema';` 再重试。

> ⚠️ `.env.local` 只影响本地 dev / build，**不会带到线上**。线上由 `deploy.yml` 从仓库
> **Actions Variables** 读取 `${{ vars.VITE_SUPABASE_URL }}` / `${{ vars.VITE_SUPABASE_ANON_KEY }}`。
> anon public key 本来就公开，放 Variables 即可；**绝不要放 `service_role`**。
> 任一变量缺失时线上构建就是本机模式。

### SQL 的安全边界

- `resource_requests` 存请求，`resource_request_votes` 存投票明细；两表启用 **RLS**，
  且对 `anon` / `authenticated` 直接 `REVOKE` 表权限。
- 只授予安全列的 `SELECT`：`created_by_client` 与 `normalized` 不暴露；
  公开视图 `resource_request_board`（`security_invoker`）只含 `status = 'open'` 的展示列。
- 提交与投票只能调用 **security definer 函数**（`submit_resource_request` / `vote_resource_request`）。
  函数内做标题 2–80 / client id 8–64 校验、归一化去重、每日 5 条上限（advisory lock 防并发穿透）、
  `ON CONFLICT` 防重复投票。
- 同名 open 请求有**唯一索引**；两个 client 并发提交同名请求时，后到者落到同一条并计票。
- **前端只使用 anon public key**，权限由 RLS / GRANT 决定。**绝不要把 `service_role` 放进前端、
  仓库或文档** —— 它绕过 RLS，等于把整个数据库交给访客。
- 没有后台审核页：人工下架 / 标记完成在 SQL Editor 把 `status` 改成 `hidden` / `done`。

### 「已收录」是推导出来的

- 用**当前可见目录**（`isPubliclyVisible()`）匹配；只认**归一化标题完全相等**。
- 归一化：**NFKC → 小写 → 去掉空白、标点与符号**。`'  Jolly  4!! '`、`'JOLLY-4'`、
  `'Jolly+4'`、`'ＪＯＬＬＹ－４'` 都得到 `jolly4`。前端 `src/utils/requestMatch.ts` 与 SQL 的
  `normalize_resource_request_title` 各一份，**改一处必须同步另一处**。
- ⚠️ SQL 的 POSIX `[[:punct:]]` 对 emoji / 非 ASCII 符号的覆盖依赖数据库 locale，
  不一定与前端 `\p{S}` 完全一致（例如 `★`）。这类标题需在真实项目实测；
  同名请求分裂时用 SQL Editor 人工合并。
- **为什么不用包含匹配**：请求《Jolly》时站内已有《Jolly 4》并不代表前作已上传；
  包含匹配会把《Jolly》静默判成已收录、从待上传榜消失。
- 已收录只是展示层推导，数据库 `status` 仍是 `open`，仍占同名 open 唯一位；
  要彻底清掉需人工改成 `done` / `hidden`。
- 作品被下线或归档后不再算可见，请求重新回到待上传榜。

### 已知限制

- 远程榜单一次最多读 50 条（PostgREST `limit=50`，按票数降序）；本机模式无此上限。
- 本机模式的数据**不会自动迁移**到 Supabase：配置远程模式后，之前存在某台浏览器里的请求 /
  投票仍只在那台浏览器。
- **SQL 尚未在真实 Supabase 项目执行过**：RLS / RPC / 视图 / PostgREST 缓存需实测。
- 没有后台审核页 / 限流面板；client id 可清空重投，投票结果只适合作为需求排序参考。
- Supabase 免费项目长期不活动会被暂停；只影响请求榜，游戏目录不受影响。
- 请求数据不写数据仓，因此没有 git 审计 / 回滚；Supabase 免费版无自动备份。

**相关文件**：`supabase/resource_requests.sql`、`src/config/requests.ts`、
`src/types/resourceRequest.ts`、`src/utils/requestMatch.ts`、`src/utils/requestClient.ts`、
`src/repositories/localResourceRequestRepository.ts`、`src/repositories/supabaseResourceRequestRepository.ts`、
`src/composables/resourceRequestStore.ts`（可构造的 store：缓存 / 合并 / 乐观回滚）、
`src/composables/useResourceRequests.ts`（生产装配）、`src/components/ResourceRequestBoard.vue`、
`src/components/ResourceRequestDialog.vue`、`src/dev/requestAssertions.ts`。
