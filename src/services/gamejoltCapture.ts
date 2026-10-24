/**
 * ============================================================================
 * GameJolt 抓取包（ZIP）读取
 * ============================================================================
 * 浏览器扩展在 GameJolt 作品页导出：
 *
 *   manifest.json   格式版本 / 来源 / 图片 URL → 文件映射
 *   capture.json    已经归一化好的 GameJoltImportData
 *   images/...      封面 / Banner / 截图
 *
 * 后台不解压到磁盘，也不执行包内任何内容；只读取白名单条目，把图片变成
 * File 后交给现有的上传链路（尺寸校验 / WebP 转换 / 提交数据仓）。
 *
 * 【为什么把 ZIP 当不可信输入】
 *   它来自浏览器下载目录，用户可以替换成任意文件。这里只信任：
 *   - 固定的格式标识与版本号；
 *   - GameJolt 来源域名；
 *   - 通过 createImageBitmap 能解码的图片（由上传前的尺寸检查兜底）。
 *   其余字段一律经过 normalizeGameJoltImportData 重新收口。
 * ============================================================================
 */
import { strFromU8, unzipSync } from 'fflate'
import { IMAGE_LIMITS } from '../types/admin'
import {
  normalizeGameJoltImportData,
  type GameJoltImportData,
} from './gamejoltImport'

export const CAPTURE_FORMAT = 'fnaf-archive-gamejolt-capture'
export const CAPTURE_VERSION = 1

/** 压缩包本身的上限。图片不会压缩，64 MB 已经能装下十几张 1600px 截图 */
const MAX_ZIP_BYTES = 64 * 1024 * 1024
/** 解压后的总上限，防 zip bomb */
const MAX_TOTAL_UNCOMPRESSED = 128 * 1024 * 1024
/** 单个条目上限。超过后台 4 MB 的图仍可进包，但上传时会被明确拦下 */
const MAX_ENTRY_BYTES = 32 * 1024 * 1024
const MAX_ENTRIES = 40

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
])

const TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
}

export interface GameJoltCaptureImageEntry {
  url: string
  file: string
  role?: string
  contentType?: string
}

export interface GameJoltCaptureManifest {
  format?: string
  version?: number
  sourceUrl?: string
  gameJoltId?: number
  title?: string
  fetchedAt?: string
  generator?: string
  images?: GameJoltCaptureImageEntry[]
}

export interface GameJoltCaptureBundle {
  data: GameJoltImportData
  manifest: GameJoltCaptureManifest
  /** key = capture.json 里的原始图片 URL */
  images: Map<string, File>
  warnings: string[]
}

function isGameJoltSource(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'gamejolt.com' || url.hostname === 'www.gamejolt.com')
    )
  } catch {
    return false
  }
}

