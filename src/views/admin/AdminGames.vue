<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import AdminBatchBar from '../../components/admin/AdminBatchBar.vue'
import AdminGameTable from '../../components/admin/AdminGameTable.vue'
import AdminToolbar from '../../components/admin/AdminToolbar.vue'
import AdminDataState from '../../components/admin/AdminDataState.vue'
import { useAdminGames } from '../../composables/useAdminGames'
import { STORAGE_NOTICE } from '../../types/admin'

/**
 * /admin/games —— 游戏管理首页（Phase 2 列表 + Phase 3 批量操作）
 *
 * 本页只负责版式与状态呈现：
 * 搜索 / 筛选 / 排序 / 分页 / 勾选 / 批量写入全部在 useAdminGames 内，
 * 本页不含任何 .filter() / .sort() 逻辑，也不 import 数据源。
 *
 * 写入落在哪里（内存 / 本机浏览器 / 线上）由仓储声明，本页只负责**如实**转述，
 * 绝不笼统地说「保存成功」。
 */
const {
  total,
  currentPage,
  totalPages,
  activeQuery,
  hasActiveQuery,
  clearQuery,
  setPage,
  setPageSize,
  lastOutcome,
  dataOk,
  dismissOutcome,
  storage,
  resetToSeed,
} = useAdminGames()

/** 恢复出厂数据是破坏性动作，所以走页内确认条，不用原生弹窗 */
const confirmingReset = ref(false)
const resetDone = ref(false)

async function confirmReset(): Promise<void> {
  confirmingReset.value = false
  await resetToSeed()
  resetDone.value = true
}

/**
 * 每页条数档位。
 *
 * 刻意保留 5 / 10 这类小档位：目录目前只有 6 款作品，若最小档位是 20，
 * 分页控件将永远不会出现（页码恒为 1 / 1），既看不到也没法验收。
 * 小档位同时也方便逐条核对数据。
 */
const PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100]

/** 下拉用字符串取值，避免依赖「非字符串 option value」的运行时行为差异 */
const pageSizeValue = computed<string>({
  get: () => String(activeQuery.value.pageSize),
  set: (value) => {
    const size = Number(value)
    if (Number.isFinite(size)) setPageSize(size)
  },
})
</script>

