import AIClient from "./AIClient.js"
import cfg from "../config/config.js"

export default class AIContext {
  constructor(opts = {}) {
    this.systemPrompt = opts.systemPrompt || ""
    this.runtimeRules = opts.runtimeRules || ""
    this.messages = []
    this.tokenSpent = 0
    this.turnLimit = 0
    this.turnWindowMinutes = 180
    this.turnUsed = 0
    this.turnWindowStart = 0
    this.extraTokenBudget = 0
    this.extraTokenSpent = 0
    this._toolTokenOverhead = 0
    this.presetId = String(opts.presetId || "")
    this.presetName = String(opts.presetName || "")

    this._compressed = false
    this._compressedSummary = ""
    this._compressedTurnCount = 0
    this.tokenizer = new AIClient()
    this.applyRuntimeConfig(opts)

    this._lastActivity = 0
  }

  applyRuntimeConfig(opts = {}) {
    const pick = (value, fallback, min, max) => {
      if (value === undefined || value === null || value === "") return fallback
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) return fallback
      return Math.min(max, Math.max(min, parsed))
    }
    this.maxContextTokens = Math.floor(
      pick(opts.maxContextTokens ?? cfg.ai?.maxContextTokens, 32000, 1000, 2000000),
    )
    this.maxHistoryTurns = Math.floor(pick(opts.maxHistoryTurns ?? cfg.ai?.maxHistoryTurns, 20, 0, 200))
    this._compressionThreshold = Math.floor(pick(cfg.ai?.compressionThreshold, 16000, 0, 1000000000))
    this._compressionKeepRecent = Math.floor(pick(cfg.ai?.compressionKeepRecentTurns, 6, 1, 100))
    this._compressionMaxLength = Math.floor(
      pick(cfg.ai?.compressionSummaryMaxLength, 800, 200, 20000),
    )
    this._compressionEnabled = cfg.ai?.enableCompression !== false
    this._trimContext()
    return this
  }

  get lastActivity() {
    return this._lastActivity
  }
  set lastActivity(v) {
    this._lastActivity = v
  }

  setSystemPrompt(prompt) {
    this.systemPrompt = prompt
    return this
  }

  setRuntimeRules(rules) {
    this.runtimeRules = String(rules || "")
    return this
  }

  appendSystemPrompt(prompt) {
    this.systemPrompt = (this.systemPrompt ? this.systemPrompt + "\n" : "") + prompt
    return this
  }

  addUserMessage(content, extra = {}) {
    this._stripImageParts()
    this.messages.push({
      role: "user",
      content,
      time: Date.now(),
      ...extra,
    })
    this._lastActivity = Date.now()
    this._trimContext()
    return this
  }

  addAssistantMessage(content, extra = {}) {
    this.messages.push({
      role: "assistant",
      content,
      time: Date.now(),
      ...(this.presetId ? { presetId: this.presetId, presetName: this.presetName } : {}),
      ...extra,
    })
    this._lastActivity = Date.now()
    this._stripImageParts()
    this._trimContext()
    return this
  }

  addSystemMessage(content) {
    this.messages.push({
      role: "system",
      content,
      time: Date.now(),
    })
    return this
  }

  getMessages() {
    const msgs = []
    const latestUser = this.messages.reduce((last, m, i) => (m.role === "user" ? i : last), -1)
    const normalized = this.messages.map((m, i) => ({
      role: m.role,
      content: i === latestUser ? m.content : this._textOnlyContent(m.content),
    }))

    if (this.systemPrompt) {
      msgs.push({ role: "system", content: this.systemPrompt })
    }

    if (this.runtimeRules) {
      msgs.push({ role: "system", content: this.runtimeRules })
    }

    if (this._compressed && this._compressedSummary) {
      msgs.push({
        role: "system",
        content: `[对话历史摘要 — 以下是你与用户之前对话的关键信息，请基于这些信息继续对话]\n${this._compressedSummary}`,
      })
    }

    let injectedAt = -1
    for (let i = 0; i < this.messages.length; i++) {
      const m = this.messages[i]
      if (m.role !== "assistant") continue
      const speaker = String(m.presetId || "")
      if (!speaker || speaker === this.presetId) continue
      if (injectedAt < 0) injectedAt = i
    }
    if (injectedAt >= 0) {
      const foreignName = String(this.messages[injectedAt]?.presetName || "另一个人格")
      const head = normalized.slice(0, injectedAt)
      const tail = normalized.slice(injectedAt)
      for (const m of head) msgs.push({ role: m.role, content: m.content })
      msgs.push({
        role: "system",
        content: `[人格切换] 下面有一段是「${foreignName}」在岗时说的话。那是同一个身体里的另一个人格，不是你亲口说的：你知道那些事，但不要当成自己的经历，回复里也不要加任何出处标注。你现在是「${this.presetName || this.presetId}」。`,
      })
      for (const m of tail) msgs.push({ role: m.role, content: m.content })
      return msgs
    }
    for (const m of normalized) {
      msgs.push({ role: m.role, content: m.content })
    }

    return msgs
  }

  _isForeignMessage(m) {
    if (m?.role !== "assistant") return false
    const speaker = String(m.presetId || "")
    if (!speaker || !this.presetId) return false
    return speaker !== this.presetId
  }

  get contentTokenCount() {
    let count = this.tokenizer.estimateTokens(this.systemPrompt)
    if (this._compressedSummary) count += this.tokenizer.estimateTokens(this._compressedSummary)
    for (const m of this.messages) count += this.tokenizer.estimateTokens(this._plainText(m.content))
    return count
  }

  _plainText(content) {
    if (typeof content === "string") return content
    if (!Array.isArray(content)) return ""
    let text = ""
    let images = 0
    for (const part of content) {
      if (part?.type === "text") text += part.text || ""
      else if (part?.type === "image_url") images++
    }
    return text + (images ? `[图片]${"x".repeat(images * 200)}` : "")
  }

  _textOnlyContent(content) {
    if (typeof content === "string" || !Array.isArray(content)) return content
    const texts = []
    let images = 0
    for (const part of content) {
      if (part?.type === "text") texts.push(part.text || "")
      else if (part?.type === "image_url") images++
    }
    const text = texts.join("")
    if (!images) return text
    return `${text}${text ? "\n" : ""}[图片×${images}]`
  }

  _stripImageParts() {
    for (const m of this.messages) m.content = this._textOnlyContent(m.content)
  }

  get tokenCount() {
    return this.contentTokenCount + (Number(this._toolTokenOverhead) || 0)
  }

  setToolTokenOverhead(tokens) {
    this._toolTokenOverhead = Math.max(0, Number(tokens) || 0)
    this._trimContext()
    return this
  }

  get compressionThreshold() {
    const limit = Math.max(1000, Math.floor(this.maxContextTokens * 0.9))
    return Math.min(this._compressionThreshold, limit)
  }

  needsCompression() {
    if (!this._compressionEnabled) return false

    const turnCount = this.userMessages.length
    if (turnCount <= this._compressionKeepRecent) return false

    let content = this.tokenizer.estimateTokens(this.systemPrompt)
    for (const m of this.messages) content += this.tokenizer.estimateTokens(this._plainText(m.content))
    return content > this.compressionThreshold
  }

  async compress(aiClient) {
    if (!this._compressionEnabled) return false

    const turnCount = this.userMessages.length
    if (turnCount <= this._compressionKeepRecent) return false

    const userIndices = []
    for (let i = 0; i < this.messages.length; i++) {
      if (this.messages[i].role === "user") userIndices.push(i)
    }

    if (userIndices.length <= this._compressionKeepRecent) return false

    const splitIdx = userIndices[userIndices.length - this._compressionKeepRecent]
    const oldMessages = this.messages.slice(0, splitIdx)
    const recentMessages = this.messages.slice(splitIdx)

    if (oldMessages.length === 0) return false

    const historyText = oldMessages
      .map(m => `[${m.role === "user" ? "用户" : "助手"}]: ${String(typeof m.content === "string" ? m.content : JSON.stringify(m.content)).slice(0, 500)}`)
      .join("\n")
    const previousSummary = this._compressed ? String(this._compressedSummary || "").trim() : ""

    const compressPrompt = [
      "请把下面的对话整理成一份可长期使用的摘要，供后续对话直接参考。",
      "保留这些内容：",
      "1. 用户的核心诉求、关注点与情绪走向",
      "2. 已达成的事实、约定、结论",
      "3. 用户的个人信息、偏好、习惯",
      "4. 正在讨论的话题主线（不要只留结论，要留话题本身）",
      "5. 未完成或待跟进的事项",
      "6. 对话中出现的具体细节、例子、数字（这些是后续回忆的线索）",
      "",
      "- 用第三人称陈述，多条时用短句分行，不要写成报告体。",
      "- 输出纯文本：不要 Markdown 标题、列表符号、加粗、编号。",
      "- 不要编造，不要写“建议向用户确认”这类套话。",
      `- 控制在 ${this._compressionMaxLength} 字以内，使用中文。`,
      previousSummary ? `\n--- 更早的摘要（必须并入，不要丢弃）---\n${previousSummary}\n--- 更早摘要结束 ---` : "",
      "",
      "--- 新的对话历史 ---",
      historyText,
      "--- 结束 ---",
    ].filter(Boolean).join("\n")

    try {
      const result = await aiClient.chat(
        [{ role: "user", content: compressPrompt }],
        { temperature: 0.1, maxTokens: Math.ceil(this._compressionMaxLength * 2) }
      )

      if (result?.content) {
        const limit = Math.max(200, Number(this._compressionMaxLength) || 800)
        let summary = String(result.content)
          .replace(/^#{1,6}\s*/gm, "")
          .replace(/\*\*([^*]+)\*\*/g, "$1")
          .replace(/^\s*[-*+]\s+/gm, "")
          .trim()
        if (summary.length > limit) {
          const cut = summary.slice(0, limit)
          const brk = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("\n"))
          summary = (brk > limit * 0.6 ? cut.slice(0, brk + 1) : cut).trim()
        }
        this._compressedSummary = summary
        this._compressedTurnCount = (this._compressedTurnCount || 0) + userIndices.length - this._compressionKeepRecent
        this._compressed = true
        this.messages = recentMessages

        Bot.makeLog("info", [
          "上下文压缩完成",
          `压缩了 ${this._compressedTurnCount} 轮对话`,
          `摘要长度: ${summary.length} 字`,
          `保留最近 ${this._compressionKeepRecent} 轮`,
          `当前 token: ${this.tokenCount}`,
        ], "AIContext")

        return true
      }
    } catch (err) {
      Bot.makeLog("warn", ["上下文压缩失败", err.message], "AIContext")
    }

    return false
  }

  _trimContext() {
    while (this.tokenCount > this.maxContextTokens && this.messages.length > 2) {
      const idx = this.messages.findIndex(m => m.role !== "system")
      if (idx >= 0) this.messages.splice(idx, 1)
      else break
    }

    let turns = 0
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === "user") turns++
    }
    while (turns > this.maxHistoryTurns && this.messages.length > 2) {
      const firstUser = this.messages.findIndex(m => m.role === "user")
      if (firstUser >= 0) {
        this.messages.splice(firstUser, 1)
        if (firstUser < this.messages.length && this.messages[firstUser]?.role === "assistant") {
          this.messages.splice(firstUser, 1)
        }
      } else break
      turns--
    }
  }

  async summarize(aiClient, maxLength = 500) {
    if (this.messages.length <= 4) return null

    const historyText = this.messages
      .map(m => `[${m.role}]: ${m.content}`)
      .join("\n")

    const summaryPrompt = `请将以下对话历史总结为不超过${maxLength}字的摘要，保留关键信息：\n\n${historyText}`

    try {
      const result = await aiClient.chat([{ role: "user", content: summaryPrompt }], {
        maxTokens: Math.ceil(maxLength * 2),
      })
      return result.content
    } catch {
      return null
    }
  }

  clear() {
    this.messages = []
    this._compressed = false
    this._compressedSummary = ""
    this._compressedTurnCount = 0
    this.tokenSpent = 0
    this.turnUsed = 0
    this.turnWindowStart = 0
    this.extraTokenSpent = 0
    return this
  }

  keepRecent(n) {
    this.messages = this.messages.slice(-n)
    return this
  }

  get userMessages() {
    return this.messages.filter(m => m.role === "user")
  }

  get assistantMessages() {
    return this.messages.filter(m => m.role === "assistant")
  }

  get isCompressed() {
    return this._compressed
  }

  toJSON() {
    return {
      systemPrompt: this.systemPrompt,
      compressed: this._compressed,
      compressedSummary: this._compressedSummary,
      compressedTurnCount: this._compressedTurnCount,
      messages: this.messages.map(m => ({
        role: m.role,
        content: m.content,
        time: m.time,
      })),
      tokenCount: this.tokenCount,
      tokenSpent: this.tokenSpent,
      turnLimit: this.turnLimit,
      turnUsed: this.turnUsed,
      turnWindowMinutes: this.turnWindowMinutes,
      extraTokenBudget: this.extraTokenBudget,
      extraTokenSpent: this.extraTokenSpent,
    }
  }
}