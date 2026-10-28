<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { scrollToTop } from '../utils/scroll'

/**
 * 右下角浮动「回到顶部」。
 *
 * 只在页面下翻约一个视口后出现；淡入淡出 150ms（Swiss 动效上限）。
 * 方角 + 1px 边框 + 反白悬停，与站内按钮一致，不用阴影 / 圆角 / 渐变。
 * 页脚已有文字版「回到顶部」，两处都走同一个 scrollToTop()。
 */
const show = ref(false)

function sync(): void {
  if (typeof window === 'undefined') return
  show.value = window.scrollY > window.innerHeight * 0.75
}

onMounted(() => {
  sync()
  window.addEventListener('scroll', sync, { passive: true })
  window.addEventListener('resize', sync)
})

onUnmounted(() => {
  window.removeEventListener('scroll', sync)
  window.removeEventListener('resize', sync)
})
</script>

<template>
  <Transition
    enter-active-class="transition-opacity duration-150 ease-out"
    enter-from-class="opacity-0"
    leave-active-class="transition-opacity duration-150 ease-out"
    leave-to-class="opacity-0"
  >
    <button
      v-if="show"
      type="button"
      aria-label="回到页面顶部"
      class="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center border border-black bg-white font-sans text-xl font-bold leading-none text-black transition-colors duration-150 ease-out hover:bg-black hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:bottom-8 md:right-8"
      @click="scrollToTop"
    >
      <span aria-hidden="true">&#8593;</span>
    </button>
  </Transition>
</template>
