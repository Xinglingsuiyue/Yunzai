/**
 * AI API 客户端 — 负责与 AI 服务端通信
 * 支持 OpenAI Chat Completions / Responses、Google Gemini、Anthropic Claude
 */
import http from "node:http"
import https from "node:https"
import crypto from "node:crypto"
import { HttpsProxyAgent } from "https-proxy-agent"
import cfg from "../config/config.js"

const ADAPTER_TYPES = ["openai", "gemini", "claude"]
const KEY_STRATEGIES = ["roundRobin", "random", "weighted", "leastUsed", "failover"]

/** 多 Key 使用计数：按渠道 + Key 指纹累计，跨客户端实例保留 */
const keyUsage = new Map()

function keyFingerprint(channelId, key) {
  return `${channelId}::${crypto.createHash("sha1").update(String(key)).digest("hex").slice(0, 12)}`
}

function bumpKeyUsage(channelId, key) {
  const id = keyFingerprint(channelId, key)
  keyUsage.set(id, (keyUsage.get(id) || 0) + 1)
}

function readKeyUsage(channelId, key) {
  return keyUsage.get(keyFingerprint(channelId, key)) || 0
}

const GEMINI_SCHEMA_DROP = new Set([
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "definitions",
  "additionalProperties",
  "patternProperties",
  "propertyNames",
  "dependencies",
  "strict",
  "const",
  "examples",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "if",
  "then",
  "else",
  "not",
])

function normalizeBaseURL(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/(?:chat\/completions|completions|responses|messages)$/i, "")
}

function normalizePath(value) {
  const raw = String(value || "").trim()
  if (!raw) return ""
  if (/^https?:\/\//i.test(raw)) return raw
  return raw.startsWith("/") ? raw : `/${raw}`
}

function applyModelPath(pathname, model) {
  return String(pathname || "").replace(/\{model\}/g, encodeURIComponent(model))
}

function textContent(value) {
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    return value
      .map(part => {
        if (typeof part === "string") return part
        if (!part || typeof part !== "object") return ""
        return typeof part.text === "string" ? part.text : ""
      })
      .join("")
  }
  if (value === null || value === undefined) return ""
  return String(value)
}

function parseJSONObject(raw) {
  if (raw && typeof raw === "object") return raw
  const text = String(raw || "").trim()
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function parseToolOutput(raw) {
  const text = textContent(raw)
  if (raw && typeof raw === "object") return raw
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function cleanGeminiSchema(value) {
  if (Array.isArray(value)) return value.map(cleanGeminiSchema)
  if (!value || typeof value !== "object") return value
  const result = {}
  for (const [key, item] of Object.entries(value)) {
    if (GEMINI_SCHEMA_DROP.has(key)) continue
    result[key] = cleanGeminiSchema(item)
  }
  return result
}

function normalizeUsage(usage, adapterType, apiFormat) {
  if (!usage || typeof usage !== "object") return {}
  if (adapterType === "openai") {
    // Chat Completions 与 Responses 的缓存字段位置不同，两个都认
    const cached =
      Number(usage.prompt_tokens_details?.cached_tokens) ||
      Number(usage.input_tokens_details?.cached_tokens) ||
      0
    const withCache = cached > 0 ? { cached_tokens: cached } : {}
    if (apiFormat !== "responses") return { ...usage, ...withCache }
    const prompt = Number(usage.input_tokens ?? usage.prompt_tokens) || 0
    const completion = Number(usage.output_tokens ?? usage.completion_tokens) || 0
    return {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: Number(usage.total_tokens) || prompt + completion,
      ...withCache,
    }
  }
  if (adapterType === "gemini") {
    const cached = Number(usage.cachedContentTokenCount) || 0
    return {
      prompt_tokens: Number(usage.promptTokenCount) || 0,
      completion_tokens: Number(usage.candidatesTokenCount) || 0,
      total_tokens: Number(usage.totalTokenCount) || 0,
      ...(cached > 0 ? { cached_tokens: cached } : {}),
      ...(usage.thoughtsTokenCount ? { reasoning_tokens: usage.thoughtsTokenCount } : {}),
    }
  }
  const prompt =
    (Number(usage.input_tokens) || 0) +
    (Number(usage.cache_creation_input_tokens) || 0) +
    (Number(usage.cache_read_input_tokens) || 0)
  const completion = Number(usage.output_tokens) || 0
  const cached = Number(usage.cache_read_input_tokens) || 0
  const cacheWrite = Number(usage.cache_creation_input_tokens) || 0
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    ...(cached > 0 ? { cached_tokens: cached } : {}),
    ...(cacheWrite > 0 ? { cache_write_tokens: cacheWrite } : {}),
  }
}

function geminiToolConfig(choice) {
  if (choice === "none") return { functionCallingConfig: { mode: "NONE" } }
  if (choice === "required" || choice === "any")
    return { functionCallingConfig: { mode: "ANY" } }
  if (choice && typeof choice === "object") {
    const name = choice.function?.name || choice.name
    if (name) return { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [name] } }
  }
  return { functionCallingConfig: { mode: "AUTO" } }
}

function claudeToolChoice(choice) {
  if (!choice) return undefined
  if (choice === "none") return { type: "none" }
  if (choice === "required" || choice === "any") return { type: "any" }
  if (typeof choice === "object") {
    const name = choice.function?.name || choice.name
    if (name) return { type: "tool", name }
  }
  return { type: "auto" }
}

