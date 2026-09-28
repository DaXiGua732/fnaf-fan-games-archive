/**
 * 占位图生成器
 * 读取 src/data/db.json，为每款游戏生成 Swiss International Style 风格的
 * 本地占位 SVG（封面 16:9 + Banner 8:3）到 public/images/。
 *
 * 用法：node scripts/gen-placeholders.mjs
 * 说明：真实的封面/Banner 后续替换为同名文件即可，db.json 无需改动。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const OUT_DIR = resolve(ROOT, 'public/images')

const SVG_NS = 'http://www.w3.org/2000/svg'
const FONT = 'Helvetica, Arial, sans-serif'
const INK = '#000000'
const PAPER = '#ffffff'
const ACCENT = '#ff0000'
const LINE = '#cccccc'

const escapeXml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

/** 按字符数折行（标题均为英文单词，空格切分即可） */
function wrap(text, maxChars) {
  const words = String(text).split(/\s+/)
  const lines = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length > maxChars && current) {
      lines.push(current)
      current = word
    } else {
      current = next
    }
  }
  if (current) lines.push(current)
  return lines
}

/**
 * @param {{ width:number, height:number, titleSize:number, lineHeight:number,
 *           titleTop:number, maxChars:number, pad:number, index:number, game:object }} opts
 */
function render(opts) {
  const { width, height, titleSize, lineHeight, titleTop, maxChars, pad, index, game } = opts
  const lines = wrap(game.title.toUpperCase(), maxChars)

  const titleSpans = lines
    .map(
      (line, i) =>
        `<text x="${pad}" y="${titleTop + i * lineHeight}" font-family="${FONT}" font-size="${titleSize}" font-weight="700" letter-spacing="-2" fill="${INK}">${escapeXml(line)}</text>`,
    )
    .join('')

  const metaY = height - pad
  const barHeight = Math.round(height * 0.035)

  return `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(game.title)}">
  <rect width="${width}" height="${height}" fill="${PAPER}" />
  <rect x="0" y="0" width="${width}" height="${barHeight}" fill="${ACCENT}" />
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" fill="none" stroke="${INK}" stroke-width="2" />
  <line x1="${pad}" y1="${barHeight + Math.round(height * 0.09)}" x2="${width - pad}" y2="${barHeight + Math.round(height * 0.09)}" stroke="${LINE}" stroke-width="1" />
  <text x="${pad}" y="${barHeight + Math.round(height * 0.08)}" font-family="${FONT}" font-size="${Math.round(titleSize * 0.26)}" font-weight="700" letter-spacing="3" fill="${INK}">FNAF FAN GAMES ARCHIVE</text>
  ${titleSpans}
  <text x="${pad}" y="${metaY}" font-family="${FONT}" font-size="${Math.round(titleSize * 0.26)}" font-weight="700" letter-spacing="2" fill="${INK}">${escapeXml(game.author.toUpperCase())} — ${game.releaseYear}</text>
  <text x="${pad}" y="${metaY - Math.round(titleSize * 0.48)}" font-family="${FONT}" font-size="${Math.round(titleSize * 0.26)}" letter-spacing="2" fill="${INK}" opacity="0.55">${escapeXml(game.ipSeries.toUpperCase())}</text>
  <text x="${width - pad}" y="${metaY}" text-anchor="end" font-family="${FONT}" font-size="${Math.round(titleSize * 0.26)}" font-weight="700" letter-spacing="2" fill="${ACCENT}">NO.${String(index).padStart(2, '0')}</text>
</svg>
`
}

const db = JSON.parse(readFileSync(resolve(ROOT, 'src/data/db.json'), 'utf8'))
mkdirSync(OUT_DIR, { recursive: true })

let written = 0
db.games.forEach((game, i) => {
  const index = i + 1

  writeFileSync(
    resolve(OUT_DIR, `${game.id}-cover.svg`),
    render({
      width: 800,
      height: 450,
      titleSize: 54,
      lineHeight: 60,
      titleTop: 232,
      maxChars: 20,
      pad: 48,
      index,
      game,
    }),
  )

  writeFileSync(
    resolve(OUT_DIR, `${game.id}-banner.svg`),
    render({
      width: 1600,
      height: 600,
      titleSize: 92,
      lineHeight: 100,
      titleTop: 320,
      maxChars: 22,
      pad: 80,
      index,
      game,
    }),
  )

  written += 2
})

console.log(`[gen-placeholders] 已生成 ${written} 个 SVG 到 public/images/`)
