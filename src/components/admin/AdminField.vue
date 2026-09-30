<script setup lang="ts">
/**
 * AdminField —— 表单字段外壳
 *
 * 只负责「标签 + 控件插槽 + 错误/提示」这一层重复结构，
 * 控件本身由调用方通过默认插槽传入（input / textarea / select 都行）。
 *
 * 视觉约束：错误提示用强调红文字，**不用红边框、不用底色块** ——
 * 保持直角 + 1px 边框的一致语言，同时不让表单变成一片彩色警示。
 */
withDefaults(
  defineProps<{
    /** 字段名 */
    label: string
    /** 关联控件的 id，用于 label[for] 与无障碍 */
    controlId?: string
    /** 必填字段：标签后加红色星号 */
    required?: boolean
    /** 错误文案；空字符串表示通过 */
    error?: string
    /** 通过时的辅助说明 */
    hint?: string
  }>(),
  {
    controlId: undefined,
    required: false,
    error: '',
    hint: '',
  },
)
</script>

<template>
  <div>
    <label class="swiss-meta mb-2 flex items-baseline gap-2 text-black/60" :for="controlId">
      <span>{{ label }}</span>
      <span v-if="required" class="text-[#ff0000]" aria-hidden="true">*</span>
    </label>

    <slot />

    <p v-if="error" class="mt-2 font-sans text-xs leading-relaxed text-[#ff0000]" role="alert">
      {{ error }}
    </p>
    <p v-else-if="hint" class="mt-2 font-sans text-xs leading-relaxed text-black/45">
      {{ hint }}
    </p>
  </div>
</template>
