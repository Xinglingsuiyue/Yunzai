import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import cfg from "../../config/config.js"
import AIToolRegistry from "../AIToolRegistry.js"

const execFileAsync = promisify(execFile)
const MAX_READ_BYTES = 512 * 1024
const MAX_READ_LINES = 2000
const DEFAULT_READ_LINES = 400
const MAX_LIST = 500
const DEFAULT_LIST = 100
const DEFAULT_TIMEOUT = 30
const MAX_TIMEOUT = 120
const MAX_OUTPUT = 12000

function enabled() {
  return cfg.ai?.enableHostAccess === true
}

const DISABLED_RESULT = { success: false, error: "主人没有开启「本机文件与命令」" }

function resolvePath(input) {
  let raw = String(input ?? "").trim()
  if (!raw) return { error: "缺少路径" }
  if (raw === "~") raw = os.homedir()
  else if (raw.startsWith("~/") || raw.startsWith("~\\")) raw = path.join(os.homedir(), raw.slice(2))
  return { abs: path.resolve(process.cwd(), raw) }
}

function clip(text, max = MAX_OUTPUT) {
  const value = String(text ?? "").trim()
  if (value.length <= max) return value
  return `${value.slice(0, max)}\n…（输出过长已截断，原长 ${value.length} 字符）`
}

function readHead(file, maxBytes) {
  const fd = fs.openSync(file, "r")
  try {
    const size = fs.fstatSync(fd).size
    const length = Math.min(maxBytes, size)
    const buffer = Buffer.alloc(length)
    if (length > 0) fs.readSync(fd, buffer, 0, length, 0)
    return { buffer, truncated: size > length }
  } finally {
    fs.closeSync(fd)
  }
}

async function readFile(args) {
  const { abs, error } = resolvePath(args?.path)
  if (error) return { success: false, error }
  let stat
  try {
    stat = fs.statSync(abs)
  } catch {
    return { success: false, error: `文件不存在：${abs}` }
  }
  if (!stat.isFile()) return { success: false, error: `不是文件：${abs}` }
  let head
  try {
    head = readHead(abs, MAX_READ_BYTES)
  } catch (err) {
    return { success: false, error: `读取失败：${err.message}` }
  }
  if (head.buffer.includes(0)) return { success: false, error: "这是二进制文件，不能按文本读取" }

  const text = head.buffer.toString("utf8").replace(/^\uFEFF/, "")
  const lines = text.split(/\r?\n/)
  const offset = Math.max(1, Math.floor(Number(args?.offset) || 1))
  const limit = Math.min(MAX_READ_LINES, Math.max(1, Math.floor(Number(args?.limit) || DEFAULT_READ_LINES)))
  const slice = lines.slice(offset - 1, offset - 1 + limit)
  const endLine = offset - 1 + slice.length
  const totalHint = head.truncated ? `${lines.length}+` : String(lines.length)
  const body = slice.join("\n").replace(/\s+$/, "")
  return {
    success: true,
    result: `文件：${abs}\n行 ${offset}-${endLine} / 共 ${totalHint} 行\n${body || "（空）"}`,
  }
}

async function listDir(args) {
  const { abs, error } = resolvePath(args?.path || ".")
  if (error) return { success: false, error }
  let entries
  let stat
  try {
    stat = fs.statSync(abs)
    entries = fs.readdirSync(abs, { withFileTypes: true })
  } catch (err) {
    return { success: false, error: `无法读取目录：${err.message}` }
  }
  if (!stat.isDirectory()) return { success: false, error: `不是目录：${abs}` }

  const limit = Math.min(MAX_LIST, Math.max(1, Math.floor(Number(args?.limit) || DEFAULT_LIST)))
  entries.sort((a, b) => {
    const da = a.isDirectory() ? 0 : 1
    const db = b.isDirectory() ? 0 : 1
    return da - db || a.name.localeCompare(b.name)
  })
  const shown = entries.slice(0, limit)
  const lines = shown.map(entry => {
    const full = path.join(abs, entry.name)
    if (entry.isDirectory()) return `${entry.name}/`
    if (entry.isSymbolicLink()) return `${entry.name} -> ${safeLink(full)}`
    try {
      const info = fs.statSync(full)
      return `${entry.name}\t${info.size} B`
    } catch {
      return entry.name
    }
  })
  return {
    success: true,
    result: `目录：${abs}（共 ${entries.length} 项）\n${lines.join("\n") || "（空）"}${
      entries.length > shown.length ? `\n…另有 ${entries.length - shown.length} 项未显示` : ""
    }`,
  }
}

function safeLink(file) {
  try {
    return fs.readlinkSync(file)
  } catch {
    return "?"
  }
}

