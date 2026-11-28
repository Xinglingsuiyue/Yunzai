const DEFAULT_CONFIG = {
  enabled: false,
  heartbeatSeconds: 60,
  fireThreshold: 30,
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

    this.onSpoke = deps.onSpoke || (() => {})
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
        humanMessages: 0,
        humanMessagesSinceLast: 0,
        lastMessageAt: 0,

        lastHumanUserId: "",
        lastSpeakAt: 0,
        lastFireAt: 0,
        potential: 0,
        lastBeatAt: 0,
        todayCount: 0,
        dayKey: "",
        hourHits: [],
      })
    }
    return this.stats.get(key)
  }

  _config() {
    return { ...DEFAULT_CONFIG, ...(this.getConfig() || {}) }
  }

  _heartbeatMs(config) {
    const seconds = Number(config.heartbeatSeconds)
    return Math.max(5, Number.isFinite(seconds) ? seconds : DEFAULT_CONFIG.heartbeatSeconds) * 1000
  }

  _threshold(config) {
    const value = Number(config.fireThreshold)
    return Math.max(1, Number.isFinite(value) ? value : DEFAULT_CONFIG.fireThreshold)
  }

  static normalizeGroupId(id) {
    return String(id ?? "").replace(/[\uF03A\uFF1A]/g, ":")
  }

  static stateKey(groupId, botId = "") {
    const group = AIProactiveChat.normalizeGroupId(groupId)
    return botId ? `${botId}:${group}` : group
  }

  static dayKey(now = Date.now()) {
    const date = new Date(now)
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
  }

  recordMessage(groupId, at = Date.now(), botIds = [], options = {}) {
    if (!groupId) return
    const group = AIProactiveChat.normalizeGroupId(groupId)
    const human = options.human !== false
    const ids = (Array.isArray(botIds) ? botIds : [botIds]).map(String).filter(Boolean)
    for (const key of ids.length ? ids.map(id => AIProactiveChat.stateKey(group, id)) : [group]) {
      const state = this._state(key)
      state.messages += 1
      if (human) {
        state.humanMessages += 1
        state.humanMessagesSinceLast += 1
        if (options.userId) state.lastHumanUserId = String(options.userId)
      }
      state.lastMessageAt = at
    }
  }

  markReplied(groupId, at = Date.now(), botId = "") {
    const state = this._state(AIProactiveChat.stateKey(groupId, botId))
    state.potential = 0
    state.lastBeatAt = at
    return state
  }

  static inQuietHours(now, start, end) {
    const hour = new Date(now).getHours()
    const from = Number(start)
    const to = Number(end)
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return false
    if (from < to) return hour >= from && hour < to
    return hour >= from || hour < to
  }

  _rollDay(state, now) {
    const dayKey = AIProactiveChat.dayKey(now)
    if (state.dayKey !== dayKey) {
      state.dayKey = dayKey
      state.todayCount = 0
    }
  }

  _baseGate(groupId, botId, config, now) {
    if (!this.isAiEnabled()) return { ok: false, reason: "AI 已关闭" }
    const groupCfg = this.getGroupConfig(groupId)
    if (groupCfg?.enabled === false) return { ok: false, reason: "本群已关闭" }
    if (groupCfg?.proactiveChat === false) return { ok: false, reason: "本群关闭了主动聊天" }
    if (groupCfg?.proactiveChat !== true && config.enabled !== true)
      return { ok: false, reason: "未开启主动聊天" }
    if (botId && (groupCfg?.disabledBots || []).some(id => String(id) === String(botId)))
      return { ok: false, reason: "本群禁用了该账号" }
    if (AIProactiveChat.inQuietHours(now, config.quietHoursStart, config.quietHoursEnd))
      return { ok: false, reason: "静默时段" }
    return { ok: true }
  }

  _charge(state, config, now) {
    const heartbeatMs = this._heartbeatMs(config)
    const last = Number(state.lastBeatAt) || 0
    const beats = last
      ? Math.max(1, Math.min(10, Math.round((now - last) / heartbeatMs)))
      : 1
    state.lastBeatAt = now
    state.potential = Math.min(
      this._threshold(config),
      (Number(state.potential) || 0) + beats,
    )
    return beats
  }

  shouldFire(groupId, now = Date.now(), botId = "", context = {}) {
    const group = AIProactiveChat.normalizeGroupId(groupId)
    const config = context.config || this._config()
    const base = this._baseGate(group, botId, config, now)
    if (!base.ok) return base

    const state = context.state || this._state(AIProactiveChat.stateKey(group, botId))
    this._rollDay(state, now)

    const cooldownMs =
      Math.max(0, Number(config.cooldownSeconds) || 0) * 1000
    const lastSpoke = Math.max(Number(state.lastSpeakAt) || 0, Number(state.lastFireAt) || 0)
    if (lastSpoke && now - lastSpoke < cooldownMs)
      return { ok: false, reason: "冷却中", potential: state.potential }

    if (!state.lastMessageAt) return { ok: false, reason: "群里还没有消息" }
    const idleSeconds = (now - state.lastMessageAt) / 1000
    const minIdleRaw = Number(config.minIdleSeconds)
    const minIdle = Math.max(0, Number.isFinite(minIdleRaw) ? minIdleRaw : 1200)
    if (idleSeconds < minIdle)
      return { ok: false, reason: `还没安静够（${Math.floor(idleSeconds)} 秒）`, potential: state.potential }

    if (!state.humanMessages) return { ok: false, reason: "还没有人说过话" }
    if (state.humanMessagesSinceLast < Math.max(0, Number(config.minMessagesBeforeTrigger) || 0))
      return {
        ok: false,
        reason: `消息太少（${state.humanMessagesSinceLast}）`,
        potential: state.potential,
      }

    if (state.todayCount >= Math.max(0, Number(config.maxPerDay) || 0))
      return { ok: false, reason: "今日已达上限", potential: state.potential }

    const maxPerHour = Math.max(0, Number(config.maxPerHour) || 0)
    state.hourHits = (state.hourHits || []).filter(at => now - at < 3600000)
    if (maxPerHour > 0 && state.hourHits.length >= maxPerHour)
      return {
        ok: false,
        reason: `本小时已达上限（${state.hourHits.length}）`,
        potential: state.potential,
      }

    const threshold = this._threshold(config)
    if (state.potential < threshold)
      return {
        ok: false,
        reason: `电位不足（${state.potential}/${threshold}）`,
        potential: state.potential,
        threshold,
      }
    return { ok: true, potential: state.potential, threshold }
  }

  markSpoke(groupId, at = Date.now(), botId = "") {
    const state = this._state(AIProactiveChat.stateKey(groupId, botId))
    this._rollDay(state, at)
    state.lastSpeakAt = at
    state.lastFireAt = at
    state.todayCount += 1
    state.humanMessagesSinceLast = 0
    state.potential = 0
    ;(state.hourHits || []).push(at)
    return state
  }

  async tick(now = Date.now()) {
    const results = []
    const config = this._config()
    for (const group of this.getGroups()) {
      const groupId = AIProactiveChat.normalizeGroupId(group.group_id || group.id || "")
      if (!groupId) continue
      const botIds = Array.isArray(group.botIds) && group.botIds.length ? group.botIds : [""]
      for (const botId of botIds) {
        const state = this._state(AIProactiveChat.stateKey(groupId, botId))
        const base = this._baseGate(groupId, botId, config, now)
        if (!base.ok) {
          state.potential = 0
          state.lastBeatAt = now
          results.push({ groupId, botId, ...base, potential: 0 })
          continue
        }

        this._rollDay(state, now)
        const beats = this._charge(state, config, now)
        const verdict = this.shouldFire(groupId, now, botId, { config, state })
        results.push({ groupId, botId, beats, ...verdict })
        if (!verdict.ok) continue

        try {
          let promises = []
          try {
            promises = (await this.getPromises(groupId, botId)) || []
          } catch {}

          const history = await this._recentHistory(groupId, botId)
          if (!history.length && !promises.length) {
            state.potential = 0
            results[results.length - 1] = {
              groupId,
              botId,
              ok: false,
              reason: "没有可参考的聊天记录",
            }
            continue
          }

          const selfId = String(botId || this.getSelfId?.() || "")
          if (AIProactiveChat.mentionsOthers(history, selfId)) {
            state.potential = 0
            results[results.length - 1] = {
              groupId,
              botId,
              ok: false,
              reason: "最近消息在@别人",
            }
            continue
          }
          const prompt = AIProactiveChat.buildPrompt(
            this.getPreset(groupId, botId),
            history,
            selfId,
            promises,
            { idleSeconds: Math.max(0, (now - state.lastMessageAt) / 1000) },
          )

          state.lastFireAt = now
          state.potential = 0
          const content = await this.chat(groupId, prompt, botId)
          if (!content) {
            results[results.length - 1] = {
              groupId,
              botId,
              ok: false,
              reason: "模型没有返回内容",
            }
            continue
          }

          if (AIProactiveChat.isDecline(content)) {
            results[results.length - 1] = {
              groupId,
              botId,
              ok: false,
              reason: "模型判断不适合插话",
            }
            continue
          }

          if (!this.isAiEnabled()) {
            results[results.length - 1] = {
              groupId,
              botId,
              ok: false,
              reason: "AI 已关闭",
            }
            continue
          }
          const sent = await this.send(groupId, content, botId)
          if (!sent) {
            results[results.length - 1] = {
              groupId,
              botId,
              ok: false,
              reason: "发送失败",
            }
            continue
          }
          this.markSpoke(groupId, now, botId)
          this.log(`心跳放电 [${botId || "-"}@${groupId}]：${String(content).slice(0, 60)}`)
          try {
            this.onSpoke(groupId, content, botId)
          } catch {}

          for (const item of promises) {
            if (!item.id || !AIProactiveChat.looksSettled(content, item.text)) continue
            try {
              await this.settlePromise(item.id, `主动回复已兑现：${String(content).slice(0, 120)}`)
              this.log(`承诺已结清 [${item.id}]：${String(item.text).slice(0, 40)}`)
            } catch {}
          }
          results[results.length - 1] = {
            groupId,
            botId,
            ok: true,
            potential: 0,
            content: String(content),
          }
        } catch (error) {
          this.log(`主动聊天失败 [${botId || "-"}@${groupId}]：${error.message}`)
          results[results.length - 1] = {
            groupId,
            botId,
            ok: false,
            reason: error.message,
          }
        }
      }
    }
    return results
  }

  async _recentHistory(groupId, botId = "") {
    const group = AIProactiveChat.normalizeGroupId(groupId)
    try {
      const list = await this.getHistory(group, botId)
      return Array.isArray(list) ? list.filter(item => item && item.text) : []
    } catch (error) {
      this.log(`读取群历史失败 [${group}]：${error.message}`)
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
    const core = text
      .replace(/^["“”'‘’]+|["“”'‘’]+$/g, "")
      .replace(/^[（(【[]+|[）)】\]]+$/g, "")
      .replace(/[。.!！\s]+$/g, "")
      .trim()
    return !core || /^(不插话|不开口|不说话|跳过|pass)$/i.test(core)
  }

  static mentionsOthers(history, selfId = "") {
    const latest = [...(history || [])].reverse().find(item => item?.text)
    if (!latest) return false
    const targets = Array.isArray(latest.at) ? latest.at.map(String) : []
    return targets.some(qq => qq && qq !== "all" && String(qq) !== String(selfId))
  }

  static buildPrompt(preset, history = [], selfId = "", promises = [], context = {}) {
    const name = preset?.roleName || preset?.name || "你"
    const lines = (history || [])
      .slice(-20)
      .map(item => {
        const who = String(item.userId || "") === String(selfId) ? `${item.name || "你"}（你自己）` : item.name || "群友"
        return `${who}: ${String(item.text || "").slice(0, 120)}`
      })
      .join("\n")
    const owed = (promises || [])
      .slice(0, 3)
      .map(item => `- ${String(item.text || "").slice(0, 100)}${item.due ? `（说好 ${item.due}）` : ""}${item.id ? `（记忆 ${item.id}）` : ""}`)
      .join("\n")
    const idleMinutes = Math.max(0, Math.round((Number(context.idleSeconds) || 0) / 60))
    const scene = idleMinutes >= 5 ? `群里最近安静了 ${idleMinutes} 分钟。` : "群里正在聊。"
    return (
      `[系统] ${scene}你是${name}，一直在听着。现在没人叫你，你自己决定要不要接一句。\n` +
      (lines ? `最近聊天记录：\n${lines}\n` : "") +
      (owed ? `你还欠着这些事没做：\n${owed}\n` : "") +
      "有自然想接的话就顺着最近的话题按平时的语气说一句，别写成长文；" +
      (owed
        ? "如果欠着的事现在适合做，就直接把它做完再开口——比如该讲的故事就讲完整，不要只说「记着」「欠着」；" +
          "不适合现在做就说清什么时候做。"
        : "") +
      "没有想说的就只回复「不插话」四个字。" +
      "不要为了开口硬找话，不要问「有人在吗」，不要提这条是定时或心跳触发的；" +
      "群里可能还有别的机器人账号在说话，那是别人不是你，别把对方的话当成自己说的。"
    )
  }

  start(intervalSeconds) {
    const seconds = Math.max(5, Number(intervalSeconds) || DEFAULT_CONFIG.heartbeatSeconds)
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
