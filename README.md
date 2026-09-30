# FNAF Fan Games Archive

Five Nights at Freddy's **同人游戏资源导航站**。纯前端静态站，零成本托管于 GitHub Pages，
资源统一跳转第三方网盘，视觉上严格遵循 **Swiss International Style**（瑞士国际风格）。

| 项目信息 |  |
| --- | --- |
| 线上地址 | https://daxigua732.github.io/fnaf-fan-games-archive/ |
| 代码仓库 | https://github.com/DaXiGua732/fnaf-fan-games-archive |
| 原始需求文档 | [`fnaf_fan_game_website_technical_specification.md`](./fnaf_fan_game_website_technical_specification.md) |
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

### 0.1 后台管理系统（进行中）

项目正在按 [`admin_backend_development_plan.md`](./admin_backend_development_plan.md) 的
Phase 0–20 逐阶段加装后台。**必须一个阶段一个阶段做，每阶段结束停下等用户确认**。

| 文档 | 作用 |
| --- | --- |
| `admin_backend_development_plan.md` | 计划书：20 个阶段的定义、执行协议（规则 1–6）、回复格式 |
| `admin_phase0_design_freeze.md` | 设计冻结：审计结论、架构决策、数据模型增量方案、路由与文件规划 |

已完成：**Phase 0（审计与设计冻结）、Phase 1（Admin Layout）、Phase 2（游戏管理列表）、
Phase 3（批量操作）、Phase 4（编辑页骨架）、Phase 5（基础字段编辑）、Phase 6（标签管理）、
Phase 7（图片管理 UI）、Phase 8（下载资源管理）、Phase 9（发布状态系统）、
Phase 10（前台与后台状态联动）、Phase 11（Repository Layer）、Phase 12（本地仓储持久化）、
Phase 13（持久化方案决策）、Phase 15（认证门禁 + `GitHubGameRepository`）、
Phase 16（图片上传到数据仓）**。

> **后台现在能改线上数据、也能传图了**：登录后读写数据仓的 `db.json`，
> 图片上传到数据仓的 `images/`，保存 = 一次提交，git 历史即回滚手段。
> 未登录时后台不可达（登录门禁）。
> 下一步按计划书是 Phase 17（图片处理：类型 / 大小 / 尺寸校验、上传进度、删除旧图）。
> （Phase 14 数据库设计不适用：`db.json` 就是库。）

后台路由（Hash 形态，全部挂在 `AdminLayout` 下）：

| 路径 | 组件 | 状态 |
| --- | --- | --- |
| `/#/admin` | 重定向 → `admin-games` | ✅ |
| `/#/admin/login` | `AdminLogin.vue` | ✅ **唯一豁免认证的后台路由**（Phase 15） |
| `/#/admin/games` | `AdminGames.vue` | ✅ Phase 2 / 3 |
| `/#/admin/games/new` | `AdminGameEditor.vue` | ✅ 全部区块（P5–P9） |
| `/#/admin/games/:id/edit` | `AdminGameEditor.vue` | ✅ 全部区块（P5–P9） |
| `/#/admin/tags` | `AdminTags.vue` | ✅ 搜索 / 重命名 / 删除（Phase 6） |
| `/#/admin/authors` 等 | 尚未创建 | 延伸 |
| `/#/admin/*`（兜底） | `AdminNotFound.vue` | ✅ |

**进入后台的入口**：公开站 Header 的导航项「后台管理」（`Layout.vue` 的 `NAV_ITEMS`），
一次改动同时覆盖桌面导航、移动端菜单与页脚站点导航三处。

> ⚠️ 这个入口目前**没有权限校验** —— 任何访客都能进后台。计划书 Phase 15 才接认证，
> 在那之前**不要把带真实数据的版本公开部署**。`NAV_ITEMS` 里 `dev: true` 的两项
> （调试台 / 样式规范）才是上线前该移除的，后台入口不是。

### 前台可见性（Phase 10 起生效）

**判据只有一个：`isPubliclyVisible(game)` = `status === 'published' && !archived`。**

前台的**一切**都从它派生：列表、搜索、筛选、分页、详情页、Hero 的收录数，
以及过滤面板里的「可用作者 / 年份 / 系列」。
任何一处绕开它，就会出现两种裂缝之一：隐藏的作品漏出来，或者
「筛选选项里有某个作者，点了却是空的」。

- 非可见作品的**详情页 URL 与不存在的 id 表现一致**（走前台的 404 分支）——
  这是计划书 §Phase 10 推荐的初版策略：前台完全隐藏。
- 过滤面板的选项只基于可见集合 —— 只基于全量会让「草稿作品的作者」出现在筛选里。

### 前后台的数据源（Phase 15 起已分离）

```
前台：publicGameRepository  ← 构建期快照（db.json）+ 本机存档。只读，不发请求。
后台：adminGameRepository   ← 登录后是 GitHubGameRepository（数据仓的 db.json）
```

**这是刻意的，不是遗漏。** 前台要的是「秒开、不吃网络、断网也能看」，
后台要的是「改的就是线上数据」—— 两者的数据来源不可能同时是一份。

> ⚠️ Phase 10 那种「后台改了前台**立刻**变」只在本机模式成立。
> 生产上前台要等**下一次重新构建**（约 1 分钟）。
> 这条语义已经钉进 UI 断言（「前台此时仍是 6 款」），
> **不要**为了「立刻生效」把前台改成运行时查库 —— 那会赔掉首屏与离线能力。

另外注意：

- 前台可见性判断的入参必须是**归一化后**的条目（`AdminGame`）。
  传原始 `Game` 时 `status` / `archived` 可能是 `undefined`，
  比较结果会静默变成「不可见」—— 那会让整个前台在毫无报错的情况下变空。所以类型上就写死了。
- **测试里要注意两处状态累积**：`localStorage`（本机存档、令牌）会在多次运行间**累积**，
  所以 UI 测试开头必须 `localStorage.clear()`；而登录后数据源是远程仓，
  后台用例必须靠 `page.route` 拦截 GitHub API 才有数据可渲染（真令牌不该进测试脚本）。

