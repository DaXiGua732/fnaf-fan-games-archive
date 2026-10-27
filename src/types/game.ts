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
  /** 静态热度基数：用于列表排序 / 计数服务不可用时兜底（详情页实时数不写回这里） */
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

/**
 * 游戏自身的开发状态 —— **与网站发布状态（GameStatus）完全正交**。
 *
 * 一款已取消开发的作品仍然可以被网站正常收录、上线；
 * 任何可见性判断都不得读取本字段（见 useGameLibrary.isPubliclyVisible）。
 *
 * `unknown` 是「资料尚未标注」，不是「未开发」。
 */
export type DevelopmentStatus =
  | 'released'
  | 'in-development'
  | 'on-hold'
  | 'cancelled'
  | 'unknown'

export const DEVELOPMENT_STATUSES: DevelopmentStatus[] = [
  'released',
  'in-development',
  'on-hold',
  'cancelled',
  'unknown',
]

/** 开发状态文案的唯一来源（联合类型增删成员时 Record 会立即报编译错误） */
export const DEVELOPMENT_STATUS_LABELS: Record<DevelopmentStatus, string> = {
  released: '已发布',
  'in-development': '开发中',
  'on-hold': '暂停开发',
  cancelled: '已取消',
  unknown: '未标注',
}

/**
 * 作品之间的关系类型。
 *
 * 方向固定为「本作 → 目标」，例如 `{ type: 'sequel', targetId: X }`
 * 读作「本作是 X 的续作」。反向文案由目标详情页派生，**不落库**。
 */
export type RelationType =
  | 'prequel'
  | 'sequel'
  | 'remake'
  | 'reboot'
  | 'spin-off'
  | 'same-universe'
  | 'related'

export interface GameRelation {
  type: RelationType
  /** 目标游戏 id；指向不存在 / 不可见的作品时由展示层忽略 */
  targetId: string
}
export const RELATION_LIMITS = {
  /** 单条作品最多保存多少条显式关系 */
  maxPerGame: 20,
} as const

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
  /**
   * 其他名称 / 别名。只参与搜索与详情展示，不作为索引维度。
   * 旧记录没有该字段，归一化为 []。
   */
  altTitles?: string[]
  /**
   * 玩法类型词条 ID（见 taxonomy.gameplayTypes）。
   * 有序：第一项是主要玩法，其余是次要玩法；为空 = 未分类。
   */
  gameplayTypes?: string[]
  /** 游戏机制词条 ID（见 taxonomy.mechanics） */
  mechanics?: string[]
  /** 自由标签（风格 / 题材等）；与 ipSeries（世界观归属）并列，不是替代关系 */
  tags?: string[]
  /**
   * 支持平台词条 ID（见 taxonomy.platforms）。
   * 历史数据可能仍是「Windows」这类名称，解析时先按 ID、再按名称。
   */
  platforms?: string[]
  /**
   * 游戏自身的开发状态；缺省 / 非法值归一化为 'unknown'。
   * 与网站 status 无关，不参与公开可见性判断。
   */
  developmentStatus?: DevelopmentStatus
  /**
   * 明确的资料关系。只存「本作 → 目标」的一条有向边，
   * 反向展示由目标页派生；同一目标最多一条。
   */
  relations?: GameRelation[]
  /** 官方页面 / 原始发布页；用于资料溯源，只接受 http(s) */
  sourceUrl?: string
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
  /**
   * ISO 8601 时间戳：`YYYY-MM-DDTHH:mm:ss`，可带 1–9 位小数秒，时区为 `Z` 或 `±HH:MM`。
   * 空字符串表示数据源尚未记录该字段。
   */
  createdAt?: string
  updatedAt?: string
  publishedAt?: string
}
