/**
 * AI 对话上下文管理 — 维护会话历史、Token 控制、上下文窗口策略、智能压缩
 */
import AIClient from "./AIClient.js"
import cfg from "../config/config.js"

export default class AIContext {
  /**
   * @param {Object} opts
   * @param {number} opts.maxContextTokens 最大上下文 token 数
   * @param {number} opts.maxHistoryTurns 最大保留历史轮次
   * @param {string} opts.systemPrompt 系统提示词
   */
  constructor(opts = {}) {
    this.systemPrompt = opts.systemPrompt || ""
    this.runtimeRules = opts.runtimeRules || ""
    this.messages = [] // [{role, content, time, presetId, presetName}]
    this.tokenSpent = 0
    // 轮数限制：窗口内已回复轮数与其起始时间，窗口过期后归零
    this.turnLimit = 0
    this.turnWindowMinutes = 180
    this.turnUsed = 0
    this.turnWindowStart = 0
    // 轮数用尽后才启用的额外 token 额度
    this.extraTokenBudget = 0
    this.extraTokenSpent = 0
    this._toolTokenOverhead = 0
    // 当前说话的人格：用于区分历史里「我」和「另一个我」
    this.presetId = String(opts.presetId || "")
    this.presetName = String(opts.presetName || "")

    // 压缩相关
    this._compressed = false          // 是否已执行过压缩
    this._compressedSummary = ""      // 压缩后的摘要文本
    this._compressedTurnCount = 0     // 压缩时覆盖的轮次数
    this.tokenizer = new AIClient()
    this.applyRuntimeConfig(opts)

    this._lastActivity = 0
  }

  /**
   * 重新读取上下文与压缩设置。
   * 配置保存后现有会话也能在下一轮对话按新值运行；opts 用于叠加预设覆盖。
   */
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
    // 0 表示不保留历史轮次，只保留当前消息
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

  /** 最后活跃时间 */
  get lastActivity() {
    return this._lastActivity
  }
  set lastActivity(v) {
    this._lastActivity = v
  }

  /** 设置系统提示词 */
  setSystemPrompt(prompt) {
    this.systemPrompt = prompt
    return this
  }

  /**
   * 系统规则（表情、工具、记忆、群管等能力说明）。
   * 与人格提示词分开存，发送时作为独立的 system 消息，
   * 这样换人设不会带走能力规则，人设也不会被规则稀释。
   */
  setRuntimeRules(rules) {
    this.runtimeRules = String(rules || "")
    return this
  }

  /** 追加系统提示词 */
  appendSystemPrompt(prompt) {
    this.systemPrompt = (this.systemPrompt ? this.systemPrompt + "\n" : "") + prompt
    return this
  }

