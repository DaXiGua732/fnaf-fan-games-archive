<script setup lang="ts">
import Button from '../components/Button.vue'
import Card from '../components/Card.vue'
import StyleAuditBadge from '../components/StyleAuditBadge.vue'

/* 阶段一视觉基建验收页 —— 保留备查，阶段三挂到 /style 路由 */

const palette = [
  { name: 'Paper', token: 'bg-white', hex: '#ffffff', bordered: true },
  { name: 'Ink', token: 'bg-black', hex: '#000000', bordered: false },
  { name: 'Accent', token: 'bg-[#ff0000]', hex: '#ff0000', bordered: false },
  { name: 'Line', token: 'bg-[#cccccc]', hex: '#cccccc', bordered: false },
  { name: 'Surface', token: 'bg-[#f9f9f9]', hex: '#f9f9f9', bordered: true },
]
</script>

<template>
  <div>
    <!-- Hero：纯红底 + 超大无衬线粗体 -->
    <section class="bg-[#ff0000] text-white">
      <div class="mx-auto max-w-[1280px] px-6 py-24 md:px-12 md:py-32">
        <p class="swiss-meta mb-8">Five Nights at Freddy's — Fan Game Repository</p>
        <h1 class="font-sans text-4xl font-bold uppercase leading-[0.95] tracking-[-0.03em] md:text-7xl">
          FNAF Fan Games<br />Archive
        </h1>
        <p class="mt-10 max-w-[52ch] font-sans text-base leading-relaxed text-white/90">
          严格的瑞士国际风格。直角、无阴影、无渐变、单一强调色。本页为阶段一视觉基建验收页。
        </p>
      </div>
    </section>

    <!-- 验收 -->
    <section class="border-b border-black">
      <div class="mx-auto max-w-[1280px] px-6 py-12 md:px-12">
        <p class="swiss-meta mb-6">00 — Automated Audit</p>
        <StyleAuditBadge />
      </div>
    </section>

    <!-- 色彩空间 -->
    <section class="border-b border-black">
      <div class="mx-auto max-w-[1280px] px-6 py-24 md:px-12">
        <p class="swiss-meta mb-12">01 — Color Palette</p>
        <div class="grid grid-cols-1 gap-8 sm:grid-cols-2 md:gap-8 lg:grid-cols-5">
          <div v-for="c in palette" :key="c.name">
            <div
              class="aspect-[4/3] w-full border"
              :class="[c.token, c.bordered ? 'border-[#cccccc]' : 'border-transparent']"
            />
            <div class="mt-4 border-t border-black pt-3">
              <p class="font-sans text-sm font-bold uppercase tracking-widest">{{ c.name }}</p>
              <p class="swiss-meta mt-1 text-black/60">{{ c.hex }}</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 字体层级 -->
    <section class="border-b border-black">
      <div class="mx-auto max-w-[1280px] px-6 py-24 md:px-12">
        <p class="swiss-meta mb-12">02 — Typography</p>
        <div class="space-y-10">
          <div class="grid gap-4 md:grid-cols-[200px_1fr]">
            <span class="swiss-meta text-black/60">Display / 72</span>
            <h2 class="font-sans text-5xl font-bold uppercase leading-none tracking-[-0.03em] md:text-7xl">
              Helvetica Bold
            </h2>
          </div>
          <div class="grid gap-4 md:grid-cols-[200px_1fr]">
            <span class="swiss-meta text-black/60">Heading / 30</span>
            <h3 class="font-sans text-3xl font-bold uppercase tracking-tight">Section Heading</h3>
          </div>
          <div class="grid gap-4 md:grid-cols-[200px_1fr]">
            <span class="swiss-meta text-black/60">Body / 16</span>
            <p class="max-w-[68ch] font-sans text-base leading-relaxed">
              正文使用 Helvetica 常规字重，行高 1.5，字号 16px。所有文本强制左对齐，
              通过大留白而非分隔线来建立信息层级。
            </p>
          </div>
          <div class="grid gap-4 md:grid-cols-[200px_1fr]">
            <span class="swiss-meta text-black/60">Meta / 11</span>
            <p class="swiss-meta">Uppercase Tracking 0.18em — 2017 / NIKSON / FNAF</p>
          </div>
        </div>
      </div>
    </section>

    <!-- 按钮 -->
    <section class="border-b border-black">
      <div class="mx-auto max-w-[1280px] px-6 py-24 md:px-12">
        <p class="swiss-meta mb-12">03 — Button</p>
        <div class="flex flex-col gap-12">
          <div>
            <p class="swiss-meta mb-6 text-black/60">Variants · 悬停仅改颜色，箭头右移 8px</p>
            <div class="flex flex-wrap items-center gap-6">
              <Button variant="solid">下载游戏</Button>
              <Button variant="outline">查看详情</Button>
              <Button variant="ghost">更多信息</Button>
            </div>
          </div>
          <div>
            <p class="swiss-meta mb-6 text-black/60">Sizes</p>
            <div class="flex flex-wrap items-center gap-6">
              <Button variant="outline" size="md">Medium</Button>
              <Button variant="solid" size="lg">Large</Button>
              <Button variant="outline" :arrow="false">无箭头</Button>
              <Button variant="solid" disabled>Disabled</Button>
            </div>
          </div>
          <div class="max-w-[420px]">
            <p class="swiss-meta mb-6 text-black/60">Block</p>
            <Button variant="solid" block>123云盘下载</Button>
          </div>
        </div>
      </div>
    </section>

    <!-- 卡片 -->
    <section>
      <div class="mx-auto max-w-[1280px] px-6 py-24 md:px-12">
        <p class="swiss-meta mb-12">04 — Card · 12 列衍生网格</p>
        <div class="grid grid-cols-1 gap-8 md:grid-cols-2 md:gap-8 lg:grid-cols-3">
          <Card interactive>
            <template #media>
              <div class="flex aspect-[16/9] items-end bg-black p-6">
                <span class="swiss-meta text-white/70">Cover 16:9</span>
              </div>
            </template>
            <p class="swiss-meta text-black/60">FNAF · 2017</p>
            <h3 class="mt-3 font-sans text-xl font-bold uppercase leading-tight">
              The Joy of Creation: Reborn
            </h3>
            <template #footer>
              <p class="swiss-meta text-black/60">Nikson</p>
            </template>
          </Card>

          <Card interactive>
            <template #media>
              <div class="flex aspect-[16/9] items-end bg-[#f9f9f9] p-6">
                <span class="swiss-meta text-black/50">Cover 16:9</span>
              </div>
            </template>
            <p class="swiss-meta text-black/60">FNAF · 2015</p>
            <h3 class="mt-3 font-sans text-xl font-bold uppercase leading-tight">
              Five Nights at Candy's
            </h3>
            <template #footer>
              <p class="swiss-meta text-black/60">Emil Macko</p>
            </template>
          </Card>

          <Card interactive>
            <template #media>
              <div class="flex aspect-[16/9] items-end bg-white p-6">
                <span class="swiss-meta text-black/50">Cover 16:9</span>
              </div>
            </template>
            <p class="swiss-meta text-black/60">FNAF · 2016</p>
            <h3 class="mt-3 font-sans text-xl font-bold uppercase leading-tight">POPGOES</h3>
            <template #footer>
              <p class="swiss-meta text-black/60">Kane Carter</p>
            </template>
          </Card>
        </div>

        <p class="mt-12 max-w-[68ch] font-sans text-sm leading-relaxed text-black/60">
          悬停任意卡片：左边框转为 #ff0000 并加粗至 4px（已预留透明边框，无布局抖动），
          底色转为 #f9f9f9。所有过渡时长锁定为 150ms ease-out。
        </p>
      </div>
    </section>
  </div>
</template>