function responsesToolChoice(choice) {
  if (!choice) return undefined
  if (typeof choice === "string") return choice
  const name = choice.function?.name || choice.name
  return name ? { type: "function", name } : "auto"
}

function mapGeminiFinishReason(reason) {
  if (reason === "MAX_TOKENS") return "length"
  if (["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT"].includes(reason))
    return "content_filter"
  if (!reason || reason === "STOP") return "stop"
  return String(reason).toLowerCase()
}

function mapClaudeFinishReason(reason) {
  if (reason === "tool_use") return "tool_calls"
  if (reason === "max_tokens") return "length"
  if (reason === "refusal") return "content_filter"
  if (!reason || reason === "end_turn" || reason === "stop_sequence") return "stop"
  return String(reason)
}

export default class AIClient {
  /** 默认模型列表 */
  static MODELS = {
    "gpt-4o": { maxTokens: 128000, outputTokens: 4096 },
    "gpt-4o-mini": { maxTokens: 128000, outputTokens: 4096 },
    "claude-3.5-sonnet": { maxTokens: 200000, outputTokens: 8192 },
    "deepseek-v3": { maxTokens: 65536, outputTokens: 8192 },
    "deepseek-r1": { maxTokens: 65536, outputTokens: 8192 },
    "qwen-plus": { maxTokens: 131072, outputTokens: 8192 },
    "glm-4": { maxTokens: 128000, outputTokens: 4096 },
  }

  constructor(opts = {}) {
    const adapterType = ADAPTER_TYPES.includes(opts.adapterType) ? opts.adapterType : "openai"
    const defaultBase =
      adapterType === "gemini"
        ? "https://generativelanguage.googleapis.com"
        : adapterType === "claude"
          ? "https://api.anthropic.com"
          : "https://api.openai.com/v1"
    const defaultModel =
      adapterType === "gemini"
        ? "gemini-2.0-flash"
        : adapterType === "claude"
          ? "claude-sonnet-4-5"
          : "gpt-4o-mini"
    const configuredBase = opts.baseURL || (adapterType === "openai" ? cfg.ai?.baseURL : "") || ""

    this.adapterType = adapterType
    this.apiFormat = adapterType === "openai" && opts.apiFormat === "responses" ? "responses" : "chat"
    this.baseURL = normalizeBaseURL(configuredBase || defaultBase)
    this.chatPath = normalizePath(opts.chatPath)
    this.modelsPath = normalizePath(opts.modelsPath)
    this.responsePath = normalizePath(opts.responsePath)
    // 多 Key：主 Key 与附加 Key 合并成候选池，按策略挑选
    this.apiKeys = AIClient._normalizeKeys(opts.apiKeys)
    this.keyStrategy = KEY_STRATEGIES.includes(opts.keyStrategy) ? opts.keyStrategy : "roundRobin"
    this.apiKey = opts.apiKey || this.apiKeys[0]?.key || cfg.ai?.apiKey || ""
    if (!this.apiKeys.length && this.apiKey) this.apiKeys = [{ key: this.apiKey, weight: 1 }]
    this.stream = opts.stream !== false
    this._keyCursor = 0
    this.model = opts.model || (adapterType === "openai" ? cfg.ai?.model : "") || defaultModel
    // 采样参数只在预设 / 渠道上配置，客户端只做最后兜底
    this.temperature = opts.temperature ?? 0.7
    this.topP = opts.topP ?? 1.0
    this.maxTokens = opts.maxTokens ?? 2048
    this.timeout = opts.timeout ?? cfg.ai?.timeout ?? 60000
    this.maxRetries = opts.maxRetries ?? cfg.ai?.maxRetries ?? 3
    this.proxyUrl = String(opts.proxyUrl || "").trim()
    this.channelId = String(opts.channelId || "")
    this.channelName = String(opts.channelName || "")
    this.imageModel = String(opts.imageModel || "")
    this._proxyAgent = null
  }

  /** 归一化多 Key 入参：兼容 ["k1","k2"] 与 [{ key, weight }] */
  static _normalizeKeys(list) {
    if (!Array.isArray(list)) return []
    const seen = new Set()
    const out = []
    for (const item of list) {
      const raw = typeof item === "string" ? { key: item } : item || {}
      const key = String(raw.key ?? raw.apiKey ?? "").trim()
      if (!key || seen.has(key)) continue
      seen.add(key)
      const weight = Math.min(100, Math.max(1, Math.round(Number(raw.weight) || 1)))
      out.push({ key, weight })
    }
    return out.slice(0, 50)
  }

