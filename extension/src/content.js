/**
 * ============================================================================
 * GameJolt → FNAF 档案 · 浏览器扩展 content script
 * ============================================================================
 * 运行在 gamejolt.com 页面里，因此 `/site-api` 是**同源请求**：
 * 不需要本机助手，也不需要任何跨域代理。图片 CDN 带 ACAO: *，可以直接下载。
 *
 * 流程：
 *   作品页 → 点右下角按钮 → 抓元数据 → 下载图片 → 打包 ZIP → 触发下载
 *   然后到后台「从 GameJolt 导入」把 ZIP 拖进去。
 *
 * 安全边界：
 *   - 只在 gamejolt.com 上运行；
 *   - 不读取、不发送 GitHub 令牌；
 *   - 一次点击只抓一个作品，不做批量爬取。
 * ============================================================================
 */
import {
  BROWSER_REQUEST_HEADERS,
  fetchGameJoltGame,
} from '../../scripts/gamejolt/fetch.mjs'
import {
  buildCaptureFiles,
  captureFileName,
  collectCaptureImages,
} from './capture.mjs'

const ROOT_ID = 'fnaf-archive-capture-root'
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const GAME_PATH = /^\/games\/(?:[^/]+\/)?\d+(?:\/|$)/

let busy = false
let downloadUrl = ''
let elements = null

function isGamePage() {
  return GAME_PATH.test(window.location.pathname)
}

function setStatus(message, tone = 'normal') {
  if (!elements) return
  elements.status.textContent = message
  elements.status.dataset.tone = tone
  elements.panel.hidden = false
}

function revokeDownloadUrl() {
  if (!downloadUrl) return
  URL.revokeObjectURL(downloadUrl)
  downloadUrl = ''
}

function createUi() {
  if (document.getElementById(ROOT_ID)) return

  const root = document.createElement('div')
  root.id = ROOT_ID
  root.hidden = true

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'fnaf-capture-button'
  button.textContent = '导出到 FNAF 档案'
  button.title = '把当前 GameJolt 作品抓取为 ZIP，供站点后台导入'

  const panel = document.createElement('section')
  panel.className = 'fnaf-capture-panel'
  panel.hidden = true
  panel.setAttribute('aria-live', 'polite')

  const header = document.createElement('div')
  header.className = 'fnaf-capture-header'

  const title = document.createElement('strong')
  title.textContent = 'GameJolt 抓取'

  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'fnaf-capture-close'
  close.textContent = '关闭'
  close.setAttribute('aria-label', '关闭抓取面板')
  close.addEventListener('click', () => {
    panel.hidden = true
    revokeDownloadUrl()
    if (elements?.download) {
      elements.download.hidden = true
      elements.download.removeAttribute('href')
    }
  })

  header.append(title, close)

  const status = document.createElement('p')
  status.className = 'fnaf-capture-status'
  status.textContent = '等待开始。'

  const download = document.createElement('a')
  download.className = 'fnaf-capture-download'
  download.hidden = true
  download.download = 'gamejolt-capture.zip'
  download.textContent = '下载 ZIP'

  const hint = document.createElement('p')
  hint.className = 'fnaf-capture-hint'
  hint.textContent = '下载后在站点后台「从 GameJolt 导入」里拖入 ZIP。游戏文件仍需人工补充。'

  panel.append(header, status, download, hint)
  root.append(panel, button)
  document.body.append(root)

  button.addEventListener('click', () => {
    void startCapture()
  })

  elements = { root, button, panel, status, download }

  // SPA 路由变化不会重新注入 content script；用轻量轮询控制按钮显示。
  const syncVisibility = () => {
    if (busy) return
    const visible = isGamePage()
    root.hidden = !visible
    if (!visible) panel.hidden = true
  }
  syncVisibility()
  window.setInterval(syncVisibility, 800)
}

function errorMessage(cause) {
  return cause instanceof Error ? cause.message : '未知错误'
}

async function fetchImage(url, role, index, total) {
  setStatus(`正在下载图片 ${index + 1}/${total}…`)

  let response
  try {
    response = await fetch(url, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
    })
  } catch {
    throw new Error('图片下载被浏览器拦下（网络或跨域问题）')
  }

  if (!response.ok) throw new Error(`图片下载失败（HTTP ${response.status}）`)

  const contentType = (response.headers.get('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (!contentType.startsWith('image/')) throw new Error('返回的内容不是图片')

  const blob = await response.blob()
  if (blob.size > MAX_IMAGE_BYTES) {
    throw new Error(`图片超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB`)
  }

  return {
    url,
    role,
    contentType,
    bytes: new Uint8Array(await blob.arrayBuffer()),
  }
}

function triggerDownload(bytes, filename) {
  revokeDownloadUrl()

  const blob = new Blob([bytes], { type: 'application/zip' })
  downloadUrl = URL.createObjectURL(blob)

  const link = elements.download
  link.href = downloadUrl
  link.download = filename
  link.textContent = `下载 ${filename}`
  link.hidden = false
  link.click()
}

async function startCapture() {
  if (busy) return
  if (!isGamePage()) {
    setStatus('请先打开一个 GameJolt 作品页，再点导出。', 'error')
    return
  }

  busy = true
  elements.button.disabled = true
  elements.download.hidden = true
  revokeDownloadUrl()
  setStatus('正在抓取作品信息…')

  try {
    const data = await fetchGameJoltGame(window.location.href, {
      headers: BROWSER_REQUEST_HEADERS,
    })

    const candidates = collectCaptureImages(data).slice(0, 16)
    const images = []
    const warnings = [...(data.warnings || [])]

    for (const [index, candidate] of candidates.entries()) {
      try {
        images.push(await fetchImage(candidate.url, candidate.role, index, candidates.length))
      } catch (cause) {
        warnings.push(`${candidate.role}：${errorMessage(cause)}`)
      }
    }

    if (warnings.length) {
      data.warnings = [...new Set(warnings)]
    }

    setStatus('正在打包 ZIP…')
    const { bytes } = buildCaptureFiles(data, images, {
      fetchedAt: new Date().toISOString(),
    })
    const filename = captureFileName(data)
    triggerDownload(bytes, filename)

    const missing = candidates.length - images.length
    const suffix = missing > 0 ? `，${missing} 张图片未取到` : ''
    setStatus(`已打包 ${images.length} 张图片${suffix}。ZIP 下载已开始。`, 'success')
  } catch (cause) {
    setStatus(`导出失败：${errorMessage(cause)}`, 'error')
  } finally {
    busy = false
    elements.button.disabled = false
  }
}

if (document.body) {
  createUi()
} else {
  window.addEventListener('DOMContentLoaded', createUi, { once: true })
}
