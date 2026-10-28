<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref, watchEffect } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import Button from '../components/Button.vue'
import DownloadPanel from '../components/DownloadPanel.vue'
import GalleryLightbox from '../components/GalleryLightbox.vue'
import { useGameLibrary, type FilterCategory } from '../composables/useGameLibrary'
import { PREVIEW_GAME_KEY } from '../composables/useGamePreview'
import { useViewCounter } from '../composables/useViewCounter'
import { DEVELOPMENT_STATUS_LABELS } from '../types/game'
import { assetUrl } from '../utils/asset'
import type { VocabularyCollection } from '../types/taxonomy'
import { resolveVocabularyEntry } from '../utils/taxonomy'
import { scrollToId } from '../utils/scroll'
import {
  relatedWorksFor,
  type RelatedWorks,
} from '../utils/relations'

/**
 * 游戏详情页（参考 itch.io 的信息组织）
 *
 * 结构：
 *   Hero      标题 / 作者 / 短描述 / 主 CTA + 宣传图
 *   两栏      左：简介 + 截图 + 视频；右：封面 / 作品信息 / 标签 / 下载入口
 *   下载      独立区块，锚点可直达
 *
 * 这不是「像 itch.io 那样圆角卡片」—— 视觉仍然全部遵守 Swiss：
 * 1px 边框、零圆角、零阴影、文本左对齐、悬停只改颜色。
 */
const props = defineProps<{ id: string }>()

const router = useRouter()
const {
  getGameById,
  refreshCatalog,
  vocabularyName,
  taxonomy,
  visibleGames,
  setIndexFilter,
  toQueryParams,
} = useGameLibrary()

// 直接打开详情链接 / 从后台预览返回时，同样与数据仓对一次账
function refreshWhenVisible(): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    void refreshCatalog()
  }
}

onMounted(() => {
  void refreshCatalog()
  document.addEventListener('visibilitychange', refreshWhenVisible)
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', refreshWhenVisible)
})

/**
 * 预览分支（Phase 18）：后台注入未保存草稿时渲染它。
 * 复用本组件而不是另写预览页 —— 两份「像前台」的页面迟早会分叉。
 */
const previewSource = inject(PREVIEW_GAME_KEY, null)
const previewGame = computed(() => previewSource?.value ?? null)
const game = computed(() => previewGame.value ?? getGameById(props.id))

const banner = computed(() => (game.value?.bannerImage ? assetUrl(game.value.bannerImage) : ''))
const cover = computed(() => (game.value?.coverImage ? assetUrl(game.value.coverImage) : ''))
const heroImage = computed(() => banner.value || cover.value)
const heroLabel = computed(() => (banner.value ? '宣传图' : '封面'))

const gallery = computed(() => game.value?.gallery ?? [])
const tags = computed(() => game.value?.tags ?? [])
const shortDescription = computed(() => game.value?.shortDescription ?? '')
const hasVideo = computed(() => Boolean(game.value?.videoUrl))

/** 截图查看器：null = 关闭，数字 = 当前下标 */
const galleryOpen = ref<number | null>(null)

/**
 * 浏览量：生产环境由 Abacus 实时计数（见 main.ts）；失败 / 未接入时退回静态基数。
 * 后台预览复用本组件，但预览不算一次公开浏览 —— 否则管理员每看一次预览都在刷量。
 */
const {
  count: viewCount,
  source: viewSource,
  isLoading: viewsLoading,
} = useViewCounter(
  () => props.id,
  () => game.value?.metrics.fakeViews ?? 0,
  { track: () => previewGame.value === null },
)

const viewLabel = computed(() => {
  if (viewsLoading.value) return '载入中…'
  const count = (viewCount.value ?? 0).toLocaleString('en-US')
  return viewSource.value === 'static' ? `${count} · 静态基数` : count
})

interface FactLink {
  text: string
  category: FilterCategory
  /** URL 里使用的值：词条场景是稳定 id，其他场景是原始字符串 */
  value: string
}

interface FactRow {
  label: string
  value?: string
  href?: string
  links?: FactLink[]
}

