<script setup lang="ts">
/**
 * AdminEditorSection —— 编辑页区块外壳
 *
 * 统一「标题 + 区块头右侧状态」这一层重复结构：
 *   - 已接入的区块：右侧显示「已修改 / 未修改」
 *   - 待接入的区块：右侧显示「Phase N 接入」，且边框降为辅助灰
 *     （已接入的区块用黑边框，未接入的用 #cccccc —— 一眼能看出哪些是能用的）
 *
 * 抽出来的直接原因：编辑页已经有 5 个区块，Phase 8 / 9 还要再加；
 * 与其把这段标记抄 7 遍，不如让「区块长什么样」只有一处定义。
 */
withDefaults(
  defineProps<{
    title: string
    /** 该区块是否有未保存改动 */
    changed?: boolean
    /** 传了就是「待接入」，值形如 'Phase 8' */
    pending?: string
  }>(),
  { changed: false, pending: '' },
)
</script>

<template>
  <section :class="pending ? 'border border-[#cccccc]' : 'border border-black'">
    <header
      class="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4"
      :class="pending ? 'border-[#cccccc]' : 'border-black'"
    >
      <h2 class="swiss-meta font-bold">{{ title }}</h2>

      <span v-if="pending" class="swiss-meta text-black/40">{{ pending }} 接入</span>
      <span
        v-else
        class="swiss-meta"
        :class="changed ? 'font-bold text-[#ff0000]' : 'text-black/40'"
      >
        {{ changed ? '已修改' : '未修改' }}
      </span>
    </header>

    <div class="px-6 py-6">
      <slot />
    </div>
  </section>
</template>
