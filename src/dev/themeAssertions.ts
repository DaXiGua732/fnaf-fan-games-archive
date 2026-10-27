import type { Assertion } from './libraryAssertions'
import {
  isModePreference,
  isThemeAccent,
  resolveMode,
  THEME_ACCENTS,
} from '../composables/useTheme'

/**
 * 主题系统的纯函数断言。
 *
 * 与其它断言集一样，只验证输入 → 期望输出，不依赖 DOM / localStorage。
 * 由 scripts/selftest.mts 消费，本文件不自行执行。
 */
export function runThemeAssertions(): Assertion[] {
  const results: Assertion[] = []

  const check = (name: string, actual: unknown, expected: unknown): void => {
    const a = String(actual)
    const e = String(expected)
    results.push({ name, expected: e, actual: a, pass: a === e })
  }

  // resolveMode：系统偏好解析与显式偏好
  check('resolveMode · system + 系统深色 → dark', resolveMode('system', true), 'dark')
  check('resolveMode · system + 系统浅色 → light', resolveMode('system', false), 'light')
  check('resolveMode · light 不受系统深色影响', resolveMode('light', true), 'light')
  check('resolveMode · dark 不受系统浅色影响', resolveMode('dark', false), 'dark')

  // isThemeAccent：接受六种合法值，拒绝其它输入
  const accentIds = THEME_ACCENTS.map((option) => option.id)
  check('isThemeAccent · 接受全部六个 accent', accentIds.every(isThemeAccent), true)
  check('isThemeAccent · 拒绝 green', isThemeAccent('green'), false)
  check('isThemeAccent · 拒绝旧版 red', isThemeAccent('red'), false)
  check('isThemeAccent · 拒绝空字符串', isThemeAccent(''), false)
  check('isThemeAccent · 拒绝 null', isThemeAccent(null), false)
  check('isThemeAccent · 拒绝数字', isThemeAccent(1), false)

  // isModePreference：接受三种合法值，拒绝其它输入
  check(
    'isModePreference · 接受 system / light / dark',
    ['system', 'light', 'dark'].every(isModePreference),
    true,
  )
  check('isModePreference · 拒绝 auto', isModePreference('auto'), false)
  check('isModePreference · 拒绝 empty', isModePreference(''), false)
  check('isModePreference · 拒绝 null', isModePreference(null), false)

  // 主题清单本身：恰好六个、id 与顺序固定、色块不重复
  check(
    'THEME_ACCENTS · 恰好包含六个固定 id',
    accentIds.join(','),
    'miku,rin,len,luka,meiko,kaito',
  )
  const swatches = THEME_ACCENTS.map((option) => option.swatch)
  check('THEME_ACCENTS · 色块数量与主题数量一致', swatches.length, accentIds.length)
  check('THEME_ACCENTS · 色块不重复', new Set(swatches).size, swatches.length)
  check(
    'THEME_ACCENTS · 默认色是初音未来',
    THEME_ACCENTS[0].id,
    'miku',
  )

  return results
}
