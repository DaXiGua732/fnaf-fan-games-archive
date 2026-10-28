# 数据模型与数据同步

## 1. `db.json` 的形状

数据仓 `fnaf-fan-games-data/db.json` 是游戏目录的唯一事实来源；代码仓里的
`src/data/db.json` 只是**构建期快照**（首屏 / 断网兜底）。顶层结构：

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

`taxonomy` 可以缺失（用内置初始词表兜底），也可以存在但为空（尊重管理员删空，不回填）。

## 2. `Game` 字段契约

类型定义见 `src/types/game.ts`，归一化见 `src/utils/gameDefaults.ts` 的 `normalizeGame()`
（读取时补齐缺省值）。**新增字段全部 optional**，所以新增不需要数据迁移，
也不会让现有前台因为多出必填字段而崩溃。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 唯一标识，同时是路由参数 `/game/:id` |
| `title` | string | 英文原名 |
| `author` | string | 作者 |
| `releaseYear` | number | 发行年份 |
| `ipSeries` | string | IP 系列 |
| `engine` | string | 开发引擎 |
| `coverImage` | string | 封面（站内路径或 http(s) 外链） |
| `bannerImage` | string | 宣传图；详情页 Hero 无 banner 时退回封面 |
| `gallery` | string[] | 截图，必需字符串数组（缺失为 error，空数组合法） |
| `videoUrl?` | string | 视频链接 |
| `description` | string | 中文简介 |
| `downloads` | `{ provider, url, password? }[]` | 网盘渠道，顺序即前台渲染顺序，最多 8 条 |
| `metrics` | `{ fakeViews, score }` | 静态热度基数（列表排序 / 计数兜底）与 5 分制评分 |
| `shortDescription?` | string | 列表卡片 / 搜索结果的一句话简介 |
| `altTitles?` | string[] | 其他名称，只参与搜索与详情展示，不作为索引维度，最多 5 个、单个 ≤ 80 字符 |
| `gameplayTypes?` | string[] | 玩法类型词条 id，有序：第一项是主要玩法，最多 3 个 |
| `mechanics?` | string[] | 机制词条 id，最多 12 个 |
| `platforms?` | string[] | 平台词条 id，最多 8 个；历史数据可能是名称，解析时先按 id 再按名称 |
| `tags?` | string[] | 自由标签（风格 / 题材），最多 12 个、单个 ≤ 24 字符 |
| `developmentStatus?` | enum | 作品开发状态：`released` / `in-development` / `on-hold` / `cancelled` / `unknown`，非法值归一化为 `unknown` |
| `relations?` | `{ type, targetId }[]` | 有向作品关系，最多 20 条 |
| `sourceUrl?` | string | 官方页面 / 原始发布页，只接受 http(s) |
| `status?` | enum | 本站发布状态：`draft` / `published` / `offline`，**缺省视为 `published`** |
| `featured?` | boolean | 首页推荐位 |
| `archived?` | boolean | 归档标记，**与 status 正交** |
| `sortOrder?` | number | 手动排序权重，越大越靠前 |
| `createdAt?` / `updatedAt?` / `publishedAt?` | ISO 8601 | 由仓储管理，调用方不写 |

时间戳只接受带时区的完整 ISO 8601：`YYYY-MM-DDTHH:mm:ss`，可带 1–9 位小数秒，
时区为 `Z` 或 `±HH:MM`，并校验真实日历日期。

> ⚠️ 开发状态 ≠ 发布状态。`developmentStatus` 描述作品做到哪一步；`status` / `archived`
> 只控制本站是否展示。两者互不推导。

## 3. 词表（taxonomy）

三套集合：`gameplayTypes` / `mechanics` / `platforms`，共用模型：

- `id`：稳定机器标识，创建后不改；作品只存它
- `name`：展示名称，可以改；**改名不碰作品**
- `description`：简短定义

| 规则 | 说明 |
| --- | --- |
| 改名不碰作品 | 后台改词条 `name`；作品引用 id |
| 合并 / 删除一次生效 | 远程仓一次提交；本地仓一次持久化（第二个 key 写失败时尽力回滚）。合并会替换并去重所有引用；仍被使用的词条默认拒绝删除，除非明确要求从作品移除 |
| 缺省与损坏分开 | `taxonomy` 缺失用内置初始词表兜底；三集合齐全但为空时尊重管理员删空；缺集合 / 类型不对则不让它覆盖当前词表 |
| 普通保存不写词表 | 数据仓没有 `taxonomy` 时，保存作品**不会**把内置词表塞进去；已有 `taxonomy` 时原样保留（包括 `null` / 损坏值），只有词表操作才改写 |
| 词条上限 | 名称 ≤ 40、定义 ≤ 160、id ≤ 60；作品挂接数见上表 |
| 未分类可见 | 后台词表页显示使用次数（全部作品 / 前台可见）与未分类计数，跨集合同名会提示 |

实现：`src/utils/taxonomy.ts`（归一化 / 查询 / 创建 / 改名 / 合并 / 删除）、
`src/config/taxonomy.ts`（初始词表）、`src/types/taxonomy.ts`（类型与上限）。

## 4. 关系