/** 词条引用 → 可点击链接；无法解析时保留原值，点了会得到「已失效」提示 */
function vocabularyLinks(
  values: string[] | undefined,
  collection: VocabularyCollection,
  category: FilterCategory,
): FactLink[] {
  return (values ?? []).map((value) => ({
    text: vocabularyName(collection, value),
    category,
    value: resolveVocabularyEntry(taxonomy.value, collection, value)?.id ?? value,
  }))
}

/**
 * 侧栏「作品信息」的行定义。
 *
 * Phase 3：作者 / 年份 / IP 系列 / 引擎 / 玩法 / 机制 / 平台都变成索引入口。
 * 点击时**清空其他筛选**，只保留被点的这一项（查询逻辑在 useGameLibrary）。
 */
const facts = computed<FactRow[]>(() => {
  const item = game.value
  if (!item) return []
  const rows: FactRow[] = [
    {
      label: '作者',
      links: [{ text: item.author, category: 'author', value: item.author }],
    },
    {
      label: '年份',
      links: [
        {
          text: String(item.releaseYear),
          category: 'year',
          value: String(item.releaseYear),
        },
      ],
    },
    {
      label: 'IP 系列',
      links: [{ text: item.ipSeries, category: 'series', value: item.ipSeries }],
    },
    {
      label: '引擎',
      links: [{ text: item.engine, category: 'engine', value: item.engine }],
    },
  ]

  if (item.altTitles?.length) {
    rows.push({ label: '又名', value: item.altTitles.join(' / ') })
  }
  if (item.gameplayTypes?.length) {
    rows.push({
      label: '玩法',
      links: vocabularyLinks(item.gameplayTypes, 'gameplayTypes', 'gameplay'),
    })
  }
  if (item.mechanics?.length) {
    rows.push({
      label: '机制',
      links: vocabularyLinks(item.mechanics, 'mechanics', 'mechanic'),
    })
  }
  if (item.platforms?.length) {
    rows.push({
      label: '平台',
      links: vocabularyLinks(item.platforms, 'platforms', 'platform'),
    })
  }
  if (item.developmentStatus && item.developmentStatus !== 'unknown') {
    rows.push({
      label: '开发状态',
      value: DEVELOPMENT_STATUS_LABELS[item.developmentStatus],
    })
  }

  rows.push(
    { label: '评分', value: `${item.metrics.score.toFixed(1)} / 5.0` },
    { label: '浏览', value: viewLabel.value },
    { label: '下载渠道', value: `${item.downloads.length} 个` },
  )

  // 只接受 http(s)：脏数据里的 javascript: 不能变成可点击链接
  if (item.sourceUrl && /^https?:\/\//i.test(item.sourceUrl)) {
    rows.push({ label: '来源', value: item.sourceUrl, href: item.sourceUrl })
  }

  return rows
})

/**
 * 点击属性 → 首页索引结果。
 *
 * 先清空其他条件再 push：从详情页带进一组旧筛选只会让人困惑。
 * 用 push（不是 replace），浏览器后退能回到详情页。
 */
function openIndex(category: FilterCategory, value: string): void {
  setIndexFilter(category, value)
  void router.push({ name: 'home', query: toQueryParams() })
}

/**
 * 相关作品：显式关系 → 同作者 → 同系列，由 relations 模块统一去重与限流。
 * 全部只从 `visibleGames` 派生 —— 草稿 / 下线 / 归档不会经关联模块泄漏。
 */
const related = computed<RelatedWorks>(() => {
  const item = game.value
  return item
    ? relatedWorksFor(visibleGames.value, item)
    : { explicit: [], sameAuthor: [], sameSeries: [] }
})

const hasRelatedWorks = computed(
  () =>
    related.value.explicit.length > 0 ||
    related.value.sameAuthor.length > 0 ||
    related.value.sameSeries.length > 0,
)

const RELATED_SECTIONS = computed(() => [
  { key: 'explicit', title: '关联作品', works: related.value.explicit },
  { key: 'author', title: '同作者的其他作品', works: related.value.sameAuthor },
  { key: 'series', title: '同系列的其他作品', works: related.value.sameSeries },
])

