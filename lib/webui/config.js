import fs from "node:fs"
import path from "node:path"
import YAML from "yaml"
import { pathToFileURL } from "node:url"
import cfg from "../config/config.js"
import { pendingRemovalNames } from "./pluginPendingRemove.js"

const CONFIG_DIR = path.join(process.cwd(), "config/config")
const DEFAULT_CONFIG_DIR = path.join(process.cwd(), "config/default_config")
const PLUGINS_DIR = path.join(process.cwd(), "plugins")

const SKIP = Symbol("skip")
const SECRET_RE =
  /^(api[_-]?key|apikey|password|passwd|pass|token|access[_-]?token|refresh[_-]?token|secret|client[_-]?secret|authorization|auth|cookie|ck|pubck)$/i

const CORE_ORDER = ["ai", "bot", "other", "webui"]
// ai.yaml 由「AI」分组的设置/工具配置托管，help.yaml 由「帮助面板」托管，都不在基础/其他配置重复列出
const HIDDEN_BASIC = new Set(["ai"])
const HIDDEN_OTHER = new Set(["help"])
const OTHER_ORDER = ["server", "redis", "db", "renderer", "milky", "satori"]

const CORE_FILE_META = {
  ai: ["AI 参数", "由「AI」分组的设置与工具配置托管。"],
  bot: ["Bot 基础", "日志、插件加载、文件监控、定时任务与浏览器设置。"],
  other: ["账号与安全", "主人账号、自动处理、黑白名单与私聊策略。"],
  webui: ["WebUI", "访问路径、令牌与本地控制台策略。"],
  server: ["HTTP 服务", "Bot 监听端口、默认跳转与整体鉴权。"],
  redis: ["Redis", "连接地址、凭据与数据库编号。"],
  db: ["数据库", "Sequelize 方言与 SQLite 存储位置。"],
  renderer: ["渲染器", "图片渲染后端选择。"],
  milky: ["Milky 适配器", "Milky 协议连接与 WebHook 设置。"],
  satori: ["Satori 适配器", "Satori 协议终结点与鉴权。"],
  help: ["帮助面板", "帮助面板的标题、外观、皮肤与功能分组。"],
}

// ai.yaml 的开关、触发、采样等参数都是每次请求实时读取，保存后下一轮对话即生效；
// 只有渠道密钥与模型需要重建客户端，由「AI 管理」页单独触发，故不算需重启项
const RESTART_REQUIRED = new Set(["webui", "server", "redis", "db", "renderer", "milky", "satori"])
const PROTECTED_WEBUI_FIELDS = new Set(["enable", "path", "token", "allowWrite"])
// 这两项由「其他配置 → 状态图」卡片管理，基础配置的文件视图里不再重复出现
const MANAGED_ELSEWHERE = {
  webui: new Set(["statusImageScale", "statusProForAll"]),
}

const CORE_TYPE_OVERRIDES = {
  "bot.update_cron": "string",
  "bot.restart_cron": "string",
  "bot.stop_cron": "string",
  "bot.start_cron": "string",
  "bot.chromium_path": "string",
  "bot.puppeteer_ws": "string",
  "other.masterQQ": "array",
  "other.master": "array",
  "other.whiteGroup": "array",
  "other.whiteUser": "array",
  "other.blackGroup": "array",
  "other.blackUser": "array",
  "server.auth": "string",
  "server.https": "object",
  "redis.username": "string",
  "redis.password": "string",
  "milky.access_token": "string",
  "milky.webhook": "object",
  "milky.ws": "object",
  "satori.token": "string",
  "ai.freeIgnorePrefixes": "array",
  "ai.triggerKeywords": "array",
  "ai.disabledTools": "array",
  "ai.disabledToolPlugins": "array",
}

// 列表为空时替换默认的「尚未添加，在下方输入后回车」提示
const CORE_EMPTY_HINTS = {
  "webui.loginCommands": "留空默认 #云崽登录，添加后默认不再响应",
}
const CORE_OPTIONS = {
  "bot.log_level": ["trace", "debug", "info", "warn", "fatal", "mark", "error", "off"].map(value => ({
    value,
    label: value,
  })),
  "ai.groupTrigger": [
    { value: "", label: "（旧版，改用上面的开关）" },
    { value: "at", label: "仅 @ 机器人" },
    { value: "prefix", label: "仅前缀触发" },
    { value: "atOrPrefix", label: "@ 或前缀" },
    { value: "free", label: "自由判断" },
    { value: "all", label: "所有消息" },
    { value: "none", label: "不响应" },
  ],
  "db.dialect": ["sqlite", "mysql", "postgres", "mariadb", "mssql", "db2"].map(value => ({
    value,
    label: value,
  })),
}

const GROUP_NUMERIC = new Set(["groupCD", "singleCD", "addRecall"])
const GROUP_ARRAY = new Set(["botAlias", "enable", "disable", "disabledBots"])
const FEATURE_LIST_FIELDS = new Set(["enable", "disable"])
const BOT_LIST_FIELDS = new Set(["disabledBots"])
const GROUP_BINARY = new Set(["addPrivate", "addReply", "addAt"])
const GROUP_OPTIONS = {
  onlyReplyAt: [
    { value: 0, label: "否" },
    { value: 1, label: "是" },
    { value: 2, label: "是，主人否" },
  ],
  addLimit: [
    { value: 0, label: "所有群员" },
    { value: 1, label: "群管理员" },
    { value: 2, label: "主人" },
  ],
}

const guobaCache = new Map()

export class ConfigError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

const isPlainObject = value => !!value && typeof value === "object" && !Array.isArray(value)
const pathKey = pathList => JSON.stringify(pathList.map(String))
const joinPath = pathList => pathList.join(".")

function hasOwnPath(object, pathList) {
  let current = object
  for (const segment of pathList) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, segment)) return false
    current = current[segment]
  }
  return true
}

function getValueAt(object, pathList) {
  let current = object
  for (const segment of pathList) {
    if (current === null || typeof current !== "object") return undefined
    current = current[segment]
  }
  return current
}

function countLeaves(value) {
  if (isPlainObject(value)) return Object.values(value).reduce((sum, item) => sum + countLeaves(item), 0)
  return 1
}

function normalizeId(value, label) {
  const text = String(value ?? "").trim()
  if (!text) return ""
  // 官机群号形如「机器人号<U+F03A>群openid」，分隔符是私用区字符
  if (!/^[\dA-Za-z_:.\uF03A\uFF1A-]{3,80}$/.test(text)) throw new ConfigError(`${label}格式无效`)
  return text
}

function parseDocument(text, file) {
  const doc = YAML.parseDocument(text || "")
  if (doc.errors.length)
    throw new ConfigError(`配置文件解析失败：${file} - ${doc.errors[0]?.message || "YAML 格式错误"}`, 500)
  return doc
}

function readDocument(file, fallbackText = "") {
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : fallbackText
  return { text, doc: parseDocument(text, file) }
}

