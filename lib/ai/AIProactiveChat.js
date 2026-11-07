const DEFAULT_CONFIG = {
  enabled: false,
  pollIntervalSeconds: 300,
  baseProbability: 0.05,
  maxProbability: 0.5,
  minMessagesBeforeTrigger: 10,
  quietHoursStart: 0,
  quietHoursEnd: 6,
  cooldownSeconds: 5400,
  maxPerDay: 6,
  minIdleSeconds: 1200,
  maxPerHour: 20,
}

let segmenter = null
try {
  segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" })
} catch {}

function promiseWords(value) {
  const raw = String(value || "")
  const out = new Set()
  if (segmenter) {
    for (const item of segmenter.segment(raw)) {
      if (!item.isWordLike) continue
      const word = item.segment.trim()
      if (word.length >= 2) out.add(word)
    }
  }
  for (const word of raw.toLowerCase().match(/[a-z0-9]{3,}/g) || []) out.add(word)
  return [...out]
}

export default class AIProactiveChat {
  constructor(deps = {}) {
    this.getConfig = deps.getConfig || (() => DEFAULT_CONFIG)
    this.getGroups = deps.getGroups || (() => [])
    this.getGroupConfig = deps.getGroupConfig || (() => null)
    this.chat = deps.chat || (async () => null)
    this.send = deps.send || (async () => false)
    this.getPreset = deps.getPreset || (() => null)
    this.isAiEnabled = deps.isAiEnabled || (() => true)
    this.getHistory = deps.getHistory || (async () => [])
    this.getSelfId = deps.getSelfId || (() => "")

    this.getPromises = deps.getPromises || (() => [])
    this.settlePromise = deps.settlePromise || (() => {})
    this.log = deps.log || (() => {})

    this.stats = new Map()
    this.timer = null
    this.intervalSeconds = 0
    this.running = false
  }

  _state(key) {
    if (!this.stats.has(key)) {
      this.stats.set(key, {
        messages: 0,
        messagesSinceLast: 0,
        lastMessageAt: 0,
        lastSpeakAt: 0,
        todayCount: 0,
        dayKey: "",
        hourHits: [],
      })
    }
    return this.stats.get(key)
  }

  static stateKey(groupId, botId = "") {
    return botId ? `${botId}:${groupId}` : String(groupId)
  }

  static dayKey(now = Date.now()) {
    const date = new Date(now)
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
  }

  recordMessage(groupId, at = Date.now(), botIds = []) {
    if (!groupId) return
    const ids = (Array.isArray(botIds) ? botIds : [botIds]).map(String).filter(Boolean)
    for (const key of ids.length ? ids.map(id => AIProactiveChat.stateKey(groupId, id)) : [String(groupId)]) {
      const state = this._state(key)
      state.messages += 1
      state.messagesSinceLast += 1
      state.lastMessageAt = at
    }
  }

  static inQuietHours(now, start, end) {
    const hour = new Date(now).getHours()
    const from = Number(start)
    const to = Number(end)
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return false
    if (from < to) return hour >= from && hour < to
    return hour >= from || hour < to
  }

  static probabilityFor(state, config, now) {
    const base = Math.max(0, Math.min(1, Number(config.baseProbability) || 0))
    const maxRaw = Number(config.maxProbability)
    const max = Math.max(base, Math.min(1, Number.isFinite(maxRaw) ? maxRaw : base))
    if (!state.lastMessageAt) return 0
    const idleSeconds = (now - state.lastMessageAt) / 1000
    const minIdleRaw = Number(config.minIdleSeconds)
    const minIdle = Math.max(0, Number.isFinite(minIdleRaw) ? minIdleRaw : 1200)
    if (idleSeconds < minIdle) return 0

    const ramp = Math.min(1, (idleSeconds - minIdle) / Math.max(1, minIdle))
    return base + (max - base) * ramp
  }

