<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'

const route = useRoute()
</script>

<template>
  <div>
    <section class="bg-[#ff0000] text-white">
      <div class="mx-auto max-w-[1280px] px-6 py-24 md:px-12 md:py-32">
        <p class="swiss-meta mb-8">Error 404</p>
        <h1 class="font-sans text-5xl font-bold uppercase leading-[0.95] tracking-[-0.03em] md:text-8xl">
          这是<br />禁区
        </h1>
        <p class="mt-10 max-w-[52ch] font-sans text-base leading-relaxed text-white/90">
          你试图访问的路径不存在。也许是链接失效，也许是地址打错了。
        </p>
      </div>
    </section>

    <section>
      <div class="mx-auto max-w-[1280px] px-6 py-20 md:px-12">
        <p class="swiss-meta mb-4 text-black/60">请求的路径</p>
        <p class="mb-12 font-sans text-sm font-bold break-all">{{ route.fullPath }}</p>

        <RouterLink
          to="/"
          class="group inline-flex items-center gap-4 border border-black bg-black px-8 py-4 font-sans text-xs font-bold uppercase tracking-[0.16em] text-white transition-colors duration-150 hover:border-[#ff0000] hover:bg-[#ff0000]"
        >
          <span>回到首页</span>
          <span class="u-arrow" aria-hidden="true">&#8594;</span>
        </RouterLink>
      </div>
    </section>
  </div>
</template>