<template>
  <AdminDataState v-if="!dataOk" />

  <!-- 数据未就绪时不渲染内容：加载中显示空列表、出错显示空列表，都会让人以为数据没了 -->
  <div v-else class="py-12 md:py-16">
    <!-- ============ 页头 ============ -->
    <div class="flex flex-wrap items-end justify-between gap-6 border-b border-black pb-6">
      <div>
        <p class="swiss-meta mb-4 text-black/60">01 — Games</p>
        <h1 class="font-sans text-2xl font-bold uppercase tracking-tight md:text-3xl">游戏管理</h1>
      </div>

      <RouterLink
        :to="{ name: 'admin-game-new' }"
        class="group inline-flex items-center gap-4 border border-black bg-black px-6 py-3 font-sans text-[11px] font-bold uppercase tracking-[0.16em] text-white transition-colors duration-150 ease-out hover:border-[#ff0000] hover:bg-[#ff0000]"
      >
        <span>新增游戏</span>
        <span class="u-arrow" aria-hidden="true">&#8594;</span>
      </RouterLink>
    </div>

    <p class="mt-8 max-w-[68ch] font-sans text-sm leading-relaxed text-black/60">
      管理本站收录的所有游戏资源。支持关键词搜索、状态 / 作者 / 标签筛选与多种排序，
      勾选后可对多款作品执行批量操作；点表格行内的「编辑」进入单条编辑页。
    </p>

    <!-- ============ 数据现状 ============ -->
    <div class="mt-8 border border-[#cccccc] border-l-4 border-l-black px-6 py-5">
      <p class="swiss-meta text-black/60">数据现状</p>

      <!-- 三种写入位置各说各的实话，不能笼统写「已保存」 -->
      <template v-if="storage === 'remote'">
        <p class="mt-2 max-w-[78ch] font-sans text-xs leading-relaxed text-black/70">
          数据来自 <span class="font-bold text-black">数据仓</span>。你的改动会通过 GitHub API
          <span class="font-bold text-black">提交到数据仓</span> —— 那是线上真实数据，
          大约 1 分钟后前台会更新。提交历史就是完整的回滚手段。
        </p>
        <p class="mt-3 max-w-[78ch] font-sans text-xs leading-relaxed text-black/70">
          多人同时编辑时，提交若撞车会自动重读最新内容再重放你的改动，无需手工处理。
        </p>
      </template>

      <p v-else class="mt-2 max-w-[78ch] font-sans text-xs leading-relaxed text-black/70">
        {{
          storage === 'local'
            ? 'db.json 是出厂数据。你在后台做的改动保存在这台设备的浏览器里 —— 刷新不丢，但它不是线上正式数据，也不会写回代码仓库。'
            : '当前浏览器不允许写入本地存储（隐私模式或配额已满），改动只存在内存里 —— 刷新页面即恢复原状。'
        }}
        清掉浏览器数据、或者用下面的「恢复出厂数据」都能回到出厂状态。
      </p>

      <!-- 「恢复出厂数据」只在本地模式下有意义：远程模式下它等于用出厂内容覆盖线上数据仓 -->
      <div v-if="storage !== 'remote'" class="mt-5 flex flex-wrap items-center gap-4">
        <button
          type="button"
          class="rounded-none border border-[#cccccc] bg-white px-4 py-2 font-sans text-[10px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:border-black"
          :disabled="confirmingReset"
          @click="((confirmingReset = true), (resetDone = false))"
        >
          恢复出厂数据
        </button>
        <p v-if="resetDone" class="swiss-meta font-bold text-[#ff0000]" role="status">
          已恢复出厂数据
        </p>
      </div>

      <!-- 破坏性动作走页内确认条，不用原生弹窗 -->
      <div
        v-if="confirmingReset"
        class="mt-4 border border-[#ff0000] px-5 py-4"
        role="alert"
        aria-live="assertive"
      >
        <p class="swiss-meta font-bold text-[#ff0000]">确认恢复出厂数据？</p>
        <p class="mt-2 max-w-[78ch] font-sans text-xs leading-relaxed text-black/70">
          所有作品会变回 db.json 里的内容 ——
          <span class="font-bold text-black">你在后台做过的全部改动都会丢失，且无法撤销。</span>
        </p>
        <div class="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            class="rounded-none border border-[#ff0000] bg-white px-4 py-2 font-sans text-[10px] font-bold uppercase tracking-[0.14em] text-[#ff0000] transition-colors duration-150 ease-out hover:bg-[#ff0000] hover:text-white"
            @click="confirmReset"
          >
            确认恢复
          </button>
          <button
            type="button"
            class="rounded-none border border-black bg-white px-4 py-2 font-sans text-[10px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:bg-black hover:text-white"
            @click="confirmingReset = false"
          >
            取消
          </button>
        </div>
      </div>
    </div>

    <!-- ============ 工具栏 ============ -->
    <div class="mt-12">
      <AdminToolbar />
    </div>

    <!-- ============ 批量操作条 ============ -->
    <div class="mt-8">
      <AdminBatchBar />
    </div>

    <!-- ============ 操作结果提示条 ============ -->
    <div
      v-if="lastOutcome"
      class="mt-8 border border-[#cccccc] border-l-4 border-l-[#ff0000] px-6 py-5"
      role="status"
      aria-live="polite"
    >
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="swiss-meta text-black/60">操作结果</p>
          <p class="mt-2 font-sans text-sm font-bold">
            {{ lastOutcome.label }} —— 实际改动 {{ lastOutcome.changed }} 项<template
              v-if="lastOutcome.skipped > 0"
            >
              ，跳过 {{ lastOutcome.skipped }} 项（本来就是目标状态）</template
            >
          </p>
          <p class="mt-3 max-w-[78ch] font-sans text-xs leading-relaxed text-black/70">
            {{ STORAGE_NOTICE[lastOutcome.storage] }}
          </p>
        </div>
        <button
          type="button"
          class="rounded-none border border-transparent px-4 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.14em] text-black/60 transition-colors duration-150 ease-out hover:text-[#ff0000]"
          @click="dismissOutcome"
        >
          知道了
        </button>
      </div>
    </div>

    <!-- ============ 结果头 ============ -->
    <div class="mb-6 mt-12 flex flex-wrap items-end justify-between gap-6 border-b border-black pb-4">
      <div>
        <h2 class="font-sans text-2xl font-bold uppercase tracking-tight">收录作品</h2>
        <p class="swiss-meta mt-2 text-black/60" aria-live="polite">
          命中 {{ total }} 款 · 第 {{ currentPage }} / {{ totalPages }} 页
        </p>
      </div>

      <button
        v-if="total === 0 && hasActiveQuery"
        type="button"
        class="rounded-none border border-black bg-black px-4 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.14em] text-white transition-colors duration-150 ease-out hover:border-[#ff0000] hover:bg-[#ff0000]"
        @click="clearQuery"
      >
        清除全部条件
      </button>
    </div>

    <!-- ============ 列表 ============ -->
    <AdminGameTable />

    <!-- ============ 分页 ============ -->
    <nav
      class="mt-8 flex flex-wrap items-center justify-between gap-6 border-t border-black pt-6"
      aria-label="分页"
    >
      <p class="swiss-meta text-black/60">
        共 {{ total }} 款 · 第 {{ currentPage }} / {{ totalPages }} 页
      </p>

      <label class="flex items-center gap-3" for="admin-page-size">
        <span class="swiss-meta text-black/60">每页</span>
        <div class="relative">
          <select
            id="admin-page-size"
            v-model="pageSizeValue"
            class="appearance-none rounded-none border border-black bg-white px-4 py-2 pr-9 font-sans text-xs transition-colors duration-150 ease-out focus:border-[#ff0000] focus:outline-none"
          >
            <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="String(size)">
              {{ size }}
            </option>
          </select>
          <span
            class="pointer-events-none absolute inset-y-0 right-3 flex items-center font-sans text-xs"
            aria-hidden="true"
            >&#9662;</span
          >
        </div>
      </label>

      <div class="flex items-center gap-4">
        <button
          type="button"
          class="group inline-flex items-center gap-4 border border-black px-6 py-3 font-sans text-[11px] font-bold uppercase tracking-[0.16em] transition-colors duration-150 ease-out hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-white disabled:hover:text-black"
          :disabled="currentPage <= 1"
          @click="setPage(currentPage - 1)"
        >
          <span class="u-arrow-back" aria-hidden="true">&#8594;</span>
          <span>上一页</span>
        </button>
        <button
          type="button"
          class="group inline-flex items-center gap-4 border border-black px-6 py-3 font-sans text-[11px] font-bold uppercase tracking-[0.16em] transition-colors duration-150 ease-out hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-white disabled:hover:text-black"
          :disabled="currentPage >= totalPages"
          @click="setPage(currentPage + 1)"
        >
          <span>下一页</span>
          <span class="u-arrow" aria-hidden="true">&#8594;</span>
        </button>
      </div>
    </nav>
  </div>
</template>
