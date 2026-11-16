





import crypto from "node:crypto"
import fs from "node:fs"
import http from "node:http"
import https from "node:https"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { HttpsProxyAgent } from "https-proxy-agent"
import { decode as decodeSilk, isSilk } from "silk-wasm"

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

export const FREE_VOICES = [
  { value: "zh", label: "中文女声（默认）" },
  { value: "en", label: "英文女声" },
  { value: "jp", label: "日文女声" },
]

export const EDGE_VOICES = FREE_VOICES

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

export async function freeTTS(text, options = {}) {
  const lang = FREE_VOICES.some(item => item.value === options.voice) ? options.voice : "zh"
  const speed = freeVoiceSpeed(options.speed)
  const timeout = Math.max(5000, Number(options.timeout) || 30000)

  const segments = splitText(String(text || ""), MAX_TEXT)
  if (!segments.length) throw new Error("待合成文本为空")
  const buffers = []
  for (const segment of segments) {
    buffers.push(await fetchSegment(segment, lang, speed, timeout))
  }
  return Buffer.concat(buffers)
}

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

export const edgeTTS = freeTTS

export function customVoiceSpeed(value) {
  const speed = Number(value)
  if (!Number.isFinite(speed) || speed <= 0) return 1
  return Math.min(4, Math.max(0.25, speed))
}

export function freeVoiceSpeed(value) {
  const speed = Number(value)
  if (!Number.isFinite(speed) || speed <= 0) return 5
  return Math.min(15, Math.max(1, Math.round(speed)))
}

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

export async function synthesize(text, config = {}) {
  const provider = String(config.provider || "free").toLowerCase() === "custom" ? "custom" : "free"
  const custom = provider === "custom"
  const voice = String(config.voice || (custom ? "alloy" : "zh")).slice(0, 40)
  const speed = custom ? customVoiceSpeed(config.speed) : freeVoiceSpeed(config.speed)
  fs.mkdirSync(CACHE_DIR, { recursive: true })

  const content = String(text || "").trim()
  if (!content) throw new Error("待合成文本为空")

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

const STT_MAX_BYTES = 20 * 1024 * 1024
const STT_TIMEOUT = 60000
const STT_CONCURRENCY = 3
const STT_CACHE_SIZE = 200
const transcriptCache = new Map()
let sttRunning = 0
const sttQueue = []

function sttLimit(task) {
  return new Promise((resolve, reject) => {
    const run = () => {
      sttRunning++
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          sttRunning--
          const next = sttQueue.shift()
          if (next) next()
        })
    }
    if (sttRunning < STT_CONCURRENCY) run()
    else sttQueue.push(run)
  })
}

