/**
 * 主题设置的**唯一**定义：storage key、合法取值、本机读取。
 *
 * 这一层不依赖 Vue、也不碰 document —— 首帧防闪白的启动脚本
 * （`src/themeBoot.ts`，构建时内联进 index.html）与 `useTheme` 共用它。
 * 之前两边各写一份读取逻辑，改 key 或回退规则必须记得改两处；
 * 现在构建时只有这一份实现，`selftest` 有守卫防止 key 再次散落。
 */
import { DEFAULT_CUSTOM_COLOR, parseHexColor } from '../utils/themeColor'
import { getLocalStorage } from '../utils/localStorage'

export type ThemeAccent =
  | 'miku'
  | 'rin'
  | 'len'
  | 'luka'
  | 'meiko'
  | 'kaito'
  | 'custom'
export type ThemeMode = 'light' | 'dark'
export type ModePreference = 'system' | 'light' | 'dark'

export interface ThemeAccentOption {
  readonly id: ThemeAccent
  readonly label: string
  /** 仅用于选择器里的色块；界面颜色本身由 CSS 变量提供 */
  readonly swatch: string
}

export const THEME_MODE_STORAGE_KEY = 'fnaf-archive:theme-mode:v1'
export const THEME_ACCENT_STORAGE_KEY = 'fnaf-archive:theme-accent:v1'
export const THEME_CUSTOM_STORAGE_KEY = 'fnaf-archive:theme-custom:v1'

export const THEME_ACCENTS: readonly ThemeAccentOption[] = [
  { id: 'miku', label: '初音蓝', swatch: '#39c5bb' },
  { id: 'rin', label: '镜音橙', swatch: '#f2a900' },
  { id: 'len', label: '镜音黄', swatch: '#ffe211' },
  { id: 'luka', label: '巡音粉', swatch: '#ff9ec4' },
  { id: 'meiko', label: 'MEIKO红', swatch: '#c8102e' },
  { id: 'kaito', label: 'KAITO蓝', swatch: '#3366cc' },
]

export const DEFAULT_ACCENT: ThemeAccent = 'miku'
export const DEFAULT_PREFERENCE: ModePreference = 'system'

/** 浏览器地址栏 / UA 主题色：与 CSS 中两种模式的 paper 一致 */
export const PAPER_THEME_COLORS: Record<ThemeMode, string> = {
  light: '#fafaf8',
  dark: '#141413',
}

export function isThemeAccent(value: unknown): value is ThemeAccent {
  return (
    value === 'custom' ||
    (typeof value === 'string' && THEME_ACCENTS.some((option) => option.id === value))
  )
}

export function isModePreference(value: unknown): value is ModePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function resolveMode(
  preference: ModePreference,
  systemPrefersDarkValue: boolean,
): ThemeMode {
  if (preference === 'system') return systemPrefersDarkValue ? 'dark' : 'light'
  return preference
}

export interface ThemePreferences {
  preference: ModePreference
  accent: ThemeAccent
  /** 自定义色始终读出来（切回预设色时不丢，下次选「自定义」还在） */
  custom: string
}

function readStored(storage: Storage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

/**
 * 读取本机主题偏好并做防御性归一。
 * 非法值（旧版本 accent、损坏的 JSON 等）回退到默认；不抛错、不改写 storage。
 */
export function readThemePreferences(
  storage: Storage | null = getLocalStorage(),
): ThemePreferences {
  const storedMode = readStored(storage, THEME_MODE_STORAGE_KEY)
  const storedAccent = readStored(storage, THEME_ACCENT_STORAGE_KEY)
  const storedCustom = readStored(storage, THEME_CUSTOM_STORAGE_KEY)

  return {
    preference: isModePreference(storedMode) ? storedMode : DEFAULT_PREFERENCE,
    accent: isThemeAccent(storedAccent) ? storedAccent : DEFAULT_ACCENT,
    custom: parseHexColor(storedCustom) ?? DEFAULT_CUSTOM_COLOR,
  }
}

export function readSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}
