<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useTheme, type ModePreference } from '../composables/useTheme'

/**
 * ThemeSwitcher —— 主题选择器（模式 + 强调色）
 *
 * Swiss 约束：直角、零阴影、零渐变；动效上限 150ms 且只改颜色；
 * 面板与选项全部左对齐。颜色使用语义 token，不写死色值。
 *
 * 无障碍：
 *  - 触发按钮的 accessible name 始终是「主题」（窄屏只隐藏文字，不隐藏名称）。
 *  - 模式与强调色都用 aria-pressed 表达选中状态。
 *  - Escape / 外部点击 / 路由变化关闭；打开时焦点进入面板，关闭时还给触发按钮。
 */
const MODE_OPTIONS: readonly { id: ModePreference; label: string }[] = [
  { id: 'system', label: '跟随系统' },
  { id: 'light', label: '日间' },
  { id: 'dark', label: '夜间' },
]

const route = useRoute()
const { accent, modePreference, accents, setMode, setAccent } = useTheme()

const root = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const isOpen = ref(false)

const selectedAccent = computed(() =>
  accents.find((option) => option.id === accent.value),
)

function focusPanel(): void {
  void nextTick(() => {
    panel.value?.querySelector<HTMLButtonElement>('button')?.focus()
  })
}

function open(): void {
  isOpen.value = true
  focusPanel()
}

function close(): void {
  if (!isOpen.value) return
  isOpen.value = false
  void nextTick(() => trigger.value?.focus())
}

function toggle(): void {
  if (isOpen.value) close()
  else open()
}

function modeClass(id: ModePreference): string {
  return [
    'w-full border px-3 py-2 text-left font-sans text-[11px] uppercase tracking-[0.12em]',
    'transition-colors duration-150 ease-out',
    modePreference.value === id
      ? 'border-accent font-bold text-accent'
      : 'border-line text-ink hover:border-ink',
  ].join(' ')
}

function accentClass(id: string): string {
  return [
    'flex w-full items-center gap-2 border px-3 py-2 font-sans text-[11px]',
    'tracking-[0.12em] transition-colors duration-150 ease-out',
    accent.value === id
      ? 'border-accent font-bold text-accent'
      : 'border-line text-ink hover:border-ink',
  ].join(' ')
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!isOpen.value) return
  const target = event.target
  if (target instanceof Node && root.value?.contains(target)) return
  close()
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (!isOpen.value || event.key !== 'Escape') return
  event.preventDefault()
  close()
}

// 换页时菜单继续挂着会显得像页面没反应
watch(
  () => route.fullPath,
  () => {
    if (isOpen.value) close()
  },
)

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('keydown', onDocumentKeydown)
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onDocumentKeydown)
})
</script>

<template>
  <div ref="root" class="relative">
    <button
      ref="trigger"
      type="button"
      class="inline-flex h-9 items-center gap-2 border border-ink bg-paper px-2.5 font-sans text-[11px] font-bold uppercase tracking-[0.14em] text-ink transition-colors duration-150 ease-out hover:border-accent hover:text-accent md:px-3"
      aria-label="主题"
      aria-haspopup="dialog"
      :aria-expanded="isOpen"
      aria-controls="theme-panel"
      @click="toggle"
    >
      <span
        class="h-3 w-3 shrink-0 border border-ink/25"
        :style="selectedAccent ? { backgroundColor: selectedAccent.swatch } : undefined"
        aria-hidden="true"
      />
      <span class="sr-only sm:not-sr-only">主题</span>
      <span class="text-[8px] leading-none" aria-hidden="true">&#9662;</span>
    </button>

    <div
      v-if="isOpen"
      id="theme-panel"
      ref="panel"
      role="dialog"
      aria-labelledby="theme-panel-title"
      class="fixed inset-x-4 top-[4.5rem] z-[70] max-h-[calc(100vh-5.5rem)] overflow-y-auto border border-ink bg-paper p-5 text-ink sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[20rem]"
    >
      <p id="theme-panel-title" class="swiss-meta font-bold text-ink">主题设置</p>

      <!-- 模式偏好 -->
      <p id="theme-mode-label" class="swiss-meta mt-5 text-ink/70">模式</p>
      <div class="mt-3 grid grid-cols-3 gap-2" role="group" aria-labelledby="theme-mode-label">
        <button
          v-for="option in MODE_OPTIONS"
          :key="option.id"
          type="button"
          :class="modeClass(option.id)"
          :aria-pressed="modePreference === option.id"
          @click="setMode(option.id)"
        >
          {{ option.label }}
        </button>
      </div>

      <!-- 强调色 -->
      <p id="theme-accent-label" class="swiss-meta mt-5 text-ink/70">强调色</p>
      <div class="mt-3 grid grid-cols-2 gap-2" role="group" aria-labelledby="theme-accent-label">
        <button
          v-for="option in accents"
          :key="option.id"
          type="button"
          :class="accentClass(option.id)"
          :aria-pressed="accent === option.id"
          @click="setAccent(option.id)"
        >
          <span
            class="h-3 w-3 shrink-0 border border-ink/25"
            :style="{ backgroundColor: option.swatch }"
            aria-hidden="true"
          />
          <span>{{ option.label }}</span>
        </button>
      </div>

      <p class="mt-4 border-t border-line pt-3 font-sans text-[11px] leading-relaxed text-ink/70">
        主题只保存在这台设备上，不会同步到其他设备。
      </p>
    </div>
  </div>
</template>
