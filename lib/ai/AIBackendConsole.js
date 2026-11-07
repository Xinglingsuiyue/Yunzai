import fs from "node:fs"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { fileURLToPath } from "node:url"
const MAX_OUTPUT = 20000
const MAX_COMMAND = 2000
const HISTORY_LIMIT = 100
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_IMAGE_TOTAL = 64 * 1024 * 1024

const DANGEROUS_PATTERNS = [
  /#?(?:强制)?更新/,
  /#?(?:重启|关机|停止运行|停止服务)/,
  /#?(?:安装|卸载|删除)插件/,
  /#?(?:pnpm|npm|yarn)\s+(?:i|install|remove|add|update)/i,
  /#?(?:执行|运行)命令/,
  /#?shell\b/i,
  /rm\s+-rf/i,
  /(?:^|\s)(?:format|mkfs)\b/i,
]

export default class AIBackendConsole {
  constructor(deps = {}) {
    this.getBot = deps.getBot || (() => globalThis.Bot)
    this.getLoader = deps.getLoader || (() => null)
    this.history = []
    this.running = false

    this.images = new Map()
    this.imageBytes = 0
  }

  static isDangerous(command) {
    const text = String(command || "").trim()
    if (!text) return false
    return DANGEROUS_PATTERNS.some(pattern => pattern.test(text))
  }

