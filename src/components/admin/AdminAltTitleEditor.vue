<script setup lang="ts">
import { ref, watch } from 'vue'
import { useAdminGameDraftContext } from '../../composables/useAdminGameDraft'
import { ALT_TITLE_LIMITS, normalizeAltTitle } from '../../types/admin'

/**
 * AdminAltTitleEditor —— 其他名称录入
 *
 * 其他名称参与搜索，但不是索引维度（Phase 3 不会为它生成索引入口）。
 * 与标签的区别：它不折叠成小写、不参与分类治理，纯粹是「同一个作品的名字」。
 *
 * 上限与归一化都在深模块里；本组件只负责交互与即时反馈。
 */
const props = defineProps<{ error?: string }>()

const { draftAltTitles, addAltTitle, removeAltTitle, canAddAltTitle } =
  useAdminGameDraftContext()

const input = ref('')
const notice = ref('')

watch(draftAltTitles, () => {
  notice.value = ''
})

function submit(): void {
  const title = normalizeAltTitle(input.value)
  notice.value = ''
  if (!title) return

  if (draftAltTitles.value.some((item) => item.toLocaleLowerCase() === title.toLocaleLowerCase())) {
    notice.value = `「${title}」已经在本条作品上了`
    return
  }
  if (!canAddAltTitle.value) {
    notice.value = `最多只能有 ${ALT_TITLE_LIMITS.maxPerGame} 个其他名称，请先移除一些`
    return
  }
  if (!addAltTitle(title)) {
    notice.value = `单个其他名称不能超过 ${ALT_TITLE_LIMITS.maxLength} 个字符`
    return
  }
  input.value = ''
}
</script>

<template>
  <div>
    <div v-if="draftAltTitles.length" class="flex flex-wrap gap-3">
      <span
        v-for="title in draftAltTitles"
        :key="title"
        class="inline-flex items-center gap-3 border border-line bg-white px-3 py-2 font-sans text-[11px] font-bold tracking-[0.06em]"
      >
        <span>{{ title }}</span>
        <button
          type="button"
          class="cursor-pointer text-black/50 transition-colors duration-150 ease-out hover:text-accent"
          :aria-label="`移除其他名称 ${title}`"
          @click="removeAltTitle(title)"
        >
          ×
        </button>
      </span>
    </div>
    <p v-else class="swiss-meta text-black/35">还没有其他名称</p>

    <div class="mt-5 flex flex-wrap items-stretch gap-3">
      <input
        id="f-alt-title-input"
        v-model="input"
        type="text"
        autocomplete="off"
        placeholder="例如：缩写、旧标题、日文标题"
        :maxlength="ALT_TITLE_LIMITS.maxLength"
        class="min-w-[220px] flex-1 rounded-none border border-black bg-white px-4 py-3 font-sans text-sm transition-colors duration-150 ease-out placeholder:text-black/35 focus:border-accent focus:outline-none"
        @keyup.enter="submit"
      />
      <button
        type="button"
        class="rounded-none border border-black bg-white px-6 py-3 font-sans text-[11px] font-bold uppercase tracking-[0.16em] transition-colors duration-150 ease-out hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:border-line disabled:text-black/30 disabled:hover:bg-white disabled:hover:text-black/30"
        :disabled="!normalizeAltTitle(input) || !canAddAltTitle"
        @click="submit"
      >
        添加
      </button>
    </div>

    <p v-if="notice" class="mt-3 font-sans text-xs text-accent" role="alert">{{ notice }}</p>
    <p v-else-if="props.error" class="mt-3 font-sans text-xs text-accent" role="alert">
      {{ props.error }}
    </p>
    <p v-else class="mt-3 font-sans text-xs text-black/45">
      {{ draftAltTitles.length }} / {{ ALT_TITLE_LIMITS.maxPerGame }} 个 · 会参与前台搜索
    </p>
  </div>
</template>
