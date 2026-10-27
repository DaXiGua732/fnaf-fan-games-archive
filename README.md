# FNAF Fan Games Archive

Five Nights at Freddy's **同人游戏资源导航站**。纯前端静态站，零成本托管于 GitHub Pages，
资源统一跳转第三方网盘，视觉上严格遵循 **Swiss International Style**（瑞士国际风格）。

| 项目信息 |  |
| --- | --- |
| 线上地址 | https://daxigua732.github.io/fnaf-fan-games-archive/ |
| 代码仓库 | https://github.com/DaXiGua732/fnaf-fan-games-archive |
| 原始需求文档 | [`fnaf_fan_game_website_technical_specification.md`](./fnaf_fan_game_website_technical_specification.md) |
| 包名 | `fnaf-fan-game-archive` |

> 🤖 **AI / 新协作者接手请先读** [`HANDOVER.md`](./HANDOVER.md) —— 它是交接地图：
> 当前状态、架构数据流、运维命令、关键设计与"为什么"、铁律与踩坑清单、已知缺口。
> 本 README 是完整手册（最详细），HANDOVER 是快速入口。

---

## 0. 给接手者（尤其是 AI 上下文）的先读段落

这个项目有**三条不能踩的红线**，其余都是常规工程：

1. **视觉规范是硬约束，不是审美偏好。** 零圆角、零阴影、零渐变、纯无衬线、文本左对齐。
   项目已经用三层机制把它们**从编译层禁掉**了（见 §5）。不要试图"加个好看的圆角"。
2. **视图层（`.vue`）里禁止手写 `.filter()` / `.sort()`。** 所有数据加工都在深模块
   `useGameLibrary` 内（见 §4.2）。
3. **本环境不能 `git push`**（沙箱只放行 `api.github.com`）。要发布请看 §8。这是环境限制，
   不是项目配置问题。

另外：**改完必须跑 `npm run verify`**，全部关卡全绿才算完成（见 §2）。

### 0.1 后台管理系统（已完成）

后台已按 [`admin_backend_development_plan.md`](./admin_backend_development_plan.md) 的
Phase 0–20 全部落地，并已在线上实际使用。**后续改动仍按「一次一个阶段、每阶段停下确认」的协议走。**

| 文档 | 作用 |
| --- | --- |
| `admin_backend_development_plan.md` | 计划书：20 个阶段的定义、执行协议（规则 1–6）、回复格式 |
| `admin_phase0_design_freeze.md` | 设计冻结：审计结论、架构决策、数据模型增量方案、路由与文件规划 |
| `structured_data_phase0_design_freeze.md` | 结构化资料库升级：审计、数据模型、词表边界、关系、分阶段验收 |
| `structured_data_phase1_report.md` | 结构化资料库 Phase 1 实施报告：数据契约、测试结果、已知限制 |
| `structured_data_phase2_report.md` | 结构化资料库 Phase 2 实施报告：词表后台页、编辑器新字段、测试结果 |
| `structured_data_phase3_report.md` | 结构化资料库 Phase 3 实施报告：可点击索引、URL 状态、失效条件 |
| `structured_data_phase4_report.md` | 结构化资料库 Phase 4 实施报告：组合筛选面板、多选 UI、移动端 |
| `structured_data_phase5_report.md` | 结构化资料库 Phase 5 实施报告：作品关系编辑、相关作品展示 |
| `structured_data_phase6_report.md` | 结构化资料库 Phase 6 实施报告：只读质量检查、集成回归、文档收尾 |

已完成：**Phase 0–20 全部**。其中 Phase 14（数据库设计）不适用 —— `db.json` 就是库；
Phase 20（测试）由贯穿全程的门禁体系覆盖：
`typecheck + test:gamejolt + test:catalog + build:extension + selftest + smoke + build`
（UI 点击测试与扩展 E2E 需要本机浏览器，单独运行）。

> 结构化资料库升级是另一条分阶段工作流：Phase 0–6 全部完成，
> 包含数据层、后台维护、前台索引、组合筛选、作品关系与只读质量检查。

> **后台能改线上数据、能传图、能预览、能永久删除作品**：登录后读写数据仓的 `db.json`，
> 图片上传到数据仓的 `images/`，保存 = 一次提交，git 历史即回滚手段。
> 未登录时后台不可达（登录门禁）。
>
> ⚠️ **数据仓的改动不会触发代码仓的 workflow**。不过公开页在挂载 / 切回时会
> 从数据仓同步最新 `db.json`（快照只作首屏与离线兜底），所以通常**不需要**等构建；
> 每小时一次的定时构建只负责刷新快照，仍保留作兜底。

后台路由（Hash 形态，全部挂在 `AdminLayout` 下）：

| 路径 | 组件 | 状态 |
| --- | --- | --- |
| `/#/admin` | 重定向 → `admin-games` | ✅ |
| `/#/admin/login` | `AdminLogin.vue` | ✅ **唯一豁免认证的后台路由**（Phase 15） |
| `/#/admin/games` | `AdminGames.vue` | ✅ Phase 2 / 3 |
| `/#/admin/games/new` | `AdminGameEditor.vue` | ✅ 全部区块（P5–P9） |
| `/#/admin/games/:id/edit` | `AdminGameEditor.vue` | ✅ 全部区块（P5–P9）+ 永久删除 |
| `/#/admin/preview` | `AdminGamePreview.vue` | ✅ 未保存草稿的预览（Phase 18） |
| `/#/admin/taxonomy` | `AdminTaxonomy.vue` | ✅ 标签与作者合并管理：搜索 / 重命名 / 删除标签（Phase 6） |
| `/#/admin/vocabulary` | `AdminVocabulary.vue` | ✅ 玩法类型 / 机制 / 平台词表：新增 / 编辑 / 合并 / 删除保护（Phase 2） |
| `/#/admin/tags`、`/#/admin/authors` | 重定向 → `admin-taxonomy` | ✅ 旧地址保留，避免书签 404 |
| `/#/admin/*`（兜底） | `AdminNotFound.vue` | ✅ |

**进入后台的入口**：公开站 Header 的导航项「后台管理」（`Layout.vue` 的 `NAV_ITEMS`），
一次改动同时覆盖桌面导航、移动端菜单与页脚站点导航三处。

> 入口对所有访客可见，但进入后立刻被登录门禁拦到登录页（Phase 15）。
> 真正保护数据的是**令牌权限**（细粒度 PAT 只授权数据仓），不是隐藏入口。

**编辑器的信息结构**（参考 YouTube Studio / B 站创作中心的**操作流**，视觉仍是 Swiss）：

- **吸顶操作条**：脏状态 + 撤销 / 预览 / 保存 / 发布；下面一排分区锚点，
  有未保存改动的区块带红点。长表单不用再滚回顶部找按钮。
- **右栏「发布概览」**：封面、状态、上线清单（封面 / Banner / 下载渠道）、上次保存时间；
  一眼看到「还差什么才能上线」。
- **`Ctrl / Cmd + S`** 直接保存；只在有改动且通过校验时生效，不会产生空提交。
- **列表行内快捷操作**：标题直达编辑页，行内可直接「上线这条 / 下线这条 / 删除这条」；
  删除走二次确认弹窗，确认后从数据仓 `db.json` 物理移除（不是软删除）。
- **数据说明默认收起**，不再用一段文字挡住列表；首页 Hero 的「收录作品」统计全部条目，
  并注明其中多少款当前可浏览（网格只展示已上线且未归档的作品）。

**详情页的信息结构**（参考 itch.io）：

- Hero：标题 / 作者 / 短描述 / 主 CTA + 宣传图（无 banner 时退回封面）。
- 两栏：左为简介、截图、视频；右为封面、作品信息、标签、下载入口。
- 截图**灯箱**：点击查看大图，键盘 ← / → 切换、Esc 关闭；下载区有独立锚点。

**GameJolt 半自动导入**：新增 / 编辑页顶部有「从 GameJolt 导入」区块。
推荐在 GameJolt 作品页用浏览器扩展导出 ZIP，再把 ZIP 拖进后台：标题、作者、年份、
引擎、简介、标签与封面 / Banner / 截图自动填入，图片走现有上传链路写入数据仓。
扩展的 content script 运行在 gamejolt.com 页面内，`/site-api` 是同源请求，
**不需要本机助手或任何终端进程**。没有安装扩展时，仍可用本机助手作为开发备用。
**下载渠道仍需人工下载、上传、填写**；导入后条目仍是草稿，不会自动保存或发布。
详见 §7.3。

**前台新增能力**：主题切换（§5.4）与公开的「资源请求（催资源）」榜单（§7.4）。


### 前台可见性（Phase 10 起生效）

**判据只有一个：`isPubliclyVisible(game)` = `status === 'published' && !archived`。**

前台的**一切**都从它派生：列表、搜索、筛选、分页、详情页、Hero 的收录数，
以及过滤面板里的「可用作者 / 年份 / 系列」。
任何一处绕开它，就会出现两种裂缝之一：隐藏的作品漏出来，或者
「筛选选项里有某个作者，点了却是空的」。

- 非可见作品的**详情页 URL 与不存在的 id 表现一致**（走前台的 404 分支）——
  这是计划书 §Phase 10 推荐的初版策略：前台完全隐藏。
- 过滤面板的选项只基于可见集合 —— 只基于全量会让「草稿作品的作者」出现在筛选里。

### 前后台的数据源

```
前台：publicGameRepository  ← 构建期快照（db.json，首屏 / 离线兜底）
                            + 公开页挂载 / 重新可见时从数据仓同步最新 db.json
后台：adminGameRepository   ← 登录后是 GitHubGameRepository（数据仓的 db.json）
```

