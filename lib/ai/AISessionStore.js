/**
 * AI 会话持久化 — 将内存中的会话保存到 data/webui/ai_sessions.json，
 * 供 WebUI 对话历史查看、导出与重启恢复使用。
 */
import fs from "node:fs"
import path from "node:path"
import AIContext from "./AIContext.js"
import { WEBUI_DATA_DIR } from "../webui/dataDir.js"

const STORE_FILE = path.join(WEBUI_DATA_DIR, "ai_sessions.json")
const MAX_SESSIONS = 500
const RESTORE_LIMIT = 200

/** 多模态 content 是数组，直接 String() 会变成 [object Object] */
function flattenContent(value) {
  if (typeof value === "string") return value
  if (!Array.isArray(value)) return value === null || value === undefined ? "" : String(value)
  return value
    .map(part => {
      if (typeof part === "string") return part
      if (part?.type === "text") return part.text || ""
      if (part?.type === "image_url") return "[图片]"
      return ""
    })
    .join("")
}

function trimText(value, max = 200000) {
  return flattenContent(value).slice(0, max)
}

function cleanTitle(content) {
  let text = trimText(content).trim()
  text = text.replace(/^\[(群聊|私聊)消息\][^\n]*\n?/u, "")
  text = text.replace(/^用户消息:\s*/u, "")
  text = text.replace(/\s+/g, " ").trim()
  return text.slice(0, 60) || "未命名会话"
}

export default class AISessionStore {
  constructor(file = STORE_FILE) {
    this.file = file
    this.data = { version: 1, sessions: {} }
    this.loaded = false
    this._saveTimer = null
  }