- 只存「本作 → 目标」的**一条有向边**：`{ type: 'sequel', targetId: X }` 读作「本作是 X 的续作」。
- 目标页的反向文案由 `inverseRelationLabel()` 派生，**不落库**，不要求两端各存一条。
- 保存前共享 `inspectGameRelations()` 校验：自关联、目标不存在、重复目标、目标端已有反向记录、
  数量上限（20）都会阻断并逐行提示。
- 删除作品会清理指向它的入边；未知引用不做数量截断、也不因词表暂时没有该 id 就删掉作品上的值。

## 5. 写入语义

- 只落盘**显式改动的字段**；未编辑作品整条原样写回。
- 编辑器附带的未变化 `relations` 不算修改；词表改名 / 合并只 patch 分类字段。
- 远程与本地仓储共用同一套持久化语义（`src/utils/gamePersistence.ts`）。
- **原始 ID 安全**：远程仓与本地存档共用 `findCatalogIdentityIssues()`。缺失 / 空白 /
  首尾空白 / 非字符串 / 重复 id 时，任何目录写入都在提交 / 落盘前被拒绝，
  错误信息指出 `games[n]` 的具体问题；失败零提交、零写入，不归一化、不复制、不丢失记录。
  本机模式的「恢复出厂数据」是显式修复入口。
- **未知字段保留**：顶层、词条、关系上的未知扩展字段在读写与 `data:pull` 后都保留，
  避免新旧代码互删数据。
- **不做静默截断**：超限只在「新增」入口拦截，归一化函数不裁掉已有数据。

## 6. 快照同步

```bash
npm run data:pull   # 从数据仓拉 db.json 覆盖到 src/data/db.json
```

- **部署**：`deploy.yml` 在构建前自动执行。
- **线上生效**：公开页打开 / 切回时同步最新数据（通常几秒）；数据仓提交不触发代码仓
  workflow，每小时定时构建只负责刷新快照。
- **本地开发**：需要手动跑一次 —— 否则首屏兜底与详情页直开看到的是上一次同步的快照
  （「后台改了、图片也传了，本地点开却还是旧的」就是这个原因）。

脚本刻意做成**失败不阻断**：两个来源（raw → API）依次尝试，都拿不到就**保留仓库里那份快照
并告警**。但它**绝不写入校验不过的内容**：解析失败、或没有 `games` 数组时直接放弃 ——
宁可继续用旧快照，也不能把站点弄空。

> ⚠️ 跑完之后 `src/data/db.json` 会变（图片变成数据仓的绝对地址）。这是**预期**的：
> 代码仓里那份 db.json 的定位就是「本站最后一次构建所用的快照」。
> 它由 `scripts/pull-data.mjs` 与 `scripts/catalog-document.mjs` 处理，
> 必须保留 `taxonomy` 等未知顶层字段。

## 7. 资料质量检查

```bash
npm run check:data                      # 默认读 src/data/db.json
npm run check:data -- --file=other.json # 指定任意 db.json
npm run check:data -- --json            # 机器可读输出
npm run check:data -- --strict          # 有 error 时退出码 1（默认总是 0）
```

`src/utils/dataQuality.ts` 的 `analyzeCatalog()` **只读**：不写文件、不调 GitHub API。
对不可信 JSON 逐字段类型检查后再归一化：根对象 / `games` 类型错误、非对象条目、
缺失或重复 id、标题 / 作者 / 图片 / 下载 / 关系 / 文本数组的类型错误都有明确代码；
一条坏记录不会让整份报告崩溃或漏掉其他记录，且不改入参。

报告内容：未分类作品、失效词条引用、悬挂 / 自关联 / 重复关系、两端重复记录、
标签与词条同名、重复标签 / 别名、缺封面 / Banner / 下载、词表结构与跨集合同名。

`--strict` 只对 **error** 失败，warning 保留人工判断。它证明的是**当前快照**没有 error，
**不证明**本次 `data:pull` 成功 —— 拉取失败时 workflow 仍按既有策略用旧快照部署（可用性取舍）。

## 8. 本机的数据键

| key | 用途 |
| --- | --- |
| `fnaf-archive:admin-catalog:v1` | 本地模式的作品存档（`localGameRepository.ts`） |
| `fnaf-archive:taxonomy:v1` | 本地模式的词表（不改旧作品存档格式） |
| `fnaf-archive:theme-mode:v1` / `fnaf-archive:theme-accent:v1` | 主题模式与强调色 id（见 [`DESIGN.md`](DESIGN.md)） |
| `fnaf-archive:theme-custom:v1` | 自定义强调色 `#rrggbb`（切回预设色时保留） |
| `fnaf-archive:admin-token:v1` | 后台 GitHub 令牌 |
| `fnaf-archive:preview:v1` | 草稿 → 预览页的一次性交接（读完即清） |
| `fnaf-archive:resource-requests:v1` | 催资源本机模式的请求 + 投票明细 |
| `fnaf-archive:resource-requests-cache:v1` | 远程模式榜单缓存 |
| `fnaf-archive:request-voted:v1` | 本机已投记录 |
| `fnaf-archive:request-client:v1` | 浏览器去重身份（不是安全凭据） |

> 这些 key 都由对应模块导出常量，代码是唯一出处；主题 key 只定义在
> `src/theme/themeSettings.ts`（首帧脚本与 `useTheme` 共用），有静态守卫。