function collectInlinePaths(text) {
  const paths = new Set()
  const stack = []

  for (const rawLine of String(text || "").split(/\r?\n/)) {
    if (!rawLine.trim() || /^\s*#/.test(rawLine)) continue
    const match = rawLine.match(/^(\s*)(.+?):(?:\s|$)/)
    if (!match) continue

    const indent = match[1].length
    const key = stripQuotes(match[2].trim())
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    const keyPath = [...stack.map(item => item.key), key].join(".")
    const rest = rawLine.slice(match[0].length - 1)
    if (/^\s*#/.test(rest)) paths.add(keyPath)
    stack.push({ indent, key })
  }

  return paths
}

function normalizeComments(node, pathList, inlinePaths) {
  if (YAML.isMap(node)) {
    const items = node.items
    for (let i = 0; i < items.length; i++) {
      const pair = items[i]
      const key = pair.key
      const value = pair.value
      const fullPath = [...pathList, String(key?.value ?? "")]
      const pathKey = fullPath.join(".")

      if (value?.comment) {
        if (YAML.isMap(value) || YAML.isSeq(value)) {
          key.comment = key.comment ? `${key.comment} ${value.comment}` : value.comment
          value.comment = undefined
        } else if (value.value === null || value.value === undefined) {
          if (inlinePaths.has(pathKey)) {
            key.comment = key.comment ? `${key.comment} ${value.comment}` : value.comment
            value.comment = undefined
          } else if (i + 1 < items.length) {
            const comment = value.comment
            value.comment = undefined
            const nextKey = items[i + 1].key
            nextKey.commentBefore = nextKey.commentBefore ? `${comment}\n${nextKey.commentBefore}` : comment
            nextKey.spaceBefore = false
          }
        }
      }

      normalizeComments(value, fullPath, inlinePaths)
    }
  } else if (YAML.isSeq(node)) {
    for (const item of node.items) normalizeComments(item, pathList, inlinePaths)
  }
}

function writeDocument(file, doc) {
  let source = ""
  try {
    if (fs.existsSync(file)) source = fs.readFileSync(file, "utf8")
  } catch {}
  normalizeComments(doc.contents, [], collectInlinePaths(source))

  let text = doc.toString({ lineWidth: 0 })
  if (!text.endsWith("\n")) text += "\n"
  const check = YAML.parseDocument(text)
  if (check.errors.length) throw new ConfigError("生成的配置内容无效，已取消保存", 500)
  fs.writeFileSync(file, text, "utf8")
}

export function invalidateConfigCache(name) {
  try {
    const store = cfg.config
    if (!store || typeof store !== "object") return
    delete store[`config.${name}`]
    delete store[`default_config.${name}`]
  } catch {}
}

function extractComments(text) {
  const comments = new Map()
  const stack = []
  let pending = []

  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const trimmed = rawLine.trim()
    if (!trimmed) {
      pending = []
      continue
    }
    if (trimmed.startsWith("#")) {
      const body = trimmed.replace(/^#+\s?/, "").trim()
      if (!body) continue
      if (/^[-=*_~#]{3,}/.test(body) || /^[=\-_*~#\s]+$/.test(body) || /^=+\s*.+\s*=+$/.test(body)) {
        pending = []
        continue
      }
      pending.push(body)
      continue
    }

    const match = rawLine.match(/^(\s*)(.+?):(?:\s|$)/)
    if (!match) {
      pending = []
      continue
    }

    const indent = match[1].length
    const key = stripQuotes(match[2].trim())
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    const keyPath = [...stack.map(item => item.key), key].join(".")
    const inline = rawLine.match(/\s#\s*(.+)$/)
    const comment = pending.length ? pending.join(" ") : inline ? inline[1].trim() : ""
    if (comment && !comments.has(keyPath)) comments.set(keyPath, comment)

    pending = []
    stack.push({ indent, key })
  }

  return comments
}

function stripQuotes(value) {
  const text = String(value)
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))
    return text.slice(1, -1)
  return text
}

function humanizeKey(key) {
  return String(key)
    .replace(/[_-]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .trim()
}

function commentToLabel(comment, key) {
  const text = String(comment || "").replace(/\s+/g, " ").trim()
  if (!text) return humanizeKey(key)
  const clause = text
    .split(/[，。；：]/)[0]
    .replace(/[（(]([^）)]*)[）)]/g, (match, inner) =>
      inner.length <= 6 && !/^(例如|如|可选|默认|0)/.test(inner) ? match : "",
    )
    .replace(/[（(][^）)]*$/, "")
    .replace(/\s*(例如|如)[:：].*$/, "")
    .trim()
  if (clause.length >= 2 && clause.length <= 26) return clause
  const trimmed = clause.replace(/\s+[A-Za-z0-9_./+*#-].*$/, "").trim()
  if (trimmed.length >= 2 && trimmed.length <= 26) return trimmed
  return humanizeKey(key)
}

function fieldNeedsRestart(fileName, pathList, kind) {
  // 只有 webui.yaml 需要逐字段标注：其中只有访问路径要重启，其余热生效。
  // 其他文件是整份都要重启，卡片标题已统一提示，不必每个字段重复挂标记。
  if (kind !== "core" || fileName !== "webui") return false
  return String(pathList[0] || "") === "path"
}

function isSecretPath(pathList, label = "") {
  const last = String(pathList[pathList.length - 1] || "")
  if (SECRET_RE.test(last.replace(/[\s-]+/g, ""))) return true
  if (/^key$/i.test(last) && /(api\s*key|密钥|ocr|token|secret)/i.test(label)) return true
  return false
}

function inferType(value) {
  if (value === null || value === undefined) return "null"
  if (Array.isArray(value)) return "array"
  if (isPlainObject(value)) return "object"
  return typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number" : "string"
}

function arrayItemType(value) {
  if (!Array.isArray(value)) return "string"
  const item = value.find(entry => entry !== null && entry !== undefined)
  return isPlainObject(item) ? "object" : inferType(item) === "null" ? "string" : inferType(item)
}

function collectFields(value, basePath, map) {
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
    if (!entries.length) {
      if (basePath.length) {
        const key = pathKey(basePath)
        if (!map.has(key)) map.set(key, { path: basePath, type: "object", defaultValue: value, liveValue: undefined })
      }
      return
    }
    for (const [key, item] of entries) collectFields(item, [...basePath, key], map)
    return
  }

  const key = pathKey(basePath)
  const type = inferType(value)
  if (!map.has(key)) {
    map.set(key, { path: basePath, type, defaultValue: value, liveValue: undefined })
  } else if (map.get(key).type === "null" && type !== "null") {
    map.get(key).type = type
  }
}

function editorFor(type, options, itemType) {
  if (options?.length) return "select"
  if (type === "boolean") return "switch"
  if (type === "number") return "number"
  if (type === "array") return itemType === "object" ? "json" : "list"
  if (type === "object") return "json"
  return "text"
}

function isReadOnlyField(fileName, pathList) {
  return fileName === "webui" && PROTECTED_WEBUI_FIELDS.has(String(pathList[0]))
}

/** 这项配置是否已由其他页面提供可视化编辑，文件视图里不再重复列出 */
function isManagedElsewhere(fileName, pathList) {
  return MANAGED_ELSEWHERE[fileName]?.has(String(pathList[0])) === true
}

function fieldHelp(comment, secret, readOnly, label = "") {
  const parts = []
  // 注释的第一句已经被当成标题，小字里不再重复一遍
  if (comment) {
    const text = String(comment).trim()
    const heading = String(label || "").trim()
    let rest = text
    if (heading && text.startsWith(heading)) {
      rest = text
        .slice(heading.length)
        .replace(/^[，。；：、,.;:\s]+/, "")
        .trim()
    }
    // 整个括号补充说明（如「（挂载在 Yunzai 现有 HTTP 服务上…）」）脱离标题后是半截话，不单独显示
    if (rest && !/^[（(][^（()）]*[）)]$/.test(rest)) parts.push(rest)
  }
  if (readOnly) parts.push("出于安全考虑，此项只能手动编辑 config/webui.yaml")
  // 只读字段已经说明只能手改文件，不再重复「密钥不回显」
  if (secret && !readOnly) parts.push("密钥不会在页面回显，留空表示保持原值。")
  return parts.join(" ")
}

function buildFileFields({ liveVals, defaultVals, comments, fileName, kind }) {
  const map = new Map()
  collectFields(defaultVals, [], map)
  collectFields(liveVals, [], map)

  const fields = []
  for (const entry of map.values()) {
    if (!entry.path.length) continue
    const hidden = kind === "core" && isManagedElsewhere(fileName, entry.path)
    const inLive = hasOwnPath(liveVals, entry.path)
    const inDefault = hasOwnPath(defaultVals, entry.path)
    let value = inLive ? getValueAt(liveVals, entry.path) : getValueAt(defaultVals, entry.path)
    const defaultValue = inDefault ? getValueAt(defaultVals, entry.path) : undefined
    const joined = joinPath(entry.path)
    const overrideKey = kind === "core" ? `${fileName}.${joined}` : ""
    let type = overrideKey ? CORE_TYPE_OVERRIDES[overrideKey] : undefined
    if (!type) type = entry.type
    if (type === "null") type = "string"

    const labelText = comments.get(joined) || comments.get(`${fileName}.${joined}`) || ""
    const label = commentToLabel(labelText, entry.path[entry.path.length - 1])
    const secret = isSecretPath(entry.path, `${label} ${labelText}`)
    const readOnly = kind === "core" && isReadOnlyField(fileName, entry.path)
    const options = overrideKey ? CORE_OPTIONS[overrideKey] : undefined
    // 自由模式判定模型改为从模型池选择，候选项由前端按 AI 管理里的模型列表填充
    const modelPool = kind === "core" && overrideKey === "ai.freeJudgeModel"
    const itemType = type === "array" ? arrayItemType(inLive ? value : defaultValue) : undefined
    const originalValue = value

    if (secret) value = ""

    fields.push({
      path: entry.path,
      key: joined,
      ...(hidden ? { hidden: true } : {}),
      label,
      help: overrideKey && CORE_EMPTY_HINTS[overrideKey] ? "" : fieldHelp(labelText, secret, readOnly, label),
      type,
      editor: modelPool ? "model-pool" : editorFor(type, options, itemType),
      itemType,
      options,
      modelPool,
      value,
      defaultValue: secret ? undefined : defaultValue,
      secret,
      hasValue: secret ? originalValue !== undefined && originalValue !== null && originalValue !== "" : undefined,
      readOnly,
      fromDefault: !inLive && inDefault,
      restartRequired: fieldNeedsRestart(fileName, entry.path, kind),
      ...(overrideKey && CORE_EMPTY_HINTS[overrideKey] ? { emptyHint: CORE_EMPTY_HINTS[overrideKey] } : {}),
    })
  }

  return fields
}

function fileMeta(name, file) {
  let stat = null
  try {
    stat = fs.statSync(file)
  } catch {}
  const [title, description] = CORE_FILE_META[name] || [name, `config/config/${name}.yaml`]
  return {
    name,
    title,
    description,
    restartRequired: RESTART_REQUIRED.has(name),
    size: stat?.size ?? 0,
    updatedAt: stat?.mtimeMs ?? null,
  }
}

function coreFileNames() {
  if (!fs.existsSync(CONFIG_DIR)) return []
  return fs
    .readdirSync(CONFIG_DIR)
    .filter(name => name.endsWith(".yaml") && !name.slice(0, -5).includes("."))
    .map(name => name.slice(0, -5))
}

function coreFilePath(name) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(name || ""))) throw new ConfigError("配置文件名无效")
  if (!coreFileNames().includes(name)) throw new ConfigError("配置文件不存在", 404)
  return path.join(CONFIG_DIR, `${name}.yaml`)
}