async function runCommand(args) {
  const command = String(args?.command ?? "").trim()
  if (!command) return { success: false, error: "缺少要执行的命令" }
  let cwd = process.cwd()
  if (args?.cwd) {
    const resolved = resolvePath(args.cwd)
    if (resolved.error) return { success: false, error: resolved.error }
    cwd = resolved.abs
    try {
      if (!fs.statSync(cwd).isDirectory()) return { success: false, error: `工作目录不存在：${cwd}` }
    } catch {
      return { success: false, error: `工作目录不存在：${cwd}` }
    }
  }
  const timeoutSec = Math.min(MAX_TIMEOUT, Math.max(1, Math.floor(Number(args?.timeoutSec) || DEFAULT_TIMEOUT)))
  const options = {
    cwd,
    timeout: timeoutSec * 1000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  }

  try {
    let stdout = ""
    let stderr = ""
    if (process.platform === "win32") {
      const script =
        "$ProgressPreference='SilentlyContinue'; " +
        "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; " +
        "$OutputEncoding=[System.Text.Encoding]::UTF8; " +
        `& { ${command}\n} 2>&1 | Out-String -Width 4096; ` +
        "if ($LASTEXITCODE) { exit $LASTEXITCODE }"
      const encoded = Buffer.from(script, "utf16le").toString("base64")
      ;({ stdout, stderr } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
        options,
      ))
    } else {
      ;({ stdout, stderr } = await execFileAsync("/bin/sh", ["-c", command], options))
    }
    const output = clip([stdout, stderr].map(text => String(text || "").trim()).filter(Boolean).join("\n"))
    return { success: true, result: `退出码 0\n${output || "（无输出）"}` }
  } catch (err) {
    if (err.killed || err.signal) return { success: false, error: `命令超时（${timeoutSec} 秒）` }
    const output = clip(
      [err.stdout, err.stderr]
        .map(text => String(text || "").trim())
        .filter(Boolean)
        .join("\n"),
    )
    const code = typeof err.code === "number" ? err.code : err.code || "未知"
    const detail = output || (typeof err.code === "number" ? "" : err.message)
    return { success: false, error: `退出码 ${code}${detail ? `\n${detail}` : ""}` }
  }
}

export function registerHostTools() {
  if (!enabled()) return false

  const disabled = new Set((AIToolRegistry.builtinDisabledTools || []).map(String))
  let count = 0

  if (!disabled.has("read_file")) {
    AIToolRegistry.sources.delete("read_file")
    if (
      AIToolRegistry.registerRawTool({
        name: "read_file",
        description: [
          "【读取本机文件】按路径读取本机的文本文件内容。",
          "路径支持绝对路径或相对机器人运行目录；大文件用 offset/limit 分段读取。",
          "参数：path（必填）、offset（起始行，从 1 开始，可选）、limit（行数，默认 400，最多 2000）。",
        ].join("\n"),
        pluginName: "内置工具",
        pluginKey: "builtin:read_file",
        permission: "master",
        danger: "high",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "文件路径" },
            offset: { type: "number", description: "起始行，从 1 开始" },
            limit: { type: "number", description: "读取行数，默认 400" },
          },
          required: ["path"],
        },
        handler: async args => {
          if (!enabled()) return DISABLED_RESULT
          return readFile(args)
        },
      })
    )
      count++
  }

  if (!disabled.has("list_dir")) {
    AIToolRegistry.sources.delete("list_dir")
    if (
      AIToolRegistry.registerRawTool({
        name: "list_dir",
        description: [
          "【列出本机目录】列出目录下的文件和子目录，用来先定位文件再读取。",
          "参数：path（目录路径，默认机器人运行目录）、limit（最多条数，默认 100，最多 500）。",
        ].join("\n"),
        pluginName: "内置工具",
        pluginKey: "builtin:list_dir",
        permission: "master",
        danger: "high",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "目录路径" },
            limit: { type: "number", description: "最多返回条数，默认 100" },
          },
          required: [],
        },
        handler: async args => {
          if (!enabled()) return DISABLED_RESULT
          return listDir(args)
        },
      })
    )
      count++
  }

  if (!disabled.has("run_command")) {
    AIToolRegistry.sources.delete("run_command")
    if (
      AIToolRegistry.registerRawTool({
        name: "run_command",
        description: [
          "【执行本机命令】在机器人所在电脑上执行一条命令并返回输出。",
          "Windows 走 PowerShell，Linux/macOS 走 /bin/sh；可指定工作目录和超时。",
          "参数：command（必填）、cwd（工作目录，可选）、timeoutSec（超时秒数，默认 30，最多 120）。",
        ].join("\n"),
        pluginName: "内置工具",
        pluginKey: "builtin:run_command",
        permission: "master",
        danger: "high",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string", description: "要执行的命令" },
            cwd: { type: "string", description: "工作目录，可选" },
            timeoutSec: { type: "number", description: "超时秒数，默认 30" },
          },
          required: ["command"],
        },
        handler: async args => {
          if (!enabled()) return DISABLED_RESULT
          return runCommand(args)
        },
      })
    )
      count++
  }

  return count > 0
}