**为什么不是「前台只读快照」**：快照保证秒开、不吃网络、断网也能看；但后台改完数据后，
前台要等一次重新构建才会变，两个页面看起来就像「不同步」。所以公开页在挂载
（以及从后台切回来、标签页重新可见）时，用一次**非阻塞**的 `fetch` 把内存目录换成
数据仓的最新内容。失败就继续用快照 —— 静态站不能因为数据仓挂了而白屏。

> ⚠️ 同步是**后台替换**，不阻塞首屏；不要把前台改成「等网络返回再渲染」，
> 那会赔掉首屏与离线能力。开发 / UI 测试不执行同步，避免网络让断言不稳定。

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

### 数据同步：快照仍然要拉，但不再是唯一渠道

后台写的是**数据仓**的 `db.json`，前台首屏读的是**构建期快照**（`src/data/db.json`）。
公开页挂载时会自动同步数据仓（见 §4.1），所以后台改完通常不需要等构建；
但快照仍然要拉，它负责首屏与断网兜底：

```bash
npm run data:pull      # 从数据仓拉 db.json 覆盖到 src/data/db.json
```

- **部署**：`deploy.yml` 在构建前自动执行这一步 ✓
- **线上生效**：公开页打开 / 切回时同步最新数据（通常几秒）；数据仓提交不触发代码仓 workflow，
  每小时定时构建只负责刷新快照。
- **本地开发**：需要手动跑一次 —— 否则首屏兜底与详情页直开看到的是上一次同步的快照
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
| 文件名带**时间戳** | 图片是公开地址、会被浏览器与 CDN 缓存。沿用固定名覆盖上传会让人一直看到旧图；换名即换地址，缓存自然失效（旧文件由「保存成功后的孤儿清理」负责删除） |
| 按**作品 slug** 分目录 | 让人在仓库里翻找图片时看得懂。新作品还没有 id，就用标题的 slug 顶上 |
| 上传期间**禁用入口** | 否则重复拖放会传上去好几份 |
| 本地模式**明确抛错** | 而不是返回一个假地址 —— 后者会让用户以为图片已经上传成功了 |
| 上传前**自动压缩** | 长边超过对应位置的上限就等比缩小，非 GIF/SVG 一律转 WebP（quality 0.88）；转完反而更大时保留原图。压缩在 composable 层完成，仓储仍然只负责「把给的字节原样存进去」 |

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

### 结构化资料库：Phase 1–6（2026-10-27）

Phase 1 建立了数据层：类型、词表、默认值、关系结构与两套仓储的读写契约。
Phase 2 把它接进后台：新增 `/admin/vocabulary` 词表页，编辑器增加其他名称、
来源页、开发状态、玩法类型、机制与平台；详情页（含后台预览）展示这些字段。
Phase 3 把详情页的关键属性变成索引入口，并把筛选状态写进 URL（刷新 / 分享 / 前进后退都保留）。
Phase 4 把筛选面板扩成八组，支持同维多选、空分组不渲染与移动端单列布局。
Phase 5 接入有向作品关系：后台选择目标、详情页展示正向 / 反向与同作者 / 同系列。
Phase 6 增加只读资料质量检查 `npm run check:data`，并完成跨模块回归与文档收尾。
现有记录在读取时自动补齐默认值，但**没有批量改写数据仓**，也没有自动给任何作品打分类。

`db.json` 顶层现在是 `{ "games": [...], "taxonomy": {...} }`：

```json
{
  "games": [{ "id": "...", "gameplayTypes": ["traditional-night-watch"], "relations": [] }],
  "taxonomy": {
    "gameplayTypes": [{ "id": "traditional-night-watch", "name": "传统守夜", "description": "..." }],
    "mechanics": [],
    "platforms": []
  }
}
```

| 规则 | 说明 |
| --- | --- |
| 词表存顶层 | 三套集合：`gameplayTypes` / `mechanics` / `platforms`；作品只存**稳定 id** |
| 改名不碰作品 | 后台改的是词条 `name`；作品引用 id，所以无需批量改写 |
| 合并 / 删除一次生效 | 远程仓一次提交；本地仓一次持久化（第二个 key 写失败时尽力回滚）。合并会替换并去重所有引用；仍被使用的词条默认拒绝删除，除非明确要求从作品移除 |
| 缺省与损坏分开 | `taxonomy` 缺失时用内置初始词表兜底；三个集合齐全但为空时尊重「管理员删空」，不回填；缺集合 / 类型不对则不让它覆盖当前词表 |
| 普通保存不写词表 | 数据仓里没有 `taxonomy` 时，保存作品**不会**把内置词表塞进去；已有 `taxonomy` 时原样保留（包括 `null` / 损坏值），只有词表操作才改写 |
| 保留未知字段 | 顶层、词条、关系上的未知扩展字段在读写与 `data:pull` 后都保留，避免新旧代码互删数据 |
| 关系只存一条边 | 作品上存 `{ type, targetId }`；目标页的反向文案由 `inverseRelationLabel()` 派生，删除作品会清理指向它的入边 |
| 未知引用不丢 | 归一化**不做数量截断**，也不因为词表暂时没有该 id 就删掉作品上的值；关系坏输入在写入前报错，而不是静默消失 |
| 开发状态 ≠ 发布状态 | `developmentStatus` 描述作品做到哪一步（已发布 / 开发中 / 暂停 / 取消 / 未知）；`status` / `archived` 只控制本站是否展示，两者互不推导 |

作品新增 / 启用的字段：`altTitles`、`sourceUrl`、`developmentStatus`、
`gameplayTypes`、`mechanics`、`relations`，以及此前一直为空、现在纳入词表的 `platforms`。
本地模式的词表单独存在 `fnaf-archive:taxonomy:v1`，不改旧作品存档格式。

**Phase 2 已包含**：
- `/admin/vocabulary`：玩法类型 / 机制 / 平台三分区；新建、改名、改定义、合并、
  删除保护、使用次数（全部作品 / 前台可见）、未分类计数、跨集合同名提示。
- 编辑器：其他名称（≤5）、来源页（http(s)）、开发状态、玩法类型（≤3，第一项为主要）、
  机制（≤12）、平台（≤8）；非法词条 id、超限、非法 URL **阻止保存**，未标注不阻止。
- 详情页与后台预览：按词表把 id 解析成名称后展示；来源页只对 http(s) 生成外链。

**Phase 3 已包含**：
- 详情页的作者 / 年份 / IP 系列 / 引擎 / 玩法 / 机制 / 平台 / 标签都可点击，
  进入首页游戏库的对应索引结果；点击会**清空其他筛选**、回到第 1 页与默认排序。
- 查询引擎支持八个维度、同维多选（OR）与跨维（AND），搜索覆盖标题、其他名称、
  作者、系列、引擎、标签、玩法 / 机制 / 平台名称。
- URL 约定：`q` / `sort` / `page`，筛选维度用重复参数
  `author` / `year` / `series` / `gameplay` / `mechanic` / `tag` / `platform` / `engine`；
  默认值不写进 URL。首页内改动用 `replace`，从详情进索引用 `push`。
- 失效条件（词条被删除、值不在可见目录里）**保留并标红**，给出单个移除与
  「清除失效条件」入口；索引结果始终只来自 `isPubliclyVisible()`。

**Phase 4 已包含**：
- 筛选面板分组顺序：玩法类型 → 游戏机制 → 支持平台 → 作者 → IP 系列 → 年份 →
  开发引擎 → 标签；只渲染至少有一个可见选项的分组。
- 同组多选 toggle（`aria-pressed`），跨组 AND；选项只来自当前可见目录，
  草稿作品用过的词条不会出现在公开面板里。
- 搜索与筛选叠加；清除全部同时清空搜索；排序与分页行为不变。
- 移动端单列堆叠、chip 自动换行；390px 实测无横向溢出。

**Phase 5 已包含**：
- 编辑器「关联作品」区块：关系类型 + 作品选择器（标题 / id / 作者搜索），
  排除自身与已选目标；草稿 / 下线目标可选并标注「前台暂不展示」。
- 保存前共享 `inspectGameRelations()` 校验：自关联、目标不存在、重复目标、
  目标端已有反向记录、数量上限（20）都会阻断并逐行提示。
- 详情页「相关作品」：出边用关系文案，入边由反向文案派生（不要求两端各存一条）；
  只展示公开可见目标；同作者 / 同系列由标准字段派生，并与显式关系去重；
  没有相关数据时整段不渲染。后台预览使用同一套详情组件。

**Phase 6 已包含**：
- `npm run check:data`：只读扫描构建快照或 `--file=` 指定的 `db.json`，
  报告未分类作品、失效词条引用、悬挂 / 自关联 / 重复关系、两端重复记录、
  标签与词条同名、重复标签 / 别名、缺封面 / Banner / 下载、词表结构与跨集合同名。
- 只报告不改数据；默认退出码 0，`--strict` 在有 error 时退出 1，`--json` 输出机器可读结果。
- 跨模块回归：旧记录兼容、公开可见性、组合筛选、关系方向与删除清理均由 selftest / smoke / UI 覆盖。

**后续加固：检查健壮性与关系持久化（2026-10-27）**：
- `analyzeCatalog()` 对不可信 JSON 逐字段做类型检查后再归一化：根对象 / `games`
  类型错误、非对象条目、缺失或重复 id、标题 / 作者 / 图片 / 下载 / 关系 / 文本数组
  的类型错误都有明确代码；一条坏记录不会让整份报告崩溃或漏掉其他记录，且不改入参。
- 写路径只落盘**显式改动的字段**：未编辑作品整条原样写回；编辑器附带的未变化
  `relations` 不算修改；词表改名 / 合并只 patch 分类字段；删除作品只清理指向它的入边。
  归一化结果只服务读取与展示，`check:data` 仍能看见数据仓里的历史关系问题。
