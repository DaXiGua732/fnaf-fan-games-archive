# Phase 6 实施报告：集成验证与资料质量检查

> 日期：2026-10-27
> 状态：**Phase 6 已完成。结构化资料库升级 Phase 0–6 全部交付**
> 设计依据：`structured_data_phase0_design_freeze.md`、`structured_data_phase5_report.md`

## 1. 交付摘要

Phase 6 收尾，没有新增前台 / 后台业务功能：

- 新增**只读**资料质量检查 `npm run check:data`：报告未分类、失效词条、关系异常、
  重复项、缺失资料、词表结构问题；**不写文件、不调用 GitHub API、不改数据**。
- 提取公开可见性判据到 `src/utils/visibility.ts`，前台深模块与质量检查共用同一条规则。
- 提取 `isRecord` 到 `src/utils/guards.ts`，结构化工具不再各自维护一份。
- 跨模块回归：旧记录兼容、公开可见性、组合筛选、关系方向 / 反向 / 删除清理
  继续由 selftest + smoke + UI 覆盖。
- 文档更新：README / HANDOVER / 各阶段报告，修正断言条数与门禁说明。

## 2. 只读质量检查

### 2.1 用法

```bash
npm run check:data                         # 检查 src/data/db.json
npm run check:data -- --file=db.json       # 检查任意 db.json（只读）
npm run check:data -- --json               # 机器可读输出
npm run check:data -- --strict             # 有 error 时退出码 1（默认总是 0）
```

### 2.2 检查项

| 类别 | 代码 | 级别 |
| --- | --- | --- |
| 结构 | `catalog-root-invalid` / `catalog-games-missing` / `game-invalid` / `game-duplicate-id` | error |
| 身份 | `game-id-whitespace` | warning |
| 必填 | `missing-title` / `missing-author` / `invalid-title` / `invalid-author` / `empty-title` / `empty-author` | error |
| 必填（Game 契约） | `missing-ip-series` / `missing-engine` / `missing-description` / `invalid-ip-series` / `invalid-engine` / `invalid-description` | error |
| 必填但为空 | `empty-ip-series` / `empty-engine` / `empty-description` | warning |
| 资料完整度 | `missing-cover` / `missing-banner` / `missing-downloads` | warning |
| 资料类型 | `missing-gallery` / `invalid-cover` / `invalid-banner` / `invalid-downloads` / `invalid-download` / `invalid-gallery` | error |
| 指标 | `missing-metrics` / `invalid-metrics` / `invalid-fake-views` / `invalid-score` | error |
| 指标范围 | `implausible-fake-views` / `implausible-score` | warning |
| 分类 | `unclassified` / `unknown-vocabulary` | warning / error |
| 标签 | `tag-overlaps-vocabulary` / `duplicate-tag` / `duplicate-alt-title` / `duplicate-platform` | warning |
| 关系 | `relation-self` / `relation-dangling` / `relation-invalid-type` / `relation-invalid-target` / `relation-duplicate` / `relation-empty-target` / `relation-not-array` | error |
| 关系 | `relation-reverse-duplicate` / `relation-limit` | warning |
| 关系 | `relation-target-hidden` | info（后台保留、前台不展示） |
| 字段 | `invalid-development-status` / `implausible-year` | warning |
| 字段类型 | `invalid-year` / `invalid-tags` / `invalid-alt-titles` / `invalid-platforms` / `invalid-gameplay-types` / `invalid-mechanics` | error |
| 可选字段 | `invalid-short-description` / `invalid-video-url` / `invalid-source-url` / `invalid-status` / `invalid-featured` / `invalid-archived` / `invalid-sort-order` / `invalid-created-at` / `invalid-updated-at` / `invalid-published-at` | error |
| 词表 | `taxonomy-missing` / `unused-vocabulary` | info |
| 词表 | `taxonomy-unusable` | error |
| 词表 | `taxonomy-issue` / `overlapping-vocabulary` | warning |

### 2.3 当前快照的实际结果

```text
作品 4 条（可见 3 / 隐藏 1） · 词条 13 个 · 未分类 4 条
error 0 · warning 7 · info 14
```

