# Phase 0 审计与设计冻结：结构化游戏资料库与索引系统

- 日期：2026-10-27
- 范围：只做审计与设计，不改业务代码、不改生产数据。
- 依据：`开发任务：结构化游戏资料库与索引系统升级.txt`、当前 `main` 分支实际代码、README / HANDOVER / 既有后台设计冻结文档。
- 工作区状态：上一轮「主题系统 + 催资源」的改动仍未提交。进入 Phase 1 前应先确认这批改动，避免两轮 diff 混在一起。

---

## 1. 当前具备什么、缺什么

### 1.1 已具备

**架构与数据**
- Vue 3 + Vite + TypeScript + Tailwind，GitHub Pages 纯静态部署，Hash 路由。
- 游戏目录以独立数据仓 `DaXiGui732/fnaf-fan-games-data` 的 `db.json` + `images/` 为唯一事实来源；代码仓只保留构建期快照 `src/data/db.json`。
- Repository 抽象：`localGameRepository`（快照 + localStorage）与 `githubGameRepository`（GitHub Contents API，整文件提交、SHA 乐观锁、409 重放）。
- 前台运行时同步：公开页挂载 / 重新可见时 `hydratePublicCatalog()` 拉取数据仓最新 `db.json`，失败保留快照。
- 公开可见性规则收敛在 `isPubliclyVisible()`：`status === 'published' && !archived`。

**前台**
- 首页含 Hero、催资源榜、游戏库（搜索 + 作者 / 年份 / 系列单选筛选 + 5 种排序 + 分页）。
- `useGameLibrary` 深模块负责可见性、搜索、过滤、排序、分页、过滤元数据；视图不手写目录数据的 `.filter()` / `.sort()`。
- 搜索覆盖 `title / author / ipSeries / engine`；筛选组间 AND、组内单选可取消。
- 过滤选项只从公开可见条目派生；分页页码会被夹紧到合法区间。
- 详情页展示封面、简介、图库、下载、评分/浏览，以及作者、年份、IP 系列、引擎、平台的事实表；标签为静态文本。

**后台**
- 游戏编辑器含 GameJolt 导入、基本信息、封面/Banner、图库、下载、标签、发布设置、推荐与排序；有草稿脏检查、离开保护、Ctrl/Cmd+S、预览、发布缺口提示。
- 标签与作者都是作品上的字符串，由派生列表管理；支持标签/作者重命名（批量改作品）、标签合并、标签删除确认；没有独立词条表。
- 新增游戏默认草稿；旧记录由 `normalizeGame()` 补默认值，不需要迁移。

**数据模型**
- 必填：`id / title / author / releaseYear / ipSeries / engine / coverImage / bannerImage / gallery / description / downloads / metrics`。
- 可选：`videoUrl / shortDescription / tags / platforms / status / featured / archived / sortOrder / createdAt / updatedAt / publishedAt`。
- `platforms` 已存在并在详情页展示，但后台不可编辑、搜索与筛选不识别，实际是休眠字段。
- `status` 是网站发布状态（`draft / published / offline`），不是游戏开发状态。

**质量门禁**
- `npm run verify` = typecheck + GameJolt 测试 + 扩展构建 + selftest + smoke + 生产构建。
- 当前基线：selftest 607、smoke 14、UI 81 步、GameJolt 22。
- UI 测试不在 CI 内，需要本地 dev server + 系统 Chrome。
- 文档声称 selftest 会扫 `.vue` 里的 `.filter()/.sort()`，但实际静态守卫中**没有这一条**；现有 `.vue` 也有若干非目录数据的本地 `.filter()`（批量选择、文件校验等）。

**数据现状（审计时）**
- 共 4 条，公开可见 3 条，草稿 1 条，归档 0 条。
- 作者 2 位（IvanG、Mannyboi），IP 系列只有 Jolly，引擎写法不完全统一。
- 4 条作品的 `tags` 全部是 `["Jolly"]`；`platforms` 4/4 为空。
- 封面/Banner/图库/下载各有缺项，简介多为空。
- 结论：数据量极小且几乎没有可用于分类的证据，**不能自动推断玩法、机制或作品关系**；只能由管理员逐条依据资料标注。

### 1.2 缺失