  load() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"))
        if (parsed && typeof parsed.sessions === "object") {
          this.data = { version: 1, sessions: parsed.sessions }
        }
      }
    } catch (error) {
      console.error(`[AISessionStore] 读取失败: ${error.message}`)
      this.data = { version: 1, sessions: {} }
    }
    this.loaded = true
    return this
  }

  _ensure() {
    if (!this.loaded) this.load()
  }

  save() {
    if (this._saveTimer) return
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null
      this.flush()
    }, 800)
    this._saveTimer.unref?.()
  }

  flush() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const temp = `${this.file}.tmp`
      fs.writeFileSync(temp, JSON.stringify(this.data), "utf8")
      fs.renameSync(temp, this.file)
    } catch (error) {
      console.error(`[AISessionStore] 保存失败: ${error.message}`)
    }
  }

  /** 把磁盘会话恢复到内存 Map（只恢复最近的若干条） */
  restoreInto(sessions) {
    this._ensure()
    const list = Object.values(this.data.sessions)
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
      .slice(0, RESTORE_LIMIT)
    for (const record of list) {
      if (sessions.has(record.id)) continue
      const context = this._buildContext(record)
      if (context) sessions.set(record.id, context)
    }
    return sessions
  }

  restoreSession(id, sessions) {
    this._ensure()
    if (sessions.has(id)) return sessions.get(id)
    const record = this.data.sessions[id]
    if (!record) return null
    const context = this._buildContext(record)
    if (!context) return null
    sessions.set(id, context)
    return context
  }

  _buildContext(record) {
    if (!record || !Array.isArray(record.messages)) return null
    const context = new AIContext({
      systemPrompt: record.systemPrompt || "",
    })
    context.messages = record.messages
      .filter(message => message && ["user", "assistant", "system"].includes(message.role))
      .map(message => ({
        role: message.role,
        content: trimText(message.content),
        time: Number(message.time) || Date.now(),
        ...(message.presetId ? { presetId: message.presetId, presetName: message.presetName || "" } : {}),
        ...(message.internal ? { internal: true } : {}),
      }))
    context._compressed = record.compressed === true
    context._compressedSummary = trimText(record.compressedSummary, 20000)
    context._compressedTurnCount = Number(record.compressedTurnCount) || 0
    context.tokenSpent = Number(record.tokenSpent) || 0
    context.turnLimit = Number(record.turnLimit) || 0
    // 旧数据只有小时字段，读取时折算成分钟
    context.turnWindowMinutes =
      Number(record.turnWindowMinutes) || (Number(record.turnWindowHours) || 0) * 60 || 180
    context.turnUsed = Number(record.turnUsed) || 0
    context.turnWindowStart = Number(record.turnWindowStart) || 0
    context.extraTokenBudget = Number(record.extraTokenBudget) || 0
    context.extraTokenSpent = Number(record.extraTokenSpent) || 0
    context._lastActivity = Number(record.lastActivity) || 0
    return context
  }

  saveSession(id, context, meta = {}) {
    this._ensure()
    if (!id || !context) return null
    const now = new Date().toISOString()
    const existing = this.data.sessions[id] || {}
    const firstUser = context.messages.find(message => message.role === "user")
    const record = {
      id,
      title: meta.title || existing.title || (firstUser ? cleanTitle(firstUser.content) : "未命名会话"),
      createdAt: existing.createdAt || meta.createdAt || now,
      updatedAt: now,
      lastActivity: context.lastActivity || Date.now(),
      systemPrompt: trimText(context.systemPrompt, 40000),
      messages: context.messages.map(message => ({
        role: message.role,
        content: trimText(message.content),
        time: message.time,
        // 人格标记要一起存，重启后仍能区分「我」和「另一个我」
        ...(message.presetId ? { presetId: message.presetId, presetName: message.presetName || "" } : {}),
        // 内部调度占位：不参与回忆提取，刷新历史时也不当用户发言
        ...(message.internal ? { internal: true } : {}),
      })),
      compressed: context.isCompressed,
      compressedSummary: trimText(context._compressedSummary, 20000),
      compressedTurnCount: context._compressedTurnCount,
      tokenSpent: Number(context.tokenSpent) || 0,
      turnLimit: Number(context.turnLimit) || 0,
      turnWindowMinutes: Number(context.turnWindowMinutes) || 180,
      turnUsed: Number(context.turnUsed) || 0,
      turnWindowStart: Number(context.turnWindowStart) || 0,
      extraTokenBudget: Number(context.extraTokenBudget) || 0,
      extraTokenSpent: Number(context.extraTokenSpent) || 0,
      meta: {
        type: meta.type || existing.meta?.type || (id.startsWith("group:") ? "group" : id.startsWith("private:") ? "private" : "api"),
        // 会话 id 可能带 :preset:<人格>，截取时要停在冒号前，否则群号会带上人格后缀
        groupId:
          meta.groupId ||
          existing.meta?.groupId ||
          (id.startsWith("group:") ? id.slice(6).split(":")[0] : ""),
        userId: meta.userId || existing.meta?.userId || "",
        botId: meta.botId || existing.meta?.botId || "",
        groupName: meta.groupName || existing.meta?.groupName || "",
        presetId: meta.presetId || existing.meta?.presetId || (id.includes(":preset:") ? id.split(":preset:")[1] : ""),
        source: meta.source || existing.meta?.source || "chat",
      },
    }
    this.data.sessions[id] = record
    this._prune()
    this.save()
    return record
  }

  _prune() {
    const list = Object.values(this.data.sessions)
    if (list.length <= MAX_SESSIONS) return
    list
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
      .slice(MAX_SESSIONS)
      .forEach(record => delete this.data.sessions[record.id])
  }

  list(options = {}) {
    this._ensure()
    const query = String(options.query || "").trim().toLowerCase()
    const page = Math.max(1, Number(options.page) || 1)
    const pageSize = Math.min(100, Math.max(5, Number(options.pageSize) || 20))
    let list = Object.values(this.data.sessions)
    if (query) {
      list = list.filter(record => {
        const meta = record.meta || {}
        return `${record.id} ${record.title} ${meta.groupName || ""} ${meta.groupId || ""} ${meta.userId || ""}`
          .toLowerCase()
          .includes(query)
      })
    }
    list.sort((a, b) => String(b.lastActivity || b.updatedAt || "").localeCompare(String(a.lastActivity || a.updatedAt || "")))
    const total = list.length
    const results = list.slice((page - 1) * pageSize, page * pageSize).map(record => ({
      id: record.id,
      title: record.title,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastActivity: record.lastActivity,
      messageCount: record.messages?.length || 0,
      turnCount: (record.messages || []).filter(message => message.role === "user").length,
      compressed: !!record.compressed,
      meta: record.meta || {},
      preview: trimText(
        [...(record.messages || [])].reverse().find(message => message.role === "assistant")?.content,
        160,
      ),
    }))
    return { total, page, pageSize, results }
  }

  detail(id) {
    this._ensure()
    const record = this.data.sessions[id]
    return record || null
  }

  remove(id) {
    this._ensure()
    if (!this.data.sessions[id]) return false
    delete this.data.sessions[id]
    this.save()
    return true
  }

  clear() {
    this._ensure()
    this.data.sessions = {}
    this.save()
    this.flush()
  }

  export(id) {
    this._ensure()
    if (id) {
      const record = this.data.sessions[id]
      return record ? { exportedAt: new Date().toISOString(), sessions: [record] } : null
    }
    return { exportedAt: new Date().toISOString(), sessions: Object.values(this.data.sessions) }
  }

  get count() {
    this._ensure()
    return Object.keys(this.data.sessions).length
  }
}
