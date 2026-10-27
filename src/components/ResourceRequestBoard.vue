<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useResourceRequests } from '../composables/useResourceRequests'
import { ResourceRequestError } from '../types/resourceRequest'
import { formatTimestamp } from '../utils/datetime'

/**
 * ResourceRequestBoard —— 首页公开的催资源榜单
 *
 * 排序、匹配、投票去重都在 `useResourceRequests` 内完成；本组件只渲染。
 * 「已收录」用**精确标题**判定：请求《Jolly》不会因为站内已有《Jolly 4》而消失。
 */
const emit = defineEmits<{ request: [] }>()

const {
  requests,
  isLoading,
  error,
  pendingRequests,
  fulfilledRequests,
  votedIds,
  pendingVotes,
  usingCache,
  isRemote,
  load,
  refresh,
  vote,
} = useResourceRequests()

const DEFAULT_VISIBLE = 8
const showAll = ref(false)
const voteStatus = ref('')

onMounted(() => {
  void load()
})

const visiblePending = computed(() =>
  showAll.value ? pendingRequests.value : pendingRequests.value.slice(0, DEFAULT_VISIBLE),
)

const modeNote = computed(() => {
  if (!isRemote.value) {
    return '本机模式 · 请求只保存在当前浏览器；配置 Supabase 后可全站共享。'
  }
  if (usingCache.value) {
    return '暂时连不上请求服务，当前显示最近一次缓存。'
  }
  return '全站共享 · 同一浏览器对同一资源只计 1 次。'
})

function rankLabel(index: number): string {
  return String(index + 1).padStart(2, '0')
}

function voteAriaLabel(title: string): string {
  return `为《${title}》加一票，催管理员上传`
}

async function handleVote(id: string, title: string): Promise<void> {
  voteStatus.value = ''
  try {
    const result = await vote(id)
    voteStatus.value = result.added
      ? `已为《${title}》加一票。`
      : `你已经催过《${title}》了。`
  } catch (cause) {
    voteStatus.value =
      cause instanceof ResourceRequestError
        ? cause.message
        : '投票失败了，请稍后再试。'
  }
}
</script>

