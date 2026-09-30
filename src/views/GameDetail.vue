<script setup lang="ts">
import { computed, inject, watchEffect } from 'vue'
import { RouterLink } from 'vue-router'
import Button from '../components/Button.vue'
import CommentSection from '../components/CommentSection.vue'
import DownloadPanel from '../components/DownloadPanel.vue'
import { useGameLibrary } from '../composables/useGameLibrary'
import { PREVIEW_GAME_KEY } from '../composables/useGamePreview'
import { useViewCounter } from '../composables/useViewCounter'
import { assetUrl } from '../utils/asset'

/* 游戏详情页。id 由路由 /game/:id 以 props 形式注入（router 中 props: true）。 */
const props = defineProps<{ id: string }>()

const { getGameById } = useGameLibrary()

/**
 * 预览分支（Phase 18）。
 *
 * 后台的「预览」路由会注入一条**未保存的草稿** —— 这时本页渲染的就是它，
 * 而不是资源库里那条已发布的数据。
 *
 * 关键在于：预览**复用本组件本身**，而不是另写一个"像前台"的预览页。
 * 另写一份的话，预览跟真实前台迟早会分叉 —— 那预览就失去意义了。
 * 没有注入时（也就是全部公开访问）这里恒为 null，行为与从前一模一样。
 */
const previewSource = inject(PREVIEW_GAME_KEY, null)
const previewGame = computed(() => previewSource?.value ?? null)

const game = computed(() => previewGame.value ?? getGameById(props.id))

const banner = computed(() => (game.value ? assetUrl(game.value.bannerImage) : ''))

/**
 * 浏览量统计。
 * 当前为「静态基数」模式（未接入后端），显示的仍是 db.json 里的 metrics.fakeViews。
 * 接入后端后在 main.ts 里 registerViewProvider() 即可自动切换，本页无需改动。
 */
const {
  count: viewCount,
  source: viewSource,
  isLoading: viewsLoading,
} = useViewCounter(
  () => props.id,
  () => game.value?.metrics.fakeViews ?? 0,
)

/** 侧边栏数据表格的行定义 */
const facts = computed(() => {
  const item = game.value
  if (!item) return []
  return [
    { label: '作者', value: item.author },
    { label: '年份', value: String(item.releaseYear) },
    { label: 'IP 系列', value: item.ipSeries },
    { label: '引擎', value: item.engine },
    { label: '下载渠道', value: `${item.downloads.length} 个` },
    { label: '评分', value: `${item.metrics.score.toFixed(1)} / 5.0` },
  ]
})

const hasVideo = computed(() => Boolean(game.value?.videoUrl))

// 标签页标题跟随游戏名（SSR 环境没有 document，必须守卫）
watchEffect(() => {
  if (typeof document === 'undefined') return
  const item = game.value
  document.title = item ? `${item.title} · FNAF FAN GAMES ARCHIVE` : 'FNAF FAN GAMES ARCHIVE'
})
</script>

