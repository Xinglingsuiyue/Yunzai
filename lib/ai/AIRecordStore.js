import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { WEBUI_DATA_DIR } from "../webui/dataDir.js"

const STORE_FILE = path.join(WEBUI_DATA_DIR, "ai-records.ndjson")
const MAX_MEMORY = 6000
const MAX_FILE_SIZE = 8 * 1024 * 1024
const DAY_MS = 86400000

function dateKey(ts = Date.now()) {
  const date = new Date(ts)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function trimText(value, max = 400) {
  return String(value ?? "").slice(0, max)
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export default class AIRecordStore {
  constructor(file = STORE_FILE) {
    this.file = file
    this.records = []
    this.loaded = false
    this._appendCount = 0
  }

  load() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      if (!fs.existsSync(this.file)) {
        this.loaded = true
        return this
      }
      const stat = fs.statSync(this.file)
      const readSize = Math.min(stat.size, 4 * 1024 * 1024)
      const buffer = Buffer.alloc(readSize)
      const fd = fs.openSync(this.file, "r")
      try {
        fs.readSync(fd, buffer, 0, readSize, stat.size - readSize)
      } finally {
        fs.closeSync(fd)
      }
      let text = buffer.toString("utf8")
      if (readSize < stat.size) text = text.slice(text.indexOf("\n") + 1)
      const records = []
      for (const line of text.split("\n")) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const record = JSON.parse(trimmed)
          if (record && record.ts) records.push(record)
        } catch {}
      }
      this.records = records.slice(-MAX_MEMORY)
    } catch (error) {
      console.error(`[AIRecordStore] 读取失败: ${error.message}`)
      this.records = []
    }
    this.loaded = true
    return this
  }

  _ensure() {
    if (!this.loaded) this.load()
  }

  _rotateIfNeeded() {
    try {
      if (!fs.existsSync(this.file)) return
      if (fs.statSync(this.file).size < MAX_FILE_SIZE) return
      const backup = this.file.replace(/\.ndjson$/, `.${dateKey()}.ndjson`)
      if (fs.existsSync(backup)) fs.unlinkSync(backup)
      fs.renameSync(this.file, backup)
    } catch {}
  }

  add(input = {}) {
    this._ensure()
    const record = {
      id: crypto.randomBytes(6).toString("hex"),
      ts: Number(input.ts) || Date.now(),
      type: input.type === "tool" ? "tool" : "chat",
      conversationId: trimText(input.conversationId, 120),
      groupId: input.groupId ? String(input.groupId) : "",
      userId: input.userId ? String(input.userId) : "",
      botId: input.botId ? String(input.botId) : "",
      channelId: trimText(input.channelId, 60),
      channelName: trimText(input.channelName, 80),
      presetId: trimText(input.presetId, 60),
      presetName: trimText(input.presetName, 80),
      model: trimText(input.model, 120),
      promptTokens: number(input.promptTokens),
      completionTokens: number(input.completionTokens),
      totalTokens: number(input.totalTokens),

      cachedTokens: number(input.cachedTokens),
      latencyMs: number(input.latencyMs),
      toolCalls: number(input.toolCalls),
      success: input.success !== false,
      error: trimText(input.error, 500),
      content: trimText(input.content, 300),
    }
    if (record.type === "tool") {
      record.toolName = trimText(input.toolName, 120)
      record.plugin = trimText(input.plugin, 120)
      record.args = trimText(input.args, 300)
      record.result = trimText(input.result, 300)
      record.durationMs = number(input.durationMs ?? input.latencyMs)
    }
    this.records.push(record)
    if (this.records.length > MAX_MEMORY) this.records.splice(0, this.records.length - MAX_MEMORY)

    this._appendCount++
    if (this._appendCount % 500 === 0) this._rotateIfNeeded()
    try {
      fs.appendFile(this.file, `${JSON.stringify(record)}\n`, () => {})
    } catch (error) {
      console.error(`[AIRecordStore] 写入失败: ${error.message}`)
    }
    return record
  }

  list(options = {}) {
    this._ensure()
    const type = options.type === "tool" || options.type === "chat" ? options.type : ""
    const query = String(options.query || "").trim().toLowerCase()
    const days = Math.max(0, Number(options.days) || 0)
    const since = days ? Date.now() - days * DAY_MS : 0
    const page = Math.max(1, Number(options.page) || 1)
    const pageSize = Math.min(200, Math.max(5, Number(options.pageSize) || 30))

    let list = this.records
    if (type) list = list.filter(record => record.type === type)
    if (since) list = list.filter(record => record.ts >= since)
    if (options.success === "false") list = list.filter(record => record.success === false)
    else if (options.success === "true") list = list.filter(record => record.success !== false)
    if (query) {
      list = list.filter(record =>
        `${record.conversationId} ${record.groupId} ${record.userId} ${record.channelName} ${record.model} ${record.toolName || ""} ${record.plugin || ""} ${record.args || ""} ${record.result || ""} ${record.content || ""} ${record.error || ""}`
          .toLowerCase()
          .includes(query),
      )
    }
    list = list.slice().reverse()
    const total = list.length
    const results = list.slice((page - 1) * pageSize, page * pageSize)
    return { total, page, pageSize, results }
  }

  stats(days = 7) {
    this._ensure()
    const range = Math.min(365, Math.max(1, Number(days) || 7))
    const since = Date.now() - range * DAY_MS
    const records = this.records.filter(record => record.ts >= since)
    const chats = records.filter(record => record.type === "chat")
    const tools = records.filter(record => record.type === "tool")

    const totals = {
      requests: chats.length,
      toolCalls: tools.length,
      errors: records.filter(record => record.success === false).length,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      latencyTotal: 0,
      latencyCount: 0,
    }
    for (const record of chats) {
      totals.promptTokens += record.promptTokens || 0
      totals.completionTokens += record.completionTokens || 0
      totals.totalTokens += record.totalTokens || 0
      totals.cachedTokens += record.cachedTokens || 0
      if (record.latencyMs > 0) {
        totals.latencyTotal += record.latencyMs
        totals.latencyCount++
      }
    }
    totals.avgLatency = totals.latencyCount ? Math.round(totals.latencyTotal / totals.latencyCount) : 0
    delete totals.latencyTotal
    delete totals.latencyCount

    const byDayMap = new Map()
    for (let i = range - 1; i >= 0; i--) {
      const key = dateKey(Date.now() - i * DAY_MS)
      byDayMap.set(key, {
        date: key,
        chats: 0,
        toolCalls: 0,
        tokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        cachedTokens: 0,
        errors: 0,
      })
    }
    for (const record of records) {
      const entry = byDayMap.get(dateKey(record.ts))
      if (!entry) continue
      if (record.type === "chat") {
        entry.chats++
        entry.tokens += record.totalTokens || 0
        entry.promptTokens += record.promptTokens || 0
        entry.completionTokens += record.completionTokens || 0
        entry.cachedTokens += record.cachedTokens || 0
      } else {
        entry.toolCalls++
      }
      if (record.success === false) entry.errors++
    }

    const groupCount = (keyFn, valueFn) => {
      const map = new Map()
      for (const record of records) {
        const key = keyFn(record) || "未标注"
        const item =
          map.get(key) ||
          { key, chats: 0, toolCalls: 0, tokens: 0, cachedTokens: 0, errors: 0, calls: 0, duration: 0, success: 0 }
        item.chats += record.type === "chat" ? 1 : 0
        item.toolCalls += record.type === "tool" ? 1 : 0
        item.tokens += record.totalTokens || 0
        item.cachedTokens += record.cachedTokens || 0
        item.errors += record.success === false ? 1 : 0
        if (record.type === "tool") {
          item.calls++
          item.duration += record.durationMs || 0
          item.success += record.success === false ? 0 : 1
        }
        if (valueFn) valueFn(item, record)
        map.set(key, item)
      }
      return [...map.values()]
    }

    const byModel = groupCount(record => record.model)
      .filter(item => item.chats > 0)
      .sort((a, b) => b.chats - a.chats || b.tokens - a.tokens)
      .slice(0, 12)
      .map(item => ({
        model: item.key,
        chats: item.chats,
        tokens: item.tokens,
        cachedTokens: item.cachedTokens,
        errors: item.errors,
      }))

    const byChannel = groupCount(record => record.channelName || record.channelId)
      .filter(item => item.chats > 0)
      .sort((a, b) => b.chats - a.chats)
      .slice(0, 12)
      .map(item => ({
        channel: item.key,
        chats: item.chats,
        tokens: item.tokens,
        cachedTokens: item.cachedTokens,
        errors: item.errors,
      }))

    const byTool = groupCount(record => record.toolName)
      .filter(item => item.calls > 0)
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 20)
      .map(item => ({
        tool: item.key,
        calls: item.calls,
        success: item.success,
        errors: item.errors,
        avgDuration: item.calls ? Math.round(item.duration / item.calls) : 0,
      }))

    return {
      range: { days: range, since },
      totals,
      byDay: [...byDayMap.values()],
      byModel,
      byChannel,
      byTool,
      recentErrors: records
        .filter(record => record.success === false)
        .slice(-10)
        .reverse(),
    }
  }

  clear() {
    this.records = []
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, "", "utf8")
    } catch (error) {
      console.error(`[AIRecordStore] 清空失败: ${error.message}`)
    }
  }

  export(options = {}) {
    const list = this.list({ ...options, page: 1, pageSize: 100000 }).results
    return { exportedAt: new Date().toISOString(), records: list }
  }
}
