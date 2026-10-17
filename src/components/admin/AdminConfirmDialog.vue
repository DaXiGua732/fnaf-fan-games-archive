<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

/**
 * AdminConfirmDialog —— 后台二次确认弹窗
 *
 * 用于不可逆动作（永久删除）。两层确认：先点动作按钮，再在弹窗里点确认。
 * 不用 `window.confirm`（可能被静默拦截，见 README §9.6）。
 *
 * Swiss：全屏半透明黑遮罩 + 白底黑框面板，零圆角、零阴影；
 * 打开时锁页面滚动、Esc / 点遮罩关闭、焦点默认落在「取消」上。
 */
const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    confirmLabel?: string
    busy?: boolean
    error?: string
  }>(),
  {
    confirmLabel: '确认',
    busy: false,
    error: '',
  },
)

const emit = defineEmits<{ confirm: []; cancel: [] }>()

const cancelButton = ref<HTMLButtonElement | null>(null)

function cancel(): void {
  if (props.busy) return
  emit('cancel')
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    cancel()
  }
}

let previousOverflow = ''

watch(
  () => props.open,
  (open) => {
    if (typeof document === 'undefined') return
    if (open) {
      previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      void nextTick(() => cancelButton.value?.focus())
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
      class="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 px-4"
      @click.self="cancel"
    >
      <div
        class="w-full max-w-[560px] border border-black bg-white"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="admin-confirm-title"
        aria-describedby="admin-confirm-desc"
      >
        <header class="border-b border-black px-6 py-4">
          <p class="swiss-meta text-black/45">二次确认</p>
          <h2 id="admin-confirm-title" class="mt-2 font-sans text-xl font-bold">{{ title }}</h2>
        </header>

        <div class="px-6 py-5">
          <div id="admin-confirm-desc" class="font-sans text-sm leading-relaxed text-black/70">
            <slot />
          </div>
          <p v-if="error" class="mt-3 font-sans text-xs font-bold text-[#ff0000]" role="alert">
            {{ error }}
          </p>
        </div>

        <footer class="flex flex-wrap justify-end gap-3 border-t border-black px-6 py-4">
          <button
            ref="cancelButton"
            type="button"
            class="rounded-none border border-black bg-white px-5 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:border-[#cccccc] disabled:text-black/30"
            :disabled="busy"
            @click="cancel"
          >
            取消
          </button>
          <button
            type="button"
            class="rounded-none border border-[#ff0000] bg-white px-5 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.14em] text-[#ff0000] transition-colors duration-150 ease-out hover:bg-[#ff0000] hover:text-white disabled:cursor-not-allowed disabled:border-[#cccccc] disabled:text-black/30 disabled:hover:bg-white disabled:hover:text-black/30"
            :disabled="busy"
            @click="emit('confirm')"
          >
            {{ busy ? '删除中…' : confirmLabel }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