function defaultFilePath(name) {
  const file = path.join(DEFAULT_CONFIG_DIR, `${name}.yaml`)
  return fs.existsSync(file) ? file : null
}

export function listConfigFiles() {
  const names = coreFileNames()
  const has = name => names.includes(name)
  const basic = CORE_ORDER.filter(name => has(name) && !HIDDEN_BASIC.has(name)).map(name => fileMeta(name, path.join(CONFIG_DIR, `${name}.yaml`)))
  const basicSet = new Set([...CORE_ORDER, ...OTHER_ORDER, "group"])
  const others = [
    ...OTHER_ORDER.filter(name => has(name) && !HIDDEN_OTHER.has(name)).map(name => fileMeta(name, path.join(CONFIG_DIR, `${name}.yaml`))),
    ...names
      .filter(name => !basicSet.has(name) && !HIDDEN_OTHER.has(name))
      .sort((a, b) => a.localeCompare(b, "zh-CN"))
      .map(name => fileMeta(name, path.join(CONFIG_DIR, `${name}.yaml`))),
  ]

  return {
    groups: [
      { id: "basic", title: "基础配置", description: "Bot 运行、账号安全与 WebUI 设置；AI 参数请在「AI」分组中调整。", files: basic },
      { id: "other", title: "其他配置", description: "服务端口、Redis、数据库与协议适配器。", files: others },
    ],
    group: has("group") ? fileMeta("group", path.join(CONFIG_DIR, "group.yaml")) : null,
    note: "保存后会立即重新读取配置；标记“需重启”的文件需重启 Bot 才能完全生效。",
  }
}

export function readCoreConfig(name) {
  if (name === "group") throw new ConfigError("群组配置请在“群组配置”页面编辑")
  const file = coreFilePath(name)
  const { text, doc } = readDocument(file)
  const defaultFile = defaultFilePath(name)
  const defaultDoc = defaultFile ? readDocument(defaultFile).doc : null
  const defaultText = defaultFile ? fs.readFileSync(defaultFile, "utf8") : ""
  const liveVals = doc.toJS() ?? {}
  const defaultVals = defaultDoc?.toJS() ?? {}
  if (!isPlainObject(liveVals) && !isPlainObject(defaultVals))
    throw new ConfigError("该配置文件不是键值结构，暂不支持可视化编辑")

  const comments = extractComments(`${defaultText}\n${text}`)
  const fields = buildFileFields({
    liveVals: isPlainObject(liveVals) ? liveVals : {},
    defaultVals: isPlainObject(defaultVals) ? defaultVals : {},
    comments,
    fileName: name,
    kind: "core",
  })

  const meta = fileMeta(name, file)
  return {
    ...meta,
    path: `config/config/${name}.yaml`,
    note:
      name === "ai"
        ? "保存后无需重启，下一轮对话即按新设置运行。"
        : name === "webui"
          // WebUI 的重启说明已经标在访问路径字段上，卡片底部不再重复
          ? ""
          : meta.restartRequired
            ? "保存后需重启 Bot 才会完全生效。"
            : "保存后会自动重新读取配置，文件监控通常在 5 秒内生效。",
    fields,
  }
}

function normalizeFieldValue(field, raw) {
  if (field.readOnly) throw new ConfigError(`「${field.label}」为受保护配置项`)
  if (raw === undefined) throw new ConfigError(`「${field.label}」的值无效`)
  if (field.secret && (raw === "" || raw === null)) return SKIP

  let value = raw
  if (field.editor === "switch01") {
    value = value === true || value === 1 || value === "1" ? 1 : 0
  } else if (field.type === "boolean") {
    if (typeof value !== "boolean") value = value === "true" || value === 1 || value === "1"
  } else if (field.type === "number") {
    const number = Number(value)
    if (!Number.isFinite(number)) throw new ConfigError(`「${field.label}」必须是数字`)
    value = number
  } else if (field.type === "array") {
    if (!Array.isArray(value)) throw new ConfigError(`「${field.label}」必须是列表`)
    if (field.editor === "list") {
      value = value.map(item => String(item).trim()).filter(Boolean)
      if (field.itemType === "number")
        value = value.map(item => {
          const number = Number(item)
          if (!Number.isFinite(number)) throw new ConfigError(`「${field.label}」包含无效数字：${item}`)
          return number
        })
      if (field.botList) {
        value = [...new Set(value)]
        for (const item of value)
          if (!/^\d{3,20}$/.test(item)) throw new ConfigError(`「${field.label}」必须是 QQ 账号：${item}`)
      }
    }
  } else if (field.type === "object") {
    if (value !== null && !isPlainObject(value)) throw new ConfigError(`「${field.label}」必须是对象`)
  } else if (field.type === "string") {
    if (value === null) value = null
    else value = String(value)
  } else if (field.type === "null" || !field.type) {
    // 留空允许保存 null / 原始 JSON
  }

  if (field.options?.length && value !== null) {
    const option = field.options.find(item => String(item.value) === String(value))
    if (!option) throw new ConfigError(`「${field.label}」的选项无效`)
    value = option.value
  }

  assertSafeValue(value)
  return value
}

