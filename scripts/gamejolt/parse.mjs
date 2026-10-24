/**
 * ============================================================================
 * GameJolt 作品数据提取 —— 纯函数
 * ============================================================================
 * 这个文件**不联网、不读文件、不依赖浏览器**，只做两件事：
 *
 *   1. 把站长粘贴的 GameJolt 链接解析成作品 ID；
 *   2. 把 GameJolt 的详情 / 概览 JSON 转成本站后台能直接消费的字段。
 *
 * 【为什么单独成文件】
 *   抓取助手（helper.mjs）和测试（test.mjs）都要用同一套转换规则。
 *   如果把规则抄两份，一次 GameJolt 字段改版就会变成两份互不一致的修复。
 *
 * 【转换策略：只做确定的事】
 *   - 标题 / 作者 / 年份 / 引擎 / 简介 / 图片：能确定就填；
 *   - IP 系列：只在标题或简介里出现 FNAF 字样时填 "FNAF"，否则留空并给出警告；
 *   - 下载渠道：**绝不猜**（游戏文件需要人工下载上传，这是产品决定）；
 *   - 标签：取 GameJolt 的分类与简介里明确写出的 hashtag，不自行发挥。
 * ============================================================================
 */

/** 年份可填范围 —— 与后台编辑器同一口径（见 useAdminGameDraft 的 YEAR_RANGE） */
const YEAR_MIN = 1990
const YEAR_MAX_OFFSET = 2

/** 简介上限 —— 与 DRAFT_LIMITS.description 保持一致 */
export const DESCRIPTION_LIMIT = 2000
/** 一句话简介上限 —— 与 DRAFT_LIMITS.shortDescription 保持一致 */
export const SHORT_DESCRIPTION_LIMIT = 120
/** 图库上限 —— 与 IMAGE_LIMITS.maxGallery 保持一致 */
export const MAX_GALLERY = 8
/** 标签上限与单标签长度 —— 与 TAG_LIMITS 保持一致 */
export const MAX_TAGS = 12
export const TAG_MAX_LENGTH = 24
/** 封面 / Banner 的最小宽度 —— 与 IMAGE_LIMITS.minWidth 保持一致 */
export const COVER_MIN_WIDTH = 640
/** 图库最小宽度 —— 与 IMAGE_LIMITS.minGalleryWidth 保持一致 */
export const GALLERY_MIN_WIDTH = 400

/** GameJolt 的 creation_tool 代码 → 人类可读名称。只在 creation_tool_human 缺失时兜底 */
const TOOL_LABELS = {
  clickteam: 'Clickteam',
  game_maker_studio: 'Game Maker: Studio',
  game_maker: 'Game Maker',
  unity: 'Unity',
  unreal_engine: 'Unreal Engine',
  rpg_maker: 'RPG Maker',
  construct: 'Construct',
  construct_2: 'Construct 2',
  construct_3: 'Construct 3',
  godot: 'Godot',
  gamemaker: 'Game Maker',
}

/**
 * 输入错误。
 * helper 据此返回 400（而不是把所有失败都报成 502），前端才能区分
 * 「链接粘错了」和「GameJolt 暂时挂了」。
 */
export class GameJoltInputError extends Error {
  constructor(message) {
    super(message)
    this.name = 'GameJoltInputError'
    this.code = 'INVALID_INPUT'
  }
}

/* ==========================================================================
   一、链接解析
   ========================================================================== */

/**
 * 解析 GameJolt 作品页链接或裸 ID。
 *
 * 支持：
 *   - https://gamejolt.com/games/<slug>/<id>
 *   - https://gamejolt.com/games/<slug>/<id>/comments
 *   - https://gamejolt.com/games/<id>
 *   - 裸数字 ID
 *
 * **只接受 gamejolt.com**。helper 会根据这个 ID 自己拼 API 地址，
 * 绝不会去请求用户给的任意 URL —— 这既是功能边界，也是本地代理的 SSRF 边界。
 */