  /** 添加用户消息 */
  addUserMessage(content, extra = {}) {
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

  /** 添加助手消息 */
  addAssistantMessage(content, extra = {}) {
    this.messages.push({
      role: "assistant",
      content,
      time: Date.now(),
      // 记下这句话是谁说的，切换人格后才能区分「我」和「另一个我」
      ...(this.presetId ? { presetId: this.presetId, presetName: this.presetName } : {}),
      ...extra,
    })
    this._lastActivity = Date.now()
    this._trimContext()
    return this
  }

  /** 添加系统消息（会追加到 systemPrompt 后） */
  addSystemMessage(content) {
    this.messages.push({
      role: "system",
      content,
      time: Date.now(),
    })
    return this
  }

  /**
   * 获取用于 API 调用的消息数组
   * 如果已压缩，会在 system prompt 后插入压缩摘要
   */
  getMessages() {
    const msgs = []

    // 1. 系统提示词（人格与设定）
    if (this.systemPrompt) {
      msgs.push({ role: "system", content: this.systemPrompt })
    }

    // 1.5 系统规则：能力与约束单独一条，不混进人格
    if (this.runtimeRules) {
      msgs.push({ role: "system", content: this.runtimeRules })
    }

    // 2. 压缩摘要（如果已压缩）
    if (this._compressed && this._compressedSummary) {
      msgs.push({
        role: "system",
        content: `[对话历史摘要 — 以下是你与用户之前对话的关键信息，请基于这些信息继续对话]\n${this._compressedSummary}`,
      })
    }

    // 3. 最近的完整消息
    // 人格切换只在切换点插一条系统说明，不给每条消息加前缀：
    // 加前缀会被模型当成输出范例照抄，把标注写进正式回复。
    let injectedAt = -1
    for (let i = 0; i < this.messages.length; i++) {
      const m = this.messages[i]
      if (m.role !== "assistant") continue
      const speaker = String(m.presetId || "")
      if (!speaker || speaker === this.presetId) continue
      // 找到「别人格发言」之后、且尚未提示过的位置
      if (injectedAt < 0) injectedAt = i
    }
    if (injectedAt >= 0) {
      const foreignName = String(this.messages[injectedAt]?.presetName || "另一个人格")
      // 插在第一条别人格消息之前
      const head = this.messages.slice(0, injectedAt)
      const tail = this.messages.slice(injectedAt)
      for (const m of head) msgs.push({ role: m.role, content: m.content })
      msgs.push({
        role: "system",
        content: `[人格切换] 下面有一段是「${foreignName}」在岗时说的话。那是同一个身体里的另一个人格，不是你亲口说的：你知道那些事，但不要当成自己的经历，回复里也不要加任何出处标注。你现在是「${this.presetName || this.presetId}」。`,
      })
      for (const m of tail) msgs.push({ role: m.role, content: m.content })
      return msgs
    }
    for (const m of this.messages) {
      msgs.push({ role: m.role, content: m.content })
    }

    return msgs
  }

  /** 判断这条助手消息是否由其他人格说的（供 UI 或外部逻辑用） */
  _isForeignMessage(m) {
    if (m?.role !== "assistant") return false
    const speaker = String(m.presetId || "")
    if (!speaker || !this.presetId) return false
    return speaker !== this.presetId
  }

  /** 不含工具定义的 token 数 */
  get contentTokenCount() {
    let count = this.tokenizer.estimateTokens(this.systemPrompt)
    if (this._compressedSummary) count += this.tokenizer.estimateTokens(this._compressedSummary)
    for (const m of this.messages) count += this.tokenizer.estimateTokens(this._plainText(m.content))
    return count
  }

  /** 多模态消息的 content 是数组，取其中的文本参与计数，图片按固定开销估算 */
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

  /** 估算总 token 数（含随请求发送的工具定义开销） */
  get tokenCount() {
    return this.contentTokenCount + (Number(this._toolTokenOverhead) || 0)
  }

  /** 设置本次请求附带的工具定义 token 开销，使其参与上下文预算 */
  setToolTokenOverhead(tokens) {
    this._toolTokenOverhead = Math.max(0, Number(tokens) || 0)
    this._trimContext()
    return this
  }

  /**
   * 实际生效的压缩阈值。
   * 上下文裁剪会先把内容压到 maxContextTokens 以下，所以阈值高于上限时
   * 永远无法触发压缩；这里把阈值限制在上限的 90%。
   */
  get compressionThreshold() {
    const limit = Math.max(1000, Math.floor(this.maxContextTokens * 0.9))
    return Math.min(this._compressionThreshold, limit)
  }

  /**
   * 检查是否需要压缩
   * @returns {boolean}
   */
  needsCompression() {
    if (!this._compressionEnabled) return false

    const turnCount = this.userMessages.length
    if (turnCount <= this._compressionKeepRecent) return false

    // 只看消息本身，不把工具定义算进来：工具开销每轮都差不多，
    // 一旦压过阈值会让压缩每轮重复触发。
    let content = this.tokenizer.estimateTokens(this.systemPrompt)
    for (const m of this.messages) content += this.tokenizer.estimateTokens(this._plainText(m.content))
    return content > this.compressionThreshold
  }

  /**
   * 执行上下文压缩 — 将旧消息总结为摘要，保留最近 N 轮
   * 需要由 AIManager 调用，因为需要访问 AI 客户端
   * @param {AIClient} aiClient AI 客户端实例
   * @returns {Promise<boolean>} 是否成功压缩
   */
  async compress(aiClient) {
    if (!this._compressionEnabled) return false

    const turnCount = this.userMessages.length
    if (turnCount <= this._compressionKeepRecent) return false

    // 找到分割点：保留最近 N 轮，压缩更早的消息
    const userIndices = []
    for (let i = 0; i < this.messages.length; i++) {
      if (this.messages[i].role === "user") userIndices.push(i)
    }

    if (userIndices.length <= this._compressionKeepRecent) return false

    // 分割点：第 (total - keepRecent) 个 user 消息的位置
    const splitIdx = userIndices[userIndices.length - this._compressionKeepRecent]
    const oldMessages = this.messages.slice(0, splitIdx)
    const recentMessages = this.messages.slice(splitIdx)

    if (oldMessages.length === 0) return false

    // 构建压缩提示：已有摘要要并入新摘要，否则历史会被一层层覆盖丢掉
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
        // 摘要超长会不断撑大上下文，按上限硬截断
        const limit = Math.max(200, Number(this._compressionMaxLength) || 800)
        // 摘要会进系统提示词，带 Markdown 会让模型跟着模仿，这里先洗掉
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

  /** 裁剪上下文 — 滑动窗口 + 智能裁剪 */
  _trimContext() {
    // 策略1: 按 token 数裁剪
    while (this.tokenCount > this.maxContextTokens && this.messages.length > 2) {
      const idx = this.messages.findIndex(m => m.role !== "system")
      if (idx >= 0) this.messages.splice(idx, 1)
      else break
    }

    // 策略2: 按轮次裁剪
    let turns = 0
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === "user") turns++
    }
    while (turns > this.maxHistoryTurns && this.messages.length > 2) {
      const firstUser = this.messages.findIndex(m => m.role === "user")
      if (firstUser >= 0) {
        this.messages.splice(firstUser, 1)
        // 同时移除紧随的 assistant 消息
        if (firstUser < this.messages.length && this.messages[firstUser]?.role === "assistant") {
          this.messages.splice(firstUser, 1)
        }
      } else break
      turns--
    }
  }

  /**
   * 生成对话摘要（用于手动导出，非压缩流程）
   * @param {AIClient} aiClient
   * @param {number} maxLength
   * @returns {Promise<string|null>}
   */
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

  /** 清除上下文 */
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

  /** 保留最近 N 条消息 */
  keepRecent(n) {
    this.messages = this.messages.slice(-n)
    return this
  }

  /** 获取用户消息列表 */
  get userMessages() {
    return this.messages.filter(m => m.role === "user")
  }

  /** 获取助手消息列表 */
  get assistantMessages() {
    return this.messages.filter(m => m.role === "assistant")
  }

  /** 是否已压缩 */
  get isCompressed() {
    return this._compressed
  }

  /** 导出上下文为 JSON */
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