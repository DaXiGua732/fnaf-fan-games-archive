/**
 * ============================================================================
 * 上传前的图片处理（Phase 17 剩余项）
 * ============================================================================
 * 目标只有一个：**让传进数据仓的图更小**。数据仓是 GitHub 仓库，
 * 每张图都会永久留在 git 历史里；一张 1.6 MB 的 PNG 封面既拖慢前台，
 * 也让仓库无限膨胀。
 *
 * 做两件事：
 *   1. 长边超过对应位置的上限 → 等比缩到上限（不裁剪，比例保持原样）
 *   2. 非 GIF / SVG → 转成 WebP（quality 0.88）
 *
 * 三条刻意的不作为：
 *   - **GIF 不转**：可能是动图，转成单帧 WebP 会直接丢动画
 *   - **SVG 不转**：矢量图转成位图会丢清晰度（而且浏览器解不了 SVG 位图）
 *   - **转完反而更大就不转**：省字节是唯一目的，变大就失去意义
 *
 * 这里的函数只在浏览器里跑（createImageBitmap / canvas）—— 与 imageInspect 同层。
 * 它不负责「能不能上传」的判断，那是 checkImageSize 的职责；
 * 顺序是先校验（拒绝太小/太大），再处理（压缩），最后上传。
 * ============================================================================
 */
import type { ImageSlot } from '../types/admin'

/**
 * 各图片位的长边上限（像素）。
 * 比 IMAGE_LIMITS.maxPixels（8192，硬上限）小得多 —— 那个数字是「拒绝」的界线，
 * 这里是「超过就帮你缩」的界线。前台最宽的展示位置也不到 2400px。
 */
const MAX_EDGE: Record<ImageSlot, number> = {
  cover: 2000,
  banner: 2400,
  gallery: 1600,
}

/** WebP 质量。0.88 在肉眼几乎无损与体积之间比较平衡 */
const WEBP_QUALITY = 0.88

export interface PreparedImage {
  /** 真正要上传的字节 */
  blob: Blob
  /** 是否发生了缩放 / 转码 */
  converted: boolean
  originalBytes: number
  bytes: number
  /** 给人看的一句话（未处理时为空串） */
  note: string
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/**
 * 这些类型保持原样。
 * 导出成纯函数是为了让断言能直接测「哪些类型会被跳过」，
 * 不必在 Node 里伪造 canvas。
 */
export function shouldKeepOriginalType(type: string): boolean {
  return type === 'image/gif' || type === 'image/svg+xml'
}

/**
 * 把一张图处理成适合上传的字节。
 *
 * 失败时的策略是**原样返回**而不是抛错：压缩是优化，不是上传的前置条件。
 * 一张解不开的图应该在 readImageSize 那一步就被拦下；真走到这里失败，
 * 也没必要让用户因为「压缩器打不开」而传不了图。
 */
export async function prepareImageForUpload(
  file: File,
  slot: ImageSlot,
): Promise<PreparedImage> {
  const original: PreparedImage = {
    blob: file,
    converted: false,
    originalBytes: file.size,
    bytes: file.size,
    note: '',
  }

  if (shouldKeepOriginalType(file.type)) return original
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return original
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return original
  }

  try {
    const longest = Math.max(bitmap.width, bitmap.height)
    const limit = MAX_EDGE[slot]
    const scale = longest > limit ? limit / longest : 1
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (!context) return original

    // 透明背景必须保留 —— 封面/图库里有 PNG 透明图，铺白底会直接改图
    context.drawImage(bitmap, 0, 0, width, height)

    const encoded = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY)
    })
    if (!encoded) return original

    // 没缩放、转完还更大 → 这次转码只带来了体积，没有收益
    if (scale === 1 && encoded.size >= file.size) return original

    const steps: string[] = []
    if (scale < 1) steps.push(`长边缩到 ${limit}px`)
    steps.push('转 WebP')

    return {
      blob: encoded,
      converted: true,
      originalBytes: file.size,
      bytes: encoded.size,
      note: `${steps.join('、')}：${formatBytes(file.size)} → ${formatBytes(encoded.size)}`,
    }
  } finally {
    bitmap.close()
  }
}