export function parseGameJoltInput(input) {
  const raw = typeof input === 'string' ? input.trim() : ''
  if (!raw) throw new GameJoltInputError('请粘贴 GameJolt 作品页链接。')

  if (/^\d+$/.test(raw)) {
    const id = Number(raw)
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new GameJoltInputError('作品 ID 不是一个有效数字。')
    }
    return { id, sourceUrl: '' }
  }

  let parsed
  try {
    parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    throw new GameJoltInputError('这不是一个有效的链接。')
  }

  const host = parsed.hostname.toLowerCase()
  if (host !== 'gamejolt.com' && host !== 'www.gamejolt.com') {
    throw new GameJoltInputError('只支持 gamejolt.com 的作品页链接。')
  }

  const path = parsed.pathname.replace(/\/+$/, '')
  const patterns = [
    /^\/games\/[^/]+\/(\d+)(?:\/|$)/,
    /^\/games\/(\d+)(?:\/|$)/,
    /^\/[^/]+\/(\d+)(?:\/|$)/,
  ]

  for (const pattern of patterns) {
    const match = path.match(pattern)
    if (!match) continue
    const id = Number(match[1])
    if (!Number.isSafeInteger(id) || id <= 0) break
    return { id, sourceUrl: parsed.toString() }
  }

  throw new GameJoltInputError(
    '链接里找不到作品 ID。请使用形如 https://gamejolt.com/games/xxx/123456 的地址。',
  )
}

/* ==========================================================================
   二、富文本 → 纯文本
   ==========================================================================
   GameJolt 的简介不是 HTML，而是一棵 ProseMirror 风格的 JSON 树
   （paragraph / bulletList / text / hardBreak / tag mark…）。
   直接 JSON.stringify 当然也能塞进简介，但那对读者没有任何意义。
   这里只渲染常见节点，未知节点降级为读取它的子节点 —— 宁可少一点格式，
   也不要把整段简介变成一行 JSON。
   ========================================================================== */