改后台之前必须知道的五条硬约束：

1. **两套 Layout 完全分离**，由 `routes.ts` 的嵌套路由决定（`/` → `Layout`，`/admin` → `AdminLayout`）。
   `App.vue` 只是 `<RouterView />`。
2. **后台不得复用 `useGameLibrary`** —— 它是只读单例，且前台只应看到 `published`。
   后台用独立的 `useAdminGames`。
3. **后台 `.vue` 里禁止 `import db.json`、禁止手写 `.filter()` / `.sort()`**，一律走 `useAdminGames`。
   （有静态守卫在扫，见 §2.1。）
4. **数据模型新增字段全部 optional**，`status` 缺省 `published`。
   若改成缺省 `draft`，等 Phase 10 的「前台只展示 published」一上线，
   **整个前台会在一次提交里被清空**。
5. **前台可见性的完整判据是 `status === 'published' && !archived`**（已在 Phase 10 实现）。
   「归档」是**与 status 正交**的独立标记（归档一个草稿不该把它变成已下线）。
   判据与派生规则收敛在 `isPubliclyVisible()` 一处 —— 新增任何前台展示入口都要经过它。

### 数据同步：两仓之间必须有一次「拉取」

后台写的是**数据仓**的 `db.json`，前台读的是**构建期快照**（`src/data/db.json`）。
两者之间必须有一次同步，前台才可能看到后台的改动：

```bash
npm run data:pull      # 从数据仓拉 db.json 覆盖到 src/data/db.json
```

- **部署**：`deploy.yml` 在构建前自动执行这一步 ✓
- **本地开发**：需要手动跑一次 —— 否则你看到的是上一次同步的快照
  （这也是「后台改了、图片也传了，本地点开却还是旧的」的原因）

**这个脚本刻意做成「失败不阻断」**：两个来源（raw → API）依次尝试，
都拿不到就**保留仓库里那份快照并告警** —— 一次网络抖动不该让站点发不出去。
但它**绝不写入校验不过的内容**：解析失败、或没有 `games` 数组时直接放弃，
宁可继续用旧快照，也不能把站点弄空。

> ⚠️ 跑完之后 `src/data/db.json` 会变（图片变成数据仓的绝对地址）。
> 这是**预期**的：代码仓里那份 db.json 的定位就是「本站最后一次构建所用的快照」。

### 图片上传（Phase 16）

登录后**选图即上传**：文件以二进制写进数据仓，返回的**完整外链**写进作品数据。

```
images/games/<作品slug>/<位置>-<时间戳>.<扩展名>
例：images/games/tjoc-reborn/cover-20260930204133.png
```

**前台零改动**：返回的是完整外链，前台的 `assetUrl()` 会原样放行。

| 决策 | 理由 |
| --- | --- |
| 文件名带**时间戳** | 图片是公开地址、会被浏览器与 CDN 缓存。沿用固定名覆盖上传会让人一直看到旧图；换名即换地址，缓存自然失效（代价是旧文件留在仓库里 —— 「删除旧图」是 Phase 17） |
| 按**作品 slug** 分目录 | 让人在仓库里翻找图片时看得懂。新作品还没有 id，就用标题的 slug 顶上 |
| 上传期间**禁用入口** | 否则重复拖放会传上去好几份 |
| 本地模式**明确抛错** | 而不是返回一个假地址 —— 后者会让用户以为图片已经上传成功了 |
| 只做**长度/类型/大小**的基础校验 | 尺寸检查、上传进度、删旧图是 Phase 17，不在没有需求时提前做 |

> ⚠️ **`putFile` 与 `putBinaryFile` 是两个函数**：文本要走 UTF-8 → base64，
> 图片的字节必须**原样** base64 上送。把 JPEG 字节当文本处理会直接损坏文件。
> 两者的 base64 助手（`encodeBase64` / `decodeBase64`）是共用的，
> 因为**测试桩也要用同一份** —— 各写一份的话，编码写错会两边一起错、互相掩盖。

> ⚠️ 写测试桩时踩过两次同一个坑：**不能把所有 PUT 都当成改 `db.json`**。
> 图片上传写的是另一个文件，混在一起会让桩把一张 PNG 当 JSON 解析。
> `src/dev/adminAssertions.ts` 的假 GitHub 与 UI 测试的 `page.route` 拦截器
> 都按路径区分开了。

### 输入框的绑定方式（受控输入的坑）

搜索框一律走 `composables/useSearchField.ts`，**不要用 `:value` + `@input`**。

`:value` + `@input` 是「受控输入」：显示值完全由模型决定。问题在于，
**框架一旦把模型值回写到 DOM，浏览器就会重置光标位置** —— 这是浏览器的行为，
不是框架的 bug，但后果很难受：

> 反向选中一段文字（鼠标从右往左拖，`selectionDirection` 为 `backward`），
> 然后直接打字时，光标会被复位到选区**左端**，后面每个字符都插到前一个前面 ——
> 于是「输入 1234」看起来变成了「4321」。

`useSearchField` 让输入框由**本地 ref** 驱动（`v-model`），
模型只在真正需要时（外部改了条件）才回写 —— **打字过程中不存在任何回写**。

> 注：这条规律是**排查后加固**的结论，不是复现出来的。
> 用合成按键（Playwright）在 9 个输入框上都复现不出来，
> 代码里也搜不到任何设置光标或文字方向的地方（无 `setSelectionRange`、无 `rtl`/`direction`）。
> 所以采取的是**结构性加固**：把「会在打字时回写」的写法整体换掉，
> 而不是去猜某一次具体是在什么时机被回写的。

### ⚠️ 断言不能把「数据内容」写死

后台的意义就是让人**随时改数据**。所以任何断言都不该编码具体内容，否则
「管理员改了一条作品」就等于「测试挂了」。真实踩过的例子：

| 写死的断言 | 后果 |
| --- | --- |
| `expect title === "Dayshift at Freddy's"` | 站长把这条作品的标题改掉 → 3 条排序断言 + 1 条冒烟用例同时假失败 |
| `expect gallery === '/images/a.svg,/images/b.svg'` | 数据换源成数据仓绝对地址 → 假失败 |
| `expect cover === '/images/tjoc-reborn-cover.svg'` | 同上 |

