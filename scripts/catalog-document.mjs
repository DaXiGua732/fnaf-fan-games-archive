/**
 * 数据仓 db.json 的最小文档读写工具
 *
 * 【为什么单独抽出来】
 * `pull-data.mjs` 过去只写回 `{ games }`，会把顶层 `taxonomy` 以及未来新增的
 * 任何字段静默抹掉。这里把「解析 / 序列化」收敛成两个纯函数，
 * 并用 `scripts/catalog.test.mjs` 固定住「保留未知顶层键」这条契约。
 *
 * 约束：
 *   - 只要求 `games` 是数组；其它顶层键原样保留。
 *   - 不在这里做游戏 / 词表的归一化 —— 那是前端仓储的职责。
 */

/**
 * @param {string} text
 * @returns {{ raw: Record<string, unknown>, games: unknown[] }}
 */
export function parseCatalogDocument(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('拿到的不是合法 JSON')
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('db.json 顶层应当是一个对象')
  }
  if (!Array.isArray(parsed.games)) {
    throw new Error('db.json 里没有 games 数组')
  }

  return { raw: parsed, games: parsed.games }
}

/**
 * 保留原对象的全部顶层键，只覆盖 `games`。
 * 2 空格缩进 + 末尾换行，与数据仓现有文件保持一致，方便逐行 diff。
 *
 * @param {Record<string, unknown>} raw
 * @param {unknown[]} games
 */
export function serializeCatalogDocument(raw, games) {
  return `${JSON.stringify({ ...raw, games }, null, 2)}\n`
}
