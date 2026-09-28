<script setup lang="ts">
import { onMounted, ref } from 'vue'

/**
 * 视觉规范运行期哨兵
 * 全量扫描 DOM，比对 border-radius 与 box-shadow。
 * 这是规范「一旦偏离即视为严重 Bug」这条红线的自动化验收手段。
 */
const violations = ref<string[]>([])
const checked = ref(false)

function audit(): void {
  const offenders: string[] = []
  document.querySelectorAll<HTMLElement>('*').forEach((el) => {
    const cs = getComputedStyle(el)
    const radius = cs.borderTopLeftRadius
    const shadow = cs.boxShadow
    if (radius && radius !== '0px') {
      offenders.push(`圆角 ${radius} → <${el.tagName.toLowerCase()}>`)
    }
    if (shadow && shadow !== 'none') {
      offenders.push(`阴影 ${shadow} → <${el.tagName.toLowerCase()}>`)
    }
  })
  violations.value = [...new Set(offenders)]
  checked.value = true
}

onMounted(audit)
defineExpose({ audit })
</script>

<template>
  <section class="border border-black">
    <header class="flex items-center justify-between border-b border-[#cccccc] px-6 py-3">
      <span class="swiss-meta">Compliance — border-radius / box-shadow</span>
      <button
        type="button"
        class="swiss-meta underline transition-colors duration-150 hover:text-[#ff0000]"
        @click="audit"
      >
        重新扫描
      </button>
    </header>

    <div class="px-6 py-5">
      <template v-if="checked && violations.length === 0">
        <p class="font-sans text-xl font-bold uppercase tracking-tight">PASS — 零圆角 / 零阴影</p>
        <p class="mt-2 font-sans text-xs leading-relaxed text-black/60">
          已扫描整页 DOM，未发现任何 border-radius 或 box-shadow 生效。
        </p>
      </template>

      <template v-else-if="checked">
        <p class="font-sans text-xl font-bold uppercase tracking-tight text-[#ff0000]">
          FAIL — 检出 {{ violations.length }} 处违规
        </p>
        <ul class="mt-2 space-y-1 font-sans text-xs text-black/60">
          <li v-for="item in violations" :key="item">{{ item }}</li>
        </ul>
      </template>

      <p v-else class="swiss-meta text-black/50">扫描中…</p>
    </div>
  </section>
</template>
