<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAdminGameDraftContext } from '../../composables/useAdminGameDraft'
import { useAdminGames } from '../../composables/useAdminGames'
import { TAG_LIMITS, normalizeTag } from '../../types/admin'

/**
 * AdminTagEditor —— 标签录入
 *
 * 编辑的是**草稿**里的 tags（不是直接写目录）—— 点保存才生效，与其它字段一致。
 *
 * 通过 `useAdminGameDraftContext()` 取用编辑页 provide 出来的那一份草稿实例。
 * **不要**在这里再调 `useAdminGameDraft()`：那会造出第二个实例，两边各改各的。
 *
 * 约束（`TAG_LIMITS`）在深模块的 `readTags()` 里收口；本组件只做交互与即时反馈，
 * 不重复实现规则，否则两处的上限迟早会不一致。
 */
const { draftTags, addTag, removeTag, canAddTag } = useAdminGameDraftContext()
const { suggestTags } = useAdminGames()

const input = ref('')
const notice = ref('')

/**
 * 候选：已有标签中、本条作品还没有的；输入了内容则按包含关系过滤。
 * 筛选逻辑在深模块里（视图层禁止手写 .filter()）。
 */
const suggestions = computed(() => suggestTags(input.value, draftTags.value))

// 标签变化后清掉上一次的提示（例如「已达上限」在移除一个标签后就不成立了）
watch(draftTags, () => {
  notice.value = ''
})

function submit(): void {
  const tag = normalizeTag(input.value)
  notice.value = ''

  if (!tag) return
  if (tag.length > TAG_LIMITS.maxLength) {
    notice.value = `单个标签不能超过 ${TAG_LIMITS.maxLength} 个字符`
    return
  }
  if (draftTags.value.includes(tag)) {
    notice.value = `「${tag}」已经在本条作品上了`
    return
  }
  if (!canAddTag.value) {
    notice.value = `最多只能有 ${TAG_LIMITS.maxPerGame} 个标签，请先移除一些`
    return
  }

  addTag(tag)
  input.value = ''
}

function pick(tag: string): void {
  notice.value = ''
  if (!canAddTag.value) {
    notice.value = `最多只能有 ${TAG_LIMITS.maxPerGame} 个标签，请先移除一些`
    return
  }
  addTag(tag)
}
</script>

<template>
  <div>
    <!-- ============ 已选标签 ============ -->
    <div v-if="draftTags.length" class="flex flex-wrap gap-3">
      <span
        v-for="tag in draftTags"
        :key="tag"
        class="inline-flex items-center gap-3 border border-black bg-black px-3 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.14em] text-white"
      >
        <span>{{ tag }}</span>
        <button
          type="button"
          class="cursor-pointer text-white/70 transition-colors duration-150 ease-out hover:text-[#ff0000]"
          :aria-label="`移除标签 ${tag}`"
          @click="removeTag(tag)"
        >
          &#215;
        </button>
      </span>
    </div>
    <p v-else class="swiss-meta text-black/35">本条作品还没有标签</p>

    <!-- ============ 录入 ============ -->
    <div class="mt-6 flex flex-wrap items-stretch gap-3">
      <input
        v-model="input"
        type="text"
        autocomplete="off"
        placeholder="输入标签名后回车，或从下方选择已有标签"
        :maxlength="TAG_LIMITS.maxLength"
        class="min-w-[220px] flex-1 rounded-none border border-black bg-white px-4 py-3 font-sans text-sm transition-colors duration-150 ease-out placeholder:text-black/35 focus:border-[#ff0000] focus:outline-none"
        @keyup.enter="submit"
      />
      <button
        type="button"
        class="rounded-none border border-black bg-white px-6 py-3 font-sans text-[11px] font-bold uppercase tracking-[0.16em] transition-colors duration-150 ease-out hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:border-[#cccccc] disabled:text-black/30 disabled:hover:bg-white disabled:hover:text-black/30"
        :disabled="!normalizeTag(input)"
        @click="submit"
      >
        添加
      </button>
    </div>

    <p v-if="notice" class="mt-3 font-sans text-xs text-[#ff0000]" role="alert">{{ notice }}</p>
    <p v-else class="mt-3 font-sans text-xs text-black/45">
      {{ draftTags.length }} / {{ TAG_LIMITS.maxPerGame }} 个标签 · 输入一个目录里没有的名字即可创建新标签
    </p>

    <!-- ============ 候选 ============ -->
    <div v-if="suggestions.length" class="mt-6">
      <p class="swiss-meta mb-3 text-black/60">已有标签 · 点击添加</p>
      <div class="flex flex-wrap gap-3">
        <button
          v-for="tag in suggestions"
          :key="tag"
          type="button"
          class="rounded-none border border-[#cccccc] bg-white px-3 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:border-black"
          @click="pick(tag)"
        >
          + {{ tag }}
        </button>
      </div>
    </div>
  </div>
</template>
