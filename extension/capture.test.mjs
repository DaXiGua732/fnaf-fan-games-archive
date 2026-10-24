import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { strFromU8, unzipSync } from 'fflate'
import {
  CAPTURE_FORMAT,
  CAPTURE_VERSION,
  GENERATOR,
  buildCaptureFiles,
  captureFileName,
  collectCaptureImages,
  extensionForImage,
} from './src/capture.mjs'

const DATA = {
  sourceUrl: 'https://gamejolt.com/games/test-game/123456',
  gameJoltId: 123456,
  title: 'Test Game',
  author: 'Tester',
  releaseYear: 2021,
  engine: 'Unity',
  ipSeries: 'FNAF',
  description: 'Description',
  shortDescription: 'Short',
  coverImage: 'https://m.gjcdn.net/game-thumbnail/1000/cover.jpg',
  bannerImage: 'https://m.gjcdn.net/game-header/1600/banner.jpg',
  gallery: [
    'https://m.gjcdn.net/game-screenshot/1600/one.jpg',
    'https://m.gjcdn.net/game-screenshot/1600/two.jpg',
    'https://m.gjcdn.net/game-screenshot/1600/one.jpg',
  ],
  videoUrl: '',
  tags: ['fnaf'],
  warnings: [],
}

test('collectCaptureImages：封面 → Banner → 图库，按 URL 去重', () => {
  const images = collectCaptureImages(DATA)
  assert.deepEqual(
    images.map((image) => image.role),
    ['cover', 'banner', 'gallery-1', 'gallery-2'],
  )
  assert.equal(new Set(images.map((image) => image.url)).size, images.length)
})

test('collectCaptureImages：缺图片时不伪造条目', () => {
  assert.deepEqual(
    collectCaptureImages({ coverImage: '', bannerImage: '', gallery: [] }),
    [],
  )
})

test('extensionForImage：Content-Type 优先，URL 后缀兜底', () => {
  assert.equal(extensionForImage('https://x.test/a', 'image/png'), 'png')
  assert.equal(extensionForImage('https://x.test/a.webp', 'application/octet-stream'), 'webp')
  assert.equal(extensionForImage('https://x.test/a.jpeg', ''), 'jpg')
  assert.equal(extensionForImage('https://x.test/a', ''), 'jpg')
  // SVG 不在白名单里，宁可当 jpg 让后台解码失败，也不留下可执行内容
  assert.equal(extensionForImage('https://x.test/a.svg', 'image/svg+xml'), 'jpg')
})

test('buildCaptureFiles：ZIP 里有 manifest / capture / 图片 / 说明', () => {
  const result = buildCaptureFiles(
    DATA,
    [
      {
        url: DATA.coverImage,
        role: 'cover',
        contentType: 'image/jpeg',
        bytes: new Uint8Array([1, 2, 3]),
      },
      {
        url: DATA.gallery[0],
        role: 'gallery-1',
        contentType: 'image/jpeg',
        bytes: new Uint8Array([4, 5, 6]),
      },
    ],
    { fetchedAt: '2026-10-24T12:34:56.000Z', generator: 'test/1.0.0' },
  )

  const files = unzipSync(result.bytes)
  assert.deepEqual(
    Object.keys(files).sort(),
    ['README.txt', 'capture.json', 'images/cover.jpg', 'images/gallery-1.jpg', 'manifest.json'],
  )

  const manifest = JSON.parse(strFromU8(files['manifest.json']))
  assert.equal(manifest.format, CAPTURE_FORMAT)
  assert.equal(manifest.version, CAPTURE_VERSION)
  assert.equal(manifest.sourceUrl, DATA.sourceUrl)
  assert.equal(manifest.gameJoltId, DATA.gameJoltId)
  assert.equal(manifest.fetchedAt, '2026-10-24T12:34:56.000Z')
  assert.equal(manifest.generator, 'test/1.0.0')
  assert.deepEqual(manifest.images, [
    {
      url: DATA.coverImage,
      file: 'images/cover.jpg',
      role: 'cover',
      contentType: 'image/jpeg',
    },
    {
      url: DATA.gallery[0],
      file: 'images/gallery-1.jpg',
      role: 'gallery-1',
      contentType: 'image/jpeg',
    },
  ])

  const capture = JSON.parse(strFromU8(files['capture.json']))
  assert.equal(capture.title, DATA.title)
  assert.deepEqual(files['images/cover.jpg'], new Uint8Array([1, 2, 3]))
  assert.match(strFromU8(files['README.txt']), /FNAF 档案/)
})

test('buildCaptureFiles：没有图片也能生成可导入的包', () => {
  const result = buildCaptureFiles(DATA, [], {
    fetchedAt: '2026-10-24T12:34:56.000Z',
    generator: 'test/1.0.0',
  })
  const files = unzipSync(result.bytes)
  assert.ok(files['manifest.json'])
  assert.ok(files['capture.json'])
  const manifest = JSON.parse(strFromU8(files['manifest.json']))
  assert.deepEqual(manifest.images, [])
})

test('captureFileName：slug + id + UTC 时间', () => {
  const name = captureFileName(DATA, new Date('2026-10-24T12:34:56.000Z'))
  assert.equal(name, 'test-game-123456-20261024-123456.zip')
})

test('manifest.json 的版本与 GENERATOR 一致', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'),
  )
  assert.equal(GENERATOR, `fnaf-archive-extension/${manifest.version}`)
  assert.equal(manifest.manifest_version, 3)
  assert.deepEqual(manifest.content_scripts[0].js, ['content.js'])
})