- 4 条作品都没有标注玩法类型（预期：数据尚未人工标注）。
- 《Jolly 4》缺封面、Banner、下载渠道。
- 数据里没有 `taxonomy`，检查使用内置初始词表；初始词条全部未被使用。
- **没有 error**，说明当前数据不存在悬挂关系 / 失效词条等结构性问题。

## 3. 集成验证

Phase 6 没有引入新的查询或写入路径，回归范围覆盖此前各阶段：

- **旧数据兼容**：`normalizeGame()` 对稀疏记录的默认值断言；本地仓储用真实快照种子；
  编辑器打开旧记录不丢字段。
- **公开可见性**：`isPubliclyVisible()` 单点判据被前台列表、筛选元数据、索引、
  关系目标、质量检查共用；草稿 / 下线 / 归档不会经任何入口泄漏。
- **组合筛选**：同维 OR / 跨维 AND / 搜索叠加 / 页码重置 / URL 夹紧与失效条件。
- **关系**：方向文案、反向派生、自关联 / 无效目标 / 重复 / 两端重复、删除清理、
  隐藏目标不展示、同作者 / 同系列去重。

## 4. 修改文件

**新增**

- `src/utils/dataQuality.ts`（纯函数分析器）
- `scripts/data-quality.mts`（CLI 包装）
- `src/dev/dataQualityAssertions.ts`（30 条断言）
- `src/utils/visibility.ts`（共享可见性判据）
- `src/utils/guards.ts`（共享 `isRecord`）
- `structured_data_phase6_report.md`（本文件）

**修改**

- `src/composables/useGameLibrary.ts`：改用共享可见性判据并保留原导出
- `src/utils/relations.ts`、`src/utils/taxonomy.ts`：改用共享 `isRecord`
- `scripts/selftest.mts`：新增资料质量断言组
- `package.json`：新增 `check:data`
- `README.md`、`HANDOVER.md`