1. 玩法类型、游戏机制、开发状态、其他名称、来源页面等字段。
2. 可维护的分类词表：独立词条、稳定标识、定义、创建、改名、使用次数、重复防护、删除保护、合并；当前标签/作者只是字符串。
3. 平台的后台编辑、搜索与筛选；当前 `platforms` 是休眠字段。
4. 同维度多选（OR）、更多筛选维度、搜索覆盖新字段。
5. 详情页属性的可点击索引入口，以及索引结果的空状态 / 无效值处理。
6. URL 中的筛选状态：刷新、复制链接、前进后退目前都会丢。
7. 作品关联（前传/续作/重制/重启/衍生/同一世界观/相关）及其方向、校验、反向展示。
8. 关联作品选择器、无效引用 / 自关联 / 重复关系的保存校验与删除清理。
9. 同作者 / 同系列的相关作品派生展示；当前完全没有相关作品区域。
10. 数据质量检查（未分类、失效引用、重复词条）与相应文档。

---

## 2. 推荐数据模型与字段

### 2.1 游戏条目增量字段

全部新增字段保持 **optional**，由 `normalizeGame()` 补默认值；`AdminGame` 中变为必填（归一化后）。不重写旧记录。

```ts
export type DevelopmentStatus =
  | 'released'        // 已发布
  | 'in-development'  // 开发中
  | 'on-hold'         // 暂停开发
  | 'cancelled'       // 已取消
  | 'unknown'         // 未标注（默认）

export type RelationType =
  | 'prequel' | 'sequel' | 'remake' | 'reboot'
  | 'spin-off' | 'same-universe' | 'related'

export interface GameRelation {
  /** 关系从「当前作品」指向 targetId；方向语义固定，见第 4 节 */
  type: RelationType
  targetId: string
}

export interface Game {
  // ……现有字段不变……
  altTitles?: string[]              // 其他名称，≤5，搜索可见
  gameplayTypes?: string[]          // 词表 ID；第一项 = 主要玩法；≤3
  mechanics?: string[]              // 词表 ID；≤12
  platforms?: string[]              // 词表 ID；≤8（字段已存在，改为受控值）
  developmentStatus?: DevelopmentStatus // 默认 'unknown'，与 status 正交
  relations?: GameRelation[]        // ≤20，见第 4 节
  sourceUrl?: string                // 官方 / 原始发布页，http(s)
}
```

字段取舍说明：
- `altTitles`：当前搜索只认主标题；别名对同人作品很常见，成本低、收益直接。只参与搜索/详情展示，不作为索引维度。
- `platforms`：字段已存在且详情页已渲染，只差录入与查询；本次激活，不再新增同义字段。
- `sourceUrl`：给「关系有资料依据」提供出处，也方便管理员复核；先合并为一个「官方 / 原始发布页」字段，若以后确有区分需求再拆。
- 不新增 `developer`：现有 `author` 已承载个人或团队，拆成两套会产生重复与迁移成本。
- 不新增「主要玩法」独立字段：`gameplayTypes[0]` 即主要玩法，避免两个数组不同步；编辑器提供「设为主要」并把它移到首位。
- 开发状态与网站状态严格分开：`developmentStatus` **永远不参与** `isPubliclyVisible()`；已取消的作品仍可 `published`。

默认值（`normalizeGame`）：
- `altTitles: []`、`gameplayTypes: []`、`mechanics: []`、`platforms: []`、`relations: []`、`sourceUrl: ''`。
- `developmentStatus: 'unknown'`（非法值也回落到 `unknown`）。
- 数组去重、去空；关系结构非法项丢弃，自关联丢弃；数组字段必须深拷贝（草稿基线不能共享引用）。

### 2.2 分类词表

```ts
export interface VocabularyEntry {
  id: string          // 稳定标识，创建后不可改；ASCII slug，如 traditional-night-watch
  name: string        // 显示名称，可改
  description: string // 简短定义，可为空；玩法类型建议填写
}

export interface Taxonomy {
  gameplayTypes: VocabularyEntry[]
  mechanics: VocabularyEntry[]
  platforms: VocabularyEntry[]
}
```

存储位置：**数据仓 `db.json` 顶层**，与 `games` 并列：

```json
{
  "taxonomy": {
    "gameplayTypes": [{ "id": "traditional-night-watch", "name": "传统守夜式", "description": "……" }],
    "mechanics": [{ "id": "security-cameras", "name": "监控摄像头", "description": "" }],
    "platforms": [{ "id": "windows", "name": "Windows", "description": "" }]
  },
  "games": [ ... ]
}
```

