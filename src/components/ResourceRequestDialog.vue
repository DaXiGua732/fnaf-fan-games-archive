<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useGameLibrary } from '../composables/useGameLibrary'
import { useResourceRequests } from '../composables/useResourceRequests'
import type { Game } from '../types/game'
import type { RequestSubmitResult, ResourceRequest } from '../types/resourceRequest'
import { RESOURCE_REQUEST_LIMITS, ResourceRequestError } from '../types/resourceRequest'
import { matchExactGameForTitle, normalizeRequestTitle } from '../utils/requestMatch'

/**
 * ResourceRequestDialog —— 「催一个资源」
 *
 * 交互铁律：**先在站内找，再提交请求**。
 * 归一化标题与站内作品精确相同时，只给详情链接，不引导重复提交。
 */
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { visibleGames, searchGames, setSearchQuery, clearFilters } = useGameLibrary()
const {
  submit,
  vote,
  existingRequestFor,
  votedIds,
  pendingVotes,
  isSubmitting,
  load,
} = useResourceRequests()

const query = ref('')
const submitResult = ref<RequestSubmitResult | null>(null)
const submitError = ref('')
const voteMessage = ref('')
const inputRef = ref<HTMLInputElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)

let previousFocus: HTMLElement | null = null
let previousOverflow = ''
let bodyLocked = false
/** 弹窗会话 / 输入的代次；异步响应回来时据此丢弃已经过期的结果 */
let interactionToken = 0

function invalidateInteraction(): void {
  interactionToken += 1
}

const trimmed = computed(() => query.value.trim())
const normalizedQuery = computed(() => normalizeRequestTitle(trimmed.value))
const canSearch = computed(() => trimmed.value.length >= 2)
/** 只输入标点 / 符号时归一化为空，仓储会拒绝；提交按钮应提前禁用并给出提示 */
const hasMeaningfulTitle = computed(() => normalizedQuery.value.length > 0)
const searchResults = computed<Game[]>(() =>
  canSearch.value ? searchGames(trimmed.value, 5) : [],
)
const exactGame = computed<Game | undefined>(() =>
  canSearch.value ? matchExactGameForTitle(trimmed.value, visibleGames.value) : undefined,
)
const existingRequest = computed<ResourceRequest | undefined>(() =>
  canSearch.value ? existingRequestFor(trimmed.value) : undefined,
)
const isVoted = computed(() =>
  existingRequest.value ? votedIds.value.has(existingRequest.value.id) : false,
)
const isVotePending = computed(() =>
  existingRequest.value ? pendingVotes.value.has(existingRequest.value.id) : false,
)
const canSubmit = computed(
  () =>
    canSearch.value &&
    hasMeaningfulTitle.value &&
    trimmed.value.length <= RESOURCE_REQUEST_LIMITS.titleMax &&
    !exactGame.value &&
    // 已有同标题请求时只提供 +1，避免「+1」与「提交」两个按钮做同一件事
    !existingRequest.value &&
    !isSubmitting.value &&
    submitResult.value === null,
)
const submitLabel = computed(() =>
  searchResults.value.length > 0 ? '以上都不是 · 提交催资源' : '提交催资源',
)

const successMessage = computed(() => {
  const result = submitResult.value
  if (!result) return ''
  if (result.created) {
    return `已提交《${result.request.title}》 · 当前 ${result.request.votes} 人催`
  }
  if (result.voted) {
    return `已有人催过，已为你 +1 · 当前 ${result.request.votes} 人催`
  }
  return `已有人催过《${result.request.title}》，你已经催过了 · 当前 ${result.request.votes} 人催`
})

function describeError(cause: unknown): string {
  if (cause instanceof ResourceRequestError) return cause.message
  return '请求失败了，请稍后再试。'
}

function focusableElements(): HTMLElement[] {
  const panel = panelRef.value
  if (!panel) return []
  return Array.from(
    panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  )
}

