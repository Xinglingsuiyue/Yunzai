/**
 * 语音合成 — 默认走免费的百度翻译朗读接口，也可填自定义服务商的 HTTP 接口。
 *
 * 免费通道无需密钥，中文质量可用；自定义服务按 OpenAI 兼容的 /audio/speech 处理。
 * （Edge-TTS 的免费 WebSocket 通道已被微软封禁，不再使用。）
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const BASE_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(BASE_DIR, "..", "..")
const CACHE_DIR = path.join(PROJECT_ROOT, "data", "voice_cache")

const MAX_TEXT = 120
const BAIDU_TTS = "https://fanyi.baidu.com/gettts"
const BAIDU_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Referer: "https://fanyi.baidu.com/",
  "Accept-Language": "zh-CN,zh;q=0.9",
}

/** 免费音色（百度朗读） */
export const FREE_VOICES = [
  { value: "zh", label: "中文女声（默认）" },
  { value: "en", label: "英文女声" },
  { value: "jp", label: "日文女声" },
]

export const EDGE_VOICES = FREE_VOICES

/** 长文本按标点切分，尽量在句末断开 */
export function splitText(text, maxLength = MAX_TEXT) {
  const value = String(text || "").replace(/\s+/g, " ").trim()
  if (!value) return []
  const parts = []
  let rest = value
  while (rest.length > maxLength) {
    const slice = rest.slice(0, maxLength)
    const cut = Math.max(
      slice.lastIndexOf("。"),
      slice.lastIndexOf("！"),
      slice.lastIndexOf("？"),
      slice.lastIndexOf("，"),
      slice.lastIndexOf(" "),
    )
    const index = cut > maxLength * 0.5 ? cut + 1 : maxLength
    parts.push(rest.slice(0, index))
    rest = rest.slice(index)
  }
  if (rest) parts.push(rest)
  return parts
}

/** 免费通道：百度翻译朗读接口，按语言选音色 */
export async function freeTTS(text, options = {}) {
  const lang = FREE_VOICES.some(item => item.value === options.voice) ? options.voice : "zh"
  const speed = freeVoiceSpeed(options.speed)
  const timeout = Math.max(5000, Number(options.timeout) || 30000)
  // 接口单次长度有限，按句切分后逐段合成再拼接
  const segments = splitText(String(text || ""), MAX_TEXT)
  if (!segments.length) throw new Error("待合成文本为空")
  const buffers = []
  for (const segment of segments) {
    buffers.push(await fetchSegment(segment, lang, speed, timeout))
  }
  return Buffer.concat(buffers)
}

/** 单段合成，失败重试：接口偶发返回 HTML 错误页而非音频 */
async function fetchSegment(segment, lang, speed, timeout, attempt = 1) {
  const params = new URLSearchParams({ lan: lang, text: segment, spd: String(speed), source: "web" })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(`${BAIDU_TTS}?${params}`, {
      headers: BAIDU_HEADERS,
      signal: controller.signal,
    })
    const type = response.headers.get("content-type") || ""
    if (response.ok && type.includes("audio")) {
      return Buffer.from(await response.arrayBuffer())
    }
    const detail = await response.text().catch(() => "")
    if (attempt < 3) {
      clearTimeout(timer)
      await new Promise(resolve => setTimeout(resolve, 400 * attempt))
      return fetchSegment(segment, lang, speed, timeout, attempt + 1)
    }
    const clean = detail.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()
    throw new Error(
      `语音接口返回异常（HTTP ${response.status}${type ? ` ${type}` : ""}${clean ? `：${clean.slice(0, 80)}` : ""}）`,
    )
  } finally {
    clearTimeout(timer)
  }
}

/** 兼容旧名 */
export const edgeTTS = freeTTS

/** 自定义服务的语速范围（OpenAI 兼容接口） */
export function customVoiceSpeed(value) {
  const speed = Number(value)
  if (!Number.isFinite(speed) || speed <= 0) return 1
  return Math.min(4, Math.max(0.25, speed))
}

/** 免费通道的语速范围（百度朗读） */
export function freeVoiceSpeed(value) {
  const speed = Number(value)
  if (!Number.isFinite(speed) || speed <= 0) return 5
  return Math.min(15, Math.max(1, Math.round(speed)))
}

/** 自定义服务商：OpenAI 兼容 /audio/speech */
export async function customTTS(text, config = {}) {
  if (!config.baseURL) throw new Error("未配置语音服务地址")
  const base = String(config.baseURL).replace(/\/+$/, "")
  const url = /\/audio\/speech$/.test(base) ? base : `${base}/audio/speech`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(config.timeout) || 60000))
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model || "tts-1",
        input: String(text || "").slice(0, 2000),
        voice: config.voice || "alloy",
        response_format: config.format || "mp3",
        speed: customVoiceSpeed(config.speed),
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => "")
      throw new Error(`语音服务返回 ${response.status}${detail ? `：${detail.slice(0, 120)}` : ""}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (!buffer.length) throw new Error("语音服务返回空音频")
    return buffer
  } finally {
    clearTimeout(timer)
  }
}

/** 统一入口：按配置选服务商，结果写缓存文件 */
export async function synthesize(text, config = {}) {
  const provider = String(config.provider || "free").toLowerCase() === "custom" ? "custom" : "free"
  const custom = provider === "custom"
  const voice = String(config.voice || (custom ? "alloy" : "zh")).slice(0, 40)
  const speed = custom ? customVoiceSpeed(config.speed) : freeVoiceSpeed(config.speed)
  fs.mkdirSync(CACHE_DIR, { recursive: true })

  const content = String(text || "").trim()
  if (!content) throw new Error("待合成文本为空")

  // 自定义服务的地址、模型与格式都会影响音频，缓存键必须包含；
  // 密钥只参与哈希，不写入缓存或日志
  const identity = custom
    ? [
        String(config.baseURL || "").replace(/\/+$/, ""),
        String(config.model || "tts-1"),
        String(config.format || "mp3"),
        String(config.apiKey || ""),
      ].join("|")
    : ""
  const cacheKey = crypto
    .createHash("sha1")
    .update(`${provider}|${identity}|${voice}|${speed}|${content}`)
    .digest("hex")
    .slice(0, 16)
  const cacheFile = path.join(CACHE_DIR, `${cacheKey}.mp3`)
  if (fs.existsSync(cacheFile) && fs.statSync(cacheFile).size > 0) {
    return { file: cacheFile, cached: true }
  }

  const buffer = custom
    ? await customTTS(content, { ...config, voice, speed })
    : await freeTTS(content, { voice, speed, timeout: config.timeout })

  fs.writeFileSync(cacheFile, buffer)
  return { file: cacheFile, cached: false }
}

/** 清理过期语音缓存，避免无限增长 */
export function cleanVoiceCache(maxAgeMs = 7 * 24 * 3600 * 1000) {
  if (!fs.existsSync(CACHE_DIR)) return 0
  const now = Date.now()
  let removed = 0
  for (const file of fs.readdirSync(CACHE_DIR)) {
    const abs = path.join(CACHE_DIR, file)
    try {
      const stat = fs.statSync(abs)
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(abs)
        removed++
      }
    } catch {}
  }
  return removed
}

export { CACHE_DIR, MAX_TEXT }
