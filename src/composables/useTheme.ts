import { computed, ref, type ComputedRef } from 'vue'

/**
 * 站点主题系统
 *
 * 三种「模式偏好」：跟随系统 / 日间 / 夜间；
 * 五种低饱和强调色：赤红 / 靛蓝 / 青绿 / 藕粉 / 紫灰。
 *
 * 设计约束：
 *  - 模块级单例 —— 公开站与后台共享同一份状态。
 *  - 所有 document / window / localStorage 访问都带 SSR / Node 守卫，
 *    因为冒烟测试会在 Node 里真实渲染组件（没有 DOM）。
 *  - 首屏防闪白由 index.html 里的内联脚本负责；本模块只负责应用内切换、
 *    跨标签页同步与系统主题变化。两处使用同一组 storage key。
 */

export type ThemeAccent = 'red' | 'blue' | 'teal' | 'pink' | 'purple'
export type ThemeMode = 'light' | 'dark'
export type ModePreference = 'system' | 'light' | 'dark'

export interface ThemeAccentOption {
  readonly id: ThemeAccent
  readonly label: string
  /** 仅用于选择器里的色块；界面颜色本身由 CSS 变量提供 */
  readonly swatch: string
}

/** ⚠️ 这两个字符串必须与 index.html 内联脚本中的完全一致 */
export const THEME_MODE_STORAGE_KEY = 'fnaf-archive:theme-mode:v1'
export const THEME_ACCENT_STORAGE_KEY = 'fnaf-archive:theme-accent:v1'

export const THEME_ACCENTS: readonly ThemeAccentOption[] = [
  { id: 'red', label: '赤红', swatch: '#a94a4a' },
  { id: 'blue', label: '靛蓝', swatch: '#4a6d8c' },
  { id: 'teal', label: '青绿', swatch: '#3f6f63' },
  { id: 'pink', label: '藕粉', swatch: '#9c5a72' },
  { id: 'purple', label: '紫灰', swatch: '#6f5a8c' },
]

const DEFAULT_ACCENT: ThemeAccent = 'red'
const DEFAULT_PREFERENCE: ModePreference = 'system'

/** 浏览器地址栏 / UA 主题色：与 CSS 中两种模式的 paper 一致 */
const PAPER_THEME_COLORS: Record<ThemeMode, string> = {
  light: '#fafaf8',
  dark: '#141413',
}

/* ---------------------------------------------------------------------------
   模块级单例状态
   --------------------------------------------------------------------------- */
const accent = ref<ThemeAccent>(DEFAULT_ACCENT)
const modePreference = ref<ModePreference>(DEFAULT_PREFERENCE)
const systemPrefersDark = ref(false)
const mode = computed<ThemeMode>(() =>
  resolveMode(modePreference.value, systemPrefersDark.value),
)

let initialized = false
let mediaQuery: MediaQueryList | null = null
let mediaListenerAttached = false
let storageListenerAttached = false

/* ---------------------------------------------------------------------------
   纯函数与带守卫的读写
   --------------------------------------------------------------------------- */
export function isThemeAccent(value: unknown): value is ThemeAccent {
  return (
    typeof value === 'string' && THEME_ACCENTS.some((option) => option.id === value)
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

function getStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined'
      ? null
      : globalThis.localStorage
  } catch {
    // 隐私模式 / 被浏览器策略阻止时，读取 localStorage 本身可能抛错
    return null
  }
}

