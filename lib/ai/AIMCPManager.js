import { spawn } from "node:child_process"
import AIToolRegistry from "./AIToolRegistry.js"
import { aiAdmin } from "./AIAdminStore.js"
import AIBuiltinMCPServer, {
  BUILTIN_SERVER_ID,
  BUILTIN_SERVER_NAME,
  BUILTIN_TOOL_PREFIX,
} from "./AIBuiltinMCP.js"

const PROTOCOL_VERSION = "2024-11-05"
const CLIENT_INFO = { name: "yunzai-webui", version: "1.0.0" }

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function shortHash(value) {
  let hash = 0x811c9dc5
  for (const char of String(value)) {
    hash ^= char.codePointAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function resultToText(result) {
  if (!result) return ""
  if (Array.isArray(result.content)) {
    const parts = result.content.map(part => {
      if (part?.type === "text") return part.text || ""
      if (part?.type === "resource") return part.resource?.text || `[资源: ${part.resource?.uri || ""}]`
      if (part?.type === "image") return `[图片: ${part.mimeType || "image"}]`
      return `[${part?.type || "内容"}]`
    })
    return parts.filter(Boolean).join("\n")
  }
  if (result.structuredContent !== undefined) {
    try {
      return JSON.stringify(result.structuredContent)
    } catch {
      return String(result.structuredContent)
    }
  }
  if (typeof result === "string") return result
  try {
    return JSON.stringify(result)
  } catch {
    return String(result)
  }
}

export default class AIMCPManager {
  constructor() {
    this.states = new Map()
    this._syncing = null
    this.builtin = new AIBuiltinMCPServer()
    this._builtinConnected = false
  }

  _server(id) {
    return aiAdmin.list("mcpServers").find(server => server.id === id) || null
  }

  _builtinStatus() {
    const tools = this._builtinConnected ? this.builtin.listTools().length : 0
    return {
      id: BUILTIN_SERVER_ID,
      name: BUILTIN_SERVER_NAME,
      transport: "builtin",
      enabled: true,
      builtin: true,
      connected: this._builtinConnected,
      tools,
      toolNames: this._builtinConnected ? this.builtin.listTools().map(tool => tool.name) : [],
      error: "",
      serverInfo: { name: "yunzai-builtin-tools", version: "1.0.0" },
      lastConnectedAt: this._builtinConnectedAt || 0,
    }
  }

  refreshBuiltin() {
    AIToolRegistry._refreshExposedTools()
    this._builtinConnected = true
    this._builtinConnectedAt = Date.now()
    return this._builtinStatus()
  }

  async sync() {
    if (this._syncing) return this._syncing
    this._syncing = (async () => {
      for (const id of [...this.states.keys()]) await this.disconnect(id)
      const servers = aiAdmin.list("mcpServers").filter(server => server.enabled)
      for (const server of servers) {
        try {
          await this.connect(server)
        } catch (error) {
          this.states.set(server.id, {
            connected: false,
            tools: [],
            error: error.message || String(error),
            serverInfo: null,
            lastConnectedAt: 0,
          })
          Bot.makeLog("warn", [`MCP 连接失败 [${server.name}]`, error.message], "AIMCP")
        }
      }
      this.refreshBuiltin()
      return this.getStatus()
    })().finally(() => {
      this._syncing = null
    })
    return this._syncing
  }

  getStatus() {
    return [
      this._builtinStatus(),
      ...aiAdmin.list("mcpServers").map(server => {
        const state = this.states.get(server.id)
        return {
          id: server.id,
          name: server.name,
          transport: server.transport,
          enabled: server.enabled,
          connected: !!state?.connected,
          tools: state?.tools?.length || 0,
          toolNames: state?.tools || [],
          error: state?.error || "",
          serverInfo: state?.serverInfo || null,
          lastConnectedAt: state?.lastConnectedAt || 0,
        }
      }),
    ]
  }

  async connect(serverOrId) {
    const server = typeof serverOrId === "string" ? this._server(serverOrId) : serverOrId
    if (!server) throw new Error("MCP 服务不存在")
    if (this.states.get(server.id)?.connected) return this.states.get(server.id)

    await this.disconnect(server.id).catch(() => {})
    const state = {
      connected: false,
      tools: [],
      error: "",
      serverInfo: null,
      lastConnectedAt: 0,
    }
    this.states.set(server.id, state)

    try {
      if (server.transport === "stdio") {
        if (!server.command) throw new Error("未配置启动命令")
        await this._connectStdio(server, state)
      } else {
        if (!server.url) throw new Error("未配置 MCP HTTP 地址")
        await this._connectHttp(server, state)
      }
      state.connected = true
      state.lastConnectedAt = Date.now()
      state.error = ""
      Bot.makeLog("info", [`MCP 已连接 [${server.name}]`, `工具: ${state.tools.length}`], "AIMCP")
      return state
    } catch (error) {
      state.connected = false
      state.error = error.message || String(error)
      await this._cleanup(server.id)
      throw error
    }
  }

  async disconnect(serverId) {
    const state = this.states.get(serverId)
    if (!state) return false
    this._unregisterTools(serverId, state)
    await this._cleanup(serverId)
    this.states.delete(serverId)
    return true
  }

  async _cleanup(serverId) {
    const state = this.states.get(serverId)
    if (!state) return
    state.connected = false
    this._unregisterTools(serverId, state)
    if (state.child) {
      state.closing = true
      for (const pending of state.pending?.values() || []) {
        clearTimeout(pending.timer)
        pending.reject(new Error("MCP 连接已关闭"))
      }
      state.pending?.clear()
      try {
        state.child.kill()
      } catch {}
      state.child = null
    }
  }

  _unregisterTools(serverId, state) {
    for (const name of state.tools || []) {
      AIToolRegistry.sources.delete(name)
      AIToolRegistry.toolToPlugin.delete(name)
    }
    state.tools = []
    AIToolRegistry._refreshExposedTools()
  }

  async _connectStdio(server, state) {
    const timeout = Math.max(1000, Number(server.timeout) || 30000)
    const child = spawn(server.command, server.args || [], {
      cwd: process.cwd(),
      env: { ...process.env, ...(server.env || {}) },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: process.platform === "win32",
    })
    state.child = child
    state.pending = new Map()
    state.nextId = 1
    state.buffer = ""
    state.stderr = ""

    child.on("error", error => {
      state.error = `启动失败: ${error.message}`
      this._rejectPending(state, new Error(state.error))
    })
    child.on("exit", code => {
      if (state.closing) return
      state.connected = false
      state.error = `进程已退出 (code ${code ?? "?"})`
      this._unregisterTools(server.id, state)
      this._rejectPending(state, new Error(state.error))
    })
    child.stderr?.on("data", chunk => {
      state.stderr = `${state.stderr}${chunk.toString("utf8")}`.slice(-4000)
    })
    child.stdout?.on("data", chunk => this._onStdout(server, state, chunk))

    const initialized = await this._stdioRequest(
      state,
      "initialize",
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      },
      timeout,
    )
    state.serverInfo = initialized?.serverInfo || null
    this._stdioNotify(state, "notifications/initialized", {})
    const listed = await this._stdioRequest(state, "tools/list", {}, timeout)
    this._registerTools(server, state, listed?.tools || [])
  }

  _onStdout(server, state, chunk) {
    state.buffer += chunk.toString("utf8")
    let index
    while ((index = state.buffer.indexOf("\n")) !== -1) {
      const line = state.buffer.slice(0, index).trim()
      state.buffer = state.buffer.slice(index + 1)
      if (!line) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      if (message.id !== undefined && state.pending?.has(message.id)) {
        const pending = state.pending.get(message.id)
        state.pending.delete(message.id)
        clearTimeout(pending.timer)
        if (message.error) pending.reject(new Error(message.error.message || "MCP 请求失败"))
        else pending.resolve(message.result)
      }
    }
  }

  _rejectPending(state, error) {
    for (const pending of state.pending?.values() || []) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    state.pending?.clear()
  }

  _stdioRequest(state, method, params, timeout) {
    return new Promise((resolve, reject) => {
      if (!state.child?.stdin?.writable) return reject(new Error("MCP 进程不可用"))
      const id = state.nextId++
      const timer = setTimeout(() => {
        state.pending.delete(id)
        reject(new Error(`MCP 请求超时: ${method}`))
      }, timeout)
      timer.unref?.()
      state.pending.set(id, { resolve, reject, timer })
      const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"
      state.child.stdin.write(payload, error => {
        if (!error) return
        state.pending.delete(id)
        clearTimeout(timer)
        reject(error)
      })
    })
  }

  _stdioNotify(state, method, params) {
    if (!state.child?.stdin?.writable) return
    state.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n")
  }

  async _connectHttp(server, state) {
    const timeout = Math.max(1000, Number(server.timeout) || 30000)
    state.sessionId = ""
    const initialized = await this._httpRequest(
      server,
      state,
      "initialize",
      { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
      timeout,
    )
    state.serverInfo = initialized?.serverInfo || null
    await this._httpNotify(server, state, "notifications/initialized", {}, timeout)
    const listed = await this._httpRequest(server, state, "tools/list", {}, timeout)
    this._registerTools(server, state, listed?.tools || [])
  }

  _httpHeaders(server, state) {
    return {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(state.sessionId ? { "Mcp-Session-Id": state.sessionId } : {}),
      ...(server.headers || {}),
    }
  }

  async _httpNotify(server, state, method, params, timeout) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      await fetch(server.url, {
        method: "POST",
        headers: this._httpHeaders(server, state),
        body: JSON.stringify({ jsonrpc: "2.0", method, params }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  async _httpRequest(server, state, method, params, timeout) {
    state.nextId = (state.nextId || 0) + 1
    const id = state.nextId
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    let response
    try {
      response = await fetch(server.url, {
        method: "POST",
        headers: this._httpHeaders(server, state),
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
    const sessionId = response.headers.get("mcp-session-id")
    if (sessionId) state.sessionId = sessionId
    if (!response.ok) {
      const text = await response.text().catch(() => "")
      throw new Error(`MCP HTTP ${response.status}: ${text.slice(0, 300) || response.statusText}`)
    }
    const contentType = response.headers.get("content-type") || ""
    if (contentType.includes("text/event-stream")) {
      const text = await response.text()
      const messages = []
      for (const block of text.split(/\n\n/)) {
        const lines = block.split("\n").filter(line => line.startsWith("data:"))
        const data = lines.map(line => line.slice(5).trim()).join("\n")
        if (!data) continue
        try {
          messages.push(JSON.parse(data))
        } catch {}
      }
      const message = messages.find(item => item.id === id) || messages.find(item => item.error || item.result)
      if (!message) throw new Error("MCP SSE 响应中没有匹配的结果")
      if (message.error) throw new Error(message.error.message || "MCP 请求失败")
      return message.result
    }
    const data = await response.json().catch(() => null)
    if (!data) throw new Error("MCP 返回了空响应")
    if (data.error) throw new Error(data.error.message || "MCP 请求失败")
    return data.result
  }

  _registerTools(server, state, tools) {
    const base = normalizeName(server.name) || "server"
    const existing = new Set(state.tools)
    for (const tool of tools) {
      if (!tool?.name) continue
      let registryName = `mcp_${base}_${normalizeName(tool.name) || "tool"}`
      if (registryName.length > 56) registryName = registryName.slice(0, 48)
      if (AIToolRegistry.sources.has(registryName))
        registryName = `${registryName.slice(0, 54)}_${shortHash(`${server.id}:${tool.name}`)}`
      if (existing.has(registryName)) continue

      const ok = AIToolRegistry.registerRawTool({
        name: registryName,
        description: `【MCP · ${server.name}】${tool.description || tool.name}`,
        pluginName: `MCP · ${server.name}`,
        pluginKey: `mcp:${server.id}`,

        permission: ["master", "owner", "admin"].includes(String(server.permission || "").toLowerCase())
          ? String(server.permission).toLowerCase()
          : "admin",
        danger: ["medium", "high"].includes(String(tool.danger || "").toLowerCase())
          ? String(tool.danger).toLowerCase()
          : "medium",
        parameters:
          tool.inputSchema && typeof tool.inputSchema === "object"
            ? tool.inputSchema
            : { type: "object", properties: {}, required: [] },
        handler: async args => {
          const result = await this._callTool(server.id, tool.name, args || {})
          return result
        },
      })
      if (ok) state.tools.push(registryName)
    }
  }

  async callBuiltinTool(name, args, e) {
    const response = await this.builtin.handle(
      {
        jsonrpc: "2.0",
        id: this.builtin.nextId++,
        method: "tools/call",
        params: { name, arguments: args || {} },
      },
      e,
    )
    if (!response) throw new Error("内置 MCP 没有返回结果")
    if (response.error) throw new Error(response.error.message || "内置 MCP 调用失败")
    const text = (response.result?.content || [])
      .map(part => part?.text || "")
      .filter(Boolean)
      .join("\n")
    const failed = response.result?.isError === true
    return failed
      ? { success: false, result: text, error: text || "工具执行失败" }
      : { success: true, result: text }
  }

  async _callTool(serverId, toolName, args) {
    const server = this._server(serverId)
    const state = this.states.get(serverId)
    if (!server || !state?.connected) throw new Error("MCP 服务未连接")
    const timeout = Math.max(1000, Number(server.timeout) || 30000)
    const result =
      server.transport === "stdio"
        ? await this._stdioRequest(state, "tools/call", { name: toolName, arguments: args }, timeout)
        : await this._httpRequest(server, state, "tools/call", { name: toolName, arguments: args }, timeout)
    const text = resultToText(result)
    if (result?.isError)
      return { success: false, error: text || "MCP 工具执行失败", result: text }
    return { success: true, result: text }
  }
}

export const mcpManager = new AIMCPManager()
export { AIMCPManager }
