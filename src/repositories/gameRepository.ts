/**
 * ============================================================================
 * GameRepository —— 数据访问的统一契约
 * ============================================================================
 * 后台**只允许**通过它读写数据。多这一层的意义不在于「更规范」，
 * 而在于把「数据从哪来、写到哪去」收敛成一个**可替换的部件**：
 *
 *   - Phase 12 换成本地持久化（localStorage）→ 上层零改动
 *   - Phase 13 / 14 换成远程库（GitHub API / 云数据库）→ 同样只换实现
 *
 * 【禁止】后台的 `.vue` 里出现 `import db from '../data/db.json'`，
 * 也禁止组件直接碰运行期数据源。`scripts/selftest.mts` 有一条静态守卫在扫这个。
 *
 * 【当前实现】两个：
 *   - `localGameRepository` —— 构建期快照 + localStorage（未登录后台 / 前台兜底）
 *   - `githubGameRepository` —— GitHub Contents API（登录后的后台，写线上数据仓）
 * ============================================================================
 */
import type { ComputedRef } from 'vue'
import type { AdminGame, GamePatch, StorageKind } from '../types/admin'
import type {
  Taxonomy,
  VocabularyCollection,
  VocabularyEntry,
  VocabularyEntryInput,
  VocabularyEntryPatch,
  VocabularyMutationResult,
} from '../types/taxonomy'

export interface GameRepository {
  /**
   * 响应式只读快照。
   *
   * 存在的理由：UI 需要**同步**拿到数据才能渲染，而仓储的读写接口都是异步的
   * （本地实现现在可以同步完成，但远程实现必然异步 —— 不能等到那天再改上层）。
   * 由实现方负责在写入后更新这个快照，消费方因此不必知道数据究竟存在哪里。
   */
  readonly games: ComputedRef<AdminGame[]>

  /**
   * 分类词表（玩法类型 / 机制 / 平台）的响应式快照。
   *
   * 与 `games` 来自同一份数据仓文件；旧数据没有 taxonomy 时由仓储补内置初始词表。
   * 公开查询只应把**可见作品**交给词表统计，不要直接拿这里的全量做前台选项。
   */
  readonly taxonomy: ComputedRef<Taxonomy>

  /**
   * 数据源里的词表结构问题（缺字段、重复 id、名称冲突等）。
   * 前台可以忽略；后台词表页应当显示，避免「词条看起来少了但不知道为什么」。
   */
  readonly taxonomyIssues: ComputedRef<string[]>

  /**
   * 写入实际会落在哪里。
   * 由实现方声明，UI 据此如实告知用户 —— 见 `STORAGE_NOTICE`。
   */
  readonly storage: ComputedRef<StorageKind>

  /**
   * 数据是否已经可用。
   *
   * 本地实现恒为 `true`（数据在构建期就打进来了）；
   * **远程实现必然要先把它拉下来**，那段时间 UI 必须显示「加载中」——
   * 而不是显示一个空列表：后者看起来就像「数据全没了」，比报错更让人慌。
   */
  readonly ready: ComputedRef<boolean>

  /** 拉取 / 通信失败的原因。空字符串表示一切正常 */
  readonly error: ComputedRef<string>

  /**
   * 重新拉取一次数据。
   * 给「加载失败 → 重试」用。本地实现是空操作（数据本来就在手边）。
   */
  reload(): Promise<void>

  /**
   * 用外部数据**整表替换**内存目录。
   *
   * 前台启动 / 回到公开页时，用它把「构建期快照」换成数据仓的最新数据。
   * 刻意**不写本机存档**：这是「读最新」，不是「本地编辑」。
   *
   * `taxonomy` 省略时保留当前词表 —— 数据仓还没有 taxonomy 字段的旧快照
   * 不应该把本机已有的词表清空。
   */
  hydrate(games: AdminGame[], taxonomy?: Taxonomy): void

  /** 全量列表（返回副本，调用方无法借此改到内部数据） */
  listGames(): Promise<AdminGame[]>
  /** 按 id 取单条 */
  getGame(id: string): Promise<AdminGame | undefined>