## 5. 验证结果

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run test:gamejolt` | 22/22 |
| `npm run test:catalog` | 3/3 |
| `npm run build:extension` | 通过 |
| `npm run selftest` | **880/880**（新增 30 条质量检查断言） |
| `npm run smoke` | **16/16** |
| `npm run build` | 通过 |
| `npm run verify` | 全部通过 |
| `npm run test:ui` | **99/99** |
| `npm run check:data` | error 0 · warning 7 · info 14（当前快照） |

## 6. 已知限制

1. 质量检查只读，不提供一键修复；问题需由管理员在后台逐条处理。
2. 检查基于数据文件本身，不做跨数据仓 / 历史提交比较。
3. 生产数据仍没有任何玩法 / 机制 / 平台标注与作品关系，这是**资料缺失**，
   不是代码缺陷；需要按证据人工录入。
4. `check:data --strict` 已纳入 `npm run verify` 与部署 workflow：只对 error 阻断，
   warning 仍允许存在；检查对象是 `data:pull` 之后的快照（拉取失败时日志会说明用的是旧快照）。
5. 真实 GitHub / Supabase 行为仍未做网络级测试，沿用此前的桩与手动运维流程。

## 7. 结构化资料库升级总结

| Phase | 交付 |
| --- | --- |
| 0 | 审计、字段 / 词表 / 关系 / URL / 风险设计冻结 |
| 1 | 类型、默认值、词表、关系、两套仓储、同步兼容、测试地基 |
| 2 | `/admin/vocabulary`、编辑器新字段、预览展示 |
| 3 | 详情页可点击索引、八维查询、URL 状态、失效条件 |
| 4 | 八组筛选面板、同维多选、移动端 |
| 5 | 关系编辑、校验、详情页相关作品、同作者 / 同系列 |
| 6 | 只读质量检查、共享规则、集成回归、文档收尾 |

Phase 0–6 按设计完成，没有批量修改生产数据，没有引入新的长期运行服务。

## 8. 后续加固（2026-10-27）：异常输入与关系持久化

本轮不新增资料库功能，只修两个工程问题：

1. **质量检查对不可信 JSON 的健壮性**
   `analyzeCatalog()` 现在先对原始记录逐字段做类型检查，再做归一化：
   根对象 / `games` 类型错误、非对象条目、缺失或重复 id、`title` / `author` /
   图片 / `downloads` / 关系 / 文本数组字段的类型错误都有独立代码（见 §2.2）。
   类型错误不再导致 `TypeError`，也不会因为一条坏记录丢掉其他记录的问题；
   检查全程只读，不改传入对象、不写文件、不调用远程 API。

2. **关系持久化不再静默清理历史数据**
   读取与展示继续使用归一化结果（前台看不到非法关系），但写入改为
   「原始记录 + 本次显式字段」：
   - 未编辑的作品整条原样写回；
   - 编辑器每次保存都会带上 `relations`，只有内容确实变化才视为“明确修改关系”；
   - 词表改名 / 合并 / 删除只 patch 对应的分类字段；
   - 删除作品只剔除其他记录中指向它的入边，同一记录上的其他历史异常关系保留。

   两套仓储（GitHub 远程仓与本地存档）共享 `src/utils/gamePersistence.ts`
   的同一套语义；`npm run check:data` 仍能发现原始数据里的历史关系问题。

回归覆盖（`selftest` 新增 65 条断言，总计 **945/945**）：
异常输入与只读性、场景 A（无关字段编辑）、场景 B（显式关系编辑与非法输入拒绝）、
场景 C（删除目标只清理入边）、场景 D（词表合并 / 改名不触碰关系），
远程仓使用假 `fetch`，本地仓使用内存存档，均不出网。

## 9. 第二轮加固（2026-10-27）：原始 ID 安全、Game 契约与门禁

1. **记录身份不可靠时 fail-closed**
   `src/utils/gamePersistence.ts` 新增 `findCatalogIdentityIssues()`，统一检查
   缺失 / 空白 / 首尾空白 / 非字符串 / 重复 id。远程仓在 `commit()` 里、任何
   `putFile` 之前拒绝；本地仓在所有目录写入（作品增删改、上下线、词表操作）之前拒绝。
   错误信息指出 `games[n]` 的具体问题；失败不产生提交、不修改本机存档 / 词表。
   本机模式的「恢复出厂数据」是显式修复入口。

2. **`Game` 契约字段补全**
   `analyzeCatalog()` 新增 `ipSeries` / `engine` / `description` 的缺失、类型与空值检查；
   `gallery` 是必需字符串数组：**缺失为 error**（没有截图应写 `[]`），非数组 / 非字符串项也是 error；
   `metrics` 对象及 `fakeViews` / `score` 的有限数值与范围；
   `shortDescription` / `videoUrl` / `sourceUrl` / `status` / `featured` / `archived` /
   `sortOrder` / `createdAt` / `updatedAt` / `publishedAt` 的类型、枚举与格式检查。
   时间戳只接受带时区的完整 ISO 8601：`YYYY-MM-DDTHH:mm:ss`，可带 1–9 位小数秒，
   时区为 `Z` 或 `±HH:MM`；并校验真实日历日期，不再用 `Date.parse()` 的宽松解析兜底。
   可选字段缺失不误报；未知扩展字段继续保留；检查器仍只读且逐条隔离。

3. **验证门禁**
   - `npm run verify` 新增 `test:data-quality`、`check:data --strict`、`test:ui:ci-launcher`
     与 `test:ui:ci`。
   - 部署 workflow 新增严格资料检查、CLI 退出码测试、启动器端口回归与真实浏览器 UI 测试；
     UI 测试默认 Playwright Chromium，runner 只认本次 Vite 子进程的 stdout ready 信号，
     失败上传截图与日志。
   - `check:data --strict` 只对 error 失败，warning 继续人工判断；检查对象是
     `data:pull` 之后的快照，拉取失败时日志明确标注“本次检查的是旧快照”。
   - `test:ui:ci-launcher` 用占用端口的 HTTP 200 模拟旧服务，断言启动器拒绝误连；
     排序步骤使用临时合成记录（插入 B→A，断言升序 A→B），不依赖生产标题 / 条数。
   - `test:ui` 仍保留“复用已启动 dev server”的本地模式；`test:ui:ci` 是 verify / CI 使用的
     自动服务器版本，两者运行同一套 99 步浏览器点击测试。

回归结果（本轮）：`selftest` **1120/1120**（资料质量组 98/98，结构化资料组 321/321）、
`test:data-quality` **1/1**、`test:catalog` 3/3、`test:gamejolt` 22/22、`smoke` 16/16、
UI 点击 99/99；当前快照 `check:data --strict` 为 error 0 · warning 7 · info 14。
