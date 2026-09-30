/**
 * ============================================================================
 * GitHubGameRepository —— 把数据仓当作数据库
 * ============================================================================
 * 读写仓库里的 `db.json`（GitHub Contents API）。这是**线上真正的写路径**：
 * 后台保存一次 = 提交一次，git 历史因此成为这个后台完整的审计日志与回滚手段。
 *
 * ---------------------------------------------------------------------------
 * 【核心难点：db.json 是**一个文件**】
 * ---------------------------------------------------------------------------
 * 只要两位管理员同时在保存，**无论改的是不是同一条作品**，都会撞上冲突。
 * 所以每次写入都必须：
 *
 *   1. 读**最新**的 db.json 内容与它的 sha
 *   2. 把「我要改的那一处」重新作用到最新内容上（重放）
 *   3. 带着 sha 提交 —— GitHub 用 sha 做乐观锁，内容被别处改过就返回 409
 *   4. 撞上 409 就回到第 1 步重试
 *
 * 之所以敢直接重试，是因为**重放永远正确**：我们改的是「某一条作品的某几个字段」，
 * 不是一段文本。这一点和合并文本 diff 有本质区别 —— 后者需要人来裁决。
 *
 * ---------------------------------------------------------------------------
 * 【和本地仓的差异】
 * - `storage` 是 `remote`（提示条文案随之改变）
 * - `ready` 初始为 false：数据要先把 db.json 拉下来
 * - `resetToSeed()` **拒绝执行** —— 「一键把线上数据仓覆盖回出厂内容」不是后台该有的能力
 * ============================================================================
 */
import { computed, ref } from 'vue'
import {
  GithubApiError,
  blobToBase64,
  deleteFile,
  fetchFile,
  fetchFileSha,
  putBinaryFile,
  putFile,
  type GithubRepoRef,
} from '../services/githubApi'
import type { AdminGame, GamePatch, StorageKind } from '../types/admin'
import type { Game } from '../types/game'
import { normalizeGames } from '../utils/gameDefaults'
import { applyPatch, createGameFrom, slugify } from '../utils/gameFactory'
import { DATA_REPO, dataRepoPagesBase } from './dataRepo'
import type { GameRepository } from './gameRepository'

/** 冲突重试次数。3 次已经足够 —— 再撞上说明是真的人多手快，该让人重试而不是死循环 */
const MAX_CONFLICT_RETRY = 3

/** 一次提交的计划：新内容 + 提交信息摘要 */
interface CommitPlan {
  games: AdminGame[]
  /**
   * 提交信息里的摘要，用**最新**内容生成（而不是提交前的快照）。
   * git 历史就是这个后台的审计日志，所以信息要写清改了什么。
   */
  summary: string
}

/** db.json 的结构就是 `{ games: [...] }` —— 与代码仓那份保持一致 */
function parseGames(text: string): AdminGame[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('数据仓的 db.json 不是合法 JSON，无法解析。')
  }
  const games = (parsed as { games?: unknown } | null)?.games
  if (!Array.isArray(games)) {
    throw new Error('数据仓的 db.json 结构不对：缺少 games 数组。')
  }
  return normalizeGames(games as Game[])
}

/** 与仓库里那份保持同样的 2 空格缩进，方便逐行 diff */
function serializeGames(games: AdminGame[]): string {
  return `${JSON.stringify({ games }, null, 2)}\n`
}

/** MIME → 扩展名。只认图片；其余一律 .bin，宁可怪也不要编错 */
function extensionOf(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
  }
  return map[mime] ?? 'bin'
}

/**
 * 文件名里的时间戳（`YYYYMMDDHHmmss`）。
 *
 * 【为什么文件名要带它】图片是公开地址、会被浏览器和 CDN 缓存。
 * 若沿用固定文件名（`cover.jpg`）覆盖上传，用户会一直看到旧图。
 * 换名即换地址，缓存自然失效 —— 代价是旧文件留在仓库里，
 * 「上传后删除旧图」是 Phase 17 的事。
 */
function timestampTag(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
  )
}

export interface GitHubRepositoryOptions {
  token: string
  ref?: GithubRepoRef
  /**
   * 当前操作者的 GitHub 账号 —— 写入时会打进 `updatedBy`。
   * 多人后台里它和更新时间同等重要（谁最后碰过这条数据）。
   *
   * ⚠️ 是**取值函数**而不是字符串：页面刷新后令牌从本机恢复、
   * 账号要等一次 `/user` 才拿得到 —— 传函数的话，写入时取到的永远是**当下**的账号。
   */
  account?: () => string
}