**改为断言规则**：首位应是**当前列表里标题最小的那一个**（用同一份数据自行推导）；
图片地址只校验**末段文件名**（兼容站内路径与绝对外链两种形态）；
冒烟需要"页面确实列出了作品"时，**从 `src/data/db.json` 里取一个真实标题**。

### 预览功能（Phase 18）

编辑页操作栏的「**预览**」会**开一个新标签页**，渲染 `views/GameDetail.vue` **本身**
—— 不是另写一个"像前台"的预览页。另写副本迟早跟真实前台分叉，分叉之后预览就在骗人。

三个决策：

| 决策 | 理由 |
| --- | --- |
| **新标签页**，而不是页内跳转 | 导航去预览页会**卸载编辑页**，而草稿是每个编辑会话一份的 —— 卸载即丢弃，未保存的改动就没了（离开拦截也是为这件事存在的）。新标签页毫发无损，编辑页的草稿原样留在原地 |
| 草稿经 **localStorage** 交接，读完即清 | 跨标签页只能靠 storage。⚠️ **一开始用的 sessionStorage，实测它不跟着 `window.open` 的新标签页走**（预览页拿到 null）——localStorage 是同源标签页之间唯一可靠共享的 storage |
| 预览路由挂在 **`/admin` 下** | 它显示的是**未发布**内容，绝不能被一个公开地址渲染出来。挂在父路由下即自动受登录门禁保护 |

**不需要已保存**：改到一半也能预览 —— 这正是预览存在的意义。预览数据以已保存的那条为底
（保住 metrics 这类不可编辑字段），再把草稿盖上去。

> 预览页有一条醒目的说明：「它不会对外可见，也不会写进数据仓 —— 想真正生效，回编辑页点保存」。
> 刷新预览页会显示空状态（交接是一次性的），回编辑页再点一次即可。

**尺寸检查**（`utils/imageInspect.ts`）。刻意分成两层：

```
readImageSize()   浏览器侧：把文件读成位图，拿像素尺寸（需要 DOM API）
checkImageSize()  纯函数：只看尺寸就能判断能不能收
```

校验逻辑做成纯函数，断言才测得到它 —— 不必在 Node 里伪造一个位图。

| 规则 | 处理 |
| --- | --- |
| 宽度 < 640（图库 400） | **拒绝** —— 放到卡片上会糊 |
| 单边 > 8192 像素 | **拒绝** —— 几千万像素的图，仓库和带宽都吃不消 |
| 比例偏离建议值 > 25% | **只提示** —— 前台用 `object-contain`，比例不对只会留白，不会坏。做成硬拦截会让人为一张稍微扁一点的封面反复裁图：**拿确定性成本换一点观感** |

校验顺序是**类型 → 大小 → 尺寸**：尺寸检查要先把图读成位图，比前两项贵得多，
所以放最后 —— 一个 50 MB 的非图片文件不该被送去解码。

**上传进度**用的是「正在上传第 N / M 张」，**不是百分比**。
原因：`fetch` 不暴露上传进度，要拿字节级进度就得换成 XHR，
那会引入第二条 HTTP 路径、连带测试桩也要写两份。
为 4 MB 上限的图片付这个复杂度不划算，而「第几张」对批量上传已经传达了同样的信息。

**失败重试**：上传失败会把文件记下来，就地给一个「重试」按钮（图库是「重试这 N 张」），
不用让用户重新选一遍。

**删除旧图 —— 时序是最要紧的部分**：

> 清理**必须放在保存成功之后**。上传那一刻，新图还没被任何作品引用，
> 而旧图**仍然是线上正在用的那一张** —— 那时删旧图等于把线上正在显示的图删掉。

三道闸：
1. 只清理数据仓 `images/games/` 下的图（**站内旧资源与外部图床一律不碰**）
2. 只清理**没有出现在任何作品里**的（包括刚保存的那条）
3. 清理失败**绝不让保存失败** —— git 历史里那份还在，顶多留一张废图

> ⚠️ 写测试夹具时踩过两次：**别用 SVG 当图片夹具**（`createImageBitmap` 在 Chrome 里
> 解不了 SVG blob，会走「读不出尺寸」分支 —— 你以为在测尺寸校验，其实测的是解码失败），
> 也别用手写的 1×1 PNG（尺寸校验就是要拦小图，它会被拦下来，这是它该做的）。
> 正确做法是在浏览器里用 canvas 生成**指定尺寸的真实 PNG**。

### 图片处理（Phase 17）

**尺寸检查**（`utils/imageInspect.ts`）刻意分成两层：

```
readImageSize()   浏览器侧：把文件读成位图，拿像素尺寸（需要 DOM API）
checkImageSize()  纯函数：只看尺寸就能判断能不能收
```

校验逻辑做成纯函数，断言才测得到它 —— 不必在 Node 里伪造一个位图。

| 规则 | 处理 |
| --- | --- |
| 宽度 < 640（图库 400） | **拒绝** —— 放到卡片上会糊 |
| 单边 > 8192 像素 | **拒绝** —— 几千万像素的图，仓库和带宽都吃不消 |
| 比例偏离建议值 > 25% | **只提示** —— 前台用 `object-contain`，比例不对只会留白，不会坏。做成硬拦截会让人为一张稍微扁一点的封面反复裁图：**拿确定性成本换一点观感** |

校验顺序是**类型 → 大小 → 尺寸**：尺寸检查要先把图读成位图，比前两项贵得多，放最后。

**上传进度**是「正在上传第 N / M 张」，**不是百分比** —— `fetch` 不暴露上传进度，
字节级要换 XHR，会引入第二条 HTTP 路径、测试桩也要写两份，不值得（见 §2.x）。

**失败重试**：上传失败把文件记下来，就地给「重试」按钮（图库是「重试这 N 张」）。

**删除旧图 —— 时序最要紧**：

> 清理**必须放在保存成功之后**。上传那一刻，新图还没被任何作品引用，
> 而旧图**仍然是线上正在用的那一张** —— 那时删旧图等于把线上正在显示的图删掉。

