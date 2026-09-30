<script setup lang="ts">
import { computed } from 'vue'
import { useAdminGameDraftContext } from '../../composables/useAdminGameDraft'
import { STATUS_LABELS } from '../../types/admin'
import type { GameStatus } from '../../types/game'
import AdminField from './AdminField.vue'

/**
 * AdminPublishSettings —— 发布设置
 *
 * 状态三态的含义（对应计划书 §Phase 9）：
 *   draft     后台可见，前台不可见
 *   published 后台可见，前台正常展示
 *   offline   后台保留，前台不展示 —— **下线靠改状态实现，不靠删数据**
 *
 * 归档与状态**正交**：归档只是「收起来」，不改发布状态。
 * 归档一个草稿不该把它变成已下线（那会丢信息）。
 *
 * 这里编辑的仍是**草稿** —— 点「保存」才写入目录；
 * 而列表页的批量操作是**立即生效**的。两种语义都合理（批量是快捷动作、编辑页是完整编辑），
 * 但用的时候要知道区别。
 */
const { draft, publishIssues } = useAdminGameDraftContext()

const STATUS_OPTIONS: { value: GameStatus; hint: string }[] = [
  { value: 'draft', hint: '前台不可见 —— 适合还没准备好的作品' },
  { value: 'published', hint: '前台正常展示' },
  { value: 'offline', hint: '前台不可见，但数据完整保留 —— 下线用它，不要删数据' },
]

const currentHint = computed(
  () => STATUS_OPTIONS.find((option) => option.value === draft.status)?.hint ?? '',
)

function chipClass(active: boolean): string {
  return [
    'rounded-none border px-4 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.14em]',
    'transition-colors duration-150 ease-out',
    active
      ? 'border-[#ff0000] bg-black text-white'
      : 'border-[#cccccc] bg-white text-black hover:border-black',
  ].join(' ')
}

const CHECKBOX_CLASS =
  'h-4 w-4 shrink-0 cursor-pointer rounded-none border border-black accent-black'
</script>

<template>
  <div class="flex flex-col gap-8">
    <!-- ============ 状态 ============ -->
    <AdminField label="状态" hint="发布状态只影响前台的可见性，不会删除任何数据">
      <div class="flex flex-wrap gap-3">
        <button
          v-for="option in STATUS_OPTIONS"
          :key="option.value"
          type="button"
          :class="chipClass(draft.status === option.value)"
          :aria-pressed="draft.status === option.value"
          @click="draft.status = option.value"
        >
          {{ STATUS_LABELS[option.value] }}
        </button>
      </div>
      <p class="swiss-meta mt-3 text-black/45">{{ currentHint }}</p>
    </AdminField>

    <!-- ============ 发布缺口 ============ -->
    <div
      v-if="draft.status === 'published' && publishIssues.length"
      class="border border-[#ff0000] px-5 py-4"
      role="alert"
    >
      <p class="swiss-meta font-bold text-[#ff0000]">还差这些才能上线</p>
      <ul class="mt-3 flex flex-col gap-2">
        <li
          v-for="issue in publishIssues"
          :key="issue"
          class="font-sans text-xs leading-relaxed text-black/70"
        >
          — {{ issue }}
        </li>
      </ul>
      <p class="mt-3 font-sans text-xs leading-relaxed text-black/60">
        草稿状态不受这些限制 —— 内容没凑齐前先留在「草稿」即可。
      </p>
    </div>

    <!-- ============ 归档 ============ -->
    <AdminField
      label="归档"
      control-id="f-archived"
      hint="归档只是「收起来」：默认列表不再显示，但不改发布状态"
    >
      <label class="inline-flex cursor-pointer items-center gap-3">
        <input id="f-archived" v-model="draft.archived" type="checkbox" :class="CHECKBOX_CLASS" />
        <span class="font-sans text-sm">{{ draft.archived ? '已归档' : '未归档' }}</span>
      </label>
    </AdminField>
  </div>
</template>