为什么放在 `db.json` 而不是新服务/新文件：
- 继续满足「无长期运行服务器、静态部署、数据仓为唯一事实来源」。
- 复用现有快照、hydrate、GitHub 整文件提交与 409 重放，不引入第二套同步链路。
- 代价是分类编辑与游戏编辑共用同一个文件，需要事务化提交与更严格的解析/序列化；这比新增一个数据库小得多。

为什么玩法、机制、平台都用 ID：
- 改名不碰作品，URL 可稳定引用；使用次数、删除保护、合并都能安全实现。
- 三套维度共用同一套词表模型与后台组件，不额外造平台专用机制。
- 当前 `platforms` 4/4 为空，改为 ID 的实际迁移成本为零；对历史非空字符串保留「先按 ID、再按名称解析」的兼容回退，后台保存时转成 ID。

词表规则：
- `id` 创建后不可改；同集合内唯一；建议前缀 `gt- / mc- / pf-`，避免跨集合碰撞。
- `name` 同集合内按归一化（NFKC、trim、折叠空格、小写）判重；跨集合同名时给出「它到底算玩法还是机制」的显式确认，不静默创建。
- 允许创建暂时无人使用的词条；公开筛选只展示至少被 1 条**可见作品**使用的词条。
- 删除：使用次数为 0 可直接删；被引用时必须选择「合并到另一词条」或「从所有作品移除后删除」，并显示影响作品数。
- 合并：把来源 ID 在所有作品上替换为目标 ID、去重，再删来源词条；整次操作在一个提交里完成。
- 未分类：作品 `gameplayTypes` 为空即未分类；后台显示数量与提示，不阻止保存，不自动编造。

初始词表（**待确认**，只建词条、不绑定任何作品）：
- 玩法：`传统守夜式`、`漫步探索式`（任务书明确给出的两个例子）。
- 机制：`监控摄像头`、`资源管理`、`潜行`、`解谜`、`自由移动`（任务书示例）。
- 平台：`Windows`、`macOS`、`Linux`、`Android`、`iOS`、`Web`（客观平台名，不含任何作品归属）。
- 定义文字由管理员后续修订；不把示例当成完整行业标准，也不因此给 4 条现有作品打任何分类。

### 2.3 兼容与归一化

- 旧记录缺少新字段 → 默认值，前台照常加载；不执行任何批量数据改写。
- `taxonomy` 缺失 → 使用代码内置初始词表；`taxonomy` 存在但为空 → 尊重管理员的清空结果，不回填。
- `taxonomy` 结构损坏 → 逐条丢弃非法项并保留合法项；整块不可用时回退初始词表，后台显示问题；前台不白屏。
- `relations.targetId` 指向不存在 / 已删除作品 → 前台忽略；后台明确提示；保存时阻止新增。
- 旧 `platforms: ["Windows"]` → 解析时按名称回退显示；后台加载时映射到对应词条 ID；无法映射则保留并提示。

---

## 3. 玩法类型、游戏机制、自由标签的边界

| 维度 | 回答的问题 | 例子 | 数据形态 | 维护方式 |
| --- | --- | --- | --- | --- |
| 标准资料 | 这款作品「是什么、谁做的、在哪」 | 作者、年份、IP 系列、引擎、平台、别名、来源页、开发状态 | 单值或受控多值 | 编辑器字段；平台走词表 |
| 玩法类型 | 核心游玩循环是什么 | 传统守夜式、漫步探索式 | 受控多值，第一项为主要 | 独立词表，可定义、合并、删除保护 |
| 游戏机制 | 玩家具体做什么 / 用什么系统 | 监控摄像头、资源管理、潜行、解谜、自由移动 | 受控多值 | 独立词表 |
| 自由标签 | 风格、题材、氛围、社区梗等无法由专用字段表达的特征 | Jolly、恐怖喜剧、 crossover | 字符串多值 | 沿用现有标签管理（派生字符串） |

判定顺序：
1. 能放进标准字段的，先用标准字段；不要把作者、引擎、平台、系列重复塞进标签。
2. 描述「整款游戏怎么玩」的核心循环 → 玩法类型。
3. 描述「游戏里有哪些具体系统 / 动作」 → 机制。
4. 描述题材、风格、氛围、受众、梗 → 自由标签。
5. 机制不能反推玩法类型：有监控摄像头不等于传统守夜式；有自由移动不等于漫步探索式。
6. 玩法类型不要求枚举机制；两者独立维护，通过作品同时挂接。
7. 混合玩法：可挂多个玩法类型，第一项为主要；例如「传统守夜式（主要）+ 漫步探索式」。
8. 无法核实就留空（未分类），不猜、不用标签凑数；后台提示补全，前台不显示该行。
9. 同一概念不要同时建词条和标签（如机制「监控摄像头」与标签「摄像头」）；发现重叠用合并/删除处理。

