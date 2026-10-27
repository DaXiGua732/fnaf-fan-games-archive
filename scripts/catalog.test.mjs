/**
 * 数据仓文档读写契约测试。
 *
 * 这条契约最容易被忽视、代价也最大：
 * `data:pull` 在每次部署前运行，只要它把顶层 `taxonomy` 抹掉，
 * 下一次构建的快照里词表就会凭空消失（数据仓本身还在，所以更难排查）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseCatalogDocument,
  serializeCatalogDocument,
} from './catalog-document.mjs'

test('parseCatalogDocument 保留整个顶层对象与词表', () => {
  const raw = {
    taxonomy: { gameplayTypes: [{ id: 'gt-a', name: '玩法' }] },
    futureKey: { keep: true },
    games: [{ id: 'a', title: 'A' }],
  }
  const document = parseCatalogDocument(JSON.stringify(raw))

  assert.deepEqual(document.games, raw.games)
  assert.deepEqual(document.raw.taxonomy, raw.taxonomy)
  assert.deepEqual(document.raw.futureKey, raw.futureKey)
})

test('serializeCatalogDocument 覆盖 games 但保留 taxonomy 与未知键', () => {
  const raw = {
    taxonomy: { mechanics: [{ id: 'mc-a', name: '机制' }] },
    futureKey: ['keep'],
    games: [{ id: 'old' }],
  }
  const text = serializeCatalogDocument(raw, [{ id: 'new' }])
  const parsed = JSON.parse(text)

  assert.deepEqual(parsed.games, [{ id: 'new' }])
  assert.deepEqual(parsed.taxonomy, raw.taxonomy)
  assert.deepEqual(parsed.futureKey, ['keep'])
  assert.ok(text.endsWith('\n'))
  assert.ok(text.includes('\n  "games"'))
})

test('parseCatalogDocument 拒绝非法 JSON / 顶层数组 / 缺少 games', () => {
  assert.throws(() => parseCatalogDocument('{'), /不是合法 JSON/)
  assert.throws(() => parseCatalogDocument('[]'), /顶层应当是一个对象/)
  assert.throws(() => parseCatalogDocument('{"taxonomy":{}}'), /没有 games 数组/)
  assert.throws(() => parseCatalogDocument('null'), /顶层应当是一个对象/)
})