function pcmToWav(pcm, sampleRate = 24000) {
  const header = Buffer.alloc(44)
  header.write("RIFF", 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write("WAVEfmt ", 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write("data", 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

async function silkToWav(buffer) {
  let data = Buffer.from(buffer)

  if (data[0] !== 0x02 && data.subarray(0, 9).toString("latin1") === "#!SILK_V3")
    data = Buffer.concat([Buffer.from([0x02]), data])
  const result = await decodeSilk(data, 24000)
  return pcmToWav(Buffer.from(result.data), 24000)
}

function looksLikeSilk(buffer) {
  if (!buffer?.length) return false
  if (buffer[0] === 0x02 && buffer.subarray(1, 10).toString("latin1") === "#!SILK_V3") return true
  if (buffer.subarray(0, 9).toString("latin1") === "#!SILK_V3") return true
  try {
    return isSilk(buffer)
  } catch {
    return false
  }
}


export async function prepareAudioForStt(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("语音内容为空")
  if (buffer.length > STT_MAX_BYTES) throw new Error("语音文件过大")
  if (looksLikeSilk(buffer)) {
    try {
      return { buffer: await silkToWav(buffer), format: "wav", mime: "audio/wav" }
    } catch (error) {
      throw new Error(`语音解码失败：${error.message}`)
    }
  }
  const head = buffer.subarray(0, 12)
  if (head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WAVE")
    return { buffer, format: "wav", mime: "audio/wav" }
  if (head.subarray(0, 4).toString("latin1") === "OggS")
    return { buffer, format: "ogg", mime: "audio/ogg" }
  if (head.subarray(0, 5).toString("latin1") === "#!AMR")
    return { buffer, format: "amr", mime: "audio/amr" }
  if (head.subarray(4, 8).toString("latin1") === "ftyp")
    return { buffer, format: "m4a", mime: "audio/mp4" }
  if (head.subarray(0, 3).toString("latin1") === "ID3" || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0))
    return { buffer, format: "mp3", mime: "audio/mpeg" }
  throw new Error("无法识别的语音格式")
}

function encodeMultipartField(boundary, name, value) {
  return Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    "utf8",
  )
}

function postMultipart(urlString, fields, file, options = {}) {
  return new Promise((resolve, reject) => {
    let target
    try {
      target = new URL(urlString)
    } catch {
      return reject(new Error("语音识别接口地址无效"))
    }
    const boundary = `----YunzaiVoice${crypto.randomBytes(8).toString("hex")}`
    const chunks = Object.entries(fields).map(([name, value]) =>
      encodeMultipartField(boundary, name, String(value)),
    )
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.mime}\r\n\r\n`,
        "utf8",
      ),
      file.buffer,
      Buffer.from("\r\n", "utf8"),
    )
    chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf8"))
    const body = Buffer.concat(chunks)
    const transport = target.protocol === "http:" ? http : https
    let agent
    if (options.proxyUrl) {
      try {
        agent = new HttpsProxyAgent(options.proxyUrl)
      } catch {
        return reject(new Error("语音识别代理配置无效"))
      }
    }
    const req = transport.request(
      target,
      {
        method: "POST",
        agent,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
          "User-Agent": "Yunzai-AI-Voice/1.0",
          ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
        },
      },
      res => {
        const parts = []
        let size = 0
        res.on("data", chunk => {
          size += chunk.length
          if (size > 1024 * 1024) {
            req.destroy(new Error("语音识别响应过大"))
            return
          }
          parts.push(chunk)
        })
        res.on("end", () =>
          resolve({ status: res.statusCode || 0, body: Buffer.concat(parts) }),
        )
      },
    )
    const timeout = Math.max(5000, Number(options.timeout) || STT_TIMEOUT)
    req.setTimeout(timeout, () => req.destroy(new Error(`语音识别请求超时 (${timeout}ms)`)))
    req.on("error", reject)
    req.end(body)
  })
}

function cleanServiceError(text, apiKey) {
  let value = String(text || "").replace(/\s+/g, " ").trim()
  if (apiKey) value = value.split(String(apiKey)).join("***")
  return value.slice(0, 200)
}

async function requestTranscription(prepared, config) {
  const base = String(config.baseURL || "").replace(/\/+$/, "")
  if (!base) throw new Error("未配置语音识别接口")
  const model = String(config.model || "").trim()
  if (!model) throw new Error("未配置语音识别模型")
  const endpoint = /\/audio\/transcriptions$/i.test(base) ? base : `${base}/audio/transcriptions`
  const fields = { model, response_format: "json" }
  if (config.language) fields.language = String(config.language)
  const response = await postMultipart(
    endpoint,
    fields,
    { filename: `voice.${prepared.format}`, mime: prepared.mime, buffer: prepared.buffer },
    {
      apiKey: config.apiKey,
      proxyUrl: config.proxyUrl,
      timeout: config.timeout,
    },
  )
  const raw = response.body.toString("utf8").trim()
  if (response.status < 200 || response.status >= 300) {
    let detail = raw
    try {
      const parsed = JSON.parse(raw)
      detail = parsed.error?.message || parsed.message || raw
    } catch {}
    throw new Error(
      `语音识别服务返回 ${response.status}${detail ? `：${cleanServiceError(detail, config.apiKey)}` : ""}`,
    )
  }
  if (!raw) return ""
  try {
    const parsed = JSON.parse(raw)
    return String(parsed.text ?? parsed.data?.text ?? parsed.result ?? "").trim().slice(0, 4000)
  } catch {
    return raw.slice(0, 4000)
  }
}


export async function transcribeAudio(buffer, config = {}) {
  const prepared = await prepareAudioForStt(buffer)
  const cacheKey = crypto
    .createHash("sha1")
    .update(prepared.buffer)
    .update(`|${config.baseURL || ""}|${config.model || ""}|${config.language || ""}`)
    .digest("hex")
  if (transcriptCache.has(cacheKey)) return transcriptCache.get(cacheKey)
  return sttLimit(async () => {
    if (transcriptCache.has(cacheKey)) return transcriptCache.get(cacheKey)
    const text = await requestTranscription(prepared, config)
    transcriptCache.set(cacheKey, text)
    while (transcriptCache.size > STT_CACHE_SIZE) transcriptCache.delete(transcriptCache.keys().next().value)
    return text
  })
}


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