现有数据的 `tags: ["Jolly"]` 保持为自由标签，不升级成玩法或系列；系列仍由 `ipSeries` 表达。

---

## 4. 作品关联：存储与展示

### 4.1 存储

```ts
relations?: Array<{ type: RelationType; targetId: string }>
```

- 关系只存**一条有向边**，写在「当前作品」上；不在两端各存一条。
- 方向固定为「本作 → 目标」：
  - `prequel`：本作是目标的前传
  - `sequel`：本作是目标的续作
  - `remake`：本作是目标的重制版
  - `reboot`：本作是目标的重启作品
  - `spin-off`：本作是目标的衍生作品
  - `same-universe`：本作与目标同一世界观
  - `related`：本作与目标相关（无法归入以上类型）
- 反向展示由目标页派生，**不落库**：

| 本作存储 | 本作详情页 | 目标详情页（派生） |
| --- | --- | --- |
| prequel | 前传：《目标》 | 续作：《本作》 |
| sequel | 续作：《目标》 | 前传：《本作》 |
| remake | 重制版：《目标》 | 重制原作：《本作》 |
| reboot | 重启作品：《目标》 | 重启原作：《本作》 |
| spin-off | 衍生作品：《目标》 | 衍生作品：《本作》 |
| same-universe | 同一世界观：《目标》 | 同一世界观：《本作》 |
| related | 相关作品：《目标》 | 相关作品：《本作》 |

### 4.2 校验

保存时（编辑器 + 仓储写入前）必须检查：
- `targetId !== 当前 id`（自关联拒绝）。
- 目标必须存在于**全部作品**（后台范围，含草稿/下线；不是只看公开可见）。
- 同一作品内不得重复 `targetId`；同一无序作品对只允许一种关系。
- 目标作品的 `relations` 里若已存在指向本作的关系（无论方向/类型），拒绝并提示「该关系已记录在《目标》中」，避免两端重复。
- 目标已下线/归档/草稿：允许保存（后台关系可以存在），但明确提示「前台暂不展示」。
- 目标被删除：删除动作在同一提交内清理所有指向它的关系；若历史数据仍有悬挂引用，后台编辑器显示错误，前台忽略。

仓储层必须在**最新数据**上重新校验关系，而不只依赖编辑器打开时的内存快照；这样并发删除/并发编辑不会写出悬挂 ID。

### 4.3 前台展示

- 详情页新增「相关作品」区，只在存在可展示关系时渲染；没有关系不出现空框架。
- 每条显示：关系文案 + 作品名 + 年份 + 封面缩略图（复用现有卡片/图片组件），点击进详情。
- 目标必须通过 `isPubliclyVisible()`；草稿、下线、归档一律不展示，不能从关联模块绕过可见性。
- 同一作者 / 同一 IP 系列的其他作品由标准字段派生，不要求管理员重复维护；排除当前作品，按年份/标题排序，各限 6 条。
- 「同一世界观」只认显式 `same-universe` 关系，**不得**因为标签相似自动认定。
- 预览页（后台）使用同一套详情组件；关联目标仍按公开可见性解析，避免预览制造「前台能看到草稿」的错觉。

---

## 5. 改动范围

### 5.1 前台索引与 URL 状态

**路由决策：不新增独立索引页，复用首页游戏库 + URL query。**

理由：
- 首页已经是唯一的浏览面，FilterPanel / GameCard / 分页都可直接复用，避免复制一套列表 UI。
- Hash 路由下 `#/?tag=...` 可以工作；详情页点击属性后 `router.push` 到首页，再 `scrollIntoView()` 到 `#library`（不能用 `href="#library"`，会被 Hash 路由当成路由跳转）。
- 如果以后作品量变大、首页显得拥挤，再抽独立 `/browse`，query 格式不变。

