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
        accent: '#ff0000',
        line: '#cccccc',
        surface: '#f9f9f9',
      },
    },
  },

  plugins: [],
}