function assertSafeValue(value, depth = 0) {
  if (depth > 12) throw new ConfigError("配置值嵌套过深")
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint")
    throw new ConfigError("配置值类型不受支持")
  if (typeof value === "string" && value.length > 100000) throw new ConfigError("配置值过长")
  if (Array.isArray(value)) {
    if (value.length > 1000) throw new ConfigError("配置列表过长")
    for (const item of value) assertSafeValue(item, depth + 1)
    return
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
    if (entries.length > 1000) throw new ConfigError("配置对象过大")
    for (const [key, item] of entries) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw new ConfigError("配置键无效")
      assertSafeValue(item, depth + 1)
    }
  }
}

function findMapKey(mapNode, segment) {
  if (!YAML.isMap(mapNode)) return undefined
  const item = mapNode.items.find(entry => String(entry.key?.value) === String(segment))
  return item ? item.key.value : undefined
}

function actualDocPath(doc, defaultDoc, pathList) {
  const keys = []
  let node = doc?.contents
  let defaultNode = defaultDoc?.contents

  for (const segment of pathList) {
    let actual = findMapKey(node, segment)
    if (actual === undefined) actual = findMapKey(defaultNode, segment)
    if (actual === undefined) actual = /^\d+$/.test(String(segment)) ? Number(segment) : segment
    keys.push(actual)

    if (YAML.isMap(node)) {
      const item = node.items.find(entry => String(entry.key?.value) === String(segment))
      node = item?.value
    } else node = undefined

    if (YAML.isMap(defaultNode)) {
      const item = defaultNode.items.find(entry => String(entry.key?.value) === String(segment))
      defaultNode = item?.value
    } else defaultNode = undefined
  }

  return keys
}

function applyUpdates(doc, defaultDoc, fields, updates) {
  const fieldMap = new Map(fields.map(field => [pathKey(field.path), field]))
  let changed = 0

  for (const update of Array.isArray(updates) ? updates : []) {
    if (!update || !Array.isArray(update.path)) throw new ConfigError("配置项路径无效")
    const field = fieldMap.get(pathKey(update.path))
    if (!field) throw new ConfigError(`未知配置项：${joinPath(update.path)}`)
    const value = normalizeFieldValue(field, update.value)
    if (value === SKIP) continue
    doc.setIn(actualDocPath(doc, defaultDoc, field.path), value)
    changed++
  }

  return changed
}

export function saveCoreConfig(name, body) {
  if (name === "group") throw new ConfigError("群组配置请在“群组配置”页面编辑")
  const file = coreFilePath(name)
  const defaultFile = defaultFilePath(name)
  const { doc } = readDocument(file)
  const defaultDoc = defaultFile ? readDocument(defaultFile).doc : null
  const detail = readCoreConfig(name)
  const changed = applyUpdates(doc, defaultDoc, detail.fields, body?.updates)
  if (!changed)
    return { changed: 0, message: "没有需要保存的修改", restartRequired: detail.restartRequired, detail }

  writeDocument(file, doc)
  invalidateConfigCache(name)
  return {
    changed,
    message: `已保存 ${detail.title} 的 ${changed} 项配置`,
    restartRequired: detail.restartRequired,
    note: detail.note,
    detail,
  }
}

/* ---------------- 群组配置 ---------------- */

function groupDocuments() {
  const liveFile = path.join(CONFIG_DIR, "group.yaml")
  const defaultFile = path.join(DEFAULT_CONFIG_DIR, "group.yaml")
  const live = readDocument(liveFile)
  const fallback = readDocument(defaultFile)
  const defaultDoc = fallback.doc
  const defaultText = fs.existsSync(defaultFile) ? fs.readFileSync(defaultFile, "utf8") : ""
  const comments = extractComments(`${defaultText}\n${live.text}`)
  const liveVals = live.doc.toJS() ?? {}
  const defaultVals = defaultDoc.toJS() ?? {}
  return {
    liveFile,
    defaultFile,
    liveDoc: live.doc,
    defaultDoc,
    comments,
    liveVals: isPlainObject(liveVals) ? liveVals : {},
    defaultVals: isPlainObject(defaultVals) ? defaultVals : {},
  }
}

function defaultGroupBlock(docs) {
  const shipped = isPlainObject(docs.defaultVals.default) ? docs.defaultVals.default : {}
  const live = isPlainObject(docs.liveVals.default) ? docs.liveVals.default : {}
  return { ...shipped, ...live }
}

function buildGroupFields(docs, features, bots = []) {
  const map = new Map()
  collectFields(defaultGroupBlock(docs), [], map)
  if (isPlainObject(docs.liveVals.default)) collectFields(docs.liveVals.default, [], map)

  const botCandidates = bots
    .map(bot => {
      const id = String(bot.id ?? bot.self_id ?? "")
      if (!/^\d{3,20}$/.test(id)) return null
      const name = bot.name || bot.nickname || ""
      return { value: id, label: name ? `${name}（${id}）` : id }
    })
    .filter(Boolean)
  const botLabels = Object.fromEntries(botCandidates.map(item => [item.value, item.label]))

  const fields = []
  for (const entry of map.values()) {
    if (!entry.path.length) continue
    const name = String(entry.path[0])
    const comment = docs.comments.get(`default.${joinPath(entry.path)}`) || ""
    let type = entry.type
    let editor
    let options

    if (GROUP_ARRAY.has(name)) {
      type = "array"
      editor = "list"
    } else if (GROUP_NUMERIC.has(name)) {
      type = "number"
      editor = "number"
    } else if (GROUP_BINARY.has(name)) {
      type = "number"
      editor = "switch01"
      options = [
        { value: 1, label: "开启" },
        { value: 0, label: "关闭" },
      ]
    } else if (GROUP_OPTIONS[name]) {
      type = "number"
      options = GROUP_OPTIONS[name]
      editor = "select"
    } else {
      if (type === "null") type = "string"
      editor = editorFor(type, undefined, type === "array" ? arrayItemType(entry.defaultValue) : undefined)
    }

    const botList = BOT_LIST_FIELDS.has(name)
    fields.push({
      path: entry.path,
      key: joinPath(entry.path),
      label: commentToLabel(comment, name),
      help: comment,
      type,
      editor,
      itemType: type === "array" ? arrayItemType(entry.defaultValue) : undefined,
      options,
      // 与锅巴一致：预加载已加载插件名作为候选项，避免手填时不知道填哪个
      candidates: FEATURE_LIST_FIELDS.has(name) ? features || [] : botList ? botCandidates : undefined,
      valueLabels: botList && Object.keys(botLabels).length ? botLabels : undefined,
      botList,
      defaultValue: entry.defaultValue,
    })
  }
  return fields
}

function mergeGroupBlocks(...blocks) {
  const result = {}
  for (const block of blocks) {
    if (!isPlainObject(block)) continue
    for (const [key, value] of Object.entries(block)) {
      if (isPlainObject(value) && isPlainObject(result[key])) result[key] = { ...result[key], ...value }
      else result[key] = value
    }
  }
  return result
}

function valuesFromBlock(block, fields) {
  const values = {}
  for (const field of fields) {
    const value = getValueAt(block, field.path)
    if (value !== undefined) values[pathKey(field.path)] = value
  }
  return values
}

function scopeInfo(rawKey, docs, bots, groups) {
  const botMap = new Map(bots.map(bot => [String(bot.id), bot.name]))
  const groupMap = new Map(groups.map(group => [String(group.id), group.name]))
  if (!rawKey || rawKey === "default") return { id: "default", label: "全局默认", botId: "", groupId: "" }

  const text = String(rawKey)
  let match = text.match(/^(\d+):default$/)
  if (match) {
    const botId = match[1]
    return {
      id: rawKey,
      label: `Bot ${botMap.get(botId) || botId} · 默认`,
      botId,
      groupId: "",
    }
  }
  match = text.match(/^(\d+):(\d+)$/)
  if (match) {
    const [, botId, groupId] = match
    return {
      id: rawKey,
      label: `Bot ${botMap.get(botId) || botId} · 群 ${groupMap.get(groupId) || groupId}`,
      botId,
      groupId,
    }
  }
  if (/^\d+$/.test(text)) {
    return { id: rawKey, label: `群 ${groupMap.get(text) || text}`, botId: "", groupId: text }
  }
  return { id: rawKey, label: text, botId: "", groupId: "" }
}

