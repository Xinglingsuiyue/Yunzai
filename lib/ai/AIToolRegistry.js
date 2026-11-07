import cfg from "../config/config.js"
import { aiAdmin } from "./AIAdminStore.js"

const TOOL_NAME_MAX = 64
const TOOL_DESC_MAX = 600
const TOOL_RESULT_MAX = 4000

const TOOL_CALL_TIMEOUT = 45000

const DANGER_RANK = { low: 1, medium: 2, high: 3 }
const PERMISSION_RANK = { all: 0, everyone: 0, admin: 1, owner: 2, master: 3 }

const KNOWN_PERMISSIONS = new Set(["all", "everyone", "master", "owner", "admin"])

const DANGER_CEILING = { low: 1, medium: 2, high: 3 }
const PERMISSION_CEILING = { public: 0, admin: 1, owner: 2, master: 3 }
const DANGER_PATTERNS = {
  high: /(重启|关机|停止运行|安装|卸载|更新|升级|删除|清空|重置|格式化|执行|运行命令|命令行|shell|exec|sudo|支付|转账|红包|封禁|踢出|禁言|解禁|撤回|授权|修改配置|写入文件|覆盖)/i,
  medium: /(设置|修改|添加|创建|保存|发送|上传|下载|生成|绘图|画图|绑定|解绑|开启|关闭|提醒|戳|拍|记忆|知识库|昵称|名片|头衔)/i,
}

const STOP_CHARS = new Set(
  "的了是我你他她它在吗呢啊吧和就都也有不这个要会能把被给对说去来看想请帮一下什么怎么可以".split(""),
)

export default class AIToolRegistry {
  static tools = new Map()

  static sources = new Map()

  static toolToPlugin = new Map()

  static stats = { skipped: 0, collisions: 0 }

  static _refreshExposedTools() {
    AIToolRegistry.tools.clear()
    for (const source of AIToolRegistry.sources.values()) {
      const direct = AIToolRegistry._isDirectTool(source)
      const exposedName = direct ? source.name : AIToolRegistry._exposedName(source.name)
      if (!exposedName || AIToolRegistry.tools.has(exposedName)) continue
      AIToolRegistry.tools.set(exposedName, {
        ...source,
        sourceName: source.name,
        name: exposedName,
        pluginName: source.pluginName,
        pluginKey: direct ? source.pluginKey : "mcp:builtin",
        direct,
      })
    }
  }

  static _isDirectTool(source) {
    return String(source?.pluginKey || "").startsWith("direct:")
  }

  static _exposedName(sourceName) {
    const base = `mcp_builtin_${String(sourceName || "").replace(/^mcp_builtin_/, "")}`
    return base.length > 64 ? `${base.slice(0, 56)}_${AIToolRegistry._hash(base)}` : base
  }

  static registerRawTool(toolDef) {
    const name = String(toolDef?.name || "")
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
      Bot.makeLog("warn", `AI 工具名称不合法 "${name}"，跳过注册`, "AITool")
      return false
    }
    if (AIToolRegistry.sources.has(name)) {
      Bot.makeLog("warn", `AI 工具 "${name}" 已存在，跳过注册`, "AITool")
      return false
    }

    const tool = {
      name,
      description: AIToolRegistry._truncate(toolDef.description || name, TOOL_DESC_MAX),
      pluginKey: toolDef.pluginKey || `raw:${name}`,
      pluginName: toolDef.pluginName || "系统工具",
      fnc: null,
      rule: null,
      classRef: null,
      handler: toolDef.handler,
      priority: toolDef.priority ?? 0,
      permission: AIToolRegistry._normalizePermission(toolDef.permission, name),
      danger: AIToolRegistry._normalizeDanger(toolDef.danger, toolDef),
      needsGroup: !!toolDef.needsGroup,
      event: toolDef.event || null,
      parameters: toolDef.parameters || { type: "object", properties: {}, required: [] },
    }

    AIToolRegistry.sources.set(name, tool)
    AIToolRegistry.toolToPlugin.set(name, {
      classRef: null,
      key: tool.pluginKey,
      namespace: tool.pluginKey,
      plugin: { name: tool.pluginName },
    })
    AIToolRegistry._refreshExposedTools()