function close(): void {
  emit('close')
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.open) return
  // 中文 / 日文输入法用 Escape / 229 取消候选词，不能当成「关闭弹窗」
  if (event.isComposing || event.keyCode === 229) return

  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }

  if (event.key !== 'Tab') return
  const items = focusableElements()
  if (items.length === 0) {
    event.preventDefault()
    panelRef.value?.focus()
    return
  }

  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement
  // 焦点可能落在 tabindex=-1 的面板本身，或（理论上）遮罩后的页面；
  // 这两种情况都直接拉回面板内，否则 Shift+Tab 会跑到背后的页面。
  if (
    !(active instanceof HTMLElement) ||
    active === panelRef.value ||
    !panelRef.value?.contains(active)
  ) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
    return
  }

  if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

function restoreFocus(): void {
  const target = previousFocus
  previousFocus = null
  if (target && target.isConnected) target.focus({ preventScroll: true })
}

watch(
  () => props.open,
  (open) => {
    invalidateInteraction()
    if (typeof document === 'undefined') return

    if (open) {
      if (!bodyLocked) {
        const active = document.activeElement
        previousFocus = active instanceof HTMLElement ? active : null
        previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        bodyLocked = true
      }

      query.value = ''
      submitResult.value = null
      submitError.value = ''
      voteMessage.value = ''

      void load()
      void nextTick(() => inputRef.value?.focus())
    } else if (bodyLocked) {
      document.body.style.overflow = previousOverflow
      bodyLocked = false
      void nextTick(restoreFocus)
    }
  },
  { immediate: true },
)

watch(query, () => {
  invalidateInteraction()
  submitResult.value = null
  submitError.value = ''
  voteMessage.value = ''
})

onMounted(() => window.addEventListener('keydown', onKeydown))

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  if (typeof document !== 'undefined') {
    if (bodyLocked) {
      document.body.style.overflow = previousOverflow
      bodyLocked = false
    }
    restoreFocus()
  }
})

async function handleSubmit(): Promise<void> {
  if (!canSubmit.value) return
  const title = trimmed.value
  const token = interactionToken
  submitError.value = ''
  voteMessage.value = ''

  try {
    const result = await submit(title)
    // 用户可能在等待期间改了输入或关了弹窗；旧请求的结果不能再挂到新输入上
    if (token !== interactionToken || !props.open || trimmed.value !== title) return
    submitResult.value = result
  } catch (cause) {
    if (token !== interactionToken || !props.open || trimmed.value !== title) return
    submitResult.value = null
    submitError.value = describeError(cause)
  }
}

async function handleVoteExisting(): Promise<void> {
  const request = existingRequest.value
  if (!request || isVoted.value || isVotePending.value) return
  const token = interactionToken
  submitError.value = ''
  voteMessage.value = ''

  try {
    const result = await vote(request.id)
    if (
      token !== interactionToken ||
      !props.open ||
      existingRequest.value?.id !== request.id
    ) {
      return
    }
    voteMessage.value = result.added
      ? `已为《${request.title}》+1`
      : `你已经催过《${request.title}》了`
  } catch (cause) {
    if (
      token !== interactionToken ||
      !props.open ||
      existingRequest.value?.id !== request.id
    ) {
      return
    }
    submitError.value = describeError(cause)
  }
}