- 回归测试覆盖无关字段编辑、显式关系编辑、删除目标、词表合并，以及异常输入与只读性；
  两套仓储使用同一套 `src/utils/gamePersistence.ts` 语义。

**第二轮加固：原始 ID 安全与 Game 契约（2026-10-27）**：
- 远程仓与本地存档共用 `findCatalogIdentityIssues()`：缺失 / 空白 / 首尾空白 /
  非字符串 / 重复 id 时，任何目录写入都在提交 / 落盘前被拒绝，错误信息指出
  `games[n]` 的具体问题。失败零提交、零写入；不会把异常记录归一化、复制或丢失。
  本机模式的「恢复出厂数据」是显式修复入口，会把数据换回出厂快照。
- `analyzeCatalog()` 按 `src/types/game.ts` 补齐契约检查：`ipSeries` / `engine` /
  `description` 缺失与类型错误、`gallery` 数组、`metrics` 及 `fakeViews` / `score`、
  以及 `shortDescription` / `videoUrl` / `sourceUrl` / `status` / `featured` /
  `archived` / `sortOrder` / 三个时间戳字段的类型、枚举与格式约束。
  可选字段缺失不误报；未知扩展字段继续允许。
- `check:data --strict` 与 `test:data-quality` 已纳入 `npm run verify` 和部署 workflow；
  只对 error 失败，warning 保留人工判断。`data:pull` 的成功 / 失败日志会说明
  随后的检查针对最新拉取内容还是仓库里的旧快照。

> 结构化资料库的 Phase 0–6 已全部完成。**没有**批量标注任何作品 ——
> 分类与关系必须由管理员按资料逐条录入；质量检查只负责把问题列出来。
>
> 完整设计见 `structured_data_phase0_design_freeze.md`。

### 测试覆盖对照（Phase 20）

计划书 §21（后台专项）/ §22（前台回归）逐项对照。`selftest` = 纯函数与深模块断言，
`UI` = `npm run test:ui`（99 步真实浏览器点击），`冒烟` = SSR 渲染 16 条路由，
`字节对比` = 公开站产物逐字节基线。

**§21 后台专项**

| 计划书要求 | selftest | UI | 说明 |
| --- | --- | --- | --- |
| 列表：搜索 / 筛选 / 排序 / 分页 | ✅ | ✅ | |
| 列表：全选 / 取消全选 | ✅ | ✅ | 表头全选只作用于当前页 |
| 列表：行内快捷上线 / 下线 | ✅ | ✅ | 立即提交，结果条如实报数 |
| 列表：行内永久删除 | ✅ | ✅ | 二次确认弹窗；取消不删数据 |
| 批量：上线 / 下线 / 加标签 / 删标签 / 改作者 | ✅ | ✅ | 二次确认 + 结果条如实报数；逐条容错 |
| 标签与作者：搜索 / 重命名 / 合并 | ✅ | ✅ | 两者都是派生字段；作者改名=批量改写作品 |
| 编辑：新建 / 修改 / 取消 / 保存 / 发布 | ✅ | ✅ | 含未保存离开拦截与 `beforeunload` 提醒 |
| 编辑：Ctrl / Cmd + S 保存 | — | ✅ | 有改动才提交；校验失败会显示具体错误 |
| 编辑：**预览** | — | ✅ | 新标签页渲染真实前台详情页（Phase 18） |
| 状态：draft / published / offline | ✅ | ✅ | 前台可见性联动（Phase 10） |
| 图片：上传 / 替换 / 尺寸不合格 / 失败重试 | ✅ | ✅ | Phase 16 / 17 |
| 图片：删除（图库内移除） | ✅ | ✅ | 删除后由保存路径清理孤儿图 |
| 图片：排序（上移 / 下移） | ✅ | ✅ | |
| 图片：上传前压缩（WebP / 降采样） | ✅ | ✅ | 上传后扩展名为 `.webp`（Phase 17） |
| 下载：新增 / 删除 / 修改 / 错误 URL / 空 URL / 提取码为空 | ✅ | ✅ | Phase 8 |
| 作品：永久删除 | ✅ | ✅ | 二次确认弹窗，删除后清理专属图片 |
| 前台详情：截图灯箱 | — | ✅ | 键盘 ← / → 切换，Esc 关闭 |

**§21 之外（Phase 15–19 新增的能力）**：登录门禁 / 无效令牌报错 / 数据源三态 /
图片上传到数据仓 / 预览 / 删旧图的三道闸 / 操作署名 —— 全部有断言与 UI 用例。

**§22 前台回归**：后台开发**不得破坏前台** —— 这一条在本项目里的执行方式是**逐字节对比**：
公开站产物与基线比，任何变化都必须解释清楚（数据变化 / 代码变化）。
Phase 19 收尾时就这样做过：还原图片地址与被改的标题后逐字节一致，
首页仅剩卡片顺序差异，再用「与顺序无关的多重集比较」证明可见文本完全一致。

> §22 的字节基线针对**构建产物**；§4.1 的运行时同步发生在页面加载之后，
> 不改变构建产物。同步链路本身由 selftest 的 `hydrate` 断言 + 生产构建手测覆盖
> （数据仓返回不同数据 → 首页随之变化；数据仓不可达 → 退回快照）。

**§23 Git 提交策略**：计划书要求「不要把整个后台一次提交」。
**这一条没有照办** —— 应用户要求，Phase 11–19 的成果以单个提交（`f1e7b0d`）落库。
原因：这些改动互相依赖（仓储 → 门禁 → 上传 → 预览），拆开提交只会得到一串无法独立构建的中间态。
**此后按阶段提交**，不再攒大批量。

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
| `npm run selftest` | 深模块行为断言（前台 + 后台 + 资料质量 + 筛选 URL + 浏览量 + 主题 + 催资源 + 结构化资料八套，见 §2.1） |
| `npm run smoke` | SSR 冒烟：逐路由真实渲染并断言内容（16 条路由） |
| `npm run test:gamejolt` | GameJolt 链接解析 / 字段转换 / 扩展打包的单元测试（不联网） |
| `npm run test:catalog` | 数据仓文档解析 / 序列化测试（保留 `taxonomy` 等未知顶层字段） |
| `npm run test:data-quality` | `check:data --strict` 的退出码契约（合成夹具；无 error → 0，有 error → 1） |
| `npm run gamejolt:helper` | 启动 GameJolt 导入助手（只监听 127.0.0.1:4317，见 §7.3） |
| `npm run build:extension` | 构建 Chrome / Edge 扩展到 `extension/dist/` |
| `npm run test:extension` | 扩展端到端测试（需系统 Chrome；会先构建扩展） |
| `npm run test:ui` | Playwright 真实浏览器点击测试（需先另开终端 `npm run dev`） |
| `npm run assets` | 按 `db.json` 重新生成占位图到 `public/images/` |
| `npm run verify` | `typecheck` + `test:gamejolt` + `test:catalog` + `test:data-quality` + `build:extension` + `selftest` + `check:data --strict` + `smoke` + `build` |
| `npm run check:data` | **只读**资料质量检查：默认读 `src/data/db.json`，支持 `--file=` / `--json` / `--strict` |

---

## 2. 质量门禁：自动化关卡

本项目开发期间**无法在浏览器里手动点击验证**，所以用自动化关卡替代人工验收。
`npm run verify` 必须全绿才允许提交；CI 部署前会跑同一组检查（见 `.github/workflows/deploy.yml`）。

| 关卡 | 覆盖什么 | 抓不到什么 |
| --- | --- | --- |
| `typecheck` | 类型错误、拼写错误的属性名 | 运行时逻辑 |
| `test:gamejolt` | GameJolt 链接解析 / 富文本转换 / 图片选择 / 网络降级 / 扩展 ZIP 打包 | 真实接口改版（靠失败提示兜底） |
| `test:catalog` | 数据仓文档的解析 / 序列化；未知顶层字段与 `taxonomy` 必须原样保留 | 真实 GitHub 并发（由 selftest 的 409 桩覆盖） |
| `test:data-quality` | `check:data --strict` 的退出码语义：error 必须真的让门禁失败 | 真实生产数据内容（用合成夹具） |
| `build:extension` | 扩展能否打包、manifest / 图标 / 依赖是否齐全 | 真实浏览器里的扩展行为 |
| `selftest` | 深模块的搜索/过滤/排序/分页逻辑是否正确；主题解析、催资源去重/匹配/仓储契约；结构化字段 / 词表 / 关系 / 仓储契约；异常输入与原始 ID 安全 | UI |
| `check:data --strict` | 当前快照是否存在结构性数据 error（warning 不阻断） | 数据仓是否拉取成功（由 `data:pull` 日志区分） |
| `smoke` | 每个路由能否真实渲染出 DOM（**防白屏**） | 样式是否正确 |
| `build` | 生产构建能否通过、代码分割是否正常 | — |

> `npm run test:ui` 依赖常驻 `npm run dev` 与系统 Chrome，单次约 3 分钟；它验证交互而不是
> 构建 / 数据完整性，且部署 workflow 每小时兜底重建，因此**不纳入 verify / CI**。
> 人工执行：另开终端 `npm run dev`，再跑 `npm run test:ui`（见 §2.2）。
>
> `npm run test:extension` 用系统 Chrome 跑扩展的端到端流程（抓取 → 下载图片 → 打包 ZIP），
> 同样**不进 CI / verify**；改了扩展代码就本地跑一次。

### 2.1 `selftest` 的设计要点

断言集放在 `src/dev/`，目前八份：

