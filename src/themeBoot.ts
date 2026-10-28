/**
 * 首帧主题启动：在 Vue 挂载之前按本机设置应用主题，避免深色模式闪白。
 *
 * 构建时由 `vite.config.ts` 的 `theme-boot` 插件打包成 IIFE 并**内联**进
 * `index.html` 的 `<!--THEME_BOOT-->` 占位符。所以这里只允许依赖不含 Vue、
 * 不产生加载期副作用的模块；否则会把整包拉进首帧或打乱执行顺序。
 */
import { applyTheme } from './theme/applyTheme'
import {
  readSystemPrefersDark,
  readThemePreferences,
  resolveMode,
} from './theme/themeSettings'
import { getLocalStorage } from './utils/localStorage'

export function bootTheme(storage: Storage | null = getLocalStorage()): void {
  const prefs = readThemePreferences(storage)
  applyTheme(resolveMode(prefs.preference, readSystemPrefersDark()), prefs.accent, prefs.custom)
}
