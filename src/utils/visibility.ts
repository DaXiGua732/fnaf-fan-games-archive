/**
 * 公开可见性判据：**已上线且未归档**。
 *
 * 「归档」是与 `status` 正交的独立标记，所以判据必须是两项相与 ——
 * 只看 status 会让「已归档的作品仍在前台展示」。
 *
 * 单独放在这里是为了让纯工具（资料质量检查）与前台深模块共用同一条规则，
 * 而不是各自写一遍 `status === 'published' && !archived`。
 */
import type { AdminGame } from '../types/admin'

export function isPubliclyVisible(game: Pick<AdminGame, 'status' | 'archived'>): boolean {
  return game.status === 'published' && !game.archived
}
