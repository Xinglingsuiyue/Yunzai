import express from "express"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import fsSync from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import stripAnsi from "strip-ansi"
import cfg, { isGroupId, normalizeGroupId } from "../config/config.js"
import PluginsLoader from "../plugins/loader.js"
import AIClient from "../ai/AIClient.js"
import AIToolRegistry from "../ai/AIToolRegistry.js"
import AIManager from "../ai/AIManager.js"
import { describeWithVision } from "../ai/builtin/sticker.js"
import { aiAdmin } from "../ai/AIAdminStore.js"
import { synthesize, FREE_VOICES, customVoiceSpeed, freeVoiceSpeed } from "../ai/AIVoice.js"
import AIBackendConsole from "../ai/AIBackendConsole.js"
import { mcpManager } from "../ai/AIMCPManager.js"
import { compressMemories, buildBuckets, BUCKET_MIN_ITEMS } from "../ai/AIMemorySummarizer.js"
import { getKnowledgeBase, reloadKnowledgeBase } from "../ai/knowledgeBaseInstance.js"
import { consumeLoginCode, createLoginPanel } from "./LoginPanel.js"
import {
  listConfigFiles,
  readCoreConfig,
  saveCoreConfig,
  getGroupConfig,
  getGroupEffective,
  saveGroupConfig,
  deleteGroupScope,
  listPluginConfigEntriesWithInfo,
  readPluginConfig,
  readPluginIcon,
  savePluginConfig,
  runPluginConfigAction,
  invalidateConfigCache,
  saveWebuiCredential,
  ConfigError,
} from "./config.js"
import { generatePassword, validatePassword } from "./credential.js"
import {
  listPluginManager,
  installPlugin,
  uninstallPlugin,
  updatePlugin,
  setSinglePluginEnabled,
  removeSinglePlugin,
  installSinglePlugin,
  createSinglePlugin,
  saveSinglePlugin,
  readSinglePluginSource,
  listSinglePluginRepoFiles,
  cloneSinglePluginRepo,
} from "./pluginManager.js"
import { renderHelpPanel, renderHelpPreviewHtml } from "../help/index.js"
import { getHelpConfig } from "../help/HelpConfig.js"
import {
  listHelpThemeDetails,
  saveHelpTheme,
  saveHelpThemeThumb,
  deleteHelpTheme,
  getThemeAssets,
} from "../help/HelpTheme.js"
import { listHelpIcons, saveHelpIcon, readHelpIconFile } from "../help/icons.js"
import { createHelpBackup, listHelpBackups, restoreHelpBackup } from "../help/backup.js"
import { botProtocol, collectGauges } from "../status/index.js"
import { registerTerminalRoutes } from "./terminal.js"

const BASE_DIR = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.join(BASE_DIR, "public")
const LOG_DIR = path.join(process.cwd(), "logs")
const LOCAL_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"])

const AUTH_WINDOW = 10 * 60 * 1000
const AUTH_MAX_FAILURES = 12
const AUTH_BLOCK_TIME = 5 * 60 * 1000
const authFailures = new Map()
let runtimeCredential = null

function getOptions() {
  const raw = cfg.webui || {}
  let basePath = String(raw.path || "/webui").trim()
  if (!basePath.startsWith("/")) basePath = `/${basePath}`
  basePath = basePath.replace(/\/+$/, "")
  if (!basePath || basePath === "/" || ["/status", "/exit", "/File"].includes(basePath))
    basePath = "/webui"

  const configured = String(raw.token || "").trim()
  const token = configured || runtimeCredential?.token || ""
  const initialPassword =
    !!token && (raw.initialPassword === true || (!configured && runtimeCredential?.initialPassword === true))

  return {
    enable: raw.enable !== false,
    basePath,
    token,
    initialPassword,
    allowWrite: raw.allowWrite !== false,
    logLines: clampInt(raw.logLines, 20, 2000, 300),
  }
}

function clampInt(value, min, max, fallback) {
  const number = Number.parseInt(value, 10)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function getStatusImageScale() {
  const value = Number(cfg.webui?.statusImageScale)
  return Number.isFinite(value) ? Math.min(3, Math.max(1, value)) : 2
}

function getStatusImageWidth() {
  const value = Number(cfg.webui?.statusImageWidth)
  if (Number.isFinite(value) && value > 0) return Math.min(900, Math.max(420, value))
  return 560
}

function getStatusProForAll() {
  return cfg.webui?.statusProForAll === true
}

function isLocalRequest(req) {
  const ip = req.socket?.remoteAddress || req.ip || ""
  return LOCAL_IPS.has(ip)
}

function getProvidedToken(req) {
  const header = req.get("x-webui-token")
  if (header) return header
  const authorization = req.get("authorization") || ""
  if (authorization.toLowerCase().startsWith("bearer ")) return authorization.slice(7).trim()
  return typeof req.query.token === "string" ? req.query.token : ""
}

function tokenMatches(provided, expected) {
  if (!provided || !expected) return false
  const a = Buffer.from(String(provided))
  const b = Buffer.from(String(expected))
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

function isAuthorized(req, opts) {
  return tokenMatches(getProvidedToken(req), opts.token)
}

function getAuthBlock(ip) {
  const record = authFailures.get(ip)
  if (!record) return 0
  if (record.until > Date.now()) return record.until
  if (Date.now() - record.first > AUTH_WINDOW) authFailures.delete(ip)
  return 0
}

function noteAuthFailure(ip) {
  const now = Date.now()
  let record = authFailures.get(ip)
  if (!record || now - record.first > AUTH_WINDOW) record = { first: now, count: 0, until: 0 }
  record.count++
  if (record.count >= AUTH_MAX_FAILURES) record.until = now + AUTH_BLOCK_TIME
  authFailures.set(ip, record)

  if (authFailures.size > 2000)
    for (const [key, value] of authFailures)
      if (now - value.first > AUTH_WINDOW) authFailures.delete(key)
}

function requireAuth(req, res, next) {
  const opts = getOptions()
  const ip = req.socket?.remoteAddress || req.ip || "unknown"
  const blockedUntil = getAuthBlock(ip)
  if (blockedUntil) {
    res.setHeader("Retry-After", String(Math.ceil((blockedUntil - Date.now()) / 1000)))
    return res.status(429).json({ error: "too_many_attempts", message: "密码错误次数过多，请稍后再试" })
  }

  if (isAuthorized(req, opts)) {
    authFailures.delete(ip)
    return next()
  }

  noteAuthFailure(ip)
  return res.status(401).json({
    error: "unauthorized",
    message: opts.token ? "访问密码无效" : "WebUI 访问密码尚未生成，请重启 Bot 后查看启动日志",
  })
}

function requireRequestGuard(req, res, next) {
  if (req.get("x-webui-request") !== "1")
    return res.status(400).json({ error: "invalid_request", message: "缺少 WebUI 请求标识" })

  const origin = req.get("origin")
  if (origin) {
    try {
      if (new URL(origin).host !== req.get("host"))
        return res.status(403).json({ error: "bad_origin", message: "请求来源不匹配" })
    } catch {
      return res.status(403).json({ error: "bad_origin", message: "请求来源无效" })
    }
  }
  next()
}

function requireWrite(req, res, next) {
  const opts = getOptions()
  if (!opts.allowWrite)
    return res.status(403).json({
      error: "read_only",
      message: "WebUI 当前为只读模式（config/config/webui.yaml: allowWrite: false）",
    })
  return requireRequestGuard(req, res, next)
}

function ensureInitialCredential(opts) {
  if (opts.token) {
    if (opts.initialPassword)
      Bot.makeLog("mark", `WebUI 初始密码：${logger.yellow(opts.token)}（尚未修改，登录后会要求设置新密码）`, "WebUI")
    return opts
  }

  const token = generatePassword()
  try {
    saveWebuiCredential({ token, initialPassword: true })
  } catch (error) {
    runtimeCredential = { token, initialPassword: true }
    Bot.makeLog("warn", ["WebUI 初始密码写入配置失败，本次运行使用临时密码", error], "WebUI")
  }
  Bot.makeLog("mark", `WebUI 初始密码：${logger.yellow(token)}（首次登录后需要修改）`, "WebUI")
  return { ...opts, token, initialPassword: true }
}

function safeUrl(req) {
  return String(req.originalUrl || "").replace(/([?&]token=)[^&]*/gi, "$1***")
}

function asyncRoute(handler) {
  return (req, res) => {
    Promise.resolve(handler(req, res)).catch(error => {
      const status = Number(error?.status)
      const upstream = !!error?.upstream
      const code = upstream ? 502 : status >= 400 && status < 600 ? status : 500
      try {
        if (code >= 500) Bot.makeLog("error", ["WebUI", req.method, safeUrl(req), error], "WebUI")
      } catch {}
      if (!res.headersSent)
        res.status(code).json({
          error: code >= 500 ? "internal_error" : "request_failed",
          message: error?.message || String(error),
        })
    })
  }
}

function fail(res, status, message) {
  return res.status(status).json({ error: "request_failed", message })
}

function normalizeScope(scope) {
  const value = String(scope || "").trim()
  if (!value) return "master"
  if (value === "master" || value === "public") return value
  if (/^(group|user):\d+$/.test(value)) return value
  return null
}

function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags || "").split(/[,，]/)
  return [...new Set(list.map(tag => String(tag).trim()).filter(Boolean))].slice(0, 10)
}

const MEMORY_TEXT_FIELDS = [
  "title",
  "event",
  "desire",
  "reasoning",
  "learning",
  "verification",
  "lessons",
  "corrections",
  "masterOpinion",
  "delivery",
  "acceptance",
  "mood",
  "energy",
]
const MEMORY_LIST_FIELDS = ["feelings", "intentions", "actions", "interests", "taste", "opinions", "people"]

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function memoryPayload(body = {}) {
  const payload = {}
  if (body.kind !== undefined) payload.kind = body.kind === "episode" ? "episode" : "fact"
  if (body.content !== undefined) payload.content = String(body.content).trim()
  if (body.scope !== undefined) payload.scope = String(body.scope).trim()
  if (body.tags !== undefined) payload.tags = normalizeTags(body.tags)
  if (body.links !== undefined)
    payload.links = Array.isArray(body.links) ? body.links.map(id => String(id).trim()).filter(Boolean) : []
  if (body.pinned !== undefined) payload.pinned = body.pinned === true
  if (body.importance !== undefined) payload.importance = optionalNumber(body.importance)
  if (body.occurredAt !== undefined) payload.occurredAt = String(body.occurredAt || "").trim()
  for (const field of MEMORY_TEXT_FIELDS) {
    if (body[field] !== undefined) payload[field] = String(body[field] || "").trim()
  }
  for (const field of MEMORY_LIST_FIELDS) {
    if (body[field] !== undefined) {
      const value = body[field]
      payload[field] = Array.isArray(value)
        ? value.map(item => String(item).trim()).filter(Boolean)
        : String(value || "").split(/[,，、;\n]/).map(item => item.trim()).filter(Boolean)
    }
  }
  if (body.relationship !== undefined) {
    const relationship = body.relationship && typeof body.relationship === "object" ? body.relationship : {}
    payload.relationship = {
      trust: optionalNumber(relationship.trust),
      affinity: optionalNumber(relationship.affinity),
      note: String(relationship.note || "").trim(),
    }
  }
  if (body.emotion !== undefined) {
    const emotion = body.emotion && typeof body.emotion === "object" ? body.emotion : {}
    payload.emotion = {
      primary: String(emotion.primary || "").trim(),
      secondary: Array.isArray(emotion.secondary)
        ? emotion.secondary.map(item => String(item).trim()).filter(Boolean)
        : String(emotion.secondary || "").split(/[,，、+\s]+/).map(item => item.trim()).filter(Boolean),
      intensity: optionalNumber(emotion.intensity),
    }
  }
  return payload
}

function memoryScopeError(scope) {
  const value = String(scope || "")
  if (value === "global") return ""
  if (/^group:.+$/.test(value) && isGroupId(value.slice(6))) return ""
  if (/^user:\d{3,20}$/.test(value)) return ""
  return "scope 无效：可选 global / group:<群号> / user:<QQ号>"
}

function maskUrl(raw) {
  try {
    const url = new URL(raw)
    if (url.username) url.username = "***"
    if (url.password) url.password = "***"
    return url.toString()
  } catch {
    return raw
  }
}

function dateStamp(date = new Date()) {
  const pad = value => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

async function readLogTail(type, lines) {
  const file =
    type === "error" ? path.join(LOG_DIR, "error.log") : path.join(LOG_DIR, `command.${dateStamp()}.log`)
  try {
    const stat = await fs.stat(file)
    const readSize = Math.min(stat.size, 512 * 1024)
    const handle = await fs.open(file, "r")
    const buffer = Buffer.alloc(readSize)
    try {
      await handle.read(buffer, 0, readSize, stat.size - readSize)
    } finally {
      await handle.close()
    }
    let text = stripAnsi(buffer.toString("utf8")).replace(/\r/g, "")
    if (readSize < stat.size) {
      const firstBreak = text.indexOf("\n")
      text = firstBreak === -1 ? "" : text.slice(firstBreak + 1)
    }
    return cleanHttpRequestBlocks(text.split("\n")).filter(line => line.trim()).slice(-lines)
  } catch {
    return []
  }
}

function cleanHttpRequestBlocks(lines) {
  const result = []
  let depth = 0
  for (const line of lines) {
    if (depth > 0) {
      depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length
      continue
    }
    const isHttp = /^\[\d{2}:\d{2}:\d{2}\.\d{3}\]\[MARK\]\[https?:\/\/[^\]]+\] HTTP (GET|POST|PUT|PATCH|DELETE)\b/.test(line)
    const isWs = /^\[\d{2}:\d{2}:\d{2}\.\d{3}\]\[MARK\].*\[ws:\/\/[^\]]+\]/.test(line)
    if (isHttp || isWs) {
      depth = Math.max(0, (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length)
      continue
    }
    result.push(line)
  }
  return result
}

const botAvatarCache = new Map()
const botAvatarPending = new Map()
const BOT_AVATAR_TTL = 10 * 60 * 1000
const BOT_AVATAR_MAX_BYTES = 512 * 1024

function sniffImageType(buffer) {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47)
    return "image/png"
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg"
  if (buffer.length >= 4 && buffer.subarray(0, 3).toString() === "GIF") return "image/gif"
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString() === "RIFF" &&
    buffer.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp"
  return ""
}

function imageFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > BOT_AVATAR_MAX_BYTES) return null
  const type = sniffImageType(buffer)
  return type ? { buffer, type } : null
}

function imageFromDataUrl(url) {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(url)
  if (!match) return null
  try {
    const buffer = match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]))
    return imageFromBuffer(buffer)
  } catch {
    return null
  }
}

function botAvatarImage(url) {
  if (!url) return Promise.resolve(null)
  if (url.startsWith("data:")) return Promise.resolve(imageFromDataUrl(url))
  const cached = botAvatarCache.get(url)
  if (cached && Date.now() - cached.at < BOT_AVATAR_TTL) return Promise.resolve(cached.image)
  if (botAvatarPending.has(url)) return botAvatarPending.get(url)
  const task = (async () => {
    let image = null
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (response.ok) image = imageFromBuffer(Buffer.from(await response.arrayBuffer()))
    } catch {}
    botAvatarCache.set(url, { image, at: Date.now() })
    return image
  })().finally(() => botAvatarPending.delete(url))
  botAvatarPending.set(url, task)
  return task
}

function warmBotAvatar(url) {
  if (!url || url.startsWith("data:")) return
  const cached = botAvatarCache.get(url)
  if (cached && Date.now() - cached.at < BOT_AVATAR_TTL) return
  botAvatarImage(url).catch(() => {})
}

function botAvatarSource(id) {
  const client = Bot.bots?.[id]
  if (!client) return ""
  return client.avatar || (Number(id) > 0 ? `https://q1.qlogo.cn/g?b=qq&s=0&nk=${id}` : "")
}

async function collectBots() {
  const ids = Array.from(Bot.uin || []).filter(id => Bot.bots?.[id])
  if (Bot.bots?.stdin && !ids.some(id => String(id) === "stdin")) ids.push("stdin")
  return ids
    .map(id => {
      const client = Bot.bots[id]
      const online = Bot.isBotOnline(client)
      const uin = String(id)
      const isQQ = Number(uin) > 0
      const avatarUrl = botAvatarSource(uin)
      if (avatarUrl) warmBotAvatar(avatarUrl)
      return {
        self_id: uin,
        nickname: client?.nickname || client?.info?.nickname || "",
        online,
        isQQ,
        hasAvatar: !!avatarUrl,
      }
    })
    .sort((a, b) => Number(b.isQQ) - Number(a.isQQ))
}

