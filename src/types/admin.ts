/**
 * 后台专用类型
 *
 * 领域模型本身仍然在 `types/game.ts`；这里只放「管理视角」的类型与配套文案表。
 *
 * 关于「文案常量为什么放在类型文件里」：`STATUS_LABELS` 是 `GameStatus` 的一对一映射，
 * 放在类型定义旁边才能让编译器在联合类型增删成员时立刻报错（Record 缺键即编译失败），
 * 从机制上杜绝「加了状态却忘了加文案」。
 */
import type {
  DevelopmentStatus,
  Game,
  GameRelation,
  GameStatus,
} from './game'

/**
 * 后台使用的游戏视图模型 —— 可选字段已全部落地为必填。
 *
 * 用交叉类型而不是 `interface extends`：`Game` 里的 `status?: GameStatus`
 * 与这里的 `status: GameStatus` 相交后即为必填，无需重写全部字段。
 */
export type AdminGame = Game & {
  shortDescription: string
  altTitles: string[]
  gameplayTypes: string[]
  mechanics: string[]
  tags: string[]
  platforms: string[]
  developmentStatus: DevelopmentStatus
  relations: GameRelation[]
  sourceUrl: string
  status: GameStatus
  featured: boolean
  archived: boolean
  sortOrder: number
  /** 空字符串 = 数据源尚未记录该时间戳。UI 渲染为「—」，**不伪造日期** */
  createdAt: string
  updatedAt: string
  /**
   * 最近一次修改这条数据的人（GitHub 账号名）。Phase 19 增加。
   * 与 updatedAt 一样由仓储管理，调用方不写 —— 它回答的是「这条数据谁最后碰过」，
   * 在多人后台里跟更新时间同等重要。
   */
  updatedBy?: string
  publishedAt: string
}

/**
 * 状态筛选取值。
 *
 * - `'all'`      不按状态过滤，且**不含已归档**（归档 = 收起来，不该占用日常视野）
 * - 三个 GameStatus 是互斥的，三者之和等于 `'all'`
 * - `'archived'` 是**叠加维度**，与上面的三项正交；它不计入 `'all'`
 */
export type StatusFilter = GameStatus | 'archived' | 'all'

/** 后台列表排序键 */
export type AdminSortKey =
  | 'updatedAt'
  | 'createdAt'
  | 'sortOrder'
  | 'title'
  | 'releaseYear'
  | 'views'
  | 'score'

/** 后台列表查询条件 */
export interface AdminGameQuery {
  search: string
  status: StatusFilter
  author: string | null
  tag: string | null
  sort: AdminSortKey
  page: number
  pageSize: number
}

/** 状态文案的唯一来源 */
export const STATUS_LABELS: Record<GameStatus, string> = {
  published: '已上线',
  draft: '草稿',
  offline: '已下线',
}

/**
 * 状态筛选的完整文案表（含「全部」与「已归档」）。
 * 用 Record 而不是 if-else，是为了让 StatusFilter 增删成员时编译立刻报错。
 */
export const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: '全部',
  published: STATUS_LABELS.published,
  draft: STATUS_LABELS.draft,
  offline: STATUS_LABELS.offline,
  archived: '已归档',
}

/** 状态筛选 chip 的固定顺序（工具栏与断言共用，避免两处各写一遍） */
export const STATUS_FILTER_ORDER: StatusFilter[] = [
  'all',
  'published',
  'draft',
  'offline',
  'archived',
]

/** 状态筛选文案 */
export function statusFilterLabel(value: StatusFilter): string {
  return STATUS_FILTER_LABELS[value]
}

/** 排序下拉的选项与文案（顺序即展示顺序） */
export const SORT_OPTIONS: { key: AdminSortKey; label: string }[] = [
  { key: 'updatedAt', label: '更新时间' },
  { key: 'createdAt', label: '创建时间' },
  { key: 'sortOrder', label: '排序权重' },
  { key: 'title', label: '游戏名称' },
  { key: 'releaseYear', label: '发行年份' },
  { key: 'views', label: '热度' },
  { key: 'score', label: '评分' },
]

/* ==========================================================================
   编辑器草稿态
   ========================================================================== */

/**
 * 编辑器草稿。
 *
 * 文本字段都是**字符串** —— 表单的中间态允许「空」和「输入到一半」，
 * 那是合法的表单状态，但不是合法的模型值。校验通过后才由 `draftToPatch()`
 * 转换回模型类型（例如 releaseYear: string → number）。
 *
 * 标签、其他名称与分类词条是数组字段；其余都是文本中间态。
 */
