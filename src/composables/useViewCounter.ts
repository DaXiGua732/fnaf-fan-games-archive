import { onMounted, ref, watch } from 'vue'
import { getActiveProviderId, isRemoteViewEnabled, trackView } from '../services/viewCounter'

/**
 * 浏览量 Composable
 *
 * 用法（详情页）：
 *   const { count, source, isLoading } = useViewCounter(
 *     () => props.id,
 *     () => game.value?.metrics.fakeViews ?? 0,
 *   )
 *
 * 传入 getter 而不是普通值，这样游戏 id 变化（同一路由切换不同游戏）时能正确重新统计。
 *
 * 两种模式：
 *   - remote：已接入后端，走异步请求，isLoading 参与 UI
 *   - static：未接入后端，**同步**取值，不做无谓的 loading 闪烁（SSR 首帧也能渲染出数字）
 */
export function useViewCounter(
  gameId: () => string | undefined,
  staticBase: () => number,
) {
  const remoteEnabled = isRemoteViewEnabled()

  const count = ref<number | null>(null)
  const source = ref<'remote' | 'static'>('static')
  const isLoading = ref(false)

  function syncStatic(): void {
    const id = gameId()
    count.value = id ? staticBase() : null
    source.value = 'static'
  }

  async function load(): Promise<void> {
    const id = gameId()
    if (!id) {
      count.value = null
      isLoading.value = false
      return
    }

    if (!remoteEnabled) {
      syncStatic()
      isLoading.value = false
      return
    }

    isLoading.value = true
    const result = await trackView(id, staticBase())
    count.value = result.count
    source.value = result.source
    isLoading.value = false
  }

  if (remoteEnabled) {
    isLoading.value = true
  } else {
    syncStatic()
  }

  onMounted(load)
  watch(gameId, load)

  return {
    count,
    source,
    isLoading,
    /** 当前生效的数据源标识，static 表示尚未接入后端 */
    providerId: getActiveProviderId(),
  }
}
