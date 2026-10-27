import { createApp } from 'vue'
import './styles/index.css'
import App from './App.vue'
import { initTheme } from './composables/useTheme'
import router from './router'
import { createAbacusViewProvider } from './services/abacusViewProvider'
import { registerViewProvider } from './services/viewCounter'

// 必须在 createApp().mount() 之前应用主题：
// index.html 的内联脚本已防住首帧闪白，这里接管后续的切换与跨标签页同步。
initTheme()

// 只在生产构建里启用实时计数：本地开发 / UI 测试反复打开详情页，
// 不应该把线上浏览量刷上去。命名空间用仓库名，保证全站唯一。
if (import.meta.env.PROD) {
  registerViewProvider(
    createAbacusViewProvider({ namespace: 'fnaf-fan-games-archive' }),
  )
}

createApp(App).use(router).mount('#app')