三道闸：① 只清理数据仓 `images/games/` 下的图（**站内旧资源与外部图床一律不碰**）；
② 只清理**没有出现在任何作品里**的；③ 清理失败**绝不让保存失败** —— git 历史里那份还在。

> ⚠️ 写测试夹具踩过两次：**别用 SVG**（`createImageBitmap` 在 Chrome 里解不了 SVG blob，
> 会走「读不出尺寸」分支 —— 你以为在测尺寸校验，其实测的是解码失败），
> 也别用手写的 1×1 PNG（尺寸校验就是要拦小图）。正确做法是
> 在浏览器里用 canvas 生成**指定尺寸的真实 PNG**。

### 后台认证（Phase 15）

**没有自建账号体系。** 凭据是一枚 **GitHub 细粒度 Personal Access Token**：
站长在 GitHub 上签发，只授权**数据仓**、只给 `Contents: Read and write`。

于是「**管理员只能改数据、不能碰代码**」这条要求，是由**凭据本身的权限**保证的，
而不是靠我们写的判断逻辑 —— 判断逻辑写错就会漏，凭据权限不会。
（2026-09-30 实测：拿这枚令牌往代码仓写文件被 GitHub 拒绝。）

| 环节 | 做法 |
| --- | --- |
| 门禁 | `src/router/authGuard.ts` 的 `beforeEach`；判据是 `to.meta.requiresAuth` |
| 安全默认值 | `requiresAuth: true` 写在 **`/admin` 父记录**上，子路由覆盖它。新增后台页面**默认受保护**，「忘了加保护」不可能发生。只有登录页显式 `false` |
| 登录 | `/#/admin/login` —— 粘贴令牌 → 校验 → 存本机 `localStorage` |
| 登出 | 后台 Header 的「登出」；清除令牌并回登录页 |
| 令牌位置 | **只在本机浏览器**，不进代码、不进仓库 |

**校验分两步，缺一不可**：① `/user` 确认令牌本身有效；② 读一次数据仓的 `db.json`
确认它**真的够用**。只做 ① 的话，「登录成功」是骗人的 —— 令牌有效但没授权数据仓时，
用户会一路进到后台、然后在第一次保存时才炸。

**错误信息写在 `src/services/githubApi.ts` 里收口**，全部翻译成**能照着做**的中文：
401 →「令牌无效或已过期，请重新生成」；403 →「确认已授权数据仓，且 Contents 权限为 Read and write」；
404 →「确认令牌已授权数据仓，且仓库里有 db.json」。
后台唯一的失败路径都在这里，值得把话说明白。

> ⚠️ **认证状态是模块级 ref，只在模块加载时读一次 localStorage。**
> 所以外部改了本机存储后**必须重新加载页面**（或调用 `reloadStoredToken()`）才生效。
> 已挂 `storage` 事件监听做**跨标签页同步**：在另一个标签页登出，本页下次导航就会被拦下。

> ⚠️ **守卫必须能被冒烟测试复用，所以它单独放在 `src/router/authGuard.ts`。**
> `router/index.ts` 会创建带 hash history 的真实 router（Node 里没有 `location`），
> 从那里导出会把冒烟测试搞崩 —— 这与 `routes.ts` 与 router 实例分离是同一个理由。
> 冒烟测试为此装了 localStorage 桩并调用 `installAuthGuard()`，
> **门禁本身因此也在冒烟覆盖之内**（含一条「未登录被拦」的用例）。

> ⚠️ **守卫用动态 import 加载认证模块。** 写成静态 import 会把它连同 GitHub 客户端
> 一起打进主包 —— 而公开站访客永远用不到那几 KB。
> （与「首屏之外的视图一律懒加载」是同一条原则。）
> 已核实：`X-GitHub-Api-Version` 只出现在 `useAdminAuth` 分块里，不在主包。

### 后台的写入落在哪里（Phase 12 起）

**登录后：写进数据仓。** `GitHubGameRepository` 通过 GitHub Contents API 读写
`fnaf-fan-games-data/db.json` —— 保存一次 = 提交一次，git 历史就是完整的审计日志与回滚手段。

| 环节 | 做法 |
| --- | --- |
| 读 | `GET /repos/…/contents/db.json` → base64 解码 → `normalizeGames()` |
| 写 | **读最新内容 + 最新 sha → 把改动重放到最新内容上 → 带 sha 提交** |
| 并发 | sha 不匹配时 GitHub 返回 **409** → 自动重读重放重提交（最多 3 次） |
| 提交信息 | `（后台）更新《作品名》的 status、tags` —— 用**最新**内容生成，让历史读得懂 |
| 编码 | `btoa` 只吃 latin1，中文会炸 → 必须先编 UTF-8 字节（见 `encodeBase64`） |

> ⚠️ **`db.json` 是一个文件，所以任意两人同时保存都会冲突**（不只是改同一条时）。
> 敢直接重试的原因是**重放永远正确**：我们改的是「某一条作品的某几个字段」，
> 不是一段文本 —— 与合并文本 diff 有本质区别，后者需要人来裁决。
> 这条性质有专门的断言守着（包括「重放**没有**覆盖掉别人刚改的东西」）。

**未登录 / 本地模式：写进本机 localStorage**（Phase 12 的能力，现在是测试与开发路径）。

这一点由 `StorageKind`（`memory` / `local` / `remote`）显式建模，并原样上报给 UI：

```ts
export type StorageKind = 'memory' | 'local' | 'remote'
export const STORAGE_NOTICE: Record<StorageKind, string> = { ... }
```

三个页面的结果提示条都引用 `STORAGE_NOTICE`，**不各写各的** ——
否则改一处漏一处，用户会同时看到两种相互矛盾的说明。

> ⚠️ **绝不要笼统地说「保存成功」。** 用户心里的「保存成功」=「线上已经是这样了」，
> 而实际可能只存在他自己的浏览器里。写入位置本身就是必须告知用户的信息。