URL 参数：
- `q`：搜索词。
- `sort`：排序键。
- `page`：页码。
- 多值维度用重复参数：`author`、`year`、`series`、`gameplay`、`mechanic`、`tag`、`platform`、`engine`。
- 玩法/机制/平台用词条 ID；作者/系列/标签/引擎用原始字符串；年份用数字。
- 默认值不写进 URL（空搜索、默认排序、第 1 页）。
- 同一维度多个值 = OR；不同维度 = AND；搜索与所有筛选叠加。
- 筛选/搜索/排序变化时页码回到 1；从 URL 载入时页码夹紧到 `[1, totalPages]`。
- 未知参数忽略；无效词条 ID 保留为「已失效」条件并给出提示 + 清除入口，不静默变成「显示全部」。
- 筛选选项只从公开可见作品派生；草稿/归档使用过的词条不出现在公开面板。
- 详情页索引链接：**清空其他筛选**，只设置被点击的属性（页码 1、默认排序），避免从详情页带进一组旧条件造成困惑。
- 历史记录：从详情页进入索引用 `push`；在首页内继续改筛选/搜索用 `replace`，避免每个 chip 都塞一条历史；浏览器后退可回到详情页或上一个索引状态。

`useGameLibrary` 内部改动：
- `FilterCategory` 扩为 `author | year | series | gameplay | mechanic | tag | platform | engine`。
- `QueryState` 的每个维度从单值改为 `string[]`（年份仍为 `number[]` 或统一字符串数组）。
- `setFilter` 改为 toggle；新增 `setIndexFilter`（清空后设单值）、`hydrateFromQuery`、`toQuery`（纯函数放 `src/utils/filterUrl.ts`，便于 selftest）。
- 搜索覆盖：`title / altTitles / author / ipSeries / engine / 玩法名称 / 机制名称 / tags / 平台名称`。
- 新增可用元数据：`availableGameplayTypes / availableMechanics / availablePlatforms / availableTags / availableEngines`，全部从 `VISIBLE` 派生。
- 搜索结果计数不显示每个选项的命中数（避免「选项存在但永远为空」的误导）；只显示总结果数。
- `searchGames()`（催资源对话框的站内预检）同步覆盖新字段，避免「站内有但搜不到」。
- 分页、排序、160ms 模拟延迟逻辑保留；URL 同步要避开延迟状态，避免循环写入。

### 5.2 筛选面板

- 新增分组，顺序建议：玩法、机制、平台、作者、系列、年份、引擎、标签。
- 空分组不渲染（数据稀疏时不会出现一排空标题）。
- 同组多选 toggle，`aria-pressed` 保留；active 样式沿用现有边框 chip（`border-accent bg-black text-white`），不要做彩色胶囊。
- 筛选值多时允许换行；移动端单列堆叠；标签组可放在最后。
- 清除全部筛选同时清空搜索；显示当前索引摘要（如「玩法：传统守夜式」）和结果总数。
- 排序与分页行为不变；页码夹紧逻辑沿用。
- 键盘焦点、屏幕阅读器标签沿用现有全局焦点样式与 `aria-pressed`。

### 5.3 详情页

- 事实表中的作者、年份、IP 系列、引擎、平台、玩法、机制、开发状态、来源页改为可点击/可外链。
- 标签从静态 `<li>` 改为索引链接。
- 属性链接样式：文字链接 + 边框/颜色变化（hover 到 accent），不做彩色标签块；保证深色模式下对比度。
- 新增相关作品区（见第 4 节）；没有数据时整段不渲染。
- 开发状态只在已知时展示；`unknown` 不显示。
- 来源页外链加 `target="_blank" rel="noopener noreferrer"`，只接受 http(s)。

### 5.4 后台编辑器

- 基本信息：新增其他名称、平台多选、开发状态、来源页；引擎仍为自由文本（保留 datalist 建议）。
- 新增「玩法与机制」分区：玩法类型多选（≤3，标出主要并可调整）、机制多选（≤12）。
- 新增「关联作品」分区：关系类型下拉 + 作品选择器 + 已选列表；错误逐行显示。
- 作品选择器：按标题/ID/作者搜索，显示标题 + 年份 + 状态；排除自身与已选；只能选已有作品，不允许手输 ID。
- 校验：
  - 阻断保存：自关联、目标不存在、重复关系、关系冲突、超上限、非法 URL、非法词条 ID。
  - 只提示不阻断：未标玩法、未标机制、未标平台、未标开发状态、未填来源页、未填其他名称。
  - 分类词条的重复/重叠在词表页处理，不在作品编辑器里静默新建。
