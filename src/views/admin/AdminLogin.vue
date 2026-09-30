<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { TOKEN_CREATE_URL, useAdminAuth } from '../../composables/useAdminAuth'

/**
 * /admin/login —— 后台登录
 *
 * 【为什么是「粘贴令牌」而不是账号密码】
 * 这个站点是纯静态、无后端，不可能自己存账号密码（也不该在静态页面上处理密码）。
 * 所以认证交给 GitHub：站长给每位管理员签发一枚**细粒度令牌**，
 * 只授权数据仓、只给 Contents 读写权限 —— 于是「能改数据、不能碰代码」
 * 由凭据本身的权限保证，而不是靠这个页面上的判断。
 *
 * 登录成功后令牌存在**本机浏览器**，不进代码、不进仓库。
 */
const route = useRoute()
const router = useRouter()
const { login, checking, notice } = useAdminAuth()

const input = ref('')

async function submit(): Promise<void> {
  const ok = await login(input.value)
  if (!ok) return

  // 登录前想去哪就回哪去（守卫会把目标路径塞进 query.redirect）
  const target = typeof route.query.redirect === 'string' ? route.query.redirect : ''
  await router.replace(target || { name: 'admin-games' })
  // 用完即清，别把令牌留在内存里的输入框变量中
  input.value = ''
}

const INPUT_CLASS =
  'w-full rounded-none border border-black bg-white px-4 py-3 font-sans text-sm ' +
  'transition-colors duration-150 ease-out placeholder:text-black/35 focus:border-[#ff0000] focus:outline-none'

const ACTION_PRIMARY =
  'inline-flex items-center justify-center border border-black bg-black px-6 py-3 font-sans ' +
  'text-[11px] font-bold uppercase tracking-[0.16em] text-white transition-colors ' +
  'duration-150 ease-out hover:border-[#ff0000] hover:bg-[#ff0000] ' +
  'disabled:cursor-not-allowed disabled:border-[#cccccc] disabled:bg-white disabled:text-black/30'
</script>

<template>
  <div class="py-12 md:py-16">
    <p class="swiss-meta mb-4 text-black/60">00 — Sign in</p>
    <h1 class="font-sans text-2xl font-bold uppercase tracking-tight md:text-3xl">管理登录</h1>

    <p class="mt-8 max-w-[68ch] font-sans text-sm leading-relaxed text-black/60">
      这个后台没有账号密码 —— 凭据是一枚
      <span class="font-bold text-black">GitHub 细粒度访问令牌</span>，
      由站长签发给你。它只授权「数据仓」，所以
      <span class="font-bold text-black">你能改游戏数据，但碰不到任何源代码</span>。
    </p>

    <!-- ============ 怎么拿到令牌 ============ -->
    <section class="mt-10 max-w-[78ch] border border-[#cccccc] px-6 py-5">
      <p class="swiss-meta text-black/60">第一步 · 拿到令牌（每人一枚，不要共用）</p>
      <ol class="mt-4 flex flex-col gap-3 font-sans text-xs leading-relaxed text-black/70">
        <li>
          1. 打开 GitHub 的
          <a
            :href="TOKEN_CREATE_URL"
            target="_blank"
            rel="noopener noreferrer"
            class="font-bold text-black underline decoration-[#ff0000] decoration-2 underline-offset-2 transition-colors duration-150 ease-out hover:text-[#ff0000]"
          >
            细粒度令牌创建页 ↗
          </a>
        </li>
        <li>
          2. <span class="font-bold text-black">Repository access</span> 选
          <span class="font-bold text-black">Only select repositories</span>，
          只勾 <code class="border border-[#cccccc] px-1">fnaf-fan-games-data</code>
        </li>
        <li>
          3. <span class="font-bold text-black">Permissions</span> →
          Repository permissions → 只把
          <span class="font-bold text-black">Contents</span> 设为
          <span class="font-bold text-black">Read and write</span>（其余全部 No access）
        </li>
        <li>4. 生成后复制那串以 <code class="border border-[#cccccc] px-1">github_pat_</code> 开头的令牌</li>
      </ol>
    </section>

    <!-- ============ 输入 ============ -->
    <section class="mt-10 max-w-[78ch]">
      <p class="swiss-meta mb-3 text-black/60">第二步 · 粘贴令牌</p>

      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <input
          v-model="input"
          type="password"
          autocomplete="off"
          spellcheck="false"
          placeholder="github_pat_…"
          :class="INPUT_CLASS"
          :aria-invalid="Boolean(notice)"
          aria-label="GitHub 细粒度访问令牌"
        />

        <div class="flex flex-wrap items-center gap-4">
          <button type="submit" :class="ACTION_PRIMARY" :disabled="checking">
            {{ checking ? '校验中…' : '登录' }}
          </button>
          <RouterLink
            to="/"
            class="font-sans text-[11px] font-bold uppercase tracking-[0.16em] text-black/60 transition-colors duration-150 ease-out hover:text-[#ff0000]"
          >
            返回站点
          </RouterLink>
        </div>
      </form>

      <p v-if="notice" class="mt-4 font-sans text-xs leading-relaxed text-[#ff0000]" role="alert">
        {{ notice }}
      </p>
      <p v-else class="mt-4 font-sans text-xs leading-relaxed text-black/45">
        令牌只会存在这台设备的浏览器里，不会进入代码仓库；点「登出」即清除。
        校验时会实际读一次数据仓 —— 确认它真的够用，而不是只看格式。
      </p>
    </section>
  </div>
</template>