**降级是诚实的**：SSR、隐私模式、配额写满时仓储会把 `storage` 降级为 `memory`，
UI 于是如实说「只写入了内存」。**写失败绝不假装成功。**

**数据源有三态，不能混为一谈**：`ready`（是否已拉取）/ `error`（失败原因）/ `dataOk`。
远程仓要先把 `db.json` 拉下来，那几百毫秒里如果直接渲染「空列表」，
用户看到的是**「我的数据全没了」**。所以三个后台页面都用
`<AdminDataState v-if="!dataOk" />` / `<div v-else>` 的二选一结构，
加载中显示「加载中」、失败显示原因 + **可点的**「重试 / 重新登录」。

**远程模式没有「恢复出厂数据」**：那等于用出厂内容覆盖线上数据仓，不是后台该有的能力。
按钮直接不渲染，`resetToSeed()` 也会拒绝执行 —— 要回滚请对数据仓做 `git revert`。
**本地模式（未登录 / 测试与开发）：** 写入落在本机 localStorage，刷新不丢、但**不是线上数据**。
它的逃生舱 `resetToSeed()` 把数据恢复成出厂内容（入口在「数据现状」区，页内确认）；
本地存档解析失败、或结构不对时，一律**退回出厂数据**并打一条 console 警告 ——
一份损坏的存档绝不能让站点变成空白，那比丢失改动严重得多。

### 操作署名与操作历史（Phase 19）

数据模型新增 `updatedBy?: string`（最近一次修改这条数据的人，GitHub 账号名）。
与 `updatedAt` 一样**由仓储管理、调用方不写** —— 远程仓储在每次写入时打上当前操作者。

**⚠️ 为什么不做独立的 `audit_logs`**：**git 历史本身就是完整的审计日志** ——
每次后台保存都是一次提交，提交作者就是操作者、提交信息写清了改了什么、时间戳天然存在，
而且免费、可逐行 diff、可 revert。再单独维护一份审计文件是冗余，
还要额外付出「并发追加会撞车」「多一次 API 调用」「多一个失败点」的代价。
计划书自己也说了「这一步不是第一阶段必需功能」。

`account` 传给仓储的是**取值函数**而不是字符串：页面刷新后令牌从本机恢复、
账号要等一次 `/user` 才拿得到 —— 传函数的话，写入时取到的永远是**当下**的账号。

本地模式没有账号，`updatedBy` 保持缺省，界面显示「—」，**不伪造署名**。

### 编辑器的草稿态

`useAdminGameDraft` 是**工厂**（每次编辑会话一个实例），不是像 `useAdminGames` 那样的模块级单例。
两者职责不同：目录状态全后台共享一份，草稿是单次会话私有的。

`gameToDraft` / `draftToPatch` / `validateDraft` 都作为**纯函数**导出，断言可以直接测，
不需要构造组件。校验与转换各只有一处职责 —— 不要在组件里重写转换逻辑。

编辑页在 `setup()` 里**同步**调用 `loadFrom()`，不能放进 `onMounted`：
否则 SSR 首帧渲染空表单、客户端再填上，既造成 hydration 不一致，也让冒烟断言不到字段值。

**草稿实例通过 `provide` / `inject` 共享**（`provideAdminGameDraft()` / `useAdminGameDraftContext()`）。
子组件（标签录入、以后的图片 / 下载）**不要**自己再调一次 `useAdminGameDraft()` ——
那会造出第二个实例，两边各改各的，表现为「编辑了但草稿没变」，完全静默、极难排查。

> ⚠️ `loadFrom` / `resetToBaseline` / `markSaved` 用 `applyDraft()` **逐字段复制**，
> 不能用 `Object.assign`：后者会连数组引用一起复制，让「草稿的 tags」和「基线的 tags」
> 指向同一个数组 —— 改草稿等于改基线，`isDirty` 永远为 false，改动静默丢失。
> 断言里有一条专门守这个（「addTag · 触发 isDirty（基线未被连带修改）」）。

### 标签

标签**没有独立存储**，只是各条作品上的字符串数组。所以：

- 「重命名 / 删除标签」的本质是**改所有引用它的作品**（`renameTag` / `deleteTag`）。
  重命名到已存在的名字时会合并去重，不会产生重复标签。
- 「创建时间」列**不伪造日期**：数据源里既有的标签没有创建时间可言，
  只记录本次会话中由后台首次引入的标签（`tagCreatedAt`），其余显示「—」。
  独立的 `tags` / `game_tags` 表要到 Phase 14 才建立。
- 约束（`TAG_LIMITS`：每条作品最多 12 个、每个标签最长 24 字符）在深模块的 `readTags()`
  里**收口**；组件只做交互与即时反馈，不重复实现规则，否则两处的上限迟早不一致。
- 标签来自 `v-model` 绑的输入框，运行时类型不受 TS 保证 → `normalizeTag()` 的入参是 `unknown`。

### 图片（Phase 7 UI + Phase 16 上传）

**没有存储层**，所以本机文件只能用 `URL.createObjectURL()` 生成 `blob:` 地址 ——
它只在本页有效、刷新即失效，**不可能**被保存下来。因此：

- 这类值会被显著标注「本地临时预览 · 未上传」。**不要**去掉这个标注，
  否则用户会以为文件已经上传成功了。
- 真正的图片值仍然是一个**字符串**（站内路径或外链），与 db.json 的模型一致。
- 从本机选的 blob 地址会在**替换时与组件卸载时**撤销（`URL.revokeObjectURL`），
  否则一个会话里选十几次大图就会持续占用内存。
- `assetUrl()` 必须放行 `blob:` —— 否则会被错误地拼上子路径前缀。

> ⚠️ **归一化函数不要做「上限截断」**。`readTags()` / `readGallery()` 同时被
> `draftToPatch()`（保存路径）使用；在其中按上限截断，会让一条超限的作品在保存时
> **静默丢掉多余的数据**。上限只在 `addTag()` / `addImages()` 这些「新增」入口执行。
> 断言里有两条专门守这个（「draftToPatch · 不截断超出上限的…」）。

