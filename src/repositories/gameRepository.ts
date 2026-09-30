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
 * 【当前实现】`localGameRepository` —— 内存实现，**刷新即丢**（Phase 12 才持久化）。
 * `remoteGameRepository` 是尚未接入的占位，被调用会直接抛错。
 * ============================================================================
 */
import type { ComputedRef } from 'vue'
import type { AdminGame, GamePatch, StorageKind } from '../types/admin'

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

  /** 全量列表（返回副本，调用方无法借此改到内部数据） */
  listGames(): Promise<AdminGame[]>
  /** 按 id 取单条 */
  getGame(id: string): Promise<AdminGame | undefined>

  /** 新建。**id 由仓储按标题生成**并保证不冲突 */
  createGame(patch: GamePatch): Promise<AdminGame>
  /** 更新。id 不存在时**显式抛错**，不静默吞掉 */
  updateGame(id: string, patch: GamePatch): Promise<AdminGame>
  /**
   * 删除。
   * ⚠️ **UI 刻意不暴露这个动作** —— 下线的正确做法是 `unpublishGame`（数据完整保留）。
   * 保留这个方法是为了接口完整，以及给「确实要清理脏数据」的场景用。
   */
  deleteGame(id: string): Promise<boolean>

  /** 上线：把状态置为 `published` */
  publishGame(id: string): Promise<AdminGame>
  /** 下线：把状态置为 `offline`。**不删数据** */
  unpublishGame(id: string): Promise<AdminGame>

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