  /** 按策略给出本次请求的 Key 顺序 */
  _keyCandidates() {
    const keys = this.apiKeys
    if (keys.length <= 1) return keys
    const strategy = this.keyStrategy
    const shuffled = () => {
      const copy = [...keys]
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[copy[i], copy[j]] = [copy[j], copy[i]]
      }
      return copy
    }
    if (strategy === "random") return shuffled()
    if (strategy === "leastUsed")
      return [...keys].sort((a, b) => readKeyUsage(this.channelId, a.key) - readKeyUsage(this.channelId, b.key))
    if (strategy === "weighted") {
      const total = keys.reduce((sum, item) => sum + item.weight, 0)
      let roll = Math.random() * total
      let picked = keys[keys.length - 1]
      for (const item of keys) {
        roll -= item.weight
        if (roll <= 0) {
          picked = item
          break
        }
      }
      return [picked, ...shuffled().filter(item => item.key !== picked.key)]
    }
    if (strategy === "failover") return keys
    // roundRobin：游标推进，保证连续请求落在不同 Key
    const start = this._keyCursor % keys.length
    this._keyCursor = (this._keyCursor + 1) % keys.length
    return [...keys.slice(start), ...keys.slice(0, start)]
  }

  /** 复制一个只换 Key 的轻量客户端，避免并发请求互相覆盖 apiKey */
  _withKey(key) {
    if (!key || key === this.apiKey) return this
    const clone = Object.create(Object.getPrototypeOf(this))
    Object.assign(clone, this)
    clone.apiKey = key
    return clone
  }

  /** 获取模型信息 */
  getModelInfo() {
    return AIClient.MODELS[this.model] || { maxTokens: 65536, outputTokens: 4096 }
  }

  /** 各适配器的默认接口路径 */
  _defaultPaths() {
    if (this.adapterType === "gemini") {
      if (/\/models$/i.test(this.baseURL)) return { chat: "/{model}:generateContent", models: "" }
      if (/\/v1(?:beta|alpha)?$/i.test(this.baseURL))
        return { chat: "/models/{model}:generateContent", models: "/models" }
      return {
        chat: "/v1beta/models/{model}:generateContent",
        models: "/v1beta/models",
      }
    }
    if (this.adapterType === "claude") {
      return /\/v1$/i.test(this.baseURL)
        ? { chat: "/messages", models: "/models" }
        : { chat: "/v1/messages", models: "/v1/models" }
    }
    return { chat: "/chat/completions", models: "/models", responses: "/responses" }
  }

  /** 构建请求头 */
  _buildHeaders(extra = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...extra,
    }
    if (this.adapterType === "openai") {
      if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`
    } else if (this.adapterType === "claude") {
      headers["anthropic-version"] = "2023-06-01"
      if (this.apiKey) headers["x-api-key"] = this.apiKey
    } else if (this.apiKey) {
      headers["x-goog-api-key"] = this.apiKey
    }
    return headers
  }

  _agent() {
    if (!this.proxyUrl) return undefined
    if (!this._proxyAgent) this._proxyAgent = new HttpsProxyAgent(this.proxyUrl)
    return this._proxyAgent
  }

  _resolveURL(pathname) {
    const raw = String(pathname || "").trim()
    if (!raw) return this.baseURL
    if (/^https?:\/\//i.test(raw)) return raw
    let path = raw.startsWith("/") ? raw : `/${raw}`
    const version = this.baseURL.match(/\/v\d+(?:beta|alpha)?$/i)?.[0]
    if (version && path.toLowerCase().startsWith(`${version.toLowerCase()}/`))
      path = path.slice(version.length)
    return `${this.baseURL}${path}`
  }

  /** 通过 HTTP(S) 代理发送请求，返回 { status, headers, text } */
  _proxyRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
      let target
      try {
        target = new URL(url)
      } catch {
        return reject(new Error(`AI 接口地址无效: ${url}`))
      }
      const transport = target.protocol === "http:" ? http : https
      const timeout = Number(options.timeout) || this.timeout
      const req = transport.request(
        target,
        {
          method: options.method || "POST",
          headers: options.headers || {},
          agent: this._agent(),
        },
        res => {
          const chunks = []
          res.on("data", chunk => chunks.push(chunk))
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8")
            if (res.statusCode >= 400) {
              let message = text.slice(0, 500)
              try {
                const parsed = JSON.parse(text)
                message = parsed.error?.message || parsed.message || message
              } catch {}
              const error = new Error(`AI API 错误 [${res.statusCode}]: ${message || "请求失败"}`)
              error.status = res.statusCode

              error.upstream = true
              error.retryAfter = AIClient._parseRetryAfter(res.headers)
              return reject(error)
            }
            resolve({ status: res.statusCode, headers: res.headers, text })
          })
        },
      )
      req.setTimeout(timeout, () => req.destroy(new Error(`AI 请求超时 (${timeout}ms)`)))
      req.on("error", reject)
      if (options.body) req.write(options.body)
      req.end()
    })
  }

  /** 请求 JSON 接口（自动走代理） */
  async _fetchJSON(pathname, body, opts = {}) {
    const url = this._resolveURL(pathname)
    const timeout = Number(opts.timeout) || this.timeout
    const payload = typeof body === "string" ? body : JSON.stringify(body)
    if (this.proxyUrl) {
      const response = await this._proxyRequest(url, {
        method: "POST",
        headers: this._buildHeaders(opts.headers),
        body: payload,
        timeout,
      })
      try {
        return JSON.parse(response.text)
      } catch {
        throw new Error("AI API 返回了非 JSON 响应")
      }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: this._buildHeaders(opts.headers),
        body: payload,
        signal: controller.signal,
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        const error = new Error(
          `AI API 错误 [${res.status}]: ${errData.error?.message || errData.message || res.statusText}`,
        )
        error.status = res.status

        error.upstream = true
        error.retryAfter = AIClient._parseRetryAfter(res.headers)
        throw error
      }
      return await res.json()
    } catch (error) {
      if (error.name === "AbortError") throw new Error(`AI 请求超时 (${timeout}ms)`)
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  /** 获取服务端可用模型列表 */
  async listModels() {
    const defaults = this._defaultPaths()
    const pathname = this.modelsPath || defaults.models
    const timeout = Math.min(Math.max(5000, Number(this.timeout) || 20000), 30000)
    let text
    if (this.proxyUrl) {
      const response = await this._proxyRequest(this._resolveURL(pathname), {
        method: "GET",
        headers: this._buildHeaders(),
        timeout,
      })
      text = response.text
    } else {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeout)
      try {
        const res = await fetch(this._resolveURL(pathname), {
          headers: this._buildHeaders(),
          signal: controller.signal,
        })
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}))
          const error = new Error(
            `AI API 错误 [${res.status}]: ${errData.error?.message || errData.message || res.statusText}`,
          )
          error.status = res.status

          error.upstream = true
          throw error
        }
        text = await res.text()
      } catch (error) {
        if (error.name === "AbortError") throw new Error(`AI 请求超时 (${timeout}ms)`)
        throw error
      } finally {
        clearTimeout(timer)
      }
    }

    let data
    try {
      data = JSON.parse(text)
    } catch {
      const preview = String(text || "").trim().slice(0, 60).replace(/\s+/g, " ")
      const isHtml = /^<!doctype|^<html/i.test(preview)
      const hint = isHtml
        ? `该地址返回的是网页而非接口数据，请检查接口地址是否遗漏 /v1 之类的路径`
        : `响应不是 JSON，请检查接口地址是否正确`
      const error = new Error(
        `模型列表接口返回了非 JSON 响应（${this._resolveURL(pathname)}）：${hint}${preview ? `；返回内容开头：${preview}` : ""}`,
      )
      error.upstream = true
      throw error
    }
    const raw = Array.isArray(data)
      ? data
      : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.models)
          ? data.models
          : []
    return [
      ...new Set(
        raw
          .flatMap(item => {
            if (typeof item === "string") return [item]
            if (!item || typeof item !== "object") return []
            if (
              Array.isArray(item.supportedGenerationMethods) &&
              !item.supportedGenerationMethods.includes("generateContent")
            )
              return []
            const name = item.id || item.name || item.model
            return name ? [String(name).replace(/^models\//, "")] : []
          })
          .filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b))
  }

  /** 指数退避延迟；429 限流按更长基数退避，避免分钟级配额被连续撞穿 */
  async _delay(attempt, retryAfter, status) {
    if (Number(retryAfter) > 0) return Bot.sleep(Number(retryAfter))
    const base = status === 429 ? 20000 : 1000
    const cap = status === 429 ? 60000 : 30000
    await Bot.sleep(Math.min(base * 2 ** attempt, cap))
  }

  /** 解析 Retry-After / x-ratelimit-reset 等限流提示，返回毫秒 */
  static _parseRetryAfter(headers) {
    if (!headers) return 0
    const pick = (name) => headers[name] ?? headers[name.toLowerCase?.()] ?? headers.get?.(name)
    const retryAfter = pick("retry-after")
    if (retryAfter != null && retryAfter !== "") {
      const seconds = Number(retryAfter)
      if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds * 1000)
      const date = Date.parse(String(retryAfter))
      if (!Number.isNaN(date)) return Math.max(0, date - Date.now())
    }
    const reset = String(pick("x-ratelimit-reset-requests") || pick("x-ratelimit-reset") || "").trim()
    if (!reset) return 0
    const match = reset.match(/^([0-9.]+)\s*(ms|s|m)?$/i)
    if (!match) return 0
    const value = Number(match[1])
    if (!Number.isFinite(value) || value <= 0) return 0
    const unit = (match[2] || "s").toLowerCase()
    return Math.round(unit === "ms" ? value : unit === "m" ? value * 60000 : value * 1000)
  }

  /**
   * 发送聊天请求（非流式），支持 function calling
   * @param {Array} messages 消息数组 [{role, content}]
   * @param {Object} opts 选项
   * @param {Array} opts.tools OpenAI tools 定义数组
   * @param {string} opts.toolChoice tool_choice 策略
   * @returns {Promise<Object>} { content, usage, finishReason, toolCalls }
   */
  async chat(messages, opts = {}) {
    const candidates = opts.client ? [] : this._keyCandidates()
    let lastError
    for (let index = 0; index < Math.max(1, candidates.length); index++) {
      const entry = candidates[index]
      const client = entry ? this._withKey(entry.key) : this
      try {
        const result = await client._chatWithRetry(messages, opts)
        if (entry) bumpKeyUsage(this.channelId, entry.key)
        return result
      } catch (err) {
        lastError = err
        // Key 无效 / 限流 / 服务端异常时才换 Key；参数错误换 Key 也没用
        const keyRelated = !err.status || err.status === 401 || err.status === 403 || err.status === 429 || err.status >= 500
        if (!keyRelated || index >= candidates.length - 1) throw err
        if (entry) bumpKeyUsage(this.channelId, entry.key)
        Bot.makeLog(
          "warn",
          [`渠道「${this.channelName || this.channelId}」第 ${index + 1} 个 Key 失败，切换下一个`, err.message],
          "AIClient",
        )
      }
    }
    throw lastError
  }

  async _chatWithRetry(messages, opts) {
    const maxRetries = Math.max(0, Number(opts.maxRetries ?? this.maxRetries) || 0)
    let lastError
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this._dispatchChat(messages, opts)
      } catch (err) {
        lastError = err
        if (err.status && err.status >= 400 && err.status < 500 && err.status !== 429) throw err
        // 超时说明上游已经卡住，重试只会让用户再等一轮超时时间
        if (/超时|aborted due to timeout/i.test(err.message || "")) throw err
        if (attempt < maxRetries) {
          const retryAfter = Number(err.retryAfter) || 0
          Bot.makeLog(
            "warn",
            [`AI 请求重试 [${attempt + 1}/${maxRetries}]`, err.message, retryAfter ? `等待 ${retryAfter}ms` : ""].filter(Boolean),
            "AIClient",
          )
          await this._delay(attempt, retryAfter, err.status)
        }
      }
    }
    throw lastError
  }

  async _dispatchChat(messages, opts) {
    if (this.adapterType === "gemini") return this._chatGemini(messages, opts)
    if (this.adapterType === "claude") return this._chatClaude(messages, opts)
    if (this.apiFormat === "responses") return this._chatOpenAIResponses(messages, opts)
    return this._chatOpenAI(messages, opts)
  }

  _parseOpenAIChat(data) {
    const choice = data.choices?.[0] || {}
    const message = choice.message || {}
    const toolCalls = []
    for (const tc of message.tool_calls || []) {
      let args = {}
      try {
        args = JSON.parse(tc.function?.arguments || "{}")
      } catch {
        Bot.makeLog(
          "warn",
          [`AI 工具参数不是合法 JSON [${tc.function?.name}]`, tc.function?.arguments],
          "AIClient",
        )
      }
      toolCalls.push({
        id: tc.id,
        name: tc.function?.name || "",
        arguments: args,
      })
    }
    return {
      content: textContent(message.content),
      usage: data.usage || {},
      finishReason: choice.finish_reason || "stop",
      toolCalls: toolCalls.length ? toolCalls : null,
    }
  }

  async _chatOpenAI(messages, opts) {
    const body = {
      model: opts.model || this.model,
      messages,
      temperature: opts.temperature ?? this.temperature,
      top_p: opts.topP ?? this.topP,
      max_tokens: opts.maxTokens ?? this.maxTokens,
      stream: false,
    }
    if (opts.reasoningEffort) body.reasoning_effort = opts.reasoningEffort
    if (opts.tools?.length) {
      body.tools = opts.tools
      body.tool_choice = opts.toolChoice || "auto"
    }
    const data = await this._fetchJSON(
      this.chatPath || this._defaultPaths().chat,
      body,
      opts,
    )
    return this._parseOpenAIChat(data)
  }

  async _chatOpenAIResponses(messages, opts) {
    const input = []
    const instructions = []

    for (const message of messages || []) {
      const role = message?.role
      if (role === "system" || role === "developer") {
        const text = textContent(message.content)
        if (text) instructions.push(text)
        continue
      }
      if (role === "tool") {
        input.push({
          type: "function_call_output",
          call_id: message.tool_call_id || "",
          output: textContent(message.content),
        })
        continue
      }
      if (role === "assistant") {
        const text = textContent(message.content)
        if (text) input.push({ role: "assistant", content: [{ type: "output_text", text }] })
        for (const tc of message.tool_calls || []) {
          const id = tc.id || tc.call_id || ""
          const name = tc.function?.name || tc.name || ""
          input.push({
            type: "function_call",
            call_id: id,
            name,
            arguments: tc.function?.arguments || JSON.stringify(tc.arguments || {}),
          })
        }
        continue
      }
      const text = textContent(message.content)
      if (text) input.push({ role: "user", content: [{ type: "input_text", text }] })
    }

    const body = {
      model: opts.model || this.model,
      input,
      stream: false,
      temperature: opts.temperature ?? this.temperature,
      top_p: opts.topP ?? this.topP,
      max_output_tokens: opts.maxTokens ?? this.maxTokens,
    }
    if (instructions.length) body.instructions = instructions.join("\n\n")
    if (opts.reasoningEffort) body.reasoning = { effort: opts.reasoningEffort }
    if (opts.tools?.length) {
      body.tools = opts.tools
        .map(tool => {
          const fn = tool.function || tool
          return {
            type: "function",
            name: fn.name || "",
            description: fn.description || "",
            parameters: fn.parameters || { type: "object", properties: {} },
          }
        })
        .filter(tool => tool.name)
      body.tool_choice = responsesToolChoice(opts.toolChoice)
    }

    const data = await this._fetchJSON(
      this.responsePath || this._defaultPaths().responses,
      body,
      opts,
    )

    let content = ""
    let sawMessage = false
    const toolCalls = []
    for (const item of data.output || []) {
      if (item?.type === "message") {
        const text = textContent(item.content)
        if (text) {
          content += text
          sawMessage = true
        }
      } else if (item?.type === "function_call" && item.name) {
        toolCalls.push({
          id: item.call_id || item.id || `call_${toolCalls.length}`,
          name: item.name,
          arguments: parseJSONObject(item.arguments),
        })
      }
    }
    if (!sawMessage && typeof data.output_text === "string") content = data.output_text

    const finishReason = toolCalls.length
      ? "tool_calls"
      : data.status === "incomplete"
        ? data.incomplete_details?.reason === "max_output_tokens"
          ? "length"
          : "stop"
        : "stop"

    return {
      content,
      usage: normalizeUsage(data.usage, "openai", "responses"),
      finishReason,
      toolCalls: toolCalls.length ? toolCalls : null,
    }
  }

  _toGeminiContents(messages = []) {
    const contents = []
    const systemParts = []
    const callNames = new Map()

    const push = (role, parts) => {
      if (!parts.length) return
      const last = contents[contents.length - 1]
      if (last && last.role === role) last.parts.push(...parts)
      else contents.push({ role, parts })
    }

    for (const message of messages || []) {
      const role = message?.role
      if (role === "system" || role === "developer") {
        const text = textContent(message.content)
        if (text) systemParts.push(text)
        continue
      }
      if (role === "tool") {
        const name = callNames.get(message.tool_call_id) || "tool"
        const output = parseToolOutput(message.content)
        push("user", [
          {
            functionResponse: {
              name,
              response:
                output && typeof output === "object" && !Array.isArray(output)
                  ? output
                  : { result: output },
            },
          },
        ])
        continue
      }
      if (role === "assistant") {
        const parts = []
        const text = textContent(message.content)
        if (text) parts.push({ text })
        for (const tc of message.tool_calls || []) {
          const name = tc.function?.name || tc.name || ""
          if (tc.id) callNames.set(tc.id, name)
          parts.push({ functionCall: { name, args: parseJSONObject(tc.function?.arguments) } })
        }
        push("model", parts)
        continue
      }
      const text = textContent(message.content)
      if (text) push("user", [{ text }])
    }

    return { contents, systemInstruction: systemParts.join("\n\n") }
  }

  _parseGeminiResponse(data) {
    const candidate = data.candidates?.[0]
    const parts = candidate?.content?.parts || []
    let content = ""
    const toolCalls = []
    for (const part of parts) {
      if (typeof part?.text === "string") content += part.text
      if (part?.functionCall?.name) {
        toolCalls.push({
          id: `gemini_${Date.now()}_${toolCalls.length}`,
          name: part.functionCall.name,
          arguments: part.functionCall.args || {},
        })
      }
    }
    const blocked = !candidate && data.promptFeedback?.blockReason
    return {
      content,
      usage: normalizeUsage(data.usageMetadata, "gemini"),
      finishReason: blocked
        ? "content_filter"
        : mapGeminiFinishReason(candidate?.finishReason),
      toolCalls: toolCalls.length ? toolCalls : null,
    }
  }

  async _chatGemini(messages, opts) {
    const model = String(opts.model || this.model || "")
      .replace(/^models\//, "")
      .trim()
    const defaults = this._defaultPaths()
    const pathname = applyModelPath(this.chatPath || defaults.chat, model)
    const { contents, systemInstruction } = this._toGeminiContents(messages)

    const body = { contents }
    if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] }

    const generationConfig = {}
    if (opts.temperature !== undefined || this.temperature !== undefined)
      generationConfig.temperature = opts.temperature ?? this.temperature
    if (opts.topP !== undefined || this.topP !== undefined)
      generationConfig.topP = opts.topP ?? this.topP
    const maxTokens = opts.maxTokens ?? this.maxTokens
    if (maxTokens) generationConfig.maxOutputTokens = maxTokens
    if (Object.keys(generationConfig).length) body.generationConfig = generationConfig

    if (opts.tools?.length) {
      const functionDeclarations = opts.tools
        .map(tool => {
          const fn = tool.function || tool
          const cleaned = cleanGeminiSchema(fn.parameters || {})
          return {
            name: fn.name || "",
            description: fn.description || "",
            parameters:
              cleaned && typeof cleaned === "object" && cleaned.type
                ? cleaned
                : { type: "object", properties: cleaned?.properties || {} },
          }
        })
        .filter(tool => tool.name)
      if (functionDeclarations.length) {
        body.tools = [{ functionDeclarations }]
        body.toolConfig = geminiToolConfig(opts.toolChoice)
      }
    }

    const data = await this._fetchJSON(pathname, body, opts)
    return this._parseGeminiResponse(data)
  }

  _toClaudeMessages(messages = []) {
    const systemParts = []
    const result = []
    const callNames = new Map()

    const push = (role, blocks) => {
      if (!blocks.length) return
      const last = result[result.length - 1]
      if (last && last.role === role) last.content.push(...blocks)
      else result.push({ role, content: blocks })
    }

    for (const message of messages || []) {
      const role = message?.role
      if (role === "system" || role === "developer") {
        const text = textContent(message.content)
        if (text) systemParts.push(text)
        continue
      }
      if (role === "tool") {
        push("user", [
          {
            type: "tool_result",
            tool_use_id: message.tool_call_id || "",
            content: textContent(message.content),
          },
        ])
        continue
      }
      if (role === "assistant") {
        const blocks = []
        const text = textContent(message.content)
        if (text) blocks.push({ type: "text", text })
        for (const tc of message.tool_calls || []) {
          const id = tc.id || ""
          const name = tc.function?.name || tc.name || ""
          if (id) callNames.set(id, name)
          blocks.push({
            type: "tool_use",
            id,
            name,
            input: parseJSONObject(tc.function?.arguments),
          })
        }
        push("assistant", blocks)
        continue
      }
      const text = textContent(message.content)
      if (text) push("user", [{ type: "text", text }])
    }

    return { system: systemParts.join("\n\n"), messages: result, callNames }
  }

  _parseClaudeResponse(data) {
    const blocks = Array.isArray(data.content) ? data.content : []
    let content = ""
    const toolCalls = []
    for (const block of blocks) {
      if (block?.type === "text" && typeof block.text === "string") content += block.text
      if (block?.type === "tool_use" && block.name) {
        toolCalls.push({
          id: block.id || `claude_${toolCalls.length}`,
          name: block.name,
          arguments: parseJSONObject(block.input),
        })
      }
    }
    return {
      content,
      usage: normalizeUsage(data.usage, "claude"),
      finishReason: mapClaudeFinishReason(data.stop_reason),
      toolCalls: toolCalls.length ? toolCalls : null,
    }
  }

  async _chatClaude(messages, opts) {
    const defaults = this._defaultPaths()
    const pathname = this.chatPath || defaults.chat
    const { system, messages: claudeMessages } = this._toClaudeMessages(messages)
    const maxTokens = Math.max(1, Number(opts.maxTokens ?? this.maxTokens) || 1024)
    const temperature = Math.min(1, Math.max(0, Number(opts.temperature ?? this.temperature) || 0))

    const body = {
      model: opts.model || this.model,
      max_tokens: maxTokens,
      messages: claudeMessages,
      temperature,
      stream: false,
    }
    if (system) body.system = system
    if (opts.tools?.length) {
      body.tools = opts.tools
        .map(tool => {
          const fn = tool.function || tool
          return {
            name: fn.name || "",
            description: fn.description || "",
            input_schema: fn.parameters || { type: "object", properties: {} },
          }
        })
        .filter(tool => tool.name)
      body.tool_choice = claudeToolChoice(opts.toolChoice)
    }

    const data = await this._fetchJSON(pathname, body, opts)
    return this._parseClaudeResponse(data)
  }

  /**
   * 发送聊天请求（流式）
   * 仅 OpenAI Chat Completions 支持原生 SSE，其余适配器退化为单次回调
   * @param {Array} messages 消息数组
   * @param {Object} opts 选项
   * @param {Function} onChunk 流式回调 (chunkText, accumulated)
   * @returns {Promise<Object>} { content, usage, finishReason }
   */
  async chatStream(messages, opts = {}) {
    const { onChunk, ...restOpts } = opts
    if (this.adapterType !== "openai" || this.apiFormat === "responses") {
      const result = await this.chat(messages, restOpts)
      if (onChunk && result.content) await onChunk(result.content, result.content)
      return result
    }
    // 多 Key：流式失败换下一个 Key 重试（已产出的内容不回滚，直接续写会重复，故仅首个分片前切换）
    const candidates = this._keyCandidates()
    let lastError
    for (let index = 0; index < Math.max(1, candidates.length); index++) {
      const entry = candidates[index]
      const client = entry ? this._withKey(entry.key) : this
      let emitted = false
      const guarded = async (chunk, full) => {
        emitted = true
        if (onChunk) await onChunk(chunk, full)
      }
      try {
        const result = await client._chatStreamOnce(messages, { ...restOpts, onChunk: guarded })
        if (entry) bumpKeyUsage(this.channelId, entry.key)
        return result
      } catch (err) {
        lastError = err
        if (entry) bumpKeyUsage(this.channelId, entry.key)
        if (emitted || index >= candidates.length - 1) throw err
        const keyRelated = !err.status || err.status === 401 || err.status === 403 || err.status === 429 || err.status >= 500
        if (!keyRelated) throw err
        Bot.makeLog(
          "warn",
          [`渠道「${this.channelName || this.channelId}」流式第 ${index + 1} 个 Key 失败，切换下一个`, err.message],
          "AIClient",
        )
      }
    }
    throw lastError
  }

  async _chatStreamOnce(messages, opts = {}) {
    const { onChunk, ...restOpts } = opts

    const pathname = this.chatPath || this._defaultPaths().chat
    const body = {
      model: restOpts.model || this.model,
      messages,
      temperature: restOpts.temperature ?? this.temperature,
      top_p: restOpts.topP ?? this.topP,
      max_tokens: restOpts.maxTokens ?? this.maxTokens,
      stream: true,
    }
    if (restOpts.reasoningEffort) body.reasoning_effort = restOpts.reasoningEffort
    if (restOpts.tools?.length) {
      body.tools = restOpts.tools
      body.tool_choice = restOpts.toolChoice || "auto"
    }

    const state = { accumulated: "", finishReason: "stop", usage: {}, toolCalls: new Map() }
    const consume = async line => {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith("data:")) return
      const data = trimmed.slice(5).trim()
      if (!data || data === "[DONE]") return
      try {
        const parsed = JSON.parse(data)
        const choice = parsed.choices?.[0]
        const delta = choice?.delta
        if (delta?.content) {
          state.accumulated += delta.content
          if (onChunk) await onChunk(delta.content, state.accumulated)
        }
        // 工具调用在流式里按 index 分片下发，需要逐段拼接
        for (const tc of delta?.tool_calls || []) {
          const index = Number(tc.index) || 0
          const current = state.toolCalls.get(index) || { id: "", name: "", arguments: "" }
          if (tc.id) current.id = tc.id
          if (tc.function?.name) current.name = tc.function.name
          if (tc.function?.arguments) current.arguments += tc.function.arguments
          state.toolCalls.set(index, current)
        }
        if (choice?.finish_reason) state.finishReason = choice.finish_reason
        if (parsed.usage) Object.assign(state.usage, parsed.usage)
      } catch {}
    }

    if (this.proxyUrl) {
      const response = await this._proxyRequest(this._resolveURL(pathname), {
        method: "POST",
        headers: this._buildHeaders({ Accept: "text/event-stream" }),
        body: JSON.stringify(body),
        timeout: restOpts.timeout || this.timeout,
      })
      for (const line of response.text.split("\n")) await consume(line)
      return this._streamResult(state)
    }

    const res = await fetch(this._resolveURL(pathname), {
      method: "POST",
      headers: this._buildHeaders({ Accept: "text/event-stream" }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(restOpts.timeout || this.timeout),
    })

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}))
      const err = new Error(
        `AI API 流式错误 [${res.status}]: ${errData.error?.message || res.statusText}`,
      )
      err.status = res.status

      err.upstream = true
      throw err
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""
      for (const line of lines) await consume(line)
    }
    if (buffer) await consume(buffer)

    return this._streamResult(state)
  }

  /** 流式结果统一出口：把分片的 tool_calls 拼成和普通请求一致的格式 */
  _streamResult(state) {
    const toolCalls = [...state.toolCalls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, item]) => {
        let args = {}
        try {
          args = JSON.parse(item.arguments || "{}")
        } catch {
          Bot.makeLog("warn", [`流式工具参数不是合法 JSON [${item.name}]`, item.arguments], "AIClient")
        }
        return { id: item.id || `call_${item.name}_${Date.now()}`, name: item.name, arguments: args }
      })
      .filter(item => item.name)
    return {
      content: state.accumulated,
      usage: state.usage,
      finishReason: state.finishReason,
      toolCalls: toolCalls.length ? toolCalls : null,
    }
  }

  /** 通过代理或直连发送 GET 请求 */
  async _getText(pathname, opts = {}) {
    const url = this._resolveURL(pathname)
    const timeout = Number(opts.timeout) || this.timeout
    if (this.proxyUrl) {
      const response = await this._proxyRequest(url, {
        method: "GET",
        headers: this._buildHeaders(opts.headers),
        timeout,
      })
      return response.text
    }
    const res = await fetch(url, {
      headers: this._buildHeaders(opts.headers),
      signal: AbortSignal.timeout(timeout),
    })
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}))
      const error = new Error(
        `AI API 错误 [${res.status}]: ${errData.error?.message || errData.message || res.statusText}`,
      )
      error.status = res.status

      error.upstream = true
      throw error
    }
    return await res.text()
  }

  /** 测试单个模型：发送一次最小对话请求 */
  async testModel(model = this.model, opts = {}) {
    const started = Date.now()
    const target = String(model || this.model)
    try {
      const result = await this.chat([{ role: "user", content: "ping" }], {
        model: target,
        maxTokens: 32,
        temperature: 0,
        timeout: Math.min(Number(this.timeout) || 30000, 30000),
        maxRetries: 0,
        ...opts,
      })
      return {
        ok: true,
        latency: Date.now() - started,
        model: target,
        adapterType: this.adapterType,
        apiFormat: this.apiFormat,
        finishReason: result.finishReason,
        message: result.content ? result.content.slice(0, 100) : "接口已响应",
      }
    } catch (error) {
      return {
        ok: false,
        latency: Date.now() - started,
        model: target,
        adapterType: this.adapterType,
        apiFormat: this.apiFormat,
        error: error.message,
      }
    }
  }

  /** 测试连接：优先模型列表，不支持时退化为一次最小对话请求 */
  async testConnection() {
    const started = Date.now()
    try {
      const models = await this.listModels()
      return {
        ok: true,
        latency: Date.now() - started,
        mode: "models",
        models: models.slice(0, 20),
        adapterType: this.adapterType,
        apiFormat: this.apiFormat,
      }
    } catch (firstError) {
      const result = await this.testModel(this.model, {
        timeout: Math.min(this.timeout, 30000),
      })
      if (result.ok) {
        return {
          ok: true,
          latency: Date.now() - started,
          mode: "chat",
          message: result.message,
          adapterType: this.adapterType,
          apiFormat: this.apiFormat,
        }
      }
      return {
        ok: false,
        latency: Date.now() - started,
        mode: "chat",
        error: `${firstError.message}；${result.error}`,
        adapterType: this.adapterType,
        apiFormat: this.apiFormat,
      }
    }
  }

  /** 生成图片（OpenAI 兼容 /images/generations） */
  async generateImage(options = {}) {
    if (this.adapterType !== "openai")
      throw new Error("当前渠道适配器不支持 OpenAI 绘图接口")
    const prompt = String(options.prompt || "").trim()
    if (!prompt) throw new Error("绘图提示词不能为空")
    const body = {
      model: options.model || this.imageModel || "dall-e-3",
      prompt,
      n: Math.min(4, Math.max(1, Number(options.n) || 1)),
      size: options.size || "1024x1024",
      response_format: options.responseFormat || "url",
    }
    if (options.quality) body.quality = options.quality
    if (options.style) body.style = options.style
    const data = await this._fetchJSON("/images/generations", body, {
      timeout: Number(options.timeout) || 180000,
    })
    return { created: data.created || Date.now(), images: data.data || [] }
  }

  /**
   * 批量计算 token 数量（简易估算）
   * 中文约 1.5 字/token，英文约 4 字/token
   * @param {string} text
   * @returns {number}
   */
  estimateTokens(text) {
    if (!text) return 0
    let tokens = 0
    for (const char of text) {
      const code = char.codePointAt(0)
      if (code < 128) {
        tokens += 0.25 // 英文/数字/符号
      } else {
        tokens += 0.6 // 中文/其他Unicode
      }
    }
    return Math.ceil(tokens)
  }

  /** 获取可用模型列表 */
  static getAvailableModels() {
    return Object.keys(AIClient.MODELS).map(name => ({
      name,
      ...AIClient.MODELS[name],
    }))
  }
}