async function readBotMsgCounts(ids = []) {
  const out = new Map()
  const list = ids.map(String).filter(Boolean)
  if (!list.length) return out
  const redis = globalThis.redis
  if (!redis?.mGet) return out
  try {
    const keys = []
    for (const id of list) {
      keys.push(`Yz:count:receive:msg:bot:${id}:total`, `Yz:count:send:msg:bot:${id}:total`)
    }
    const values = (await redis.mGet(keys)) || []
    list.forEach((id, index) => {
      out.set(id, {
        recv: Number(values[index * 2]) || 0,
        send: Number(values[index * 2 + 1]) || 0,
      })
    })
  } catch {
  }
  return out
}

async function collectAccounts() {
  const bots = await collectBots()
  const counted = await readBotMsgCounts(bots.map(item => item.self_id))
  return bots.map(item => {
    const client = Bot.bots?.[item.self_id] || Bot[item.self_id] || null
    const protocol = client ? botProtocol(client) : { loginProtocol: "未知", protocolVersion: "" }
    const stat = client?.stat || {}
    let groupMemberCount = 0
    try {
      for (const members of client?.gml?.values() || []) groupMemberCount += members?.size || 0
    } catch {}
    const fromCore = counted.get(String(item.self_id))
    return {
      ...item,
      ...protocol,
      startTime: item.isQQ && Number(stat.start_time) > 0 ? Number(stat.start_time) * 1000 : 0,
      friendCount: client?.fl?.size || 0,
      groupCount: client?.gl?.size || 0,
      groupMemberCount,
      recvCount: fromCore?.recv || Number(stat.recv_msg_cnt) || 0,
      sendCount: fromCore?.send || Number(stat.sent_msg_cnt) || 0,
    }
  })
}

let gaugesCache = { at: 0, data: null }
let gaugesTask = null

function peekGauges() {
  return gaugesCache.data || { resources: [], disks: [] }
}

function refreshGauges() {
  if (gaugesTask) return gaugesTask
  gaugesTask = collectGauges()
    .then(data => {
      gaugesCache = { at: Date.now(), data }
      return data
    })
    .catch(() => gaugesCache.data || { resources: [], disks: [] })
    .finally(() => {
      gaugesTask = null
    })
  return gaugesTask
}

async function getGauges() {
  if (!gaugesCache.data) return refreshGauges()
  if (Date.now() - gaugesCache.at >= 4000) refreshGauges().catch(() => {})
  return gaugesCache.data
}

function collectGroups() {
  try {
    return Bot.getGroupArray()
      .map(group => ({
        group_id: String(group.group_id ?? group.groupCode ?? ""),
        name: group.group_name || group.groupName || group.name || "",
        memberCount: Number(group.member_count ?? group.memberCount ?? 0),
        maxMemberCount: Number(group.max_member_count ?? group.maxMemberCount ?? 0),
        botId: String(group.bot_id ?? ""),
      }))
      .filter(group => group.group_id)
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
  } catch {
    return []
  }
}