  shouldSpeak(groupId, now = Date.now(), botId = "") {
    if (!this.isAiEnabled()) return { ok: false, reason: "AI 已关闭" }
    const config = { ...DEFAULT_CONFIG, ...(this.getConfig() || {}) }

    const groupCfg = this.getGroupConfig(String(groupId))
    if (groupCfg?.enabled === false) return { ok: false, reason: "本群已关闭" }

    if (groupCfg?.proactiveChat === false) return { ok: false, reason: "本群关闭了主动聊天" }
    if (groupCfg?.proactiveChat !== true && config.enabled !== true)
      return { ok: false, reason: "未开启主动聊天" }

    if (botId && (groupCfg?.disabledBots || []).some(id => String(id) === String(botId)))
      return { ok: false, reason: "本群禁用了该账号" }

    const state = this._state(AIProactiveChat.stateKey(groupId, botId))
    const dayKey = AIProactiveChat.dayKey(now)
    if (state.dayKey !== dayKey) {
      state.dayKey = dayKey
      state.todayCount = 0
    }

    if (AIProactiveChat.inQuietHours(now, config.quietHoursStart, config.quietHoursEnd))
      return { ok: false, reason: "静默时段" }

    if (state.lastSpeakAt && now - state.lastSpeakAt < Math.max(0, Number(config.cooldownSeconds) || 0) * 1000)
      return { ok: false, reason: "冷却中" }

    if (state.messagesSinceLast < Math.max(0, Number(config.minMessagesBeforeTrigger) || 0))
      return { ok: false, reason: `消息太少（${state.messagesSinceLast}）` }

    if (state.todayCount >= Math.max(0, Number(config.maxPerDay) || 0))
      return { ok: false, reason: "今日已达上限" }

    const maxPerHour = Math.max(0, Number(config.maxPerHour) || 0)
    state.hourHits = (state.hourHits || []).filter(at => now - at < 3600000)
    if (maxPerHour > 0 && state.hourHits.length >= maxPerHour)
      return { ok: false, reason: `本小时已达上限（${state.hourHits.length}）` }

    const probability = AIProactiveChat.probabilityFor(state, config, now)
    if (probability <= 0) return { ok: false, reason: "还没到该开口的时候" }
    const roll = Math.random()
    if (roll > probability) return { ok: false, reason: `概率未命中（${roll.toFixed(2)} > ${probability.toFixed(2)}）` }
    return { ok: true, probability }
  }

  markSpoke(groupId, at = Date.now(), botId = "") {
    const state = this._state(AIProactiveChat.stateKey(groupId, botId))
    state.lastSpeakAt = at
    state.todayCount += 1
    state.messagesSinceLast = 0
    ;(state.hourHits || []).push(at)
    return state
  }

  async tick(now = Date.now()) {
    const results = []
    for (const group of this.getGroups()) {
      const groupId = String(group.group_id || group.id || "")
      if (!groupId) continue

      const botIds = Array.isArray(group.botIds) && group.botIds.length ? group.botIds : [""]
      for (const botId of botIds) {
        const verdict = this.shouldSpeak(groupId, now, botId)
        results.push({ groupId, botId, ...verdict })
        if (!verdict.ok) continue
        try {
          const history = await this._recentHistory(groupId)
          if (AIProactiveChat.mentionsOthers(history, botId || this.getSelfId?.())) {
            results[results.length - 1] = { groupId, botId, ok: false, reason: "最近消息在@别人" }
            continue
          }
          if (!history.length) {
            results[results.length - 1] = { groupId, botId, ok: false, reason: "没有可参考的聊天记录" }
            continue
          }
          let promises = []
          try {
            promises = (await this.getPromises(groupId, botId)) || []
          } catch {}
          const prompt = AIProactiveChat.buildPrompt(this.getPreset(groupId, botId), history, botId, promises)
          const content = await this.chat(groupId, prompt, botId)
          if (!content) continue

          if (AIProactiveChat.isDecline(content)) {
            results[results.length - 1] = { groupId, botId, ok: false, reason: "模型判断不适合插话" }
            continue
          }

          if (!this.isAiEnabled()) continue
          const sent = await this.send(groupId, content, botId)
          if (sent) {
            this.markSpoke(groupId, now, botId)
            this.log(`主动聊天 [${botId || "-"}@${groupId}]：${String(content).slice(0, 60)}`)

            for (const item of promises) {
              if (!item.id || !AIProactiveChat.looksSettled(content, item.text)) continue
              try {
                await this.settlePromise(item.id, `主动回复已兑现：${String(content).slice(0, 120)}`)
                this.log(`承诺已结清 [${item.id}]：${String(item.text).slice(0, 40)}`)
              } catch {}
            }
          }
        } catch (error) {
          this.log(`主动聊天失败 [${botId || "-"}@${groupId}]：${error.message}`)
        }
      }
    }
    return results
  }

