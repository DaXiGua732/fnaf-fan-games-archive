/**
 * ============================================================================
 * GameJolt 导入 —— 后台侧服务
 * ============================================================================
 * 数据流：
 *
 *   后台页面 → 本机助手（127.0.0.1:4317）→ GameJolt 站内 JSON
 *            ← 已转换好的字段
 *
 *   图片：浏览器直接 fetch GameJolt CDN（它带 ACAO: *）
 *         → 走现有 uploadImage（缩放 / 转 WebP / 上传数据仓）
 *
 * 【为什么元数据要绕本机助手】
 *   GameJolt 的 /site-api 接口不返回可跨域读取的 CORS 头，浏览器直连会被拦。
 *   助手只代理 JSON，不碰图片、不碰令牌 —— 图片和上传仍然在浏览器里完成，
 *   这样现有的图片处理与 GitHub 提交链路一行都不用改。
 *
 * 【这里只负责「把数据变成草稿」】
 *   不自动保存。导入完成后用户仍然要点右上角的「保存」，
 *   这才符合后台「先看再存」的操作习惯，也避免一次误点直接改线上数据。
 * ============================================================================
 */
import {
  IMAGE_LIMITS,
  TAG_LIMITS,
  isValidTag,
  normalizeTag,
  type ImageSlot,
  type StorageKind,
} from '../types/admin'
import { checkImageSize, readImageSize } from '../utils/imageInspect'

/**
 * 本机助手地址。
 * 默认 4317；如果改了端口，构建时设置 VITE_GAMEJOLT_HELPER。
 * 构建期替换，不会在运行时读环境变量。
 */
export const GAMEJOLT_HELPER_BASE =
  (import.meta.env.VITE_GAMEJOLT_HELPER as string | undefined)?.replace(/\/+$/, '') ||
  'http://127.0.0.1:4317'

/** 助手返回的完整数据。字段名与 scripts/gamejolt/parse.mjs 的输出保持一致 */
export interface GameJoltImportData {
  sourceUrl: string
  gameJoltId: number
  title: string
  author: string
  releaseYear: number
  engine: string
  ipSeries: string
  description: string
  shortDescription: string
  coverImage: string
  bannerImage: string
  gallery: string[]
  videoUrl: string
  tags: string[]
  warnings: string[]
}

/** 导入会覆盖的草稿字段（不包含下载 / 发布设置） */
export interface GameJoltDraftPatch {
  title: string
  author: string
  releaseYear: string
  ipSeries: string
  engine: string
  videoUrl: string
  shortDescription: string
  description: string
  tags: string[]
}

/** 当前草稿里用于「GameJolt 没提供时保留原值」的字段 */
export interface GameJoltDraftContext {
  releaseYear: string
  ipSeries: string
  engine: string
  videoUrl: string
  shortDescription: string
  description: string
  tags: string[]
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * 把助手返回的数据再过一遍防御性归一。
 *
 * 助手是本机进程、数据来自第三方接口 —— 两层都可能漂移。
 * 这里不信任 `payload.data` 的运行时形状，缺字段就给安全缺省值；
 * 唯一硬性要求是标题，因为没有标题的条目在后台根本无法保存。
 */
function normalizeImportData(raw: unknown): GameJoltImportData {
  const data = (raw ?? {}) as Record<string, unknown>
  const title = asString(data.title)
  if (!title) throw new Error('GameJolt 返回的数据里没有标题，无法导入。')

  const releaseYear = Number(data.releaseYear)
  return {
    sourceUrl: asString(data.sourceUrl),
    gameJoltId: Number(data.gameJoltId) || 0,
    title,
    author: asString(data.author),
    releaseYear: Number.isFinite(releaseYear) ? releaseYear : new Date().getFullYear(),
    engine: asString(data.engine),
    ipSeries: asString(data.ipSeries),
    description: asString(data.description),
    shortDescription: asString(data.shortDescription),
    coverImage: asString(data.coverImage),
    bannerImage: asString(data.bannerImage),
    gallery: asStringArray(data.gallery),
    videoUrl: asString(data.videoUrl),
    tags: asStringArray(data.tags),
    warnings: asStringArray(data.warnings),
  }
}

/**
 * 从本机助手抓取一条作品。
 *
 * 失败信息要能直接告诉用户「下一步做什么」：
 * 助手没启动、GameJolt 拒绝、链接粘错，三种情况必须说人话，
 * 不能统一甩一个 `Failed to fetch`。
 */
export async function fetchGameJoltImport(input: string): Promise<GameJoltImportData> {
  const source = input.trim()
  if (!source) throw new Error('请先粘贴 GameJolt 作品页链接。')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 35_000)