export interface GameDraft {
  title: string
  author: string
  releaseYear: string
  ipSeries: string
  engine: string
  videoUrl: string
  /** 详情页 Hero 的一句话简介（选填，显示在标题下方） */
  shortDescription: string
  description: string
  /** 排序权重。数字字段也存成字符串 —— 表单中间态允许空 / 输入到一半 */
  sortOrder: string
  /** 标签。与 ipSeries（世界观归属）并列，不是替代关系 */
  tags: string[]
  /** 其他名称（搜索可见）。数量与单个长度上限见 ALT_TITLE_LIMITS */
  altTitles: string[]
  /** 官方页面 / 原始发布页。可留空；填了必须是 http(s) */
  sourceUrl: string
  /** 作品自身的开发状态 —— 与网站发布状态 `status` 完全正交 */
  developmentStatus: DevelopmentStatus
  /** 玩法类型词条 id（≤3）。**第一项是主要玩法**，顺序有含义 */
  gameplayTypes: string[]
  /** 机制词条 id（≤12） */
  mechanics: string[]
  /** 平台词条 id（≤8） */
  platforms: string[]
  /** 显式作品关系（有向边，≤20）；不是标签，也不由系列自动推导 */
  relations: GameRelation[]
  /** 封面图地址（站内路径或外链） */
  coverImage: string
  /** Banner 宣传图地址 */
  bannerImage: string
  /** 图库（有序，顺序即前台展示顺序） */
  gallery: string[]
  /** 下载渠道（有序，顺序即前台展示顺序） */
  downloads: DownloadDraft[]
  /** 发布状态 */
  status: GameStatus
  /** 归档标记（与 status 正交） */
  archived: boolean
  /** 首页推荐位 */
  featured: boolean
}

/** 草稿里的文本字段。字符串归一化与校验只针对这些 */
export type DraftTextField =
  | 'title'
  | 'author'
  | 'releaseYear'
  | 'ipSeries'
  | 'engine'
  | 'videoUrl'
  | 'shortDescription'
  | 'description'
  | 'sortOrder'
  | 'sourceUrl'
  | 'coverImage'
  | 'bannerImage'

export const DRAFT_TEXT_FIELDS: DraftTextField[] = [
  'title',
  'author',
  'releaseYear',
  'ipSeries',
  'engine',
  'videoUrl',
  'shortDescription',
  'description',
  'sortOrder',
  'sourceUrl',
  'coverImage',
  'bannerImage',
]


/** 下载渠道的草稿行。三个字段都是字符串 —— 表单中间态允许空 */
export interface DownloadDraft {
  provider: string
  url: string
  password: string
}

export const DOWNLOAD_LIMITS = {
  /** 单条作品最多下载渠道数 */
  maxPerGame: 8,
  /** 服务商 / 提取码的最大长度 */
  maxTextLength: 30,
}

/** 各文本字段的长度上限（保存与编辑器共用） */
export const DRAFT_LIMITS = {
  title: 120,
  author: 80,
  ipSeries: 60,
  engine: 60,
  shortDescription: 120,
  description: 2000,
  sourceUrl: 300,
} as const

/** 年份下限：FNAF 初代是 2014，留一点余量 */
const YEAR_MIN = 1990
/** 年份上限余量：允许填写「已公布发售日」的预告作品 */
const YEAR_MAX_OFFSET = 2

/** 允许的发行年份区间 */
export const YEAR_RANGE = {
  min: YEAR_MIN,
  max: new Date().getFullYear() + YEAR_MAX_OFFSET,
} as const

/**
 * 校验单行下载渠道，返回第一条错误文案（空字符串 = 通过）。
 *
 * 每行只报第一条错误 —— 一行同时飘三条红字只会让人不知道先改哪个。
 */
export function validateDownload(link: DownloadDraft): string {
  const provider = link.provider.trim()
  if (!provider) return '服务商不能为空'
  if (provider.length > DOWNLOAD_LIMITS.maxTextLength) {
    return `服务商不能超过 ${DOWNLOAD_LIMITS.maxTextLength} 个字符`
  }

  const url = link.url.trim()
  if (!url) return '下载地址不能为空'
  if (!/^https?:\/\/\S+$/i.test(url)) {
    return '下载地址必须是 http:// 或 https:// 开头的完整链接'
  }

  const password = link.password.trim()
  if (password.length > DOWNLOAD_LIMITS.maxTextLength) {
    return `提取码不能超过 ${DOWNLOAD_LIMITS.maxTextLength} 个字符`
  }

  return ''
}

