<script setup lang="ts">
import { computed } from 'vue'
import { useAdminGameDraftContext } from '../../composables/useAdminGameDraft'
import type { AdminGame } from '../../types/admin'
import { assetUrl } from '../../utils/asset'
import { formatTimestamp } from '../../utils/datetime'
import AdminStatusTag from './AdminStatusTag.vue'

/**
 * AdminPublishOverview —— 右栏的「发布概览」
 *
 * 参考 YouTube Studio 的发布面板：把「这条内容现在长什么样、能不能发、上次什么时候保存」
 * 收在一张卡里，而不是让人在长表单里来回找。
 *
 * 这里**不重复校验逻辑**：上线缺口仍然由 useAdminGameDraft.publishIssues 负责。
 * 本组件只把三件硬性条件（封面 / Banner / 下载渠道）摊开成清单，
 * 让人一眼看到「还差什么」，而不是等到点发布才被拦。
 *
 * Swiss：1px 边框、零圆角、零阴影；完成态用实心方块，缺失态用空心方块。
 */
const props = defineProps<{
  /** 已保存的条目；新增模式为 undefined */
  game?: AdminGame
  isNew: boolean
}>()

const emit = defineEmits<{ preview: [] }>()

const { draft, publishIssues } = useAdminGameDraftContext()

const readiness = computed(() => [
  { label: '封面图', ok: Boolean(draft.coverImage) },
  { label: 'Banner 宣传图', ok: Boolean(draft.bannerImage) },
  { label: '至少一个下载渠道', ok: draft.downloads.length > 0 },
])

const readyCount = computed(() => readiness.value.filter((item) => item.ok).length)
const ready = computed(() => readyCount.value === readiness.value.length)

const cover = computed(() => (draft.coverImage ? assetUrl(draft.coverImage) : ''))

const lastSaved = computed(() => {
  if (props.isNew || !props.game) return '尚未保存'
  return formatTimestamp(props.game.updatedAt) === '—'
    ? '尚未保存'
    : formatTimestamp(props.game.updatedAt)
})
</script>

<template>
  <section class="border border-black">
    <header class="flex items-center justify-between gap-3 border-b border-black px-5 py-4">
      <h2 class="swiss-meta font-bold">发布概览</h2>
      <p class="swiss-meta" :class="ready ? 'text-black/45' : 'font-bold text-[#ff0000]'">
        上线准备 {{ readyCount }} / {{ readiness.length }}
      </p>
    </header>

    <div class="px-5 py-5">
      <!-- 封面预览 -->
      <div class="border border-[#cccccc] bg-[#f9f9f9]">
        <img
          v-if="cover"
          :src="cover"
          :alt="`${draft.title || '未命名作品'} 封面预览`"
          class="aspect-video w-full object-cover"
        />
        <div v-else class="flex aspect-video items-center justify-center">
          <span class="swiss-meta text-black/35">尚未设置封面</span>
        </div>
      </div>

      <p class="mt-4 font-sans text-base font-bold leading-snug">
        {{ draft.title || '未命名作品' }}
      </p>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <AdminStatusTag :status="draft.status" :archived="draft.archived" />
        <span v-if="draft.featured" class="border border-[#cccccc] px-2 py-1 font-sans text-[10px] font-bold uppercase tracking-[0.1em]">
          推荐
        </span>
      </div>

      <!-- 上线清单 -->
      <div class="mt-6 border-t border-[#cccccc] pt-5">
        <p class="swiss-meta text-black/60">上线清单</p>
        <ul class="mt-3 flex flex-col gap-3">
          <li
            v-for="item in readiness"
            :key="item.label"
            class="flex items-center gap-3 font-sans text-xs"
          >
            <span
              class="inline-block h-3 w-3 shrink-0 border border-black"
              :class="item.ok ? 'bg-black' : 'bg-white'"
              aria-hidden="true"
            />
            <span :class="item.ok ? 'text-black' : 'text-black/50'">
              {{ item.label }}
            </span>
            <span class="ml-auto swiss-meta" :class="item.ok ? 'text-black/45' : 'text-[#ff0000]'">
              {{ item.ok ? '已完成' : '缺失' }}
            </span>
          </li>
        </ul>

        <p
          v-if="draft.status === 'published' && publishIssues.length"
          class="mt-4 font-sans text-xs leading-relaxed text-[#ff0000]"
        >
          当前是「已上线」状态，但还差 {{ publishIssues.length }} 项——保存会被拦下。
        </p>
      </div>

      <!-- 操作与保存信息 -->
      <div class="mt-6 border-t border-[#cccccc] pt-5">
        <button
          type="button"
          class="group inline-flex w-full items-center justify-between gap-3 border border-black bg-white px-4 py-3 font-sans text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:bg-black hover:text-white"
          @click="emit('preview')"
        >
          <span>查看草稿效果</span>
          <span class="u-arrow" aria-hidden="true">&#8594;</span>
        </button>

        <dl class="mt-5 flex flex-col gap-2">
          <div class="flex items-baseline justify-between gap-4">
            <dt class="swiss-meta text-black/45">上次保存</dt>
            <dd class="font-sans text-xs tabular-nums text-black/70">{{ lastSaved }}</dd>
          </div>
          <div v-if="!isNew && game?.updatedBy" class="flex items-baseline justify-between gap-4">
            <dt class="swiss-meta text-black/45">操作者</dt>
            <dd class="font-sans text-xs text-black/70">{{ game.updatedBy }}</dd>
          </div>
          <div v-if="!isNew && game" class="flex items-baseline justify-between gap-4">
            <dt class="swiss-meta text-black/45">作品 ID</dt>
            <dd class="font-sans text-xs text-black/70">{{ game.id }}</dd>
          </div>
        </dl>
      </div>
    </div>
  </section>
</template>