- 预览：`draftToPatch` 必须带出新字段；`GameDetail` 渲染新字段与关系；目标仍按公开可见性解析。
- 草稿白名单（漏一处就会静默不加载/不保存/不脏）：
  `emptyDraft`、`readText`、`DRAFT_TEXT_FIELDS`、`DRAFT_FIELDS`、`applyDraft`、`fieldValue`、`gameToDraft`、`draftToPatch`、`blankGame`、`normalizeGame`、`AdminGame`、fixture。
- 新增通用多选组件时优先抽共享 chip UI；标签编辑器如改动风险大则先保持独立，避免回归。

### 5.5 分类词表后台

- 新增页面 `/admin/vocabulary`，导航名「玩法与机制」；标签与作者页保持现状。
- 三个分区：玩法类型、机制、平台；每个分区包含：
  - 新建（名称、定义、可选 ID；未填 ID 自动生成）。
  - 搜索、列表、使用次数（全部作品 / 前台可见作品）。
  - 改名（只改 `name`，作品引用 ID 不动）、编辑定义。
  - 合并到另一词条（批量改作品 + 删来源，一次提交）。
  - 删除（未使用直接删；被引用必须先合并或显式移除引用）。
  - 重名/同 ID 防护；跨集合同名警告。
- 未分类作品数量提示；不自动改作品。
- 复用现有后台布局、表格、确认条、结果提示；不新建第二套后台框架。

### 5.6 数据层与同步

- `GameRepository` 增加：
  - `taxonomy: ComputedRef<Taxonomy>`
  - `hydrate(games, taxonomy?)`
  - 词表写操作（创建/改名/改定义/合并/删除），在本地与 GitHub 两个实现中保持同一语义。
- `githubGameRepository`：
  - 解析整个 `db.json`，保留未知顶层键；序列化时 `{ ...extra, games, taxonomy }`，避免旧代码/旧字段被静默丢弃。
  - `commit` 计划同时携带 games + taxonomy，并在最新内容上重放。
  - 删除作品时在同一提交内清理所有指向它的关系。
  - 写入前在最新数据上校验关系完整性。
- `localGameRepository`：
  - 词表单独存一个 localStorage key（如 `fnaf-archive:taxonomy:v1`），不改变现有 `admin-catalog:v1` 数组格式，旧存档继续可读。
  - `resetToSeed` 同时重置词表。
  - `hydrate` 不持久化（与 games 一致）。
- `repositories/index.ts`：
  - `hydratePublicCatalog()` 同时 hydrate games 与 taxonomy；失败保留现有两者。
- `scripts/pull-data.mjs`：
  - 保留 `taxonomy` 与其他顶层键；校验 `games` 非空；缺 taxonomy 时允许继续。
  - **必须先于任何词表数据写入数据仓上线**，否则下一次 `data:pull` 会把词表从构建快照里抹掉。
- 代码仓 `src/data/db.json` 不必立刻写入 taxonomy；缺失时用内置初始词表。第一次后台词表保存会写入数据仓。

### 5.7 预计涉及文件

- 类型/工具：`src/types/game.ts`、`src/types/admin.ts`、新增 `src/types/taxonomy.ts` / `src/utils/taxonomy.ts` / `src/utils/relations.ts` / `src/utils/filterUrl.ts`、`src/utils/gameDefaults.ts`、`src/utils/gameFactory.ts`。
- 仓储：`src/repositories/gameRepository.ts`、`localGameRepository.ts`、`githubGameRepository.ts`、`index.ts`、`scripts/pull-data.mjs`。
- 前台：`src/composables/useGameLibrary.ts`、新增 `useTaxonomy.ts` / `useVocabulary.ts`、`src/components/FilterPanel.vue`、新增属性链接/相关作品组件、`src/views/GameDetail.vue`、`src/views/Home.vue`（URL 同步与滚动）。
- 后台：`src/views/admin/AdminGameEditor.vue`、新增 `AdminVocabulary.vue`、`src/components/admin/AdminNav.vue`、`AdminGamePicker.vue`、`AdminRelationEditor.vue`、通用多选组件、`src/composables/useAdminGames.ts`、`useAdminGameDraft.ts`。
- 路由：`src/router/routes.ts`（若新增 `/admin/vocabulary`；公开索引不新增路由）。
- 测试：`src/dev/libraryAssertions.ts`、`adminAssertions.ts`、新增 taxonomy/relation/filterUrl 断言、`scripts/selftest.mts`、`smoke.ts`、`ui-test.mjs`。
- 文档：README、HANDOVER、本设计冻结文档、必要时更新后台计划书。