| 文件 | 覆盖的深模块 |
| --- | --- |
| `libraryAssertions.ts` | 前台 `useGameLibrary`（搜索 / 交叉过滤 / 排序 / 分页） |
| `adminAssertions.ts` | 后台 `useAdminGames`（状态统计 / 筛选 / 排序 / 分页 / 勾选） |
| `viewCounterAssertions.ts` | 浏览量适配器（请求形状 / 响应解析 / 非法 id / 降级；注入 fetch，不出网） |
| `themeAssertions.ts` | 主题模式解析（跟随系统 / 日间 / 夜间）、强调色白名单、主题清单稳定性（纯函数，不依赖 DOM） |
| `requestAssertions.ts` | 催资源标题归一化 / 精确匹配、本机仓储去重与每日上限、Supabase 请求形状与错误映射（注入 storage / fetch，不出网） |
| `structuredDataAssertions.ts` | 新字段默认值 / 关系方向与校验 / 词表归一化与合并删除 / 本地与 GitHub 仓储的原子写入、409 重放、未知字段保留（注入 storage / fetch，不出网） |

六份断言集都由 `scripts/selftest.mts` 在命令行消费（原先公开站的调试台已随
`/debug` 入口一起移除，避免开发页面进入生产包）。同一支脚本还跑**静态守卫**：
除了原有的「只有仓储能读 db.json」等三条，还新增「催资源仓储只能装配一次」
「Supabase SQL 的安全不变量（RLS / security definer / 不暴露身份列 / 不出现
`service_role` 等）」「`.vue` 不写死 hex 颜色」「`.vue` 不用固定 Tailwind 调色板」
「前端不出现 `service_role`」「index.html 与 useTheme 使用同一组 storage key」等源码扫描。

> ⚠️ 催资源的 **SQL 本身没有自动化测试**：selftest 只验证客户端仓储与请求形状，
> 真实 RLS / RPC / PostgREST 行为必须在 Supabase 项目里按 §7.4 的步骤实测。

> **后台断言不依赖线上数据内容**：`runAdminAssertions` 启动时先向本地仓储注入
> 一组合成 fixture（`FIXTURE_GAMES`），再跑状态统计 / 批量 / 标签 / 作者等断言。
> CI 在 `data:pull` 之后运行，站长随时可能删改真实条目 —— 断言不能把条目标题或 id 编码进去。

> 截至 2026-10-27：`selftest` **1115/1115**、`test:catalog` **3/3**、`test:data-quality` **1/1**、
> `smoke` **16/16**、UI 点击测试 **99/99**，`check:data --strict` 在当前快照 error 0；
> 完整 `npm run verify` 通过（含 build）。
> 条数会随断言增长，后续以运行输出为准 —— 这也是下面提醒不要写死条数的原因。

> ⚠️ **不要在文档里写死断言条数**（比如"29 项"）。条数每个阶段都在涨，
> 写死就意味着每加一条断言都要回来改文档，很快就会失真。

实现方式：用 `esbuild` 把 `scripts/selftest.mts` 打成 `.tmp/selftest.mjs`（`--external:vue`），
再用 Node 直接跑。**不需要 vitest / jsdom**。

GameJolt 抓取 / 转换 / 扩展打包的测试放在 `scripts/gamejolt/test.mjs` 与
`extension/capture.test.mjs`，用 Node 内置的 `node --test` 跑（`npm run test:gamejolt`）。
它**不联网**：`fetchGameJoltGame()` 允许注入 `fetchImpl`，扩展的 ZIP 打包也是纯函数，
所以接口 500、字段缺失、简介超长、图片去重这些分支都能稳定复现。

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
它挂在 `AdminLayout` 上，所以后台每个页面都会被检查；公开站的视觉红线由
`tailwind.config.js` 的覆盖式配置、全局 CSS 重置与 UI 测试的视觉哨兵共同保证。

### 2.4 UI 点击测试（交互行为，SSR 覆盖不到的部分）

`npm run smoke` 只验证「路由能渲染出 DOM」，验证不了「点下去会发生什么」。
勾选、批量执行、二次确认、保存、未保存拦截、标签增删 —— 这些只能靠真实浏览器点。

脚本在 `scripts/ui-test.mjs`（**已纳入版本管理**），`playwright` 在 `devDependencies` 里。
它用 Playwright 驱动**系统已安装的 Chrome**（`channel: 'chrome'`），因此**不需要下载 Chromium**。
脚本从自身位置推导项目根目录，所以从任何 cwd 启动都可以。

```bash
# 1. 另开一个终端起 dev server
npm run dev

# 2. 跑（默认 http://localhost:5173）
npm run test:ui

# 3. 跑（对生产构建预览，需要 npm run build && npm run preview -- --port 4173）
BASE=http://localhost:4173/fnaf-fan-games-archive PROD=1 npm run test:ui
```

> GameJolt 导入的两步都在 Playwright 层 mock / 构造夹具：本机助手与 CDN 响应被路由拦下，
> ZIP 导入则用 `fflate` 现场生成一个真实压缩包。因此 UI 测试**不依赖外网**、
> 也不会向真实数据仓上传图片。断言的仍是后台自己的字段映射、ZIP 校验、图片上传和保存路径。
>
> 扩展本身的端到端流程（同源抓取 → 下载图片 → 打包 ZIP）用 `npm run test:extension` 单独跑；
> 它同样用系统 Chrome，并把构建好的 `content.js` 注入一个被接管的 GameJolt 页面。
>
> 本轮起，UI 测试脚本还包含主题持久化（刷新后仍是同一模式 / 强调色）与本机模式催资源的
> 提交 / +1 / 自动「已收录」用例。远程 Supabase 路径**不连真实项目**，由 selftest 的
> 注入 fetch 覆盖；SQL 本身需要按 §7.4 的步骤手动验证。
>
> ⚠️ 催资源 UI 用例开头会断言首页显示「本机模式」。跑 `test:ui` 的 dev server
> **不要**配置 `VITE_SUPABASE_*`，否则测试会在写入前直接失败，避免把探针数据
> 提交到真实的共享榜单。

