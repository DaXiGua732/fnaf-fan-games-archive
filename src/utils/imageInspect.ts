/**
 * ============================================================================
 * 图片尺寸检查
 * ============================================================================
 * 分成两层，**这是刻意的**：
 *
 *   readImageSize()   浏览器侧：把文件读成位图，拿到像素尺寸（需要 DOM API）
 *   checkImageSize()  纯函数：只看尺寸就能判断能不能收
 *
 * 校验逻辑做成纯函数，断言才能直接测它 —— 不必在 Node 里伪造一个位图。
 *
 * 【为什么比例只警告、不拦截】
 * 前台用 `object-contain` 渲染，比例不对只会**留白**，不会坏。
 * 把它做成硬性拦截，会让人为了一张稍微扁一点的封面反复裁图 ——
 * 那是拿确定性成本换一点点观感。所以：**太小/太大拦，比例不对只提示**。
 * ============================================================================
 */
import { IMAGE_LIMITS, type ImageSlot } from '../types/admin'

export interface ImageSize {
  width: number
  height: number
}

/** 各图片位的建议比例（宽 / 高） */
const EXPECTED_RATIO: Record<ImageSlot, number> = {
  cover: 16 / 9,
  banner: 21 / 9,
  gallery: 16 / 9,
}

/**
 * 读出图片的像素尺寸。**浏览器专用**。
 *
 * 用 `createImageBitmap` 而不是 `<img>` + objectURL：它不用把图片插进 DOM，
 * 也不会因此触发布局。用完必须 `close()`，否则解码后的位图会占着内存。
 */
export async function readImageSize(file: Blob): Promise<ImageSize> {
  const bitmap = await createImageBitmap(file)
  try {
    return { width: bitmap.width, height: bitmap.height }
  } finally {
    bitmap.close()
  }
}

/**
 * 尺寸是否可接受。返回 `null` 表示通过；返回字符串表示拒绝的原因。
 *
 * 只拦两种情况：
 *   - **太小**：放到卡片上会糊（前台卡片本身就有 300+ px 宽）
 *   - **太大**：一张图几千万像素，仓库和带宽都吃不消
 */
export function checkImageSize(size: ImageSize, slot: ImageSlot): string | null {
  // 图库是缩略图墙里的一格，标准比封面低
  const minWidth = slot === 'gallery' ? IMAGE_LIMITS.minGalleryWidth : IMAGE_LIMITS.minWidth
  const minHeight = Math.round(minWidth / EXPECTED_RATIO[slot])

  if (size.width < minWidth || size.height < minHeight) {
    return `图片太小了（${size.width}×${size.height}）—— 这个位置建议至少 ${minWidth}×${minHeight}，否则显示出来会糊。`
  }

  if (size.width > IMAGE_LIMITS.maxPixels || size.height > IMAGE_LIMITS.maxPixels) {
    return `图片太大了（${size.width}×${size.height}）—— 单边不能超过 ${IMAGE_LIMITS.maxPixels} 像素，请先压缩。`
  }

  return null
}

/**
 * 比例偏离的**提示**（不拦截）。
 * 偏离超过 25% 才提 —— 否则每张图都要弹一句话，人就不看了。
 */
export function aspectWarning(size: ImageSize, slot: ImageSlot): string {
  if (size.height === 0) return ''

  const expected = EXPECTED_RATIO[slot]
  const actual = size.width / size.height
  const drift = Math.abs(actual - expected) / expected

  if (drift <= IMAGE_LIMITS.ratioDriftTolerance) return ''

  const [rw, rh] = slot === 'banner' ? [21, 9] : [16, 9]
  return `当前比例是 ${actual.toFixed(2)}:1，这个位置是 ${rw}:${rh} 的框 —— 可以上传，但两侧会留白。`
}