// 标签页标题跟随游戏名（SSR 没有 document，必须守卫）
watchEffect(() => {
  if (typeof document === 'undefined') return
  const item = game.value
  document.title = item ? `${item.title} · FNAF FAN GAMES ARCHIVE` : 'FNAF FAN GAMES ARCHIVE'
})
</script>

<template>
  <!-- ==================== 命中 ==================== -->
  <div v-if="game">
    <!-- ============ Hero：标题 + 主 CTA + 宣传图 ============ -->
    <section class="border-b border-black">
      <div class="mx-auto max-w-[1280px] px-6 py-10 md:px-12 md:py-14">
        <RouterLink
          to="/"
          class="inline-flex items-center gap-3 font-sans text-[11px] font-bold uppercase tracking-[0.16em] text-black/60 transition-colors duration-150 ease-out hover:text-accent"
        >
          <span aria-hidden="true">&#8592;</span>
          <span>返回游戏库</span>
        </RouterLink>

        <div class="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-end lg:gap-14">
          <div>
            <p class="swiss-meta text-black/60">
              {{ game.releaseYear }} · {{ game.ipSeries }}
            </p>
            <h1
              class="mt-5 font-sans text-4xl font-bold uppercase leading-[0.95] tracking-[-0.03em] md:text-6xl"
            >
              {{ game.title }}
            </h1>
            <p class="mt-5 font-sans text-sm text-black/60">
              by <span class="font-bold text-black">{{ game.author }}</span>
            </p>

            <p
              v-if="shortDescription"
              class="mt-6 max-w-[58ch] font-sans text-base leading-relaxed text-black/75"
            >
              {{ shortDescription }}
            </p>

            <div class="mt-8 flex flex-wrap items-center gap-3">
              <Button variant="solid" size="lg" @click="scrollToId('downloads')">查看下载渠道</Button>
              <Button
                v-if="hasVideo"
                variant="outline"
                size="lg"
                :href="game.videoUrl"
                target="_blank"
              >
                观看视频
              </Button>
            </div>

            <p class="swiss-meta mt-8 text-black/45" aria-live="polite">
              浏览 {{ viewLabel }}
            </p>
          </div>

          <!-- 宣传图（没有 banner 时退回封面） -->
          <figure v-if="heroImage" class="border border-black">
            <img
              :src="heroImage"
              :alt="`${game.title} ${heroLabel}`"
              class="aspect-[21/9] w-full bg-surface object-contain"
              loading="eager"
              decoding="async"
            />
            <figcaption class="border-t border-black px-4 py-3 swiss-meta text-black/55">
              {{ heroLabel }} — {{ game.title }}
            </figcaption>
          </figure>
        </div>
      </div>
    </section>

    <!-- ============ 简介 + 截图 + 侧栏 ============ -->
    <section class="border-b border-black">
      <div class="mx-auto max-w-[1280px] px-6 py-12 md:px-12 md:py-16">
        <div class="grid gap-12 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-16">
          <!-- 左：内容 -->
          <div>
            <p class="swiss-meta mb-6 text-black/60">01 — 作品简介</p>
            <p class="max-w-[68ch] whitespace-pre-line font-sans text-base leading-loose">
              {{ game.description }}
            </p>

            <!-- 截图：点击开大图（itch.io 同款浏览方式） -->
            <div v-if="gallery.length" class="mt-14">
              <div class="flex flex-wrap items-end justify-between gap-4 border-b border-black pb-4">
                <h2 class="font-sans text-xl font-bold uppercase tracking-tight">截图</h2>
                <p class="swiss-meta text-black/55">{{ gallery.length }} 张 · 点击查看大图</p>
              </div>

              <ul class="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
                <li v-for="(image, index) in gallery" :key="`${image}-${index}`">
                  <button
                    type="button"
                    class="group block w-full border border-line text-left transition-colors duration-150 ease-out hover:border-black"
                    :aria-label="`查看第 ${index + 1} 张截图的大图`"
                    @click="galleryOpen = index"
                  >
                    <img
                      :src="assetUrl(image)"
                      :alt="`${game.title} 截图 ${index + 1}`"
                      class="aspect-video w-full bg-surface object-contain"
                      loading="lazy"
                      decoding="async"
                    />
                    <span class="flex items-center justify-between gap-3 border-t border-line px-3 py-2">
                      <span class="swiss-meta text-black/50">
                        NO.{{ String(index + 1).padStart(2, '0') }}
                      </span>
                      <span
                        class="swiss-meta text-black/35 transition-colors duration-150 ease-out group-hover:text-accent"
                      >
                        查看大图
                      </span>
                    </span>
                  </button>
                </li>
              </ul>
            </div>

            <!-- 视频 -->
            <div v-if="hasVideo" class="mt-12 border-t border-line pt-8">
              <p class="swiss-meta mb-4 text-black/55">实况 / 预告</p>
              <Button variant="outline" :href="game.videoUrl" target="_blank">观看视频</Button>
            </div>
          </div>

          <!-- 右：封面 / 信息 / 标签 / 下载入口 -->
          <aside class="flex flex-col gap-8">
            <figure v-if="cover && banner" class="border border-black">
              <img
                :src="cover"
                :alt="`${game.title} 封面`"
                class="aspect-video w-full bg-surface object-contain"
                loading="lazy"
                decoding="async"
              />
              <figcaption class="border-t border-black px-4 py-3 swiss-meta text-black/55">
                封面
              </figcaption>
            </figure>

            <div>
              <p class="swiss-meta mb-4 text-black/55">02 — 作品信息</p>
              <table class="w-full border-collapse border border-black text-left">
                <tbody>
                  <tr
                    v-for="fact in facts"
                    :key="fact.label"
                    class="border-b border-line last:border-b-0"
                  >
                    <th
                      class="swiss-meta w-[36%] border-r border-line px-4 py-3 align-top font-normal text-black/60"
                    >
                      {{ fact.label }}
                    </th>
                    <td class="px-4 py-3 font-sans text-sm font-bold">
                      <template v-if="fact.links?.length">
                        <span
                          v-for="(link, index) in fact.links"
                          :key="`${link.category}:${link.value}`"
                        >
                          <span v-if="index > 0" class="text-black/35"> / </span>
                          <button
                            type="button"
                            class="cursor-pointer text-left underline-offset-2 transition-colors duration-150 ease-out hover:text-accent hover:underline"
                            @click="openIndex(link.category, link.value)"
                          >
                            {{ link.text }}
                          </button>
                        </span>
                      </template>
                      <a
                        v-else-if="fact.href"
                        :href="fact.href"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="break-all underline underline-offset-2 transition-colors duration-150 ease-out hover:text-accent"
                      >
                        {{ fact.value }}
                      </a>
                      <span v-else>{{ fact.value }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div v-if="tags.length">
              <p class="swiss-meta mb-4 text-black/55">标签</p>
              <ul class="flex flex-wrap gap-2" aria-label="作品标签">
                <li v-for="tag in tags" :key="tag">
                  <button
                    type="button"
                    class="cursor-pointer border border-line px-3 py-1.5 font-sans text-[11px] uppercase tracking-[0.08em] transition-colors duration-150 ease-out hover:border-accent hover:text-accent"
                    @click="openIndex('tag', tag)"
                  >
                    {{ tag }}
                  </button>
                </li>
              </ul>
            </div>

            <div class="border border-black px-5 py-5">
              <p class="swiss-meta text-black/55">资源下载</p>
              <p class="mt-3 font-sans text-sm font-bold">
                {{ game.downloads.length }} 个渠道
              </p>
              <p class="mt-2 max-w-[38ch] font-sans text-xs leading-relaxed text-black/60">
                全部指向第三方网盘，本站不存储、不分发任何游戏文件。
              </p>
              <Button variant="solid" block class="mt-5" @click="scrollToId('downloads')">
                前往下载
              </Button>
            </div>

            <p class="font-sans text-xs leading-relaxed text-black/50">
              评分与浏览量为社区维护的参考值，非官方数据。浏览量实时累计；计数服务不可用时退回静态基数。
            </p>
          </aside>
        </div>
      </div>
    </section>

    <!-- ============ 下载核心区 ============ -->
    <section id="downloads" class="scroll-mt-24 border-b border-black">
      <div class="mx-auto max-w-[1280px] px-6 py-12 md:px-12 md:py-16">
        <p class="swiss-meta mb-6 text-black/60">03 — 资源下载</p>
        <DownloadPanel :downloads="game.downloads" />
      </div>
    </section>

    <!-- ============ 相关作品（Phase 5） ============ -->
    <section v-if="hasRelatedWorks" id="related" class="border-b border-black">
      <div class="mx-auto max-w-[1280px] px-6 py-12 md:px-12 md:py-16">
        <p class="swiss-meta mb-8 text-black/60">04 — 相关作品</p>

        <div v-for="section in RELATED_SECTIONS" :key="section.key" class="mb-12 last:mb-0">
          <template v-if="section.works.length > 0">
            <div class="mb-6 flex items-end justify-between border-b border-black pb-3">
              <h2 class="font-sans text-xl font-bold uppercase tracking-tight">
                {{ section.title }}
              </h2>
              <p class="swiss-meta text-black/45">{{ section.works.length }} 款</p>
            </div>

            <ul class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              <li v-for="work in section.works" :key="work.game.id">
                <RouterLink
                  :to="{ name: 'game', params: { id: work.game.id } }"
                  class="group flex h-full border border-black bg-white transition-colors duration-150 ease-out hover:border-accent"
                >
                  <img
                    v-if="work.game.coverImage"
                    :src="assetUrl(work.game.coverImage)"
                    :alt="`${work.game.title} 封面`"
                    class="w-[104px] shrink-0 border-r border-line bg-surface object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                  <div v-else class="w-[104px] shrink-0 border-r border-line bg-surface" />

                  <div class="min-w-0 px-4 py-3">
                    <p v-if="work.label" class="swiss-meta text-accent">{{ work.label }}</p>
                    <p class="mt-1 font-sans text-sm font-bold leading-snug">
                      {{ work.game.title }}
                    </p>
                    <p class="mt-1 font-sans text-xs text-black/50">
                      {{ work.game.releaseYear }} · {{ work.game.author }}
                    </p>
                  </div>
                </RouterLink>
              </li>
            </ul>
          </template>
        </div>
      </div>
    </section>

    <GalleryLightbox v-model="galleryOpen" :images="gallery" :title="game.title" />
  </div>

  <!-- ==================== 未命中 ==================== -->
  <div v-else>
    <section class="bg-accent-surface text-on-accent">
      <div class="mx-auto max-w-[1280px] px-6 py-24 md:px-12 md:py-32">
        <p class="swiss-meta mb-8">Error 404 — Game Not Found</p>
        <h1
          class="font-sans text-4xl font-bold uppercase leading-[0.95] tracking-[-0.03em] md:text-6xl"
        >
          没有这个游戏
        </h1>
        <p class="mt-10 max-w-[56ch] font-sans text-base leading-relaxed text-on-accent/90">
          资源库中没有 id 为 <span class="font-bold tracking-[0.2em]">{{ id }}</span> 的条目。
          可能是链接已失效，或者这个作品还没有被收录。
        </p>
      </div>
    </section>

    <section>
      <div class="mx-auto max-w-[1280px] px-6 py-20 md:px-12">
        <RouterLink
          to="/"
          class="group inline-flex items-center gap-4 border border-black bg-black px-8 py-4 font-sans text-xs font-bold uppercase tracking-[0.16em] text-white transition-colors duration-150 ease-out hover:border-accent-surface hover:bg-accent-surface hover:text-on-accent"
        >
          <span>返回游戏库</span>
          <span class="u-arrow" aria-hidden="true">&#8594;</span>
        </RouterLink>
      </div>
    </section>
  </div>
</template>
