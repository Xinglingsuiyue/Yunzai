import AIToolRegistry from "./AIToolRegistry.js"

const PROTOCOL_VERSION = "2024-11-05"
const SERVER_INFO = { name: "yunzai-builtin-tools", version: "1.0.0" }

export const BUILTIN_SERVER_ID = "__builtin__"
export const BUILTIN_SERVER_NAME = "内置工具服务"
export const BUILTIN_TOOL_PREFIX = "mcp_builtin_"

function toMcpResult(result) {
  const text = String(result?.result ?? "").trim()
  const failed = result?.success === false
  return {
    content: [{ type: "text", text: text || result?.error || "" }],
    isError: failed,
  }
}

export default class AIBuiltinMCPServer {
  constructor() {
    this.ready = false
    this.nextId = 1
  }

  async handle(message, context) {
    const id = message?.id
    const method = String(message?.method || "")
    const params = message?.params || {}
    const reply = result => ({ jsonrpc: "2.0", id, result })
    const fail = (code, text) => ({ jsonrpc: "2.0", id, error: { code, message: text } })

    if (method === "initialize") {
      this.ready = true
      return reply({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      })
    }
    if (method === "notifications/initialized") return null
    if (method === "tools/list") return reply({ tools: this.listTools() })
    if (method === "tools/call") {
      const name = String(params.name || "")
      const sourceName = name.startsWith(BUILTIN_TOOL_PREFIX) ? name.slice(BUILTIN_TOOL_PREFIX.length) : name
      const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {}
      const result = await AIToolRegistry.executeSourceTool(sourceName, args, context)
      return reply(toMcpResult(result))
    }
    return fail(-32601, `未实现的方法: ${method || "(空)"}`)
  }

  listTools() {
    return [...AIToolRegistry.sources.values()]
      .filter(tool => !AIToolRegistry._isDirectTool(tool))
      .map(tool => ({
        name: AIToolRegistry._exposedName(tool.name),
        description: tool.description,
        inputSchema: tool.parameters || { type: "object", properties: {}, required: [] },
        _meta: {
          sourceName: tool.name,
          pluginName: tool.pluginName,
          pluginKey: tool.pluginKey,
          fnc: tool.fnc,
          permission: tool.permission,
          danger: tool.danger,
          needsGroup: tool.needsGroup,
          event: tool.event,
        },
      }))
  }
}

export { toMcpResult }