/** 草稿里所有参与「改动比较」的字段 */
export type DraftField =
  | DraftTextField
  | 'tags'
  | 'altTitles'
  | 'developmentStatus'
  | 'gameplayTypes'
  | 'mechanics'
  | 'platforms'
  | 'relations'
  | 'gallery'
  | 'downloads'
  | 'status'
  | 'archived'
  | 'featured'

export const DRAFT_FIELDS: DraftField[] = [
  ...DRAFT_TEXT_FIELDS,
  'tags',
  'altTitles',
  'developmentStatus',
  'gameplayTypes',
  'mechanics',
  'platforms',
  'relations',
  'gallery',
  'downloads',
  'status',
  'archived',
  'featured',
]

/**
 * 数组型字段的错误槽。
 *
 * 它们不是文本输入框（没有 `DraftTextField` 那种「字符串中间态」），
 * 但校验结果要和文本字段放在同一张表里 —— 否则 `isValid` 得在多个地方
 * 各拼一次条件，迟早漏掉一个。
 */
export type DraftGroupField = 'altTitles' | 'gameplayTypes' | 'mechanics' | 'platforms'

export const DRAFT_GROUP_FIELDS: DraftGroupField[] = [
  'altTitles',
  'gameplayTypes',
  'mechanics',
  'platforms',
]

export type DraftErrorField = DraftTextField | DraftGroupField

/** 草稿校验结果。键为字段名，值为错误文案；空字符串表示通过 */
export type DraftErrors = Record<DraftErrorField, string>

/** 所有参与「是否通过校验」的字段（文本 + 数组组） */
export const DRAFT_ERROR_FIELDS: DraftErrorField[] = [
  ...DRAFT_TEXT_FIELDS,
  ...DRAFT_GROUP_FIELDS,
]

/**
 * 写入片段：只描述「这次要改哪些字段」。
 *
 * ⚠️ 刻意排除 `id` / `createdAt` / `updatedAt` 三个字段 —— 它们由仓储自己管理。
 * 允许调用方写 id，新建时就会撞车；允许写时间戳，「谁在什么时候改的」就失去意义。
 * 用类型把这条规则钉死，比写注释可靠。
 */
export type GamePatch = Partial<Omit<AdminGame, 'id' | 'createdAt' | 'updatedAt'>>

/* ==========================================================================
   写入落在哪里
   ========================================================================== */

/**
 * 一次写入实际落在了什么地方。
 *
 * 【为什么要显式建模】这是整个后台最容易骗到用户的地方：
 * 用户心里的「保存成功」= 「线上已经是这样了」，而实际上可能只存在他自己的浏览器里。
 * 所以每一次写入都必须带上它，UI 据此说出**准确**的那句话，而不是笼统的「保存成功」。
 *
 * - `memory` 只写了内存，刷新即丢（SSR、隐私模式、浏览器存储写满时会降级到这里）
 * - `local`  写进了本机浏览器存储：刷新不丢，但**不是**线上数据
 * - `remote` 写进了线上数据库（Phase 13 / 14 接入后才会出现）
 */
export type StorageKind = 'memory' | 'local' | 'remote'

/**
 * 每种写入位置的准确说法。
 *
 * **收敛在一处**：三个页面（列表 / 编辑 / 标签）的结果提示条都引用它，
 * 不能各写各的 —— 否则改了一处漏了另一处，用户会同时看到两种矛盾的说明。
 */
export const STORAGE_NOTICE: Record<StorageKind, string> = {
  memory: '改动只在当前页面有效 —— 刷新一下就恢复原样了。',
  local:
    '改动保存在这台设备的浏览器里 —— 刷新不会丢，但它不是线上数据，清掉浏览器数据就会恢复原样。',
  remote:
    '改动已经提交到数据仓，刷新也不会丢。前台下次打开或切回页面时会自动同步最新内容（一般几秒）；断网时会先用网站上原来的数据。改错了可以去数据仓的提交历史里回滚。',
}

/* ==========================================================================
   标签
   ========================================================================== */

/**
 * 标签约束。
 *
 * 上限存在的意义不是为了省空间，而是防止「标签通胀」—— 一旦每款作品能挂 50 个标签，
 * 标签就失去了作为筛选维度的价值。12 个足以描述玩法 / 风格 / 平台三类特征。
 */
