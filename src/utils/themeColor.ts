/**
 * 自定义主题色的派生规则。
 *
 * 用户只提供一个代表色，界面需要四个变量（见 docs/DESIGN.md 的语义 token）：
 *  - surface   原样使用（Hero / 悬停底色），选择器色块也用它
 *  - onAccent  在黑 / 白之间选对比度更高的那个，保证大面积色块可读
 *  - accent    同色相向黑（浅色模式）或向白（深色模式）移动，直到与 paper 达到 4.6:1
 *  - bright    向白移动，直到在反色底（页脚 / 灯箱）上达到 4.5:1
 *
 * 输出是 `"r g b"` 形式的 CSS 变量值，直接 setProperty 到根元素。
 *
 * ⚠️ `index.html` 的防闪白内联脚本有一份等价的纯 JS 实现（首屏要在 Vue 之前应用）。
 *    改这里的算法必须同步改那里；反之亦然。
 */
export type ThemeColorMode = 'light' | 'dark'

export interface ThemeColorVars {
  accent: string
  surface: string
  bright: string
  onAccent: string
}

interface Rgb {
  r: number
  g: number
  b: number
}

/** 与 src/styles/index.css 的基础表面保持一致 */
const PAPER: Rgb = { r: 250, g: 250, b: 248 }
const DARK_PAPER: Rgb = { r: 20, g: 20, b: 19 }
const INK: Rgb = { r: 26, g: 26, b: 24 }
/** 页脚 / 灯箱的反色底：取两种模式里更暗的那个，保证 bright 两边都可读 */
const INVERSE: Rgb = { r: 8, g: 8, b: 8 }

/** 自定义色未设置时的初值（与六种歌姬色都不重复，便于看出「这是自定义」） */
export const DEFAULT_CUSTOM_COLOR = '#7a5cff'

/** 接受 `#rgb` / `#rrggbb`（`#` 可省略，大小写不限），返回规范化的 `#rrggbb` */
export function parseHexColor(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const raw = input.trim().replace(/^#/, '')
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(raw)) return null
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((char) => char + char)
          .join('')
      : raw
  return `#${full.toLowerCase()}`
}

function toRgb(hex: string): Rgb {
  const value = hex.replace('#', '')
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  }
}

function toChannels(rgb: Rgb): string {
  return `${rgb.r} ${rgb.g} ${rgb.b}`
}

/** sRGB 通道的相对亮度（WCAG 2.x） */
function channelLuminance(channel: number): number {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function luminance(rgb: Rgb): number {
  return (
    0.2126 * channelLuminance(rgb.r) +
    0.7152 * channelLuminance(rgb.g) +
    0.0722 * channelLuminance(rgb.b)
  )
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a)
  const lb = luminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

function mix(base: Rgb, target: Rgb, amount: number): Rgb {
  return {
    r: Math.round(base.r + (target.r - base.r) * amount),
    g: Math.round(base.g + (target.g - base.g) * amount),
    b: Math.round(base.b + (target.b - base.b) * amount),
  }
}

/**
 * 把 base 向 target 移动到「与 background 的对比度 >= min」的最小幅度。
 * 已经是目标对比度时原样返回（暗色 / 深色用户输入不该被无谓地改掉）。
 */
function ensureContrast(base: Rgb, target: Rgb, background: Rgb, min: number): Rgb {
  if (contrastRatio(base, background) >= min) return base
  let low = 0
  let high = 1
  let best = mix(base, target, 1)
  for (let i = 0; i < 16; i += 1) {
    const mid = (low + high) / 2
    const candidate = mix(base, target, mid)
    if (contrastRatio(candidate, background) >= min) {
      high = mid
      best = candidate
    } else {
      low = mid
    }
  }
  return best
}

/**
 * 由一个代表色推导出四个 CSS 变量。
 * `hex` 必须是 `parseHexColor()` 的返回值（非法输入请先回退到默认色）。
 */
export function deriveThemeVars(hex: string, mode: ThemeColorMode): ThemeColorVars {
  const surface = toRgb(hex)
  const paper = mode === 'light' ? PAPER : DARK_PAPER
  const accent = ensureContrast(surface, mode === 'light' ? INK : PAPER, paper, 4.6)
  const bright = ensureContrast(surface, PAPER, INVERSE, 4.5)
  const onAccent =
    contrastRatio(surface, INK) >= contrastRatio(surface, PAPER) ? INK : PAPER

  return {
    accent: toChannels(accent),
    surface: toChannels(surface),
    bright: toChannels(bright),
    onAccent: toChannels(onAccent),
  }
}