---

## 6. 分阶段计划与验收标准

### Phase 0：审计与设计冻结（本阶段）

- 产出：本报告、字段/词表/关系/URL/风险设计。
- 不做：业务代码、生产数据、批量分类。
- 验收：你确认设计；工作区状态明确；Phase 1 范围无歧义。

### Phase 1：数据模型与分类基础

- 改动：类型、默认值、`blankGame`、词表类型/归一化、初始词表、`db.json` 顶层 taxonomy 解析、Repository 读写契约、`pull-data.mjs` 保留 taxonomy、hydrate 同步 taxonomy、纯函数测试。
- 不做：任何后台页面、前台筛选 UI、作品分类赋值。
- 验收：
  - 旧 4 条记录无需迁移即可读取、编辑、保存。
  - 缺失 taxonomy 时使用内置词表；存在但为空时保持为空。
  - 本地仓 taxonomy 往返、重置、损坏回退通过测试。
  - 远端仓解析/序列化保留未知顶层键；409 重放不丢词表（用 fake/mock 测试）。
  - `npm run typecheck`、selftest、smoke、build 通过。
- 风险门槛：先更新 `pull-data.mjs` 与序列化，再允许词表写入数据仓。

### Phase 2：后台词表与资料编辑

- 改动：`/admin/vocabulary`、词表 CRUD/合并/删除保护/使用次数/重复防护、编辑器新字段、多选组件、关系字段暂不接入前台、预览。
- 验收：
  - 创建、改名、改定义、合并、删除保护、未使用删除、跨集合同名确认均正常。
  - 改名后作品引用不丢；合并后作品去重且使用次数正确。
  - 旧作品打开编辑器不丢字段；新字段保存后重新加载一致；预览显示新字段。
  - 未标玩法/机制/平台不阻止保存；非法词条 ID 阻止保存并给出可读错误。
  - 后台断言与 UI 步骤通过。

### Phase 3：前台可点击索引与 URL

- 改动：`useGameLibrary` 查询引擎（多维、多值、OR/AND、搜索扩展）、`filterUrl` 解析/序列化、详情页属性链接、首页 URL 同步与滚动、索引摘要/空结果/无效值提示。
- 验收：
  - 点击作者/玩法/机制/标签/平台/引擎/系列/年份均得到正确可见结果集。
  - 刷新、复制链接、前进后退保留状态；分页不越界。
  - 草稿/下线/归档作品不出现在索引；无效词条 ID 有明确提示。
  - 无结果时页面正常，不出现空白框架；移动端可操作。
  - selftest 的 URL 纯函数断言 + UI 刷新/后退用例通过。

### Phase 4：组合筛选与搜索增强

- 改动：FilterPanel 新分组、多选 UI、搜索覆盖新字段、清除/摘要、元数据、移动端与键盘、`searchGames` 同步。
- 验收：
  - 同维多选 OR、跨维 AND、搜索叠加均正确。
  - 筛选/搜索/排序变化页码重置，URL 载入页码夹紧。
  - 过滤选项只来自可见作品；不出现永远为空的公开选项。
  - 清除筛选恢复完整公开集合。
  - 现有筛选/分页断言不削弱，新增断言从数据推导。

### Phase 5：作品关联

- 改动：关系类型/归一化、后台选择器与校验、删除清理、详情页相关作品、同作者/同系列派生、预览解析。
- 验收：
  - 前传/续作/重制/重启/衍生/同一世界观/相关均可维护；方向文案正确；反向展示由一条记录派生。
  - 自关联、无效目标、重复/冲突关系被拒绝；目标删除后无悬挂引用。
  - 隐藏目标不出现在前台；无关系时详情页正常。
  - 关联不可绕过公开可见性；UI/断言覆盖。

### Phase 6：集成验证与资料质量

- 改动：跨模块测试、旧数据兼容、可见性、组合筛选、关系测试、只读数据质量检查（未分类、失效词条、悬挂关系、重复词条）、文档更新。
- 验收：
  - `npm run verify` 全绿；UI 81+ 步全绿（本地 dev server + Chrome）。
  - 老数据可读可编辑；没有大规模生产数据改写；没有无关重构。
  - 文档说明初始词表、字段语义、URL 参数、关系方向、已知限制。
  - 数据质量检查只报告，不自动改生产数据。