封面 / Banner **允许留空**：草稿阶段可以先没图。若填了则必须是站内路径（以 `/` 开头、
以图片扩展名结尾）或 http(s) 地址。「发布必须有封面」属于 Phase 9 的发布校验，
不该拦在保存这一步。

### 下载渠道（Phase 8）

每一行是「服务商 / 下载地址 / 提取码」，顺序即前台 `DownloadPanel` 的渲染顺序。

- **逐行校验**：下载是数组，一个扁平的错误记录（`DraftErrors`）装不下，
  所以深模块单独提供 `downloadErrors`（与行一一对应），并且 `isValid` 会一起判断。
  **每行只报第一条错误** —— 一行同时飘三条红字只会让人不知道先改哪个。
- **刚点「添加渠道」得到的空白行不立刻飘红**（那是噪音不是反馈）：
  只有「提交过一次」或「这一行已经开始填了」才显示该行的错误。
- 提取码留空时写成 `undefined`，与模型的 `password?: string` 对齐。

> ⚠️ **静态提示文案不要和错误文案用同一句话。**
> 组件底部的说明原本写的是「下载地址必须是 http://…开头的完整链接」，与校验错误一字不差 ——
> 结果一行出错时用户在同一屏看到两遍同样的句子，分不清哪句是提示哪句是报错。
> 已改成「下载地址需以 http 或 https 开头」。写表单提示时留意这点。

### 发布状态（Phase 9）

三态含义（计划书 §Phase 9）：`draft` 前台不可见 · `published` 前台展示 · `offline` 前台不展示但数据保留。
**下线靠改状态实现，不靠删数据。**

「归档」与状态**正交**：归档只是「收起来」，不改发布状态（归档一个草稿不该把它变成已下线）。

**两套写入语义要分清**：

| 入口 | 语义 |
| --- | --- |
| 列表页的批量操作 | **立即生效**（快捷动作） |
| 编辑页的「保存 / 发布」 | 只改草稿，点保存才落库（完整编辑） |

**「保存」与「发布」的区别**：`保存` 按表单当前内容落库；`发布` 等于「把状态切到已上线 + 保存」的快捷方式。
两者共用同一套校验，所以「发布」并不比「保存」宽松。

**发布级校验（`publishIssues`）**：状态是 `published` 时，必须有封面、Banner 与至少一个下载渠道 ——
这三项在前台都是**直接渲染**的（没有封面列表卡片是一片空白、没有 Banner 详情页顶部是裂图、
没有下载渠道这个「资源导航站」的条目没有意义）。但**草稿不受这些限制**，
所以它不能塞进 `isValid`，而是单列并由 `canSave` 一起判断。

> ⚠️ 状态脏值一律降级为 `draft`（`readStatus`）—— 与 `blankGame` 同一条安全原则：
> **宁可少发布一条，也不能因为一个脏值把内容误公开出去。**

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
| `npm run selftest` | 深模块行为断言（前台 + 后台两套，见 §2.1） |
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

断言集放在 `src/dev/`，目前两份：

| 文件 | 覆盖的深模块 |
| --- | --- |
| `libraryAssertions.ts` | 前台 `useGameLibrary`（搜索 / 交叉过滤 / 排序 / 分页） |
| `adminAssertions.ts` | 后台 `useAdminGames`（状态统计 / 筛选 / 排序 / 分页 / 勾选） |

`libraryAssertions.ts` 被**两处消费**：

- `src/views/DebugLibrary.vue`（浏览器里的调试台）
- `scripts/selftest.mts`（命令行）

> **这是刻意的设计**：保证"浏览器里看到的自检"与"命令行跑的自检"是同一份实现，
> 永远不会出现两处漂移。新增断言请只改对应的那一个文件。

`scripts/selftest.mts` 顺序跑两份断言集并分组汇总。

> ⚠️ **不要在文档里写死断言条数**（比如"29 项"）。条数每个阶段都在涨，
> 写死就意味着每加一条断言都要回来改文档，很快就会失真。

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
>
> 后台的 `useAdminGames` **没有**模拟延迟（数据源是同步的构建期 JSON），因此后台路由首帧就是终态。

> ⚠️ **写 `expect` 断言时不要放需要 HTML 转义的字符**：
> Vue 的 SSR 会把 `&` `<` `>` `"` `'` 转义成 HTML 实体。
> 例如 `Dayshift at Freddy's` 实际会渲染成 `Dayshift at Freddy&#39;s`，
> 写成完整标题会得到「页面明明渲染了却说缺内容」的假失败（已经踩过一次）。

> ⚠️ **不要断言依赖运行时环境的渲染结果**。目前有两处：
> - `AdminGameTable` 的时间戳列按**查看者本地时区**渲染（存储是 UTC），
>   Node 与浏览器的时区可能不同 → 只断言列存在，不断言时间戳字符串。
> - 任何用 `new Date()` / `toLocaleString()` / `Intl` 生成的文案同理。
>
> 判断标准很简单：**同一个字符串在不同机器上会不会不一样？会，就别写进断言。**

> **外壳分离也有断言保护**：`SmokeCase` 带 `shell: 'public' | 'admin'`，
> `SHELL_MARKERS` 断言该外壳该有的标记，`SHELL_FORBIDDEN` **反向断言不该出现另一套外壳的标记**
> （后台不得继承公开站 Footer；公开站不得出现后台 Header）。新增路由务必挂对 `shell`。

### 2.3 视觉规范哨兵

`src/components/StyleAuditBadge.vue` 会在**运行时全量扫描 DOM**，逐个比对
`border-radius` 与 `box-shadow`，在页面顶部直接显示 `PASS` / `FAIL` + 违规元素列表。
调试台 `/debug` 和样式验收页 `/style` 都挂了这个组件。

### 2.4 UI 点击测试（交互行为，SSR 覆盖不到的部分）

`npm run smoke` 只验证「路由能渲染出 DOM」，验证不了「点下去会发生什么」。
勾选、批量执行、二次确认、保存、未保存拦截、标签增删 —— 这些只能靠真实浏览器点。

