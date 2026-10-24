/**
 * ============================================================================
 * GameJolt 抓取包 —— 纯函数
 * ============================================================================
 * 扩展只负责把「已经归一化好的 GameJolt 数据 + 图片」装进一个 ZIP。
 * 这里刻意不碰 DOM、不联网，方便用 Node 的 node:test 直接测。
 *
 * ZIP 结构（formatVersion = 1）：
 *
 *   manifest.json   机器可读：格式版本、来源、抓取时间、图片 URL → 文件映射
 *   capture.json    后台直接消费的 GameJoltImportData（与助手路径同一形状）
 *   images/...      封面 / Banner / 截图
 *   README.txt      给人看的说明，后台忽略
 *
 * 【为什么用 store（level: 0）】
 *   图片本身已经是 JPEG / WebP / PNG，再 deflate 一遍几乎不省空间，
 *   反而让打包变慢。ZIP 在这里是「一个文件装多份东西」的容器，不是压缩工具。
 * ============================================================================
 */
import { strToU8, zipSync } from 'fflate'

export const CAPTURE_FORMAT = 'fnaf-archive-gamejolt-capture'
export const CAPTURE_VERSION = 1
export const GENERATOR = 'fnaf-archive-extension/0.1.0'

const EXTENSION_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
}

const SAFE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'])

/**
 * 按「封面 → Banner → 图库」的顺序收集要打包的图片，并按 URL 去重。
 * 同一张图既当封面又当截图时只下载一次，后台导入也会复用同一份上传结果。
 *
 * @param {object} data GameJoltImportData
 * @returns {{ url: string, role: string }[]}
 */
export function collectCaptureImages(data) {
  const result = []
  const seen = new Set()

  function add(url, role) {
    if (typeof url !== 'string' || !url.trim() || seen.has(url)) return
    seen.add(url)
    result.push({ url, role })
  }

  add(data?.coverImage, 'cover')
  add(data?.bannerImage, 'banner')

  const gallery = Array.isArray(data?.gallery) ? data.gallery : []
  gallery.forEach((url, index) => add(url, `gallery-${index + 1}`))

  return result
}

/**
 * 给图片挑扩展名。Content-Type 优先，URL 后缀兜底，最后才用 jpg。
 * 只接受后台能处理的位图格式；SVG 一律不打包（后台也会拒绝）。
 */
export function extensionForImage(url, contentType) {
  const type = String(contentType ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase()

  if (EXTENSION_BY_TYPE[type]) return EXTENSION_BY_TYPE[type]

  try {
    const ext = new URL(url).pathname.split('.').pop()?.toLowerCase() ?? ''
    if (SAFE_EXTENSIONS.has(ext)) return ext === 'jpeg' ? 'jpg' : ext
  } catch {
    // URL 不合法时走默认扩展名
  }

  return 'jpg'
}

function captureReadme(manifest) {
  return [
    'FNAF 档案 · GameJolt 抓取包',
    '',
    `作品：${manifest.title || '未命名'}`,
    `来源：${manifest.sourceUrl || '未知'}`,
    `抓取时间：${manifest.fetchedAt}`,
    `生成工具：${manifest.generator}`,
    '',
    '导入方法：',
    '1. 打开站点后台的「新增游戏」或任意作品编辑页；',
    '2. 在「从 GameJolt 导入」里选择或拖入这个 ZIP；',
    '3. 检查预览，点「填入表单并上传图片」；',
    '4. 手动补下载渠道后，点右上角「保存」。',
    '',
    '游戏文件 / 下载链接不在自动导入范围内。',
    '',
  ].join('\n')
}

/**
 * 把数据和图片装成 ZIP。
 *
 * @param {object} data GameJoltImportData
 * @param {{ url: string, role: string, bytes: Uint8Array, contentType?: string }[]} images
 * @param {{ fetchedAt?: string, generator?: string }} [options]
 */
export function buildCaptureFiles(data, images, options = {}) {
  const fetchedAt = options.fetchedAt ?? new Date().toISOString()
  const generator = options.generator ?? GENERATOR

  const files = {}
  const manifestImages = []

  for (const image of images) {
    const extension = extensionForImage(image.url, image.contentType)
    const file = `images/${image.role}.${extension}`
    files[file] = image.bytes
    manifestImages.push({
      url: image.url,
      file,
      role: image.role,
      contentType: String(image.contentType ?? ''),
    })
  }

  const manifest = {
    format: CAPTURE_FORMAT,
    version: CAPTURE_VERSION,
    sourceUrl: String(data?.sourceUrl ?? ''),
    gameJoltId: Number(data?.gameJoltId) || 0,
    title: String(data?.title ?? ''),
    fetchedAt,
    generator,
    images: manifestImages,
  }

  const capture = JSON.parse(JSON.stringify(data ?? {}))
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
  files['capture.json'] = strToU8(JSON.stringify(capture, null, 2))
  files['README.txt'] = strToU8(captureReadme(manifest))

  return {
    manifest,
    capture,
    files,
    // level: 0 = store；图片已经压过，不需要再 deflate
    bytes: zipSync(files, { level: 0 }),
  }
}

/** 下载文件名：slug-id-UTC 时间.zip */
export function captureFileName(data, now = new Date()) {
  const source = String(data?.sourceUrl ?? '')
  const slugFromUrl = source.match(/\/games\/([^/]+)\//)?.[1] ?? ''
  const slug =
    slugFromUrl
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'gamejolt'

  const pad = (value) => String(value).padStart(2, '0')
  const stamp =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`

  return `${slug}-${Number(data?.gameJoltId) || 'unknown'}-${stamp}.zip`
}