<template>
  <section id="request-board" class="border-b border-ink">
    <div class="mx-auto max-w-[1280px] px-6 py-16 md:px-12 md:py-24">
      <div class="flex flex-wrap items-start justify-between gap-8">
        <div>
          <p class="swiss-meta mb-8">01 — Resource Requests</p>
          <h2 class="font-sans text-2xl font-bold uppercase tracking-tight">资源请求</h2>
          <p class="mt-5 max-w-[62ch] font-sans text-sm leading-relaxed text-ink/65">
            按催更人数排序；管理员会优先处理呼声高的资源；同一浏览器对同一资源只计一次。
          </p>
        </div>

        <button
          type="button"
          class="group inline-flex shrink-0 items-center gap-3 border border-ink bg-ink px-6 py-3 font-sans text-[11px] font-bold uppercase tracking-[0.16em] text-paper transition-colors duration-150 ease-out hover:border-accent hover:bg-accent-surface hover:text-on-accent"
          @click="emit('request')"
        >
          <span>＋ 催一个资源</span>
          <span class="u-arrow" aria-hidden="true">&#8594;</span>
        </button>
      </div>

      <div class="mt-8 flex flex-wrap items-center justify-between gap-3 border-y border-line py-3">
        <p class="font-sans text-[11px] leading-relaxed text-ink/50" aria-live="polite">{{ modeNote }}</p>
        <button
          v-if="usingCache"
          type="button"
          class="border border-accent bg-paper px-3 py-1.5 font-sans text-[10px] font-bold uppercase tracking-[0.14em] text-accent transition-colors duration-150 ease-out hover:bg-accent-surface hover:text-on-accent disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="isLoading"
          @click="refresh"
        >
          重试
        </button>
      </div>

      <p v-if="isLoading" class="mt-8 font-sans text-xs text-ink/55" aria-live="polite">
        正在读取资源请求…
      </p>

      <div
        v-if="error && !usingCache"
        class="mt-8 border-l-4 border-accent bg-accent-surface px-5 py-4 text-on-accent"
        role="alert"
      >
        <p class="font-sans text-xs font-bold">{{ error }}</p>
        <button
          type="button"
          class="mt-3 border border-on-accent px-4 py-2 font-sans text-[10px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:bg-on-accent hover:text-accent-surface disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="isLoading"
          @click="refresh"
        >
          重试
        </button>
      </div>

      <!-- 空状态 -->
      <div
        v-else-if="!isLoading && requests.length === 0"
        class="mt-8 border border-ink px-6 py-16 md:px-10 md:py-20"
      >
        <p class="font-sans text-xl font-bold uppercase tracking-tight">还没有待上传的资源请求</p>
        <p class="mt-4 max-w-[52ch] font-sans text-sm leading-relaxed text-ink/60">
          找了一圈没有想要的游戏？告诉管理员，催的人越多越靠前。
        </p>
        <button
          type="button"
          class="group mt-8 inline-flex items-center gap-3 border border-ink bg-ink px-6 py-3 font-sans text-[11px] font-bold uppercase tracking-[0.16em] text-paper transition-colors duration-150 ease-out hover:border-accent hover:bg-accent-surface hover:text-on-accent"
          @click="emit('request')"
        >
          <span>催第一个资源</span>
          <span class="u-arrow" aria-hidden="true">&#8594;</span>
        </button>
      </div>

      <!-- 待上传排名 -->
      <div v-if="pendingRequests.length > 0" class="mt-8">
        <ul class="divide-y divide-line border-y border-ink">
          <li
            v-for="(request, index) in visiblePending"
            :key="request.id"
            class="grid gap-4 py-5 sm:grid-cols-[40px_minmax(0,1fr)_auto] sm:items-center"
          >
            <span class="font-sans text-lg font-bold leading-none text-ink/35" aria-hidden="true">
              {{ rankLabel(index) }}
            </span>

            <div class="min-w-0">
              <h3 class="font-sans text-base font-bold leading-snug">
                {{ request.title }}
              </h3>
              <p class="swiss-meta mt-2 text-ink/50">
                {{ request.votes }} 人催 · 提交于 {{ formatTimestamp(request.createdAt) }}
              </p>
            </div>

            <button
              type="button"
              class="justify-self-start border border-ink bg-paper px-4 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:border-accent hover:bg-accent-surface hover:text-on-accent disabled:cursor-not-allowed disabled:border-line disabled:bg-surface disabled:text-ink/45 sm:justify-self-end"
              :disabled="votedIds.has(request.id) || pendingVotes.has(request.id)"
              :aria-label="voteAriaLabel(request.title)"
              @click="handleVote(request.id, request.title)"
            >
              <span v-if="pendingVotes.has(request.id)">…</span>
              <span v-else-if="votedIds.has(request.id)">已催</span>
              <span v-else>+1 催</span>
            </button>
          </li>
        </ul>

        <div
          v-if="pendingRequests.length > DEFAULT_VISIBLE"
          class="mt-4 flex flex-wrap items-center justify-between gap-3"
        >
          <button
            type="button"
            class="border border-ink bg-paper px-4 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:border-accent hover:bg-accent-surface hover:text-on-accent"
            :aria-expanded="showAll"
            @click="showAll = !showAll"
          >
            {{ showAll ? '收起' : `查看全部 ${pendingRequests.length} 条` }}
          </button>
          <p class="swiss-meta text-ink/40">前 {{ DEFAULT_VISIBLE }} 条默认展示</p>
        </div>

        <p v-if="voteStatus" class="mt-4 font-sans text-xs text-ink/60" aria-live="polite">
          {{ voteStatus }}
        </p>
      </div>

      <!-- 已收录 -->
      <details v-if="fulfilledRequests.length > 0" class="mt-10 border-t border-ink pt-6">
        <summary class="cursor-pointer font-sans text-xs font-bold uppercase tracking-[0.14em]">
          已收录 {{ fulfilledRequests.length }} 条 · 展开查看
        </summary>
        <ul class="mt-4 divide-y divide-line border-y border-line">
          <li v-for="item in fulfilledRequests" :key="item.request.id">
            <RouterLink
              :to="{ name: 'game', params: { id: item.game.id } }"
              class="group flex flex-wrap items-baseline justify-between gap-3 py-4 transition-colors duration-150 ease-out hover:text-accent"
            >
              <span class="min-w-0">
                <span class="block font-sans text-sm font-bold">{{ item.game.title }}</span>
                <span class="swiss-meta mt-1 block text-ink/45">
                  原请求《{{ item.request.title }}》 · {{ item.request.votes }} 人催
                </span>
              </span>
              <span class="font-sans text-[11px] font-bold uppercase tracking-[0.14em] text-accent">
                打开详情 &#8594;
              </span>
            </RouterLink>
          </li>
        </ul>
      </details>

      <p class="mt-10 max-w-[72ch] font-sans text-[11px] leading-relaxed text-ink/45">
        排名的依据是不同浏览器的催更次数，不是点击数；同一浏览器对同一资源只计一次。
        当站内出现同名资源后，请求会自动移入「已收录」，不再占用待上传名额。
      </p>
    </div>
  </section>
</template>
