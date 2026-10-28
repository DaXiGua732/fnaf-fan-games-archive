import { computed, ref, type ComputedRef } from 'vue'
import { applyTheme } from '../theme/applyTheme'
import {
  DEFAULT_ACCENT,
  DEFAULT_PREFERENCE,
  THEME_ACCENT_STORAGE_KEY,
  THEME_ACCENTS,
  THEME_CUSTOM_STORAGE_KEY,
  THEME_MODE_STORAGE_KEY,
  isModePreference,
  isThemeAccent,
  readSystemPrefersDark,
  readThemePreferences,
  resolveMode,
  type ModePreference,
  type ThemeAccent,
  type ThemeAccentOption,
  type ThemeMode,
} from '../theme/themeSettings'
import { DEFAULT_CUSTOM_COLOR, parseHexColor } from '../utils/themeColor'
import { getLocalStorage } from '../utils/localStorage'

export type { ModePreference } from '../theme/themeSettings'

/**
 * 站点主题系统
 *
 * 三种「模式偏好」：跟随系统 / 日间 / 夜间；
 * 六种预设强调色取 V家歌姬的代表色（初音蓝 / 镜音橙 / 镜音黄 / 巡音粉 /
 * MEIKO红 / KAITO蓝），外加一种自定义色（自由取色或输入色值）。
 *
 * 设计约束：
 *  - 模块级单例 —— 公开站与后台共享同一份状态。
 *  - 所有 document / window / localStorage 访问都带 SSR / Node 守卫，
 *    因为冒烟测试会在 Node 里真实渲染组件（没有 DOM）。
 *  - 首屏防闪白由构建时内联的 `src/themeBoot.ts` 负责；它与本模块共用
 *    `src/theme/**` 的读取与派生实现，因此不存在第二份算法。
 *    本模块只负责应用内切换、跨标签页同步与系统主题变化。
 */

/* ---------------------------------------------------------------------------
   模块级单例状态
   --------------------------------------------------------------------------- */
const accent = ref<ThemeAccent>(DEFAULT_ACCENT)
const customColor = ref<string>(DEFAULT_CUSTOM_COLOR)
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
   本机写入
   --------------------------------------------------------------------------- */
function writeStored(key: string, value: string): void {
  try {
    getLocalStorage()?.setItem(key, value)
  } catch {
    // 存不下就算了：本次会话仍然应用所选主题，只是下次打开会回到默认
  }
}

function applyCurrent(): void {
  applyTheme(mode.value, accent.value, customColor.value)
}

/* ---------------------------------------------------------------------------
   系统主题监听 / 跨标签页同步
   --------------------------------------------------------------------------- */
function onSystemThemeChange(event: MediaQueryListEvent): void {
  systemPrefersDark.value = event.matches
  if (modePreference.value === 'system') applyCurrent()
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
  const next = readThemePreferences()
  const changed =
    next.preference !== modePreference.value ||
    next.accent !== accent.value ||
    next.custom !== customColor.value

  modePreference.value = next.preference
  accent.value = next.accent
  customColor.value = next.custom
  syncSystemMediaListener()

  if (changed) applyCurrent()
}

function onStorageChange(event: StorageEvent): void {
  if (
    event.key !== null &&
    event.key !== THEME_MODE_STORAGE_KEY &&
    event.key !== THEME_ACCENT_STORAGE_KEY &&
    event.key !== THEME_CUSTOM_STORAGE_KEY
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

  const prefs = readThemePreferences()
  modePreference.value = prefs.preference
  accent.value = prefs.accent
  customColor.value = prefs.custom
  systemPrefersDark.value = readSystemPrefersDark()

  applyCurrent()
  syncSystemMediaListener()

  if (typeof window !== 'undefined' && !storageListenerAttached) {
    window.addEventListener('storage', onStorageChange)
    storageListenerAttached = true
  }
}

function setMode(next: ModePreference): void {
  if (!isModePreference(next)) return
  modePreference.value = next
  // 即使选择「跟随系统」也写入字面量 'system'
  writeStored(THEME_MODE_STORAGE_KEY, next)

  if (next === 'system') {
    systemPrefersDark.value = readSystemPrefersDark()
  }
  syncSystemMediaListener()
  applyCurrent()
}

function setAccent(next: ThemeAccent): void {
  if (!isThemeAccent(next)) return
  accent.value = next
  writeStored(THEME_ACCENT_STORAGE_KEY, next)
  applyCurrent()
}

/**
 * 应用自定义色并切换到「自定义」。
 * 返回 false 表示色值非法（UI 据此显示提示），此时不改动任何状态。
 */
function setCustomAccent(next: string): boolean {
  const normalized = parseHexColor(next)
  if (!normalized) return false
  customColor.value = normalized
  accent.value = 'custom'
  writeStored(THEME_CUSTOM_STORAGE_KEY, normalized)
  writeStored(THEME_ACCENT_STORAGE_KEY, 'custom')
  applyCurrent()
  return true
}

export interface ThemeAPI {
  mode: ComputedRef<ThemeMode>
  accent: typeof accent
  customColor: typeof customColor
  modePreference: typeof modePreference
  systemPrefersDark: typeof systemPrefersDark
  setMode: (next: ModePreference) => void
  setAccent: (next: ThemeAccent) => void
  setCustomAccent: (next: string) => boolean
  accents: readonly ThemeAccentOption[]
}

/** 组件里取主题状态与操作。无副作用，SSR 下也可安全调用。 */
export function useTheme(): ThemeAPI {
  return {
    mode,
    accent,
    customColor,
    modePreference,
    systemPrefersDark,
    setMode,
    setAccent,
    setCustomAccent,
    accents: THEME_ACCENTS,
  }
}