function imageType(entry: GameJoltCaptureImageEntry, path: string): string {
  const declared = String(entry.contentType ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (ALLOWED_IMAGE_TYPES.has(declared)) return declared

  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  return TYPE_BY_EXTENSION[extension] ?? 'image/jpeg'
}

function parseJsonEntry(
  files: Record<string, Uint8Array>,
  name: string,
  label: string,
): unknown {
  const bytes = files[name]
  if (!bytes) throw new Error(`ZIP 里没有 ${label}（${name}）。`)
  try {
    return JSON.parse(strFromU8(bytes))
  } catch {
    throw new Error(`${label} 不是合法 JSON，ZIP 可能损坏了。`)
  }
}

/**
 * 读取扩展导出的 ZIP。
 *
 * 失败信息要能直接告诉用户下一步做什么：
 * 不是 ZIP、缺文件、版本太新、来源不对，分别给不同的话。
 */
export async function readGameJoltCaptureZip(file: File): Promise<GameJoltCaptureBundle> {
  if (file.size === 0) throw new Error('这个 ZIP 是空文件。')
  if (file.size > MAX_ZIP_BYTES) {
    throw new Error(
      `ZIP 超过 ${Math.round(MAX_ZIP_BYTES / 1024 / 1024)} MB，请确认导出的是单个作品。`,
    )
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  let entryCount = 0
  let totalUncompressed = 0
  let files: Record<string, Uint8Array>

  try {
    files = unzipSync(bytes, {
      filter: (entry) => {
        entryCount += 1
        if (entryCount > MAX_ENTRIES) {
          throw new Error(`ZIP 里的文件太多（超过 ${MAX_ENTRIES} 个）。`)
        }

        const name = entry.name.replace(/\\/g, '/')
        const keep =
          name === 'manifest.json' ||
          name === 'capture.json' ||
          name === 'README.txt' ||
          /^images\/[A-Za-z0-9._-]+$/.test(name)

        if (!keep) return false
        if (entry.originalSize > MAX_ENTRY_BYTES) {
          throw new Error(`ZIP 里的 ${name} 超过 ${Math.round(MAX_ENTRY_BYTES / 1024 / 1024)} MB。`)
        }

        totalUncompressed += entry.originalSize
        if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED) {
          throw new Error('ZIP 解压后太大，已拒绝导入。')
        }
        return true
      },
    })
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('ZIP ')) throw cause
    throw new Error('这个文件不是有效的 ZIP，或使用了不受支持的压缩方式。')
  }

  const manifest = parseJsonEntry(files, 'manifest.json', '清单文件') as GameJoltCaptureManifest
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('清单文件结构不对。')
  }
  if (manifest.format !== CAPTURE_FORMAT) {
    throw new Error('这不是 FNAF 档案的 GameJolt 抓取包。')
  }
  if (manifest.version !== CAPTURE_VERSION) {
    throw new Error(
      `抓取包版本是 ${String(manifest.version)}，当前后台只支持 ${CAPTURE_VERSION}。请升级站点或重新导出。`,
    )
  }

  const data = normalizeGameJoltImportData(parseJsonEntry(files, 'capture.json', '抓取数据'))
  const sourceUrl = String(manifest.sourceUrl || data.sourceUrl || '')

  if (!isGameJoltSource(sourceUrl)) {
    throw new Error('抓取包里的来源地址不是 gamejolt.com，已拒绝导入。')
  }
  if (manifest.gameJoltId && data.gameJoltId && manifest.gameJoltId !== data.gameJoltId) {
    throw new Error('清单与抓取数据里的作品 ID 不一致。')
  }

  const warnings: string[] = []
  const images = new Map<string, File>()
  const manifestImages = Array.isArray(manifest.images) ? manifest.images : []
  const seenPaths = new Set<string>()

  for (const entry of manifestImages) {
    if (!entry || typeof entry !== 'object') continue
    const url = typeof entry.url === 'string' ? entry.url.trim() : ''
    const path = typeof entry.file === 'string' ? entry.file.replace(/\\/g, '/') : ''

    if (!url || !path) {
      warnings.push('清单里有一条图片记录缺少 URL 或文件名，已跳过。')
      continue
    }
    if (!/^images\/[A-Za-z0-9._-]+$/.test(path) || path.includes('..')) {
      warnings.push(`清单里的图片路径不安全，已跳过：${path}`)
      continue
    }
    if (seenPaths.has(path)) {
      warnings.push(`清单里重复引用了同一张图片，已跳过：${path}`)
      continue
    }
    seenPaths.add(path)

    const imageBytes = files[path]
    if (!imageBytes || imageBytes.byteLength === 0) {
      warnings.push(`ZIP 里缺少图片文件：${path}，导入时会跳过这张图。`)
      continue
    }
    if (imageBytes.byteLength > IMAGE_LIMITS.maxFileBytes) {
      warnings.push(
        `${path} 超过 ${Math.round(IMAGE_LIMITS.maxFileBytes / 1024 / 1024)} MB，导入时会被跳过。`,
      )
    }

    const name = path.split('/').pop() || 'gamejolt-image'
    // 复制到独立的 ArrayBuffer：File 的 BlobPart 不接受 SharedArrayBuffer 类型的视图
    const buffer = new ArrayBuffer(imageBytes.byteLength)
    new Uint8Array(buffer).set(imageBytes)
    images.set(url, new File([buffer], name, { type: imageType(entry, path) }))
  }

  const referenced = [data.coverImage, data.bannerImage, ...data.gallery].filter(Boolean)
  const missing = referenced.filter((url) => !images.has(url))
  if (missing.length > 0) {
    warnings.push(`ZIP 里缺少 ${missing.length} 张数据引用的图片，导入时会跳过。`)
  }
  if (referenced.length === 0) {
    warnings.push('抓取包里没有图片，封面 / Banner / 图库需要手动上传。')
  }

  return {
    data: { ...data, sourceUrl },
    manifest,
    images,
    warnings: [...new Set(warnings)],
  }
}