> ⚠️ **三个必须知道的坑**（写这个脚本时全踩过）：
> 1. **脚本必须自己定位项目根目录**（`import.meta.url`），不要依赖 cwd ——
>    从 `scripts/` 或仓库根启动时，读 `src/data/db.json` 和写截图目录的相对路径基准不同。
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
├── .github/workflows/deploy.yml    # Pages 自动部署（构建前跑完整质量门禁）
├── public/
│   └── images/*.svg                # 占位图，由 npm run assets 生成
├── scripts/
│   ├── gen-placeholders.mjs        # 占位图生成器
│   ├── pull-data.mjs               # 从数据仓同步 db.json（保留 taxonomy 与未知顶层键）
│   ├── catalog-document.mjs        # 数据仓文档解析 / 序列化（未知字段保留）
│   ├── catalog.test.mjs            # 数据仓文档测试（node --test）
│   ├── selftest.mts                # 命令行入口：深模块自检 + 静态守卫
│   ├── smoke.ts                    # 命令行入口：SSR 冒烟
│   └── ui-test.mjs                 # 命令行入口：浏览器点击测试（需 dev server + Chrome）
├── supabase/
│   └── resource_requests.sql       # 催资源初始化：表 / RLS / 公开视图 / security definer RPC
├── src/
│   ├── components/                 # 公开站可复用 UI 组件
│   │   ├── Button.vue              # 基础按钮（solid/outline/ghost × md/lg）
│   │   ├── Card.vue                # 基础容器（interactive 模式有悬停左边框变红）
│   │   ├── GameCard.vue            # 格子卡片（复用 Card）
│   │   ├── FilterPanel.vue         # 筛选与排序面板
│   │   ├── DownloadPanel.vue       # 下载区 + 提取码复制
│   │   ├── ThemeSwitcher.vue       # 主题切换（模式 + 5 种强调色；公开站 / 后台共用）
│   │   ├── ResourceRequestBoard.vue  # 首页「催资源」榜单（待上传 + 已收录）
│   │   ├── ResourceRequestDialog.vue # 催资源弹窗（先搜站内，再提交 / +1）
│   │   ├── StyleAuditBadge.vue     # 视觉规范运行期哨兵（后台布局挂载）
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
│   │   ├── useAdminGames.ts        # ★ 后台深模块：状态/筛选/排序/分页/勾选/写入/删除/标签级操作
│   │   ├── useAdminGameDraft.ts    # ★ 编辑器草稿态（**工厂**，非单例）+ 纯函数校验/转换 + provide/inject
│   │   ├── useAdminAuth.ts         # 令牌登录状态
│   │   ├── useGamePreview.ts       # 草稿 → 预览页的跨标签页传递
│   │   ├── useSearchField.ts       # 搜索框绑定（避免受控输入回写光标）
│   │   ├── useTheme.ts             # ★ 主题单例：模式偏好 / 强调色 / 系统监听 / 跨标签页同步
│   │   ├── useResourceRequests.ts  # ★ 催资源深模块：加载 / 提交 / 投票 / 缓存 / 已收录推导
│   │   └── useViewCounter.ts       # 浏览量（remote / static 双模式；后台预览不计数）
│   ├── config/
│   │   ├── requests.ts             # 催资源 Supabase 配置（URL + anon public key；任一为空 = 本机模式）
│   │   └── taxonomy.ts             # 初始词表（仅 taxonomy 缺失时兜底，不自动写入数据仓）
│   ├── data/
│   │   └── db.json                 # ★ 构建期单一事实来源：所有游戏数据
│   ├── repositories/               # ★ 数据访问层（Phase 11）
│   │   ├── gameRepository.ts       # 接口契约：后台只允许通过它读写数据
│   │   ├── localGameRepository.ts  # 本地实现（localStorage，刷新不丢）· 唯一读 db.json 的地方
│   │   ├── githubGameRepository.ts # 远程实现（数据仓 db.json + images/，含 409 重放与删图闸）
│   │   ├── localResourceRequestRepository.ts     # 催资源本机实现（未配置 Supabase 时的真实降级）
│   │   ├── supabaseResourceRequestRepository.ts  # 催资源远程实现（REST 视图 + RPC）
│   │   ├── dataRepo.ts             # 数据仓坐标与 Pages 基址
│   │   └── index.ts                # ★ 当前生效的仓储 —— 唯一的切换点
│   ├── dev/
│   │   ├── libraryAssertions.ts    # ★ 前台断言集（命令行消费）
│   │   ├── adminAssertions.ts      # ★ 后台断言集（命令行消费，含合成 fixture）
│   │   ├── themeAssertions.ts      # ★ 主题断言集（纯函数）
│   │   ├── requestAssertions.ts    # ★ 催资源断言集（注入 storage / fetch，不出网）
│   │   ├── structuredDataAssertions.ts # ★ 结构化字段 / 词表 / 关系 / 仓储断言集
│   │   └── viewCounterAssertions.ts # ★ 浏览量断言集（注入 fetch 桩，不出网）
│   ├── layouts/
│   │   ├── Layout.vue              # 公开站骨架：Header + RouterView + Footer
│   │   └── AdminLayout.vue         # 后台骨架：后台 Header + 侧栏 + RouterView
│   ├── router/
│   │   ├── routes.ts               # 路由表（双 Layout 嵌套，与实例分离便于测试复用）
│   │   └── index.ts                # createRouter + Hash history
│   ├── services/
│   │   ├── viewCounter.ts          # 浏览量适配器（ViewProvider）
│   │   └── abacusViewProvider.ts   # Abacus 实时计数（仅生产构建注册）
│   ├── styles/index.css            # Tailwind 入口 + 全局硬重置（视觉规范最后防线）
│   ├── types/
│   │   ├── game.ts                 # 领域模型 Game / DownloadLink / GameMetrics / GameStatus / 关系与开发状态
│   │   ├── admin.ts                # 后台视图模型 AdminGame + 查询类型 + 状态文案表
│   │   ├── taxonomy.ts             # 分类词表类型 / 限额 / 变更结果
│   │   └── resourceRequest.ts      # 催资源模型 / 仓储接口 / 共享上限 / 可展示错误
│   ├── utils/
│   │   ├── asset.ts                # ★ assetUrl()：拼接 BASE_URL
│   │   ├── clipboard.ts            # copyText()：两级回退的剪贴板写入
│   │   ├── datetime.ts             # ★ formatTimestamp()：按查看者本地时区渲染
│   │   ├── gameDefaults.ts         # ★ normalizeGame()：补齐可选字段的缺省值
│   │   ├── gameFactory.ts          # ★ 新建 / 打补丁 / slugify / 深拷贝
│   │   ├── relations.ts            # 关系类型 / 方向文案 / 归一化 / 保存前校验
│   │   ├── taxonomy.ts             # 词表归一化 / 查询 / 创建 / 改名 / 合并 / 删除
│   │   ├── imageInspect.ts         # 尺寸校验与比例提示（纯函数 + 浏览器读数）
│   │   ├── imageProcess.ts         # 上传前缩放 + 转 WebP（GIF/SVG 保持原样）
│   │   ├── requestClient.ts        # 浏览器去重身份（UUID；不是安全凭据）
│   │   └── requestMatch.ts         # 标题归一化 / 精确匹配 / 榜单排序
│   └── views/
│       ├── Home.vue                # 首页：Hero + 筛选 + 网格 + 分页
│       ├── GameDetail.vue          # 详情页：标题 + Banner + 数据表格 + 下载 + 截图灯箱
│       ├── NotFound.vue            # 404
│       └── admin/                  # 后台视图
│           ├── AdminLogin.vue      # /admin/login：令牌登录（唯一豁免认证的后台路由）
│           ├── AdminGames.vue      # /admin/games：游戏管理列表
│           ├── AdminGameEditor.vue # /admin/games/new 与 /:id/edit：编辑页（含永久删除）
│           ├── AdminGamePreview.vue # /admin/preview：未保存草稿的预览
│           ├── AdminTaxonomy.vue   # /admin/taxonomy：标签与作者合并管理
│           ├── AdminVocabulary.vue # /admin/vocabulary：玩法 / 机制 / 平台词表
│           └── AdminNotFound.vue   # 后台 404（防止输错的后台地址掉回公开站外壳）
├── tailwind.config.js              # ★ 覆盖式配置：违规工具类直接不生成
├── vite.config.ts                  # base 按 command 区分
└── vite.smoke.config.ts            # 冒烟测试专用构建配置
```

---

## 4. 架构

### 4.1 数据流

```
数据仓 db.json ──构建时写入──▶ 构建期快照（打进 dist）
                                      │ 首屏 / 断网兜底
                                      ▼
                              publicGameRepository
                                      ▲
                                      │ 公开页挂载 / 重新可见时 fetch 最新 db.json
数据仓 db.json ───────────────────────┘

后台（登录后）：数据仓 db.json ◀──读写──▶ GitHubGameRepository
```

**前台是「快照兜底 + 非阻塞同步」，后台直接读写数据仓。**

- **前台首屏**读构建期快照：访客不等网络、断网也能看。
- **前台随后**在公开页挂载 / 标签页重新可见时拉一次数据仓，替换内存目录
  （作品与 `taxonomy` 一起 hydrate；词表缺失或结构不可用时保留当前词表）；
  这样后台改完不需要等构建，两个页面看到的是同一份数据。
- **后台**读写数据仓：保存 = 一次提交，改动是真的线上数据。

快照仍然有用：它保证首屏和离线可用；同步失败时也靠它。但「必须等构建才更新」
这条旧语义已经不成立 —— UI 提示条也已改成「下次打开 / 切回页面时自动同步」。

> **「催资源」是另一条独立侧链路**：请求数据在 Supabase（或访客本机 localStorage），
> 不参与构建、不写数据仓。游戏目录仍然以 GitHub 数据仓为唯一事实来源。见 §7.4。

> ⚠️ **未登录时 `adminGameRepository` 就是本地仓**，但登录门禁会先把 `/admin` 拦住，
> 所以这条路径在生产上不可达（它是测试与开发用的）。
> 由此**本地仓的写入 / 本地存档 / 「恢复出厂数据」在生产路径上已是死代码** ——
> 清理与否留待 Phase 19/20，现在保留是因为断言覆盖着它们。

### 4.2 Repository 层（Phase 11）

后台**只允许**通过 `GameRepository` 读写数据。核心读写方法仍是
`listGames` / `getGame` / `createGame` / `updateGame` / `deleteGame` / `publishGame` / `unpublishGame`；
Phase 1 另增加 `taxonomy` / `taxonomyIssues` / `hydrate(games, taxonomy?)` 与四个词表写方法
（见「结构化资料库地基」一节）。

**与仓储相关的三条规则由自动化守住**（`scripts/selftest.mts` 的「静态守卫」组，会扫源码、失败即中断构建）：

| 守卫 | 规则 |
| --- | --- |
| 只有仓储可以读 `db.json` | 白名单只有 `localGameRepository.ts` |
| 后台视图不引仓储的具体实现 | `views/admin` 与 `components/admin` 只能 import `../repositories` 的当前实例；`localGameRepository` / `githubGameRepository` 都算具体实现 |
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
  setSortBy(key: 'recommended' | 'views' | 'score' | 'title' | 'year'): void
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

- **色彩（浅色默认值）**：纸 `#fafaf8` / 墨 `#1a1a18` / 强调赤红 `#a94a4a` / 辅助线 `#d4d4d0` / 浅层表面 `#f2f2ef`。
  深色模式整体替换为另一组变量（纸 `#141413` / 墨 `#e8e8e4`）；强调色有赤红 / 靛蓝 / 青绿 / 藕粉 / 紫灰五种，
  全部通过语义 token 使用，详见 §5.4。不要再往组件里写死色值。
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
这一层是最后的兜底：即使某个组件或未来嵌入的外部内容漏写了工具类，也不会破坏红线。

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

### 5.4 主题系统（浅色 / 深色 + 强调色）

**它只改颜色，不改形状。** 圆角、阴影、渐变、对齐、字体、间距与动效上限全部不变 ——
主题不是「换一套皮肤」，而是把颜色从组件里抽成一层语义变量。

- **模式偏好**：跟随系统（默认）/ 日间 / 夜间。跟随系统时监听 `prefers-color-scheme`，
  系统主题变化会实时生效；切到日间 / 夜间后移除该监听。
- **强调色**：赤红（默认）/ 靛蓝 / 青绿 / 藕粉 / 紫灰，五种低饱和色。
- **作用范围**：公开站与后台共用同一份设置（模块级单例），但**只保存在当前设备**，
  不跨设备同步。切换器在 `Layout.vue` 与 `AdminLayout.vue` 里都挂了一份。

| 文件 | 职责 |
| --- | --- |
| `src/styles/index.css` | `:root` 下的 CSS 变量；`data-mode` / `data-theme` 切换浅色、深色与五种强调色 |
| `tailwind.config.js` | 把变量映射成语义工具类（`ink` / `paper` / `line` / `surface` / `accent` 等） |
| `src/composables/useTheme.ts` | 模块级单例：读取 / 写入本机偏好、解析系统模式、跨标签页同步 |
| `src/components/ThemeSwitcher.vue` | 顶部「主题」下拉：模式 + 强调色；Esc / 外部点击 / 路由变化关闭 |
| `src/layouts/Layout.vue`、`AdminLayout.vue` | 两套外壳都挂同一个切换器 |
| `index.html` | 样式与 Vue 之前的内联脚本：先按 storage 设置根元素属性，避免深色模式首屏闪白 |
| `src/dev/themeAssertions.ts` | 模式解析 / 强调色白名单 / 主题清单的纯函数断言 |

**storage key（内联脚本与 `useTheme.ts` 必须完全一致）**：

```
fnaf-archive:theme-mode:v1      # system | light | dark
fnaf-archive:theme-accent:v1    # red | blue | teal | pink | purple
```

> `selftest` 有一条静态守卫专门比对 `index.html` 与 `useTheme.ts` 的 key；
> 改一处漏一处会直接让门禁失败。内联脚本还会在 `localStorage` 不可用时按「跟随系统」降级。

**语义 token 规则**（新组件、改旧组件都按这个来）：

| token | 用途 |
| --- | --- |
| `ink` / `paper` | 正文 / 背景 |
| `line` / `surface` | 分隔线 / 低层表面 |
| `inverse` / `inverse-fg` | 页脚、灯箱等反色区域 |
| `overlay` | 弹窗遮罩 |
| `accent` | 文字、边框、小面积悬停 |
| `accent-surface` | 大面积色块（主按钮悬停、错误条、已收录提示） |
| `accent-bright` | 反色底（页脚 / 灯箱）上的链接与强调文字 |
| `on-accent` | `accent-surface` 上的前景色（不随主题反转） |

- **颜色只在 `src/styles/index.css` 的变量里定义。** `.vue` 里写死 hex、或用 Tailwind 固定调色板
  （`bg-red-500`、`text-gray-600` 之类）会被 `selftest` 的静态守卫拦下 —— 它们不会跟随主题变化。
- `accent` 的取值要保证在 paper 上可读；`accent-surface` 要保证与 `on-accent` 有足够对比度。
  深色模式下 `accent` 会变浅（用于深纸上的文字 / 边框），`accent-surface` 会变深（承载近白字）。
- 根元素同时切换 `color-scheme`，`body` 的背景 / 文字跟着变量走，`<meta name="theme-color">` 也会换，
  移动端地址栏不会和页面颜色打架。

**⚠️ `white` / `black` 已被重映射**：

```
white → paper   浅色是纸白，深色是深纸底
black → ink     浅色是墨色，深色是浅色文字
```

这样存量组件里的 `bg-white` / `text-black` / `bg-black` / `text-white` 不用批量改写，
也能随主题反转。**但不要在强调色 / 反色底色上用 `white` / `black` 指定前景** ——
它们在深色模式下会反转成错误的方向：

- `bg-accent*` 上必须用 `text-on-accent`；
- 页脚 / 灯箱等反色区域必须用 `inverse` / `inverse-fg`。

> 新增颜色前先问一句：它在浅色和深色下都成立吗？只成立一边的，就不该是语义 token，
> 而应该是某个模式下单独覆盖的变量。

---

## 6. 常见迭代任务怎么做

### 6.1 新增 / 修改一款游戏

**线上数据请走后台**：`/#/admin` 登录后新增 / 编辑，保存即提交数据仓，
公开页会在下次打开或切回标签页时自动同步。GameJolt 上有原作页面的作品，
建议先用浏览器扩展导出 ZIP，再拖进后台「从 GameJolt 导入」抓取字段与图片
（见 §7.3），最后人工补下载渠道。

`src/data/db.json` 只是**本地开发 / 断网兜底快照**。直接手改它不会影响线上，
除非重新构建并发布；需要与线上对齐时先跑 `npm run data:pull`。字段契约见
`src/types/game.ts`：

```json
{
  "id": "唯一短横线小写", "title": "英文原名", "author": "作者", "releaseYear": 2017,
  "ipSeries": "FNAF 主线同人", "engine": "Unreal Engine 4",
  "coverImage": "/images/<id>-cover.svg", "bannerImage": "/images/<id>-banner.svg",
  "gallery": ["..."], "videoUrl": "https://...",
  "description": "中文简介...",
  "downloads": [{ "provider": "123云盘", "url": "https://...", "password": "abcd" }],
  "metrics": { "fakeViews": 0, "score": 4.8 }
}
```

本地占位图用 `npm run assets` 生成（真实封面替换同名文件即可，`db.json` 不用改）。
**注意**：占位图生成器按数组顺序编号（`NO.01`…），插入新条目会改变后续编号。

后台保存的是数据仓里的 `db.json`，与本文件无关；`selftest` 的断言从数据推导期望值，
**不要**再写死「共 6 款」「共 5 位作者」这类内容断言（否则线上数据一变、CI 就假失败）。

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

### 7.1 浏览量 —— 适配器 + Abacus 实时计数

详情页的浏览量由 [Abacus](https://v2.jasoncameron.dev/abacus/) 实时计数：
生产构建在 `main.ts` 注册 `createAbacusViewProvider({ namespace: 'fnaf-fan-games-archive' })`，
每次打开详情页向 `/hit` 发一次请求（自增并返回新值）；失败 / 超时静默降级为
`db.json` 的 `metrics.fakeViews`（静态基数）。

- **只在生产构建启用**：`npm run dev` / UI 测试不注册 provider，反复打开不会刷线上数字。
  （`npm run preview` 也是生产构建，会真的计数；本地批量验证请拦截 Abacus 请求。）
- **后台预览不计数**：预览复用真实 `GameDetail`，`useViewCounter` 以 `track: () => false`
  跳过自增 —— 否则管理员每预览一次都在刷量。
- **key = 作品 id**：Abacus 只接受 `[A-Za-z0-9_.-]{3,64}`；不合法 id 直接不发请求。
- **4 秒超时**：统计不能把页面挂在「载入中…」。
- **免费、免注册、CORS 开放**，限流 30 次 / 10 秒 / IP；单次浏览只发 1 个请求。
  计数是易失指标，不写回数据仓；服务不可用时显示静态基数，站点照常可用。
- **没有防刷能力**：纯静态站拿不到可信的访客身份，数值只作参考（页面文案也这么写）。
  `/hit` 自动建 key 且不返回 admin key，被刷后无法重置；要可管理的计数得用 `/create`
  预建 key 并把 admin key 存在数据仓之外。

换后端只需实现 `ViewProvider { id, read, increment }`，在 `main.ts` 换一行注册，
组件不用改。`src/dev/viewCounterAssertions.ts` 用注入的 fetch 桩覆盖请求形状、响应解析、
非法 id、自增失败读旧值、抛错 / 超时降级 —— **不出网**。

> `metrics.fakeViews` 仍然保留：列表的「热度」排序用它（实时数只在详情页取，
> 逐个作品拉全量计数会打满免费服务限流），计数服务不可用时也用它兜底。

> 关于两种模式：`useViewCounter` 在 **static 模式下同步取值**（否则 SSR 首帧会永远卡在
> "载入中"），remote 模式才走异步 + `isLoading`。

### 7.2 评论区 —— 已按产品决策移除

详情页不再有评论 / Giscus 区块。以下内容已从代码库、构建产物和测试里一并删除：

- `src/components/CommentSection.vue`
- `src/config/giscus.ts`
- `public/giscus-swiss.css`
- `GameDetail.vue` 的「讨论」区块、相关断言与文案

如果以后重新引入评论，请先想清楚为什么需要它，并作为一个新功能重新评估：
Hash 路由下讨论串映射、跨域 iframe 的样式约束、审核与滥用处理，都会重新成为问题。

### 7.3 GameJolt 半自动导入 —— 扩展 ZIP（运维主路径）+ 本机助手（开发备用）

**它做什么**：在 GameJolt 作品页把标题、作者、发行年份、开发引擎、简介、一句话简介、
视频 URL、标签和图片抓下来，自动填进后台草稿；图片走现有处理链路（缩放 + WebP）上传到数据仓。

**它不做什么**：

- **不碰下载渠道**。游戏文件仍然由人工下载、上传网盘，再把链接填进后台 ——
  这是产品决定，工具不会把 GameJolt 的下载地址伪装成网盘渠道。
- **不自动保存 / 不自动发布**。导入只改草稿，用户仍要点「保存」；新建条目默认是草稿。

#### 方式一：浏览器扩展 + ZIP（推荐给所有运维）

扩展的 content script 运行在 `gamejolt.com` 页面里，请求 `/site-api` 属于**同源请求**，
因此不需要本机助手、不需要 Node、不需要保持任何进程开启。图片 CDN `m.gjcdn.net`
返回 `Access-Control-Allow-Origin: *`，扩展可以直接下载。

**安装 / 更新**：

```bash
npm run build:extension
# 产物在 extension/dist/
```

- Chrome：`chrome://extensions` → 打开「开发者模式」→「加载已解压的扩展程序」→ 选 `extension/dist/`
- Edge：`edge://extensions` → 打开「开发人员模式」→「加载解压缩的扩展」→ 选 `extension/dist/`

**使用**：

1. 打开任意 GameJolt 作品页（`/games/<slug>/<id>`）；
2. 点右下角「导出到 FNAF 档案」；
3. 扩展抓取数据、下载图片、生成 `<slug>-<id>-<时间>.zip`；
4. 到后台「新增游戏 / 编辑游戏」→「从 GameJolt 导入」→ 把 ZIP 拖进去；
5. 检查预览 →「填入表单并上传图片」→ 手动补下载渠道 →「保存」。

**ZIP 结构**：

```
manifest.json   格式版本 / 来源 / 抓取时间 / 图片 URL → 文件映射
capture.json    已归一化的 GameJoltImportData（与助手路径同一形状）
images/...      封面 / Banner / 截图
README.txt      给人看的导入说明
```

**为什么是 ZIP 不是 RAR**：浏览器端没有可靠的纯 JS RAR 编码器；ZIP 是标准容器，
扩展用 `fflate` 生成 store 模式（图片已经压缩过，再 deflate 没意义），后台用同一库读取。

**安全边界**：

- 扩展只申请 `gamejolt.com` / `www.gamejolt.com` / `*.gjcdn.net` 的 host 权限，
  **不读取、不发送 GitHub 令牌**；
- 一次点击只抓一个作品，不做批量爬取；
- 后台把 ZIP 当**不可信输入**：只接受固定格式标识与版本、GameJolt 来源域名、
  白名单条目；限制压缩包 64 MB / 解压后 128 MB / 40 个条目；
- 图片仍要通过 `createImageBitmap` 解码和原有尺寸校验（单文件 4 MB 上限），
  包内 HTML / JS 一律不执行；
- 扩展不上传任何数据，ZIP 只是本地下载文件。

**分发方式**：内部用「加载已解压扩展」最简单；要给非技术运维并自动更新，
可把 `extension/dist/` 打包上架 Chrome Web Store / Edge Add-ons 的不公开条目
（需要开发者注册和审核，更新后由商店自动推送）。

#### 方式二：本机助手（开发 / 调试备用）

GameJolt 的 `/site-api` 不返回可跨域读取的 CORS 头，普通页面直接 `fetch` 会被拦。
助手跑在 `127.0.0.1:4317`，只代理两个 JSON 接口；图片仍由浏览器直接下载。
它现在主要用于开发、调试和没有安装扩展的场景。

```bash
# 终端 1：启动助手（保持窗口开启）
npm run gamejolt:helper

# 终端 2（或已经在跑）：开发服务器 / 线上后台都可以
npm run dev
```

然后在后台「方式二」粘贴链接 → 抓取信息 → 检查预览 → 「填入表单并上传图片」→ 补下载渠道 → 保存。
线上后台（GitHub Pages）访问 `http://127.0.0.1:4317` 属于回环地址，Chrome / Edge 允许；
助手已经处理了 Private Network Access 预检。

- 只绑定 `127.0.0.1`，不暴露到局域网；
- 只允许 `https://daxigua732.github.io` 与 `localhost` / `127.0.0.1` 的任意端口作为 Origin，
  可用 `GAMEJOLT_ALLOWED_ORIGIN` 追加自定义域名；
- 输入只接受 `gamejolt.com` 的作品链接或纯数字 ID，请求地址由助手自己拼，不接受任意 URL；
- **助手完全接触不到 GitHub 令牌**。

#### 已知限制

- 依赖 GameJolt 的**内部站内接口**，对方改版时可能失效；扩展和后台都会给出可见报错，
  不会静默写入半条数据；
- 简介超过 2000 字会截断（后台字段上限），完整内容请打开原页；
- 图库最多导入 8 张；低于本站最小尺寸或超过 4 MB 的图片会被跳过并提示；
- 抓到的文本是 GameJolt 原文，不会自动翻译；IP 系列只在识别到 FNAF 字样时自动填 `FNAF`；
- 改助手端口：`npm run gamejolt:helper -- --port 4318`，并在构建时设置
  `VITE_GAMEJOLT_HELPER=http://127.0.0.1:4318`。

相关文件：

- `extension/` —— MV3 扩展（content script / 抓取打包纯函数 / 测试）
- `scripts/build-extension.mjs` —— 构建到 `extension/dist/`
- `scripts/gamejolt/` —— 解析 / 抓取 / 本机助手 / 测试
- `src/services/gamejoltCapture.ts` —— ZIP 读取与安全校验
- `src/services/gamejoltImport.ts` —— 后台字段映射与图片导入
- `src/components/admin/AdminGameJoltImport.vue` —— 两种导入方式的 UI

### 7.4 资源请求（催资源）—— 首页公开榜单

**它做什么**：访客在首页「资源请求」区提交「想要但站内还没有」的游戏；榜单按催更人数排序，
管理员按呼声补资源。它**不写游戏目录、不参与构建**，与 GitHub 数据仓是两条独立链路。

**用户流程**：

1. 首页点「＋ 催一个资源」打开弹窗。**先搜站内，再提交** —— 避免为已经存在的作品重复建请求。
2. 输入至少 2 个字符后，弹窗列出站内可能相关的作品（`useGameLibrary.searchGames`）。
3. **归一化标题精确命中**站内可见作品时，只给详情链接，不出现提交按钮。
4. 已有同标题的开放请求时，只显示「已有 N 人催过」和「+1 催」，不重复建条目。
5. 两者都没有才允许提交；提交者自动算该请求的第一票。
6. 站内后来出现同名作品时，请求自动移入「已收录」并链接到详情页，不再占用待上传榜位。

**排名与公平性**：

- **一票 = 一个不同的浏览器 client id**。同一浏览器对同一请求只计一票；提交者自己算第一票。
- 排序是**票数降序 → 提交时间升序 → id**（最后一项保证顺序稳定）。
- 每个 client **24 小时内最多新建 5 条**请求；达到上限后仍可给已有请求 +1。
  每日上限只限制「新建」，不限制投票。
- ⚠️ client id 是 `localStorage` 里的浏览器生成随机 ID（通常是 UUID），只是**去重身份，不是安全凭据**：
  清掉浏览器存储就能重新投。它防的是正常访客的重复点击，不是恶意刷票；
  要更强的公平性，得引入真实账号 / 服务端限流。

**两种存储模式**：

| 场景 | 数据在哪 | 行为 |
| --- | --- | --- |
| 两个 `VITE_` 变量没有同时配置 | 本机 `localStorage` | **本机模式**：刷新不丢、去重与每日上限仍生效，但别的访客看不到；支持 Web Locks 的浏览器会串行化多标签页写入 |
| URL + anon key 都配置 | Supabase | **全站共享**：读公开视图，提交 / 投票走 RPC |
| 配了 Supabase 但连不上 | 最近一次缓存 | 榜单显示缓存 + 明确提示；**提交 / 投票直接报错**，不会偷偷写本机队列 |

本机模式的数据键是 `fnaf-archive:resource-requests:v1`（请求 + 投票明细同一份 JSON）；
远程模式的榜单缓存键是 `fnaf-archive:resource-requests-cache:v1`；
本机已投记录是 `fnaf-archive:request-voted:v1`；浏览器身份是 `fnaf-archive:request-client:v1`。

> 「配了但不可达」时刻意**不退回本机写入**：否则同一台浏览器会同时存在两套互不相干的请求数据，
> 用户以为提交成功、实际上没有任何人能看到。宁可报错，也不制造分叉。

**Supabase 接入步骤**：

1. 在 Supabase Dashboard → SQL Editor 执行 [`supabase/resource_requests.sql`](./supabase/resource_requests.sql)。
   脚本可重复运行（`IF NOT EXISTS` / `CREATE OR REPLACE` / 先 DROP 再建策略）。
2. 在项目根目录新建 `.env.local`（**不要提交**）：

   ```bash
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<Project Settings → API → anon public key>
   ```

3. 重启 `npm run dev`，或重新 `npm run build` —— `VITE_*` 是**构建期变量**，改完必须重启 / 重建。
4. 如果 PostgREST 报找不到函数或视图，先在 SQL Editor 执行
   `notify pgrst, 'reload schema';`，再重试。

> ⚠️ `.env.local` 只影响本地 `npm run dev` / `npm run build`，**不会带到线上**。
> 线上 Pages 的构建在 Actions 里，`deploy.yml` 已从仓库 Variables 读取
> `${{ vars.VITE_SUPABASE_URL }}` 与 `${{ vars.VITE_SUPABASE_ANON_KEY }}` 注入 Build 步骤。
> 要开启线上全站共享，去 GitHub → Settings → Secrets and variables → Actions → **Variables**
> 新增这两项。anon public key 本来就是公开的，放 Variables 即可；
> **绝不要放 `service_role`**（它根本不该出现在前端构建里）。
> 任一变量缺失时，线上构建就是**本机模式**（请求只存在每个访客自己的浏览器里）。

**SQL 做了什么 / 安全边界**：

- `resource_requests` 存请求，`resource_request_votes` 存投票明细；两表都启用 **RLS**，
  且对 `anon` / `authenticated` 直接 `REVOKE` 表权限。
- 只授予安全列的 `SELECT`：`created_by_client`（创建者身份）与 `normalized`（归一化标题）不暴露；
  公开视图 `resource_request_board`（`security_invoker`）只含 `status = 'open'` 的展示列。
- 提交与投票只能调用 **security definer 函数**（`submit_resource_request` / `vote_resource_request`）。
  函数内做标题 2–80 / client id 8–64 校验、归一化去重、每日 5 条上限（advisory lock 防并发穿透）、
  `ON CONFLICT` 防重复投票。
- 同名 open 请求有**唯一索引**；两个 client 并发提交同名请求时，后到者会落到同一条并计票，
  不会把数据库错误抛给访客。
- **前端只使用 anon public key**。它本来就是公开的浏览器密钥，权限由 RLS / GRANT 决定。
  **绝对不要把 `service_role` key 放进前端、仓库或文档** —— 它会绕过 RLS，等于把整个数据库交给访客。
- 没有后台审核页。要人工下架某条请求，在 SQL Editor 把 `status` 改成 `hidden`；
  要手工标记完成，改成 `done`。两者都不再出现在公开视图里。

**「已收录」是推导出来的，不是人工状态**：

- 用**当前可见目录**（`isPubliclyVisible()`：`published` 且未归档）匹配；只认**归一化标题完全相等**。
- 归一化规则：**NFKC → 小写 → 去掉空白、标点与符号**。
  `'  Jolly  4!! '`、`'JOLLY-4'`、`'Jolly+4'`、`'ＪＯＬＬＹ－４'` 都会得到 `jolly4`。
  前端 `src/utils/requestMatch.ts` 与 SQL 的 `normalize_resource_request_title` 各有一份，
  **改一处必须同步另一处**。
- ⚠️ SQL 的 POSIX `[[:punct:]]` 对 emoji / 非 ASCII 符号的覆盖依赖数据库 locale，
  不一定与前端 `\p{S}` 完全一致（例如 `★`）。这类标题需要在真实 Supabase 项目实测；
  若出现同名请求分裂成两条，用 SQL Editor 人工合并（改掉其中一条的 `status`）。
- **为什么不用包含匹配**：请求《Jolly》时，站内已有《Jolly 4》并不代表前作已经上传。
  包含匹配会把《Jolly》静默判成已收录、从待上传榜消失 —— 这比多显示一条请求严重得多。
- 已收录只是展示层推导，数据库里的 `status` 仍是 `open`，因此它仍占着同名 open 唯一位。
  要彻底清掉，按上面的方式人工改成 `done` / `hidden`。
- 作品被下线或归档后不再算可见，请求会重新回到待上传榜。

**已知限制**：

- **远程榜单一次最多读 50 条**（PostgREST `limit=50`，按票数降序 —— 不是按提交时间取最近 50 条）。
  第 51 条之后即使有人催也看不到；本机模式没有这个上限。
- **本机模式的数据不会自动迁移到 Supabase**：后来配置远程模式时，之前只存在某台浏览器里的请求 /
  投票记录仍然只在那台浏览器，不会上传，也不会出现在全站榜。目前没有内置迁移工具，
  要保留只能手工导出 / 重建。
- **SQL 尚未在真实 Supabase 项目上执行过**。RLS / RPC / 视图 / PostgREST 缓存的真实行为，
  需要按上面的步骤实测后才能算验证完成。
- 没有后台审核页 / 限流面板；隐藏、标记完成只能进 SQL Editor。
- client id 可被清空重投，不是反滥用；投票结果只适合作为需求排序参考，不适合作为严格票选。
- Supabase 免费项目长期不活动会被暂停；这只影响请求榜，游戏目录仍由静态站 / GitHub 数据仓提供。
- 请求数据不写数据仓，因此不在 git 历史里，也没有 git 级别的回滚 / 审计；
  Supabase 免费版不含自动备份，清理 / 恢复要自己想办法（这也是它只用于低价值投票数据的原因）。

**测试覆盖**：

- `selftest` 的主题组覆盖模式解析、强调色白名单与主题清单稳定性。
- `selftest` 的催资源组覆盖标题归一化 / 精确匹配、本机仓储的提交 / 去重 / 投票 / 每日上限 /
  损坏存档 / 写入失败，以及 Supabase 请求形状、鉴权头、错误映射（注入 `fetch` 与 `storage`，**不出网**）。
- UI 点击测试覆盖本机模式的提交 / +1 / 自动「已收录」与主题持久化；
  **远程 Supabase 路径与 SQL 本身不在自动化门禁内**。

相关文件：

- `supabase/resource_requests.sql` —— 表 / RLS / 公开视图 / RPC
- `src/config/requests.ts` —— Supabase URL + anon key（任一为空 = 本机模式）
- `src/types/resourceRequest.ts` —— 模型 / 仓储接口 / 共享上限 / 可展示错误
- `src/utils/requestMatch.ts` —— 标题归一化 / 匹配 / 排序
- `src/utils/requestClient.ts` —— 浏览器去重身份
- `src/repositories/localResourceRequestRepository.ts` —— 本机实现
- `src/repositories/supabaseResourceRequestRepository.ts` —— Supabase REST + RPC 实现
- `src/composables/useResourceRequests.ts` —— 加载 / 提交 / 投票 / 缓存 / 已收录推导
- `src/components/ResourceRequestBoard.vue`、`ResourceRequestDialog.vue` —— 首页榜单与弹窗
- `src/dev/requestAssertions.ts` —— 催资源断言集

---

## 8. 部署

### 8.1 机制

`.github/workflows/deploy.yml`：push 到 `main` **或手动触发** → 依次跑
`npm ci --ignore-scripts` → data:pull → typecheck → test:gamejolt → build:extension
→ selftest → smoke → build → configure-pages → upload-pages-artifact → deploy-pages。

**部署前跑全部门禁是刻意的**，保证线上永远不会出现"编译通过但页面白屏"的版本。

Build 步骤会从仓库 **Actions Variables** 读取 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
（配置方法见 §7.4）；两个变量缺失时，线上构建就是本机模式。

Pages 配置：`build_type = workflow`。

### 8.2 `base` 路径

`vite.config.ts` 按 command 区分：

```ts
base: command === 'build' ? '/fnaf-fan-games-archive/' : '/'
```

好处：生产产物带正确子路径前缀，而**本地开发地址仍是 `http://localhost:5173/`**。
若仓库改名，**必须同步修改这里的字符串**，否则资源全 404。

### 8.3 ⚠️ 发布代码：沙箱内网络受限

默认沙箱的代理只放行 `api.github.com`，`github.com:443` 连不上，`git push` / `git fetch`
会超时；在允许网络的环境（用户自己的终端，或让代理以**免沙箱**方式执行）可以直接推送。
2026-10-24 的 `bc67a96` 就是这样推上去的：默认沙箱失败，免沙箱重试成功。

**两个选择：**

**A. 直接推送（推荐）**
在你自己的终端执行 `git push origin main`；或让代理在免沙箱网络下重试。

**B. 用 GitHub API 推送**（网络受限时的兜底）

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

### 9.7 Vue 模板注释必须用 `<!-- -->` 闭合

改模板时把注释结尾写成 `*/`（脚本注释的习惯），会把后面整个 `<td>` / 组件
一起吞进注释里。页面上表现为「这一列凭空消失」，但**类型检查、构建、SSR 冒烟全都通过**
（因为它在 HTML 里确实是一个合法注释），只有 UI 点击测试或真实浏览器能抓到。

> 模板注释统一 `<!-- ... -->`；`/* ... */` 只用于脚本。

### 9.8 `structuredClone` 不能复制 Vue 响应式代理

仓储的 `hydrate()` 最初用 `structuredClone(games)`，selftest 传入 `listGames()` 的
响应式条目时直接抛 `DataCloneError`（Proxy 不可克隆）。数据本来就是 JSON，
改用 `JSON.parse(JSON.stringify(...))` 深拷贝即可；不要为了「更现代」踩这个坑。

### 9.9 GameJolt 站内接口没有 CORS 头，图片 CDN 有

`https://gamejolt.com/site-api/...` 是给自家前端用的站内接口，响应不带
`Access-Control-Allow-Origin`，浏览器里直接 `fetch` 一定失败。**不要**试图用
公共 CORS 代理绕过（不稳定、会看到令牌/隐私风险），也不要把它搬到构建期
（后台需要按需抓取任意作品）。本机助手 `scripts/gamejolt/helper.mjs` 只代理 JSON，
并处理了 HTTPS → `127.0.0.1` 的 Private Network Access 预检。