<template>
  <!-- ==================== 命中 ==================== -->
  <div v-if="game">
    <!-- 大字标题区 -->
    <section class="border-b border-black">
      <div class="mx-auto max-w-[1280px] px-6 py-16 md:px-12 md:py-20">
        <RouterLink
          to="/"
          class="inline-flex items-center gap-3 font-sans text-[11px] font-bold uppercase tracking-[0.16em] text-black/60 transition-colors duration-150 ease-out hover:text-[#ff0000]"
        >
          <span aria-hidden="true">&#8592;</span>
          <span>返回游戏库</span>
        </RouterLink>

        <p class="swiss-meta mt-12 text-black/60">
          {{ game.releaseYear }} · {{ game.author }} · {{ game.ipSeries }}
        </p>
        <h1
          class="mt-6 font-sans text-4xl font-bold uppercase leading-[0.95] tracking-[-0.03em] md:text-6xl lg:text-7xl"
        >
          {{ game.title }}
        </h1>

        <p class="swiss-meta mt-10 text-black/60" aria-live="polite">
          <span v-if="viewsLoading">浏览统计载入中…</span>
          <span v-else>
            浏览 {{ (viewCount ?? 0).toLocaleString('en-US') }}
            <span v-if="viewSource === 'static'" class="ml-2 text-black/35">静态基数</span>
          </span>
        </p>
      </div>
    </section>

    <!-- Banner / 多媒体区（占满内容宽度） -->
    <section class="border-b border-black">
      <div class="mx-auto max-w-[1280px] px-6 py-12 md:px-12 md:py-16">
        <figure>
          <img
            :src="banner"
            :alt="`${game.title} 宣传图`"
            class="w-full border border-black"
            loading="eager"
            decoding="async"
          />
          <figcaption class="swiss-meta mt-4 text-black/60">
            宣传图 — {{ game.title }}
          </figcaption>
        </figure>
      </div>
    </section>

    <!-- 简介 + 数据表格侧边栏 -->
    <section class="border-b border-black">
      <div class="mx-auto max-w-[1280px] px-6 py-16 md:px-12 md:py-24">
        <div class="grid gap-16 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-20">
          <!-- 左：简介 -->
          <div>
            <p class="swiss-meta mb-8">01 — 作品简介</p>
            <p class="max-w-[68ch] font-sans text-base leading-loose">{{ game.description }}</p>

            <div v-if="hasVideo" class="mt-14">
              <p class="swiss-meta mb-6 text-black/60">实况 / 预告</p>
              <Button variant="outline" :href="game.videoUrl" target="_blank">观看视频</Button>
            </div>
          </div>

          <!-- 右：数据表格（网格线分割） -->
          <aside>
            <p class="swiss-meta mb-8">02 — 作品信息</p>
            <table class="w-full border-collapse border border-black text-left">
              <tbody>
                <tr
                  v-for="fact in facts"
                  :key="fact.label"
                  class="border-b border-[#cccccc]"
                >
                  <th
                    class="swiss-meta w-[42%] border-r border-[#cccccc] px-4 py-4 align-top font-normal text-black/60"
                  >
                    {{ fact.label }}
                  </th>
                  <td class="px-4 py-4 font-sans text-sm font-bold">{{ fact.value }}</td>
                </tr>
              </tbody>
            </table>

            <p class="mt-6 font-sans text-xs leading-relaxed text-black/50">
              评分与浏览量为社区维护的参考值，非官方数据。浏览量为静态基数时表示尚未接入后端统计服务。
            </p>
          </aside>
        </div>
      </div>
    </section>

    <!-- 下载核心区 -->
    <section class="border-b border-black">
      <div class="mx-auto max-w-[1280px] px-6 py-16 md:px-12 md:py-24">
        <p class="swiss-meta mb-8">03 — 资源下载</p>
        <DownloadPanel :downloads="game.downloads" />
      </div>
    </section>

    <!-- 评论区（页面底部） -->
    <section>
      <div class="mx-auto max-w-[1280px] px-6 py-16 md:px-12 md:py-24">
        <p class="swiss-meta mb-8">04 — 讨论</p>
        <CommentSection :term="game.id" />
      </div>
    </section>
  </div>

  <!-- ==================== 未命中 ==================== -->
  <div v-else>
    <section class="bg-[#ff0000] text-white">
      <div class="mx-auto max-w-[1280px] px-6 py-24 md:px-12 md:py-32">
        <p class="swiss-meta mb-8">Error 404 — Game Not Found</p>
        <h1
          class="font-sans text-4xl font-bold uppercase leading-[0.95] tracking-[-0.03em] md:text-6xl"
        >
          没有这个游戏
        </h1>
        <p class="mt-10 max-w-[56ch] font-sans text-base leading-relaxed text-white/90">
          资源库中没有 id 为 <span class="font-bold tracking-[0.2em]">{{ id }}</span> 的条目。
          可能是链接已失效，或者这个作品还没有被收录。
        </p>
      </div>
    </section>

    <section>
      <div class="mx-auto max-w-[1280px] px-6 py-20 md:px-12">
        <RouterLink
          to="/"
          class="group inline-flex items-center gap-4 border border-black bg-black px-8 py-4 font-sans text-xs font-bold uppercase tracking-[0.16em] text-white transition-colors duration-150 ease-out hover:border-[#ff0000] hover:bg-[#ff0000]"
        >
          <span>返回游戏库</span>
          <span class="u-arrow" aria-hidden="true">&#8594;</span>
        </RouterLink>
      </div>
    </section>
  </div>
</template>