function readStored(key: string): string | null {
  try {
    return getStorage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeStored(key: string, value: string): void {
  try {
    getStorage()?.setItem(key, value)
  } catch {
    // 存不下就算了：本次会话仍然应用所选主题，只是下次打开会回到默认
  }
}

export function readModePreference(): ModePreference {
  const stored = readStored(THEME_MODE_STORAGE_KEY)
  return isModePreference(stored) ? stored : DEFAULT_PREFERENCE
}

export function readAccent(): ThemeAccent {
  const stored = readStored(THEME_ACCENT_STORAGE_KEY)
  return isThemeAccent(stored) ? stored : DEFAULT_ACCENT
}

function readSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

/**
 * 把模式与强调色写到根元素和浏览器主题色上。
 * 只操作 documentElement / meta，不触碰任何布局样式。
 */
export function applyTheme(themeMode: ThemeMode, themeAccent: ThemeAccent): void {
  if (typeof document === 'undefined') return

  const root = document.documentElement
  root.dataset.mode = themeMode
  root.dataset.theme = themeAccent
  root.style.colorScheme = themeMode

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  meta?.setAttribute('content', PAPER_THEME_COLORS[themeMode])
}

/* ---------------------------------------------------------------------------
   系统主题监听 / 跨标签页同步
   --------------------------------------------------------------------------- */
function onSystemThemeChange(event: MediaQueryListEvent): void {
  systemPrefersDark.value = event.matches
  if (modePreference.value === 'system') {
    applyTheme(mode.value, accent.value)
  }
}

/** 只在「跟随系统」时保留媒体查询监听；切到日间 / 夜间后移除 */
function syncSystemMediaListener(): void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

  if (!mediaQuery) {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  }
  systemPrefersDark.value = mediaQuery.matches

  if (modePreference.value === 'system') {
    if (!mediaListenerAttached) {
      mediaQuery.addEventListener('change', onSystemThemeChange)
      mediaListenerAttached = true
    }
  } else if (mediaListenerAttached) {
    mediaQuery.removeEventListener('change', onSystemThemeChange)
    mediaListenerAttached = false
  }
}

function syncFromStorage(): void {
  const nextPreference = readModePreference()
  const nextAccent = readAccent()
  const changed =
    nextPreference !== modePreference.value || nextAccent !== accent.value

  modePreference.value = nextPreference
  accent.value = nextAccent
  syncSystemMediaListener()

  if (changed) applyTheme(mode.value, accent.value)
}

function onStorageChange(event: StorageEvent): void {
  if (
    event.key !== null &&
    event.key !== THEME_MODE_STORAGE_KEY &&
    event.key !== THEME_ACCENT_STORAGE_KEY
  ) {
    return
  }
  syncFromStorage()
}

/* ---------------------------------------------------------------------------
   初始化与对外接口
   --------------------------------------------------------------------------- */
/**
 * 幂等初始化：读取本机设置、应用主题、按需监听系统主题变化与跨标签页同步。
 * 必须在 createApp().mount() 之前调用，避免挂载后才切换造成闪烁。
 */
export function initTheme(): void {
  if (initialized) return
  initialized = true

  modePreference.value = readModePreference()
  accent.value = readAccent()
  systemPrefersDark.value = readSystemPrefersDark()

  applyTheme(mode.value, accent.value)
  syncSystemMediaListener()

  if (typeof window !== 'undefined' && !storageListenerAttached) {
    window.addEventListener('storage', onStorageChange)
    storageListenerAttached = true
  }
}

function setMode(next: ModePreference): void {
  if (!isModePreference(next)) return
  modePreference.value = next
  // 与内联脚本保持一致：即使选择「跟随系统」也写入字面量 'system'
  writeStored(THEME_MODE_STORAGE_KEY, next)

  if (next === 'system') {
    systemPrefersDark.value = readSystemPrefersDark()
  }
  syncSystemMediaListener()
  applyTheme(mode.value, accent.value)
}

function setAccent(next: ThemeAccent): void {
  if (!isThemeAccent(next)) return
  accent.value = next
  writeStored(THEME_ACCENT_STORAGE_KEY, next)
  applyTheme(mode.value, accent.value)
}

export interface ThemeAPI {
  mode: ComputedRef<ThemeMode>
  accent: typeof accent
  modePreference: typeof modePreference
  systemPrefersDark: typeof systemPrefersDark
  setMode: (next: ModePreference) => void
  setAccent: (next: ThemeAccent) => void
  accents: readonly ThemeAccentOption[]
}

/** 组件里取主题状态与操作。无副作用，SSR 下也可安全调用。 */
export function useTheme(): ThemeAPI {
  return {
    mode,
    accent,
    modePreference,
    systemPrefersDark,
    setMode,
    setAccent,
    accents: THEME_ACCENTS,
  }
}