function groupLayerKey(botId, groupId) {
  if (botId && groupId) return `${botId}:${groupId}`
  if (botId) return `${botId}:default`
  if (groupId) return groupId
  return "default"
}

function groupLayers(docs, botId, groupId, key) {
  const global = isPlainObject(docs.liveVals.default) ? docs.liveVals.default : {}
  const bot = botId && isPlainObject(docs.liveVals[`${botId}:default`]) ? docs.liveVals[`${botId}:default`] : {}
  const group = groupId && isPlainObject(docs.liveVals[groupId]) ? docs.liveVals[groupId] : {}
  const combined = botId && groupId && isPlainObject(docs.liveVals[`${botId}:${groupId}`]) ? docs.liveVals[`${botId}:${groupId}`] : {}
  if (key === "default") return { blocks: [global], effective: mergeGroupBlocks(global) }
  if (botId && groupId) {
    const effective = mergeGroupBlocks(global, bot, group, combined)
    return { blocks: [global, bot, group, combined], effective }
  }
  if (botId) {
    const effective = mergeGroupBlocks(global, bot)
    return { blocks: [global, bot], effective }
  }
  const effective = mergeGroupBlocks(global, group)
  return { blocks: [global, group], effective }
}

function groupResponse(docs, fields, botId, groupId) {
  const key = groupLayerKey(botId, groupId)
  const { blocks, effective } = groupLayers(docs, botId, groupId, key)
  const currentBlock = key === "default" ? docs.liveVals.default || {} : docs.liveVals[key] || {}
  const parentBlock = blocks.slice(0, -1).reduce((out, block) => mergeGroupBlocks(out, block), {})
  const isDefault = key === "default"

  return {
    fields: fields.map(field => {
      const overridden = !isDefault && hasOwnPath(currentBlock, field.path)
      return {
        ...field,
        value: getValueAt(effective, field.path),
        inherited: !isDefault && !overridden,
        overridden,
      }
    }),
    values: isDefault ? valuesFromBlock(effective, fields) : valuesFromBlock(effective, fields),
    overrides: isDefault ? {} : { ...currentBlock },
    parentValues: valuesFromBlock(parentBlock, fields),
    key,
    isDefault,
    botId,
    groupId,
    overriddenCount: isDefault ? 0 : countLeaves(currentBlock),
  }
}

export function getGroupConfig({ bots = [], groups = [], features = [] } = {}) {
  const docs = groupDocuments()
  const normalizedBots = bots.map(bot => ({
    id: String(bot.self_id ?? bot.id ?? ""),
    name: bot.nickname || bot.name || "",
    online: !!bot.online,
  }))
  const normalizedGroups = groups.map(group => ({
    id: String(group.group_id ?? group.id ?? ""),
    name: group.name || "",
    memberCount: group.memberCount || 0,
  }))
  const fields = buildGroupFields(docs, features, normalizedBots)

  const scopes = [{ id: "default", label: "全局默认", botId: "", groupId: "", count: countLeaves(docs.liveVals.default || {}), overrides: docs.liveVals.default || {} }]
  for (const [key, value] of Object.entries(docs.liveVals)) {
    if (key === "default") continue
    if (!isPlainObject(value)) continue
    const info = scopeInfo(key, docs, normalizedBots, normalizedGroups)
    scopes.push({ ...info, count: countLeaves(value), overrides: value })
  }

  const liveFile = docs.liveFile
  return {
    fields,
    defaults: defaultGroupBlock(docs),
    scopes,
    bots: normalizedBots,
    groups: normalizedGroups,
    note: "按全局默认 ＜ Bot 默认 ＜ 群设置 ＜Bot + 群设置",
    file: {
      path: "config/config/group.yaml",
      updatedAt: fs.existsSync(liveFile) ? fs.statSync(liveFile).mtimeMs : null,
      size: fs.existsSync(liveFile) ? fs.statSync(liveFile).size : 0,
    },
  }
}

export function getGroupEffective({ botId, groupId, bots = [], groups = [], features = [] } = {}) {
  const safeBot = normalizeId(botId, "Bot 账号")
  const safeGroup = normalizeId(groupId, "群号")
  const docs = groupDocuments()
  const normalizedBots = bots.map(bot => ({
    id: String(bot.self_id ?? bot.id ?? ""),
    name: bot.nickname || bot.name || "",
  }))
  const normalizedGroups = groups.map(group => ({
    id: String(group.group_id ?? group.id ?? ""),
    name: group.name || "",
  }))
  const fields = buildGroupFields(docs, features, normalizedBots)
  const info = scopeInfo(groupLayerKey(safeBot, safeGroup), docs, normalizedBots, normalizedGroups)
  const payload = groupResponse(docs, fields, safeBot, safeGroup)
  return {
    ...payload,
    scopeLabel: info.label,
    ...(safeBot || safeGroup ? { scopeId: groupLayerKey(safeBot, safeGroup) } : { scopeId: "default" }),
  }
}

export function saveGroupConfig(body = {}) {
  const botId = normalizeId(body.botId, "Bot 账号")
  const groupId = normalizeId(body.groupId, "群号")
  const key = groupLayerKey(botId, groupId)
  const docs = groupDocuments()
  const fields = buildGroupFields(docs)
  const fieldMap = new Map(fields.map(field => [pathKey(field.path), field]))
  const current = key === "default" ? defaultGroupBlock(docs) : docs.liveVals[key] || {}
  const layers = groupLayers(docs, botId, groupId, key)
  const parentBlock = layers.blocks.slice(0, -1).reduce((out, block) => mergeGroupBlocks(out, block), {})
  const parentValues = valuesFromBlock(parentBlock, fields)
  const doc = docs.liveDoc
  let changed = 0

  const rawKey = key === "default" ? "default" : findMapKey(doc.contents, key) ?? (/^\d+$/.test(key) ? Number(key) : key)

  for (const update of Array.isArray(body.updates) ? body.updates : []) {
    if (!update || !Array.isArray(update.path)) throw new ConfigError("配置项路径无效")
    const field = fieldMap.get(pathKey(update.path))
    if (!field) throw new ConfigError(`未知群聊配置项：${joinPath(update.path)}`)
    const value = normalizeFieldValue(field, update.value)
    if (value === SKIP) continue

    if (key === "default") {
      doc.setIn([rawKey, ...field.path], value)
      changed++
      continue
    }

    if (JSON.stringify(value ?? null) === JSON.stringify(parentValues[pathKey(field.path)] ?? null))
      doc.deleteIn([rawKey, ...field.path])
    else doc.setIn([rawKey, ...field.path], value)
    changed++
  }

  for (const resetPath of Array.isArray(body.resets) ? body.resets : []) {
    if (!Array.isArray(resetPath)) continue
    const field = fieldMap.get(pathKey(resetPath))
    if (!field) continue
    if (key === "default") {
      const shipped = getValueAt(docs.defaultVals.default, field.path)
      if (shipped === undefined) doc.deleteIn([rawKey, ...field.path])
      else doc.setIn([rawKey, ...field.path], shipped)
    } else doc.deleteIn([rawKey, ...field.path])
    changed++
  }

  if (key !== "default") {
    const block = doc.getIn([rawKey])
    if (YAML.isMap(block) && block.items.length === 0) doc.deleteIn([rawKey])
  }
  if (!changed) return { changed: 0, message: "没有需要保存的修改" }

  writeDocument(docs.liveFile, doc)
  invalidateConfigCache("group")
  const info = scopeInfo(key, docs, [], [])
  return {
    changed,
    scopeLabel: info.label,
    message:
      key === "default"
        ? "全局默认群聊配置已保存"
        : `已保存「${info.label}」的群聊覆盖设置`,
    note: "群聊配置会在下一条消息处理时生效。",
  }
}