    Bot.makeLog("debug", `注册原始 AI 工具: ${name}`, "AITool")
    return true
  }

  static rebuildPluginTools(entries) {
    const list = Array.isArray(entries) ? entries : []
    for (const [name, tool] of [...AIToolRegistry.sources]) {
      const pluginKey = String(tool?.pluginKey || "")
      if (!pluginKey || pluginKey.startsWith("builtin:") || pluginKey.startsWith("direct:")) continue
      if (pluginKey.startsWith("raw:") || pluginKey.startsWith("mcp:")) continue
      AIToolRegistry.sources.delete(name)
      AIToolRegistry.toolToPlugin.delete(name)
    }
    AIToolRegistry.stats = { skipped: 0, collisions: 0 }
    let count = 0
    if (cfg.ai?.autoRegisterTools === true) {
      for (const entry of list) {
        if (entry?.builtin) continue
        count += AIToolRegistry.registerPlugin(entry)
      }
    }
    AIToolRegistry._refreshExposedTools()
    return count
  }

  static registerPlugin(pluginEntry) {
    const { plugin, class: classRef, key, namespace } = pluginEntry || {}
    if (!plugin || plugin.aiTool === false || !Array.isArray(plugin.rule)) return 0

    if (cfg.ai?.autoRegisterTools !== true) return 0

    let count = 0
    for (const rule of plugin.rule) {
      if (!rule?.fnc || !rule?.reg) continue
      if (rule.aiTool === false) continue
      if (typeof classRef?.prototype?.[rule.fnc] !== "function" && typeof plugin[rule.fnc] !== "function")
        continue

      let tool
      try {
        tool = AIToolRegistry._buildToolDef(plugin, rule, classRef, key, namespace)
      } catch (err) {
        Bot.makeLog("warn", [`AI 工具解析失败 [${plugin.name}/${rule.fnc}]`, err.message], "AITool")
        AIToolRegistry.stats.skipped++
        continue
      }

      if (AIToolRegistry.sources.has(tool.name)) {
        const owner = AIToolRegistry.sources.get(tool.name)?.pluginName || "未知来源"
        AIToolRegistry.stats.skipped++
        Bot.makeLog(
          "warn",
          [`AI 工具重名，已跳过 [${plugin.name}/${rule.fnc}] 工具名 ${tool.name}（已被 ${owner} 占用）`],
          "AITool",
        )
        continue
      }

      AIToolRegistry.sources.set(tool.name, tool)
      AIToolRegistry.toolToPlugin.set(tool.name, { classRef, key, namespace, plugin })
      count++
    }

    if (count > 0) {
      AIToolRegistry._refreshExposedTools()
      Bot.makeLog("debug", `注册 AI 工具 [${plugin.name}] ${count} 个`, "AITool")
    }
    return count
  }

  static _sanitizeName(value) {
    return String(value ?? "")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase()
  }

  static _hash(input) {
    let hash = 0x811c9dc5
    for (const char of String(input)) {
      hash ^= char.codePointAt(0)
      hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0).toString(36)
  }

  static _generateToolName(plugin, rule, key) {
    const fnc = AIToolRegistry._sanitizeName(rule.fnc)
    let base = AIToolRegistry._sanitizeName(plugin.name)
    if (!base) {
      base = AIToolRegistry._sanitizeName(
        String(key || "")
          .replace(/\.js$/i, "")
          .split(/[\\/]+/)
          .filter(Boolean)
          .slice(-2)
          .join("_"),
      ).replace(/-+/g, "_")
    }

    if (!base) base = fnc || "tool"

    let name = fnc ? `${base}_${fnc}` : `${base}_${AIToolRegistry._hash(`${key}:${rule.reg}`)}`
    if (name.length > 56) name = `${name.slice(0, 48)}_${AIToolRegistry._hash(name)}`

    name = name.replace(/^[-_]+/, "").replace(/[-_]{2,}/g, "_")
    if (!/^[a-zA-Z]/.test(name)) name = `t_${name}`

    if (AIToolRegistry.sources.has(name)) {
      const suffix = AIToolRegistry._hash(`${key}:${rule.fnc}:${String(rule.reg)}`)
      name = `${name.slice(0, 52)}_${suffix}`
      let index = 2
      while (AIToolRegistry.sources.has(name)) name = `${name.slice(0, 58)}_${index++}`
      AIToolRegistry.stats.collisions++
    }

    return name.slice(0, TOOL_NAME_MAX)
  }

  static _resolvePermission(rule, classRef, plugin) {
    const declared = String(rule?.permission || "").toLowerCase()
    if (declared && declared !== "all") return declared
    const fn = classRef?.prototype?.[rule?.fnc] || plugin?.[rule?.fnc]
    if (typeof fn !== "function") return declared || "all"
    let source = ""
    try {
      source = Function.prototype.toString.call(fn)
    } catch {
      return declared || "all"
    }
    return AIToolRegistry._hasMasterGuard(source) ? "master" : declared || "all"
  }

  static _hasMasterGuard(source) {
    const text = String(source || "")
    let from = 0
    while (from < text.length) {
      const start = text.indexOf("if", from)
      if (start === -1) return false
      let i = start + 2
      while (i < text.length && /\s/.test(text[i])) i++
      if (text[i] !== "(") {
        from = start + 2
        continue
      }
      let depth = 0
      let end = -1
      for (let j = i; j < text.length; j++) {
        if (text[j] === "(") depth++
        else if (text[j] === ")" && --depth === 0) {
          end = j
          break
        }
      }
      if (end === -1) return false
      const cond = text.slice(i + 1, end)
      from = end + 1
      if (!AIToolRegistry._negatesMaster(cond)) continue
      if (AIToolRegistry._stopsFlow(text.slice(end + 1, end + 260))) return true
    }
    return false
  }

  static _negatesMaster(cond) {
    const text = String(cond || "")
    if (/&&/.test(text)) return false
    return (
      /!\s*(?:this\.)?e\.isMaster\b/.test(text) ||
      /!\s*(?:this\.)?\w*[Mm]aster\s*\(/.test(text) ||
      /!\s*\(\s*(?:this\.)?e\.isMaster\b/.test(text)
    )
  }

  static _stopsFlow(body) {
    const text = String(body || "").replace(/^[\s;]+/, "")
    if (text.startsWith("{")) {
      let depth = 0
      let end = -1
      for (let i = 0; i < text.length; i++) {
        if (text[i] === "{") depth++
        else if (text[i] === "}" && --depth === 0) {
          end = i
          break
        }
      }
      if (end === -1) return false
      return /\b(return|throw)\b/.test(text.slice(1, end))
    }
    return /^(return|throw)\b/.test(text)
  }

  static _buildToolDef(plugin, rule, classRef, key, namespace) {
    const parsed = AIToolRegistry._parseRegex(rule.reg)
    const params = AIToolRegistry._extractParams(parsed)
    const name = AIToolRegistry._generateToolName(plugin, rule, key)
    const danger = AIToolRegistry._inferDanger(rule, plugin)
    let permission = AIToolRegistry._resolvePermission(rule, classRef, plugin)
    if (permission === "all" && danger === "high") permission = "master"

    const description = rule.aiDesc || plugin.aiDesc || plugin.dsc || `${plugin.name} - ${rule.fnc}`
    const example = AIToolRegistry._generateSample(parsed, {})
    const exampleValid = example && AIToolRegistry._testRegex(rule.reg, example)

    const fullDesc = AIToolRegistry._truncate(
      [
        `【${plugin.name}】${description}`,
        exampleValid ? `调用示例: ${example}` : "",
        `触发正则: ${String(rule.reg)}`,
        permission && permission !== "all" ? `所需权限: ${permission}` : "",
        rule.fnc.startsWith("ai") ? "该工具会执行真实的机器人操作，请确认用户意图后再调用。" : "",
      ]
        .filter(Boolean)
        .join("\n"),
      TOOL_DESC_MAX,
    )

    const event = rule.event || plugin.event || "message"
    const eventParts = String(event).split(".")
    const needsGroup =
      eventParts[0] === "notice" ||
      eventParts.includes("group") ||
      /群聊|群成员|禁言|踢出|群组/.test(String(rule.aiDesc || plugin.aiDesc || "")) ||
      /group|member|mute|kick|poke/i.test(String(rule.fnc))

    return {
      name,
      description: fullDesc,
      pluginKey: key,
      pluginName: plugin.name,
      fnc: rule.fnc,
      rule,
      classRef,
      namespace,
      priority: plugin.priority ?? 5000,
      permission,
      danger,
      needsGroup,
      event,
      parameters: params.schema,
      _parsed: parsed,
    }
  }

  static _normalizePermission(value, toolName = "") {
    const raw = String(value ?? "").trim().toLowerCase()
    if (!raw) return "all"
    if (KNOWN_PERMISSIONS.has(raw)) return raw
    Bot.makeLog(
      "warn",
      [`工具 ${toolName || "(未命名)"} 的权限值 "${value}" 无法识别，已按 master 处理`],
      "AITool",
    )
    return "master"
  }

  static _normalizeDanger(value, toolDef = {}) {
    const level = String(value || "").toLowerCase()
    if (DANGER_RANK[level]) return level
    return AIToolRegistry._inferDanger(toolDef, toolDef)
  }

  static _inferDanger(rule = {}, plugin = {}) {
    const explicit = String(rule.danger || "").toLowerCase()
    if (DANGER_RANK[explicit]) return explicit
    const text = [
      plugin.name,
      plugin.dsc,
      plugin.aiDesc,
      rule.name,
      rule.fnc,
      rule.aiDesc,
      String(rule.reg || ""),
    ]
      .filter(Boolean)
      .join(" ")
    if (DANGER_PATTERNS.high.test(text)) return "high"
    if (DANGER_PATTERNS.medium.test(text)) return "medium"
    const permission = String(rule.permission || "all").toLowerCase()
    if (permission === "master") return "high"
    if (permission === "owner" || permission === "admin") return "medium"
    return "low"
  }

  static _passesPreset(tool, preset) {
    if (!preset) return true
    const permissionCeiling = PERMISSION_CEILING[preset.toolPermission]
    if (
      permissionCeiling !== undefined &&
      (PERMISSION_RANK[String(tool.permission || "all").toLowerCase()] ?? 0) > permissionCeiling
    )
      return false
    const dangerCeiling = DANGER_CEILING[preset.maxDangerLevel]
    if (
      dangerCeiling !== undefined &&
      (DANGER_RANK[String(tool.danger || "low").toLowerCase()] ?? 1) > dangerCeiling
    )
      return false
    return true
  }

  static _parseRegex(reg) {
    const source = reg instanceof RegExp ? reg.source : String(reg)
    let pos = 0
    let groupIndex = 0

    const startsWith = value => source.startsWith(value, pos)

    const parseAlt = () => {
      const options = [parseSeq()]
      while (source[pos] === "|") {
        pos++
        options.push(parseSeq())
      }
      return options.length === 1 ? options[0] : { type: "alt", options }
    }

    const parseSeq = () => {
      const terms = []
      while (pos < source.length && source[pos] !== "|" && source[pos] !== ")") {
        const term = parseTerm()
        if (term) terms.push(term)
        else pos++
      }
      return { type: "seq", terms }
    }

    const parseTerm = () => {
      const atom = parseAtom()
      if (!atom) return null
      return { type: "term", atom, quant: parseQuant() }
    }

    const parseQuant = () => {
      const ch = source[pos]
      if (ch === "*" || ch === "+" || ch === "?") {
        pos++
        const lazy = source[pos] === "?"
        if (lazy) pos++
        return { kind: ch, min: ch === "+" ? 1 : 0, max: ch === "*" ? Infinity : 1, lazy }
      }
      if (ch === "{") {
        const end = source.indexOf("}", pos)
        if (end > pos) {
          const spec = source.slice(pos + 1, end)
          const match = spec.match(/^(\d+)(?:,(\d*))?$/)
          if (match) {
            pos = end + 1
            const lazy = source[pos] === "?"
            if (lazy) pos++
            const min = Number(match[1])
            const max =
              match[2] === undefined ? min : match[2] === "" ? Infinity : Number(match[2])
            return { kind: "range", min, max, lazy }
          }
        }
      }
      return null
    }

    const parseAtom = () => {
      const ch = source[pos]
      if (ch === undefined) return null
      if (ch === "^" || ch === "$") {
        pos++
        return { type: "empty" }
      }
      if (ch === ".") {
        pos++
        return { type: "literal", value: "a" }
      }
      if (ch === "[") return parseCharClass()
      if (ch === "\\") return parseEscape()
      if (ch === "(") return parseGroup()
      if (ch === ")") return null
      pos++
      return { type: "literal", value: ch }
    }

    const parseGroup = () => {
      pos++
      let kind = "capture"
      let name = null
      if (startsWith("?:")) {
        pos += 2
        kind = "noncapture"
      } else if (startsWith("?=")) {
        pos += 2
        kind = "lookahead"
      } else if (startsWith("?!")) {
        pos += 2
        kind = "negLookahead"
      } else if (startsWith("?<=")) {
        pos += 4
        kind = "lookbehind"
      } else if (startsWith("?<!")) {
        pos += 4
        kind = "negLookbehind"
      } else if (startsWith("?<")) {
        const end = source.indexOf(">", pos + 2)
        if (end > 0) {
          name = source.slice(pos + 2, end)
          pos = end + 1
          kind = "named"
        } else {
          pos += 1
          kind = "noncapture"
        }
      } else if (startsWith("?")) {
        pos += 1
        kind = "noncapture"
      }

      const body = parseAlt()
      if (source[pos] === ")") pos++
      const node = { type: "group", kind, name, body, optional: false }
      if (kind === "capture" || kind === "named") node.index = ++groupIndex
      return node
    }

    const parseCharClass = () => {
      pos++
      let negated = false
      if (source[pos] === "^") {
        negated = true
        pos++
      }
      let content = ""
      while (pos < source.length && source[pos] !== "]") {
        if (source[pos] === "\\") {
          content += source.slice(pos, pos + 2)
          pos += 2
        } else {
          content += source[pos]
          pos++
        }
      }
      if (source[pos] === "]") pos++
      return { type: "charClass", content, negated }
    }

    const parseEscape = () => {
      pos++
      const ch = source[pos]
      if (ch === undefined) return { type: "literal", value: "\\" }
      pos++

      const mapped = { d: "0", w: "a", s: " ", D: "a", W: " ", S: "a" }
      if (mapped[ch] !== undefined) return { type: "literal", value: mapped[ch], escape: ch }
      if (ch === "b" || ch === "B") return { type: "empty" }
      if (ch === "n") return { type: "literal", value: "\n" }
      if (ch === "r") return { type: "literal", value: "\r" }
      if (ch === "t") return { type: "literal", value: "\t" }
      if (ch === "f") return { type: "literal", value: "\f" }
      if (ch === "v") return { type: "literal", value: "\v" }
      if (ch === "0") return { type: "literal", value: "\0" }

      if (ch === "x") {
        const hex = source.slice(pos, pos + 2)
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          pos += 2
          return { type: "literal", value: String.fromCharCode(parseInt(hex, 16)) }
        }
      }
      if (ch === "u") {
        if (source[pos] === "{") {
          const end = source.indexOf("}", pos)
          const hex = source.slice(pos + 1, end)
          if (end > 0 && /^[0-9a-fA-F]+$/.test(hex)) {
            pos = end + 1
            return { type: "literal", value: String.fromCodePoint(parseInt(hex, 16)) }
          }
        }
        const hex = source.slice(pos, pos + 4)
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          pos += 4
          return { type: "literal", value: String.fromCharCode(parseInt(hex, 16)) }
        }
      }
      if (ch === "p" || ch === "P") {
        if (source[pos] === "{") {
          const end = source.indexOf("}", pos)
          if (end > 0) {
            pos = end + 1
            return { type: "literal", value: "a" }
          }
        }
      }
      if (/[1-9]/.test(ch)) return { type: "backref", index: Number(ch) }
      if (ch === "k" && source[pos] === "<") {
        const end = source.indexOf(">", pos)
        if (end > 0) {
          const name = source.slice(pos + 1, end)
          pos = end + 1
          return { type: "namedBackref", name }
        }
      }

      return { type: "literal", value: ch }
    }

    const ast = parseAlt()
    const groups = []
    const walk = (node, optionalParent = false) => {
      if (!node) return
      if (node.type === "seq") {
        for (const term of node.terms) {
          const optional =
            optionalParent ||
            (term.quant ? term.quant.min === 0 : false)
          if (term.atom?.type === "group") {
            term.atom.optional = optional
            if (term.atom.kind === "capture" || term.atom.kind === "named") groups.push(term.atom)
          }
          walk(term.atom, optional)
        }
      } else if (node.type === "alt") {
        for (const option of node.options) walk(option, optionalParent)
      } else if (node.type === "group") {
        if (node.kind === "capture" || node.kind === "named") {
          if (!groups.includes(node)) groups.push(node)
        }
        walk(node.body, optionalParent || node.optional)
      }
    }
    walk(ast)

    groups.sort((a, b) => a.index - b.index)
    return { source, ast, groups, groupCount: groupIndex }
  }

  static _generateSample(parsed, args = {}) {
    if (!parsed?.ast) return ""
    args = AIToolRegistry._normalizeArgs(args)

    const pickCharClass = node => {
      const content = node.content || ""
      if (!content) return "a"

      if (node.negated) {
        if (/\\s/.test(content) && !/\\S/.test(content)) return "a"
        if (/\\S/.test(content) && !/\\s/.test(content)) return " "
        if (/\\d/.test(content)) return "a"
        if (/\\w/.test(content)) return "-"
        for (const char of ["a", "0", "_", "中", "-", " "]) {
          if (!content.includes(char)) return char
        }
        return "z"
      }

      const candidates = []
      for (let i = 0; i < content.length; i++) {
        const ch = content[i]
        if (ch === "\\") {
          const next = content[++i]
          const mapped = { d: "0", w: "a", s: " ", D: "a", W: " ", S: "a" }
          if (mapped[next] !== undefined) candidates.push(mapped[next])
          else if (next) candidates.push(next)
          continue
        }
        candidates.push(ch)
      }
      return (
        candidates.find(char => char !== "-" && char !== "^" && char !== "]" && char !== " ") ||
        candidates.find(char => char === " ") ||
        "a"
      )
    }

    const genGroup = node => {
      if (["lookahead", "negLookahead", "lookbehind", "negLookbehind"].includes(node.kind)) {
        return { text: "", usedArg: false }
      }
      if (node.kind === "capture" || node.kind === "named") {
        const key = node.name
          ? AIToolRegistry._sanitizeParamName(node.name)
          : `param_${node.index}`
        const value = args[key] ?? args[`param_${node.index}`]
        if (value !== undefined && value !== null && value !== "") {
          return { text: String(value), usedArg: true }
        }
      }
      return gen(node.body)
    }

    const genTerm = term => {
      const atom = term.atom
      let base
      if (atom.type === "group") base = genGroup(atom)
      else base = gen(atom)

      if (atom.type === "backref") {
        const value = args[`param_${atom.index}`]
        if (value !== undefined && value !== null && value !== "") {
          return { text: String(value), usedArg: true }
        }
        return { text: "", usedArg: false }
      }
      if (atom.type === "namedBackref") {
        const value = args[AIToolRegistry._sanitizeParamName(atom.name)]
        if (value !== undefined && value !== null && value !== "") {
          return { text: String(value), usedArg: true }
        }
        return { text: "", usedArg: false }
      }

      if (atom.type === "group" && base.usedArg) return base
      if (!term.quant) return base

      if (term.quant.kind === "*") return { text: "", usedArg: base.usedArg }
      if (term.quant.kind === "?") {
        return { text: base.usedArg ? base.text : "", usedArg: base.usedArg }
      }
      if (term.quant.kind === "+") return base.text ? base : { text: "a", usedArg: false }

      const count = term.quant.min
      if (base.usedArg) return base
      return {
        text: base.text ? base.text.repeat(count) : count > 0 ? "a".repeat(count) : "",
        usedArg: false,
      }
    }

    const gen = node => {
      if (!node) return { text: "", usedArg: false }
      switch (node.type) {
        case "seq": {
          let text = ""
          let usedArg = false
          for (const term of node.terms) {
            const result = genTerm(term)
            text += result.text
            usedArg ||= result.usedArg
          }
          return { text, usedArg }
        }
        case "alt":
          return gen(node.options[0])
        case "group":
          return genGroup(node)
        case "term":
          return genTerm(node)
        case "charClass":
          return { text: pickCharClass(node), usedArg: false }
        case "literal":
          return { text: node.value, usedArg: false }
        case "empty":
          return { text: "", usedArg: false }
        default:
          return { text: "", usedArg: false }
      }
    }

    return gen(parsed.ast).text
  }

  static _testRegex(reg, text) {
    try {
      const regex = reg instanceof RegExp ? new RegExp(reg.source, reg.flags.replace(/g/g, "")) : new RegExp(reg)
      return regex.test(text)
    } catch {
      return false
    }
  }

  static _sanitizeParamName(name) {
    return String(name || "")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64) || "arg"
  }

  static _extractParams(parsed) {
    const schema = { type: "object", properties: {}, required: [] }
    if (!parsed?.groups?.length) {
      schema.properties.content = {
        type: "string",
        description: "命令后要附加的内容（路径、文本、关键词等），按工具说明填写",
      }
      return { schema, desc: "content: 命令后附加的内容" }
    }

    const descriptionOf = node => {
      const options = AIToolRegistry._literalOptions(node.body)

      if (options) return { description: `可选值: ${options.join(", ")}`, enum: options, literal: true }

      const bodyText = AIToolRegistry._bodyText(node.body)
      if (/^\\?d[+*]?$|^\d[+*]?$/.test(bodyText) || /digit|数字/.test(bodyText)) {
        return { description: "数字" }
      }
      if (/群号|QQ|qq/.test(node.name || "")) return { description: "QQ号或群号" }
      return { description: "文本参数" }
    }

    for (const group of parsed.groups) {
      const info = descriptionOf(group)

      const key = group.name
        ? AIToolRegistry._sanitizeParamName(group.name)
        : `param_${group.index}`
      const prop = { type: "string", description: info.description }
      if (info.enum) prop.enum = info.enum
      schema.properties[key] = prop
      if (!info.literal && !group.optional && !AIToolRegistry._canBeEmpty(group.body)) schema.required.push(key)
    }

    return { schema, desc: Object.values(schema.properties).map(p => p.description).join(", ") }
  }

  static _canBeEmpty(node) {
    if (!node) return true
    if (node.type === "empty") return true
    if (node.type === "literal") return node.value === ""
    if (node.type === "charClass") return false
    if (node.type === "seq") return node.terms.every(term => AIToolRegistry._canBeEmptyTerm(term))
    if (node.type === "alt") return node.options.some(option => AIToolRegistry._canBeEmpty(option))
    if (node.type === "group") return AIToolRegistry._canBeEmpty(node.body)
    if (node.type === "term") return AIToolRegistry._canBeEmptyTerm(node)
    return true
  }

  static _canBeEmptyTerm(term) {
    if (term?.quant?.min === 0) return true
    return AIToolRegistry._canBeEmpty(term?.atom)
  }

  static _literalOptions(node) {
    if (!node) return null
    const literalOf = seq => {
      if (seq?.type !== "seq") return null
      let text = ""
      for (const term of seq.terms) {
        if (term.quant) return null
        if (term.atom?.type === "literal") text += term.atom.value
        else if (term.atom?.type === "charClass") return null
        else return null
      }
      return text || null
    }
    if (node.type === "alt") {
      const values = node.options.map(literalOf)
      if (values.every(value => value !== null)) return values
      return null
    }
    const single = literalOf(node)
    return single ? [single] : null
  }

  static _bodyText(node) {
    if (!node) return ""
    if (node.type === "literal") return node.value
    if (node.type === "charClass") return node.content
    if (node.type === "empty") return ""
    if (node.type === "alt") return node.options.map(option => AIToolRegistry._bodyText(option)).join("|")
    if (node.type === "seq") return node.terms.map(term => AIToolRegistry._bodyText(term.atom)).join("")
    if (node.type === "group") return AIToolRegistry._bodyText(node.body)
    return ""
  }

  static hasPermission(
    e,
    permission,
    allowMasterTools = aiAdmin.toolConfig.allowMasterTools !== false,
  ) {
    if (!permission || permission === "all" || permission === "everyone") return true
    if (permission === "master" && allowMasterTools === false) return false
    if (e?.isMaster) return true
    if (permission === "master") return false
    if (!e?.isGroup || !e?.member) return false
    if (permission === "owner") return !!e.member.is_owner
    if (permission === "admin") return !!(e.member.is_owner || e.member.is_admin)

    return false
  }

  static _eventMatches(tool, e) {
    const event = tool.event
    if (!event || !e?.post_type) return true
    const parts = String(event).split(".")
    const keys = {
      message: ["post_type", "message_type", "sub_type"],
      notice: ["post_type", "notice_type", "sub_type"],
      request: ["post_type", "request_type", "sub_type"],
    }[e.post_type] || ["post_type"]
    return parts.every((part, index) => part === "*" || String(e[keys[index]] ?? "") === part)
  }

  static _isVisible(tool, e, preset = null) {
    const aiCfg = cfg.ai || {}
    const adminConfig = aiAdmin.toolConfig

    const names = [tool.name, tool.sourceName].filter(Boolean).map(String)
    const isDisabled = list => names.some(name => (list || []).map(String).includes(name))
    const pluginNames = [tool.pluginName]
    if (tool.pluginKey?.startsWith("mcp:") && !tool.pluginKey.startsWith("mcp:builtin")) {
      const server = aiAdmin.list("mcpServers").find(item => `mcp:${item.id}` === tool.pluginKey)
      if (server?.name) pluginNames.push(`MCP · ${server.name}`, server.name)
    }
    const isPluginDisabled = list =>
      pluginNames.some(name => (list || []).map(String).includes(String(name)))

    if (tool.name === "persona_edit" && aiAdmin.memoryConfig?.allowSelfPersonaEdit !== true) return false
    if (isDisabled(aiCfg.disabledTools)) return false
    if (isPluginDisabled(aiCfg.disabledToolPlugins)) return false
    if (isDisabled(adminConfig.disabledTools)) return false
    if (isPluginDisabled(adminConfig.disabledToolPlugins)) return false
    if (!AIToolRegistry._passesPreset(tool, preset)) return false
    if (adminConfig.freeToolsOnly && !e?.isMaster) {
      const permission = String(tool.permission || "all")
      if (permission !== "all" && permission !== "everyone") return false
    }

    if (e?.isGroup) {
      const group = aiAdmin.getGroup(e.group_id)
      if (group) {
        if (group.enabled === false) return false
        if (isDisabled(group.disabledTools)) return false
        if (isPluginDisabled(group.disabledToolPlugins)) return false
      }
    }

    if (!AIToolRegistry._eventMatches(tool, e)) return false
    if (tool.needsGroup && !e?.isGroup) return false
    if (!AIToolRegistry.hasPermission(e, tool.permission, adminConfig.allowMasterTools !== false)) return false
    return true
  }

  static _tokenize(text) {
    const value = String(text || "").toLowerCase()
    const tokens = new Set()
    for (const match of value.matchAll(/[a-z0-9_]{2,}/g)) tokens.add(match[0])
    for (const segment of value.match(/[\u3400-\u9fff]+/g) || []) {
      for (let i = 0; i < segment.length; i++) {
        const char = segment[i]
        if (!STOP_CHARS.has(char)) tokens.add(char)
        if (i + 1 < segment.length) tokens.add(segment.slice(i, i + 2))
      }
    }
    return [...tokens]
  }

  static _scoreTool(tool, tokens) {
    if (!tokens.length) return 0
    const name = tool.name.toLowerCase()

    const source = String(tool.sourceName || "").toLowerCase()
    const plugin = String(tool.pluginName || "").toLowerCase()
    const description = String(tool.description || "").toLowerCase()
    let score = 0
    for (const token of tokens) {
      const single = token.length <= 1
      const weight = single ? 0.35 : 1
      if (name.includes(token)) score += 8 * weight
      else if (source.includes(token)) score += 6 * weight
      if (plugin.includes(token)) score += 4 * weight

      if (!single && description.includes(token)) score += 2 * weight
    }
    return score
  }

  static getOpenAITools(e, query = "", limit, preset = null) {
    const aiCfg = cfg.ai || {}
    const configuredMax = aiAdmin.toolConfig.maxToolsPerRequest ?? aiCfg.maxToolsPerRequest
    const max = limit ?? (Number(configuredMax) || 0)
    const tokens = AIToolRegistry._tokenize(query)

    const scored = []
    for (const tool of AIToolRegistry.tools.values()) {
      if (!AIToolRegistry._isVisible(tool, e, preset)) continue
      scored.push({ tool, score: AIToolRegistry._scoreTool(tool, tokens) })
    }

    scored.sort(
      (a, b) =>
        b.score - a.score ||
        (a.tool.priority ?? 5000) - (b.tool.priority ?? 5000) ||
        a.tool.name.localeCompare(b.tool.name),
    )

    let selected = scored
    if (max > 0) {
      const selectedNames = new Set()
      const picked = []
      const add = list => {
        for (const item of list) {
          if (selectedNames.has(item.tool.name)) continue
          selectedNames.add(item.tool.name)
          picked.push(item)
          if (picked.length >= max) break
        }
      }

      add(scored.filter(item => item.tool.handler))

      add(scored.filter(item => item.score > 0))

      const fillTarget = tokens.length ? Math.min(max, Math.max(16, picked.length)) : max
      if (picked.length < fillTarget) add(scored)

      selected = picked.slice(0, max)
    }

    return selected.map(({ tool }) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }))
  }

  static resolveToolName(name) {
    const raw = String(name || "")
    if (!raw) return ""
    if (AIToolRegistry.tools.has(raw)) return raw
    const exposed = AIToolRegistry._exposedName(raw)
    return AIToolRegistry.tools.has(exposed) ? exposed : ""
  }

  static getOpenAIToolsByName(names, e, preset = null) {
    const list = []
    const seen = new Set()
    for (const raw of names || []) {
      const name = String(raw || "")
      if (!name || seen.has(name)) continue
      const tool = AIToolRegistry.tools.get(name)
      if (!tool) {
        if (/poke/.test(name)) Bot.makeLog("debug", [`工具 ${name} 不在 tools 映射里`], "AITool")
        continue
      }
      if (!AIToolRegistry._isVisible(tool, e, preset)) {
        if (/poke/.test(name))
          Bot.makeLog("debug", [
            `工具 ${name} 被可见性过滤: perm=${tool.permission} presetToolPerm=${preset?.toolPermission} danger=${tool.danger} presetMaxDanger=${preset?.maxDangerLevel} needsGroup=${tool.needsGroup} isGroup=${!!e?.isGroup} event=${tool.event}`,
          ], "AITool")
        continue
      }
      seen.add(name)
      list.push({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })
    }
    return list
  }

  static searchTools(query, e, preset = null, limit = 8) {
    const max = Math.max(1, Math.min(20, Number(limit) || 8))
    const tokens = AIToolRegistry._tokenize(query)
    const scored = []
    for (const tool of AIToolRegistry.tools.values()) {
      const sourceName = String(tool.sourceName || tool.name || "")
      if (sourceName === "tool_search" || tool.name === "tool_search") continue
      if (!AIToolRegistry._isVisible(tool, e, preset)) continue
      scored.push({ tool, score: AIToolRegistry._scoreTool(tool, tokens) })
    }
    scored.sort(
      (a, b) =>
        b.score - a.score ||
        (a.tool.priority ?? 5000) - (b.tool.priority ?? 5000) ||
        a.tool.name.localeCompare(b.tool.name),
    )
    const matched = tokens.length ? scored.filter(item => item.score > 0) : []

    const picked = tokens.length ? matched.slice(0, max) : scored.slice(0, max)
    return picked.map(({ tool }) => ({
      name: tool.name,
      description: AIToolRegistry._truncate(String(tool.description || "").split("\n")[0], 100),
      args: AIToolRegistry._paramHint(tool),
    }))
  }

  static _paramHint(tool) {
    const params = tool?.parameters || {}
    const props = params.properties || {}
    const required = new Set(params.required || [])
    return Object.keys(props)
      .map(name => `${name}${required.has(name) ? "*" : "?"}`)
      .join(",")
  }

  static getToolPrompt(e, query = "", preset = null) {
    const tools = AIToolRegistry.getOpenAITools(e, query, undefined, preset)
    if (!tools.length) return ""
    const lines = ["你可以使用以下命令来帮助用户："]
    for (const tool of tools) lines.push(`- ${tool.function.name}: ${tool.function.description}`)
    return lines.join("\n")
  }

  static _normalizeArgs(args) {
    if (typeof args === "string") {
      try {
        args = JSON.parse(args)
      } catch {
        args = {}
      }
    }
    return args && typeof args === "object" && !Array.isArray(args) ? args : {}
  }

  static async executeTool(toolName, args, e, preset = null) {
    const exposed = AIToolRegistry.tools.get(AIToolRegistry.resolveToolName(toolName))
    if (!exposed) {
      return { success: false, error: `工具 "${toolName}" 不存在，请检查工具名称是否正确。` }
    }
    if (!AIToolRegistry._isVisible(exposed, e, preset)) {
      const presetBlocked = !!preset && !AIToolRegistry._passesPreset(exposed, preset)
      Bot.makeLog("warn", [
        `工具调用被拒绝 [${toolName}]`,
        `用户: ${e?.user_id}`,
        `权限: ${exposed.permission}`,
        `危险等级: ${exposed.danger}`,
        preset ? `预设: ${preset.name}` : "",
      ], "AITool")
      return {
        success: false,
        error: presetBlocked
          ? `操作被拒绝: 当前预设「${preset.name}」的工具权限或危险等级上限不允许调用 "${exposed.pluginName}"。`
          : `操作被拒绝: 当前用户无权使用 "${exposed.pluginName}"。`,
      }
    }

    const source = AIToolRegistry.sources.get(exposed.sourceName)
    if (!source) return { success: false, error: `工具 "${toolName}" 的实现已卸载。` }

    const context = preset ? Object.assign(Object.create(e || null), { __preset: preset }) : e
    let timer
    try {
      const result = await Promise.race([
        AIToolRegistry._callExposed(exposed, args, context),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`工具执行超时（${Math.round(TOOL_CALL_TIMEOUT / 1000)} 秒）`)),
            TOOL_CALL_TIMEOUT,
          )
          timer.unref?.()
        }),
      ])
      return { ...result, toolName }
    } catch (err) {
      Bot.makeLog("error", ["工具执行超时或失败", `[${toolName}]`, err.message], "AITool")
      return { success: false, error: err.message, toolName }
    } finally {
      clearTimeout(timer)
    }
  }

  static _callExposed(exposed, args, e) {
    if (exposed.direct) return AIToolRegistry.executeSourceTool(exposed.sourceName, args, e)
    if (exposed.pluginKey === "mcp:builtin" && AIToolRegistry.builtinCaller) {
      return AIToolRegistry.builtinCaller(exposed.name, args, e)
    }
    return AIToolRegistry.executeSourceTool(exposed.sourceName, args, e)
  }

  static async executeSourceTool(sourceName, args, e) {
    const tool = AIToolRegistry.sources.get(sourceName)
    if (!tool) return { success: false, error: `工具 "${sourceName}" 不存在。` }

    if (e && !AIToolRegistry._isVisible(tool, e, null))
      return { success: false, error: `无权使用工具 ${sourceName}` }

    args = AIToolRegistry._normalizeArgs(args)
    const validation = AIToolRegistry._validateParams(tool, args)
    if (!validation.valid) {
      Bot.makeLog("warn", [
        `工具调用被拒绝 [${sourceName}]`,
        `原因: ${validation.error}`,
        `参数: ${JSON.stringify(args)}`,
      ], "AITool")
      return { success: false, error: validation.error }
    }

    if (tool.handler) {
      try {
        Bot.makeLog("debug", [`AI 调用原始工具 [${sourceName}]`, `参数: ${JSON.stringify(args)}`], "AITool")
        const result = await tool.handler(args, e)
        const failed = result?.success === false
        const text =
          typeof result === "string"
            ? result
            : result?.result !== undefined
              ? String(result.result ?? "")
              : AIToolRegistry._formatValue(result)
        return AIToolRegistry._limitResult({
          success: !failed,
          toolName: sourceName,
          result: text,
          ...(failed && result?.error ? { error: String(result.error) } : {}),
        })
      } catch (err) {
        Bot.makeLog("error", [`原始工具执行错误 [${sourceName}]`, err.message], "AITool")
        return { success: false, error: `工具执行失败: ${err.message}`, toolName: sourceName }
      }
    }

    let mockMsg
    try {
      mockMsg = AIToolRegistry._buildMockMessage(tool, args)
    } catch (err) {
      return { success: false, error: `参数无法转换为命令: ${err.message}`, toolName: sourceName }
    }
    if (!mockMsg || !AIToolRegistry._testRegex(tool.rule.reg, mockMsg)) {
      Bot.makeLog("warn", [
        `工具参数无法生成有效命令 [${sourceName}]`,
        `参数: ${JSON.stringify(args)}`,
        `生成: ${mockMsg}`,
      ], "AITool")
      return {
        success: false,
        error: `参数无法组合成有效命令，请检查参数格式。工具: ${sourceName}`,
        toolName: sourceName,
      }
    }

    const event = AIToolRegistry._cloneEvent(e)
    const replies = []
    event.reply = async (msg = "") => {
      const text = AIToolRegistry._formatValue(msg)
      if (text) replies.push(text)
      return { message_id: 0, fake: true }
    }
    event.msg = mockMsg
    event.raw_message = mockMsg
    if (e?.message) event.message = [{ type: "text", text: mockMsg }]

    try {
      const instance = new tool.classRef(event)
      instance.e = event
      Bot.makeLog("debug", [
        `AI 调用工具 [${sourceName}]`,
        `参数: ${JSON.stringify(args)}`,
        `模拟消息: ${mockMsg}`,
      ], "AITool")

      const result = await instance[tool.fnc](event)
      const success = result !== false

      const replyText = replies.slice(0, 10).join("\n")
      const returnText = success ? AIToolRegistry._formatValue(result) : ""
      const content = replyText || returnText
      return AIToolRegistry._limitResult({
        success,
        toolName: sourceName,
        result: content,
        replies: replies.slice(0, 10),
        ...(success ? {} : { error: "插件拒绝执行或当前条件不满足" }),
      })
    } catch (err) {
      Bot.makeLog("error", [`工具执行错误 [${sourceName}]`, err.message], "AITool")
      return { success: false, error: `工具执行失败: ${err.message}`, toolName: sourceName }
    }
  }

  static _validateParams(tool, args) {
    const schema = tool.parameters || {}
    const properties = schema.properties || {}

    const required = Array.isArray(schema.required) ? schema.required : []

    for (const name of required) {
      const value = args[name]
      if (value === undefined || value === null || value === "") {
        return {
          valid: false,
          error: `缺少必填参数: ${properties[name]?.description || name}`,
        }
      }
    }

    for (const [name, propDef] of Object.entries(properties)) {
      const value = args[name]
      if (value === undefined) continue
      const expected = String(propDef?.type || "")

      const typeError = AIToolRegistry._checkType(name, value, expected)
      if (typeError) return { valid: false, error: typeError }
      if (propDef.enum && !propDef.enum.includes(String(value))) {
        return {
          valid: false,
          error: `参数 "${name}" 的值无效，可选值: ${propDef.enum.join(", ")}`,
        }
      }
      if (typeof value === "string" && value.length > 4000) {
        return { valid: false, error: `参数 "${name}" 过长（最多 4000 字）` }
      }

      if (value && typeof value === "object") {
        const size = JSON.stringify(value).length
        if (size > 8000) return { valid: false, error: `参数 "${name}" 内容过大` }
      }
    }

    return { valid: true }
  }

  static _checkType(name, value, expected) {
    if (!expected) return ""
    if (expected === "string") {
      if (typeof value === "string") return ""
      if (typeof value === "number" || typeof value === "boolean") return ""
      return `参数 "${name}" 应为文本`
    }
    if (expected === "integer" || expected === "number") {
      if (typeof value === "number" && Number.isFinite(value)) return ""
      if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) return ""
      return `参数 "${name}" 应为数字`
    }
    if (expected === "boolean") {
      if (typeof value === "boolean") return ""
      if (["true", "false", "1", "0"].includes(String(value).toLowerCase())) return ""
      return `参数 "${name}" 应为布尔值`
    }
    if (expected === "array") {
      return Array.isArray(value) ? "" : `参数 "${name}" 应为数组`
    }
    if (expected === "object") {
      return value && typeof value === "object" && !Array.isArray(value)
        ? ""
        : `参数 "${name}" 应为对象`
    }
    return ""
  }

  static _buildMockMessage(tool, args) {
    if (!tool.rule?.reg) return ""
    const parsed = tool._parsed || AIToolRegistry._parseRegex(tool.rule.reg)
    const normalized = AIToolRegistry._normalizeArgs(args)
    const base = AIToolRegistry._generateSample(parsed, args).trim()
    if (parsed?.groups?.length) return base

    const extra = String(normalized.content ?? "").trim()
    if (!extra) return base

    const head = base.length > 1 && /[a0中]$/.test(base) ? base.slice(0, -1) : base
    return `${head} ${extra}`.trim()
  }

  static _cloneEvent(e) {
    const event = Object.assign(Object.create(Object.getPrototypeOf(e) || null), e)
    for (const key of ["isMaster", "only_reply_at", "isSr", "isGs", "hasAlias", "atBot"]) {
      if (key in e) {
        try {
          event[key] = e[key]
        } catch {}
      }
    }
    return event
  }

  static _formatValue(value) {
    if (value === null || value === undefined) return ""
    if (typeof value === "string") return value
    if (typeof value === "boolean") return value ? "执行成功" : "执行失败"
    if (typeof value === "number") return String(value)
    if (Array.isArray(value)) return value.map(item => AIToolRegistry._formatValue(item)).filter(Boolean).join("\n")
    if (typeof value === "object") {
      if (value.type === "text") return value.text || value.data?.text || ""
      if (value.type === "image") return "[图片]"
      if (value.type === "record") return "[语音]"
      if (value.type === "video") return "[视频]"
      if (value.type === "face") return "[表情]"
      if (value.type === "at") return `[At:${value.qq || value.data?.qq || ""}]`
      if (value.type === "reply") return ""
      if (value.type === "file") return `[文件:${value.name || value.file || ""}]`
      if (value.type === "node")
        return (Array.isArray(value.data) ? value.data : [value.data])
          .map(node => AIToolRegistry._formatValue(node?.message ?? node?.data?.content))
          .filter(Boolean)
          .join("\n")
      try {
        const text = JSON.stringify(value)
        return text === "{}" ? "" : text
      } catch {
        return String(value)
      }
    }
    return String(value)
  }

  static _limitResult(payload) {
    const configured = aiAdmin.toolConfig.toolResultMaxLength ?? cfg.ai?.toolResultMaxLength
    if (configured === 0 || configured === "0") return payload
    const max = Number(configured) || TOOL_RESULT_MAX
    if (payload.result) payload.result = AIToolRegistry._shrinkResult(payload.result, max)
    if (payload.replies) {
      payload.replies = payload.replies
        .slice(0, 10)
        .map(reply => AIToolRegistry._shrinkResult(reply, max))
    }
    return payload
  }

  static _shrinkResult(payload, max) {
    const value = String(payload ?? "")
    if (value.length <= max) return value
    let data = null
    try {
      data = JSON.parse(value)
    } catch {
      return AIToolRegistry._truncate(value, max)
    }
    const trimText = (text, limit) => (String(text).length > limit ? `${String(text).slice(0, limit)}…` : String(text))
    const shrinkItem = (item, perEntry) => {
      if (!item || typeof item !== "object") return item
      const next = { ...item }
      for (const key of ["content", "description", "title", "event", "lessons", "note", "result", "message"]) {
        if (typeof next[key] === "string") next[key] = trimText(next[key], perEntry)
      }
      if (Array.isArray(next.tags)) next.tags = next.tags.slice(0, 8)
      return next
    }

    const arrayKey =
      Array.isArray(data)
        ? null
        : data && typeof data === "object"
          ? ["results", "entries", "tools", "stickers", "memories", "items"].find(name => Array.isArray(data[name]))
          : undefined
    const getItems = () => (Array.isArray(data) ? data : arrayKey ? data[arrayKey] : null)
    const setItems = items => {
      if (Array.isArray(data)) data = items
      else if (arrayKey) data[arrayKey] = items
    }

    for (const perEntry of [Math.max(200, Math.floor(max / 8)), 400, 240, 160, 100, 60]) {
      const items = getItems()
      if (!items) break
      setItems(items.map(item => shrinkItem(item, perEntry)))
      const candidate = JSON.stringify(data)
      if (candidate.length <= max) return candidate
    }
    const items = getItems()
    if (items) {
      let keep = items.length
      while (keep > 1) {
        keep = Math.max(1, Math.floor(keep * 0.7))
        setItems(items.slice(0, keep).map(item => shrinkItem(item, 200)))
        const candidate = JSON.stringify(data)
        if (candidate.length <= max) return candidate
      }
    }
    return AIToolRegistry._truncate(JSON.stringify(data), max)
  }

  static _truncate(text, max) {
    const value = String(text ?? "")
    return value.length > max ? `${value.slice(0, max)}…` : value
  }

  static unregisterPlugin(key) {
    let count = 0
    for (const [name, tool] of AIToolRegistry.sources) {
      if (tool.pluginKey === key) {
        AIToolRegistry.sources.delete(name)
        AIToolRegistry.toolToPlugin.delete(name)
        count++
      }
    }
    if (count > 0) {
      AIToolRegistry._refreshExposedTools()
      Bot.makeLog("debug", `注销 AI 工具 [${key}] ${count} 个`, "AITool")
    }
    return count
  }

  static getStats() {
    return {
      totalTools: AIToolRegistry.sources.size,
      exposedTools: AIToolRegistry.tools.size,
      skipped: AIToolRegistry.stats.skipped,
      collisions: AIToolRegistry.stats.collisions,
      plugins: new Set([...AIToolRegistry.sources.values()].map(tool => tool.pluginKey)).size,
      tools: Array.from(AIToolRegistry.sources.values()).map(tool => ({
        name: tool.name,
        description: tool.description || "",
        plugin: tool.pluginName,
        fnc: tool.fnc,
        permission: tool.permission,
        danger: tool.danger,
        needsGroup: tool.needsGroup,
        event: tool.event,
        direct: AIToolRegistry._isDirectTool(tool),
        mcpName: AIToolRegistry._isDirectTool(tool) ? tool.name : AIToolRegistry._exposedName(tool.name),
      })),
    }
  }
}