  try {
    let response: Response
    try {
      response = await fetch(
        `${GAMEJOLT_HELPER_BASE}/api/gamejolt?url=${encodeURIComponent(source)}`,
        { cache: 'no-store', signal: controller.signal },
      )
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        throw new Error('抓取超时。请检查网络，或稍后重试。')
      }
      throw new Error(
        '连不上本机 GameJolt 助手。请先在项目目录运行 `npm run gamejolt:helper`，保持窗口开启后再试。',
      )
    }

    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; data?: unknown; error?: string }
      | null

    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || `本机助手返回 HTTP ${response.status}。`)
    }

    return normalizeImportData(payload.data)
  } finally {
    clearTimeout(timer)
  }
}

/* ==========================================================================
   草稿字段映射
   ========================================================================== */

function importedTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const raw of tags) {
    const tag = normalizeTag(raw)
    if (!isValidTag(tag)) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(tag)
    if (result.length >= TAG_LIMITS.maxPerGame) break
  }

  return result
}

function truncateShortDescription(value: string): string {
  if (value.length <= 120) return value
  return `${value.slice(0, 119).trimEnd()}…`
}

/**
 * 把导入数据变成「只覆盖该覆盖的字段」的草稿片段。
 *
 * 两条刻意的保留策略：
 *   - GameJolt 没提供的字段（引擎 / IP 系列 / 视频 / 简介 / 标签）**不清空原值**；
 *   - 下载渠道、发布状态、推荐位、排序权重**一律不碰** ——
 *     它们不属于 GameJolt 能回答的问题，尤其是下载渠道必须人工补。
 */
export function buildGameJoltDraftPatch(
  data: GameJoltImportData,
  current: GameJoltDraftContext,
): { patch: GameJoltDraftPatch; warnings: string[] } {
  const warnings: string[] = []
  const now = new Date().getFullYear()
  const year = data.releaseYear
  const yearOk = Number.isInteger(year) && year >= 1990 && year <= now + 2

  if (!yearOk) {
    warnings.push(`GameJolt 的发行年份不在可填范围（1990–${now + 2}），已保留原年份。`)
  }

  const tags = importedTags(data.tags)
  if (data.tags.length > 0 && tags.length === 0) {
    warnings.push('GameJolt 标签都不符合本站格式，已保留原有标签。')
  }

  const description = data.description.trim() || current.description
  const shortDescription = truncateShortDescription(data.shortDescription) || current.shortDescription
  const ipSeries = data.ipSeries || current.ipSeries
  const engine = data.engine || current.engine
  const videoUrl = /^https?:\/\//i.test(data.videoUrl) ? data.videoUrl : current.videoUrl

  if (!data.author) warnings.push('GameJolt 没有提供作者，请手动填写。')
  if (!ipSeries) warnings.push('未能识别 IP 系列，请手动填写。')
  if (!engine) warnings.push('未能识别开发引擎，请手动填写。')
  if (!description) warnings.push('GameJolt 没有提供简介，请手动填写。')

  return {
    patch: {
      title: data.title,
      author: data.author,
      releaseYear: yearOk ? String(year) : current.releaseYear,
      ipSeries,
      engine,
      videoUrl,
      shortDescription,
      description,
      tags: tags.length > 0 ? tags : [...current.tags],
    },
    warnings: [...new Set(warnings)],
  }
}

/* ==========================================================================
   图片下载 + 上传
   ========================================================================== */

export interface GameJoltImportProgress {
  /** 已完成的任务数（0 = 还没开始） */
  done: number
  total: number
  label: string
}

export interface GameJoltImageUploader {
  (
    file: File,
    options: { gameId: string; slot: ImageSlot },
  ): Promise<{ url: string; note?: string }>
}

export interface GameJoltImageImportOptions {
  /** 图片在数据仓里的目录名 */
  gameId: string
  storage: StorageKind
  /** 图库还能再加几张；编辑已有作品时由调用方算好 */
  galleryRoom: number
  uploadImage: GameJoltImageUploader
  onProgress?: (progress: GameJoltImportProgress) => void
}

export interface GameJoltImageImportResult {
  coverImage: string
  bannerImage: string
  gallery: string[]
  /** 成功填入的图片位数（含复用同一张已上传图的情况） */
  uploaded: number
  failed: number
  /** 压缩 / 转码说明，给用户看 */
  notes: string[]
  warnings: string[]
}

interface ImageTask {
  slot: ImageSlot
  url: string
  label: string
}

