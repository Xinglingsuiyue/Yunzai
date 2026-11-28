const DEFAULT_INTERVAL_SECONDS = 15
const MAX_FIRES_PER_TICK = 3

function isDecline(content) {
  const core = String(content || "").trim().replace(/[。.!！\s]+$/g, "")
  return !core || /^(不插话|不开口|跳过|pass)$/i.test(core)
}

export default class AIAlarmScheduler {
  constructor(deps = {}) {
    this.store = deps.store
    this.getMaxAlarms = deps.getMaxAlarms || (() => 0)
    this.isAiEnabled = deps.isAiEnabled || (() => true)
    this.checkScope = deps.checkScope || (() => ({ ok: true }))
    this.chat = deps.chat || (async () => "")
    this.send = deps.send || (async () => false)
    this.settlePromise = deps.settlePromise || (async () => {})
    this.onChanged = deps.onChanged || (() => {})
    this.log = deps.log || (() => {})
    this.timer = null
    this.intervalSeconds = 0
    this.running = false
    this.claiming = new Set()
  }

  start(intervalSeconds = DEFAULT_INTERVAL_SECONDS) {
    const seconds = Math.max(5, Number(intervalSeconds) || DEFAULT_INTERVAL_SECONDS)
    if (this.timer && this.intervalSeconds === seconds) return this
    this.stop()
    this.intervalSeconds = seconds
    this.timer = setInterval(() => {
      this.tick().catch(() => {})
    }, seconds * 1000)
    this.timer.unref?.()
    return this
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    return this
  }

  get stats() {
    return {
      running: !!this.timer,
      intervalSeconds: this.intervalSeconds,
      alarms: this.store?.count?.() || 0,
    }
  }

  async tick(now = Date.now()) {
    if (!this.store || this.running) return []
    if (!this.isAiEnabled()) return []
    if (Number(this.getMaxAlarms()) <= 0) return []
    this.running = true
    const results = []
    try {
      const due = this.store.due(now).slice(0, MAX_FIRES_PER_TICK)
      for (const alarm of due) {
        if (this.claiming.has(alarm.id)) continue
        const current = this.store.get(alarm.id)
        if (!current) continue
        if (this.store.isMissed(current, now)) {
          const reason = `已过原定时间 ${Math.round((now - current.at) / 60000)} 分钟`
          const skipped = this.store.skip(current.id, reason, now)
          this.log(`闹钟错过 [${this._label(current)}]：${reason}${skipped.removed ? "，已删除" : "，顺延到下一次"}`)
          results.push({ id: current.id, ok: false, missed: true, reason })
          continue
        }
        const gate = this.checkScope(current) || { ok: true }
        if (!gate.ok) {
          const skipped = this.store.skip(current.id, gate.reason || "当前会话不可唤醒", now)
          this.log(`闹钟跳过 [${this._label(current)}]：${gate.reason || "当前会话不可唤醒"}${skipped.removed ? "，已删除" : "，顺延到下一次"}`)
          results.push({ id: current.id, ok: false, blocked: true, reason: gate.reason })
          continue
        }
        this.claiming.add(current.id)
        try {
          const item = await this._fire(current, now)
          results.push(item)
        } finally {
          this.claiming.delete(current.id)
        }
      }
    } finally {
      this.running = false
    }
    return results
  }

  _label(alarm) {
    const scope = alarm.groupId ? `群 ${alarm.groupId}` : `私聊 ${alarm.userId}`
    return `${alarm.botId || "-"}@${scope} ${this.store.describe(alarm)}`
  }

  _prompt(alarm) {
    const when = this.store.describe(alarm)
    const repeat =
      alarm.repeat === "daily"
        ? "这是每天重复的闹钟，响过之后会留到下一次。"
        : "这是一次性闹钟，响过就结束。"
    return (
      `[系统] 你之前定下的闹钟到点了：${alarm.text}\n` +
      `原定时间：${when}。${repeat}\n` +
      "现在轮到你真的去做这件事：按你平时的语气直接发出该说的话。" +
      "不要回复「不插话」，不要向任何人解释这是闹钟、系统或定时任务；" +
      "哪怕现在气氛不合适，也要把到点该说的那句话说出来，不要只说「记着」「等会儿」。\n" +
      (alarm.promiseId
        ? "这件事对应的承诺兑现后，用 memory_settle 结清。"
        : "") +
      "如果你想把下一次改到别的时间，用 alarm_set 传这个闹钟的 id 修改。"
    )
  }

  async _fire(alarm, now) {
    try {
      const content = await this.chat(alarm, this._prompt(alarm))
      if (!content || isDecline(content)) throw new Error("模型没有开口")
      const sent = await this.send(alarm, content)
      if (!sent) throw new Error("消息发送失败")
      const completed = this.store.complete(alarm.id, now)
      if (alarm.promiseId && alarm.repeat !== "daily") {
        try {
          await this.settlePromise(alarm.promiseId, `闹钟到点已发出：${String(content).slice(0, 120)}`)
        } catch {}
      }
      this.log(`自我闹钟响铃 [${this._label(alarm)}]：${String(content).slice(0, 80)}`)
      try {
        this.onChanged()
      } catch {}
      return { id: alarm.id, ok: true, content: String(content), removed: completed.removed }
    } catch (error) {
      this.store.fail(alarm.id, error.message, now)
      this.log(`自我闹钟失败 [${this._label(alarm)}]：${error.message}`)
      return { id: alarm.id, ok: false, reason: error.message }
    }
  }
}
