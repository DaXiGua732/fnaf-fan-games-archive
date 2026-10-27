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
 * 之所以敢直接重试，是因为**重放永远正确**：我们改的是「某一条作品的某几个字段」
 * 或「某一个词条」，不是一段文本。这一点和合并文本 diff 有本质区别 ——
 * 后者需要人来裁决。
 *
 * ---------------------------------------------------------------------------
 * 【整个文档，而不是只有 games】
 * ---------------------------------------------------------------------------
 * 文件顶层现在有 `games` 与 `taxonomy`，而且未来可能继续加字段。
 * 解析时保留整个对象；序列化时 spread 原对象再覆盖这两个键 ——
 * 这样旧版本代码、或还没认识新字段的代码，不会在保存作品时把词表静默抹掉。
 *
 * 分类编辑（新建 / 改名 / 合并 / 删除）与作品编辑共用同一个提交函数，
 * 因此「合并词条 + 改写所有作品引用」是一个原子操作，不会出现改了一半的状态。
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
import type { Taxonomy, VocabularyEntry } from '../types/taxonomy'
import { VOCABULARY_LABELS } from '../types/taxonomy'
import { normalizeGames } from '../utils/gameDefaults'
import { applyPatch, createGameFrom, slugify } from '../utils/gameFactory'
import {
  buildGameWritePatch,
  buildVocabularyWritePatches,
  removeRelationTarget,
} from '../utils/gamePersistence'
import {
  normalizeRelations,
  sameRelations,
  validateGameRelations,
  validateRelationInput,
} from '../utils/relations'
import {
  createVocabularyEntryIn,
  deleteVocabularyEntryIn,
  mergeVocabularyEntriesIn,
  normalizeTaxonomy,
  updateVocabularyEntryIn,
} from '../utils/taxonomy'
import { DATA_REPO, dataRepoPagesBase } from './dataRepo'
import type { GameRepository } from './gameRepository'

/** 冲突重试次数。3 次已经足够 —— 再撞上说明是真的人多手快，该让人重试而不是死循环 */
const MAX_CONFLICT_RETRY = 3

/** 数据仓 db.json 的完整内存形态：原始记录 + 归一化后的两份数据 */
interface CatalogDocument {
  /** 原封不动的顶层对象，用于保留未知字段与键顺序 */
  raw: Record<string, unknown>
  /** 原始作品记录，按 id 索引；持久化时未编辑的记录原样写回 */
  originals: Map<string, Record<string, unknown>>
  games: AdminGame[]
  taxonomy: Taxonomy
  taxonomyIssues: string[]
}

/** 一次提交的计划：新内容 + 提交信息摘要 */
interface CommitPlan {
  games: AdminGame[]
  taxonomy: Taxonomy
  /**
   * 本次**显式改动**的字段，按作品 id 索引。
   *
   * 只有这里列出的记录才会与原始 JSON 合并；其余作品整条原样写回。
   * 归一化结果只服务读取与展示，不能用来覆盖数据仓里的历史数据 ——
   * 否则一次「只改标题」的保存会顺手删掉别的作品上的异常关系。
   */
  writes: ReadonlyMap<string, Record<string, unknown>>
  /**
   * 提交信息里的摘要，用**最新**内容生成（而不是提交前的快照）。
   * git 历史就是这个后台的审计日志，所以信息要写清改了什么。
   */
  summary: string
  /**
   * 是否把 taxonomy 写入本次提交。
   *
   * 只有词表操作才置 true。普通作品保存不能因为「内存里有一份初始词表」
   * 就把种子词条写进数据仓 —— 那是一次未经确认的生产数据变更。
   * 数据仓里原本就有 taxonomy 时，`serializeCatalog` 保留 raw 原值；
   * 即使它的形状不可用（如 null / []），也不在普通保存时替用户改写。
   */
  writeTaxonomy?: boolean
  /** 词表被本次提交重写时传 []，让后台不再显示已经修掉的旧 issue */
  taxonomyIssues?: string[]
}

/**
 * 解析整个 db.json。
 * `games` 必须是数组（空数组合法）；词表缺失时由 normalizeTaxonomy 补内置初始词表，
 * 结构损坏时保留 issue 但不阻断读取。
 */