图片是例外：`m.gjcdn.net` 返回 `Access-Control-Allow-Origin: *`，所以封面/截图
可以直接在浏览器里下载、缩放、走原有上传链路 —— 助手完全不需要碰图片。

### 9.10 图片上传文件名必须毫秒 + 随机后缀

`timestampTag()` 原来只精确到秒。图库连续上传两张时，同一秒内会生成**同一个路径**：
第二张覆盖第一张，返回的 URL 也相同，`addImages` 去重后图库凭空少一张
（UI 测试报「图库应有 2 张，实际 1」）。现在格式为
`YYYYMMDDHHmmssSSS` + 4 位随机后缀，单人/多标签页都不会撞名。

### 9.11 扩展的 content script 必须打包成 IIFE

Chrome / Edge 的 `content_scripts` **不支持** `"type": "module"`，直接写
`import ... from` 会在页面里报语法错误。所以扩展源码用 esbuild 打成 IIFE
（`npm run build:extension`），加载的是 `extension/dist/`，不是 `extension/src/`。

另外，**同源抓取只成立在 content script 里**：它运行在 `gamejolt.com` 页面内，
`/site-api` 是 same-origin。popup / background 属于扩展自己的 origin，
请求 GameJolt 仍会受 CORS 限制 —— 要挪到那边就得走 host_permissions 或再加代理。