export function deleteGroupScope({ botId, groupId } = {}) {
  const safeBot = normalizeId(botId, "Bot 账号")
  const safeGroup = normalizeId(groupId, "群号")
  const key = groupLayerKey(safeBot, safeGroup)
  if (key === "default") throw new ConfigError("不能移除全局默认配置")

  const docs = groupDocuments()
  const rawKey = findMapKey(docs.liveDoc.contents, key)
  if (rawKey === undefined) return { changed: 0, message: "该作用范围没有覆盖配置" }
  docs.liveDoc.deleteIn([rawKey])
  writeDocument(docs.liveFile, docs.liveDoc)
  invalidateConfigCache("group")
  return { changed: 1, message: `已删除 ${key} 的群聊覆盖配置` }
}

/* ---------------- 插件配置 ---------------- */

function pluginEntries() {
  if (!fs.existsSync(PLUGINS_DIR)) return []
  const result = []
  const pendingRemove = pendingRemovalNames()
  for (const dirent of fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
    if (!dirent.isDirectory() || dirent.name.startsWith(".")) continue
    if (pendingRemove.has(dirent.name)) continue
    const pluginDir = path.join(PLUGINS_DIR, dirent.name)
    const hasGuoba = fs.existsSync(path.join(pluginDir, "guoba.support.js"))
    const configs = []
    if (hasGuoba) {
      const stat = fs.statSync(path.join(pluginDir, "guoba.support.js"))
      configs.push({
        id: "guoba",
        kind: "guoba",
        title: "插件配置",
        description: "由插件提供的 Guoba 配置表单。",
        file: "guoba.support.js",
        size: stat.size,
        updatedAt: stat.mtimeMs,
      })
    }

    // 已适配 Guoba 的插件以 Guoba 表单为唯一入口，避免同一份配置出现“插件配置/运行配置”两份
    if (!hasGuoba) {
      const configDir = path.join(pluginDir, "config")
      const userConfigDir = path.join(configDir, "config")
      const scanDir = fs.existsSync(userConfigDir) ? userConfigDir : configDir
      if (fs.existsSync(scanDir) && fs.statSync(scanDir).isDirectory()) {
        for (const fileDirent of fs.readdirSync(scanDir, { withFileTypes: true })) {
          if (!fileDirent.isFile() || !fileDirent.name.endsWith(".yaml")) continue
          const file = path.join(scanDir, fileDirent.name)
          let parsed
          try {
            parsed = YAML.parse(fs.readFileSync(file, "utf8"))
          } catch {
            continue
          }
          if (!isPlainObject(parsed) || !Object.keys(parsed).length) continue
          const rel = path.relative(pluginDir, file).replaceAll("\\", "/")
          const stat = fs.statSync(file)
          configs.push({
            id: `yaml:${rel}`,
            kind: "yaml",
            title: pluginConfigTitle(rel),
            description: `插件配置文件 ${rel}`,
            file: rel,
            size: stat.size,
            updatedAt: stat.mtimeMs,
          })
        }
      }
    }

    if (configs.length) {
      result.push({
        key: dirent.name,
        title: dirent.name,
        hasGuoba,
        configs: configs.sort((a, b) => (a.kind === b.kind ? a.title.localeCompare(b.title, "zh-CN") : a.kind === "guoba" ? -1 : 1)),
      })
    }
  }
  return result.sort((a, b) => a.key.localeCompare(b.key, "zh-CN"))
}

function pluginConfigTitle(rel) {
  const base = path.basename(rel, ".yaml")
  if (rel === "config/config/config.yaml") return "运行配置"
  if (rel === "config/config/user.yaml") return "用户配置"
  const known = {
    cfg: "基础配置",
    xiuxian: "修仙配置",
    ani: "番剧配置",
    announce: "公告配置",
    battle: "战斗配置",
    black: "黑名单配置",
  }
  return known[base] || base
}

export function listPluginConfigEntries() {
  const plugins = pluginEntries()
  return {
    plugins,
    stats: {
      plugins: plugins.length,
      guoba: plugins.filter(plugin => plugin.hasGuoba).length,
      files: plugins.reduce((sum, plugin) => sum + plugin.configs.filter(config => config.kind === "yaml").length, 0),
      configs: plugins.reduce((sum, plugin) => sum + plugin.configs.length, 0),
    },
  }
}

async function pluginDisplayInfo(pluginKey) {
  const resolved = resolvePluginConfig(pluginKey, "guoba")
  const support = await getGuobaSupport(resolved.entry.key, resolved.supportFile)
  return sanitizePluginInfo(support.pluginInfo, resolved.pluginDir)
}

export async function listPluginConfigEntriesWithInfo() {
  const list = listPluginConfigEntries()
  await Promise.all(
    list.plugins
      .filter(plugin => plugin.hasGuoba)
      .map(async plugin => {
        try {
          const info = await pluginDisplayInfo(plugin.key)
          if (!info) return
          plugin.title = info.title || plugin.key
          plugin.description = info.description || ""
          plugin.author = info.author || ""
          plugin.icon = info.icon
          plugin.iconColor = info.iconColor
          plugin.hasIcon = info.hasIcon
        } catch {
          plugin.hasIcon = false
        }
      }),
  )
  return list
}

export async function readPluginIcon(pluginKey) {
  const resolved = resolvePluginConfig(pluginKey, "guoba")
  const support = await getGuobaSupport(resolved.entry.key, resolved.supportFile)
  const file = pluginIconFile(resolved.pluginDir, support.pluginInfo?.iconPath)
  if (!file) return null
  return { file, mime: PLUGIN_ICON_MIME[path.extname(file).toLowerCase()] }
}

function resolvePluginConfig(pluginKey, id) {
  const text = String(pluginKey || "")
  if (!text || text.includes("/") || text.includes("\\") || text.includes(".."))
    throw new ConfigError("插件标识无效")
  const entry = pluginEntries().find(plugin => plugin.key === text)
  if (!entry) throw new ConfigError("插件不存在或没有可编辑配置", 404)
  const config = entry.configs.find(item => item.id === id)
  if (!config) throw new ConfigError("插件配置不存在", 404)

  const pluginDir = path.join(PLUGINS_DIR, entry.key)
  if (config.kind === "yaml") {
    const file = path.resolve(pluginDir, config.file)
    const base = path.resolve(pluginDir)
    if (!file.startsWith(base + path.sep)) throw new ConfigError("插件配置路径无效")
    const realBase = fs.realpathSync(base)
    const realFile = fs.realpathSync(file)
    if (!realFile.startsWith(realBase + path.sep)) throw new ConfigError("插件配置路径无效")
    return { entry, config, pluginDir, file: realFile }
  }

  const supportFile = path.join(pluginDir, "guoba.support.js")
  if (!fs.existsSync(supportFile)) throw new ConfigError("插件未提供 guoba.support.js", 404)
  return { entry, config, pluginDir, supportFile }
}

function pluginDefaultFile(pluginDir, rel) {
  let candidate = null
  if (rel.startsWith("config/config/")) {
    candidate = path.join(pluginDir, "config", path.basename(rel).replace(/\.yaml$/, "_default.yaml"))
  } else if (rel.startsWith("config/")) {
    candidate = path.join(pluginDir, "config", "default_config", path.basename(rel))
  }
  return candidate && fs.existsSync(candidate) ? candidate : null
}