脚本在 `.tmp/ui-test.mjs`（`.tmp/` 已 gitignore，**不纳入版本管理**，也不进 package.json）。
它用 Playwright 驱动**系统已安装的 Chrome**（`channel: 'chrome'`），因此**不需要下载 Chromium**。

```bash
# 1. 装 playwright 到隔离工作区（不进项目依赖）
cd "C:/Users/wangjinling/.workbuddy/binaries/node/workspace" && npm install playwright --ignore-scripts

# 2. 跑（对 dev server，需要 npm run dev 起在 5173）
node .tmp/ui-test.mjs

# 3. 跑（对生产构建预览，需要 npm run build && npm run preview -- --port 4173）
BASE=http://localhost:4173/fnaf-fan-games-archive PROD=1 node .tmp/ui-test.mjs
```

> ⚠️ **三个必须知道的坑**（写这个脚本时全踩过）：
> 1. **ESM 的裸导入不认 `NODE_PATH`**。playwright 装在隔离目录时，必须用
>    `createRequire('file:///<workspace>/package.json')` 显式解析，否则 `ERR_MODULE_NOT_FOUND`。
> 2. **`innerText` 会反映 CSS 的 `text-transform`**。卡片标题带 `uppercase`、
>    `.swiss-meta`（`Compliance` 徽章）也带 `uppercase`，所以 `innerText` 拿到的全是**大写**。
>    所有文本断言必须大小写不敏感 —— 否则会得到「页面明明渲染了却说缺内容」的假失败。
>    （注意：`smoke.ts` 断言的是原始 HTML，不受 CSS 影响，所以它没这个问题。）
> 3. **状态 chip 的可访问名包含使用次数**（如「草稿 0」），
>    `getByRole('button', { exact: true })` 匹配不到，要用 `^前缀` 正则。
>
> 另外：`GameCard` 的链接是**包在 `<article>` 外面**的（`RouterLink > Card > article`），
> 所以选择器是 `a article`，不是 `article a`。

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
│   ├── components/                 # 公开站可复用 UI 组件
│   │   ├── Button.vue              # 基础按钮（solid/outline/ghost × md/lg）
│   │   ├── Card.vue                # 基础容器（interactive 模式有悬停左边框变红）
│   │   ├── GameCard.vue            # 格子卡片（复用 Card）
│   │   ├── FilterPanel.vue         # 筛选与排序面板
│   │   ├── DownloadPanel.vue       # 下载区 + 提取码复制
│   │   ├── CommentSection.vue      # Giscus 评论区（未配置时优雅降级）
│   │   ├── StyleAuditBadge.vue     # 视觉规范运行期哨兵
│   │   └── admin/                  # 后台专用组件（与公开站组件不混放）
│   │       ├── AdminNav.vue        # 后台分区导航（未实现的模块显示为禁用 + PLANNED）
│   │       ├── AdminToolbar.vue    # 后台搜索 / 状态 / 作者 / 标签 / 排序
│   │       ├── AdminStatusTag.vue  # 状态标记（同色系重量梯度，不用彩色胶囊）
│   │       ├── AdminBatchBar.vue   # 批量操作条（上下线 / 加减标签 / 改作者 / 归档 + 二次确认）
│   │       ├── AdminField.vue      # 表单字段外壳（标签 + 插槽 + 错误/提示）
│   │       ├── AdminEditorSection.vue # 编辑页区块外壳（统一的标题 + 已修改/待接入标记）
│   │       ├── AdminTagEditor.vue  # 标签录入（编辑草稿的 tags，不直接写目录）
│   │       ├── AdminImageSlot.vue  # 单个图片位（封面 / Banner：预览 + 拖放 + 地址 + 清除）
│   │       ├── AdminGalleryEditor.vue # 图库（多图 + 上移下移 + 删除 + 查看）
│   │       ├── AdminDownloadEditor.vue # 下载渠道（服务商 / 地址 / 提取码 + 增删排序 + 逐行校验）
│   │       ├── AdminPublishSettings.vue # 发布设置（状态三态 + 归档 + 发布缺口清单）
│   │       ├── AdminFeatureSettings.vue # 推荐与排序（首页推荐位 + 排序权重）
│   │       └── AdminGameTable.vue  # 后台游戏列表（含勾选）
│   ├── composables/
│   │   ├── useGameLibrary.ts       # ★ 前台深模块：搜索/交叉过滤/排序/分页（只读单例）
│   │   ├── useAdminGames.ts        # ★ 后台深模块：状态/筛选/排序/分页/勾选/写入/标签级操作
│   │   ├── useAdminGameDraft.ts    # ★ 编辑器草稿态（**工厂**，非单例）+ 纯函数校验/转换 + provide/inject
│   │   └── useViewCounter.ts       # 浏览量（remote / static 双模式）
│   ├── config/giscus.ts            # Giscus 配置 + 启用步骤说明
│   ├── data/
│   │   └── db.json                 # ★ 构建期单一事实来源：所有游戏数据
│   ├── repositories/               # ★ 数据访问层（Phase 11）
│   │   ├── gameRepository.ts       # 接口契约：后台只允许通过它读写数据
│   │   ├── localGameRepository.ts  # 本地实现（localStorage，刷新不丢）· 唯一读 db.json 的地方
│   │   ├── remoteGameRepository.ts # 远程实现占位（Phase 13 / 14 接入，调用即抛错）
│   │   └── index.ts                # ★ 当前生效的仓储 —— 唯一的切换点
│   ├── dev/
│   │   ├── libraryAssertions.ts    # ★ 前台断言集（浏览器与命令行共用）
│   │   └── adminAssertions.ts      # ★ 后台断言集（命令行消费）
│   ├── layouts/
│   │   ├── Layout.vue              # 公开站骨架：Header + RouterView + Footer
│   │   └── AdminLayout.vue         # 后台骨架：后台 Header + 侧栏 + RouterView
│   ├── router/
│   │   ├── routes.ts               # 路由表（双 Layout 嵌套，与实例分离便于测试复用）
│   │   └── index.ts                # createRouter + Hash history
│   ├── services/viewCounter.ts     # 浏览量适配器（ViewProvider）
│   ├── styles/index.css            # Tailwind 入口 + 全局硬重置（视觉规范最后防线）
│   ├── types/
│   │   ├── game.ts                 # 领域模型 Game / DownloadLink / GameMetrics / GameStatus
│   │   └── admin.ts                # 后台视图模型 AdminGame + 查询类型 + 状态文案表
│   ├── utils/
│   │   ├── asset.ts                # ★ assetUrl()：拼接 BASE_URL
│   │   ├── clipboard.ts            # copyText()：两级回退的剪贴板写入
│   │   ├── datetime.ts             # ★ formatTimestamp()：按查看者本地时区渲染
│   │   └── gameDefaults.ts         # ★ normalizeGame()：补齐可选字段的缺省值
│   └── views/
│       ├── Home.vue                # 首页：Hero + 筛选 + 网格 + 分页
│       ├── GameDetail.vue          # 详情页：标题 + Banner + 数据表格 + 下载 + 评论
│       ├── NotFound.vue            # 404
│       ├── DebugLibrary.vue        # 调试台（/debug，上线前可移除）
│       ├── StyleSpecimen.vue       # 视觉规范验收页（/style，上线前可移除）
│       └── admin/                  # 后台视图
│           ├── AdminGames.vue      # /admin/games：游戏管理列表
│           ├── AdminGameEditor.vue # /admin/games/new 与 /:id/edit：编辑页
│           ├── AdminTags.vue       # /admin/tags：标签管理
│           └── AdminNotFound.vue   # 后台 404（防止输错的后台地址掉回公开站外壳）
├── tailwind.config.js              # ★ 覆盖式配置：违规工具类直接不生成
├── vite.config.ts                  # base 按 command 区分
└── vite.smoke.config.ts            # 冒烟测试专用构建配置
```

---

## 4. 架构

### 4.1 数据流

```
                    ┌─ 前台 ──────────────────────────────────────────┐
