<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useAdminGameDraftContext } from '../../composables/useAdminGameDraft'
import { useVocabulary } from '../../composables/useVocabulary'
import {
  GAME_VOCABULARY_LIMITS,
  VOCABULARY_LABELS,
  type VocabularyCollection,
} from '../../types/taxonomy'

/**
 * AdminVocabularyPicker —— 受控词条多选（玩法类型 / 机制 / 平台）
 *
 * 编辑的是**草稿**，点保存才生效。规则全部在深模块里：
 *   - 只接受词表里已有的词条（不能在作品编辑器里顺手新建分类）；
 *   - 数量上限见 GAME_VOCABULARY_LIMITS；
 *   - 玩法类型的第一项是「主要玩法」，顺序有意义。
 *
 * 视觉沿用后台的直角 chip 语言：已选用墨色底，可选项用 1px 边框。
 */
const props = withDefaults(
  defineProps<{
    collection: VocabularyCollection
    /** 玩法类型需要「主要 / 设为主要」 */
    primary?: boolean
    /** 该组的校验错误（超限 / 失效引用） */
    error?: string
    /** 空列表文案 */
    emptyLabel?: string
  }>(),
  { primary: false, error: '', emptyLabel: '' },
)

const {
  draftVocabulary,
  addVocabularyValue,
  removeVocabularyValue,
  setPrimaryGameplayType,
  canAddVocabulary,
} = useAdminGameDraftContext()
const { availableEntries, entryName } = useVocabulary()

const selected = computed(() => draftVocabulary(props.collection))
const options = computed(() => availableEntries(props.collection, selected.value))
const limit = computed(() => GAME_VOCABULARY_LIMITS[props.collection])
const label = computed(() => VOCABULARY_LABELS[props.collection])
const full = computed(() => !canAddVocabulary(props.collection))

function add(value: string): void {
  addVocabularyValue(props.collection, value)
}
</script>

<template>
  <div>
    <!-- 已选：保持词表顺序；玩法第一项标为「主要」 -->
    <div v-if="selected.length" class="flex flex-wrap gap-3">
      <span
        v-for="(value, index) in selected"
        :key="value"
        class="inline-flex items-center gap-3 border border-ink bg-ink px-3 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.14em] text-paper"
      >
        <span class="inline-flex items-center gap-2">
          <span>{{ entryName(collection, value) }}</span>
          <span v-if="primary && index === 0" class="swiss-meta text-paper/70">主要</span>
        </span>

        <button
          v-if="primary && index > 0"
          type="button"
          class="cursor-pointer text-[10px] font-bold tracking-[0.1em] text-paper/70 underline-offset-2 transition-colors duration-150 ease-out hover:text-paper hover:underline"
          :aria-label="`把「${entryName(collection, value)}」设为主要玩法`"
          @click="setPrimaryGameplayType(value)"
        >
          设为主要
        </button>

        <button
          type="button"
          class="cursor-pointer text-paper/70 transition-colors duration-150 ease-out hover:text-paper"
          :aria-label="`移除${label}「${entryName(collection, value)}」`"
          @click="removeVocabularyValue(collection, value)"
        >
          ×
        </button>
      </span>
    </div>

    <p v-else class="swiss-meta text-black/35">
      {{ emptyLabel || `还没有标注${label}` }}
    </p>

    <!-- 可选：词表里还没被选中的词条 -->
    <div v-if="options.length" class="mt-5">
      <p class="swiss-meta mb-3 text-black/60">可选{{ label }} · 点击添加</p>
      <div class="flex flex-wrap gap-3">
        <button
          v-for="entry in options"
          :key="entry.id"
          type="button"
          class="rounded-none border border-line bg-white px-3 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:border-black disabled:cursor-not-allowed disabled:text-black/25 disabled:hover:border-line"
          :disabled="full"
          @click="add(entry.id)"
        >
          + {{ entry.name }}
        </button>
      </div>
      <p v-if="full" class="mt-3 font-sans text-xs text-black/45">
        已达 {{ limit }} 个上限，先移除一个才能继续添加。
      </p>
    </div>

    <p v-else-if="!selected.length" class="mt-4 font-sans text-xs leading-relaxed text-black/45">
      词表里还没有{{ label }}。<RouterLink
        to="/admin/vocabulary"
        class="font-bold underline underline-offset-2 transition-colors duration-150 ease-out hover:text-accent"
      >
        去「玩法与机制」页新建
      </RouterLink>。
    </p>

    <p class="mt-3 font-sans text-xs text-black/45">{{ selected.length }} / {{ limit }} 个</p>
    <p v-if="error" class="mt-2 font-sans text-xs leading-relaxed text-accent" role="alert">
      {{ error }}
    </p>
  </div>
</template>
