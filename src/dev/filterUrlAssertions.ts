/**
 * filterUrl 纯函数断言（Phase 3）
 *
 * URL 状态是「刷新 / 复制链接 / 前进后退」的唯一载体，坏一个分支就是
 * 用户看到一组对不上的筛选结果。这里不碰 Vue，也不需要浏览器。
 */
import type { Assertion } from './libraryAssertions'
import {
  emptyFilterQuery,
  filterQuerySignature,
  parseFilterQuery,
  serializeFilterQuery,
  type FilterUrlOptions,
} from '../utils/filterUrl'

const OPTIONS: FilterUrlOptions = {
  sorts: ['recommended', 'views', 'score', 'title', 'year'],
  defaultSort: 'views',
}

export function runFilterUrlAssertions(): Assertion[] {
  const results: Assertion[] = []
  const check = (name: string, actual: unknown, expected: unknown): void => {
    const a = String(actual)
    const e = String(expected)
    results.push({ name, expected: e, actual: a, pass: a === e })
  }

  const empty = parseFilterQuery({}, OPTIONS)
  check('空 URL · 搜索为空', empty.search, '')
  check('空 URL · 默认排序', empty.sort, 'views')
  check('空 URL · 第 1 页', empty.page, 1)
  check('空 URL · 所有维度为空', empty.author.length + empty.year.length, 0)

  const parsed = parseFilterQuery(
    {
      q: '  Hello  ',
      sort: 'title',
      page: '2',
      author: ['A', 'B', 'A', '  '],
      year: ['2019', '2020'],
      gameplay: 'traditional-night-watch',
      mechanic: ['security-cameras'],
      tag: 'Jolly',
      platform: ['windows'],
      engine: ['UE4'],
      unknown: 'ignored',
    },
    OPTIONS,
  )
  check('q 去首尾空白', parsed.search, 'Hello')
  check('sort 保留合法值', parsed.sort, 'title')
  check('page 解析', parsed.page, 2)
  check('重复参数去重保序', parsed.author.join(','), 'A,B')
  check('单值参数归一为数组', parsed.gameplay.join(','), 'traditional-night-watch')
  check('年份多值', parsed.year.join(','), '2019,2020')

  const bad = parseFilterQuery({ sort: 'nope', page: '-3', year: ['abc'] }, OPTIONS)
  check('非法排序回退默认', bad.sort, 'views')
  check('非法页码回退 1', bad.page, 1)
  check('年份原样保留（有效性由目录判断）', bad.year.join(','), 'abc')

  const state = {
    ...emptyFilterQuery(),
    search: 'needle',
    sort: 'score',
    page: 3,
    author: ['A', 'B'],
    gameplay: ['gt-a'],
    tag: ['Jolly'],
  }
  const params = serializeFilterQuery(state, OPTIONS)
  check('序列化 · q', params.q, 'needle')
  check('序列化 · sort', params.sort, 'score')
  check('序列化 · page', params.page, '3')
  check('序列化 · 多值保持数组', Array.isArray(params.author), true)

  const defaults = serializeFilterQuery(
    { ...emptyFilterQuery(), sort: 'views', page: 1 },
    OPTIONS,
  )
  check('默认值不写进 URL', Object.keys(defaults).length, 0)

  const roundtrip = parseFilterQuery(params, OPTIONS)
  check('序列化 → 解析 · q', roundtrip.search, 'needle')
  check('序列化 → 解析 · sort', roundtrip.sort, 'score')
  check('序列化 → 解析 · page', roundtrip.page, 3)
  check('序列化 → 解析 · author', roundtrip.author.join(','), 'A,B')
  check('序列化 → 解析 · gameplay', roundtrip.gameplay.join(','), 'gt-a')

  check(
    '签名与键顺序无关',
    filterQuerySignature({ author: ['A'], q: 'x' }, OPTIONS) ===
      filterQuerySignature({ q: 'x', author: 'A' }, OPTIONS),
    true,
  )
  check(
    '签名忽略未知参数',
    filterQuerySignature({ q: 'x', future: '1' }, OPTIONS) ===
      filterQuerySignature({ q: 'x' }, OPTIONS),
    true,
  )
  check(
    '签名区分多值',
    filterQuerySignature({ author: ['A', 'B'] }, OPTIONS) ===
      filterQuerySignature({ author: ['A'] }, OPTIONS),
    false,
  )

  return results
}