function parseCatalog(text: string): CatalogDocument {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('数据仓的 db.json 不是合法 JSON，无法解析。')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('数据仓里 db.json 的格式不对：顶层应当是一个对象。')
  }

  const raw = parsed as Record<string, unknown>
  const games = raw.games
  if (!Array.isArray(games)) {
    throw new Error('数据仓里 db.json 的格式不对：找不到 games 列表。')
  }

  const originals = new Map<string, Record<string, unknown>>()
  for (const entry of games) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    if (typeof record.id !== 'string' || !record.id.trim()) continue
    // 键保持原始 id：归一化不改 id，持久化时 `game.id` 才能命中该记录
    originals.set(record.id, record)
  }

  const normalized = normalizeTaxonomy(raw.taxonomy)
  return {
    raw,
    originals,
    games: normalizeGames(games as Game[]),
    taxonomy: normalized.taxonomy,
    taxonomyIssues: normalized.issues,
  }
}

/**
 * 与仓库里那份保持同样的 2 空格缩进，方便逐行 diff；保留全部未知顶层键。
 *
 * 作品记录采用「原始记录 + 本次显式字段」合并：未编辑的作品连键顺序都不变，
 * 编辑过的作品也只动真正改过的字段。这是关系持久化安全的核心 ——
 * 归一化可以丢弃 UI 不该看到的东西，但不能成为写回数据仓的依据。
 */
