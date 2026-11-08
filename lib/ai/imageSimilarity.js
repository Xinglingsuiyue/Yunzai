import RendererLoader from "../renderer/loader.js"

const DCT_SIZE = 32
const KEEP = 16
const HASH_TIMEOUT = 20000
const HASH_PREFIX = "ph16"

let page = null
let queue = Promise.resolve()
let warned = false

function warnOnce(error) {
  if (warned) return
  warned = true
  try {
    globalThis.Bot?.makeLog?.("warn", ["表情相似度检查不可用，本次照常保存", error?.message || error], "表情包")
  } catch {}
}

async function getPage() {
  if (page && !page.isClosed()) return page
  const backend = RendererLoader.renderers?.get("puppeteer")
  const browser = backend?.browser || (await backend?.browserInit?.())
  if (!browser) throw new Error("Chromium 未就绪")
  page = await browser.newPage()
  page.setDefaultTimeout?.(HASH_TIMEOUT)
  return page
}

function runExclusive(task) {
  const next = queue.then(async () => {
    try {
      return await task(await getPage())
    } catch (error) {
      if (page?.isClosed?.()) page = null
      throw error
    }
  })
  queue = next.then(
    () => {},
    () => {},
  )
  return next
}

function withTimeout(promise) {
  let timer = null
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("表情指纹计算超时")), HASH_TIMEOUT)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function bitsToHex(bits) {
  let hex = ""
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  return hex
}

export async function computeImageHash(buffer, mimeType = "image/png") {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return ""
  const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`
  try {
    const bits = await withTimeout(
      runExclusive(target =>
        target.evaluate(
          async (url, size, keep) => {
            const img = new Image()
            img.src = url
            if (!img.complete) {
              await new Promise((resolve, reject) => {
                img.onload = resolve
                img.onerror = () => reject(new Error("图片解码失败"))
              })
            }
            if (!img.naturalWidth) throw new Error("图片解码失败")

            const canvas = document.createElement("canvas")
            canvas.width = size
            canvas.height = size
            const ctx = canvas.getContext("2d", { willReadFrequently: true })
            ctx.fillStyle = "#fff"
            ctx.fillRect(0, 0, size, size)
            ctx.drawImage(img, 0, 0, size, size)
            const { data } = ctx.getImageData(0, 0, size, size)

            const gray = new Float64Array(size * size)
            for (let i = 0; i < gray.length; i++)
              gray[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114

            const cos = []
            for (let u = 0; u < keep; u++) {
              cos[u] = new Float64Array(size)
              for (let x = 0; x < size; x++)
                cos[u][x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * size))
            }
            const coeff = []
            for (let v = 0; v < keep; v++)
              for (let u = 0; u < keep; u++) {
                if (!u && !v) continue
                let sum = 0
                for (let y = 0; y < size; y++) {
                  let row = 0
                  for (let x = 0; x < size; x++) row += gray[y * size + x] * cos[u][x]
                  sum += row * cos[v][y]
                }
                coeff.push(sum)
              }

            const sorted = [...coeff].sort((a, b) => a - b)
            const median = sorted[Math.floor(sorted.length / 2)]
            let bits = ""
            for (const value of coeff) bits += value > median ? "1" : "0"
            return bits + "0"
          },
          dataUrl,
          DCT_SIZE,
          KEEP,
        ),
      ),
    )
    return bits ? `${HASH_PREFIX}:${bitsToHex(bits)}` : ""
  } catch (error) {
    warnOnce(error)
    return ""
  }
}

export function hashSimilarity(left, right) {
  const [leftVersion, leftHex] = String(left || "").split(":")
  const [rightVersion, rightHex] = String(right || "").split(":")
  if (!leftHex || !rightHex || leftVersion !== rightVersion || leftHex.length !== rightHex.length) return 0
  let diff = 0
  for (let i = 0; i < leftHex.length; i++) {
    let value = parseInt(leftHex[i], 16) ^ parseInt(rightHex[i], 16)
    while (value) {
      diff += value & 1
      value >>= 1
    }
  }
  const total = leftHex.length * 4
  return total ? ((total - diff) / total) * 100 : 0
}
