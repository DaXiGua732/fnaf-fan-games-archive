/**
 * ============================================================================
 * useAdminAuth —— 后台认证（Phase 15）
 * ============================================================================
 * 【本项目的「登录」到底是什么】
 * 没有自建账号体系。凭据是一枚 **GitHub 细粒度 Personal Access Token**：
 * 由站长在 GitHub 上签发，只授权数据仓、只给 Contents 的 Read and write。
 *
 * 于是「**管理员只能改数据、不能碰代码**」这条要求，是由**凭据本身的权限**保证的，
 * 而不是靠我们写的判断逻辑 —— 判断逻辑写错就会漏，凭据权限不会。
 * （已实测：拿这枚令牌往代码仓写文件会被 GitHub 拒绝。）
 *
 * 【令牌存在哪】本机 localStorage（每位管理员在自己设备上登录一次）。
 * 不进代码、不进仓库、登出即清除。
 * ============================================================================
 */
import { computed, ref } from 'vue'
import { useLocalAdminRepository, useRemoteAdminRepository } from '../repositories'
import { DATA_REPO } from '../repositories/dataRepo'
import { GithubApiError, githubRequest } from '../services/githubApi'

/** 本机存放令牌的键名。带版本号，将来换方案时改 v2 即可让旧值自然失效 */
export const ADMIN_TOKEN_KEY = 'fnaf-archive:admin-token:v1'

/** GitHub 上创建细粒度令牌的页面 —— 登录页要把用户送到这里 */
export const TOKEN_CREATE_URL = 'https://github.com/settings/personal-access-tokens/new'

function readStoredToken(): string {
  try {
    if (typeof localStorage === 'undefined') return ''
    return localStorage.getItem(ADMIN_TOKEN_KEY) ?? ''
  } catch {
    // 隐私模式下访问 localStorage 会抛错 —— 当作未登录处理
    return ''
  }
}

function writeStoredToken(value: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (value) localStorage.setItem(ADMIN_TOKEN_KEY, value)
    else localStorage.removeItem(ADMIN_TOKEN_KEY)
  } catch {
    // 存不进去也只能接受：本次会话仍可用，只是刷新后要重新登录
  }
}

/**
 * 从本机存储重新读取令牌，并让**数据源跟着令牌一起变**。
 *
 * ⚠️ 这两件事必须同时发生：令牌与数据源如果各说各话，就会出现
 * 「界面显示已登录、但保存其实写在本机浏览器里」这种最难排查的状态。
 * 所以切换只在这里和 login / logout 里做，别处一律不碰。
 *
 * 三处真实用途：
 *   1. 另一个标签页登出后，本标签页同步
 *   2. 应用启动时按已存令牌切到远程数据仓
 *   3. SSR 冒烟测试要分别验证「已登录 / 未登录」两种状态
 */
export function reloadStoredToken(): void {
  token.value = readStoredToken()
  if (token.value) {
    useRemoteAdminRepository(token.value, () => account.value)
    // 跨标签页登录时账号还没在本页填过 —— 补拉一次
    void githubRequest<{ login: string }>('/user', token.value)
      .then((user) => {
        account.value = user.login
      })
      .catch(() => {})
  } else {
    useLocalAdminRepository()
  }
}

/** 令牌是否为空的初始值来自本机存储 —— SSR 下必然为空 */
const token = ref(readStoredToken())
const account = ref('')
const checking = ref(false)
const notice = ref('')

/**
 * 跨标签页同步登录状态。
 *
 * `storage` 事件只在**其它**标签页改动 localStorage 时触发（本页自己改不会触发），
 * 正好是我们要的语义：在另一个标签页登出，本标签页下一次导航就会被门禁拦下，
 * 而不是顶着一个已经失效的身份继续操作。
 *
 * 用 `reloadStoredToken()` 而不是直接赋值，是为了让「重新读一次本机存储」只有一处实现。
 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key === ADMIN_TOKEN_KEY) {
      reloadStoredToken()
      if (!token.value) account.value = ''
    }
  })
}

const isAuthenticated = computed(() => token.value !== '')

/** 当前会话的令牌。**只给仓储用，不要渲染到页面上** */
function getToken(): string {
  return token.value
}

/** 粗判令牌形态，拦住「把别的东西粘进来」这类最常见的错 */
function looksLikeToken(value: string): boolean {
  return value.startsWith('github_pat_') || value.startsWith('ghp_')
}

/**
 * 登录。
 *
 * 校验分两步，**缺一不可**：
 *   1. `/user` 确认这枚令牌本身有效
 *   2. 读一次数据仓的 `db.json` 确认它**真的够用**
 *
 * 只做第 1 步的话，「登录成功」会是个骗人的说法 —— 令牌有效但没授权数据仓时，
 * 用户会一路进到后台，然后在第一次保存时才炸。不如在这里就说清楚。
 */
async function login(input: string): Promise<boolean> {
  const candidate = input.trim()
  notice.value = ''

  if (!candidate) {
    notice.value = '请先把令牌粘贴进来。'
    return false
  }
  if (!looksLikeToken(candidate)) {
    notice.value = '这看起来不是 GitHub 的访问令牌（应以 github_pat_ 或 ghp_ 开头）。'
    return false
  }

  checking.value = true
  try {
    const user = await githubRequest<{ login: string }>('/user', candidate)

    await githubRequest(
      `/repos/${DATA_REPO.owner}/${DATA_REPO.repo}/contents/${DATA_REPO.path}` +
        `?ref=${encodeURIComponent(DATA_REPO.branch)}`,
      candidate,
    )

    token.value = candidate
    account.value = user.login
    writeStoredToken(candidate)
    // 切换数据源：从现在起后台读写的是**线上数据仓**，不再是本机存档
    useRemoteAdminRepository(candidate, () => account.value)
    return true
  } catch (error) {
    account.value = ''
    notice.value =
      error instanceof GithubApiError
        ? error.message
        : error instanceof Error
          ? `无法连接 GitHub：${error.message}`
          : '登录失败'
    return false
  } finally {
    checking.value = false
  }
}

function logout(): void {
  token.value = ''
  account.value = ''
  notice.value = ''
  writeStoredToken('')
  // 数据源跟着退回本地，别留下「已登出但还在读线上」的错位
  useLocalAdminRepository()
}

/* ---------------------------------------------------------------------------
   模块加载时：本机已经有令牌 → 直接切到远程数据仓。
   这样刷新页面之后读的仍然是线上数据，而不是悄悄退回本机旧存档。
   （未登录时是空串，不会触发网络请求。）
   --------------------------------------------------------------------------- */
if (token.value) {
  useRemoteAdminRepository(token.value, () => account.value)
  // 刷新页面后账号是未知的（只恢复了令牌）——拉一次 /user 把它填回来。
  // 失败就算了：令牌失效会在真正读写数据时暴露，那时有明确的错误文案。
  void githubRequest<{ login: string }>('/user', token.value)
    .then((user) => {
      account.value = user.login
    })
    .catch(() => {})
}

export interface AdminAuthAPI {
  /** 是否已登录（仅表示本机有令牌，不代表令牌一定还有效） */
  isAuthenticated: typeof isAuthenticated
  /** 登录后拿到的 GitHub 用户名，用于界面显示 */
  account: typeof account
  /** 正在校验令牌 */
  checking: typeof checking
  /** 登录相关的提示 / 错误 */
  notice: typeof notice
  getToken: typeof getToken
  login: typeof login
  logout: typeof logout
}

export function useAdminAuth(): AdminAuthAPI {
  return { isAuthenticated, account, checking, notice, getToken, login, logout }
}