  async run(command, options = {}) {
    const text = String(command || "").trim()
    if (!text) throw new Error("指令不能为空")
    if (text.length > MAX_COMMAND) throw new Error(`指令过长（最多 ${MAX_COMMAND} 字）`)
    if (this.running) {
      const stuckMs = Date.now() - (this._runningSince || 0)
      if (stuckMs < 5 * 60 * 1000) throw new Error("上一条指令还在执行，请稍候")
      Bot.makeLog("warn", [`后台指令卡住 ${Math.round(stuckMs / 1000)} 秒，强制释放`], "WebUI")
      this.running = false
    }
    if (AIBackendConsole.isDangerous(text) && options.allowDangerous !== true)
      throw new Error("这条指令可能改动框架或系统，已被后端模式拦截；确认风险后可手动放行")

    const bot = this.getBot()
    if (!bot?.bots) throw new Error("Bot 尚未就绪，请等启动完成再试")
    const loader = this.getLoader()
    if (!loader?.deal) throw new Error("插件加载器不可用")

    const selfId = "stdin"
    this._ensureConsoleBot(bot, selfId)

    const replies = []
    const startedAt = Date.now()

    const consoleStat = bot.bots?.[selfId]?.stat
    if (consoleStat) consoleStat.message_received = (Number(consoleStat.message_received) || 0) + 1
    this.running = true
    this._runningSince = startedAt
    try {
      const event = {
        post_type: "message",
        message_type: "private",
        sub_type: "friend",
        self_id: selfId,
        message_id: Date.now() % 100000000,
        user_id: selfId,
        raw_message: text,

        message: [{ type: "text", text }],
        font: 0,

        sender: { user_id: selfId, nickname: "控制台" },
        time: Math.floor(Date.now() / 1000),

        __backendSessionId: "console",
      }
      const images = []

      const collect = async msg => {
        const { text, images: found } = await this._parseReply(msg)
        if (text) {
          replies.push(text)

          const consoleStat = this.getBot()?.bots?.[selfId]?.stat
          if (consoleStat) consoleStat.message_sent = (Number(consoleStat.message_sent) || 0) + 1

          if (typeof options.onChunk === "function") {
            try {
              options.onChunk(text)
            } catch {}
          }
        }
        for (const image of found) {
          images.push(image)
          if (typeof options.onImage === "function") {
            try {
              options.onImage(image)
            } catch {}
          }
        }
        return { message_id: 0, fake: true }
      }
      event.reply = collect

      await bot.prepareEvent?.(event)

      const timeoutMs = Math.max(30000, Number(options.timeout) || 180000)
      let timer = null
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`指令执行超时（${Math.round(timeoutMs / 1000)} 秒未完成）`)),
          timeoutMs,
        )
        timer.unref?.()
      })
      try {
        await Promise.race([loader.deal(event), timeout])
      } finally {
        if (timer) clearTimeout(timer)
      }

      const output = replies.join("\n").slice(0, MAX_OUTPUT)
      const record = {
        command: text,
        output,
        images,
        selfId,
        userId: selfId,
        durationMs: Date.now() - startedAt,
        at: Date.now(),
        dangerous: AIBackendConsole.isDangerous(text),
      }
      this.history.unshift(record)
      if (this.history.length > HISTORY_LIMIT) {
        for (const dropped of this.history.splice(HISTORY_LIMIT)) this._forgetImages(dropped.images)
      }
      return record
    } finally {
      this.running = false
    }
  }

  _ensureConsoleBot(bot, selfId = "stdin") {
    if (bot.bots[selfId]) return bot.bots[selfId]
    const noop = async () => ({ message_id: 0, fake: true })
    const friend = {
      sendMsg: noop,
      recallMsg: noop,
      sendFile: noop,

      pickMember: () => friend,
      getMsg: async () => null,
    }
    const consoleBot = {
      uin: selfId,
      nickname: "控制台",
      version: { id: selfId, name: "控制台" },
      sdk: {},
      adapter: { id: selfId, name: "控制台" },
      pickFriend: () => friend,
      pickMember: () => friend,
      pickGroup: () => friend,
      pickUser: () => friend,
      sendApi: noop,

      stat: {
        start_time: Math.floor(Date.now() / 1000),
        message_received: 0,
        message_sent: 0,
        get recv_msg_cnt() {
          return this.message_received
        },
        get sent_msg_cnt() {
          return this.message_sent
        },
      },
      fl: new Map([[selfId, { user_id: selfId, nickname: "控制台" }]]),
      gl: new Map(),
      gml: new Map(),
    }
    bot.bots[selfId] = consoleBot
    return consoleBot
  }

  async _parseReply(msg) {
    const acc = { parts: [], images: [] }
    await this._walkReply(msg, acc)
    return { text: acc.parts.join(""), images: acc.images }
  }

  async _walkReply(msg, acc) {
    if (msg === null || msg === undefined) return
    if (typeof msg === "string") {
      await this._walkText(msg, acc)
      return
    }
    if (typeof msg === "number" || typeof msg === "boolean") {
      acc.parts.push(String(msg))
      return
    }
    if (Array.isArray(msg)) {
      for (const item of msg) await this._walkReply(item, acc)
      return
    }
    if (typeof msg !== "object") return
    const data = msg.data || msg
    if (msg.type === "image") {
      const ref = await this._storeImage(data)
      if (ref) acc.images.push(ref)
      else acc.parts.push("[图片]")
      return
    }
    if (msg.type === "node") {
      const nodes = Array.isArray(data) ? data : [data]
      for (let index = 0; index < nodes.length; index++) {
        if (index) acc.parts.push("\n")
        await this._walkReply(nodes[index]?.message ?? nodes[index]?.data?.content, acc)
      }
      return
    }
    const text = AIBackendConsole.stringify(msg)
    if (text) acc.parts.push(text)
  }

  async _walkText(text, acc) {
    if (!text) return
    if (!text.includes("[CQ:image,")) {
      acc.parts.push(text)
      return
    }
    const pattern = /\[CQ:image,([^\]]*)\]/g
    let last = 0
    for (const match of text.matchAll(pattern)) {
      acc.parts.push(text.slice(last, match.index))
      last = match.index + match[0].length
      const params = AIBackendConsole.parseCqParams(match[1])
      const ref = await this._storeImage({ file: params.file, url: params.url, name: params.file })
      if (ref) acc.images.push(ref)
      else acc.parts.push("[图片]")
    }
    acc.parts.push(text.slice(last))
  }

  async _storeImage(data = {}) {
    let buffer = null
    const source = data.file ?? data.buffer
    try {
      if (Buffer.isBuffer(source)) buffer = source
      else if (typeof source === "string" && source) {
        if (source.startsWith("base64://")) buffer = Buffer.from(source.slice(9), "base64")
        else if (/^data:image\//i.test(source)) buffer = AIBackendConsole.decodeDataUri(source)
        else if (/^https?:\/\//i.test(source)) buffer = await AIBackendConsole.fetchImage(source)
        else {
          const abs = AIBackendConsole.resolveImagePath(source)
          if (abs) buffer = fs.readFileSync(abs)
        }
      }
    } catch {}
    if (!buffer && typeof data.url === "string" && /^https?:\/\//i.test(data.url)) {
      try {
        buffer = await AIBackendConsole.fetchImage(data.url)
      } catch {}
    }
    if (!buffer?.length || buffer.length > MAX_IMAGE_BYTES) return null
    const mime = AIBackendConsole.detectImageMime(buffer)
    if (!mime) return null
    return this._rememberImage(buffer, mime, AIBackendConsole.imageName(data))
  }

  static imageName(data = {}) {
    const pick = raw => {
      const text = String(raw || "").trim()
      if (!text || /^(?:base64:\/\/|data:|https?:\/\/)/i.test(text)) return ""

      if (text.length > 200) return ""

      if (/[\u0000-\u001f\uFFFD]/.test(text)) return ""
      return text.replace(/^file:\/\//i, "").split(/[\\/]/).filter(Boolean).pop()?.slice(0, 120) || ""
    }
    return pick(data.name) || pick(data.file) || pick(data.url)
  }

  _rememberImage(buffer, mime, name) {
    while (this.images.size && this.imageBytes + buffer.length > MAX_IMAGE_TOTAL) {
      const oldest = this.images.keys().next().value
      const entry = this.images.get(oldest)
      this.images.delete(oldest)
      this.imageBytes -= entry?.buffer.length || 0
    }
    if (this.imageBytes + buffer.length > MAX_IMAGE_TOTAL) return null
    const id = randomBytes(9).toString("base64url")
    this.images.set(id, { id, buffer, mime, name, at: Date.now() })
    this.imageBytes += buffer.length
    return { id, name }
  }

  getImage(id) {
    return this.images.get(String(id || "")) || null
  }

  _forgetImages(refs) {
    for (const ref of refs || []) {
      const entry = this.images.get(ref?.id)
      if (!entry) continue
      this.images.delete(ref.id)
      this.imageBytes -= entry.buffer.length
    }
  }

  static parseCqParams(raw) {
    const result = {}
    for (const part of String(raw || "").split(",")) {
      const index = part.indexOf("=")
      if (index < 0) continue
      result[part.slice(0, index)] = part
        .slice(index + 1)
        .replace(/&#91;/g, "[")
        .replace(/&#93;/g, "]")
        .replace(/&#44;/g, ",")
        .replace(/&amp;/g, "&")
    }
    return result
  }

  static decodeDataUri(uri) {
    const match = /^data:([^;,]*)(;base64)?,/i.exec(uri)
    if (!match) return null
    const payload = uri.slice(match[0].length)
    if (match[2]) return Buffer.from(payload, "base64")
    try {
      return Buffer.from(decodeURIComponent(payload), "binary")
    } catch {
      return null
    }
  }

  static resolveImagePath(file) {
    let target = String(file || "")
    if (!target) return ""
    if (target.startsWith("file://")) {
      try {
        target = fileURLToPath(target)
      } catch {
        return ""
      }
    }
    const candidates = path.isAbsolute(target)
      ? [target]
      : [target, path.join("data/image", target), path.join("temp", target)]
    for (const item of candidates) {
      try {
        const abs = path.resolve(item)
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs
      } catch {}
    }
    return ""
  }

  static async fetchImage(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: "follow" })
    if (!response.ok) return null
    const type = response.headers.get("content-type") || ""
    if (type && !/^image\//i.test(type)) return null
    const length = Number(response.headers.get("content-length") || 0)
    if (length > MAX_IMAGE_BYTES) return null
    return Buffer.from(await response.arrayBuffer())
  }

  static detectImageMime(buffer) {
    if (!buffer || buffer.length < 8) return ""
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png"
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg"
    if (buffer.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif"
    if (
      buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
      buffer.subarray(8, 12).toString("latin1") === "WEBP"
    )
      return "image/webp"
    if (buffer[0] === 0x42 && buffer[1] === 0x4d) return "image/bmp"
    return ""
  }

  static stringify(msg) {
    if (msg === null || msg === undefined) return ""
    if (typeof msg === "string") return msg
    if (typeof msg === "number" || typeof msg === "boolean") return String(msg)
    if (Array.isArray(msg)) return msg.map(item => AIBackendConsole.stringify(item)).filter(Boolean).join("")
    if (typeof msg === "object") {
      const data = msg.data || {}
      if (msg.type === "text") return data.text || msg.text || ""
      if (msg.type === "image") return "[图片]"
      if (msg.type === "record") return "[语音]"
      if (msg.type === "video") return "[视频]"
      if (msg.type === "file") return `[文件${data.name ? `:${data.name}` : ""}]`
      if (msg.type === "at") return `@${data.qq || ""}`
      if (msg.type === "reply") return ""
      if (msg.type === "node")
        return (Array.isArray(data) ? data : [data])
          .map(node => AIBackendConsole.stringify(node?.message ?? node?.data?.content))
          .filter(Boolean)
          .join("\n")
      try {
        return JSON.stringify(msg)
      } catch {
        return String(msg)
      }
    }
    return ""
  }

  getHistory() {
    return this.history
  }

  clearHistory() {
    this.history = []
    this.images.clear()
    this.imageBytes = 0
    return true
  }
}

export { DANGEROUS_PATTERNS, MAX_COMMAND }