function serializeCatalog(document: CatalogDocument, plan: CommitPlan): string {
  const games = plan.games.map((game) => {
    const original = document.originals.get(game.id)
    const writes = plan.writes.get(game.id)
    if (!original) return writes ? { ...game, ...writes } : game
    return writes ? { ...original, ...writes } : original
  })
  const next: Record<string, unknown> = { ...document.raw, games }
  // 普通作品保存只覆盖 games：taxonomy（无论原值是否可用、是否等于 null）
  // 都通过 raw 原样保留，绝不用内存里的兜底词表替用户改写数据仓。
  // 只有词表操作才写入归一化后的新词表。
  if (plan.writeTaxonomy) {
    next.taxonomy = plan.taxonomy
  }
  return `${JSON.stringify(next, null, 2)}\n`
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
 * 文件名里的时间戳（`YYYYMMDDHHmmssSSS`）+ 4 位随机后缀。
 *
 * 【为什么文件名要带它】图片是公开地址、会被浏览器和 CDN 缓存。
 * 若沿用固定文件名（`cover.jpg`）覆盖上传，用户会一直看到旧图。
 * 换名即换地址，缓存自然失效 —— 代价是旧文件留在仓库里，
 * 「上传后删除旧图」是 Phase 17 的事。
 *
 * 【为什么精确到毫秒还要随机后缀】图库是多张连续上传的。
 * 只用秒级时间戳时，同一秒内的两张 `gallery-*.webp` 会得到**同一个路径**：
 * 第二张覆盖第一张，返回的地址也相同，图库看起来凭空少了一张。
 * 毫秒 + 随机后缀让单个标签页、多个标签页都不会撞名。
 */
function timestampTag(): string {
  const now = new Date()
  const pad = (value: number, width = 2) => String(value).padStart(width, '0')
  const nonce = Math.random().toString(36).slice(2, 6).padEnd(4, '0')
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}` +
    `${pad(now.getUTCMilliseconds(), 3)}${nonce}`
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
  const taxonomyStore = ref<Taxonomy>({
    gameplayTypes: [],
    mechanics: [],
    platforms: [],
  })
  const taxonomyIssues = ref<string[]>([])
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
      const document = parseCatalog(text)
      store.value = document.games
      taxonomyStore.value = document.taxonomy
      taxonomyIssues.value = document.taxonomyIssues
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
  async function commit(
    plan: (current: CatalogDocument) => CommitPlan | null,
  ): Promise<CatalogDocument | null> {
    let lastError: unknown = null

    for (let attempt = 1; attempt <= MAX_CONFLICT_RETRY; attempt += 1) {
      const { text, sha } = await fetchFile(repositoryRef, token)
      const current = parseCatalog(text)

      const intent = plan(current)
      if (intent === null) {
        // 不发无谓的提交，但顺手把最新内容收进来
        store.value = current.games
        taxonomyStore.value = current.taxonomy
        taxonomyIssues.value = current.taxonomyIssues
        error.value = ''
        return null
      }

      try {
        await putFile(
          repositoryRef,
          token,
          serializeCatalog(current, intent),
          sha,
          `（后台）${intent.summary}`,
        )
        store.value = intent.games
        taxonomyStore.value = intent.taxonomy
        taxonomyIssues.value = intent.taxonomyIssues ?? current.taxonomyIssues
        error.value = ''
        return { ...current, games: intent.games, taxonomy: intent.taxonomy }
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
        : '数据在短时间内被别处反复改动，这次提交没有成功。请稍后再试。',
    )
  }

  async function updateGame(id: string, patch: GamePatch): Promise<AdminGame> {
    let updated: AdminGame | null = null

    await commit((current) => {
      const index = current.games.findIndex((game) => game.id === id)
      if (index === -1) throw new Error(`找不到 id 为「${id}」的作品，可能已经被删掉了。`)

      // 先拒绝非法形状，再归一化 —— 否则非法关系会被静默丢弃，保存却显示成功
      if (patch.relations !== undefined) {
        const inputErrors = validateRelationInput(patch.relations, id)
        if (inputErrors.length > 0) throw new Error(inputErrors.join('；'))
      }

      const next = applyPatch(current.games[index], patch, account?.())
      const games = current.games.map((game, i) => (i === index ? next : game))

      // 编辑器每次保存都会带上 relations；只有内容确实变了才算「明确修改了关系」。
      // 未变化时持久化层会沿用原始 JSON，避免把归一化丢掉的异常关系写没。
      const relationsChanged =
        patch.relations !== undefined &&
        !sameRelations(current.games[index].relations, normalizeRelations(patch.relations, id))

      // 目录级校验只针对**明确修改过**的关系。历史数据里可能有悬挂 / 双端关系，
      // 它们不应阻塞标题、状态、归档等无关字段的保存 —— 否则该作品会永远改不动。
      if (relationsChanged) {
        const relationErrors = validateGameRelations(games, next)
        if (relationErrors.length > 0) throw new Error(relationErrors.join('；'))
      }

      updated = next
      // 只列出**实际改了哪些字段**，让 git 历史读起来有意义
      const fields = Object.keys(patch).join('、')
      return {
        games,
        taxonomy: current.taxonomy,
        summary: `更新《${next.title || id}》的 ${fields || '字段'}`,
        writes: new Map([
          [id, buildGameWritePatch(current.games[index], next, patch, relationsChanged)],
        ]),
      }
    })

    if (!updated) throw new Error(`「${id}」没有任何改动。`)
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
    taxonomy: computed(() => taxonomyStore.value),
    taxonomyIssues: computed(() => taxonomyIssues.value),
    storage: computed<StorageKind>(() => 'remote'),
    ready: computed(() => ready.value),
    error: computed(() => error.value),

    // 给「加载失败 → 重试」用的同一个入口
    reload: load,

    // 远程仓以 GitHub 上的数据为准，不接受外部注入
    hydrate() {},

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
        created = createGameFrom(current.games, patch, account?.())

        // id 是创建时才生成的；必须在它之后校验，否则「目标正好等于新 id」
        // 会被 normalizeRelations 当作自关联静默丢弃。
        if (patch.relations !== undefined) {
          const inputErrors = validateRelationInput(patch.relations, created.id)
          if (inputErrors.length > 0) throw new Error(inputErrors.join('；'))
        }

        const games = [created, ...current.games]
        const relationErrors = validateGameRelations(games, created)
        if (relationErrors.length > 0) throw new Error(relationErrors.join('；'))

        return {
          games,
          taxonomy: current.taxonomy,
          summary: `新增作品《${created.title || '未命名'}》`,
          // 新记录没有原始 JSON，序列化时会完整写入归一化结果
          writes: new Map(),
        }
      })

      if (!created) throw new Error('新建作品时没有产生任何改动。')
      return created
    },

    updateGame,

    async deleteGame(id) {
      let removed = false

      await commit((current) => {
        const target = current.games.find((game) => game.id === id)
        if (!target) return null

        removed = true
        let cleanedRelations = 0
        const games = current.games
          .filter((game) => game.id !== id)
          .map((game) => {
            const relations = game.relations ?? []
            const kept = relations.filter((relation) => relation.targetId !== id)
            if (kept.length === relations.length) return game
            cleanedRelations += relations.length - kept.length
            return { ...game, relations: kept }
          })

        // 内存里的归一化列表只负责 UI；落盘时从**原始记录**剔除入边，
        // 同一记录上的其他历史异常关系仍然保留，交给质量检查继续报告。
        const writes = new Map<string, Record<string, unknown>>()
        for (const [gameId, record] of current.originals) {
          if (gameId === id) continue
          const cleaned = removeRelationTarget(record, id)
          if (cleaned) writes.set(gameId, { relations: cleaned.relations })
        }

        return {
          games,
          taxonomy: current.taxonomy,
          summary:
            `删除作品《${target.title || id}》` +
            (cleanedRelations > 0 ? `，并清理 ${cleanedRelations} 条关联` : ''),
          writes,
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

    /* -----------------------------------------------------------------------
       分类词表
       ----------------------------------------------------------------------- */

    async createVocabularyEntry(collection, input) {
      let entry: VocabularyEntry | null = null

      await commit((current) => {
        const result = createVocabularyEntryIn(current.taxonomy, collection, input)
        entry = result.entry
        return {
          games: current.games,
          taxonomy: result.taxonomy,
          summary: `新增${VOCABULARY_LABELS[collection]}「${result.entry.name}」`,
          writeTaxonomy: true,
          taxonomyIssues: [],
          writes: new Map(),
        }
      })

      // 赋值发生在 commit 的回调里，TS 的控制流不会追踪到；显式收窄避免被当成 never
      const created = entry as VocabularyEntry | null
      if (!created) throw new Error('新建词条时没有产生任何改动。')
      return { ...created }
    },

    async updateVocabularyEntry(collection, id, patch) {
      let entry: VocabularyEntry | null = null

      await commit((current) => {
        const result = updateVocabularyEntryIn(current.taxonomy, collection, id, patch)
        entry = result.entry
        return {
          games: current.games,
          taxonomy: result.taxonomy,
          summary: `更新${VOCABULARY_LABELS[collection]}「${result.entry.name}」`,
          writeTaxonomy: true,
          taxonomyIssues: [],
          writes: new Map(),
        }
      })

      const updated = entry as VocabularyEntry | null
      if (!updated) throw new Error('更新词条时没有产生任何改动。')
      return { ...updated }
    },

    async mergeVocabularyEntries(collection, sourceId, targetId) {
      let affectedGames = 0

      await commit((current) => {
        const result = mergeVocabularyEntriesIn(
          current.taxonomy,
          current.games,
          collection,
          sourceId,
          targetId,
        )
        affectedGames = result.affectedGames
        return {
          games: result.games,
          taxonomy: result.taxonomy,
          summary: `合并${VOCABULARY_LABELS[collection]}「${sourceId}」→「${targetId}」`,
          writeTaxonomy: true,
          taxonomyIssues: [],
          writes: buildVocabularyWritePatches(
            result.games,
            result.affectedGameIds,
            collection,
          ),
        }
      })

      return { taxonomy: taxonomyStore.value, affectedGames }
    },

    async deleteVocabularyEntry(collection, id, options = {}) {
      let affectedGames = 0

      await commit((current) => {
        const result = deleteVocabularyEntryIn(
          current.taxonomy,
          current.games,
          collection,
          id,
          options,
        )
        affectedGames = result.affectedGames
        return {
          games: result.games,
          taxonomy: result.taxonomy,
          summary: `删除${VOCABULARY_LABELS[collection]}「${id}」`,
          writeTaxonomy: true,
          taxonomyIssues: [],
          writes: buildVocabularyWritePatches(
            result.games,
            result.affectedGameIds,
            collection,
          ),
        }
      })

      return { taxonomy: taxonomyStore.value, affectedGames }
    },

    async resetToSeed() {
      // 「一键把线上数据仓覆盖回出厂内容」不是后台该有的能力。
      // 真要回滚，用 git revert —— 历史就在那里，比这个按钮精确得多。
      throw new Error(
        '线上数据仓不支持「恢复出厂数据」。要回滚的话，请在 GitHub 上对数据仓做一次 revert。',
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