function parseRichDoc(value) {
  if (value == null) return null
  if (typeof value === 'object') return value
  if (typeof value !== 'string') return null

  const text = value.trim()
  if (!text) return null
  if (!text.startsWith('{') && !text.startsWith('[')) return null

  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function renderRichNode(node) {
  if (!node || typeof node !== 'object') return ''

  switch (node.type) {
    case 'doc':
      return renderBlockChildren(node.content, '\n\n')
    case 'paragraph':
    case 'heading':
      return renderInlineChildren(node.content)
    case 'bulletList':
      return (node.content || [])
        .map((item) => prefixLines(renderRichNode(item), '- '))
        .filter(Boolean)
        .join('\n')
    case 'orderedList':
      return (node.content || [])
        .map((item, index) => prefixLines(renderRichNode(item), `${index + 1}. `))
        .filter(Boolean)
        .join('\n')
    case 'listItem':
      return renderBlockChildren(node.content, '\n')
    case 'blockquote':
      return prefixLines(renderBlockChildren(node.content, '\n\n'), '> ')
    case 'codeBlock':
      return renderInlineChildren(node.content)
    case 'horizontalRule':
      return '---'
    case 'hardBreak':
      return '\n'
    case 'text':
      return node.text || ''
    case 'image':
      return node.attrs?.alt || ''
    default:
      // 未知块级节点：有子节点就继续往下渲染，没有就忽略。
      return renderBlockChildren(node.content, '\n\n')
  }
}

function renderInlineChildren(children) {
  return (children || []).map(renderRichNode).join('')
}

function renderBlockChildren(children, separator) {
  return (children || [])
    .map(renderRichNode)
    .filter((part) => part !== '')
    .join(separator)
}

function prefixLines(text, prefix) {
  if (!text) return ''
  return text
    .split('\n')
    .map((line) => (line ? `${prefix}${line}` : line))
    .join('\n')
}

function normalizePlainText(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 把 GameJolt 的 `description_content` 转成纯文本。
 * 接受的入参既可以是已经是对象的树，也可以是 API 返回的那串 JSON 字符串。
 */
export function richTextToPlainText(value) {
  const doc = parseRichDoc(value)
  if (doc) return normalizePlainText(renderRichNode(doc))
  if (typeof value === 'string') return normalizePlainText(value)
  return ''
}

/**
 * 收集简介里明确出现的标签：
 *   - ProseMirror 的 `tag` mark（GameJolt 把 #FNAF 之类存成 mark）
 *   - 正文里的 #hashtag
 *
 * 返回的是**未归一化**的原始标签，由 normalizeTags 统一清理。
 */
export function extractRichTextTags(value) {
  const doc = parseRichDoc(value)
  const result = []

  function walk(node) {
    if (!node || typeof node !== 'object') return

    if (node.type === 'text' && typeof node.text === 'string') {
      for (const mark of node.marks || []) {
        if (mark?.type === 'tag' && mark.attrs?.tag) result.push(mark.attrs.tag)
      }
      const matches = node.text.match(/#[\p{L}\p{N}_-]+/gu)
      if (matches) result.push(...matches)
    }

    for (const child of node.content || []) walk(child)
  }

  if (doc) walk(doc)
  else if (typeof value === 'string') {
    const matches = value.match(/#[\p{L}\p{N}_-]+/gu)
    if (matches) result.push(...matches)
  }

  return result
}

/* ==========================================================================
   三、字段转换
   ========================================================================== */

function cleanText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00A0/g, ' ')
    .trim()
}

function oneLineText(value) {
  return cleanText(value).replace(/\s+/g, ' ').trim()
}

function normalizeTags(rawTags, category) {
  const candidates = [...rawTags]
  if (category) candidates.push(category)

  const seen = new Set()
  const result = []

  for (const raw of candidates) {
    const tag = String(raw ?? '')
      .replace(/^#+/, '')
      .replace(/[\u0000-\u001f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!tag || tag.length > TAG_MAX_LENGTH) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(tag)
    if (result.length >= MAX_TAGS) break
  }

  return result
}

function pickReleaseYear(game, warnings) {
  const now = new Date().getUTCFullYear()
  const candidates = [game.published_on, game.posted_on]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)

  for (const timestamp of candidates) {
    const year = new Date(timestamp).getUTCFullYear()
    if (year >= YEAR_MIN && year <= now + YEAR_MAX_OFFSET) return year
  }

  warnings.push(`GameJolt 的发布日期缺失或超出 ${YEAR_MIN}–${now + YEAR_MAX_OFFSET}，年份暂用 ${now}，请手动核对。`)
  return now
}

function pickEngine(game, warnings) {
  const human = oneLineText(game.creation_tool_human).replace(/\s+Series$/i, '').trim()
  if (human && human.toLowerCase() !== 'other') return human

  if (human.toLowerCase() === 'other') {
    const other = oneLineText(game.creation_tool_other)
    if (other) return other
  }

  const code = oneLineText(game.creation_tool)
  if (code) {
    return TOOL_LABELS[code] || code.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase())
  }

  warnings.push('GameJolt 没有提供开发引擎，请手动填写。')
  return ''
}

function inferIpSeries(title, description, tags) {
  const haystack = `${title} ${description} ${tags.join(' ')}`
  if (/\bfnaf\b/i.test(haystack) || /five\s+nights\s+at\s+freddy/i.test(haystack)) {
    return 'FNAF'
  }
  return ''
}

/** 在不超过上限的前提下，尽量断在句子 / 段落边界 */
function truncateText(text, limit, preferParagraph = false) {
  if (text.length <= limit) return text

  const slice = text.slice(0, limit - 1)
  const tailWindow = preferParagraph ? 320 : Math.min(120, Math.floor(limit * 0.25))
  const lowerBound = Math.max(0, slice.length - tailWindow)

  const boundaries = preferParagraph
    ? ['\n\n', '\n', '。', '！', '？', '；', '. ', '! ', '? ', '; ', '，', ', ']
    : ['。', '！', '？', '；', '. ', '! ', '? ', '; ', '，', ', ', ' ']

  let cut = -1
  for (const boundary of boundaries) {
    const index = slice.lastIndexOf(boundary)
    if (index >= lowerBound && index > cut) cut = index + (boundary === '\n\n' || boundary === '\n' ? 0 : boundary.length)
  }

  const body = cut > 0 ? slice.slice(0, cut).trimEnd() : slice.trimEnd()
  return `${body}…`
}

function deriveShortDescription(description) {
  const lines = description
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const cleanLine = (line) =>
    line
      .replace(/^(?:[-*>•]+\s*)+/, '')
      .replace(/#[\p{L}\p{N}_-]+/gu, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  const candidates = lines.map(cleanLine).filter(Boolean)
  const meaningful = candidates.find((line) => line.length >= 12) || candidates[0] || ''
  if (!meaningful) return ''
  return truncateText(meaningful, SHORT_DESCRIPTION_LIMIT)
}

function normalizeUrl(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  try {
    return new URL(raw).toString()
  } catch {
    return raw
  }
}

/**
 * 把 GameJolt 的媒体服务地址换成更大的尺寸。
 *
 * 实测 GameJolt 会在原图尺寸处封顶（请求 1600 的小图仍返回 825），
 * 所以这里不需要先探测尺寸，直接请求目标尺寸即可；失败时前端会退回原图。
 */
export function upgradeMediaUrl(url, size) {
  const raw = normalizeUrl(url)
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    parsed.pathname = parsed.pathname.replace(
      /\/(game-thumbnail|game-header|game-screenshot)\/\d+\//,
      `/$1/${size}/`,
    )
    return parsed.toString()
  } catch {
    return raw
  }
}

function chooseMedia(media, kind) {
  if (!media || typeof media !== 'object') return null

  const original = normalizeUrl(media.img_url)
  const server = normalizeUrl(media.mediaserver_url)
  const size = kind === 'thumbnail' ? 1000 : 1600

  // 动图（GIF/WebP 动画）走原图：转成静态 WebP 会直接丢掉动画
  let url = ''
  if (media.is_animated && original) url = original
  else if (server) url = upgradeMediaUrl(server, size)
  else if (original) url = original

  if (!url) return null
  return {
    url,
    width: Number(media.width) || 0,
    animated: Boolean(media.is_animated),
  }
}

function pickImage(candidates, minWidth, label, warnings) {
  const usable = candidates.filter((candidate) => candidate && candidate.url)
  if (usable.length === 0) return ''

  // 优先选宽度达标的；都达不到就退回第一张，并在警告里说清会被前台拦下。
  const chosen = usable.find((candidate) => !candidate.width || candidate.width >= minWidth) || usable[0]

  if (chosen.label !== label) {
    warnings.push(`GameJolt 没有可用的${label}，已用${chosen.label}代替。`)
  }
  if (chosen.width && chosen.width < minWidth) {
    warnings.push(
      `${label}宽度只有 ${chosen.width}px，低于本站要求的 ${minWidth}px，上传时会被跳过，请手动换图。`,
    )
  }
  if (chosen.animated) {
    warnings.push(`${label}是动图，已使用原图以保留动画（文件可能较大）。`)
  }

  return chosen.url
}

function collectImages(game, overview, warnings) {
  const mediaItems = Array.isArray(overview.mediaItems) ? overview.mediaItems : []

  const thumbnail = chooseMedia(game.thumbnail_media_item, 'thumbnail')
  const header = chooseMedia(game.header_media_item, 'header')

  const screenshots = []
  let animatedScreenshots = 0

  for (const item of mediaItems) {
    if (!item || item.media_type !== 'image' || !item.media_item) continue
    const media = chooseMedia(item.media_item, 'screenshot')
    if (!media) continue
    if (media.animated) animatedScreenshots += 1
    if (media.width && media.width < GALLERY_MIN_WIDTH) continue
    screenshots.push(media)
  }

  if (screenshots.length > MAX_GALLERY) {
    warnings.push(`GameJolt 有 ${screenshots.length} 张截图，图库上限为 ${MAX_GALLERY} 张，已取前 ${MAX_GALLERY} 张。`)
  }
  if (animatedScreenshots > 0) {
    warnings.push('图库里有动图，已使用原图以保留动画（文件可能较大）。')
  }

  const firstScreenshot = screenshots[0]

  const coverImage = pickImage(
    [
      thumbnail ? { ...thumbnail, label: '封面' } : null,
      header ? { ...header, label: 'Banner' } : null,
      firstScreenshot ? { ...firstScreenshot, label: '截图' } : null,
    ],
    COVER_MIN_WIDTH,
    '封面',
    warnings,
  )

  const bannerImage = pickImage(
    [
      header ? { ...header, label: 'Banner' } : null,
      thumbnail ? { ...thumbnail, label: '封面' } : null,
      firstScreenshot ? { ...firstScreenshot, label: '截图' } : null,
    ],
    COVER_MIN_WIDTH,
    'Banner',
    warnings,
  )

  const gallery = screenshots.slice(0, MAX_GALLERY).map((item) => item.url)

  if (!coverImage && !bannerImage && gallery.length === 0) {
    warnings.push('GameJolt 没有提供任何图片，封面 / Banner / 图库需要手动上传。')
  }

  return { coverImage, bannerImage, gallery }
}

function pickVideo(overview) {
  const mediaItems = Array.isArray(overview.mediaItems) ? overview.mediaItems : []
  const video = mediaItems.find(
    (item) => item && item.media_type === 'video' && item.type === 'youtube' && item.url,
  )
  if (!video) return ''
  const id = String(video.url).trim()
  if (!id) return ''
  return /^https?:\/\//i.test(id) ? id : `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`
}

/* ==========================================================================
   四、总装
   ========================================================================== */

/**
 * 把 GameJolt 的两个接口响应转成本站后台的导入数据。
 *
 * @param {unknown} detail   /site-api/web/discover/games/<id> 的响应
 * @param {unknown} overview /site-api/web/discover/games/overview/<id>?ignore 的响应
 * @param {string|{id:number,sourceUrl:string}} input 原始输入或 parseGameJoltInput 的结果
 * @param {string[]} extraWarnings 例如「概览接口请求失败」
 */
export function normalizeGameJoltData(detail, overview, input, extraWarnings = []) {
  const parsed = typeof input === 'string' ? parseGameJoltInput(input) : input
  const game = detail?.payload?.game ?? detail?.game
  if (!game) {
    throw new Error('GameJolt 没有返回这个作品，可能已下架、链接有误，或接口改版了。')
  }

  const overviewPayload = overview?.payload ?? overview ?? {}
  const warnings = [...extraWarnings]

  const title = oneLineText(game.title)
  if (!title) throw new Error('GameJolt 返回的作品没有标题，无法导入。')

  const author = oneLineText(game.developer?.display_name || game.developer?.name || game.developer?.username)
  if (!author) warnings.push('GameJolt 没有提供作者，请手动填写。')

  const releaseYear = pickReleaseYear(game, warnings)
  const engine = pickEngine(game, warnings)

  const rawDescription = richTextToPlainText(game.description_content)
  const fallbackDescription = oneLineText(overviewPayload.metaDescription)
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .trim()
  let description = rawDescription || fallbackDescription
  const descriptionOriginalLength = description.length

  if (!description) warnings.push('GameJolt 没有提供简介，请手动填写。')
  if (description.length > DESCRIPTION_LIMIT) {
    description = truncateText(description, DESCRIPTION_LIMIT, true)
    warnings.push(
      `简介原文 ${descriptionOriginalLength} 字，超过 ${DESCRIPTION_LIMIT} 字上限，已截断；完整内容请打开 GameJolt 原页查看。`,
    )
  }

  const shortDescription = deriveShortDescription(description)
  const tags = normalizeTags(extractRichTextTags(game.description_content), game.category)
  const ipSeries = inferIpSeries(title, description, tags)
  if (!ipSeries) warnings.push('未能从标题 / 简介识别 IP 系列，请在表单里手动填写。')

  const { coverImage, bannerImage, gallery } = collectImages(game, overviewPayload, warnings)
  const videoUrl = pickVideo(overviewPayload)

  const numericId = Number(game.id) || parsed.id
  const sourceUrl = game.slug
    ? `https://gamejolt.com/games/${game.slug}/${numericId}`
    : parsed.sourceUrl || `https://gamejolt.com/games/_/${numericId}`

  return {
    sourceUrl,
    gameJoltId: numericId,
    title,
    author,
    releaseYear,
    engine,
    ipSeries,
    description,
    shortDescription,
    coverImage,
    bannerImage,
    gallery,
    videoUrl,
    tags,
    warnings: [...new Set(warnings)],
  }
}