---

## 7. 风险评估

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 现有数据极少（4 条、3 条可见、平台全空） | 自动分类/关系推断没有依据；公开索引初期可能没有选项 | 只建词表、不绑定作品；管理员逐条标注；空分组不渲染；不写死分类 |
| 草稿白名单遗漏 | 新字段不加载/不保存/不脏/保存按钮误禁用，静默丢数据 | 逐项更新 `emptyDraft / readText / DRAFT_* / applyDraft / fieldValue / gameToDraft / draftToPatch`；fixture 覆盖；UI 往返测试 |
| `db.json` 目前只解析 `{ games }` | 写入时可能丢弃 taxonomy 或未来字段 | 解析保留整个对象；序列化 spread 未知顶层键；`pull-data` 保留所有顶层键；先改代码再写词表 |
| 整文件 GitHub 写入 | 词表编辑与游戏编辑并发冲突；关系删除可能留悬挂 | 409 重放；taxonomy + games 同一提交事务；删除时在最新数据上清理入边；写入前重新校验关系 |
| `pull-data` 丢顶层键 | 部署快照丢词表，前台筛选突然为空 | Phase 1 先改脚本并加测试；缺 taxonomy 时回退内置词表 |
| 公开可见性被绕过 | 草稿/下线作品经筛选元数据或关联模块泄漏 | 所有元数据、索引、关系目标统一走 `VISIBLE` / `isPubliclyVisible()`；预览也按公开规则解析目标 |
| 视觉系统被破坏 | 彩色胶囊、圆角、阴影、硬编码颜色破坏 Swiss 风格 | 沿用边框 chip 与语义 token；只做文字/边框链接；深色模式手动复查；禁止新调色板 |
| 测试选择器脆弱 | 新增分组/占位符/aria-label 导致现有 UI 测试误命中或失效 | 用 role/label 定位；不改写死标题/数量；先扩 fixture；保留现有断言 |
| URL 同步循环 / 历史刷屏 | 前进后退异常、每个输入都产生历史 | query 与 route 单向 hydrate + 守卫标志；页面内用 `replace`，详情进索引用 `push`；纯函数测试 + UI 后退测试 |
| 搜索/筛选性能 | 每次筛选重复解析词表名称 | 一次构建 id→name Map；可见集与 haystack 缓存；数据量小时无压力，量大时再优化 |
| 词表语义重叠 | 「玩法/机制/标签」重复，筛选结果混乱 | 定义字段 + 判定顺序 + 同名警告 + 合并工具；人工治理，不做语义自动合并 |
| 关系方向歧义/重复 | 两端各存一条、同一对关系类型冲突 | 只存一条有向边；固定方向文案；保存时查两端；同一无序对只允许一种关系 |
| 初始词表被误解为已分类 | 用户以为 4 条作品已有玩法 | 词表与作品分离；初始词表不绑定任何作品；后台显示未分类数量 |
| 工作区已有未提交改动 | 主题/催资源与本次改动混在一起，难以审查/回滚 | Phase 1 前先确认并提交上一轮改动，或明确隔离策略 |
| 文档与测试不一致 | 文档声称有 `.vue` filter/sort 静态守卫，实际没有 | 本阶段不动；Phase 6 修正文档或补一条不会误伤 UI 本地数组的窄守卫 |

---

## 8. 需要你确认的设计点

1. **taxonomy 放在数据仓 `db.json` 顶层**，游戏存词条 ID；平台也作为第三套词表（而不是代码常量）。
2. **初始词表只建词条、不绑定作品**：玩法 2 条、机制 5 条、平台 6 条（清单见 2.2）。
3. **公开索引复用首页 + URL query，不新增 `/browse` 路由**；详情页索引链接清空其他筛选。
4. **关系只存一条有向边**，反向文案派生；同一无序作品对只允许一种关系；删除作品时同一提交清理入边。
5. **新增字段**：`altTitles`、`sourceUrl`、`developmentStatus`、`gameplayTypes`、`mechanics`，并激活 `platforms`；不新增独立 `developer` 字段。
6. **多选语义**：同维 OR、跨维 AND；URL 多值用重复参数；页面内筛选用 `replace`，详情进索引用 `push`。

确认后我再进入 Phase 1。Phase 1 只做类型、默认值、词表基础、仓储/同步兼容与测试，不改前台 UI，也不批量修改任何作品数据。
