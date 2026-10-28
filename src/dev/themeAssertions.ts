import type { Assertion } from './libraryAssertions'
import {
  THEME_ACCENT_STORAGE_KEY,
  THEME_ACCENTS,
  THEME_CUSTOM_STORAGE_KEY,
  THEME_MODE_STORAGE_KEY,
  isModePreference,
  isThemeAccent,
  readThemePreferences,
  resolveMode,
} from '../theme/themeSettings'
import {
  DEFAULT_CUSTOM_COLOR,
  deriveThemeVars,
  parseHexColor,
} from '../utils/themeColor'

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

  // isThemeAccent：接受六种预设 + 自定义，拒绝其它输入
  const accentIds = THEME_ACCENTS.map((option) => option.id)
  check('isThemeAccent · 接受全部六个预设 accent', accentIds.every(isThemeAccent), true)
  check('isThemeAccent · 接受 custom', isThemeAccent('custom'), true)
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
    'THEME_ACCENTS · 标签是颜色而不是歌姬名',
    THEME_ACCENTS.map((option) => option.label).join(','),
    '初音蓝,镜音橙,镜音黄,巡音粉,MEIKO红,KAITO蓝',
  )

  // 自定义色：解析与派生
  check('parseHexColor · 接受 #RRGGBB 并小写化', parseHexColor('#39C5BB'), '#39c5bb')
  check('parseHexColor · 接受 3 位与省略 #', parseHexColor('f00'), '#ff0000')
  check('parseHexColor · 接受首尾空白', parseHexColor('  #7A5CFF '), '#7a5cff')
  check('parseHexColor · 拒绝两位色值', parseHexColor('#12'), null)
  check('parseHexColor · 拒绝非字符串', parseHexColor(0x39c5bb), null)
  check('DEFAULT_CUSTOM_COLOR · 是合法色值', parseHexColor(DEFAULT_CUSTOM_COLOR), DEFAULT_CUSTOM_COLOR)

  const lightYellow = deriveThemeVars('#ffe211', 'light')
  check('deriveThemeVars · surface 原样使用输入色', lightYellow.surface, '255 226 17')
  check('deriveThemeVars · 亮色用墨色前景', lightYellow.onAccent, '26 26 24')
  check('deriveThemeVars · 浅色模式把亮色压暗成可读文字色', lightYellow.accent !== lightYellow.surface, true)

  const lightNavy = deriveThemeVars('#111111', 'light')
  check('deriveThemeVars · 暗色用纸白前景', lightNavy.onAccent, '250 250 248')
  check('deriveThemeVars · 已经够暗的文字色不再改动', lightNavy.accent, lightNavy.surface)

  const darkYellow = deriveThemeVars('#ffe211', 'dark')
  check('deriveThemeVars · 深色模式亮色可直接做文字色', darkYellow.accent, darkYellow.surface)
  const darkNavy = deriveThemeVars('#111111', 'dark')
  check('deriveThemeVars · 深色模式把暗色提亮成可读文字色', darkNavy.accent !== darkNavy.surface, true)

  // 首帧启动脚本与 useTheme 共用 readThemePreferences —— 默认值 / 回退规则只此一份
  const storageWith = (entries: Record<string, string>): Storage =>
    ({ getItem: (key: string) => entries[key] ?? null }) as unknown as Storage

  const empty = readThemePreferences(storageWith({}))
  check('readThemePreferences · 空存储 → 跟随系统', empty.preference, 'system')
  check('readThemePreferences · 空存储 → 默认强调色', empty.accent, 'miku')
  check('readThemePreferences · 空存储 → 默认自定义色', empty.custom, DEFAULT_CUSTOM_COLOR)

  const legacy = readThemePreferences(
    storageWith({
      [THEME_MODE_STORAGE_KEY]: 'auto',
      [THEME_ACCENT_STORAGE_KEY]: 'red',
      [THEME_CUSTOM_STORAGE_KEY]: 'not-a-color',
    }),
  )
  check('readThemePreferences · 非法模式回退 system', legacy.preference, 'system')
  check('readThemePreferences · 旧版强调色回退 miku', legacy.accent, 'miku')
  check('readThemePreferences · 非法自定义色回退默认', legacy.custom, DEFAULT_CUSTOM_COLOR)

  const custom = readThemePreferences(
    storageWith({
      [THEME_MODE_STORAGE_KEY]: 'dark',
      [THEME_ACCENT_STORAGE_KEY]: 'custom',
      [THEME_CUSTOM_STORAGE_KEY]: '  #39C5BB ',
    }),
  )
  check('readThemePreferences · 读取模式', custom.preference, 'dark')
  check('readThemePreferences · 读取自定义强调色', custom.accent, 'custom')
  check('readThemePreferences · 自定义色规范化', custom.custom, '#39c5bb')
  return results
}