function collectFeatures() {
  const map = new Map()
  for (const entry of PluginsLoader.priority || []) {
    const name = String(entry.name || "").trim()
    if (!name) continue
    const current = map.get(name)
    const namespace = entry.namespace || entry.key || ""
    if (current) {
      if (namespace && !current.namespaces.includes(namespace)) current.namespaces.push(namespace)
      continue
    }
    map.set(name, { name, namespaces: namespace ? [namespace] : [] })
  }
  return [...map.values()]
    .map(item => ({ name: item.name, namespace: item.namespaces[0] || "" }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
}

function collectFriends() {
  try {
    return Bot.getFriendArray()
      .map(friend => ({
        user_id: String(friend.user_id ?? friend.userId ?? ""),
        nickname: friend.nickname || friend.name || "",
        remark: friend.remark || "",
        botId: String(friend.bot_id ?? ""),
      }))
      .filter(friend => friend.user_id)
      .sort((a, b) => a.nickname.localeCompare(b.nickname, "zh-CN"))
  } catch {
    return []
  }
}

const recentChats = new Map()
const recalledChatMessages = new Map()
const chatReactionStore = new Map()
const RECENT_CHAT_LIMIT = 200

function recentChatKey(kind, botId, id) {
  return `${kind}:${botId || "any"}:${id}`
}

function chatTimestamp(value) {
  const time = Number(value) || 0
  if (!time) return 0
  return time < 1e12 ? time * 1000 : time
}

function chatImageRefs(item) {
  const segments = Array.isArray(item?.message)
    ? item.message
    : Array.isArray(item?.content)
      ? item.content
      : []
  const images = []
  const seen = new Set()
  for (const seg of segments) {
    const type = seg?.type || seg?.data?.type
    if (type !== "image" && type !== "mface") continue
    const data = seg?.data || {}
    const url = String(seg?.url || data.url || seg?.file || data.file || "").trim()
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue
    seen.add(url)
    const image = { url }
    const width = Number(seg?.width || data.width) || 0
    const height = Number(seg?.height || data.height) || 0
    if (width > 0 && height > 0) {
      image.width = width
      image.height = height
    }
    images.push(image)
    if (images.length >= 9) break
  }
  return images
}

function chatMessageText(item, images) {
  const flat = AIManager._flattenMessageSegments(item)
  let text = flat.text
  if (!text && !images.length) {
    if (flat.images.length) text = "[图片]"
    else if (item?.raw_message) text = String(item.raw_message).trim()
  }
  if (/^[\[［【]\s*已删除\s*[\]］】]$/.test(String(text).trim())) text = ""
  return text
}

function chatReplyRef(item) {
  const segments = Array.isArray(item?.message)
    ? item.message
    : Array.isArray(item?.content)
      ? item.content
      : []
  for (const seg of segments) {
    const type = seg?.type || seg?.data?.type
    if (type !== "reply") continue
    const data = seg?.data || {}
    const id = String(data.id ?? data.message_id ?? seg?.id ?? "").trim()
    const quote = {}
    if (id) quote.id = id
    const name = String(
      seg?.name ?? data.name ?? seg?.nickname ?? data.nickname ?? seg?.nick ?? data.nick ?? "",
    ).trim()
    if (name) quote.name = name
    if (quote.id || quote.name) return quote
  }
  const source = item?.source
  if (source && typeof source === "object") {
    const quote = {}
    const id = String(source.message_id ?? source.id ?? "").trim()
    if (id) quote.id = id
    const userId = String(source.user_id ?? source.userId ?? "").trim()
    if (userId) quote.userId = userId
    if (Array.isArray(source.message)) {
      const text = AIManager._flattenMessageSegments({ message: source.message }).text
      if (text) quote.text = text
    } else if (typeof source.message === "string") {
      const text = source.message.replace(/\[CQ:[^\]]*\]/g, "").trim()
      if (text) quote.text = text
    }
    if (quote.id || quote.text) return quote
  }
  return null
}

function chatEmojiText(emojiId) {
  const code = Number(emojiId)
  if (!Number.isInteger(code) || code < 0x2000 || code > 0x10ffff) return ""
  try {
    return String.fromCodePoint(code)
  } catch {
    return ""
  }
}

function normalizeChatMessage(item, selfId = "") {
  const sender = item?.sender || {}
  const userId = String(item?.user_id ?? sender.user_id ?? "")
  const images = chatImageRefs(item)
  const quote = chatReplyRef(item)
  const message = {
    id: String(item?.message_id ?? item?.id ?? ""),
    userId,
    name: sender.card || sender.nickname || sender.user_name || sender.name || userId || "未知",
    text: chatMessageText(item, images),
    images,
    time: chatTimestamp(item?.time) || Date.now(),
    self: !!selfId && userId === selfId,
    recalled: item?.recalled === true,
  }
  if (quote) message.quote = quote
  return message
}

function rememberChatMessage(kind, botId, id, message) {
  if (!id || (!message?.text && !message?.images?.length)) return
  const key = recentChatKey(kind, botId, id)
  const list = recentChats.get(key) || []
  const index = message.id ? list.findIndex(item => String(item.id) === String(message.id)) : -1
  if (index >= 0) {
    const recalled = list[index].recalled === true
    list[index] = { ...list[index], ...message, recalled: recalled || message.recalled === true }
  } else list.push(message)
  if (list.length > RECENT_CHAT_LIMIT) list.splice(0, list.length - RECENT_CHAT_LIMIT)
  recentChats.set(key, list)
}

function recallCachedMessage(kind, botId, id, messageId, self = false) {
  const target = String(messageId ?? "")
  if (!target) return false
  const key = recentChatKey(kind, botId, id)
  const recalled = recalledChatMessages.get(key) || new Map()
  recalled.set(target, recalled.get(target) === true || self === true)
  if (recalled.size > RECENT_CHAT_LIMIT) recalled.delete(recalled.keys().next().value)
  recalledChatMessages.set(key, recalled)

  const list = recentChats.get(key)
  if (!list) return false
  let hit = false
  for (const message of list) {
    if (String(message.id) !== target) continue
    message.recalled = true
    message.recalledBySelf = recalled.get(target) === true
    hit = true
  }
  return hit
}

function cachedChatMessages(kind, botId, id, count) {
  return (recentChats.get(recentChatKey(kind, botId, id)) || []).slice(-count)
}

function rememberChatReaction(kind, botId, id, messageId, reaction) {
  const target = String(messageId ?? "")
  if (!target || !reaction?.emojiId) return
  const key = recentChatKey(kind, botId, id)
  let map = chatReactionStore.get(key)
  if (!map) {
    map = new Map()
    chatReactionStore.set(key, map)
  }
  const list = map.get(target) || []
  const index = list.findIndex(item => item.emojiId === reaction.emojiId)
  if (index >= 0) list[index] = reaction
  else list.push(reaction)
  map.set(target, list.slice(-20))
  if (map.size > RECENT_CHAT_LIMIT) map.delete(map.keys().next().value)
}

function attachChatReactions(kind, botId, id, messages) {
  const map = chatReactionStore.get(recentChatKey(kind, botId, id))
  if (!map?.size) return messages
  return messages.map(item => {
    const reactions = map.get(String(item.id))
    return reactions?.length ? { ...item, reactions } : item
  })
}

function resolveChatQuotes(messages) {
  const byId = new Map()
  const byUser = new Map()
  for (const item of messages) {
    if (item.id) byId.set(item.id, item)
    if (item.userId && !byUser.has(item.userId)) byUser.set(item.userId, item)
  }
  for (const item of messages) {
    if (!item.quote) continue
    const source = item.quote.id ? byId.get(item.quote.id) : byUser.get(item.quote.userId)
    if (!source) continue
    if (!item.quote.name) item.quote.name = source.name
    if (!item.quote.text) item.quote.text = source.text || (source.images.length ? "[图片]" : "")
  }
  return messages
}

function recalledChatMap(kind, botId, id) {
  return recalledChatMessages.get(recentChatKey(kind, botId, id)) || new Map()
}

function chatSendMessageId(result) {
  const list = Array.isArray(result) ? result : [result]
  for (const item of list) {
    if (!item) continue
    const value = item.message_id ?? item.id ?? item.data?.message_id ?? item.data?.id
    if (Array.isArray(value)) {
      const first = value.find(entry => entry !== undefined && entry !== null && entry !== "")
      if (first !== undefined) return String(first)
      continue
    }
    if (value !== undefined && value !== null && value !== "") return String(value)
  }
  return ""
}

const CHAT_RECALL_WINDOW_MS = 120 * 1000

function findCachedChatMessage(kind, botId, id, messageId) {
  return (recentChats.get(recentChatKey(kind, botId, id)) || []).find(
    item => String(item.id) === String(messageId),
  )
}

async function chatMessageSentAt(kind, botId, targetId, target, messageId) {
  const cached = findCachedChatMessage(kind, botId, targetId, messageId)
  if (cached?.time) return Number(cached.time)
  if (typeof target?.getMsg === "function") {
    try {
      const message = await AIManager._withTimeout(target.getMsg(messageId), 8000)
      const time = chatTimestamp(message?.time)
      if (time) return time
    } catch {}
  }
  if (typeof target?.getChatHistory === "function") {
    try {
      const history = await AIManager._withTimeout(target.getChatHistory(0, 50), 8000)
      for (const item of Array.isArray(history) ? history : []) {
        if (String(item?.message_id ?? item?.id ?? "") !== String(messageId)) continue
        const time = chatTimestamp(item?.time)
        if (time) return time
      }
    } catch {}
  }
  return 0
}

async function chatSelfIsGroupManager(target, selfId) {
  try {
    if (target?.is_owner === true || target?.is_admin === true) return true
  } catch {}
  const memberId = /^\d+$/.test(String(selfId)) ? Number(selfId) : selfId
  try {
    const info = await AIManager._withTimeout(target?.pickMember?.(memberId)?.getInfo?.(), 8000)
    if (info?.role === "owner" || info?.role === "admin") return true
    if (info?.is_owner === true || info?.is_admin === true) return true
  } catch {}
  try {
    const info = await AIManager._withTimeout(target?.getInfo?.(), 8000)
    if (info?.owner_id !== undefined && String(info.owner_id) === String(selfId)) return true
    if (info?.ownerId !== undefined && String(info.ownerId) === String(selfId)) return true
  } catch {}
  return false
}

function chatClientIsQQBot(client) {
  return String(client?.adapter?.name || "") === "QQBot"
}

async function chatMessageSenderId(kind, botId, targetId, target, messageId) {
  const cached = findCachedChatMessage(kind, botId, targetId, messageId)
  if (cached?.userId) return String(cached.userId)
  if (typeof target?.getMsg !== "function") return ""
  try {
    const message = await AIManager._withTimeout(target.getMsg(messageId), 8000)
    const sender = message?.sender || {}
    return String(message?.user_id ?? sender.user_id ?? "")
  } catch {
    return ""
  }
}

function chatRecallRetcodeFailed(item) {
  if (!item || typeof item !== "object" || item.retcode === undefined || item.retcode === null)
    return false
  const retcode = Number(item.retcode)
  return Number.isFinite(retcode) && retcode !== 0 && retcode !== 1
}

function chatRecallFailed(result) {
  const list = Array.isArray(result) ? result : [result]
  return list.some(
    item =>
      item === false ||
      item instanceof Error ||
      item?.success === false ||
      item?.status === "failed" ||
      chatRecallRetcodeFailed(item),
  )
}

function chatRecallError(result) {
  const list = Array.isArray(result) ? result : [result]
  for (const item of list) {
    if (item === false) return "协议端拒绝撤回"
    if (item instanceof Error) return item.message || "协议端拒绝撤回"
    if (item?.success === false)
      return item?.error?.message || item?.error?.wording || String(item?.error || "") || "协议端拒绝撤回"
    if (item?.status === "failed" || chatRecallRetcodeFailed(item))
      return item?.wording || item?.message || item?.msg || `协议端返回 ${item?.retcode}`
  }
  return ""
}

function resolveChatTarget(kind, targetId, botId) {
  const client = botId ? Bot.bots?.[botId] : null
  if (botId && !client) return { error: "该机器人账号未连接" }
  const id = /^\d{1,15}$/.test(targetId) ? Number(targetId) : targetId
  try {
    const target = client
      ? kind === "group"
        ? client.pickGroup(id)
        : client.pickFriend(id)
      : kind === "group"
        ? Bot.pickGroup(id)
        : Bot.pickFriend(id)
    return { client, target }
  } catch {
    return { error: kind === "group" ? "找不到该群聊" : "找不到该好友" }
  }
}

function watchChatMessages() {
  const bus = globalThis.Bot
  if (typeof bus?.on !== "function" || typeof bus?.off !== "function") return () => {}
  const record = kind => event => {
    try {
      const targetId = String(kind === "group" ? event?.group_id ?? "" : event?.user_id ?? "")
      if (!targetId) return
      const botId = String(event?.self_id ?? "")
      rememberChatMessage(kind, botId, targetId, normalizeChatMessage(event, botId))
    } catch {}
  }
  const forget = kind => event => {
    try {
      const targetId = String(kind === "group" ? event?.group_id ?? "" : event?.user_id ?? "")
      if (!targetId) return
      const selfId = String(event?.self_id ?? "")
      const operatorId = String(event?.operator_id ?? event?.user_id ?? "")
      recallCachedMessage(kind, selfId, targetId, event?.message_id, !!selfId && operatorId === selfId)
    } catch {}
  }
  const handlers = [
    ["message.group", record("group")],
    ["message.private", record("friend")],
    ["notice.group.recall", forget("group")],
    ["notice.friend.recall", forget("friend")],
  ]
  for (const [name, handler] of handlers) bus.on(name, handler)
  return () => {
    for (const [name, handler] of handlers) bus.off(name, handler)
  }
}

function collectPluginConfigCandidates(kind, { query = "", ids = "", limit = 50 } = {}) {
  let list
  try {
    list =
      kind === "friends"
        ? Bot.getFriendArray().map(friend => {
            const value = friend.user_id ?? friend.userId
            if (value === undefined || value === null || value === "") return null
            const label = friend.nickname || friend.name || String(value)
            const detail = [friend.remark, String(value)].filter(Boolean).join(" · ")
            return { value, label, detail }
          })
        : Bot.getGroupArray().map(group => {
            const value = group.group_id ?? group.groupCode
            if (value === undefined || value === null || value === "") return null
            const label = group.group_name || group.groupName || group.name || String(value)
            const count = Number(group.member_count ?? group.memberCount ?? 0)
            const detail = [count ? `${count} 人` : "", String(value)].filter(Boolean).join(" · ")
            return { value, label, detail }
          })
  } catch {
    list = []
  }

  const seen = new Set()
  list = list.filter(item => {
    if (!item) return false
    const key = String(item.value)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  list.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"))

  const idSet = new Set(
    String(ids || "")
      .split(",")
      .map(item => item.trim())
      .filter(Boolean),
  )
  const keyword = String(query || "").trim().toLowerCase()
  let matched = list
  if (idSet.size) matched = list.filter(item => idSet.has(String(item.value)))
  else if (keyword)
    matched = list.filter(item => `${item.label} ${item.value}`.toLowerCase().includes(keyword))

  const size = Math.min(Math.max(Number(limit) || 50, 1), 200)
  return { items: matched.slice(0, size), total: matched.length }
}

function attachPluginConfigCandidateLabels(detail) {
  if (!detail || !Array.isArray(detail.fields)) return detail
  for (const field of detail.fields) {
    if (!field || !field.candidateKind) continue
    const values = Array.isArray(field.value) ? field.value : []
    const labels = {}
    if (values.length) {
      try {
        const { items } = collectPluginConfigCandidates(field.candidateKind, {
          ids: values.map(String).join(","),
          limit: 200,
        })
        for (const item of items)
          if (item && item.value !== undefined && item.value !== null)
            labels[String(item.value)] = item.label || String(item.value)
      } catch {}
    }
    field.valueLabels = labels
  }
  return detail
}

function buildApp(opts) {
  const app = express()
  const router = express.Router()

  app.disable("x-powered-by")
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff")
    res.setHeader("X-Frame-Options", "DENY")
    res.setHeader("Referrer-Policy", "no-referrer")
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: blob: https:; media-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self' data:; base-uri 'none'; form-action 'self'",
    )
    next()
  })

  app.get("/favicon.ico", (req, res) => res.status(204).end())
  app.get("/", (req, res) => {
    res.setHeader("Cache-Control", "no-store")
    res.sendFile(path.join(PUBLIC_DIR, "index.html"))
  })
  app.use(
    express.static(PUBLIC_DIR, {
      index: false,
      maxAge: 0,
      setHeaders(res, filePath) {
        if (/\.(?:js|css|html)$/i.test(filePath)) res.setHeader("Cache-Control", "no-cache")
        else res.setHeader("Cache-Control", "no-store")
      },
    }),
  )

  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store")
    res.setHeader("Content-Type", "application/json; charset=utf-8")
    next()
  })

  router.get("/session", (req, res) => {
    const current = getOptions()
    const ip = req.socket?.remoteAddress || req.ip || "unknown"
    const blockedUntil = getAuthBlock(ip)
    if (blockedUntil) {
      res.setHeader("Retry-After", String(Math.ceil((blockedUntil - Date.now()) / 1000)))
      return res.status(429).json({ error: "too_many_attempts", message: "密码错误次数过多，请稍后再试" })
    }

    const provided = getProvidedToken(req)
    const authorized = isAuthorized(req, current)
    if (!authorized && current.token && provided) noteAuthFailure(ip)

    res.json({
      ok: true,
      authorized,
      tokenRequired: true,
      passwordInitial: authorized && !!current.initialPassword,
      local: isLocalRequest(req),
      allowWrite: current.allowWrite,
      basePath: current.basePath,
      version: cfg.package?.version || "",
    })
  })

  router.post("/login/quick", async (req, res) => {
    const current = getOptions()
    const ip = req.socket?.remoteAddress || req.ip || "unknown"
    const blockedUntil = getAuthBlock(ip)
    if (blockedUntil) {
      res.setHeader("Retry-After", String(Math.ceil((blockedUntil - Date.now()) / 1000)))
      return res.status(429).json({ error: "too_many_attempts", message: "尝试次数过多，请稍后再试" })
    }
    const code = String(req.body?.code || "").trim()
    if (!code) return res.status(400).json({ error: "invalid_request", message: "缺少登录码" })
    const session = await consumeLoginCode(code)
    if (!session) {
      noteAuthFailure(ip)
      return res.status(401).json({ error: "invalid_code", message: "登录码无效或已过期，请重新发送指令获取" })
    }
    if (!current.token)
      return res.status(403).json({
        error: "no_token",
        message: "该实例尚未生成访问密码，请在服务器本机查看启动日志",
      })
    authFailures.delete(ip)
    res.json({
      ok: true,
      token: current.token,
      basePath: current.basePath,
      message: "登录成功",
    })
  })

  router.use(requireAuth)

  router.post(
    "/password",
    requireRequestGuard,
    asyncRoute(async (req, res) => {
      const current = getOptions()
      if (!current.initialPassword) {
        const oldPassword = typeof req.body?.current === "string" ? req.body.current : ""
        if (!oldPassword) return fail(res, 400, "请输入旧密码")
        if (!tokenMatches(oldPassword, current.token)) {
          noteAuthFailure(req.socket?.remoteAddress || req.ip || "unknown")
          return fail(res, 400, "旧密码不正确")
        }
      }
      const password = typeof req.body?.password === "string" ? req.body.password : ""
      const problem = validatePassword(password, current.token)
      if (problem) return fail(res, 400, problem)
      try {
        saveWebuiCredential({ token: password, initialPassword: false })
      } catch (error) {
        Bot.makeLog("error", ["WebUI 访问密码保存失败", error], "WebUI")
        return fail(res, 500, "密码保存失败，请检查配置文件权限后重试")
      }
      runtimeCredential = null
      res.json({ ok: true, message: "密码已更新" })
    }),
  )

  router.use((req, res, next) => {
    if (!getOptions().initialPassword) return next()
    return res.status(403).json({ error: "password_change_required", message: "请先修改初始密码" })
  })

  router.use((req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD") return next()
    return requireWrite(req, res, next)
  })

  registerTerminalRoutes(router, { initSSE, writeSSE, fail })

  router.get(
    "/overview",
    asyncRoute(async (req, res) => {
      const kb = getKnowledgeBase()
      const tools = AIToolRegistry.getStats()
      const groups = collectGroups()
      const friends = collectFriends()
      const memory = process.memoryUsage()
      const pluginEntries = PluginsLoader.priority.filter(entry => !entry.builtin)
      const pluginKeys = [...new Set(pluginEntries.map(entry => entry.key))]
      const packageKeys = new Set()
      let pluginSingles = 0
      for (const key of pluginKeys) {
        const [folder, file] = key.split("/")
        if (!file || folder.toLowerCase().endsWith("-plugin")) packageKeys.add(folder)
        else pluginSingles++
      }
      const startTime = (Bot.stat?.start_time || 0) * 1000
      const logLines = Math.min(8, getOptions().logLines)
      const gauges = peekGauges()
      if (!gaugesCache.data || Date.now() - gaugesCache.at >= 4000) refreshGauges()

      res.json({
        now: Date.now(),
        version: cfg.package?.version || "",
        botName: cfg.bot?.name || "",
        startType: global.start_type || "",
        node: process.version,
        platform: `${process.platform} ${process.arch}`,
        pid: process.pid,
        startTime,
        uptime: Date.now() - startTime,
        memory: {
          rss: memory.rss,
          heapUsed: memory.heapUsed,
          heapTotal: memory.heapTotal,
          external: memory.external,
        },
        gauges,
        bots: await collectBots(),
        counts: {
          groups: groups.length,
          friends: friends.length,
          plugins: packageKeys.size + pluginSingles,
          pluginPackages: packageKeys.size,
          pluginSingles,
          pluginEntries: pluginEntries.length,
          tasks: PluginsLoader.task.length,
          tools: tools.totalTools,
          sessions: AIManager.sessionCount,
          diskSessions: AIManager.sessionStore.count,
          memoryEntries: AIManager.memoryStore.stats().total,
          kbEntries: kb.getStats().total,
        },
        ai: {
          enabled: cfg.ai?.enabled === true,
          initialized: !!AIManager.defaultClient,
          model: AIManager.defaultClient?.model || cfg.ai?.model || "",
          baseURL: maskUrl(AIManager.defaultClient?.baseURL || cfg.ai?.baseURL || ""),
          hasApiKey: !!AIManager.defaultClient?.apiKey,
          channel: AIManager.defaultClient?.channelName || "",
          groupTrigger: AIManager.getGroupTriggerMode ? AIManager.getGroupTriggerMode() : "",
          groupChat: cfg.ai?.groupChat !== false,
          privateChat: cfg.ai?.privateChat !== false,
          knowledgeBase: cfg.ai?.enableKnowledgeBase !== false,
        },
        kb: kb.getStats(),
        serverPort: cfg.server?.port || null,
        webui: {
          basePath: getOptions().basePath,
          tokenRequired: !!getOptions().token,
          allowWrite: getOptions().allowWrite,
        },
        recent: await readLogTail("command", logLines),
      })
    }),
  )

  router.get(
    "/bots",
    asyncRoute(async (req, res) => {
      res.json({ bots: await collectBots() })
    }),
  )

  router.get(
    "/avatar/:uin",
    asyncRoute(async (req, res) => {
      const image = await botAvatarImage(botAvatarSource(String(req.params.uin || "")))
      if (!image) return res.status(404).end()
      res.setHeader("Content-Type", image.type)
      res.setHeader("Cache-Control", "private, max-age=600")
      res.end(image.buffer)
    }),
  )

  router.get("/status-image", (req, res) => {
    res.json({ scale: getStatusImageScale(), width: getStatusImageWidth(), proForAll: getStatusProForAll() })
  })

  router.post(
    "/status-image",
    asyncRoute(async (req, res) => {
      const body = req.body || {}
      const updates = []

      if (body.scale !== undefined) {
        const scale = Number(body.scale)
        if (![1, 1.5, 2, 3].includes(scale))
          return res.status(400).json({ error: "invalid_scale", message: "清晰度只能是 1 / 1.5 / 2 / 3" })
        updates.push({ path: ["statusImageScale"], value: scale })
      }

      if (body.width !== undefined) {
        const width = Number(body.width)
        if (!Number.isFinite(width) || width < 420 || width > 900)
          return res.status(400).json({ error: "invalid_width", message: "版式宽度需在 420-900 之间" })
        updates.push({ path: ["statusImageWidth"], value: Math.round(width) })
      }

      if (body.proForAll !== undefined) {
        updates.push({ path: ["statusProForAll"], value: body.proForAll === true })
      }

      if (!updates.length)
        return res.status(400).json({ error: "empty_update", message: "没有需要保存的设置" })

      saveCoreConfig("webui", { updates })
      const cached = cfg.webui
      const target = cfg.config?.["config.webui"] || (typeof cached === "object" ? cached : null)
      if (target) for (const update of updates) target[update.path[0]] = update.value
      res.json({
        ok: true,
        scale: getStatusImageScale(),
        width: getStatusImageWidth(),
        proForAll: getStatusProForAll(),
        message: "状态图设置已更新",
      })
    }),
  )

  router.get(
    "/accounts",
    asyncRoute(async (req, res) => {
      res.json({ bots: await collectAccounts() })
    }),
  )

  router.get(
    "/gauges",
    asyncRoute(async (req, res) => {
      res.json({ gauges: await getGauges() })
    }),
  )

  router.get(
    "/config/files",
    asyncRoute(async (req, res) => {
      res.json(listConfigFiles())
    }),
  )

  router.get(
    "/config/file/:name",
    asyncRoute(async (req, res) => {
      res.json(readCoreConfig(String(req.params.name || "")))
    }),
  )

  router.post(
    "/config/file/:name",
    asyncRoute(async (req, res) => {
      const name = String(req.params.name || "")
      const body = req.body && typeof req.body === "object" ? req.body : {}
      const updates = Array.isArray(body.updates) ? [...body.updates] : []
      if (name === "ai") {
        const keywordUpdate = updates.find(
          update => Array.isArray(update?.path) && update.path.length === 1 && update.path[0] === "triggerKeywords",
        )
        const hasKeywords =
          Array.isArray(keywordUpdate?.value) && keywordUpdate.value.some(value => String(value ?? "").trim())
        if (hasKeywords) {
          const index = updates.findIndex(
            update => Array.isArray(update?.path) && update.path.length === 1 && update.path[0] === "triggerKeyword",
          )
          if (index >= 0) updates[index] = { ...updates[index], value: true }
          else updates.push({ path: ["triggerKeyword"], value: true })
        }
      }
      const result = saveCoreConfig(name, { ...body, updates })
      if (name === "webui") {
        const paths = new Set(
          updates.filter(update => Array.isArray(update?.path)).map(update => update.path.join(".")),
        )
        if (paths.has("loginCommands") || paths.has("disableDefaultLoginCommand")) {
          Promise.resolve()
            .then(() => PluginsLoader.unloadPlugin("builtin/webui-panel.js"))
            .then(() =>
              PluginsLoader.importPlugin(
                {
                  name: "builtin/webui-panel.js",
                  path: new URL("./plugin.js", import.meta.url).href,
                  builtin: true,
                },
                [],
              ),
            )
            .then(() =>
              Bot.makeLog(
                "mark",
                `登录指令已更新：${JSON.stringify(cfg.webui?.loginCommands || [])}`,
                "WebUI",
              ),
            )
            .catch(error => Bot.makeLog("warn", ["重载登录指令失败", error.message], "WebUI"))
        }
      }
      if (name === "ai") {
        const paths = new Set(
          updates
            .filter(update => Array.isArray(update?.path))
            .map(update => update.path.join(".")),
        )
        if (
          [
            "kbStoragePath",
            "kbArchivePath",
            "kbMaxEntries",
            "kbMaxEntrySize",
            "kbColdAfterDays",
            "kbRecencyHalfLifeDays",
            "kbMergeSimilarity",
          ].some(key => paths.has(key))
        )
          reloadKnowledgeBase()
        if (paths.has("disabledTools") || paths.has("disabledToolPlugins")) {
          AIToolRegistry.builtinDisabledTools = [
            ...(aiAdmin.toolConfig?.disabledTools || []),
            ...(cfg.ai?.disabledTools || []),
          ]
          AIManager.rebuildBuiltinTools()
        }
        if (paths.has("enabled")) AIManager.reload()
        else if (["timeout", "maxRetries", "apiKey", "baseURL", "model"].some(key => paths.has(key)))
          AIManager.reloadClient()
      }
      res.json({ ok: true, ...result })
    }),
  )

  router.get(
    "/help/themes",
    asyncRoute(async (req, res) => {
      res.setHeader("Cache-Control", "private, no-cache")
      res.json({ themes: listHelpThemeDetails() })
    }),
  )

  router.get(
    "/help/theme/assets",
    asyncRoute(async (req, res) => {
      res.setHeader("Cache-Control", "private, max-age=3600")
      res.json({
        ok: true,
        ...getThemeAssets(String(req.query.name || "").trim().slice(0, 64)),
      })
    }),
  )

  router.get(
    "/help/theme/image/:name/:kind",
    asyncRoute(async (req, res) => {
      const kind = ["bg", "main", "thumb"].includes(req.params.kind) ? req.params.kind : ""
      if (!kind) return res.status(404).end()
      const assets = getThemeAssets(String(req.params.name || "").trim().slice(0, 64))
      const match = /^data:(image\/[a-z+.-]+);base64,([\s\S]+)$/i.exec(assets[kind] || "")
      if (!match) return res.status(404).end()
      res.setHeader("Content-Type", match[1])
      res.setHeader("Cache-Control", "private, max-age=3600")
      res.end(Buffer.from(match[2], "base64"))
    }),
  )

  const helpThemeRaw = express.raw({
    type: ["image/png", "image/jpeg", "image/jpg", "image/webp"],
    limit: "32mb",
  })

  router.post(
    "/help/theme",
    helpThemeRaw,
    asyncRoute(async (req, res) => {
      let label = ""
      try {
        label = decodeURIComponent(String(req.get("x-help-theme-label") || ""))
      } catch {}
      res.json({
        ok: true,
        ...saveHelpTheme({ buffer: req.body, mime: req.get("content-type"), label }),
      })
    }),
  )

  router.post(
    "/help/theme/thumb",
    helpThemeRaw,
    asyncRoute(async (req, res) => {
      res.json({
        ok: true,
        ...saveHelpThemeThumb({
          name: String(req.query.name || ""),
          buffer: req.body,
          mime: req.get("content-type"),
        }),
      })
    }),
  )

  router.post(
    "/help/theme/delete",
    asyncRoute(async (req, res) => {
      res.json({ ok: true, ...deleteHelpTheme(String(req.body?.name || "")) })
    }),
  )

  router.get(
    "/help/icons",
    asyncRoute(async (req, res) => {
      res.setHeader("Cache-Control", "private, no-cache")
      res.json({ icons: listHelpIcons() })
    }),
  )

  router.get(
    "/help/icon/:name",
    asyncRoute(async (req, res) => {
      const icon = readHelpIconFile(String(req.params.name || ""))
      if (!icon) return res.status(404).end()
      res.setHeader("Content-Type", icon.mime)
      res.setHeader("Cache-Control", "private, max-age=31536000, immutable")
      res.end(icon.buffer)
    }),
  )

  const helpIconRaw = express.raw({
    type: ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"],
    limit: "32mb",
  })

  router.post(
    "/help/icon",
    helpIconRaw,
    asyncRoute(async (req, res) => {
      res.json({ ok: true, ...saveHelpIcon(req.body, req.get("content-type")) })
    }),
  )

  router.get(
    "/help/backups",
    asyncRoute(async (req, res) => {
      res.json({ backups: listHelpBackups() })
    }),
  )

  router.post(
    "/help/backup",
    asyncRoute(async (req, res) => {
      res.json({ ok: true, backup: createHelpBackup() })
    }),
  )

  router.post(
    "/help/backup/restore",
    asyncRoute(async (req, res) => {
      const backup = restoreHelpBackup(req.body?.name)
      invalidateConfigCache("help")
      res.json({ ok: true, backup })
    }),
  )

  router.get(
    "/help/preview",
    asyncRoute(async (req, res) => {
      const keyword = String(req.query.keyword || "").trim().slice(0, 64)
      const { image, helpGroups } = await renderHelpPanel({ keyword, isMaster: true })
      if (!image) return fail(res, 400, helpGroups.length ? "预览生成失败，请查看 Bot 日志" : "帮助面板暂无内容")
      res.json({ ok: true, dataUrl: `data:image/png;base64,${image.toString("base64")}` })
    }),
  )

  router.get(
    "/help/preview/html",
    asyncRoute(async (req, res) => {
      const { helpCfg, helpList } = getHelpConfig()
      const themeName = String(req.query.theme || "").trim().slice(0, 64)
      res.json({ ok: true, ...renderHelpPreviewHtml({ helpCfg, helpList, themeName }) })
    }),
  )

  router.post(
    "/help/preview/html",
    asyncRoute(async (req, res) => {
      res.json({
        ok: true,
        ...renderHelpPreviewHtml({
          helpCfg: req.body?.helpCfg,
          helpList: req.body?.helpList,
          themeName: typeof req.body?.themeName === "string" ? req.body.themeName : "",
        }),
      })
    }),
  )

  router.get(
    "/config/group",
    asyncRoute(async (req, res) => {
      res.json(getGroupConfig({ bots: await collectBots(), groups: collectGroups(), features: collectFeatures() }))
    }),
  )

  router.get(
    "/config/group/effective",
    asyncRoute(async (req, res) => {
      res.json(
        getGroupEffective({
          botId: req.query.botId,
          groupId: req.query.groupId,
          bots: await collectBots(),
          groups: collectGroups(),
          features: collectFeatures(),
        }),
      )
    }),
  )

  router.post(
    "/config/group",
    asyncRoute(async (req, res) => {
      const result = saveGroupConfig(req.body || {})
      res.json({ ok: true, ...result })
    }),
  )

  router.delete(
    "/config/group",
    asyncRoute(async (req, res) => {
      const result = deleteGroupScope({ botId: req.query.botId, groupId: req.query.groupId })
      res.json({ ok: true, ...result })
    }),
  )

  router.get(
    "/plugin-config",
    asyncRoute(async (req, res) => {
      const list = await listPluginConfigEntriesWithInfo()
      await Promise.all(
        (list.plugins || []).flatMap(plugin =>
          (plugin.configs || []).map(async config => {
            try {
              config.detail = attachPluginConfigCandidateLabels(await readPluginConfig(plugin.key, config.id))
            } catch {}
          }),
        ),
      )
      res.json(list)
    }),
  )

  router.get(
    "/plugin-icon",
    asyncRoute(async (req, res) => {
      const icon = await readPluginIcon(String(req.query.plugin || ""))
      if (!icon) return fail(res, 404, "未找到插件图标")
      res.setHeader("Content-Type", icon.mime)
      res.setHeader("Cache-Control", "private, max-age=600")
      res.sendFile(icon.file)
    }),
  )

  router.get(
    "/plugin-config/detail",
    asyncRoute(async (req, res) => {
      const detail = await readPluginConfig(String(req.query.plugin || ""), String(req.query.id || ""))
      res.json(attachPluginConfigCandidateLabels(detail))
    }),
  )

  router.post(
    "/plugin-config/save",
    asyncRoute(async (req, res) => {
      const result = await savePluginConfig(req.body || {})
      res.json({ ok: true, ...result })
    }),
  )

  router.get(
    "/plugin-config/candidates",
    asyncRoute(async (req, res) => {
      const kind = String(req.query.kind || "")
      if (kind !== "groups" && kind !== "friends") return fail(res, 400, "未知的候选项类型")
      res.json(
        collectPluginConfigCandidates(kind, {
          query: req.query.q,
          ids: req.query.ids,
          limit: req.query.limit,
        }),
      )
    }),
  )

  router.post(
    "/plugin-config/action",
    asyncRoute(async (req, res) => {
      res.json(await runPluginConfigAction(req.body || {}))
    }),
  )

  router.get(
    "/plugin-manager",
    asyncRoute(async (req, res) => {
      res.json(await listPluginManager({ force: req.query.refresh === "1" }))
    }),
  )

  router.post(
    "/plugin-manager/install",
    asyncRoute(async (req, res) => {
      res.json(
        await installPlugin({
          link: req.body?.link,
          autoInstall: req.body?.autoInstall !== false,
        }),
      )
    }),
  )

  router.post(
    "/plugin-manager/uninstall",
    asyncRoute(async (req, res) => {
      res.json(
        await uninstallPlugin({
          name: req.body?.name,
          confirm: req.body?.confirm,
        }),
      )
    }),
  )

  router.post(
    "/plugin-manager/update",
    asyncRoute(async (req, res) => {
      res.json(
        await updatePlugin({
          name: req.body?.name,
          autoInstall: req.body?.autoInstall !== false,
        }),
      )
    }),
  )

  router.post(
    "/plugin-manager/single/toggle",
    asyncRoute(async (req, res) => {
      res.json(
        await setSinglePluginEnabled({
          key: req.body?.key,
          enabled: req.body?.enabled,
          confirm: req.body?.confirm,
        }),
      )
    }),
  )

  router.post(
    "/plugin-manager/single/remove",
    asyncRoute(async (req, res) => {
      res.json(
        await removeSinglePlugin({
          key: req.body?.key,
          confirm: req.body?.confirm,
        }),
      )
    }),
  )

  router.post(
    "/plugin-manager/single/install",
    asyncRoute(async (req, res) => {
      res.json(
        await installSinglePlugin({
          urls: req.body?.urls,
          title: req.body?.title,
          file: req.body?.file,
        }),
      )
    }),
  )

  router.get(
    "/plugin-manager/single/source",
    asyncRoute(async (req, res) => {
      res.json(readSinglePluginSource({ key: req.query.key }))
    }),
  )

  router.post(
    "/plugin-manager/single/create",
    asyncRoute(async (req, res) => {
      res.json(
        await createSinglePlugin({
          file: req.body?.file,
          content: req.body?.content,
        }),
      )
    }),
  )

  router.post(
    "/plugin-manager/single/save",
    asyncRoute(async (req, res) => {
      res.json(
        await saveSinglePlugin({
          key: req.body?.key,
          file: req.body?.file,
          content: req.body?.content,
        }),
      )
    }),
  )

  router.post(
    "/plugin-manager/single/repo",
    asyncRoute(async (req, res) => {
      res.json(await listSinglePluginRepoFiles({ link: req.body?.link }))
    }),
  )

  router.post(
    "/plugin-manager/single/clone",
    asyncRoute(async (req, res) => {
      res.json(
        await cloneSinglePluginRepo({
          link: req.body?.link,
          files: req.body?.files,
        }),
      )
    }),
  )

  router.get("/ai", (req, res) => {
    const stats = AIToolRegistry.getStats()
    const sessions = AIManager.sessions
      ? Array.from(AIManager.sessions.keys())
          .map(id => ({ id, ...(AIManager.getSessionInfo(id) || {}) }))
          .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))
      : []

    const runtime = AIManager.getRuntimeInfo()
    res.json({
      enabled: cfg.ai?.enabled === true,
      initialized: !!AIManager.defaultClient,
      model: runtime.model || cfg.ai?.model || "",
      baseURL: maskUrl(runtime.baseURL || cfg.ai?.baseURL || ""),
      hasApiKey: runtime.hasApiKey,
      activeChannel: runtime.channel,
      activePreset: runtime.preset,
      admin: aiAdmin.active,
      toolConfig: aiAdmin.toolConfig,
      memoryConfig: aiAdmin.memoryConfig,
      imageConfig: aiAdmin.imageConfig,
      timeout: cfg.ai?.timeout,
      maxRetries: cfg.ai?.maxRetries,
      maxContextTokens: cfg.ai?.maxContextTokens,
      maxHistoryTurns: cfg.ai?.maxHistoryTurns,
      groupTrigger: AIManager.getGroupTriggerMode ? AIManager.getGroupTriggerMode() : "",
      groupChat: cfg.ai?.groupChat !== false,
      privateChat: cfg.ai?.privateChat !== false,
      masterFree: cfg.ai?.masterFree !== false,
      autoRegisterTools: cfg.ai?.autoRegisterTools === true,
      maxToolsPerRequest: aiAdmin.toolConfig.maxToolsPerRequest ?? cfg.ai?.maxToolsPerRequest ?? 0,
      allowMasterTools: aiAdmin.toolConfig.allowMasterTools !== false,
      knowledgeBase: cfg.ai?.enableKnowledgeBase !== false,
      disabledTools: cfg.ai?.disabledTools || [],
      disabledToolPlugins: cfg.ai?.disabledToolPlugins || [],
      toolStats: {
        totalTools: stats.totalTools,
        exposedTools: stats.exposedTools,
        skipped: stats.skipped,
        collisions: stats.collisions,
        plugins: stats.plugins,
      },
      tools: stats.tools,
      sessions,
    })
  })


  const sectionConfig = {
    presets: { title: "预设" },
    channels: { title: "渠道" },
    proxies: { title: "代理" },
    skills: { title: "技能" },
  }

  const SENSITIVE_SECTIONS = new Set(["channels", "proxies", "mcpServers"])

  function sectionList(section) {
    const data = aiAdmin.list(section)
    if (!SENSITIVE_SECTIONS.has(section)) return data
    const sanitized = aiAdmin.sanitized()
    const map = new Map((sanitized[section] || []).map(item => [item.id, item]))
    return data.map(item => map.get(item.id) || item)
  }

  function sectionItem(section, id) {
    return sectionList(section).find(item => item.id === id) || null
  }

  function activeIdOf(section) {
    const active = aiAdmin.active
    if (section === "presets") return active.presetId
    if (section === "channels") return active.channelId
    if (section === "proxies") return active.proxyId
    if (section === "imagePresets") return aiAdmin.imageConfig.activePresetId
    return ""
  }

  function setActiveFor(section, id) {
    if (section === "imagePresets") {
      if (id && !aiAdmin.get("imagePresets", id)) return false
      aiAdmin.imageConfig = { ...aiAdmin.imageConfig, activePresetId: id }
      return true
    }
    const kind = section === "presets" ? "preset" : section === "channels" ? "channel" : section === "proxies" ? "proxy" : ""
    if (!kind) return false
    if (id && !aiAdmin.get(section, id)) return false
    aiAdmin.setActive(kind, id)
    return true
  }

  function reloadAI() {
    try {
      return AIManager.reload()
    } catch (error) {
      try {
        Bot.makeLog("warn", ["AI 重载失败", error.message], "WebUI")
      } catch {}
      return null
    }
  }

  const channelBatchTests = new Map()

  function pickChannelValue(body = {}, channel = null, key, fallback = "") {
    const value = body[key] !== undefined ? body[key] : channel?.[key]
    return value === undefined || value === null ? fallback : value
  }

  function buildChannelClient(body = {}, channel = null) {
    const rawAdapter = String(pickChannelValue(body, channel, "adapterType", "openai"))
    const adapterType = ["openai", "gemini", "claude"].includes(rawAdapter) ? rawAdapter : "openai"
    const apiFormat =
      adapterType === "openai" &&
      pickChannelValue(body, channel, "apiFormat", "chat") === "responses"
        ? "responses"
        : "chat"
    const rawKey = String(body.apiKey || "").trim()
    const apiKey = rawKey && !rawKey.includes("***") ? rawKey : channel?.apiKey || ""
    const apiKeys = (Array.isArray(body.apiKeys) ? body.apiKeys : channel?.apiKeys || [])
      .map(entry => {
        const raw = String(entry?.key || "").trim()
        if (!raw) return null
        const kept = raw.includes("***")
          ? (channel?.apiKeys || []).find(item => item.id === entry?.id)?.key
          : raw
        return kept ? { key: kept, weight: Math.max(1, Number(entry?.weight) || 1) } : null
      })
      .filter(Boolean)
    const proxy = aiAdmin.getActiveProxy()
    const timeout = Math.min(
      Math.max(5000, Number(pickChannelValue(body, channel, "timeout", 0)) || 60000),
      180000,
    )
    return new AIClient({
      baseURL: String(pickChannelValue(body, channel, "baseURL", "")).trim(),
      apiKey,
      apiKeys: apiKeys.length ? apiKeys : undefined,
      keyStrategy: String(pickChannelValue(body, channel, "keyStrategy", "roundRobin")),
      stream: false,
      adapterType,
      apiFormat,
      chatPath: String(pickChannelValue(body, channel, "chatPath", "")).trim(),
      modelsPath: String(pickChannelValue(body, channel, "modelsPath", "")).trim(),
      responsePath: String(pickChannelValue(body, channel, "responsePath", "")).trim(),
      model:
        String(pickChannelValue(body, channel, "model", "")).trim() ||
        channel?.models?.[0] ||
        "",
      temperature: pickChannelValue(body, channel, "temperature", null),
      topP: pickChannelValue(body, channel, "topP", null),
      maxTokens: pickChannelValue(body, channel, "maxTokens", null),
      timeout,
      maxRetries: 0,
      proxyUrl: proxy?.url || "",
      channelId: channel?.id || "",
      channelName: channel?.name || "",
    })
  }

  function needsChannelKey(client) {
    return (
      !client.apiKey &&
      !(client.apiKeys || []).length &&
      /^https?:\/\/(?:api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com)/i.test(
        client.baseURL,
      )
    )
  }

  function initSSE(res) {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8")
    res.setHeader("Cache-Control", "no-cache")
    res.setHeader("Connection", "keep-alive")
    res.setHeader("Content-Encoding", "identity")
    res.setHeader("X-Accel-Buffering", "no")
    res.flushHeaders?.()
  }

  function writeSSE(res, event, data) {
    if (res.writableEnded || res.destroyed) return
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    res.flush?.()
  }

  router.get("/ai/runtime", (req, res) => {
    res.json(AIManager.getRuntimeInfo())
  })

  router.get("/ai/models", (req, res) => {
    const channels = sectionList("channels")
      .map(item => ({
        id: item.id,
        name: item.name,
        enabled: item.enabled !== false,
        adapterType: item.adapterType,
        apiFormat: item.apiFormat,
        baseURL: item.baseURL,
        hasApiKey: !!item.hasApiKey,
        priority: item.priority || 0,
        model: item.model || "",
        models: [...new Set([...(item.models || []), item.model].filter(Boolean))],
        modelTests: Object.fromEntries(
          Object.entries(item.modelTests || {}).map(([name, info]) => [
            name,
            {
              status: info?.status || "",
              latency: Number.isFinite(info?.latency) ? info.latency : null,
              testedAt: info?.testedAt || "",
            },
          ]),
        ),
      }))
      .sort((a, b) => b.priority - a.priority)

    const pool = new Map()
    for (const channel of channels) {
      if (!channel.enabled) continue
      for (const model of channel.models) {
        if (!pool.has(model)) pool.set(model, { id: model, channels: [] })
        pool.get(model).channels.push({ id: channel.id, name: channel.name })
      }
    }

    const runtime = AIManager.getRuntimeInfo()
    const preset = aiAdmin.getActivePreset()
    res.json({
      activeChannelId: aiAdmin.getActiveChannel()?.id || "",
      effectiveChannelId: runtime.channel?.id || "",
      channels,
      pool: [...pool.values()],
      current: {
        model: runtime.model || "",
        channel: runtime.channel,
        preset: runtime.preset,
        presetModel: preset?.model || "",
        adapterType: runtime.adapterType,
        apiFormat: runtime.apiFormat,
        baseURL: maskUrl(runtime.baseURL || ""),
        hasApiKey: !!runtime.hasApiKey,
      },
    })
  })

  router.get("/ai/model-fallback", (req, res) => {
    res.json({ ok: true, config: aiAdmin.modelFallback })
  })

  router.post(
    "/ai/model-fallback",
    asyncRoute(async (req, res) => {
      const body = req.body || {}
      const models = Array.isArray(body.models)
        ? [
            ...new Set(
              body.models.map(item => String(item || "").trim().slice(0, 160)).filter(Boolean),
            ),
          ].slice(0, 20)
        : []
      aiAdmin.modelFallback = {
        enabled: body.enabled === true,
        models,
        strategy: ["roundRobin", "random", "failover"].includes(body.strategy) ? body.strategy : "roundRobin",
      }
      const runtime = reloadAI()
      res.json({ ok: true, config: aiAdmin.modelFallback, runtime, message: "备选模型设置已保存" })
    }),
  )

  router.post(
    "/ai/models/apply",
    asyncRoute(async (req, res) => {
      const body = req.body || {}
      const id = String(body.channelId || "").trim()
      const model = String(body.model || "").trim()
      const channel = id ? aiAdmin.get("channels", id) : null
      if (!channel) return fail(res, 404, "未找到该渠道")
      if (channel.enabled === false) return fail(res, 400, "该渠道已停用")
      if (!model) return fail(res, 400, "模型不能为空")
      const models = [...new Set([...(channel.models || []), channel.model].filter(Boolean))]
      if (models.length && !models.includes(model)) return fail(res, 400, "该模型不在渠道的模型列表中")

      if (channel.model !== model) {
        channel.model = model
        channel.updatedAt = new Date().toISOString()
        aiAdmin.save()
      }
      if (aiAdmin.active.channelId !== id) aiAdmin.setActive("channel", id)
      const runtime = reloadAI()
      const preset = aiAdmin.getActivePreset()
      const presetNote = preset?.model ? `；预设固定使用 ${preset.model}，会优先于该选择` : ""
      res.json({
        ok: true,
        runtime,
        channel: sectionItem("channels", id),
        message: `已切换到 ${channel.name} · ${model}${presetNote}`,
      })
    }),
  )

  const sectionSlug = section => section.replace(/[A-Z]/g, ch => `-${ch.toLowerCase()}`)

  router.get(
    "/ai/channels/:id/secrets",
    asyncRoute(async (req, res) => {
      const channel = aiAdmin.get("channels", String(req.params.id || ""))
      if (!channel) return fail(res, 404, "未找到该渠道")
      res.json({
        ok: true,
        apiKey: channel.apiKey || "",
        apiKeys: (channel.apiKeys || []).map(entry => ({ id: entry.id, key: entry.key || "" })),
      })
    }),
  )

  router.post(
    "/ai/presets/export",
    asyncRoute(async (req, res) => {
      const body = req.body || {}
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : []
      const all = aiAdmin.list("presets")
      const list = ids.length ? all.filter(item => ids.includes(item.id)) : all
      if (!list.length) return fail(res, 400, "没有可导出的预设")
      const payload = list.map(item => ({
        name: item.name || "未命名预设",
        description: item.description || "",
        roleName: item.roleName || "",
        persona: {
          personality: item.personality || "",
          likes: item.likes || "",
          dislikes: item.dislikes || "",
          speakingStyle: item.speakingStyle || "",
        },
        systemPrompt: item.systemPrompt || "",
        reasoningEffort: item.thinkingLevel || "auto",
        prefixes: Array.isArray(item.prefixes) ? item.prefixes : [],
        stickerTags: Array.isArray(item.stickerTags) ? item.stickerTags : [],
        stickersOwnOnly: item.stickersOwnOnly === true,
        toolPermission: item.toolPermission || "inherit",
        maxDangerLevel: item.maxDangerLevel || "inherit",
        budgetNotice: item.budgetNotice || "",
        createdAt: item.createdAt || "",
        updatedAt: item.updatedAt || "",
      }))
      const content = JSON.stringify(list.length === 1 ? payload[0] : payload, null, 2)
      const stamp = new Date().toISOString().slice(0, 10)
      const base = list.length === 1 ? String(list[0].name || "preset").replace(/[\\/:*?"<>|]/g, "_") : "presets"
      res.json({ ok: true, name: `${base}-${stamp}.json`, count: list.length, content })
    }),
  )

  for (const section of Object.keys(sectionConfig)) {
    const slug = sectionSlug(section)
    router.get(`/ai/${slug}`, (req, res) => {
      const data = sectionList(section)
      res.json({
        section,
        title: sectionConfig[section].title,
        items: data,
        activeId: activeIdOf(section),
        ...(section === "imagePresets" ? { config: aiAdmin.imageConfig } : {}),
      })
    })

    router.post(
      `/ai/${slug}`,
      asyncRoute(async (req, res) => {
        const item = aiAdmin.upsert(section, req.body || {})
        const runtime = reloadAI()
        res.json({
          ok: true,
          item: sectionItem(section, item.id) || item,
          runtime,
          message: `${sectionConfig[section].title}已保存`,
        })
      }),
    )

    router.delete(
      `/ai/${slug}/:id`,
      asyncRoute(async (req, res) => {
        const id = String(req.params.id || "").trim()
        if (!id) return fail(res, 400, "ID 不能为空")
        if (!aiAdmin.remove(section, id)) return fail(res, 404, "未找到该条目")
        const runtime = reloadAI()
        res.json({ ok: true, runtime, message: `${sectionConfig[section].title}已删除` })
      }),
    )

    router.post(
      `/ai/${slug}/:id/active`,
      asyncRoute(async (req, res) => {
        const raw = String(req.params.id || "").trim()
        const id = raw === "none" ? "" : raw
        if (!setActiveFor(section, id)) return fail(res, 404, "未找到该条目")
        const runtime = reloadAI()
        res.json({ ok: true, activeId: id, runtime, message: id ? "已启用" : "已取消启用" })
      }),
    )
  }

  router.post(
    "/ai/channels/test",
    asyncRoute(async (req, res) => {
      const body = req.body || {}
      const id = String(body.id || "").trim()
      const channel = id ? aiAdmin.get("channels", id) : null
      if (id && !channel) return fail(res, 404, "未找到该渠道")
      const client = buildChannelClient(body, channel)
      if (needsChannelKey(client)) return fail(res, 400, "该服务商需要 API Key")

      const model = String(body.model || "").trim()
      const result = model ? await client.testModel(model) : await client.testConnection()
      if (id) {
        aiAdmin.setChannelTestResult(id, {
          status: result.ok ? "success" : "failed",
          message: result.ok
            ? result.message ||
              (result.models?.length ? `获取到 ${result.models.length} 个模型` : "接口可用")
            : result.error,
          latency: result.latency,
          model,
        })
      }
      res.json({
        ok: result.ok === true,
        target: channel?.name || "未保存渠道",
        channel: id ? sectionItem("channels", id) : null,
        ...result,
      })
    }),
  )

  router.post(
    "/ai/channels/test-batch",
    asyncRoute(async (req, res) => {
      const body = req.body || {}
      const id = String(body.id || "").trim()
      const channel = id ? aiAdmin.get("channels", id) : null
      if (id && !channel) return fail(res, 404, "未找到该渠道")
      if (body.models !== undefined && body.models !== null && !Array.isArray(body.models))
        return fail(res, 400, "models 必须是数组")

      const requested = Array.isArray(body.models)
        ? body.models.map(model => String(model || "").trim()).filter(Boolean)
        : []
      const fallback = channel?.models?.length
        ? channel.models
        : [channel?.model || String(body.model || "").trim()].filter(Boolean)
      const testModels = [...new Set(requested.length ? requested : fallback)]
      if (!testModels.length) return fail(res, 400, "没有可测试的模型")

      const client = buildChannelClient(body, channel)
      if (needsChannelKey(client)) return fail(res, 400, "该服务商需要 API Key")

      const concurrency = Math.min(20, Math.max(1, Number(body.concurrency) || 3))
      const testId = `cht_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`
      const state = {
        id: testId,
        aborted: false,
        total: testModels.length,
        completed: 0,
        results: [],
      }
      channelBatchTests.set(testId, state)
      res.on("close", () => {
        state.aborted = true
      })

      initSSE(res)
      writeSSE(res, "start", {
        testId,
        total: testModels.length,
        channelId: id,
        channelName: channel?.name || "",
        models: testModels,
        concurrency,
        adapterType: client.adapterType,
        apiFormat: client.apiFormat,
      })
      if (id) aiAdmin.beginChannelModelTests(id, testModels)

      let nextIndex = 0
      const worker = async () => {
        while (!state.aborted) {
          const index = nextIndex++
          if (index >= testModels.length) return
          const model = testModels[index]
          writeSSE(res, "testing", {
            model,
            index,
            completed: state.completed,
            total: state.total,
          })
          const result = await client.testModel(model)
          state.results.push({
            model,
            index,
            ok: result.ok === true,
            latency: result.latency || 0,
            message: result.message || "",
            error: result.error || "",
          })
          state.completed++
          writeSSE(res, "result", state.results[state.results.length - 1])
          writeSSE(res, "progress", {
            completed: state.completed,
            total: state.total,
            success: state.results.filter(item => item.ok).length,
            failed: state.results.filter(item => !item.ok).length,
          })
        }
      }

      try {
        await Promise.all(
          Array.from({ length: Math.min(concurrency, testModels.length) }, () => worker()),
        )
      } catch (error) {
        Bot.makeLog("warn", ["渠道批量测试异常", error.message], "WebUI")
      }

      const results = state.results.sort((a, b) => a.index - b.index)
      let updated = null
      if (id) {
        aiAdmin.setChannelModelTestResults(id, results)
        if (state.aborted && results.length < testModels.length) {
          aiAdmin.setChannelTestResult(id, {
            status: "pending",
            message: `已测试 ${results.length}/${testModels.length} 个模型`,
            latency: null,
          })
        }
        updated = sectionItem("channels", id)
      }

      writeSSE(res, "complete", {
        testId,
        aborted: state.aborted,
        total: testModels.length,
        success: results.filter(item => item.ok).length,
        failed: results.filter(item => !item.ok).length,
        results,
        channel: updated,
      })
      channelBatchTests.delete(testId)
      if (!res.writableEnded) res.end()
    }),
  )

  router.post(
    "/ai/channels/test-batch-stop",
    asyncRoute(async (req, res) => {
      const testId = String(req.body?.testId || "").trim()
      if (testId) {
        const state = channelBatchTests.get(testId)
        if (!state) return res.json({ ok: true, stopped: false, message: "测试任务不存在或已完成" })
        state.aborted = true
        return res.json({ ok: true, stopped: true, testId })
      }
      let count = 0
      for (const state of channelBatchTests.values()) {
        state.aborted = true
        count++
      }
      res.json({ ok: true, stopped: true, count })
    }),
  )

  router.post(
    "/ai/channels/models",
    asyncRoute(async (req, res) => {
      const body = req.body || {}
      const id = String(body.id || "").trim()
      const channel = id ? aiAdmin.get("channels", id) : null
      if (id && !channel) return fail(res, 404, "未找到该渠道")
      const client = buildChannelClient(body, channel)
      if (needsChannelKey(client)) return fail(res, 400, "该服务商需要 API Key")
      const models = await client.listModels()
      res.json({
        ok: true,
        models,
        adapterType: client.adapterType,
        apiFormat: client.apiFormat,
      })
    }),
  )

  router.get(
    "/ai/tools",
    asyncRoute(async (req, res) => {
      const stats = AIToolRegistry.getStats()
      const tools = stats.tools.map(tool => {
        const raw = AIToolRegistry.sources.get(tool.name)
        return {
          ...tool,
          pluginKey: raw?.pluginKey || "",
          raw: !!raw?.handler,
        }
      })
      const pluginMap = new Map()
      for (const tool of tools) {
        const entry = pluginMap.get(tool.plugin) || { name: tool.plugin, count: 0 }
        entry.count++
        pluginMap.set(tool.plugin, entry)
      }
      res.json({
        tools,
        plugins: [...pluginMap.values()].sort((a, b) => b.count - a.count),
        config: aiAdmin.toolConfig,
        yaml: {
          disabledTools: cfg.ai?.disabledTools || [],
          disabledToolPlugins: cfg.ai?.disabledToolPlugins || [],
          autoRegisterTools: cfg.ai?.autoRegisterTools === true,
          lazyTools: cfg.ai?.lazyTools !== false,
          maxToolsPerRequest: cfg.ai?.maxToolsPerRequest ?? 0,
          toolResultMaxLength: cfg.ai?.toolResultMaxLength ?? 4000,
          maxToolRounds: cfg.ai?.maxToolRounds ?? 5,
        },
        stats: {
          totalTools: stats.totalTools,
          exposedTools: stats.exposedTools,
          skipped: stats.skipped,
          collisions: stats.collisions,
          plugins: stats.plugins,
        },
      })
    }),
  )

  function normalizeToolNameList(value, current, limit, label) {
    if (!Array.isArray(value)) return current.map(String)
    const out = []
    for (const item of value) {
      const name = String(item ?? "").trim()
      if (!name) continue
      if (name.length > 100) throw new ConfigError(`${label}名称过长`)
      if (!out.includes(name)) out.push(name)
      if (out.length > limit) throw new ConfigError(`${label}列表最多 ${limit} 项`)
    }
    return out
  }

  router.post(
    "/ai/tools/config",
    asyncRoute(async (req, res) => {
      const body = req.body || {}
      const config = body.config && typeof body.config === "object" && !Array.isArray(body.config) ? body.config : body
      const currentYaml = {
        disabledTools: (cfg.ai?.disabledTools || []).map(String),
        disabledToolPlugins: (cfg.ai?.disabledToolPlugins || []).map(String),
        autoRegisterTools: cfg.ai?.autoRegisterTools === true,
        lazyTools: cfg.ai?.lazyTools !== false,
      }
      const nextYaml = {
        disabledTools: normalizeToolNameList(body.yaml?.disabledTools, currentYaml.disabledTools, 500, "禁用工具"),
        disabledToolPlugins: normalizeToolNameList(
          body.yaml?.disabledToolPlugins,
          currentYaml.disabledToolPlugins,
          200,
          "禁用插件",
        ),
        autoRegisterTools:
          body.yaml?.autoRegisterTools === undefined
            ? currentYaml.autoRegisterTools
            : body.yaml.autoRegisterTools === true,
        lazyTools: body.yaml?.lazyTools === undefined ? currentYaml.lazyTools : body.yaml.lazyTools !== false,
      }
      const updates = []
      if (JSON.stringify(currentYaml.disabledTools) !== JSON.stringify(nextYaml.disabledTools))
        updates.push({ path: ["disabledTools"], value: nextYaml.disabledTools })
      if (JSON.stringify(currentYaml.disabledToolPlugins) !== JSON.stringify(nextYaml.disabledToolPlugins))
        updates.push({ path: ["disabledToolPlugins"], value: nextYaml.disabledToolPlugins })
      if (currentYaml.autoRegisterTools !== nextYaml.autoRegisterTools)
        updates.push({ path: ["autoRegisterTools"], value: nextYaml.autoRegisterTools })
      if (currentYaml.lazyTools !== nextYaml.lazyTools)
        updates.push({ path: ["lazyTools"], value: nextYaml.lazyTools })
      if (updates.length) saveCoreConfig("ai", { updates })

      aiAdmin.toolConfig = config
      AIToolRegistry.builtinDisabledTools = [
        ...(aiAdmin.toolConfig?.disabledTools || []),
        ...(cfg.ai?.disabledTools || []),
      ]
      AIManager.rebuildBuiltinTools()
      AIToolRegistry.rebuildPluginTools(
        (PluginsLoader.priority || []).map(entry => ({
          plugin: entry.plugin,
          class: entry.class,
          key: entry.key,
          name: entry.name,
          priority: entry.priority,
          namespace: entry.namespace,
          builtin: entry.builtin,
        })),
      )
      res.json({
        ok: true,
        config: aiAdmin.toolConfig,
        yaml: {
          disabledTools: cfg.ai?.disabledTools || [],
          disabledToolPlugins: cfg.ai?.disabledToolPlugins || [],
          autoRegisterTools: cfg.ai?.autoRegisterTools === true,
          lazyTools: cfg.ai?.lazyTools !== false,
        },
        message: updates.length ? "工具配置与 ai.yaml 已保存" : "工具配置已保存",
      })
    }),
  )

  router.get(
    "/ai/mcp",
    asyncRoute(async (req, res) => {
      const data = aiAdmin.sanitized()
      const builtin = mcpManager.getStatus().find(item => item.builtin)
      res.json({
        items: [
          {
            id: builtin.id,
            name: builtin.name,
            transport: "builtin",
            enabled: true,
            builtin: true,
            description: "进程内 MCP 服务，统一提供插件命令、知识库、记忆与绘图工具",
            permission: "all",
          },
          ...data.mcpServers,
        ],
        status: mcpManager.getStatus(),
      })
    }),
  )

  async function saveMcpServer(body) {
    const saved = aiAdmin.upsert("mcpServers", body || {})
    await mcpManager.disconnect(saved.id)
    let connected = false
    let error = ""
    if (saved.enabled) {
      try {
        await mcpManager.connect(saved)
        connected = true
      } catch (err) {
        error = err.message || String(err)
      }
    }
    return {
      saved,
      item: aiAdmin.sanitized().mcpServers.find(server => server.id === saved.id) || null,
      connected,
      error,
    }
  }

  router.post(
    "/ai/mcp",
    asyncRoute(async (req, res) => {
      const { item, connected, error } = await saveMcpServer(req.body)
      res.json({
        ok: true,
        item,
        connected,
        error,
        status: mcpManager.getStatus(),
        message: connected ? "MCP 服务已保存并连接" : error ? `已保存，但连接失败：${error}` : "MCP 服务已保存",
      })
    }),
  )

  router.put(
    "/ai/mcp/:id",
    asyncRoute(async (req, res) => {
      const id = String(req.params.id || "").trim()
      if (!aiAdmin.get("mcpServers", id)) return fail(res, 404, "未找到该 MCP 服务")
      const { item, connected, error } = await saveMcpServer({ ...(req.body || {}), id })
      res.json({
        ok: true,
        item,
        connected,
        error,
        status: mcpManager.getStatus(),
        message: connected ? "MCP 服务已保存并连接" : error ? `已保存，但连接失败：${error}` : "MCP 服务已保存",
      })
    }),
  )

  router.delete(
    "/ai/mcp/:id",
    asyncRoute(async (req, res) => {
      const id = String(req.params.id || "").trim()
      if (id === "__builtin__") return fail(res, 400, "内置工具服务不可删除")
      await mcpManager.disconnect(id)
      if (!aiAdmin.remove("mcpServers", id)) return fail(res, 404, "未找到该 MCP 服务")
      res.json({ ok: true, status: mcpManager.getStatus(), message: "MCP 服务已删除" })
    }),
  )

  router.post(
    "/ai/mcp/sync",
    asyncRoute(async (req, res) => {
      const status = await mcpManager.sync()
      res.json({ ok: true, status, message: "MCP 服务同步完成" })
    }),
  )

  router.post(
    "/ai/mcp/:id/connect",
    asyncRoute(async (req, res) => {
      const id = String(req.params.id || "").trim()
      if (id === "__builtin__") {
        mcpManager.refreshBuiltin()
        return res.json({ ok: true, status: mcpManager.getStatus(), message: "内置工具服务已刷新" })
      }
      const server = aiAdmin.get("mcpServers", id)
      if (!server) return fail(res, 404, "未找到该 MCP 服务")
      try {
        await mcpManager.disconnect(id)
        await mcpManager.connect(server)
      } catch (error) {
        return res.status(400).json({
          ok: false,
          error: "connect_failed",
          message: error.message || String(error),
          status: mcpManager.getStatus(),
        })
      }
      res.json({ ok: true, status: mcpManager.getStatus(), message: "MCP 服务已连接" })
    }),
  )

  router.post(
    "/ai/mcp/:id/disconnect",
    asyncRoute(async (req, res) => {
      const id = String(req.params.id || "").trim()
      await mcpManager.disconnect(id)
      res.json({ ok: true, status: mcpManager.getStatus(), message: "MCP 服务已断开" })
    }),
  )

  router.get(
    "/ai/image-presets",
    asyncRoute(async (req, res) => {
      res.json({
        items: aiAdmin.list("imagePresets"),
        activeId: aiAdmin.imageConfig.activePresetId,
        config: aiAdmin.imageConfig,
      })
    }),
  )

  router.post(
    "/ai/image-presets",
    asyncRoute(async (req, res) => {
      const item = aiAdmin.upsert("imagePresets", req.body || {})
      reloadAI()
      res.json({ ok: true, item, config: aiAdmin.imageConfig, message: "绘图预设已保存" })
    }),
  )

  router.delete(
    "/ai/image-presets/:id",
    asyncRoute(async (req, res) => {
      const id = String(req.params.id || "").trim()
      if (!aiAdmin.remove("imagePresets", id)) return fail(res, 404, "未找到该绘图预设")
      reloadAI()
      res.json({ ok: true, config: aiAdmin.imageConfig, message: "绘图预设已删除" })
    }),
  )

  router.post(
    "/ai/image-presets/:id/active",
    asyncRoute(async (req, res) => {
      const raw = String(req.params.id || "").trim()
      const id = raw === "none" ? "" : raw
      if (id && !aiAdmin.get("imagePresets", id)) return fail(res, 404, "未找到该绘图预设")
      aiAdmin.imageConfig = { ...aiAdmin.imageConfig, activePresetId: id }
      reloadAI()
      res.json({ ok: true, activeId: id, config: aiAdmin.imageConfig, message: id ? "已启用" : "已取消启用" })
    }),
  )

  router.get(
    "/ai/image-config",
    asyncRoute(async (req, res) => {
      res.json({ config: aiAdmin.imageConfig })
    }),
  )

  router.post(
    "/ai/image-config",
    asyncRoute(async (req, res) => {
      const body = req.body || {}
      const next = { ...aiAdmin.imageConfig }
      if (body.enabled !== undefined) next.enabled = body.enabled === true
      if (body.activePresetId !== undefined) {
        const id = String(body.activePresetId || "").trim()
        if (id && !aiAdmin.get("imagePresets", id)) return fail(res, 404, "未找到该绘图预设")
        next.activePresetId = id
      }
      aiAdmin.imageConfig = next
      reloadAI()
      res.json({ ok: true, config: aiAdmin.imageConfig, message: "绘图配置已保存" })
    }),
  )

  router.post(
    "/ai/image-presets/test",
    asyncRoute(async (req, res) => {
      const prompt = String(req.body?.prompt || "").trim()
      if (!prompt) return fail(res, 400, "提示词不能为空")
      if (!AIManager.defaultClient) return fail(res, 400, "AI 客户端未初始化，请先在渠道管理中配置渠道")
      const id = String(req.body?.presetId || "").trim()
      const preset = (id ? aiAdmin.get("imagePresets", id) : aiAdmin.getImagePreset()) || null
      const finalPrompt = [preset?.promptPrefix, prompt].filter(Boolean).join(" ").trim()
      const size = /^\d{2,5}x\d{2,5}$/.test(String(req.body?.size || ""))
        ? String(req.body.size)
        : preset?.size
      const result = await AIManager.defaultClient.generateImage({
        prompt: finalPrompt,
        model: preset?.model,
        size,
        quality: preset?.quality,
        style: preset?.style,
      })
      const first = result.images?.[0] || {}
      res.json({
        ok: true,
        prompt: finalPrompt,
        url: first.url || "",
        dataUrl: first.b64_json ? `data:image/png;base64,${first.b64_json}` : "",
        revisedPrompt: first.revised_prompt || "",
        preset: preset ? { id: preset.id, name: preset.name } : null,
      })
    }),
  )

  router.get(
    "/ai/memories",
    asyncRoute(async (req, res) => {
      const page = clampInt(req.query.page, 1, 1e6, 1)
      const pageSize = clampInt(req.query.pageSize, 5, 200, 20)
      const scope = String(req.query.scope || "").trim()
      const kind = String(req.query.kind || "").trim()
      const query = String(req.query.query || "").trim()
      const result = AIManager.memoryStore.list({
        query,
        scope: scope || undefined,
        kind: kind === "episode" || kind === "fact" ? kind : undefined,
        emotion: req.query.emotion ? { primary: String(req.query.emotion) } : undefined,
        archived: String(req.query.archived || "") === "1" ? "only" : String(req.query.archived || "") === "all" ? "all" : undefined,
        page,
        pageSize,
      })
      res.json({
        ...result,
        stats: AIManager.memoryStore.stats(),
        relations: AIManager.memoryStore.relations,
        config: aiAdmin.memoryConfig,
      })
    }),
  )

  router.get(
    "/ai/memories/export",
    asyncRoute(async (req, res) => {
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="ai_memories_${dateStamp()}.json"`,
      )
      res.json({ exportedAt: new Date().toISOString(), ...AIManager.memoryStore.exportAll() })
    }),
  )

  router.post(
    "/ai/memories",
    asyncRoute(async (req, res) => {
      const body = req.body || {}
      const payload = memoryPayload(body)
      if (!payload.content && !payload.title && !payload.event)
        return fail(res, 400, "回忆内容不能为空")
      payload.scope = payload.scope || "global"
      const scopeError = memoryScopeError(payload.scope)
      if (scopeError) return fail(res, 400, scopeError)
      const result = AIManager.memoryStore.add(
        {
          ...payload,
          source: String(body.source || "manual"),
        },
        { max: aiAdmin.memoryConfig.maxMemories },
      )
      if (!result.success) return fail(res, 400, result.error)
      res.json({
        ok: true,
        action: result.action,
        entry: result.entry,
        message:
          result.action === "merged"
            ? "内容已与已有回忆合并"
            : result.entry.kind === "episode"
              ? "经历已添加"
              : "回忆已添加",
      })
    }),
  )

  router.patch(
    "/ai/memories/:id",
    asyncRoute(async (req, res) => {
      const body = req.body || {}
      const updates = memoryPayload(body)
      if (updates.scope !== undefined) {
        const scopeError = memoryScopeError(updates.scope)
        if (scopeError) return fail(res, 400, scopeError)
      }
      if (!Object.keys(updates).length) return fail(res, 400, "没有需要更新的字段")
      const result = AIManager.memoryStore.update(String(req.params.id), updates)
      if (!result.success) return fail(res, 404, result.error)
      res.json({ ok: true, entry: result.entry, message: "回忆已更新" })
    }),
  )

  router.delete(
    "/ai/memories/:id",
    asyncRoute(async (req, res) => {
      if (!AIManager.memoryStore.remove(String(req.params.id))) return fail(res, 404, "未找到该记忆")
      res.json({ ok: true, message: "记忆已删除" })
    }),
  )

  router.post(
    "/ai/memories/:id/restore",
    asyncRoute(async (req, res) => {
      const result = AIManager.memoryStore.restoreArchived(String(req.params.id))
      if (!result.success) return fail(res, 404, result.error)
      res.json({ ok: true, entry: result.entry, message: "已从遗忘区恢复" })
    }),
  )

  router.post(
    "/ai/memories/archive-stale",
    asyncRoute(async (req, res) => {
      const archived = AIManager.memoryStore.archiveStale({
        days: Number(req.body?.days) || 180,
        importanceBelow: Number(req.body?.importanceBelow) || 0.6,
      })
      res.json({ ok: true, archived: archived.length, message: `已遗忘 ${archived.length} 条（留档可恢复）` })
    }),
  )

  router.post(
    "/ai/memories/:id/pin",
    asyncRoute(async (req, res) => {
      const pinned = req.body?.pinned !== false
      const result = AIManager.memoryStore.pin(String(req.params.id), pinned)
      if (!result.success) return fail(res, 404, result.error)
      res.json({ ok: true, entry: result.entry, message: pinned ? "已固定" : "已取消固定" })
    }),
  )

  router.post(
    "/ai/memories/compress",
    asyncRoute(async (req, res) => {
      const store = AIManager.memoryStore
      if (!store) return fail(res, 503, "记忆模块未初始化")
      const client = AIManager.defaultClient
      if (!client) return fail(res, 503, "AI 客户端未就绪，无法整理记忆")
      const dryRun = req.body?.dryRun === true
      const maxBuckets = Math.min(20, Math.max(1, Number(req.body?.maxBuckets) || 5))
      const scope = String(req.body?.scope || "").trim()
      const entries = store.entries.filter(entry => (scope ? entry.scope === scope : true))
      const buckets = buildBuckets(entries)
      if (!buckets.length) {
        return res.json({
          ok: true,
          dryRun,
          buckets: 0,
          replaced: 0,
          archived: 0,
          created: 0,
          results: [],
          message: `没有可整理的记忆（同类至少 ${BUCKET_MIN_ITEMS} 条才会合并）`,
        })
      }
      const result = await compressMemories({
        entries,
        getClient: () => client,
        store,
        dryRun,
        maxBuckets,
      })
      const done = result.results.filter(item => item.ok).length
      const skipped = result.results.filter(item => !item.ok)
      res.json({
        ...result,
        message: dryRun
          ? `预览：${done} 组可合并，${skipped.length} 组跳过`
          : done
            ? `整理完成：${result.archived} 条合并为 ${result.created} 条（旧条目留档）`
            : "这批记忆没有值得合并的",
      })
    }),
  )

  router.post(
    "/ai/memories/clear",
    asyncRoute(async (req, res) => {
      AIManager.memoryStore.clear()
      res.json({ ok: true, message: "记忆已清空" })
    }),
  )

  router.post(
    "/ai/memory-config",
    asyncRoute(async (req, res) => {
      aiAdmin.memoryConfig = req.body || {}
      res.json({ ok: true, config: aiAdmin.memoryConfig, message: "记忆配置已保存" })
    }),
  )

  router.get(
    "/ai/stickers",
    asyncRoute(async (req, res) => {
      const store = Bot.aiStickers
      if (!store) return fail(res, 503, "表情包模块未初始化")
      store.load()
      const items = store.list({
        query: String(req.query.query || ""),
        category: String(req.query.category || ""),
        presetId: String(req.query.presetId || ""),
        scopeByPreset: false,
      })
      res.json({
        items,
        categories: store.stats().byCategory,
        stats: store.stats(),
        config: aiAdmin.stickerConfig,
        presets: aiAdmin.list("presets").map(item => ({ id: item.id, name: item.name })),
      })
    }),
  )

  const stickerRaw = express.raw({
    type: ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/bmp"],
    limit: "8mb",
  })

  router.post(
    "/ai/stickers",
    stickerRaw,
    asyncRoute(async (req, res) => {
      const store = Bot.aiStickers
      if (!store) return fail(res, 503, "表情包模块未初始化")
      const meaning = String(req.query.meaning || "").trim()
      const category = String(req.query.category || "").trim() || "其他"
      if (!meaning) return fail(res, 400, "请填写表情含义")
      try {
        const cfg = aiAdmin.stickerConfig
        const { entry, duplicate, pending, similar, similarity } = await store.add(req.body, {
          meaning,
          category,
          description: String(req.query.description || ""),
          tags: String(req.query.tags || "")
            .split(/[,，]/)
            .map(tag => tag.trim())
            .filter(Boolean),
          mimeType: req.get("content-type"),
          source: "webui",
          requireReview: cfg.requireReview === true,
          reviewTimeoutMs: (Number(cfg.reviewTimeoutHours) || 24) * 3600 * 1000,
          similarityThreshold: cfg.similarityThreshold,
        })
        res.json({
          ok: true,
          duplicate,
          similar: similar === true,
          similarity: similar === true ? similarity : undefined,
          pending: pending === true,
          item: entry,
          message: similar
            ? `这张和库里「${entry.category}/${entry.meaning}」相似度 ${similarity}%，超过上限，已拒绝保存`
            : pending
              ? `已提交审核，${Number(cfg.reviewTimeoutHours) || 24} 小时内未处理会自动通过`
              : duplicate
                ? "这张表情已存在"
                : `已保存为「${entry.category}/${entry.meaning}」`,
        })
      } catch (error) {
        return fail(res, 400, error.message || "保存失败")
      }
    }),
  )

  router.get(
    "/ai/stickers/pending",
    asyncRoute(async (req, res) => {
      const store = Bot.aiStickers
      if (!store) return fail(res, 503, "表情包模块未初始化")
      res.json({
        items: store.listPending(),
        config: aiAdmin.stickerConfig,
      })
    }),
  )

  router.post(
    "/ai/stickers/pending/:id/approve",
    asyncRoute(async (req, res) => {
      const store = Bot.aiStickers
      if (!store) return fail(res, 503, "表情包模块未初始化")
      const result = store.approve(String(req.params.id || ""))
      if (!result) return fail(res, 404, "待审表情不存在")
      res.json({ ok: true, item: result.entry, duplicate: result.duplicate === true, message: "已放行" })
    }),
  )

  router.post(
    "/ai/stickers/pending/:id/reject",
    asyncRoute(async (req, res) => {
      const store = Bot.aiStickers
      if (!store) return fail(res, 503, "表情包模块未初始化")
      if (!store.reject(String(req.params.id || ""), req.body?.reason || ""))
        return fail(res, 404, "待审表情不存在")
      res.json({ ok: true, message: "已拒绝" })
    }),
  )

  router.get(
    "/ai/stickers/pending/:id/file",
    asyncRoute(async (req, res) => {
      const store = Bot.aiStickers
      if (!store) return fail(res, 503, "表情包模块未初始化")
      const item = store.getPending(String(req.params.id || ""))
      if (!item) return fail(res, 404, "待审表情不存在")
      const abs = path.join(store.dir, item.file)
      if (!fsSync.existsSync(abs)) return fail(res, 404, "图片已丢失")
      res.setHeader("Content-Type", item.ext === "jpg" ? "image/jpeg" : `image/${item.ext}`)
      res.setHeader("Cache-Control", "private, max-age=600")
      res.send(fsSync.readFileSync(abs))
    }),
  )

  router.get(
    "/ai/stickers/file/:id",
    asyncRoute(async (req, res) => {
      const store = Bot.aiStickers
      if (!store) return fail(res, 503, "表情包模块未初始化")
      store.load()
      const entry = store.get(String(req.params.id || ""))
      if (!entry) return fail(res, 404, "表情不存在")
      const abs = store.absPath(entry)
      if (!fsSync.existsSync(abs)) return fail(res, 404, "表情文件已丢失")
      const mime = entry.ext === "jpg" ? "image/jpeg" : `image/${entry.ext}`
      res.setHeader("Content-Type", mime)
      res.setHeader("Cache-Control", "private, max-age=86400")
      res.send(fsSync.readFileSync(abs))
    }),
  )

  router.post(
    "/ai/stickers/enrich",
    asyncRoute(async (req, res) => {
      const store = Bot.aiStickers
      if (!store) return fail(res, 503, "表情包模块未初始化")
      if (!AIManager._clientSupportsVision())
        return fail(res, 400, "当前渠道不支持图片输入，无法自动补全描述")
      store.load()
      const client = AIManager.defaultClient
      if (!client) return fail(res, 503, "AI 客户端未就绪")
      const limit = Math.min(20, Math.max(1, Number(req.body?.limit) || 5))
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : []
      const pool = ids.length ? ids.map(id => store.get(id)).filter(Boolean) : store.entries
      const targets = pool
        .filter(entry => !entry.description || !(entry.tags || []).length)
        .slice(0, limit)
      const results = []
      for (const entry of targets) {
        let buffer = null
        try {
          buffer = fsSync.readFileSync(store.absPath(entry))
        } catch {
          results.push({ id: entry.id, ok: false, error: "文件已丢失" })
          continue
        }
        const described = await describeWithVision(buffer, client)
        if (!described) {
          results.push({ id: entry.id, ok: false, error: "识图失败" })
          continue
        }
        const patch = {}
        if (!entry.description && described.description) patch.description = described.description
        if (!(entry.tags || []).length && described.tags?.length) patch.tags = described.tags
        if (!Object.keys(patch).length) {
          results.push({ id: entry.id, ok: true, unchanged: true })
          continue
        }
        store.update(entry.id, patch)
        results.push({ id: entry.id, ok: true, patch })
      }
      const remaining = store.entries.filter(entry => !entry.description || !(entry.tags || []).length).length
      const done = results.filter(item => item.ok && !item.unchanged).length
      res.json({
        ok: true,
        done,
        results,
        remaining,
        message: done ? `补全 ${done} 张，还剩 ${remaining} 张` : remaining ? "这批没补出内容" : "描述和标签都齐了",
      })
    }),
  )

  router.put(
    "/ai/stickers/:id",
    asyncRoute(async (req, res) => {
      const store = Bot.aiStickers
      if (!store) return fail(res, 503, "表情包模块未初始化")
      store.load()
      const entry = store.update(String(req.params.id || ""), req.body || {})
      if (!entry) return fail(res, 404, "表情不存在")
      res.json({ ok: true, item: entry, message: "已更新" })
    }),
  )

  router.delete(
    "/ai/stickers/:id",
    asyncRoute(async (req, res) => {
      const store = Bot.aiStickers
      if (!store) return fail(res, 503, "表情包模块未初始化")
      store.load()
      if (!store.remove(String(req.params.id || ""))) return fail(res, 404, "表情不存在")
      res.json({ ok: true, message: "已删除" })
    }),
  )

  router.post(
    "/ai/stickers/config",
    asyncRoute(async (req, res) => {
      aiAdmin.stickerConfig = req.body || {}
      res.json({ ok: true, config: aiAdmin.stickerConfig, message: "表情包配置已保存" })
    }),
  )

  const backendConsole = new AIBackendConsole({
    getBot: () => Bot,
    getLoader: () => PluginsLoader,
  })

  const hasOnlineProtocol = () =>
    Array.from(Bot.uin || []).some(id => Number(id) > 0 && Bot.isBotOnline(Bot.bots?.[id]))

  router.get(
    "/backend",
    asyncRoute(async (req, res) => {
      res.json({
        protocolOnline: hasOnlineProtocol(),
        history: backendConsole.getHistory(),
      })
    }),
  )

  router.get(
    "/backend/image/:id",
    asyncRoute(async (req, res) => {
      const image = backendConsole.getImage(String(req.params.id || ""))
      if (!image) return fail(res, 404, "图片不存在或已过期")
      res.setHeader("Content-Type", image.mime)
      res.setHeader("Content-Length", image.buffer.length)
      res.setHeader("Cache-Control", "private, max-age=300")
      res.setHeader("X-Content-Type-Options", "nosniff")
      res.end(image.buffer)
    }),
  )

  router.post(
    "/backend/stream",
    asyncRoute(async (req, res) => {
      const command = String(req.body?.command || "")
      const allowDangerous = req.body?.allowDangerous === true
      initSSE(res)
      const startedAt = Date.now()
      const send = (event, data) => writeSSE(res, event, data)
      send("start", { command, at: startedAt })
      try {
        const record = await backendConsole.run(command, {
          allowDangerous,
          onChunk: text => send("chunk", { text }),
          onImage: image => send("image", { image }),
        })
        send("done", record)
      } catch (error) {
        send("error", { message: error.message || "执行失败" })
      } finally {
        res.end()
      }
    }),
  )

  router.post(
    "/backend/clear",
    asyncRoute(async (req, res) => {
      backendConsole.clearHistory()
      res.json({ ok: true, message: "已清空后端记录" })
    }),
  )

  router.get(
    "/ai/voice",
    asyncRoute(async (req, res) => {
      res.json({
        config: { ...aiAdmin.voiceConfig, apiKey: aiAdmin.voiceConfig.apiKey ? "***" : "" },
        voices: FREE_VOICES,
      })
    }),
  )

  router.post(
    "/ai/voice",
    asyncRoute(async (req, res) => {
      aiAdmin.voiceConfig = req.body || {}
      res.json({ ok: true, config: { ...aiAdmin.voiceConfig, apiKey: aiAdmin.voiceConfig.apiKey ? "***" : "" }, message: "语音配置已保存" })
    }),
  )

  router.post(
    "/ai/voice/test",
    asyncRoute(async (req, res) => {
      const text = String(req.body?.text || "你好，这是语音测试").slice(0, 120)
      const saved = aiAdmin.voiceConfig
      const input = req.body?.config && typeof req.body.config === "object" ? req.body.config : null
      const provider = ["free", "custom"].includes(input?.provider) ? input.provider : saved.provider
      const apiKeyInput = String(input?.apiKey || "")
      const config = input
        ? {
            ...saved,
            ...input,
            provider,
            apiKey: !apiKeyInput || apiKeyInput.includes("***") ? saved.apiKey : apiKeyInput,
            voice: String(input.voice || (provider === "custom" ? "alloy" : "zh")).slice(0, 40),
            speed: provider === "custom" ? customVoiceSpeed(input.speed) : freeVoiceSpeed(input.speed),
            baseURL: String(input.baseURL || "").slice(0, 500),
            model: String(input.model || "").slice(0, 120),
          }
        : saved
      try {
        const { file } = await synthesize(text, config)
        const buffer = fsSync.readFileSync(file)
        res.json({ ok: true, dataUrl: `data:audio/mp3;base64,${buffer.toString("base64")}`, message: "合成成功" })
      } catch (error) {
        return fail(res, 400, error.message || "语音合成失败")
      }
    }),
  )

  router.get(
    "/ai/proactive",
    asyncRoute(async (req, res) => {
      res.json({
        config: aiAdmin.proactiveConfig,
        aiEnabled: cfg.ai?.enabled === true,
        running: !!AIManager.proactive?.timer,
        optInGroups: aiAdmin.listGroups()
          .filter(item => item.enabled !== false && item.proactiveChat === true)
          .map(item => item.id),
        stats: [...(AIManager.proactive?.stats || new Map())].map(([groupId, state]) => ({
          groupId,
          messages: state.messages,
          todayCount: state.todayCount,
          lastSpeakAt: state.lastSpeakAt,
        })),
      })
    }),
  )

  router.post(
    "/ai/proactive",
    asyncRoute(async (req, res) => {
      aiAdmin.proactiveConfig = req.body || {}
      const proactiveCfg = aiAdmin.proactiveConfig
      const aiEnabled = cfg.ai?.enabled === true
      const running = AIManager.syncProactiveScheduler()
      const message = !aiEnabled
        ? "已保存；AI 总开关关闭，主动聊天暂不运行"
        : proactiveCfg.enabled
          ? "主动聊天已开启"
          : running
            ? "全局已关闭，仍有群单独开启"
            : "主动聊天已关闭"
      res.json({ ok: true, config: proactiveCfg, aiEnabled, running, message })
    }),
  )

  router.get(
    "/ai/records",
    asyncRoute(async (req, res) => {
      const page = clampInt(req.query.page, 1, 1e6, 1)
      const pageSize = clampInt(req.query.pageSize, 5, 200, 30)
      const result = AIManager.recordStore.list({
        type: String(req.query.type || ""),
        query: String(req.query.query || ""),
        days: clampInt(req.query.days, 0, 3650, 0),
        page,
        pageSize,
        success: String(req.query.success || ""),
      })
      res.json({ ...result, filters: { type: req.query.type || "", days: req.query.days || 0 } })
    }),
  )

  router.get(
    "/ai/records/export",
    asyncRoute(async (req, res) => {
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="ai_records_${dateStamp()}.json"`,
      )
      res.json(
        AIManager.recordStore.export({
          type: String(req.query.type || ""),
          query: String(req.query.query || ""),
          days: clampInt(req.query.days, 0, 3650, 0),
          success: String(req.query.success || ""),
        }),
      )
    }),
  )

  router.post(
    "/ai/records/clear",
    asyncRoute(async (req, res) => {
      AIManager.recordStore.clear()
      res.json({ ok: true, message: "调用记录已清空" })
    }),
  )

  router.get(
    "/ai/stats",
    asyncRoute(async (req, res) => {
      const days = clampInt(req.query.days, 1, 365, 7)
      res.json({ days, ...AIManager.recordStore.stats(days) })
    }),
  )

  router.get(
    "/ai/tool-calls",
    asyncRoute(async (req, res) => {
      const page = clampInt(req.query.page, 1, 1e6, 1)
      const pageSize = clampInt(req.query.pageSize, 5, 200, 30)
      const days = clampInt(req.query.days, 0, 3650, 0)
      const result = AIManager.recordStore.list({
        type: "tool",
        query: String(req.query.query || ""),
        days,
        page,
        pageSize,
        success: String(req.query.success || ""),
      })
      const stats = AIManager.recordStore.stats(Math.max(1, days || 7))
      res.json({
        ...result,
        filters: { days },
        byTool: stats.byTool,
        totals: {
          toolCalls: stats.totals.toolCalls,
          errors: stats.totals.errors,
        },
      })
    }),
  )

  router.get(
    "/ai/sessions",
    asyncRoute(async (req, res) => {
      const page = clampInt(req.query.page, 1, 1e6, 1)
      const pageSize = clampInt(req.query.pageSize, 5, 100, 20)
      const result = AIManager.sessionStore.list({
        query: String(req.query.query || ""),
        page,
        pageSize,
      })
      res.json({
        ...result,
        active: AIManager.sessionCount,
        disk: AIManager.sessionStore.count,
      })
    }),
  )

  router.get(
    "/ai/sessions/export",
    asyncRoute(async (req, res) => {
      const id = String(req.query.id || "").trim()
      const data = AIManager.sessionStore.export(id || undefined)
      if (!data) return fail(res, 404, "未找到该会话")
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="ai_sessions_${dateStamp()}.json"`,
      )
      res.json(data)
    }),
  )

  router.post(
    "/ai/sessions/clear",
    asyncRoute(async (req, res) => {
      AIManager.sessions.clear()
      AIManager.sessionStore.clear()
      res.json({ ok: true, message: "对话历史已清空" })
    }),
  )

  router.get(
    "/ai/sessions/:id",
    asyncRoute(async (req, res) => {
      const id = String(req.params.id || "")
      const record = AIManager.sessionStore.detail(id)
      if (!record) return fail(res, 404, "未找到该会话")
      res.json({
        record,
        info: AIManager.getSessionInfo(id),
        inMemory: AIManager.sessions.has(id),
      })
    }),
  )

  router.delete(
    "/ai/sessions/:id",
    asyncRoute(async (req, res) => {
      const id = String(req.params.id || "")
      const removed = AIManager.deleteSession(id, true)
      if (!removed && !AIManager.sessionStore.detail(id)) return fail(res, 404, "未找到该会话")
      res.json({ ok: true, message: "会话已删除" })
    }),
  )

  router.post(
    "/ai/sessions/:id/clear",
    asyncRoute(async (req, res) => {
      const id = String(req.params.id || "")
      const context =
        AIManager.sessions.get(id) ||
        AIManager.sessionStore.restoreSession(id, AIManager.sessions)
      if (!context) return fail(res, 404, "未找到该会话")
      context.clear()
      AIManager.sessionStore.saveSession(id, context)
      res.json({ ok: true, message: "会话上下文已清空" })
    }),
  )

  router.post(
    "/ai/sessions/:id/compress",
    asyncRoute(async (req, res) => {
      const id = String(req.params.id || "")
      const context =
        AIManager.sessions.get(id) ||
        AIManager.sessionStore.restoreSession(id, AIManager.sessions)
      if (!context) return fail(res, 404, "未找到该会话")
      if (!AIManager.defaultClient) return fail(res, 400, "AI 客户端未初始化")
      const ok = await context.compress(AIManager.defaultClient)
      if (ok) AIManager.sessionStore.saveSession(id, context)
      res.json({
        ok,
        info: AIManager.getSessionInfo(id),
        message: ok ? "上下文压缩完成" : "当前会话无需压缩或压缩失败",
      })
    }),
  )

  router.get("/ai/groups", (req, res) => {
    const known = collectGroups().filter(group => {
      const id = String(group.group_id || "")
      return id && id !== "stdin" && !id.startsWith("stdin:")
    })
    const seenGroups = new Set()
    const uniqueKnown = known.filter(group => {
      const key = normalizeGroupId(group.group_id)
      if (seenGroups.has(key)) return false
      seenGroups.add(key)
      return true
    })
    const overrides = aiAdmin.listGroups()
    const overrideMap = new Map(overrides.map(item => [normalizeGroupId(item.id), item]))
    const groups = uniqueKnown.map(group => {
      const bareId = normalizeGroupId(group.group_id)
      return {
        ...group,
        name: group.name || (bareId.includes(":") ? `官机群 · ${bareId.split(":").pop().slice(-6)}` : ""),
        ai: overrideMap.get(bareId) || null,
      }
    })
    const knownIds = new Set(uniqueKnown.map(group => normalizeGroupId(group.group_id)))
    for (const override of overrides)
      if (!knownIds.has(normalizeGroupId(override.id)))
        groups.push({
          group_id: override.id,
          name: `(未同步群 ${override.id})`,
          memberCount: 0,
          maxMemberCount: 0,
          botId: "",
          ai: override,
        })
    res.json({
      groups,
      presets: aiAdmin.list("presets").map(item => ({ id: item.id, name: item.name })),
      defaultTrigger: AIManager.getGroupTriggerMode(),
      defaultTriggerSwitches: { ...AIManager.getGroupTrigger(), proactive: aiAdmin.proactiveConfig.enabled === true },
      tools: AIToolRegistry.getStats().tools.map(tool => ({
        name: tool.name,
        plugin: tool.plugin,
        permission: tool.permission,
        danger: tool.danger,
      })),
      plugins: [...new Set(AIToolRegistry.getStats().tools.map(tool => tool.plugin))].sort(),
    })
  })

  router.post(
    "/ai/groups/:groupId",
    asyncRoute(async (req, res) => {
      try {
        const group = aiAdmin.setGroup(String(req.params.groupId || ""), req.body || {})
        AIManager.syncProactiveScheduler()
        res.json({ ok: true, group, message: group ? "群组 AI 配置已保存" : "群组 AI 配置已恢复默认" })
      } catch (error) {
        return fail(res, 400, error.message)
      }
    }),
  )

  router.delete(
    "/ai/groups/:groupId",
    asyncRoute(async (req, res) => {
      const removed = aiAdmin.deleteGroup(String(req.params.groupId || ""))
      AIManager.syncProactiveScheduler()
      res.json({ ok: true, removed, message: removed ? "群组 AI 配置已删除" : "该群没有覆盖配置" })
    }),
  )

  router.get(
    "/knowledge",
    asyncRoute(async (req, res) => {
      const kb = getKnowledgeBase()
      const page = clampInt(req.query.page, 1, 1e6, 1)
      const pageSize = clampInt(req.query.pageSize, 5, 100, 12)
      const query = String(req.query.query || "").trim()
      const scope = req.query.scope ? String(req.query.scope) : ""
      const tag = req.query.tag ? String(req.query.tag) : ""
      const source = req.query.source ? String(req.query.source) : ""
      const scopes = scope ? [scope] : undefined

      const result = kb.search(query, {
        limit: pageSize,
        offset: (page - 1) * pageSize,
        scopes,
        tags: tag ? [tag] : undefined,
        source: source || undefined,
        trackAccess: false,
      })

      res.json({
        ...result,
        page,
        pageSize,
        filters: { query, scope, tag, source },
        stats: kb.getStats(),
        tags: kb.getTags({ scopes }).slice(0, 60),
      })
    }),
  )

  router.get("/knowledge/export", (req, res) => {
    const kb = getKnowledgeBase()
    const data = {
      exportedAt: new Date().toISOString(),
      storagePath: kb.storagePath,
      entries: kb.exportAll(),
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8")
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="ai_knowledge_${dateStamp()}.json"`,
    )
    res.send(JSON.stringify(data, null, 2))
  })

  router.get("/knowledge/:id", (req, res) => {
    const entry = getKnowledgeBase().get(String(req.params.id))
    if (!entry) return fail(res, 404, "未找到该知识条目")
    res.json({ entry })
  })

  router.post(
    "/knowledge",
    asyncRoute(async (req, res) => {
      const body = req.body || {}
      const title = String(body.title || "").trim()
      const content = String(body.content || "").trim()
      const scope = normalizeScope(body.scope)
      if (!title) return fail(res, 400, "标题不能为空")
      if (!content) return fail(res, 400, "内容不能为空")
      if (!scope) return fail(res, 400, "scope 无效：可选 master / public / group:<群号> / user:<QQ号>")

      const kb = getKnowledgeBase()
      const result = kb.addOrMerge({
        title,
        content,
        tags: normalizeTags(body.tags),
        source: "manual",
        scope,
      })
      if (!result.success) return fail(res, 400, result.error)

      if (body.pinned === true) kb.pin(result.entry.id, true)
      res.json({
        ok: true,
        action: result.action,
        entry: kb.get(result.entry.id),
        message: result.action === "merged" ? "内容与已有知识相近，已合并" : "知识已添加",
      })
    }),
  )

  router.patch(
    "/knowledge/:id",
    asyncRoute(async (req, res) => {
      const id = String(req.params.id)
      const body = req.body || {}
      const updates = {}
      if (body.title !== undefined) updates.title = String(body.title).trim()
      if (body.content !== undefined) updates.content = String(body.content).trim()
      if (body.tags !== undefined) updates.tags = normalizeTags(body.tags)
      if (body.pinned !== undefined) updates.pinned = body.pinned === true
      if (body.scope !== undefined) {
        const scope = normalizeScope(body.scope)
        if (!scope) return fail(res, 400, "scope 无效")
        updates.scope = scope
      }
      if (!Object.keys(updates).length) return fail(res, 400, "没有需要更新的字段")

      const kb = getKnowledgeBase()
      const result = kb.update(id, updates)
      if (!result.success) return fail(res, 400, result.error)
      res.json({ ok: true, entry: kb.get(id), message: "知识已更新" })
    }),
  )

  router.delete(
    "/knowledge/:id",
    asyncRoute(async (req, res) => {
      const kb = getKnowledgeBase()
      const result = kb.delete(String(req.params.id))
      if (!result.success) return fail(res, 404, result.error)
      res.json({ ok: true, message: `已删除「${result.title}」` })
    }),
  )

  router.get("/groups", asyncRoute(async (req, res) => {
    const groups = collectGroups()
    const friends = collectFriends()
    res.json({
      groups,
      friends,
      bots: await collectBots(),
      totals: { groups: groups.length, friends: friends.length },
    })
  }))

  router.get(
    "/groups/history",
    asyncRoute(async (req, res) => {
      const kind =
        req.query.kind === "group" ? "group" : req.query.kind === "friend" ? "friend" : ""
      if (!kind) return fail(res, 400, "消息类型无效")
      const targetId = String(req.query.id ?? "").trim()
      if (!targetId) return fail(res, 400, kind === "group" ? "缺少群号" : "缺少账号")
      const count = Math.min(Math.max(Number(req.query.count) || 20, 1), 50)

      const botId = String(req.query.botId ?? "").trim()
      const { client, target, error } = resolveChatTarget(kind, targetId, botId)
      if (error) return fail(res, 400, error)

      const selfId = String(client?.uin ?? botId)
      const isQQBot = chatClientIsQQBot(client)
      const manager = kind === "group" ? await chatSelfIsGroupManager(target, selfId) : false
      const capabilities = {
        recall: typeof target?.recallMsg === "function",
        quote: typeof target?.sendMsg === "function",
        react: kind === "group" && typeof target?.setMsgEmojiLike === "function",
        recallOthers: kind === "group" && (isQQBot || manager),
        manager,
      }

      const recalled = recalledChatMap(kind, botId, targetId)
      const markRecalled = messages =>
        messages.map(item => {
          const source = recalled.get(String(item.id))
          if (source === undefined) return item
          return { ...item, recalled: true, recalledBySelf: source === true }
        })

      if (typeof target?.getChatHistory !== "function")
        return res.json({
          ok: true,
          supported: false,
          capabilities,
          messages: markRecalled(
            attachChatReactions(kind, botId, targetId, cachedChatMessages(kind, botId, targetId, count)),
          ),
        })

      let history
      try {
        const historyCursor =
          kind === "friend" && String(client?.adapter?.name || "") === "ICQQ" ? undefined : 0
        history = await AIManager._withTimeout(target.getChatHistory(historyCursor, count), 8000)
      } catch (error) {
        return fail(res, 502, `读取消息失败：${error?.message || "协议端未响应"}`)
      }

      const messages = markRecalled(
        attachChatReactions(
          kind,
          botId,
          targetId,
          resolveChatQuotes(
            (Array.isArray(history) ? history : [])
              .map(item => normalizeChatMessage(item, selfId))
              .filter(item => item.text || item.images.length)
              .sort((a, b) => a.time - b.time)
              .slice(-count),
          ),
        ),
      )
      res.json({ ok: true, supported: true, capabilities, messages })
    }),
  )

  router.post(
    "/groups/send",
    asyncRoute(async (req, res) => {
      const body = req.body || {}
      const kind = body.kind === "group" ? "group" : body.kind === "friend" ? "friend" : ""
      if (!kind) return fail(res, 400, "消息类型无效")
      const targetId = String(body.id ?? "").trim()
      if (!targetId) return fail(res, 400, kind === "group" ? "缺少群号" : "缺少账号")
      const text = typeof body.text === "string" ? body.text : ""
      if (!text.trim()) return fail(res, 400, "消息内容不能为空")
      if (text.length > 4000) return fail(res, 400, "消息内容不能超过 4000 字")
      const replyTo = String(body.replyTo ?? "").trim()

      const botId = String(body.botId ?? "").trim()
      const { client, target, error } = resolveChatTarget(kind, targetId, botId)
      if (error) return fail(res, 400, error)
      if (!target?.sendMsg) return fail(res, 400, kind === "group" ? "找不到该群聊" : "找不到该好友")

      const message = []
      if (replyTo) message.push({ type: "reply", id: replyTo })
      message.push({ type: "text", text })

      let result
      try {
        result = await target.sendMsg(message)
      } catch (error) {
        Bot.makeLog("error", ["WebUI 发送消息失败", error], `${botId || "?"} => ${targetId}`)
        return fail(res, 502, `发送失败：${error?.message || "协议端未响应"}`)
      }
      const messageId = chatSendMessageId(result)
      const quoted = replyTo
        ? cachedChatMessages(kind, botId, targetId, RECENT_CHAT_LIMIT).find(
            item => String(item.id) === replyTo,
          )
        : null
      const cached = {
        id: messageId,
        userId: String(client?.uin ?? botId),
        name: client?.nickname || client?.info?.nickname || botId || "机器人",
        text,
        images: [],
        time: Date.now(),
        self: true,
      }
      if (replyTo) cached.quote = { id: replyTo, ...(quoted ? { name: quoted.name, text: quoted.text } : {}) }
      rememberChatMessage(kind, botId, targetId, cached)
      res.json({ ok: true, message: "已发送", at: Date.now(), messageId, replyTo })
    }),
  )

  router.post(
    "/groups/recall",
    asyncRoute(async (req, res) => {
      const body = req.body || {}
      const kind = body.kind === "group" ? "group" : body.kind === "friend" ? "friend" : ""
      if (!kind) return fail(res, 400, "消息类型无效")
      const targetId = String(body.id ?? "").trim()
      if (!targetId) return fail(res, 400, kind === "group" ? "缺少群号" : "缺少账号")
      const messageId = String(body.messageId ?? "").trim()
      if (!messageId) return fail(res, 400, "缺少消息 ID")

      const botId = String(body.botId ?? "").trim()
      const { client, target, error } = resolveChatTarget(kind, targetId, botId)
      if (error) return fail(res, 400, error)
      if (typeof target?.recallMsg !== "function") return fail(res, 400, "该协议端不支持撤回")

      const selfId = String(client?.uin ?? botId)
      const isQQBot = chatClientIsQQBot(client)
      const manager = kind === "group" ? await chatSelfIsGroupManager(target, selfId) : false
      const senderId = await chatMessageSenderId(kind, botId, targetId, target, messageId)
      if (senderId && senderId !== selfId) {
        if (kind === "friend") return fail(res, 403, "撤回失败：只能撤回机器人自己发送的消息")
        if (!manager && !isQQBot) return fail(res, 403, "撤回失败：需要群主或管理员权限")
      }
      if (!manager) {
        const sentAt = await chatMessageSentAt(kind, botId, targetId, target, messageId)
        if (!sentAt) return fail(res, 409, "撤回失败：无法确认消息发送时间")
        if (Date.now() - sentAt > CHAT_RECALL_WINDOW_MS)
          return fail(
            res,
            409,
            kind === "group"
              ? "撤回失败：超过 2 分钟，仅群主或管理员可撤回"
              : "撤回失败：超过 2 分钟，无法撤回",
          )
      }

      let result
      try {
        result = await AIManager._withTimeout(target.recallMsg(messageId), 8000)
      } catch (error) {
        Bot.makeLog("error", ["WebUI 撤回消息失败", error], `${botId || "?"} => ${targetId}`)
        return fail(res, 502, `撤回失败：${error?.message || "协议端未响应"}`)
      }
      if (chatRecallFailed(result)) {
        const reason = chatRecallError(result) || "协议端未确认"
        Bot.makeLog("warn", ["WebUI 撤回消息未成功", reason], `${botId || "?"} => ${targetId}`)
        return fail(res, 502, `撤回失败：${reason}`)
      }

      recallCachedMessage(kind, botId, targetId, messageId, true)
      res.json({ ok: true, message: "已撤回" })
    }),
  )

  router.post(
    "/groups/react",
    asyncRoute(async (req, res) => {
      const body = req.body || {}
      const kind = body.kind === "group" ? "group" : body.kind === "friend" ? "friend" : ""
      if (!kind) return fail(res, 400, "消息类型无效")
      const targetId = String(body.id ?? "").trim()
      if (!targetId) return fail(res, 400, kind === "group" ? "缺少群号" : "缺少账号")
      const messageId = String(body.messageId ?? "").trim()
      if (!messageId) return fail(res, 400, "缺少消息 ID")
      const emojiId = String(body.emojiId ?? body.emoji_id ?? "").trim()
      if (!/^\d{1,12}$/.test(emojiId)) return fail(res, 400, "表情 ID 无效")
      const emoji = String(body.emoji ?? "")
        .trim()
        .slice(0, 16)
        .replace(/[\u0000-\u001f\u007f]/g, "")

      const botId = String(body.botId ?? "").trim()
      const { target, error } = resolveChatTarget(kind, targetId, botId)
      if (error) return fail(res, 400, error)
      if (typeof target?.setMsgEmojiLike !== "function")
        return fail(res, 400, "该账号不支持贴表情")

      let result
      try {
        result = await AIManager._withTimeout(
          target.setMsgEmojiLike(messageId, emojiId, body.set !== false),
          8000,
        )
      } catch (error) {
        Bot.makeLog("error", ["WebUI 贴表情失败", error], `${botId || "?"} => ${targetId}`)
        return fail(res, 502, `贴表情失败：${error?.message || "协议端未响应"}`)
      }
      if (chatRecallFailed(result)) {
        const reason = chatRecallError(result) || "协议端未确认"
        Bot.makeLog("warn", ["WebUI 贴表情未成功", reason], `${botId || "?"} => ${targetId}`)
        return fail(res, 502, `贴表情失败：${reason}`)
      }
      const reaction = { emojiId, emoji: emoji || chatEmojiText(emojiId) }
      rememberChatReaction(kind, botId, targetId, messageId, reaction)
      res.json({ ok: true, message: "已贴表情", reaction })
    }),
  )

  router.get(
    "/logs",
    asyncRoute(async (req, res) => {
      const type = req.query.type === "error" ? "error" : "command"
      const opts = getOptions()
      const lines = clampInt(req.query.lines, 20, opts.logLines, opts.logLines)
      const data = await readLogTail(type, lines)
      res.json({ type, lines: data, total: data.length, now: Date.now() })
    }),
  )

  app.use("/api", router)

  app.use((req, res) => {
    if (req.method === "GET" && !req.path.includes(".")) {
      res.setHeader("Cache-Control", "no-store")
      return res.sendFile(path.join(PUBLIC_DIR, "index.html"))
    }
    res.status(404).json({ error: "not_found", message: "页面不存在" })
  })

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error)
    const status = Number(error?.status)
    const code = status >= 400 && status < 600 ? status : 500
    if (code >= 500) {
      try {
        Bot.makeLog("error", ["WebUI", req.method, safeUrl(req), error], "WebUI")
      } catch {}
    }
    res.status(code).json({
      error: code >= 500 ? "internal_error" : "request_failed",
      message: error?.message || "服务器内部错误",
    })
  })

  return app
}

