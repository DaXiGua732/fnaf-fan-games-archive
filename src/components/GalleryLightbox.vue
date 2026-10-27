<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { assetUrl } from '../utils/asset'

/**
 * GalleryLightbox —— 截图查看器（参考 itch.io 的截图大图浏览）
 *
 * `modelValue` 为当前图片下标，`null` 表示关闭。
 * 键盘：← / → 切换，Esc 关闭；打开期间锁住页面滚动。
 *
 * Swiss：整屏反色底（overlay）+ inverse-fg 文字，图片只加 1px 反色边，
 * 零圆角零阴影。强调色只出现在悬停态。
 */
const props = defineProps<{
  images: string[]
  title: string
  modelValue: number | null
}>()

const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>()

const open = computed(() => props.modelValue !== null && props.images.length > 0)
const index = computed(() => Math.min(Math.max(props.modelValue ?? 0, 0), props.images.length - 1))
const current = computed(() => (open.value ? props.images[index.value] : ''))

function close(): void {
  emit('update:modelValue', null)
}

function go(delta: number): void {
  if (!open.value) return
  const count = props.images.length
  emit('update:modelValue', (index.value + delta + count) % count)
}

function onKeydown(event: KeyboardEvent): void {
  if (!open.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    go(-1)
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    go(1)
  }
}

/** 打开时锁滚动，关闭/卸载时恢复 —— 否则背后的页面会跟着一起滚 */
let previousOverflow = ''

watch(
  open,
  (value) => {
    if (typeof document === 'undefined') return
    if (value) {
      previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = previousOverflow
    }
  },
  { immediate: true },
)

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  if (typeof document !== 'undefined') document.body.style.overflow = previousOverflow
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[80] flex flex-col bg-overlay text-inverse-fg"
      role="dialog"
      aria-modal="true"
      :aria-label="`${title} 截图查看器`"
    >
      <!-- 顶栏：计数 + 关闭 -->
      <header class="flex items-center justify-between gap-6 border-b border-inverse-fg/30 px-6 py-4">
        <p class="swiss-meta text-inverse-fg/70">
          截图 {{ index + 1 }} / {{ images.length }}
        </p>
        <button
          type="button"
          class="border border-inverse-fg/40 px-4 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:border-accent-surface hover:bg-accent-surface hover:text-on-accent"
          @click="close"
        >
          关闭
        </button>
      </header>

      <!-- 图片：点击空白处关闭 -->
      <div class="flex min-h-0 flex-1 items-center justify-center px-4 py-6" @click.self="close">
        <img
          :src="assetUrl(current)"
          :alt="`${title} 截图 ${index + 1}`"
          class="max-h-full max-w-full border border-inverse-fg object-contain"
        />
      </div>

      <!-- 底栏：上一张 / 下一张 -->
      <footer class="flex items-center justify-between gap-4 border-t border-inverse-fg/30 px-6 py-4">
        <button
          type="button"
          class="group inline-flex items-center gap-4 border border-inverse-fg/40 px-5 py-2.5 font-sans text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:border-accent-surface hover:bg-accent-surface hover:text-on-accent"
          @click="go(-1)"
        >
          <span class="u-arrow-back" aria-hidden="true">&#8594;</span>
          <span>上一张</span>
        </button>

        <p class="hidden max-w-[40ch] truncate font-sans text-xs text-inverse-fg/50 sm:block">
          {{ title }}
        </p>

        <button
          type="button"
          class="group inline-flex items-center gap-4 border border-inverse-fg/40 px-5 py-2.5 font-sans text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:border-accent-surface hover:bg-accent-surface hover:text-on-accent"
          @click="go(1)"
        >
          <span>下一张</span>
          <span class="u-arrow" aria-hidden="true">&#8594;</span>
        </button>
      </footer>
    </div>
  </Teleport>
</template>
