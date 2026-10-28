/**
 * 把主题写到根元素与浏览器主题色上。
 *
 * 首帧启动脚本（`src/themeBoot.ts`）与运行期切换（`useTheme`）共用这一份：
 * 两处各写一遍的话，「刷新前后颜色不一样」会变成只有真实浏览器能抓到的问题。
 */
import { DEFAULT_CUSTOM_COLOR, deriveThemeVars, parseHexColor } from '../utils/themeColor'
import { PAPER_THEME_COLORS, type ThemeAccent, type ThemeMode } from './themeSettings'

const CUSTOM_VARS = [
  '--accent-rgb',
  '--accent-surface-rgb',
  '--accent-bright-rgb',
  '--on-accent-rgb',
] as const

export function applyTheme(
  mode: ThemeMode,
  accent: ThemeAccent,
  custom: string = DEFAULT_CUSTOM_COLOR,
): void {
  if (typeof document === 'undefined') return

  const root = document.documentElement
  root.dataset.mode = mode
  root.dataset.theme = accent
  root.style.colorScheme = mode

  const vars =
    accent === 'custom'
      ? deriveThemeVars(parseHexColor(custom) ?? DEFAULT_CUSTOM_COLOR, mode)
      : null
  const properties: readonly [string, string][] = vars
    ? [
        ['--accent-rgb', vars.accent],
        ['--accent-surface-rgb', vars.surface],
        ['--accent-bright-rgb', vars.bright],
        ['--on-accent-rgb', vars.onAccent],
      ]
    : []
  for (const [name, value] of properties) root.style.setProperty(name, value)
  if (!vars) {
    for (const name of CUSTOM_VARS) root.style.removeProperty(name)
  }

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  meta?.setAttribute('content', PAPER_THEME_COLORS[mode])
}