export function mountWebUI() {
  let opts = getOptions()
  if (!opts.enable) {
    Bot.makeLog("info", "WebUI 已禁用（config/config/webui.yaml: enable: false）", "WebUI")
    return { basePath: null, dispose() {} }
  }

  opts = ensureInitialCredential(opts)

  const expressApp = Bot.express
  const stack = expressApp?.router?.stack || expressApp?._router?.stack
  if (!expressApp || !stack) {
    Bot.makeLog("warn", "WebUI 未挂载：Bot.express 尚不可用（仅真实 Bot 运行时可挂载）", "WebUI")
    return { basePath: null, dispose() {} }
  }
  if (expressApp.skip_auth && !expressApp.skip_auth.includes(opts.basePath))
    expressApp.skip_auth.push(opts.basePath)

  const app = buildApp(opts)
  const stopChatWatch = watchChatMessages()
  const before = stack.length

  expressApp.get(opts.basePath, (req, res, next) => {
    if (req.path !== opts.basePath) return next()
    res.redirect(308, `${opts.basePath}/`)
  })
  expressApp.use(opts.basePath, app)

  refreshGauges().catch(() => {})

  const added = stack.slice(before)
  Bot.makeLog(
    "mark",
    `WebUI 已启动: ${logger.cyan(`http://localhost:${cfg.server?.port}${opts.basePath}/`)}${opts.token ? logger.gray("（需要访问密码）") : logger.gray("（访问密码未生成）")}`,
    "WebUI",
  )

  return {
    basePath: opts.basePath,
    dispose() {
      stopChatWatch()
      for (const layer of added) {
        const index = stack.indexOf(layer)
        if (index !== -1) stack.splice(index, 1)
      }
      if (expressApp.skip_auth) {
        const index = expressApp.skip_auth.indexOf(opts.basePath)
        if (index !== -1) expressApp.skip_auth.splice(index, 1)
      }
    },
  }
}
