<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAdminGameDraftContext } from '../../composables/useAdminGameDraft'
import { useAdminGames } from '../../composables/useAdminGames'
import { isPubliclyVisible } from '../../composables/useGameLibrary'
import { STATUS_LABELS } from '../../types/admin'
import { RELATION_LIMITS, type RelationType } from '../../types/game'
import { RELATION_TYPE_OPTIONS, relationLabel } from '../../utils/relations'

/**
 * AdminRelationEditor —— 显式作品关系
 *
 * 关系是**有向边**：这里选择「本作是什么」，目标页的反向文案由关系类型派生。
 * 候选只来自已有作品（不能手输 id），并排除自身与已选目标；草稿 / 下线作品
 * 也可以选，但会明确标注「前台暂不展示」。
 *
 * 校验规则全部复用 `inspectGameRelations()`（与仓储保存前同一套），
 * 本组件只负责交互与逐行展示。
 */
const {
  draftRelations,
  relationRowErrors,
  relationIssues,
  canAddRelation,
  addRelation,
  removeRelation,
  searchRelationTargets,
} = useAdminGameDraftContext()
const { getGameById } = useAdminGames()

const type = ref<RelationType>('sequel')
const needle = ref('')
const notice = ref('')

/** 候选：后台目录全部作品，排除自身与已选；搜索逻辑在深模块里 */
const candidates = computed(() => searchRelationTargets(needle.value))

const rows = computed(() =>
  draftRelations.value.map((relation, index) => {
    const target = getGameById(relation.targetId)
    return {
      relation,
      index,
      target,
      error: relationRowErrors.value[index] ?? '',
      visible: target ? isPubliclyVisible(target) : false,
    }
  }),
)

function add(targetId: string): void {
  notice.value = ''
  const message = addRelation(type.value, targetId)
  if (message) {
    notice.value = message
    return
  }
  needle.value = ''
}
</script>

<template>
  <div>
    <p class="max-w-[78ch] font-sans text-xs leading-relaxed text-black/50">
      关系是<span class="font-bold text-black">有向的</span>：这里选择「本作是目标的什么」，
      目标页会自动显示反向文案（例如本作是「续作」，目标页显示「前传」）。
      目标不必两端各存一条；只保存有资料依据的关系。
    </p>

    <!-- 已选关系 -->
    <ul v-if="rows.length" class="mt-6 divide-y divide-line border border-black">
      <li v-for="row in rows" :key="`${row.relation.type}:${row.relation.targetId}:${row.index}`" class="px-4 py-4">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="min-w-0">
            <p class="swiss-meta text-black/60">{{ relationLabel(row.relation.type) }}</p>
            <p class="mt-1 font-sans text-sm font-bold">
              {{ row.target?.title ?? row.relation.targetId }}
            </p>
            <p v-if="row.target" class="mt-1 font-sans text-xs text-black/50">
              {{ row.target.releaseYear }} · {{ row.target.author }} ·
              {{ STATUS_LABELS[row.target.status] }}
            </p>
            <p
              v-if="row.target && !row.visible"
              class="mt-2 font-sans text-xs text-accent"
            >
              目标当前未上线或已归档 —— 后台保留这条关系，但前台暂不展示。
            </p>
            <p v-if="!row.target" class="mt-2 font-sans text-xs text-accent">
              目标作品已不存在：请移除这条关联。
            </p>
            <p v-if="row.error" class="mt-2 font-sans text-xs leading-relaxed text-accent" role="alert">
              {{ row.error }}
            </p>
          </div>

          <button
            type="button"
            class="shrink-0 font-sans text-[11px] font-bold uppercase tracking-[0.14em] text-accent transition-colors duration-150 ease-out hover:text-black"
            :aria-label="`移除关联 ${row.target?.title ?? row.relation.targetId}`"
            @click="removeRelation(row.index)"
          >
            移除
          </button>
        </div>
      </li>
    </ul>
    <p v-else class="swiss-meta mt-6 text-black/35">本条作品还没有关联作品</p>

    <p
      v-if="relationIssues.length > 0"
      class="mt-4 font-sans text-xs leading-relaxed text-accent"
      role="alert"
    >
      有 {{ relationIssues.length }} 处关联需要修正后才能保存。
    </p>

    <!-- 添加 -->
    <div class="mt-8 border-t border-line pt-6">
      <p class="swiss-meta mb-3 font-bold">添加关联</p>
      <div class="flex flex-wrap items-stretch gap-3">
        <select
          id="relation-type"
          v-model="type"
          class="rounded-none border border-black bg-white px-4 py-3 font-sans text-sm focus:border-accent focus:outline-none"
          aria-label="关系类型"
        >
          <option v-for="option in RELATION_TYPE_OPTIONS" :key="option.type" :value="option.type">
            {{ option.label }}
          </option>
        </select>

        <input
          id="relation-search"
          v-model="needle"
          type="search"
          autocomplete="off"
          placeholder="搜索作品标题 / id / 作者"
          class="min-w-[220px] flex-1 rounded-none border border-black bg-white px-4 py-3 font-sans text-sm transition-colors duration-150 ease-out placeholder:text-black/35 focus:border-accent focus:outline-none"
        />
      </div>

      <p v-if="notice" class="mt-3 font-sans text-xs text-accent" role="alert">{{ notice }}</p>
      <p v-else-if="!canAddRelation" class="mt-3 font-sans text-xs text-accent">
        已达 {{ RELATION_LIMITS.maxPerGame }} 条上限，先移除一条再添加。
      </p>
      <p v-else class="mt-3 font-sans text-xs text-black/45">
        {{ draftRelations.length }} / {{ RELATION_LIMITS.maxPerGame }} 条 · 只能选择已有作品，不能手输 id
      </p>

      <div v-if="candidates.length" class="mt-4 flex flex-wrap gap-2">
        <button
          v-for="candidate in candidates"
          :key="candidate.id"
          type="button"
          class="rounded-none border border-line bg-white px-3 py-2 text-left font-sans text-[11px] font-bold transition-colors duration-150 ease-out hover:border-black disabled:cursor-not-allowed disabled:text-black/25 disabled:hover:border-line"
          :disabled="!canAddRelation"
          @click="add(candidate.id)"
        >
          {{ candidate.title }}
          <span class="ml-2 font-normal text-black/45">
            {{ candidate.releaseYear }} · {{ STATUS_LABELS[candidate.status] }}
          </span>
        </button>
      </div>
      <p v-else class="mt-4 font-sans text-xs text-black/45">
        没有可选作品。换个关键词，或先到作品管理里新建目标作品。
      </p>
    </div>
  </div>
</template>