数据仓 db.json  ──构建时同步──▶  publicGameRepository（本地仓，只读快照）
                    └────────────────────────────────────────────────┘

                    ┌─ 后台（登录后）─────────────────────────────────┐
数据仓 db.json  ◀────读写────▶  adminGameRepository = GitHubGameRepository
                    └────────────────────────────────────────────────┘
```

**两边读的不是同一份数据，这是刻意的。**

- **前台**读**构建期快照**：访客不登录、不发请求、断网也能看，首屏不等网络。
- **后台**读写**数据仓**：保存 = 一次提交，改动是真的线上数据。

代价是**前台要等下一次重新构建才更新**（约 1 分钟）。这是静态站的固有性质，
不是缺陷 —— 提示条会如实告诉用户。Phase 10 那种「改了前台立刻变」只在本机模式成立，
换成远程之后必然不成立。

> ⚠️ **未登录时 `adminGameRepository` 就是本地仓**，但登录门禁会先把 `/admin` 拦住，
> 所以这条路径在生产上不可达（它是测试与开发用的）。
> 由此**本地仓的写入 / 本地存档 / 「恢复出厂数据」在生产路径上已是死代码** ——
> 清理与否留待 Phase 19/20，现在保留是因为断言覆盖着它们。

### 4.2 Repository 层（Phase 11）

后台**只允许**通过 `GameRepository` 读写数据。接口有七个方法：
`listGames` / `getGame` / `createGame` / `updateGame` / `deleteGame` / `publishGame` / `unpublishGame`。

**三条由自动化守住的规则**（`scripts/selftest.mts` 的「静态守卫」组，会扫源码、失败即中断构建）：

| 守卫 | 规则 |
| --- | --- |
| 只有仓储可以读 `db.json` | 白名单只有 `localGameRepository.ts` |
| 后台视图不引仓储的具体实现 | `views/admin` 与 `components/admin` 只能 import `../repositories` 的当前实例 |
| 只有 `repositories/index.ts` 实例化仓储 | 否则会出现两份互不相干的数据（Phase 10 刚消除掉的问题） |

> 守卫会先 **strip 注释**再扫 —— 否则仓储文件里「禁止 import db.json」这句**文档**
> 自身就会被当成违规命中。

**几个刻意的取舍**：

- `games` 是**响应式快照**（`ComputedRef`），读写方法都是异步的。
  UI 需要同步拿数据渲染，而远程实现必然异步 —— 不能等那天再改上层。
- 写入入参是 `GamePatch`，**类型上排除了 `id` / `createdAt` / `updatedAt`** ——
  它们由仓储管理。让调用方写 id，新建时就会撞车。
- `deleteGame` **UI 刻意不暴露** —— 下线的正确做法是 `publishGame` / `unpublishGame`。
  保留它只为接口完整，以及给「确实要清理脏数据」的场景用。
- `remoteGameRepository` 的每个方法都**直接抛错**，而不是静默返回空数组 ——
  后者会让「数据没了」伪装成「目录是空的」，前台会显示一个没有作品、也没有任何报错的页面。
- 批量操作走**逐个 `updateGame`**，没有另开 bulk 接口：目录规模是几十条，
  为它引入一个偏离计划书的接口不划算。`updatedAt` 由仓储统一打戳，调用方不自己造时间戳。

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

> ⚠️ **反向箭头必须用 `.u-arrow-back`，不要写 `u-arrow rotate-180`。**
> `.group:hover .u-arrow` 的优先级 (0,3,0) 高于 `.rotate-180` 的 (0,1,0) ——
> 两条都只写 `transform`，悬停时高优先级那条会把 `rotate` **整个覆盖掉**，
> 箭头会在鼠标移上去的瞬间从 ← 翻成 → 并向右跑。
> `.u-arrow-back` 把旋转**写进 transform 本身**，滑出方向是右箭头的镜像（左箭头向左滑）。

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

> **实用技巧：需要清空临时目录时，不要 `rm -rf`，换个新目录名。**
> `rm -rf .tmp/xxx` 可能触发删除保护（甚至报 `SAFE_DELETE_FAIL_CLOSED`）。
> 直接用 `.tmp/exp2`、`.tmp/exp3` 这类递增目录名，完全绕开删除需求，`.tmp/` 本身已被 gitignore。

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