  /** 新建。**id 由仓储按标题生成**并保证不冲突 */
  createGame(patch: GamePatch): Promise<AdminGame>
  /** 更新。id 不存在时**显式抛错**，不静默吞掉 */
  updateGame(id: string, patch: GamePatch): Promise<AdminGame>
  /**
   * 永久删除。
   * UI 在列表行内和编辑页「危险操作」区提供入口，且必须经过二次确认；
   * 如果只是不想让作品对外可见，正确做法是 `unpublishGame`（数据完整保留）。
   */
  deleteGame(id: string): Promise<boolean>

  /** 上线：把状态置为 `published` */
  publishGame(id: string): Promise<AdminGame>
  /** 下线：把状态置为 `offline`。**不删数据** */
  unpublishGame(id: string): Promise<AdminGame>

  /* -------------------------------------------------------------------------
     分类词表
     -------------------------------------------------------------------------
     每个实现都必须在**最新数据**上重新校验重名 / 合并 / 删除保护，
     不能只相信调页面时的内存快照。两个实现共用 utils/taxonomy 的纯函数。
     ------------------------------------------------------------------------- */

  /** 新建词条；`id` 省略时按名称生成稳定标识 */
  createVocabularyEntry(
    collection: VocabularyCollection,
    input: VocabularyEntryInput,
  ): Promise<VocabularyEntry>

  /** 改名 / 改定义；id 不可改，改名不触碰任何作品 */
  updateVocabularyEntry(
    collection: VocabularyCollection,
    id: string,
    patch: VocabularyEntryPatch,
  ): Promise<VocabularyEntry>

  /** 把 source 合并到 target，并删除 source；同时改写作品引用（整次操作一个提交） */
  mergeVocabularyEntries(
    collection: VocabularyCollection,
    sourceId: string,
    targetId: string,
  ): Promise<VocabularyMutationResult>

  /**
   * 删除词条。
   * 仍被作品引用时默认抛错；显式传 `removeFromGames: true` 才同时从作品移除。
   */
  deleteVocabularyEntry(
    collection: VocabularyCollection,
    id: string,
    options?: { removeFromGames?: boolean },
  ): Promise<VocabularyMutationResult>

  /**
   * 上传一张图片到数据仓，返回它的**公开访问地址**。
   *
   * 只存在于远程实现 —— 本地模式没有可写的远端，会直接抛错。
   * 调用方应先看 `storage`，只有 `remote` 时才提供上传入口。
   *
   * ⚠️ 存储布局（目录、文件名）是**存储层的细节**，所以由实现方决定，
   * 调用方只给出「哪条作品的哪个位置」。
   */
  uploadImage(
    file: Blob,
    options: { gameId: string; slot: 'cover' | 'banner' | 'gallery' },
  ): Promise<string>

  /**
   * 删除数据仓里的一张图片（按它的公开地址定位）。
   *
   * ⚠️ **只用于清理「已经没人引用的旧上传图」**，调用方必须先确认
   * 没有任何作品还在用它 —— 删掉一张仍在使用的图，前台会直接裂图。
   * 本地模式会抛错（没有可写的远端）。
   *
   * 删不掉不算致命：git 历史里那份还在，可以 revert 回来，
   * 所以调用方应当把失败当成「留下了一张废图」，而不是「操作失败」。
   */
  deleteImage(url: string): Promise<void>

  /**
   * 把数据恢复成**出厂状态**（即构建期那份快照），丢弃全部本地改动。
   *
   * 这个方法存在的理由是**逃生舱**：本地存档一旦进入怪状态，用户必须有办法退回去，
   * 而不是只能手动清浏览器数据。
   *
   * ⚠️ **远程实现会拒绝执行** —— 「一键把线上数据仓覆盖回出厂内容」不是后台该有的能力，
   * 真要回滚应该用 git。（UI 在远程模式下也不显示这个按钮。）
   */
  resetToSeed(): Promise<void>
}