export const TAG_LIMITS = {
  /** 单条作品最多标签数 */
  maxPerGame: 12,
  /** 单个标签最大长度 */
  maxLength: 24,
}

/**
 * 归一化标签输入：去首尾空白、把连续空白压成一个空格、去掉开头的 `#`。
 * 返回空字符串表示这不是一个有效标签。
 *
 * 入参写成 `unknown` 是刻意的：调用方可能是 `v-model` 绑到输入框的值，
 * 运行时类型并不受 TS 保证（参见 useAdminGameDraft 里关于类型漂移的说明）。
 */
export function normalizeTag(input: unknown): string {
  const text = typeof input === 'string' ? input : String(input ?? '')
  return text
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 标签是否合法（非空且不超长） */
export function isValidTag(tag: string): boolean {
  return tag.length > 0 && tag.length <= TAG_LIMITS.maxLength
}

/* ==========================================================================
   其他名称（altTitles）
   ========================================================================== */

export const ALT_TITLE_LIMITS = {
  /** 单条作品最多其他名称数 */
  maxPerGame: 5,
  /** 单个其他名称最大长度 */
  maxLength: 80,
} as const

/**
 * 归一化其他名称：NFKC、去首尾空白、折叠内部空白。
 *
 * 与标签不同，**不去 `#` 前缀** —— 其他名称是正式名称（可能含符号），
 * 不是社区标签。返回空字符串表示这一项无效。
 */
export function normalizeAltTitle(input: unknown): string {
  const text = typeof input === 'string' ? input : String(input ?? '')
  return text.normalize('NFKC').trim().replace(/\s+/g, ' ')
}

export function isValidAltTitle(title: string): boolean {
  return title.length > 0 && title.length <= ALT_TITLE_LIMITS.maxLength
}

/* ==========================================================================
   图片（Phase 7：只做 UI，接 Storage 是 Phase 16）
   ========================================================================== */

export const IMAGE_LIMITS = {
  /** 图库最多图片数 */
  maxGallery: 8,
  /**
   * 单个文件大小上限（字节）。
   * GitHub Contents API 走 JSON + base64（会膨胀约 1/3），4 MB 是个舒服的上限；
   * 真需要更大图时应该先压缩，而不是把上限往上抬。
   */
  maxFileBytes: 4 * 1024 * 1024,
  /** 封面 / Banner 的最小宽度（像素）。再小放到卡片上就会糊 */
  minWidth: 640,
  /** 图库缩略图的最小宽度（像素）—— 它显示的格子比封面小 */
  minGalleryWidth: 400,
  /** 单边最大像素数。防的是「一张图几千万像素」 */
  maxPixels: 8192,
  /** 比例偏离到多少才提示（0.25 = 25%）。低于它就不打扰用户 */
  ratioDriftTolerance: 0.25,
  /** 单张图片地址最大长度 */
  maxLength: 500,
}

/** 图片位。决定尺寸与比例的校验标准 */
export type ImageSlot = 'cover' | 'banner' | 'gallery'

/**
 * 是否为「本地临时预览地址」。
 *
 * 没有存储层（Phase 16）时，从本机选的图片只能用 `URL.createObjectURL()` 生成一个
 * `blob:` 地址 —— 它**只在本页有效、刷新即失效，也根本不可能被保存下来**。
 * 这类值必须被 UI 显式标注，否则用户会以为「已经上传成功了」。
 */
export function isLocalPreviewUrl(value: string): boolean {
  return value.startsWith('blob:')
}

/** 归一化图片地址：去首尾空白 */
export function normalizeImageRef(input: unknown): string {
  const text = typeof input === 'string' ? input : String(input ?? '')
  return text.trim()
}

/**
 * 地址形式是否可用。允许四类：
 *   - 本地临时预览 `blob:`（UI 会另行标注「未上传」）
 *   - `data:image/...`
 *   - http(s) 外链 / 协议相对地址
 *   - 站内路径（以 `/` 开头，且以图片扩展名结尾，允许带查询串或 hash）
 */
export function isValidImageRef(value: string): boolean {
  if (isLocalPreviewUrl(value)) return true
  if (value.startsWith('data:image/')) return true
  if (/^(https?:)?\/\/\S+$/i.test(value)) return true
  return /^\/\S*\.(svg|png|jpe?g|webp|gif|avif)([?#].*)?$/i.test(value)
}
