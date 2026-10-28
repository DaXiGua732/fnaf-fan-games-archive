# 视觉规范：Swiss International Style

> 规范原文：**「视觉规范的一致性高于一切创意延展，一旦偏离即视为严重 Bug。」**

## 1. 绝对禁忌

| 禁止 | 替代方案 |
| --- | --- |
| 任何圆角 `rounded-md/lg/full` | 只能用 `rounded-none` |
| 任何阴影 `shadow-*`、`box-shadow` | 用 1px 边框分隔 |
| 任何渐变 `bg-gradient-to-*` | 纯色块 |
| `font-serif` / `font-mono` | 只用 Helvetica / Arial / sans-serif |
| `text-center` | 一律 `text-left` |
| `hover:scale-*` / `hover:translate-y-*` | 悬停只改颜色 |

**唯一允许的位移**：按钮内部箭头 `group-hover:translate-x-2`（实现为 `.u-arrow`）。

> ⚠️ **反向箭头必须用 `.u-arrow-back`，不要写 `u-arrow rotate-180`。**
> `.group:hover .u-arrow` 的优先级 (0,3,0) 高于 `.rotate-180` 的 (0,1,0) ——
> 两条都只写 `transform`，悬停时高优先级那条会把 `rotate` 整个覆盖掉，
> 箭头会在鼠标移上去的瞬间从 ← 翻成 → 并向右跑。
> `.u-arrow-back` 把旋转写进 transform 本身。

## 2. 设计系统速查

- **色彩（浅色默认值）**：纸 `#fafaf8` / 墨 `#1a1a18` / 强调 `#257e78`（默认初音蓝，
  其余歌姬色见 §4）/ 辅助线 `#d4d4d0` / 浅层表面 `#f2f2ef`。
  深色模式整体替换变量（纸 `#141413` / 墨 `#e8e8e4`）。
- **网格**：12 列衍生，常用 `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8`
- **动效上限**：`duration-150 ease-out`
- **留白优先**：用大间距（`py-24`、`mb-12`）而非分隔线建立层级
- **`.swiss-meta`**：`text-[11px] uppercase tracking-[0.18em]`，用于年份 / 作者 / 元信息

**组件写法参考**：`Button.vue`（箭头位移用 `.u-arrow`）、`Card.vue`（左边框悬停变强调色，
左侧常驻 `border-l-4 border-l-transparent` 以避免布局抖动）。

## 3. 三层强制机制

规范不靠自觉，而是**三层拦截**：

**第一层：Tailwind 覆盖式配置**（`tailwind.config.js`）—— 用**覆盖**而不是 `extend`，
从编译层删掉工具类：

```js
borderRadius: { none: '0px' },      // rounded-md/lg/full 根本不存在
boxShadow: { none: 'none' },        // shadow-sm/md/lg 不存在
backgroundImage: { none: 'none' },  // bg-gradient-to-* 被杀死
fontFamily: { sans: ['Helvetica', 'Arial', 'sans-serif'] },
scale: {}, translate: {},           // hover:scale-* / translate-* 不存在
transitionDuration: { DEFAULT: '150ms', 150: '150ms' },
```

> ⚠️ 不要给这四个 theme key 加 `DEFAULT`，否则会生成裸类 `.shadow` / `.rounded`。
> 曾经因为注释里出现 "box-shadow" 一词，Tailwind 提取器把它当候选类名生成了 `.shadow`
> （见 [`PITFALLS.md`](PITFALLS.md)）。

**第二层：全局 CSS 硬重置**（`src/styles/index.css`）

```css
*, *::before, *::after {
  border-radius: 0 !important;
  box-shadow: none !important;
}
```

body 强制 `Helvetica, Arial, sans-serif`，所有文本元素默认 `text-align: left`。
即使某个组件漏写工具类，也不会破坏红线。

**第三层：运行时哨兵**（`StyleAuditBadge.vue`）—— 全量扫描 DOM 比对计算样式，
页面顶部直接显示 PASS / FAIL + 违规元素列表。它挂在 `AdminLayout` 上；
公开站由 Tailwind 覆盖配置、全局重置与 UI 测试的视觉哨兵共同保证。

### 审计产物 CSS

每次改完样式可以跑一遍：

```bash
CSS=$(ls dist/assets/*.css)
grep -o 'border-radius:[^;}]*' "$CSS" | sort -u   # 只应出现 0 / 0!important
grep -o 'box-shadow:[^;}]*' "$CSS" | sort -u      # 只应出现 none / none!important
grep -o 'linear-gradient([^)]*)' "$CSS" | sort -u # 应为空
grep -o '\.rounded-md\|\.shadow{\|\.font-serif\|\.font-mono' "$CSS" | sort -u  # 应为空
```

## 4. 主题系统（浅色 / 深色 + 强调色）

**它只改颜色，不改形状。** 圆角、阴影、渐变、对齐、字体、间距与动效上限全部不变 ——
主题把颜色从组件里抽成一层语义变量。

**模式偏好**：跟随系统（默认）/ 日间 / 夜间。跟随系统时监听 `prefers-color-scheme`，
系统变化实时生效；切到日间 / 夜间后移除监听。

**强调色**：6 种预设（默认初音蓝）加 1 种自定义色：

| id | 名称 | 代表色 |
| --- | --- | --- |
| `miku` | 初音蓝 | `#39c5bb` |
| `rin` | 镜音橙 | `#f2a900` |
| `len` | 镜音黄 | `#ffe211` |
| `luka` | 巡音粉 | `#ff9ec4` |
| `meiko` | MEIKO红 | `#c8102e` |
| `kaito` | KAITO蓝 | `#3366cc` |
| `custom` | 自定义 | 用户选定 |