function readPluginYamlConfig(resolved) {
  const { entry, config, pluginDir, file } = resolved
  const { text, doc } = readDocument(file)
  const liveVals = doc.toJS() ?? {}
  if (!isPlainObject(liveVals)) throw new ConfigError("该配置文件不是键值结构，暂不支持可视化编辑")

  const defaultFile = pluginDefaultFile(pluginDir, config.file)
  const defaultDoc = defaultFile ? readDocument(defaultFile).doc : null
  const defaultText = defaultFile ? fs.readFileSync(defaultFile, "utf8") : ""
  const defaultVals = defaultDoc?.toJS() ?? {}
  const comments = extractComments(`${defaultText}\n${text}`)
  const fields = buildFileFields({
    liveVals,
    defaultVals: isPlainObject(defaultVals) ? defaultVals : {},
    comments,
    fileName: entry.key,
    kind: "plugin",
  })
  const stat = fs.statSync(file)
  return {
    plugin: { key: entry.key, title: entry.key },
    id: config.id,
    kind: "yaml",
    title: config.title,
    description: config.description,
    file: config.file,
    restartRequired: true,
    note: "保存后需重新加载该插件或重启 Bot 才会生效。",
    updatedAt: stat.mtimeMs,
    size: stat.size,
    fields,
  }
}

const PLUGIN_ICON_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
}

function pluginIconFile(pluginDir, iconPath) {
  const raw = String(iconPath || "").trim()
  if (!raw) return null
  try {
    const base = fs.realpathSync(pluginDir)
    const file = fs.realpathSync(path.resolve(base, raw))
    if (!file.startsWith(base + path.sep)) return null
    if (!PLUGIN_ICON_MIME[path.extname(file).toLowerCase()]) return null
    if (fs.statSync(file).size > 2 * 1024 * 1024) return null
    return file
  } catch {
    return null
  }
}

function sanitizePluginInfo(info, pluginDir) {
  if (!isPlainObject(info)) return null
  const iconColor = String(info.iconColor || "").trim()
  return {
    name: info.name || "",
    title: info.title || info.name || "",
    description: info.description || "",
    author: info.author || "",
    link: info.link || "",
    icon: String(info.icon || "").trim().slice(0, 80),
    iconColor: /^#[0-9a-f]{3,8}$/i.test(iconColor) ? iconColor : "",
    hasIcon: !!(pluginDir && pluginIconFile(pluginDir, info.iconPath)),
  }
}

function componentOptions(componentProps) {
  const raw = componentProps?.options
  if (!Array.isArray(raw)) return undefined
  return raw
    .filter(item => item && typeof item === "object")
    .map(item => ({ label: String(item.label ?? item.value ?? ""), value: item.value }))
}

function optionsType(options) {
  if (!options?.length) return "string"
  return options.every(option => typeof option.value === "number") ? "number" : "string"
}

function guobaSubFields(schemas) {
  if (!Array.isArray(schemas)) return []
  return schemas
    .filter(item => item && item.field)
    .map(item => {
      const key = String(item.field)
      const options = componentOptions(item.componentProps)
      const label = item.label || key
      let type = "string"
      let editor = "text"
      if (item.component === "InputNumber") {
        type = "number"
        editor = "number"
      } else if (item.component === "Switch") {
        type = "boolean"
        editor = "switch"
      } else if (item.component === "InputTextArea" || item.component === "Textarea") {
        type = "string"
        editor = "textarea"
      } else if (options?.length) {
        type = optionsType(options)
        editor = "select"
      }
      return {
        key,
        label,
        help: item.bottomHelpMessage || item.helpMessage || "",
        required: !!item.required,
        component: item.component || "Input",
        type,
        editor,
        options,
        placeholder: item.componentProps?.placeholder || "",
        secret: false,
      }
    })
}

function guobaFieldValue(type, raw) {
  if (raw === undefined) return type === "boolean" ? false : type === "number" ? null : type === "array" ? [] : ""
  return raw
}

function sanitizeGuobaSubRows(rawValue, schemas, multiple) {
  const sanitizeRow = (row, origin) => {
    const source = isPlainObject(row) ? row : {}
    const out = { __origin: origin }
    const secretSet = {}
    for (const sub of schemas) {
      const value = source[sub.key]
      if (sub.secret) {
        out[sub.key] = ""
        secretSet[sub.key] = value !== undefined && value !== null && value !== ""
      } else if (value !== undefined && value !== null && value !== "") {
        out[sub.key] = value
      }
    }
    if (Object.keys(secretSet).length) out.__secretSet = secretSet
    return out
  }
  if (multiple === false) return sanitizeRow(rawValue, 0)
  if (!Array.isArray(rawValue)) return []
  return rawValue.map((row, origin) => sanitizeRow(row, origin))
}

function readGuobaConfig(resolved) {
  const { entry, config, supportFile, pluginDir } = resolved
  return getGuobaSupport(entry.key, supportFile).then(support => {
    const configInfo = support.configInfo
    if (!configInfo || typeof configInfo.getConfigData !== "function")
      throw new ConfigError("该插件未提供 Guoba 配置读写能力")

    let data
    try {
      data = configInfo.getConfigData()
    } catch (error) {
      throw new ConfigError(`读取插件配置失败：${error?.message || error}`, 500)
    }
    if (!isPlainObject(data)) throw new ConfigError("插件返回的配置数据格式无效", 500)

    const fields = []
    let section = ""
    for (const item of Array.isArray(configInfo.schemas) ? configInfo.schemas : []) {
      if (!item || typeof item !== "object") continue
      if (item.component === "SOFT_GROUP_BEGIN" || item.component === "Divider") {
        if (item.label) section = String(item.label)
        continue
      }
      if (!item.field) continue

      const key = String(item.field)
      const pathList = key.split(".")
      const rawValue = getValueAt(data, pathList)
      const options = componentOptions(item.componentProps)
      const component = item.component || "Input"
      const label = item.label || pathList[pathList.length - 1]
      const helpText = item.bottomHelpMessage || item.helpMessage || ""
      const secret = false
      let type = inferType(rawValue)
      let editor = "text"
      let itemType
      const schemas = component === "GSubForm" ? guobaSubFields(item.componentProps?.schemas) : undefined
      const hasSecretSubField = false
      const secretField = false

      if (component === "InputNumber") {
        type = "number"
        editor = "number"
      } else if (component === "Switch") {
        type = "boolean"
        editor = "switch"
      } else if (component === "Select" || component === "RadioGroup") {
        type = optionsType(options)
        editor = "select"
      } else if (component === "GSubForm") {
        type = item.componentProps?.multiple === false ? "object" : "array"
        editor = "subform"
      } else if (component === "InputTextArea" || component === "Textarea") {
        type = "string"
        editor = "textarea"
      } else if (component === "CheckboxGroup") {
        type = "array"
        editor = "list"
        itemType = "string"
      } else if (options?.length) {
        type = optionsType(options)
        editor = "select"
      } else {
        if (type === "null" || type === "object" || type === "array") type = "string"
        editor = "text"
      }

      let value = guobaFieldValue(type, rawValue)
      if (component === "GSubForm" && schemas?.length)
        value = sanitizeGuobaSubRows(rawValue, schemas, item.componentProps?.multiple !== false)

      if (secretField) {
        const hasValue = rawValue !== undefined && rawValue !== null && rawValue !== ""
        value = ""
        fields.push({
          path: pathList,
          key,
          label,
          help: fieldHelp(helpText, true, false),
          type,
          editor,
          itemType,
          options,
          section,
          component,
          schemas,
          multiple: item.componentProps?.multiple !== false,
          required: !!item.required,
          placeholder: item.componentProps?.placeholder || "",
          secret: true,
          hasValue,
          value,
        })
        continue
      }

      const count = Array.isArray(rawValue) ? rawValue.length : isPlainObject(rawValue) ? 1 : 0
      fields.push({
        path: pathList,
        key,
        label,
        help: helpText,
        type,
        editor,
        itemType,
        options,
        section,
        component,
        schemas,
        multiple: item.componentProps?.multiple !== false,
        required: !!item.required,
        placeholder: item.componentProps?.placeholder || "",
        ...(hasSecretSubField ? { secret: true, hasValue: count > 0, count } : {}),
        value,
      })
    }

    const stat = fs.statSync(supportFile)
    return {
      plugin: { key: entry.key, title: support.pluginInfo?.title || entry.key, ...sanitizePluginInfo(support.pluginInfo, pluginDir) },
      id: config.id,
      kind: "guoba",
      title: support.pluginInfo?.title || `${entry.key} 配置`,
      description: support.pluginInfo?.description || "由插件提供的 Guoba 配置表单。",
      file: "guoba.support.js",
      restartRequired: false,
      updatedAt: stat.mtimeMs,
      size: stat.size,
      fields,
    }
  })
}

