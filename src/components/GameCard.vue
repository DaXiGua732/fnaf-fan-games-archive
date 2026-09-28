<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import Card from './Card.vue'
import type { Game } from '../types/game'
import { assetUrl } from '../utils/asset'

/**
 * GameCard —— 游戏网格单元
 *
 * Swiss 约束：
 *  - 复用 Card 基础组件：默认白底 + 黑边框，直角无阴影
 *  - 悬停：左边框 4px 变 #ff0000、底色转 #f9f9f9，唯一动效是箭头右移
 *  - 排版：顶部封面图 → 大字标题 → 小字「年份 · 作者」（全大写）
 */
const props = defineProps<{ game: Game }>()

const cover = computed(() => assetUrl(props.game.coverImage))
</script>

<template>
  <RouterLink
    :to="{ name: 'game', params: { id: game.id } }"
    class="block focus:outline-none"
    :aria-label="`查看 ${game.title} 详情`"
  >
    <Card interactive>
      <template #media>
        <div class="aspect-[16/9] w-full bg-[#f9f9f9]">
          <img
            :src="cover"
            :alt="`${game.title} 封面`"
            loading="lazy"
            decoding="async"
            class="h-full w-full object-cover"
          />
        </div>
      </template>

      <h3 class="font-sans text-xl font-bold uppercase leading-tight tracking-[-0.01em]">
        {{ game.title }}
      </h3>

      <p class="swiss-meta mt-4 text-black/60">
        {{ game.releaseYear }} · {{ game.author }}
      </p>

      <template #footer>
        <div class="flex items-center justify-between gap-4">
          <span class="swiss-meta text-black/60">{{ game.ipSeries }}</span>
          <span class="u-arrow font-sans text-base leading-none" aria-hidden="true">&#8594;</span>
        </div>
      </template>
    </Card>
  </RouterLink>
</template>
