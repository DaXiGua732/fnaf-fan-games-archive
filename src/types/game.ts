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
}
