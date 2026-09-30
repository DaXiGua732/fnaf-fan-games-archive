<script setup lang="ts">
import { computed } from 'vue'
import { STATUS_LABELS } from '../../types/admin'
import type { GameStatus } from '../../types/game'

/**
 * AdminStatusTag —— 状态标记
 *
 * 【视觉约束】后台**不引入任何新颜色**，所以三态不用彩色胶囊（黄 / 绿 / 灰），
 * 而是用同一套黑白灰的**重量梯度**表达：
 *
 *   已上线  黑底白字   ← 最重，代表「正在对外」
 *   草稿    黑框白底   ← 中间，代表「已存在但不对外」
 *   已下线  灰框灰字   ← 最轻，代表「存在但已撤下」
 *
 * 同时对每一态配一个不同形状的方块（实心 / 空心黑 / 空心灰），
 * 这样色觉障碍用户也能区分 —— 不依赖颜色单独承载语义。
 *
 * 归档是**叠加维度**，与状态正交：归档时在状态标记右侧再挂一个「已归档」灰标，
 * 而不是替换状态标记 —— 用户需要同时知道「它是什么状态」和「它被收起来了」。
 */
const props = withDefaults(defineProps<{ status: GameStatus; archived?: boolean }>(), {
  archived: false,
})

const TONES: Record<GameStatus, { box: string; mark: string }> = {
  published: { box: 'border-black bg-black text-white', mark: 'bg-white' },
  draft: { box: 'border-black bg-white text-black', mark: 'border border-black bg-transparent' },
  offline: {
    box: 'border-[#cccccc] bg-white text-black/40',
    mark: 'border border-black/30 bg-transparent',
  },
}

const label = computed(() => STATUS_LABELS[props.status])
const tone = computed(() => TONES[props.status])
</script>

<template>
  <span class="inline-flex flex-wrap items-center gap-2">
    <span
      class="swiss-meta inline-flex items-center gap-2 border px-3 py-1 font-bold whitespace-nowrap"
      :class="tone.box"
    >
      <span class="h-2 w-2 shrink-0" :class="tone.mark" aria-hidden="true" />
      <span>{{ label }}</span>
    </span>

    <span
      v-if="archived"
      class="swiss-meta inline-flex items-center gap-2 border border-[#cccccc] px-3 py-1 font-bold whitespace-nowrap text-black/50"
    >
      <span class="h-2 w-2 shrink-0 bg-black/25" aria-hidden="true" />
      <span>已归档</span>
    </span>
  </span>
</template>
