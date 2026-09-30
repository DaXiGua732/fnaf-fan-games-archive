/**
 * 数据仓坐标 —— 全站只此一份。
 *
 * 这些是**公开信息**（仓库本来就是 Public），所以写死在代码里没问题，
 * 也不需要任何构建期注入或环境变量。
 */
import type { GithubRepoRef } from '../services/githubApi'

export const DATA_REPO: GithubRepoRef = {
  owner: 'DaXiGua732',
  repo: 'fnaf-fan-games-data',
  branch: 'main',
  path: 'db.json',
}

/**
 * 数据仓的 GitHub Pages 基地址 —— 图片的公开访问前缀。
 *
 * 用它拼出来的**完整外链**会被前台的 `assetUrl()` 原样放行，
 * 所以图片换到数据仓托管之后，前台一行代码都不用改。
 *
 * ⚠️ Pages 域名用小写 owner（GitHub 的域名不区分大小写，但小写是实际形式）。
 */
export function dataRepoPagesBase(ref: GithubRepoRef = DATA_REPO): string {
  return `https://${ref.owner.toLowerCase()}.github.io/${ref.repo}`
}