function getGuobaSupport(pluginKey, supportFile) {
  if (guobaCache.has(pluginKey)) return guobaCache.get(pluginKey)
  const promise = import(`${pathToFileURL(supportFile).href}?webui=${Date.now()}`)
    .then(async module => {
      const factory = module.supportGuoba || module.default
      if (typeof factory !== "function") throw new ConfigError("插件未导出 supportGuoba()", 400)
      const support = await factory()
      if (!support || typeof support !== "object") throw new ConfigError("插件 Guoba 配置格式无效", 400)
      return support
    })
    .catch(error => {
      guobaCache.delete(pluginKey)
      if (error instanceof ConfigError) throw error
      throw new ConfigError(`加载插件 Guoba 配置失败：${error?.message || error}`, 500)
    })
  guobaCache.set(pluginKey, promise)
  return promise
}

export function invalidateGuoba(pluginKey) {
  if (!pluginKey) {
    guobaCache.clear()
    return
  }
  guobaCache.delete(String(pluginKey).split("/")[0])
}

function normalizeGuobaValue(field, raw, oldRaw) {
  if (field.readOnly) throw new ConfigError(`「${field.label}」为只读配置项`)
  if (field.secret && (raw === "" || raw === null || raw === undefined)) return SKIP

  if (field.editor === "subform") {
    const schemas = field.schemas || []
    const normalizeRow = (row, oldRow) => {
      if (!isPlainObject(row)) throw new ConfigError(`「${field.label}」的每一项必须是对象`)
      const out = {}
      for (const sub of schemas) {
        let value = row[sub.key]
        if (sub.secret && (value === undefined || value === null || value === "")) {
          const stored = isPlainObject(oldRow) ? oldRow[sub.key] : undefined
          if (stored !== undefined && stored !== null && stored !== "") value = stored
        }
        if (value === undefined || value === "") {
          if (sub.required) throw new ConfigError(`「${field.label}」的「${sub.label}」不能为空`)
          continue
        }
        if (sub.type === "number") {
          const number = Number(value)
          if (!Number.isFinite(number)) throw new ConfigError(`「${field.label}」的「${sub.label}」必须是数字`)
          value = number
        } else if (sub.type === "boolean") {
          value = value === true || value === 1 || value === "1"
        } else if (sub.options?.length) {
          const option = sub.options.find(item => String(item.value) === String(value))
          if (!option) throw new ConfigError(`「${field.label}」的「${sub.label}」选项无效`)
          value = option.value
        } else value = String(value)
        out[sub.key] = value
      }
      return out
    }

    if (field.multiple === false) {
      if (!isPlainObject(raw)) throw new ConfigError(`「${field.label}」必须是对象`)
      const value = normalizeRow(raw, oldRaw)
      for (const sub of schemas)
        if (sub.required && (value[sub.key] === undefined || value[sub.key] === ""))
          throw new ConfigError(`「${field.label}」的「${sub.label}」不能为空`)
      assertSafeValue(value)
      return value
    }
    if (!Array.isArray(raw)) throw new ConfigError(`「${field.label}」必须是列表`)
    if (raw.length > 200) throw new ConfigError(`「${field.label}」条目过多`)
    const oldRows = Array.isArray(oldRaw) ? oldRaw : []
    const rows = raw.map(row => {
      const origin = isPlainObject(row) ? Number(row.__origin) : NaN
      const oldRow = Number.isInteger(origin) && origin >= 0 ? oldRows[origin] : undefined
      return normalizeRow(row, oldRow)
    })
    for (const row of rows)
      for (const sub of schemas)
        if (sub.required && (row[sub.key] === undefined || row[sub.key] === ""))
          throw new ConfigError(`「${field.label}」的「${sub.label}」不能为空`)
    assertSafeValue(rows)
    return rows
  }

  let value = raw
  if (field.type === "boolean") {
    if (typeof value !== "boolean") value = value === true || value === 1 || value === "1"
  } else if (field.type === "number") {
    const number = Number(value)
    if (!Number.isFinite(number)) throw new ConfigError(`「${field.label}」必须是数字`)
    value = number
  } else if (field.type === "array") {
    if (!Array.isArray(value)) throw new ConfigError(`「${field.label}」必须是列表`)
    value = value.map(item => String(item).trim()).filter(Boolean)
  } else if (field.type === "object") {
    if (!isPlainObject(value)) throw new ConfigError(`「${field.label}」必须是对象`)
  } else if (value !== null) {
    value = String(value)
  }

  if (field.options?.length && value !== null) {
    const option = field.options.find(item => String(item.value) === String(value))
    if (!option) throw new ConfigError(`「${field.label}」的选项无效`)
    value = option.value
  }
  if (field.required && (value === "" || value === null || value === undefined || (Array.isArray(value) && !value.length)))
    throw new ConfigError(`「${field.label}」不能为空`)

  assertSafeValue(value)
  return value
}

async function saveGuobaConfig(resolved, body) {
  const { entry, supportFile } = resolved
  const support = await getGuobaSupport(entry.key, supportFile)
  const configInfo = support.configInfo
  if (!configInfo || typeof configInfo.setConfigData !== "function")
    throw new ConfigError("该插件未提供 Guoba 配置写入能力")

  const detail = await readGuobaConfig(resolved)
  const fieldMap = new Map(detail.fields.map(field => [field.key, field]))
  const payload = {}
  const incoming = isPlainObject(body?.data) ? body.data : {}

  let stored
  try {
    stored = configInfo.getConfigData()
  } catch {
    stored = {}
  }
  if (!isPlainObject(stored)) stored = {}

  for (const [key, raw] of Object.entries(incoming)) {
    const field = fieldMap.get(key)
    if (!field) throw new ConfigError(`未知插件配置项：${key}`)
    if (field.readOnly) continue
    const value = normalizeGuobaValue(field, raw, getValueAt(stored, field.path))
    if (value === SKIP) continue
    payload[key] = value
  }

  if (!Object.keys(payload).length) return { changed: 0, message: "没有需要保存的修改" }

  const Result = {
    ok(data, message) {
      return { success: true, data, message }
    },
    fail(data, message) {
      return { success: false, data, message }
    },
  }

  let outcome
  try {
    outcome = await configInfo.setConfigData(payload, { Result })
  } catch (error) {
    throw new ConfigError(`保存插件配置失败：${error?.message || error}`, 500)
  }
  if (outcome && (outcome.success === false || outcome.ok === false))
    throw new ConfigError(outcome.message || "插件拒绝了本次配置保存", 400)

  return {
    changed: Object.keys(payload).length,
    message: outcome?.message || "插件配置已保存",
    note: detail.note,
  }
}

export async function readPluginConfig(pluginKey, id) {
  const resolved = resolvePluginConfig(pluginKey, id)
  return resolved.config.kind === "guoba" ? readGuobaConfig(resolved) : readPluginYamlConfig(resolved)
}

export async function savePluginConfig(body = {}) {
  const resolved = resolvePluginConfig(body.plugin, body.id)
  if (resolved.config.kind === "guoba") return saveGuobaConfig(resolved, body)

  const detail = readPluginYamlConfig(resolved)
  const { doc } = readDocument(resolved.file)
  const pluginDir = resolved.pluginDir
  const defaultFile = pluginDefaultFile(pluginDir, resolved.config.file)
  const defaultDoc = defaultFile ? readDocument(defaultFile).doc : null
  const changed = applyUpdates(doc, defaultDoc, detail.fields, body.updates)
  if (!changed) return { changed: 0, message: "没有需要保存的修改" }

  writeDocument(resolved.file, doc)
  return {
    changed,
    message: `已保存「${detail.title}」的 ${changed} 项配置`,
    note: detail.note,
  }
}