export function createGitHubGameRepository(options: GitHubRepositoryOptions): GameRepository {
  const repositoryRef = options.ref ?? DATA_REPO
  const token = options.token
  const account = options.account

  const store = ref<AdminGame[]>([])
  const ready = ref(false)
  const error = ref('')

  /** 把失败翻译成用户能照着做的话 —— 网络层没有状态码，只能自己组织 */
  function describe(cause: unknown): string {
    if (cause instanceof GithubApiError) return cause.message
    if (cause instanceof Error) return cause.message
    return '无法连接 GitHub。'
  }

  /** 拉取一次远端数据。登录后、以及每次提交前都会走它 */
  async function load(): Promise<void> {
    try {
      const { text } = await fetchFile(repositoryRef, token)
      store.value = parseGames(text)
      error.value = ''
    } catch (cause) {
      error.value = describe(cause)
    } finally {
      ready.value = true
    }
  }

  /**
   * 提交一次改动。
   * 返回 `null` 表示「本来就已经是目标状态」，没有产生提交。
   */
  async function commit(plan: (current: AdminGame[]) => CommitPlan | null): Promise<AdminGame[] | null> {
    let lastError: unknown = null

    for (let attempt = 1; attempt <= MAX_CONFLICT_RETRY; attempt += 1) {
      const { text, sha } = await fetchFile(repositoryRef, token)
      const current = parseGames(text)

      const intent = plan(current)
      if (intent === null) {
        // 不发无谓的提交，但顺手把最新内容收进来
        store.value = current
        error.value = ''
        return null
      }

      try {
        await putFile(
          repositoryRef,
          token,
          serializeGames(intent.games),
          sha,
          `（后台）${intent.summary}`,
        )
        store.value = intent.games
        error.value = ''
        return intent.games
      } catch (cause) {
        lastError = cause
        // 409 = 内容刚被别处改过。重新读一遍再来（重放永远正确，所以不需要人裁决）
        if (cause instanceof GithubApiError && cause.status === 409 && attempt < MAX_CONFLICT_RETRY) {
          continue
        }
        throw cause
      }
    }

    throw new Error(
      lastError instanceof Error
        ? lastError.message
        : '数据在短时间内被别处反复改动，已放弃本次提交。请稍后重试。',
    )
  }

  async function updateGame(id: string, patch: GamePatch): Promise<AdminGame> {    let updated: AdminGame | null = null

    await commit((current) => {
      const index = current.findIndex((game) => game.id === id)
      if (index === -1) throw new Error(`updateGame: 找不到 id 为「${id}」的条目`)

      const next = applyPatch(current[index], patch, account?.())
      updated = next
      const games = current.map((game, i) => (i === index ? next : game))
      // 只列出**实际改了哪些字段**，让 git 历史读起来有意义
      const fields = Object.keys(patch).join('、')
      return { games, summary: `更新《${next.title || id}》的 ${fields || '字段'}` }
    })

    if (!updated) throw new Error(`updateGame: 「${id}」没有产生改动`)
    return updated
  }

  /**
   * 创建即开始拉取。
   *
   * ⚠️ 这里**必须真的调用**，不能只把 `load` 挂到 `reload` 上就完事 ——
   * 忘了调的话仓储永远停在「加载中」，页面会一直转圈，而且报错都没有。
   * 异步进行，`ready` 由 load() 负责置位。
   */
  void load()

  return {
    games: computed(() => store.value),
    storage: computed<StorageKind>(() => 'remote'),
    ready: computed(() => ready.value),
    error: computed(() => error.value),

    // 给「加载失败 → 重试」用的同一个入口
    reload: load,

    async listGames() {
      return store.value.map((game) => ({ ...game }))
    },

    async getGame(id) {
      const game = store.value.find((item) => item.id === id)
      return game ? { ...game } : undefined
    },

    async createGame(patch) {
      let created: AdminGame | null = null

      await commit((current) => {
        created = createGameFrom(current, patch, account?.())
        return {
          games: [created, ...current],
          summary: `新增作品《${created.title || '未命名'}》`,
        }
      })

      if (!created) throw new Error('createGame: 没有产生改动')
      return created
    },

    updateGame,

    async deleteGame(id) {
      let removed = false

      await commit((current) => {
        const target = current.find((game) => game.id === id)
        if (!target) return null

        removed = true
        return {
          games: current.filter((game) => game.id !== id),
          summary: `删除作品《${target.title || id}》`,
        }
      })

      return removed
    },

    async publishGame(id) {
      return updateGame(id, { status: 'published' })
    },

    async unpublishGame(id) {
      // 下线改状态、不删数据
      return updateGame(id, { status: 'offline' })
    },

    async resetToSeed() {
      // 「一键把线上数据仓覆盖回出厂内容」不是后台该有的能力。
      // 真要回滚，用 git revert —— 历史就在那里，比这个按钮精确得多。
      throw new Error(
        '远程数据仓不支持「恢复出厂数据」。如需回滚，请在 GitHub 上对数据仓做 revert。',
      )
    },

    async uploadImage(file, { gameId, slot }) {
      // 存储布局：images/games/<slug>/<位置>-<时间戳>.<扩展名>
      // 按作品分目录，是为了让人在仓库里翻找图片时能看懂。
      const path = `images/games/${slugify(gameId)}/${slot}-${timestampTag()}.${extensionOf(file.type)}`
      const base64 = await blobToBase64(file)

      await putBinaryFile(
        { ...repositoryRef, path },
        token,
        base64,
        `（后台）上传图片 ${path}`,
      )

      // 返回**完整外链** —— 前台的 assetUrl() 会原样放行，所以前台无需任何改动
      return `${dataRepoPagesBase(repositoryRef)}/${path}`
    },

    async deleteImage(url) {
      const base = dataRepoPagesBase(repositoryRef)

      // ⚠️ 两道闸：只删**本数据仓**里、且属于**上传目录**的图。
      //    站内旧资源（/images/xxx.svg，构建期就存在）和外部图床一律不碰 ——
      //    它们可能被别处引用，删掉就是前台裂图。
      if (!url.startsWith(`${base}/images/games/`)) {
        throw new Error('这张图不属于数据仓的上传目录，后台不会去删它。')
      }

      const path = url.slice(base.length + 1)
      const sha = await fetchFileSha({ ...repositoryRef, path }, token)

      // 已经不在了 —— 当成功处理（幂等：重复清理不该报错）
      if (!sha) return

      await deleteFile({ ...repositoryRef, path }, token, sha, `（后台）清理旧图 ${path}`)
    },
  }
}