/** Hash 路由下不能用 href="#library"：那会被当成路由跳转 */
function filterInLibrary(): void {
  // 用「归一化后精确命中的作品标题」而不是原始输入：后者可能少了冒号、
  // 用了全角字符或多了标点，交给游戏库的原始子串搜索会变成 0 条。
  const queryForLibrary = exactGame.value?.title ?? trimmed.value
  // 先清掉首页可能残留的年份 / 作者 / 系列筛选，否则加上关键词后
  // 很容易得到一个「明明站内有、却显示 0 条」的空结果。
  clearFilters()
  setSearchQuery(queryForLibrary)
  // 这次是「跳去游戏库」，不是普通关闭：别让 close() 把焦点还给定位于上方
  // 的触发按钮，否则浏览器会把刚滚下去的页面又拉回去。
  previousFocus = null
  close()
  void nextTick(() => {
    if (typeof document === 'undefined') return
    document.getElementById('library')?.scrollIntoView({ block: 'start' })
    document.getElementById('library-search')?.focus({ preventScroll: true })
  })
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-overlay/70 px-4 py-10"
      @click.self="close"
    >
      <div
        ref="panelRef"
        class="w-full max-w-[720px] border border-ink bg-paper text-ink"
        role="dialog"
        aria-modal="true"
        aria-labelledby="resource-request-dialog-title"
        aria-describedby="resource-request-dialog-desc"
        tabindex="-1"
      >
        <header class="flex items-start justify-between gap-6 border-b border-ink px-6 py-5 md:px-8">
          <div>
            <p class="swiss-meta text-ink/45">Resource Request</p>
            <h2
              id="resource-request-dialog-title"
              class="mt-2 font-sans text-2xl font-bold uppercase tracking-tight"
            >
              催一个资源
            </h2>
            <p id="resource-request-dialog-desc" class="mt-3 max-w-[56ch] font-sans text-xs leading-relaxed text-ink/60">
              先搜一下站内是否已经收录。没有的话再提交，管理员会优先处理催的人多的资源。
            </p>
          </div>
          <button
            type="button"
            class="shrink-0 border border-ink bg-paper px-3 py-2 font-sans text-sm leading-none transition-colors duration-150 ease-out hover:bg-ink hover:text-paper"
            aria-label="关闭催资源对话框"
            @click="close"
          >
            ×
          </button>
        </header>

        <div class="px-6 py-6 md:px-8">
          <form @submit.prevent="handleSubmit">
            <div class="flex items-end justify-between gap-4">
              <label
                for="resource-request-input"
                class="font-sans text-[11px] font-bold uppercase tracking-[0.16em]"
              >
                想要什么资源？
              </label>
              <span class="swiss-meta shrink-0 text-ink/45">
                {{ query.length }}/{{ RESOURCE_REQUEST_LIMITS.titleMax }}
              </span>
            </div>

            <input
              id="resource-request-input"
              ref="inputRef"
              v-model="query"
              type="text"
              autocomplete="off"
              :maxlength="RESOURCE_REQUEST_LIMITS.titleMax"
              placeholder="例如：Jolly 4、Popgoes 2、一款 FNAF 同人 RPG"
              class="mt-3 w-full rounded-none border border-ink bg-paper px-4 py-3 font-sans text-sm text-ink transition-colors duration-150 ease-out placeholder:text-ink/35 focus:border-accent focus:outline-none"
            />

            <!-- 0–1 个字符时先不搜，避免整页都是无关结果 -->
            <p v-if="query.length > 0 && !canSearch" class="mt-3 font-sans text-xs text-ink/50">
              再输入至少 1 个字符开始搜索。
            </p>
            <p
              v-else-if="canSearch && !hasMeaningfulTitle"
              class="mt-3 font-sans text-xs text-ink/50"
            >
              请至少输入一个文字或数字。
            </p>

            <!-- 站内已收录：只给链接，不提供提交按钮 -->
            <section
              v-if="exactGame"
              class="mt-6 border border-accent bg-accent-surface px-5 py-5 text-on-accent"
              aria-live="polite"
            >
              <p class="swiss-meta opacity-70">站内已收录</p>
              <h3 class="mt-2 font-sans text-xl font-bold uppercase tracking-tight">
                {{ exactGame.title }}
              </h3>
              <p class="mt-2 font-sans text-xs leading-relaxed opacity-80">
                {{ exactGame.releaseYear }} · {{ exactGame.author }} · {{ exactGame.ipSeries }}
              </p>
              <RouterLink
                :to="{ name: 'game', params: { id: exactGame.id } }"
                class="group mt-4 inline-flex items-center gap-3 font-sans text-[11px] font-bold uppercase tracking-[0.16em] text-on-accent"
                @click="close"
              >
                <span>打开详情</span>
                <span class="u-arrow" aria-hidden="true">&#8594;</span>
              </RouterLink>
            </section>

            <section v-else-if="searchResults.length > 0" class="mt-6 border border-ink" aria-live="polite">
              <p class="border-b border-ink px-4 py-3 font-sans text-[11px] font-bold uppercase tracking-[0.16em]">
                站内可能相关
              </p>
              <ul class="divide-y divide-line">
                <li v-for="game in searchResults" :key="game.id">
                  <RouterLink
                    :to="{ name: 'game', params: { id: game.id } }"
                    class="group flex items-start justify-between gap-4 px-4 py-3 transition-colors duration-150 ease-out hover:bg-surface"
                    @click="close"
                  >
                    <span class="min-w-0">
                      <span class="block font-sans text-sm font-bold">{{ game.title }}</span>
                      <span class="swiss-meta mt-1 block text-ink/50">
                        {{ game.releaseYear }} · {{ game.author }} · {{ game.ipSeries }}
                      </span>
                    </span>
                    <span
                      class="shrink-0 font-sans text-[11px] font-bold uppercase tracking-[0.14em] text-accent"
                    >
                      在站内查看 &#8594;
                    </span>
                  </RouterLink>
                </li>
              </ul>
            </section>

            <div v-if="searchResults.length > 0 || exactGame" class="mt-4">
              <button
                type="button"
                class="border border-ink bg-paper px-4 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:border-accent hover:bg-accent-surface hover:text-on-accent"
                @click="filterInLibrary"
              >
                在游戏库中筛选
              </button>
            </div>

            <!-- 已有同标题请求：只加一票，不重复建条目 -->
            <section v-if="existingRequest && !exactGame" class="mt-6 border border-ink bg-surface px-5 py-4">
              <div class="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p class="font-sans text-sm font-bold">
                    已有 {{ existingRequest.votes }} 人催过《{{ existingRequest.title }}》
                  </p>
                  <p class="mt-1 font-sans text-xs text-ink/55">
                    同一浏览器对同一资源只计一次。
                  </p>
                </div>
                <button
                  type="button"
                  class="group inline-flex items-center gap-3 border border-accent bg-accent-surface px-4 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.14em] text-on-accent transition-colors duration-150 ease-out hover:border-ink hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:border-line disabled:bg-surface disabled:text-ink/45"
                  :disabled="isVoted || isVotePending"
                  :aria-label="`为《${existingRequest.title}》加一票`"
                  @click="handleVoteExisting"
                >
                  <span v-if="isVotePending">…</span>
                  <span v-else-if="isVoted">你已催过</span>
                  <span v-else>+1 催</span>
                </button>
              </div>
              <p v-if="voteMessage" class="mt-3 font-sans text-xs font-bold text-accent" role="status">
                {{ voteMessage }}
              </p>
            </section>

            <p
              v-if="submitError"
              class="mt-5 border-l-4 border-accent bg-accent-surface px-4 py-3 font-sans text-xs font-bold text-on-accent"
              role="alert"
            >
              {{ submitError }}
            </p>

            <div
              v-if="successMessage"
              class="mt-6 border border-accent bg-accent-surface px-5 py-5 text-on-accent"
              role="status"
            >
              <p class="swiss-meta opacity-70">已记录</p>
              <p class="mt-2 font-sans text-sm font-bold leading-relaxed">
                {{ successMessage }}
              </p>
              <button
                type="button"
                class="mt-4 border border-on-accent px-4 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:bg-on-accent hover:text-accent-surface"
                @click="close"
              >
                完成
              </button>
            </div>

            <div
              v-if="!exactGame && !existingRequest && !submitResult"
              class="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5"
            >
              <p class="max-w-[42ch] font-sans text-[11px] leading-relaxed text-ink/50">
                提交前请确认站内确实没有；重复标题会自动合并为同一请求。
              </p>
              <button
                type="submit"
                class="group inline-flex items-center gap-3 border border-ink bg-ink px-5 py-3 font-sans text-[11px] font-bold uppercase tracking-[0.16em] text-paper transition-colors duration-150 ease-out hover:border-accent hover:bg-accent-surface hover:text-on-accent disabled:cursor-not-allowed disabled:border-line disabled:bg-surface disabled:text-ink/35"
                :disabled="!canSubmit"
              >
                <span>{{ isSubmitting ? '正在提交…' : submitLabel }}</span>
                <span v-if="!isSubmitting" class="u-arrow" aria-hidden="true">&#8594;</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </Teleport>
</template>