function fileNameFromUrl(url: string): string {
  try {
    const base = new URL(url).pathname.split('/').filter(Boolean).pop() || 'gamejolt-image'
    const safe = decodeURIComponent(base).replace(/[^\w.\-]+/g, '-').slice(-80)
    return safe || 'gamejolt-image'
  } catch {
    return 'gamejolt-image'
  }
}

/**
 * 从 GameJolt CDN 下载一张图。
 * 先看 Content-Length / blob.size，别把一张 20 MB 的原图读进 canvas 再发现超限。
 */
async function fetchImageFile(url: string): Promise<File> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  const maxMb = Math.round(IMAGE_LIMITS.maxFileBytes / 1024 / 1024)

  try {
    let response: Response
    try {
      response = await fetch(url, {
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      })
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        throw new Error('图片下载超时。')
      }
      throw new Error('图片下载被浏览器拦下（可能是网络或跨域问题）。')
    }

    if (!response.ok) throw new Error(`图片下载失败（HTTP ${response.status}）。`)

    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (!contentType.startsWith('image/')) {
      throw new Error('GameJolt 返回的不是图片。')
    }

    const declared = Number(response.headers.get('content-length') || 0)
    if (declared > IMAGE_LIMITS.maxFileBytes) {
      throw new Error(`图片超过 ${maxMb} MB。`)
    }

    const blob = await response.blob()
    if (blob.size > IMAGE_LIMITS.maxFileBytes) {
      throw new Error(`图片超过 ${maxMb} MB。`)
    }

    return new File([blob], fileNameFromUrl(url), {
      type: contentType || blob.type || 'image/webp',
    })
  } finally {
    clearTimeout(timer)
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : '未知错误'
}

/**
 * 下载并上传封面 / Banner / 图库。
 *
 * 逐张处理而不是并发：GitHub Contents API 一次提交一个文件，
 * 并发上传只会让错误更难定位；而且用户需要看到「正在传第几张」。
 *
 * 单张失败**不会**中断整批 —— 一张截图 404 不该让封面也白传。
 */
export async function importGameJoltImages(
  data: GameJoltImportData,
  options: GameJoltImageImportOptions,
): Promise<GameJoltImageImportResult> {
  const result: GameJoltImageImportResult = {
    coverImage: '',
    bannerImage: '',
    gallery: [],
    uploaded: 0,
    failed: 0,
    notes: [],
    warnings: [],
  }

  if (options.storage !== 'remote') {
    result.warnings.push('未登录 / 本机模式：图片没有上传。请登录后再导入图片。')
    return result
  }

  const tasks: ImageTask[] = []
  if (data.coverImage) tasks.push({ slot: 'cover', url: data.coverImage, label: '封面' })
  if (data.bannerImage) tasks.push({ slot: 'banner', url: data.bannerImage, label: 'Banner' })

  const gallery = data.gallery.slice(0, Math.max(0, options.galleryRoom))
  if (data.gallery.length > gallery.length) {
    result.warnings.push(
      `图库剩余位置只有 ${gallery.length} 个，GameJolt 的 ${data.gallery.length} 张截图没有全部导入。`,
    )
  }
  gallery.forEach((url, index) => tasks.push({ slot: 'gallery', url, label: `截图 ${index + 1}` }))

  const uploadedByUrl = new Map<string, string>()
  const total = tasks.length

  for (const [index, task] of tasks.entries()) {
    options.onProgress?.({ done: index, total, label: task.label })

    const reused = uploadedByUrl.get(task.url)
    if (reused) {
      assign(task.slot, reused)
      result.uploaded += 1
      options.onProgress?.({ done: index + 1, total, label: task.label })
      continue
    }

    try {
      const file = await fetchImageFile(task.url)

      // 与手动选图走同一套尺寸规则：太小 / 太大的图在这里就拦下，
      // 不把不合格的图传到数据仓再让前台裂图。
      const box = await readImageSize(file)
      const sizeProblem = checkImageSize(box, task.slot)
      if (sizeProblem) throw new Error(sizeProblem)

      const uploaded = await options.uploadImage(file, {
        gameId: options.gameId,
        slot: task.slot,
      })

      uploadedByUrl.set(task.url, uploaded.url)
      assign(task.slot, uploaded.url)
      result.uploaded += 1
      if (uploaded.note) result.notes.push(`${task.label}：${uploaded.note}`)
    } catch (cause) {
      result.failed += 1
      result.warnings.push(`${task.label}：${errorMessage(cause)}`)
    }

    options.onProgress?.({ done: index + 1, total, label: task.label })
  }

  return result

  function assign(slot: ImageSlot, url: string): void {
    if (slot === 'cover') result.coverImage = url
    else if (slot === 'banner') result.bannerImage = url
    else result.gallery.push(url)
  }
}