代表色**直接用作 `accent-surface`**（Hero、悬停底色等大面积色块），选择器色块也用它；
`on-accent` 按代表色亮度在黑 / 白之间二选一。`accent` 用于正文 / 边框 / 小面积悬停，
必须是同色相的加深版本（与 paper 保持 >= 4.5:1）—— 代表色本身对纸色太浅，
直接当文字色会看不清。深色模式下 `accent-surface` 仍是同一个代表色，
只有 `accent` 提亮。预设色的取色只改 `src/styles/index.css`。

**自定义色**：切换器里提供原生取色器与 `#RGB` / `#RRGGBB` 输入框，两者都立即生效；
非法色值只提示、不改当前主题。因为自定义色没有对应的 CSS 块，四个变量由
`src/utils/themeColor.ts` 现算后以内联 `style` 写到根元素：

- `surface` 原样使用输入色
- `on-accent` 在黑 / 白中选对比度更高的
- `accent` 向黑（浅色模式）或向白（深色模式）移动到 4.6:1
- `accent-bright` 向白移动到 4.5:1（面向页脚 / 灯箱的反色底）

切回预设色时必须移除这四个内联变量，否则自定义色会继续覆盖预设色。
首帧防闪白脚本在构建时由 `src/themeBoot.ts` 打包内联进 `index.html`，
与 `useTheme` 共用 `src/theme/**` 的同一份读取与派生实现 —— 算法只有一处。

> 自由取色的固有边界：如果用户选了中间调（黑 / 白前景都到不了 4.5:1），
> `on-accent` 只能二选一取对比度更高的那个，**不会**为了达标而改掉用户选的颜色。

**作用范围**：公开站与后台共用同一份设置（模块级单例），**只保存在当前设备**。
切换器在 `Layout.vue` 与 `AdminLayout.vue` 里都挂了一份。

| 文件 | 职责 |
| --- | --- |
| `src/styles/index.css` | `:root` 下的预设色 CSS 变量；`data-mode` / `data-theme` 切换 |
| `tailwind.config.js` | 把变量映射成语义工具类（`ink` / `paper` / `line` / `surface` / `accent` …） |
| `src/utils/themeColor.ts` | 自定义色解析与四个变量的派生（纯函数，可断言） |
| `src/theme/themeSettings.ts` | storage key、合法取值、读取与回退（不依赖 Vue / DOM） |
| `src/theme/applyTheme.ts` | 把模式 / 强调色 / 自定义色写到根元素与 `theme-color` |
| `src/themeBoot.ts` | 首帧启动入口；构建时打包内联进 `index.html` |
| `src/composables/useTheme.ts` | 模块级单例：应用内切换、跨标签页同步、系统主题变化 |
| `src/components/ThemeSwitcher.vue` | 顶部「主题」下拉：模式 / 预设色 / 自定义取色 |
| `index.html` | 只有 `<!--THEME_BOOT-->` 占位符，不写主题逻辑 |
| `vite.config.ts` | `theme-boot` 插件：打包 `themeBoot.ts` 并替换占位符 |
| `src/dev/themeAssertions.ts` | 模式解析 / 色值白名单 / 读取回退 / 自定义色派生的纯函数断言 |

**storage key（唯一出处：`src/theme/themeSettings.ts`）**：

```
fnaf-archive:theme-mode:v1      # system | light | dark
fnaf-archive:theme-accent:v1    # miku | rin | len | luka | meiko | kaito | custom
fnaf-archive:theme-custom:v1    # 自定义色 #rrggbb（切回预设色时保留）
```

`selftest` 有静态守卫：占位符必须在、key 只能出现在 `themeSettings.ts`、首帧模块不得引 Vue；
`npm run build` 末尾会检查产物里占位符确实被替换。`localStorage` 不可用时按「跟随系统」降级。
旧版的 `red / blue / teal / pink / purple` 已不是合法值：`readThemePreferences()` 与首帧脚本
（同一份实现）都会回退到默认的 `miku`（不改 storage key，旧值就地失效）。

### 语义 token

| token | 用途 |
| --- | --- |
| `ink` / `paper` | 正文 / 背景 |
| `line` / `surface` | 分隔线 / 低层表面 |
| `inverse` / `inverse-fg` | 页脚、灯箱等反色区域 |
| `overlay` | 弹窗遮罩 |
| `accent` | 文字、边框、小面积悬停 |
| `accent-surface` | 大面积色块（主按钮悬停、错误条、已收录提示） |
| `accent-bright` | 反色底（页脚 / 灯箱）上的链接与强调文字 |
| `on-accent` | `accent-surface` 上的前景色（不随主题反转） |

- **颜色只在 `src/styles/index.css` 的变量里定义。** `.vue` 里写死 hex、或用 Tailwind 固定调色板
  （`bg-red-500`、`text-gray-600`）会被 `selftest` 静态守卫拦下。
- `accent` 要保证在 paper 上可读；`accent-surface` 要保证与 `on-accent` 有足够对比度。
  深色模式下 `accent` 变浅，`accent-surface` 变深。
- 根元素同时切换 `color-scheme`；`body` 背景 / 文字跟变量走；`<meta name="theme-color">` 也会换。

**⚠️ `white` / `black` 已被重映射**：

```
white → paper   浅色是纸白，深色是深纸底
black → ink     浅色是墨色，深色是浅色文字
```

这样存量组件里的 `bg-white` / `text-black` 不用批量改写也能随主题反转。
**但不要在强调色 / 反色底色上用 `white` / `black` 指定前景**：

- `bg-accent*` 上必须用 `text-on-accent`；
- 页脚 / 灯箱等反色区域必须用 `inverse` / `inverse-fg`。

> 新增颜色前先问：它在浅色和深色下都成立吗？只成立一边的，就不该是语义 token，
> 而应该是某个模式下单独覆盖的变量。
