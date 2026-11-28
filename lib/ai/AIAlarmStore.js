import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { WEBUI_DATA_DIR } from "../webui/dataDir.js"
import { normalizeGroupId } from "../config/config.js"
import { timezone, formatInZone, dayLabelInZone, nextDailyEpoch, parseDueTime } from "./AITime.js"

const STORE_FILE = path.join(WEBUI_DATA_DIR, "ai_alarms.json")
const STORE_VERSION = 1
const MAX_ALARMS = 100
const MISSED_GRACE_MS = 30 * 60 * 1000
const TEXT_MAX = 300

function text(value, max = TEXT_MAX) {
  return String(value ?? "").slice(0, max)
}

function newId() {
  return `a_${crypto.randomBytes(5).toString("hex")}`
}

function normalizeRepeat(value) {
  return value === "daily" ? "daily" : "none"
}

function normalizeScope(source = {}) {
  const groupId = source.groupId ? normalizeGroupId(source.groupId) : ""
  const userId = groupId ? "" : String(source.userId || "")
  return {
    groupId,
    userId,
    botId: String(source.botId || ""),
  }
}

function normalizeAlarm(input = {}) {
  const scope = normalizeScope(input)
  const at = Number(input.at)
  const textValue = text(input.text).trim()
  if (!scope.groupId && !scope.userId) return null
  if (!textValue || !Number.isFinite(at) || at <= 0) return null
  const repeat = normalizeRepeat(input.repeat)
  const clock = String(input.clock || "").match(/^(\d{1,2}):(\d{2})$/)
  return {
    id: /^a_[a-z0-9]{6,32}$/.test(String(input.id || "")) ? String(input.id) : newId(),
    ...scope,
    text: textValue,
    at: Math.round(at),
    repeat,
    clock: clock ? `${String(Number(clock[1])).padStart(2, "0")}:${clock[2]}` : formatInZone(at).slice(11),
    promiseId: String(input.promiseId || "").trim(),
    createdBy: String(input.createdBy || ""),
    createdAt: String(input.createdAt || new Date().toISOString()),
    lastFiredAt: String(input.lastFiredAt || ""),
    fireCount: Math.max(0, Number(input.fireCount) || 0),
    failCount: Math.max(0, Number(input.failCount) || 0),
    retryAt: Math.max(0, Number(input.retryAt) || 0),
    lastError: text(input.lastError, 300),
  }
}

