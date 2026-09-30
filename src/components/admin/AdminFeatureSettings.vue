<script setup lang="ts">
import { computed } from 'vue'
import { useAdminGameDraftContext } from '../../composables/useAdminGameDraft'
import AdminField from './AdminField.vue'

/**
 * AdminFeatureSettings —— 「推荐与排序」区块的内容
 *
 * featured 决定是否进首页推荐位；sortOrder 是手动权重（越大越靠前）。
 * 两者都只在保存后生效，和其它字段一致。
 */
const { draft, errors, touched, changedFields } = useAdminGameDraftContext()

/** 与编辑页其它字段同一条规则：提交过、或该字段被改过，才显示错误 */
const sortError = computed(() => {
  if (!errors.value.sortOrder) return ''
  if (touched.value || changedFields.value.includes('sortOrder')) return errors.value.sortOrder
  return ''
})

const CHECKBOX_CLASS =
  'h-4 w-4 shrink-0 cursor-pointer rounded-none border border-black accent-black'

const INPUT_CLASS =
  'w-full rounded-none border border-black bg-white px-4 py-3 font-sans text-sm ' +
  'transition-colors duration-150 ease-out placeholder:text-black/35 focus:border-[#ff0000] focus:outline-none'
</script>

<template>
  <div class="flex flex-col gap-8">
    <AdminField
      label="首页推荐位"
      control-id="f-featured"
      hint="标记后会出现在首页的推荐区域"
    >
      <label class="inline-flex cursor-pointer items-center gap-3">
        <input id="f-featured" v-model="draft.featured" type="checkbox" :class="CHECKBOX_CLASS" />
        <span class="font-sans text-sm">{{ draft.featured ? '已设为推荐' : '未推荐' }}</span>
      </label>
    </AdminField>

    <AdminField
      label="排序权重"
      control-id="f-sort-order"
      :error="sortError"
      hint="整数，越大越靠前；留空表示 0"
    >
      <input
        id="f-sort-order"
        v-model="draft.sortOrder"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        placeholder="0"
        :class="INPUT_CLASS"
        :aria-invalid="Boolean(sortError)"
      />
    </AdminField>
  </div>
</template>
