/**
 * 领域模型 —— 游戏资源条目
 * 该类型是 db.json 的唯一契约，视图层与深模块共用。
 */
export interface DownloadLink {
  /** 网盘服务商，如「123云盘」「百度网盘」 */
  provider: string
  url: string
  /** 网盘提取码，无则省略 */
  password?: string
}

export interface GameMetrics {
  /** 站内浏览量（无后端方案下为静态基数） */
  fakeViews: number
  /** 5 分制评分 */
  score: number
}

/**
 * 发布状态。
 * - `published` 前台可见，后台可见
 * - `draft`     前台不可见，后台可见
 * - `offline`   前台不可见，后台保留（下线靠改状态，不靠删数据）
 */
export type GameStatus = 'draft' | 'published' | 'offline'

export interface Game {
  /** 唯一标识，同时用作路由参数 /game/:id */
  id: string
  title: string
  author: string
  releaseYear: number
  /** 所属 IP 系列 */
  ipSeries: string
  /** 开发引擎（详情页数据表格用） */
  engine: string
  coverImage: string
  bannerImage: string
  gallery: string[]
  videoUrl?: string
  description: string
  downloads: DownloadLink[]
  metrics: GameMetrics

  /* ========================================================================
     以下字段自 Phase 2 起新增，**全部 optional**。

     db.json 里的旧数据不带这些字段，由 `src/utils/gameDefaults.ts` 的
     normalizeGame() 补缺省值。因此：
       - 新增字段不需要任何数据迁移
       - 不会让现有前台因为多出必填字段而崩溃
     ======================================================================== */

  /** 列表卡片 / 搜索结果用的一句话简介 */
  shortDescription?: string
  /** 自由标签（玩法 / 风格特征）；与 ipSeries（世界观归属）并列，不是替代关系 */
  tags?: string[]
  /** 支持平台，如 ['Windows', 'Android'] */
  platforms?: string[]
  /** 发布状态；**缺省视为 'published'**（理由见 gameDefaults.ts） */
  status?: GameStatus
  /** 首页推荐位 */
  featured?: boolean
  /**
   * 归档标记。**与 status 正交，不改发布状态**。
   *
   * 语义：把作品从日常管理视野里「收起来」，默认列表不再显示，需要显式筛选才可见。
   * 之所以不复用 status：归档一个草稿不应该把它变成「已下线」，那会丢信息。
   * 因此前台可见性的完整判据是 `status === 'published' && !archived`（Phase 10 落地）。
   */
  archived?: boolean
  /** 手动排序权重，越大越靠前 */
  sortOrder?: number
  /** ISO 8601 时间戳；空字符串表示数据源尚未记录该字段 */
  createdAt?: string
  updatedAt?: string
  publishedAt?: string
}