function parseClock(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return { hour, minute, clock: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` }
}

export default class AIAlarmStore {
  constructor(file = STORE_FILE) {
    this.file = file
    this.alarms = []
    this.loaded = false
  }

  load() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"))
        const list = Array.isArray(parsed) ? parsed : parsed?.alarms
        if (Array.isArray(list)) {
          const seen = new Set()
          this.alarms = list
            .map(item => normalizeAlarm(item))
            .filter(item => {
              if (!item || seen.has(item.id)) return false
              seen.add(item.id)
              return true
            })
        }
      }
    } catch (error) {
      console.error(`[AIAlarmStore] 读取失败: ${error.message}`)
      this.alarms = []
    }
    this.loaded = true
    if (JSON.stringify(this.alarms) !== JSON.stringify(this._rawList())) this.flush()
    return this
  }

  _rawList() {
    try {
      if (!fs.existsSync(this.file)) return []
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"))
      const list = Array.isArray(parsed) ? parsed : parsed?.alarms
      return Array.isArray(list) ? list : []
    } catch {
      return []
    }
  }

  _ensure() {
    if (!this.loaded) this.load()
  }

  flush() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const temp = `${this.file}.tmp`
      fs.writeFileSync(temp, JSON.stringify({ version: STORE_VERSION, alarms: this.alarms }, null, 2), "utf8")
      fs.renameSync(temp, this.file)
    } catch (error) {
      console.error(`[AIAlarmStore] 保存失败: ${error.message}`)
    }
  }

  save() {
    this.flush()
  }

  get(id) {
    this._ensure()
    return this.alarms.find(item => item.id === String(id || "")) || null
  }

  count() {
    this._ensure()
    return this.alarms.length
  }

  countForScope(scope = {}) {
    this._ensure()
    const target = normalizeScope(scope)
    return this.alarms.filter(item => item.groupId === target.groupId && item.userId === target.userId).length
  }

  listFor(scope = {}) {
    this._ensure()
    const target = normalizeScope(scope)
    return this.alarms
      .filter(item => {
        if (target.groupId) {
          if (item.groupId !== target.groupId) return false
          return !target.botId || item.botId === target.botId
        }
        return item.userId === target.userId && (!target.botId || item.botId === target.botId)
      })
      .sort((a, b) => a.at - b.at)
  }

  upsert(input = {}, options = {}) {
    this._ensure()
    const now = Number(options.now) || Date.now()
    const max = Math.max(0, Math.min(MAX_ALARMS, Number(options.max) || 0))
    const id = String(input.id || "").trim()
    const existing = id ? this.get(id) : null
    const scope = normalizeScope(input)
    if (!scope.groupId && !scope.userId) return { success: false, error: "只能在群聊或私聊里设闹钟" }
    if (scope.groupId && existing && existing.groupId !== scope.groupId) return { success: false, error: "这个闹钟不在当前会话" }
    if (!scope.groupId && existing && existing.userId !== scope.userId) return { success: false, error: "这个闹钟不在当前会话" }
    if (scope.botId && existing && existing.botId && existing.botId !== scope.botId)
      return { success: false, error: "这个闹钟属于另一个账号" }

    const clockInput = String(input.time || "").trim() || existing?.clock || ""
    const clock = parseClock(clockInput)
    if (!clock) return { success: false, error: "时间要写成 HH:MM（24 小时制），例如 04:30" }
    const repeat = input.repeat === undefined ? existing?.repeat || "none" : normalizeRepeat(input.repeat)
    const textValue = text(input.text ?? existing?.text).trim()
    if (!textValue) return { success: false, error: "闹钟内容不能为空" }
    const promiseId = input.promiseId === undefined ? existing?.promiseId || "" : String(input.promiseId || "").trim()

    let at
    const dateValue = String(input.date || "").trim()
    if (dateValue && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
      const target = parseDueTime(`${dateValue} ${clock.clock}`, now, timezone())
      if (!target) return { success: false, error: "日期格式不对，要写成 YYYY-MM-DD" }
      at = target
    } else if (input.time) {
      at = parseDueTime(clock.clock, now, timezone())
    } else {
      at = existing?.at || parseDueTime(clock.clock, now, timezone())
    }
    if (!Number.isFinite(at)) return { success: false, error: "算不出响铃时间" }
    if (repeat === "daily" && at <= now) {
      at = nextDailyEpoch(clock.hour, clock.minute, now, timezone())
    }
    if (at <= now - 60_000) return { success: false, error: "这个时间已经过去了，请换一个时间" }

    if (existing) {
      const index = this.alarms.findIndex(item => item.id === existing.id)
      this.alarms[index] = normalizeAlarm({
        ...existing,
        ...scope,
        text: textValue,
        at,
        repeat,
        clock: clock.clock,
        promiseId,
        retryAt: 0,
        failCount: 0,
        lastError: "",
      })
      this.save()
      return { success: true, alarm: this.alarms[index], updated: true, max }
    }

    if (max <= 0) return { success: false, error: "主人还没有允许设置闹钟" }
    if (this.alarms.length >= max)
      return { success: false, error: `闹钟数量已满（${this.alarms.length}/${max}），先取消一个再设` }

    const duplicate = this.alarms.find(
      item =>
        item.groupId === scope.groupId &&
        item.userId === scope.userId &&
        item.botId === scope.botId &&
        item.at === at &&
        item.text === textValue,
    )
    if (duplicate) return { success: true, alarm: duplicate, updated: false, duplicate: true, max }

    const alarm = normalizeAlarm({
      id: newId(),
      ...scope,
      text: textValue,
      at,
      repeat,
      clock: clock.clock,
      promiseId,
      createdBy: String(input.createdBy || ""),
      createdAt: new Date(now).toISOString(),
      fireCount: 0,
      failCount: 0,
      retryAt: 0,
    })
    this.alarms.push(alarm)
    this.alarms.sort((a, b) => a.at - b.at)
    this.save()
    return { success: true, alarm, updated: false, max }
  }

  remove(id, scope = null) {
    this._ensure()
    const target = this.get(id)
    if (!target) return { success: false, error: "没有这个闹钟" }
    if (scope) {
      const wanted = normalizeScope(scope)
      if (wanted.groupId ? target.groupId !== wanted.groupId : target.userId !== wanted.userId)
        return { success: false, error: "这个闹钟不在当前会话" }
      if (wanted.botId && target.botId && target.botId !== wanted.botId)
        return { success: false, error: "这个闹钟属于另一个账号" }
    }
    this.alarms = this.alarms.filter(item => item.id !== target.id)
    this.save()
    return { success: true, alarm: target }
  }

  due(now = Date.now()) {
    this._ensure()
    return this.alarms
      .filter(item => (item.retryAt ? item.retryAt : item.at) <= now)
      .sort((a, b) => (a.retryAt || a.at) - (b.retryAt || b.at))
  }

  isMissed(alarm, now = Date.now()) {
    if (!alarm) return false

    if (now - alarm.at > 24 * 60 * 60 * 1000) return true
    return !alarm.retryAt && now - alarm.at > MISSED_GRACE_MS
  }

  complete(alarmId, now = Date.now()) {
    this._ensure()
    const alarm = this.get(alarmId)
    if (!alarm) return { success: false, error: "没有这个闹钟" }
    if (alarm.repeat === "daily") {
      const clock = parseClock(alarm.clock) || parseClock(formatInZone(alarm.at).slice(11))
      if (!clock) return { success: false, error: "闹钟钟点无法解析" }
      alarm.at = nextDailyEpoch(clock.hour, clock.minute, now + 60_000, timezone())
      alarm.clock = clock.clock
      alarm.lastFiredAt = new Date(now).toISOString()
      alarm.fireCount += 1
      alarm.retryAt = 0
      alarm.failCount = 0
      alarm.lastError = ""
      this.alarms.sort((a, b) => a.at - b.at)
      this.save()
      return { success: true, alarm, removed: false }
    }
    const removed = { ...alarm }
    this.alarms = this.alarms.filter(item => item.id !== alarm.id)
    this.save()
    return { success: true, alarm: removed, removed: true }
  }

  fail(alarmId, error, now = Date.now()) {
    this._ensure()
    const alarm = this.get(alarmId)
    if (!alarm) return null
    alarm.failCount += 1
    alarm.lastError = text(error, 300)
    const backoff = [60_000, 120_000, 300_000, 600_000, 1_800_000]
    alarm.retryAt = now + (backoff[Math.min(alarm.failCount - 1, backoff.length - 1)] || 1_800_000)
    this.save()
    return alarm
  }

  skip(alarmId, reason = "", now = Date.now()) {
    this._ensure()
    const alarm = this.get(alarmId)
    if (!alarm) return { success: false, error: "没有这个闹钟" }
    if (alarm.repeat === "daily") {
      const clock = parseClock(alarm.clock) || parseClock(formatInZone(alarm.at).slice(11))
      if (clock) alarm.at = nextDailyEpoch(clock.hour, clock.minute, now + 60_000, timezone())
      alarm.retryAt = 0
      alarm.failCount = 0
      alarm.lastError = text(reason, 300)
      this.alarms.sort((a, b) => a.at - b.at)
      this.save()
      return { success: true, alarm, removed: false }
    }
    this.alarms = this.alarms.filter(item => item.id !== alarm.id)
    this.save()
    return { success: true, alarm, removed: true }
  }

  describe(alarm, now = Date.now()) {
    const at = Number(alarm?.at) || 0
    return `${dayLabelInZone(at, now, timezone())} ${formatInZone(at, timezone()).slice(11)}${alarm.repeat === "daily" ? "（每天）" : ""}`
  }

  describeAt(at, repeat = "none", now = Date.now()) {
    return `${dayLabelInZone(at, now, timezone())} ${formatInZone(at, timezone()).slice(11)}${repeat === "daily" ? "（每天）" : ""}`
  }

  exportAll() {
    this._ensure()
    return this.alarms.map(item => ({ ...item }))
  }
}

export { STORE_FILE, STORE_VERSION, MAX_ALARMS, MISSED_GRACE_MS }