### 9.12 ZIP 导入必须当不可信输入

`capture.json` 和 `manifest.json` 都是下载目录里的普通文件，用户可以把任意 ZIP 改名后拖进来。
`gamejoltCapture.ts` 因此只信任固定格式标识、版本、GameJolt 来源和白名单条目，
并限制压缩包 64 MB / 解压后 128 MB / 40 个条目；图片仍走 `createImageBitmap` + 尺寸校验。
不要为了省事直接 `JSON.parse` 后写进草稿，也不要把包内 HTML 渲染出来。

---

## 10. 迭代协议

原始需求文档第 5 节明确要求 AI 助手遵守以下协议，**请继续沿用**：

1. **单步执行** —— 一次不得输出超过三个组件的代码，按阶段逐步提交
2. **强制测试** —— 每完成一小步，明确提示用户去浏览器验证，等确认后再继续
3. **拒绝妥协** —— 若用户要求"加个圆角"或"加个阴影"，**必须拒绝**并指出这违反
   Swiss International Style 的绝对红线

### 收尾清单（每次改动）

```bash
npm run verify     # 全部自动化关卡必须全绿（含 check:data --strict）
# 若改了样式，再跑 §5.3 的产物 CSS 审计
# 然后按 §8.3 发布
```

---

## 11. 待办

- [x] **接入浏览量后端** —— 已接 Abacus 实时计数（§7.1）；计数服务不可用时回退静态基数
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
