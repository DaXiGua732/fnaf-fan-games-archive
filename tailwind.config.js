/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],

  // ===================================================================
  // Swiss International Style —— 硬性约束
  // 注意：以下是「覆盖式」配置而非 extend，会直接删除对应工具类，
  // 从编译层面让违规写法无法生效（写了也不产出 CSS）。
  // ===================================================================
  theme: {
    // 只保留 rounded-none —— 其余 rounded-* 全部不存在
    // （注意：不保留 DEFAULT，否则 `.rounded` 仍可能被生成）
    borderRadius: {
      none: '0px',
    },

    // 只保留 shadow-none —— 其余 shadow-* 全部不存在
    // （同样不保留 DEFAULT，杜绝 `.shadow` 被生成）
    boxShadow: {
      none: 'none',
    },

    // 只保留 bg-none —— 直接杀死 bg-gradient-to-* 系列
    backgroundImage: {
      none: 'none',
    },

    // 只保留无衬线 —— font-serif / font-mono 不存在
    fontFamily: {
      sans: ['Helvetica', 'Arial', 'sans-serif'],
    },

    // 唯一允许的过渡时长/缓动，防止有人写 duration-700
    transitionDuration: {
      DEFAULT: '150ms',
      150: '150ms',
    },
    transitionTimingFunction: {
      DEFAULT: 'cubic-bezier(0, 0, 0.2, 1)',
      out: 'cubic-bezier(0, 0, 0.2, 1)',
    },

    // 只保留 scale / translate 之外的位移被禁用：删除 scale 工具类
    // （规格：严禁 hover:translate-y-*、hover:scale-*，唯一允许箭头位移）
    scale: {},
    translate: {},

    extend: {
      colors: {
        // -----------------------------------------------------------------
        // 主题语义色，全部由 src/styles/index.css 里的 CSS 变量驱动。
        // 变量值形如 `26 26 24`，因此 `text-ink/60` 之类的透明度修饰符可用。
        // -----------------------------------------------------------------
        // 强调色家族：
        //   accent          文字 / 边框 / 小面积悬停
        //   accent-surface  大面积色块（Hero、灯箱悬停）；配 on-accent 使用
        //   accent-bright   深色底（页脚）上的链接文字
        accent: 'rgb(var(--accent-rgb) / <alpha-value>)',
        'accent-surface': 'rgb(var(--accent-surface-rgb) / <alpha-value>)',
        'accent-bright': 'rgb(var(--accent-bright-rgb) / <alpha-value>)',
        'on-accent': 'rgb(var(--on-accent-rgb) / <alpha-value>)',

        // 语义表面与文字：
        //   ink / paper       正文与背景
        //   line / surface    分隔线与低层表面
        //   inverse / inverse-fg  页脚、灯箱等反色区域
        //   overlay           弹窗遮罩
        ink: 'rgb(var(--ink-rgb) / <alpha-value>)',
        paper: 'rgb(var(--paper-rgb) / <alpha-value>)',
        line: 'rgb(var(--line-rgb) / <alpha-value>)',
        surface: 'rgb(var(--surface-rgb) / <alpha-value>)',
        inverse: 'rgb(var(--inverse-rgb) / <alpha-value>)',
        'inverse-fg': 'rgb(var(--inverse-fg-rgb) / <alpha-value>)',
        overlay: 'rgb(var(--overlay-rgb) / <alpha-value>)',

        // -----------------------------------------------------------------
        // ⚠️ white / black 已被**主题映射**，不是固定的纯白 / 纯黑：
        //   white → paper（浅色模式是纸白，深色模式是深纸底）
        //   black → ink  （浅色模式是墨色，深色模式是浅色文字）
        // 这样存量组件里的 bg-white / text-black / bg-black / text-white
        // 无需批量改写也能随主题反转。
        //
        // 但这也意味着：**强调色 / 反色底色上不要用 white / black 来指定前景**。
        // 在 `bg-accent*` 上必须用 `text-on-accent`（它不随主题反转）；
        // 在页脚 / 灯箱等反色区域必须用 `inverse` / `inverse-fg`。
        // -----------------------------------------------------------------
        white: 'rgb(var(--paper-rgb) / <alpha-value>)',
        black: 'rgb(var(--ink-rgb) / <alpha-value>)',
      },
    },
  },

  plugins: [],
}