  async _recentHistory(groupId) {
    try {
      const list = await this.getHistory(groupId)
      return Array.isArray(list) ? list.filter(item => item && item.text) : []
    } catch (error) {
      this.log(`读取群历史失败 [${groupId}]：${error.message}`)
      return []
    }
  }

  static looksSettled(content, promiseText = "") {
    const reply = String(content || "").trim()
    if (!reply) return false

    const deferring = /(欠着|记着|还差|改天|回头|下次再|等.{0,4}(再说|再讲))/.test(reply)
    const finished = /(讲完|说完|做完|结了|结清|兑现)/.test(reply)
    if (deferring && !finished) return false
    if (finished) return true

    return /(从前|有一[个天夜]|故事[:：]|讲个|讲一个|讲了个|说了个|说起|讲到|那晚|那天)/.test(reply)
  }

  static isDecline(content) {
    const text = String(content || "").trim()
    return !text || /^不插话[。.!！]?$/.test(text) || /^（?不插话）?[。.!！]?$/.test(text)
  }

  static mentionsOthers(history, selfId = "") {
    return (history || []).some(item => {
      const targets = Array.isArray(item?.at) ? item.at.map(String) : []
      if (!targets.length) return false
      return targets.some(qq => qq && qq !== "all" && String(qq) !== String(selfId))
    })
  }

  static buildPrompt(preset, history = [], selfId = "", promises = []) {
    const name = preset?.roleName || preset?.name || "你"
    const lines = (history || [])
      .slice(-10)
      .map(item => {
        const who = String(item.userId || "") === String(selfId) ? `${item.name || "你"}（你自己）` : item.name || "群友"
        return `${who}: ${String(item.text || "").slice(0, 120)}`
      })
      .join("\n")
    const owed = (promises || [])
      .slice(0, 3)
      .map(item => `- ${String(item.text || "").slice(0, 100)}${item.due ? `（说好 ${item.due}）` : ""}${item.id ? `（记忆 ${item.id}）` : ""}`)
      .join("\n")
    return (
      `[系统] 群里已经安静一会儿了。你是${name}，现在是聊天的主人，主动起个话头。\n` +
      (lines ? `最近聊天记录：\n${lines}\n` : "") +
      (owed ? `你还欠着这些事没做：\n${owed}\n` : "") +
      "要求：先看上面的聊天记录判断现在插话合不合适；" +
      (owed
        ? "如果欠着的事现在适合做，就直接把它做完再开口——比如该讲的故事就讲完整，不要只说「记着」「欠着」；" +
          "不适合现在做就说清什么时候做。"
        : "") +
      "如果大家在 @ 某个人说事、或话题不适合外人接，就只回复「不插话」四个字；" +
      "合适时一两句话，像平时在群里那样随意，可以聊刚才的话题延续，也可以吐槽、提问、分享琐事；" +
      "群里可能还有别的机器人账号在说话，那是别人不是你，别把对方的话当成自己说的；" +
      "不要提这条是定时触发的，也不要问「有人在吗」。"
    )
  }

  start(intervalSeconds) {
    const seconds = Math.max(5, Number(intervalSeconds) || DEFAULT_CONFIG.pollIntervalSeconds)
    if (this.timer && this.intervalSeconds === seconds) return this
    this.stop()
    this.intervalSeconds = seconds
    this.timer = setInterval(() => {
      if (this.running) return
      this.running = true
      this.tick()
        .catch(() => {})
        .finally(() => {
          this.running = false
        })
    }, seconds * 1000)
    this.timer.unref?.()
    return this
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    return this
  }
}

export { DEFAULT_CONFIG }
