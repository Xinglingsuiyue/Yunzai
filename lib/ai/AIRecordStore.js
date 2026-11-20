import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { WEBUI_DATA_DIR } from "../webui/dataDir.js"

const STORE_FILE = path.join(WEBUI_DATA_DIR, "ai-records.ndjson")
const MAX_MEMORY = 20000
const MAX_FILE_SIZE = 8 * 1024 * 1024
const DAY_MS = 86400000
const STATS_VERSION = 2

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

function emptyDay() {
  return {
    chats: 0,
    toolCalls: 0,
    errors: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedTokens: 0,
    latencyTotal: 0,
    latencyCount: 0,
    apiRequests: 0,
    apiRetries: 0,
    apiErrors: 0,
    models: {},
    channels: {},
    tools: {},
    apiKinds: {},
  }
}

export default class AIRecordStore {
  constructor(file = STORE_FILE) {
    this.file = file
    this.statsFile = file.replace(/\.ndjson$/, "-stats.json")
    this.metaFile = file.replace(/\.ndjson$/, "-stats-meta.json")
    this.records = []
    this.daily = {}
    this.apiSince = 0
    this.loaded = false
    this._appendCount = 0
    this._saveTimer = null
  }

  load() {
    this._loadDaily()
    const knownDays = Object.keys(this.daily).length
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      if (fs.existsSync(this.file)) {
        const text = fs.readFileSync(this.file, "utf8")
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
      }
    } catch (error) {
      console.error(`[AIRecordStore] 读取失败: ${error.message}`)
      this.records = []
    }
    this._backfillDaily()
    const meta = this._loadMeta()
    this.apiSince = Number(meta.apiSince) || 0
    let rebuilt = false
    if ((Number(meta.version) || 0) < STATS_VERSION) {
      rebuilt = this._rebuildAllDays()
      if (rebuilt) this._saveMeta()
    } else {
      rebuilt = this._rebuildRecentDays()
    }
    if (rebuilt || Object.keys(this.daily).length !== knownDays) this._saveDaily()
    this.loaded = true
    return this
  }

  _loadMeta() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.metaFile, "utf8"))
      return parsed && typeof parsed === "object" ? parsed : {}
    } catch {
      return {}
    }
  }

  _saveMeta() {
    try {
      const meta = { version: STATS_VERSION }
      if (this.apiSince) meta.apiSince = this.apiSince
      fs.writeFileSync(this.metaFile, JSON.stringify(meta), "utf8")
    } catch (error) {
      console.error(`[AIRecordStore] 版本写入失败: ${error.message}`)
    }
  }

  _loadDaily() {
    try {
      if (!fs.existsSync(this.statsFile)) return
      const parsed = JSON.parse(fs.readFileSync(this.statsFile, "utf8"))
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) this.daily = parsed
    } catch (error) {
      console.error(`[AIRecordStore] 统计读取失败: ${error.message}`)
    }
  }

  _saveDaily() {
    try {
      const cutoff = dateKey(Date.now() - 400 * DAY_MS)
      for (const key of Object.keys(this.daily)) {
        if (key < cutoff) delete this.daily[key]
      }
      fs.mkdirSync(path.dirname(this.statsFile), { recursive: true })
      const tmp = `${this.statsFile}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(this.daily), "utf8")
      fs.renameSync(tmp, this.statsFile)
    } catch (error) {
      console.error(`[AIRecordStore] 统计写入失败: ${error.message}`)
    }
  }

  _scheduleSave() {
    if (this._saveTimer) return
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null
      this._saveDaily()
    }, 2000)
    this._saveTimer.unref?.()
  }

  _backfillDaily() {
    try {
      const known = new Set(Object.keys(this.daily))
      const sources = []
      if (fs.existsSync(this.file)) sources.push(this.file)
      if (!known.size) {
        try {
          const dir = path.dirname(this.file)
          const base = path.basename(this.file, ".ndjson")
          for (const name of fs.readdirSync(dir)) {
            if (name.startsWith(`${base}.`) && name.endsWith(".ndjson")) sources.push(path.join(dir, name))
          }
        } catch {}
      }
      const seen = new Set()
      for (const source of sources) {
        let text
        try {
          text = fs.readFileSync(source, "utf8")
        } catch {
          continue
        }
        for (const line of text.split("\n")) {
          const trimmed = line.trim()
          if (!trimmed) continue
          let record
          try {
            record = JSON.parse(trimmed)
          } catch {
            continue
          }
          if (!record?.ts || known.has(dateKey(record.ts))) continue
          if (record.id) {
            if (seen.has(record.id)) continue
            seen.add(record.id)
          }
          this._countRecord(record)
        }
      }
    } catch (error) {
      console.error(`[AIRecordStore] 统计补全失败: ${error.message}`)
    }
  }


  _rebuildAllDays() {
    const previous = this.daily
    const apiSnapshot = this._apiSnapshot()
    this.daily = {}
    try {
      const sources = []
      if (fs.existsSync(this.file)) sources.push(this.file)
      const dir = path.dirname(this.file)
      const base = path.basename(this.file, ".ndjson")
      const currentName = path.basename(this.file)
      for (const name of fs.readdirSync(dir)) {
        if (name === currentName) continue
        if (name.startsWith(`${base}.`) && name.endsWith(".ndjson")) sources.push(path.join(dir, name))
      }
      const seen = new Set()
      for (const source of sources) {
        let text
        try {
          text = fs.readFileSync(source, "utf8")
        } catch {
          continue
        }
        for (const line of text.split("\n")) {
          const trimmed = line.trim()
          if (!trimmed) continue
          let record
          try {
            record = JSON.parse(trimmed)
          } catch {
            continue
          }
          if (!record?.ts) continue
          if (record.id) {
            if (seen.has(record.id)) continue
            seen.add(record.id)
          }
          this._countRecord(record)
        }
      }
      for (const [key, entry] of Object.entries(previous)) {
        if (!this.daily[key]) this.daily[key] = entry
      }
      this._restoreApi(apiSnapshot)
      return true
    } catch (error) {
      this.daily = previous
      console.error(`[AIRecordStore] 统计升级失败: ${error.message}`)
      return false
    }
  }


  _rebuildRecentDays() {
    try {
      if (!fs.existsSync(this.file)) return false
      const sources = [this.file]
      const days = new Set()
      let minDay = ""
      const current = fs.readFileSync(this.file, "utf8")
      for (const line of current.split("\n")) {
        const trimmed = line.trim()
        if (!trimmed) continue
        let record
        try {
          record = JSON.parse(trimmed)
        } catch {
          continue
        }
        if (!record?.ts) continue
        const key = dateKey(record.ts)
        days.add(key)
        if (!minDay || key < minDay) minDay = key
      }
      if (!days.size) return false
      const dir = path.dirname(this.file)
      const base = path.basename(this.file, ".ndjson")
      for (const name of fs.readdirSync(dir)) {
        const match = name.match(/^(.+)\.(\d{4}-\d{2}-\d{2})\.ndjson$/)
        if (!match || match[1] !== base || match[2] < minDay) continue
        sources.push(path.join(dir, name))
      }
      const seen = new Set()
      const candidates = []
      for (const source of sources) {
        let text
        try {
          text = fs.readFileSync(source, "utf8")
        } catch {
          continue
        }
        for (const line of text.split("\n")) {
          const trimmed = line.trim()
          if (!trimmed) continue
          let record
          try {
            record = JSON.parse(trimmed)
          } catch {
            continue
          }
          if (!record?.ts || !days.has(dateKey(record.ts))) continue
          if (record.id) {
            if (seen.has(record.id)) continue
            seen.add(record.id)
          }
          candidates.push(record)
        }
      }
      const apiSnapshot = {}
      for (const key of days) {
        if (this.daily[key]) apiSnapshot[key] = this._apiFields(this.daily[key])
        this.daily[key] = emptyDay()
      }
      for (const record of candidates) this._countRecord(record)
      this._restoreApi(apiSnapshot)
      return true
    } catch (error) {
      console.error(`[AIRecordStore] 统计重建失败: ${error.message}`)
      return false
    }
  }

  _day(ts) {
    const key = dateKey(ts)
    if (!this.daily[key]) this.daily[key] = emptyDay()
    return this.daily[key]
  }


  _apiFields(entry) {
    return {
      apiRequests: entry.apiRequests || 0,
      apiRetries: entry.apiRetries || 0,
      apiErrors: entry.apiErrors || 0,
      apiKinds: entry.apiKinds || {},
    }
  }

  _apiSnapshot() {
    const out = {}
    for (const [key, entry] of Object.entries(this.daily)) out[key] = this._apiFields(entry)
    return out
  }

  _restoreApi(snapshot) {
    for (const [key, api] of Object.entries(snapshot)) {
      const day = this.daily[key]
      if (day) Object.assign(day, api)
    }
  }


  countApiRequest({ kind = "chat", retry = 0, ok = true } = {}) {
    this._ensure()
    const day = this._day(Date.now())
    day.apiRequests = (day.apiRequests || 0) + 1
    if (retry > 0) day.apiRetries = (day.apiRetries || 0) + 1
    if (!ok) day.apiErrors = (day.apiErrors || 0) + 1
    const key = kind || "chat"
    if (!day.apiKinds) day.apiKinds = {}
    if (!day.apiKinds[key]) day.apiKinds[key] = { calls: 0, errors: 0 }
    day.apiKinds[key].calls++
    if (!ok) day.apiKinds[key].errors++
    if (!this.apiSince) {
      this.apiSince = Date.now()
      this._saveMeta()
    }
    this._scheduleSave()
  }

  _countRecord(record) {
    const day = this._day(record.ts)
    const failed = record.success === false
    if (failed) day.errors++

    if (record.type === "tool") {
      day.toolCalls++
      const toolKey = record.toolName || "未标注"
      if (!day.tools[toolKey]) day.tools[toolKey] = { calls: 0, success: 0, errors: 0, duration: 0 }
      const tool = day.tools[toolKey]
      tool.calls++
      tool.duration += record.durationMs || 0
      if (failed) tool.errors++
      else tool.success++
      return
    }

    day.chats++
    day.promptTokens += record.promptTokens || 0
    day.completionTokens += record.completionTokens || 0
    day.totalTokens += record.totalTokens || 0
    day.cachedTokens += record.cachedTokens || 0
    if (record.latencyMs > 0) {
      day.latencyTotal += record.latencyMs
      day.latencyCount++
    }
    const modelKey = record.model || "未标注"
    if (!day.models[modelKey]) day.models[modelKey] = { chats: 0, tokens: 0, cachedTokens: 0, errors: 0 }
    const model = day.models[modelKey]
    if (failed) model.errors++
    model.chats++
    model.tokens += record.totalTokens || 0
    model.cachedTokens += record.cachedTokens || 0
    const channelKey = record.channelName || record.channelId || "未标注"
    if (!day.channels[channelKey]) day.channels[channelKey] = { chats: 0, tokens: 0, cachedTokens: 0, errors: 0 }
    const channel = day.channels[channelKey]
    if (failed) channel.errors++
    channel.chats++
    channel.tokens += record.totalTokens || 0
    channel.cachedTokens += record.cachedTokens || 0
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
    this._countRecord(record)
    this._scheduleSave()

    this._appendCount++
    if (this._appendCount % 500 === 0) this._rotateIfNeeded()
    try {
      fs.appendFile(this.file, `${JSON.stringify(record)}\n`, error => {
        if (error) console.error(`[AIRecordStore] 写入失败: ${error.message}`)
      })
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
    const pageSize = options.unlimited
      ? Math.max(1, Number(options.pageSize) || 100000)
      : Math.min(200, Math.max(5, Number(options.pageSize) || 30))

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
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() - (range - 1))
    const since = start.getTime()

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
        apiRequests: 0,
      })
    }

    const totals = {
      requests: 0,
      toolCalls: 0,
      toolSuccess: 0,
      toolErrors: 0,
      errors: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      latencyTotal: 0,
      latencyCount: 0,
      toolDuration: 0,
      apiRequests: 0,
      apiRetries: 0,
      apiErrors: 0,
    }
    const models = new Map()
    const channels = new Map()
    const tools = new Map()
    const apiKinds = new Map()

    for (const [key, entry] of byDayMap) {
      const day = this.daily[key]
      if (!day) continue
      entry.chats = day.chats || 0
      entry.toolCalls = day.toolCalls || 0
      entry.tokens = day.totalTokens || 0
      entry.promptTokens = day.promptTokens || 0
      entry.completionTokens = day.completionTokens || 0
      entry.cachedTokens = day.cachedTokens || 0
      entry.errors = day.errors || 0
      entry.apiRequests = day.apiRequests || 0

      totals.requests += day.chats || 0
      totals.toolCalls += day.toolCalls || 0
      totals.errors += day.errors || 0
      totals.apiRequests += day.apiRequests || 0
      totals.apiRetries += day.apiRetries || 0
      totals.apiErrors += day.apiErrors || 0
      totals.promptTokens += day.promptTokens || 0
      totals.completionTokens += day.completionTokens || 0
      totals.totalTokens += day.totalTokens || 0
      totals.cachedTokens += day.cachedTokens || 0
      totals.latencyTotal += day.latencyTotal || 0
      totals.latencyCount += day.latencyCount || 0

      for (const [name, item] of Object.entries(day.models || {})) {
        const target = models.get(name) || { key: name, chats: 0, tokens: 0, cachedTokens: 0, errors: 0 }
        target.chats += item.chats || 0
        target.tokens += item.tokens || 0
        target.cachedTokens += item.cachedTokens || 0
        target.errors += item.errors || 0
        models.set(name, target)
      }
      for (const [name, item] of Object.entries(day.channels || {})) {
        const target = channels.get(name) || { key: name, chats: 0, tokens: 0, cachedTokens: 0, errors: 0 }
        target.chats += item.chats || 0
        target.tokens += item.tokens || 0
        target.cachedTokens += item.cachedTokens || 0
        target.errors += item.errors || 0
        channels.set(name, target)
      }
      for (const [name, item] of Object.entries(day.tools || {})) {
        const target = tools.get(name) || { key: name, calls: 0, success: 0, errors: 0, duration: 0 }
        target.calls += item.calls || 0
        target.success += item.success || 0
        target.errors += item.errors || 0
        target.duration += item.duration || 0
        tools.set(name, target)
        totals.toolSuccess += item.success || 0
        totals.toolErrors += item.errors || 0
        totals.toolDuration += item.duration || 0
      }
      for (const [kind, item] of Object.entries(day.apiKinds || {})) {
        const target = apiKinds.get(kind) || { kind, calls: 0, errors: 0 }
        target.calls += item.calls || 0
        target.errors += item.errors || 0
        apiKinds.set(kind, target)
      }
    }

    totals.avgLatency = totals.latencyCount ? Math.round(totals.latencyTotal / totals.latencyCount) : 0
    totals.avgToolDuration = totals.toolCalls ? Math.round(totals.toolDuration / totals.toolCalls) : 0
    delete totals.latencyTotal
    delete totals.latencyCount
    delete totals.toolDuration

    const byModel = [...models.values()]
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

    const byChannel = [...channels.values()]
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

    const byTool = [...tools.values()]
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

    const byRequestKind = [...apiKinds.values()]
      .filter(item => item.calls > 0)
      .sort((a, b) => b.calls - a.calls)
      .map(item => ({ kind: item.kind, calls: item.calls, errors: item.errors }))

    return {
      range: { days: range, since },
      totals,
      byDay: [...byDayMap.values()],
      byModel,
      byChannel,
      byTool,
      byRequestKind,
      apiSince: this.apiSince || 0,
      recentErrors: this.records
        .filter(record => record.success === false && record.ts >= since)
        .sort((a, b) => a.ts - b.ts)
        .slice(-10)
        .reverse(),
    }
  }

  clear() {
    this.records = []
    this.daily = {}
    this.apiSince = 0
    if (this._saveTimer) {
      clearTimeout(this._saveTimer)
      this._saveTimer = null
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, "", "utf8")
      fs.writeFileSync(this.statsFile, "{}", "utf8")
      this._saveMeta()
    } catch (error) {
      console.error(`[AIRecordStore] 清空失败: ${error.message}`)
    }
  }

  export(options = {}) {
    const list = this.list({ ...options, page: 1, pageSize: 100000, unlimited: true }).results
    return { exportedAt: new Date().toISOString(), records: list }
  }
}
