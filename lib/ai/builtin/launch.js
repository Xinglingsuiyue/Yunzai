import fs from "node:fs"
import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"
import cfg from "../../config/config.js"
import AIToolRegistry from "../AIToolRegistry.js"

const execFileAsync = promisify(execFile)
const LAUNCH_TIMEOUT = 5000
const RESOLVE_TIMEOUT = 8000
const SCAN_TIMEOUT = 15000
const MAX_CANDIDATES = 30
const START_APPS_TTL = 30000

let startAppsCache = { at: 0, list: [] }

function enabled() {
  return cfg.ai?.enableLaunchProgram === true
}

async function runPowerShell(script, timeout = RESOLVE_TIMEOUT) {
  const encoded = Buffer.from(
    `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ${script}`,
    "utf16le",
  ).toString("base64")
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 },
  )
  return String(stdout || "").trim()
}

function asJsonList(text) {
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
}

async function startMenuApps() {
  if (startAppsCache.list.length && Date.now() - startAppsCache.at < START_APPS_TTL)
    return startAppsCache.list
  const text = await runPowerShell(
    "Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress",
  ).catch(() => "")
  const list = asJsonList(text).filter(item => item?.Name && item?.AppID)
  startAppsCache = { at: Date.now(), list }
  return list
}

async function commandPathOf(command) {
  if (/[\\/]/.test(command)) return fs.existsSync(command) ? command : ""
  const names = /\.[a-z0-9]+$/i.test(command) ? [command] : [command, `${command}.exe`]
  for (const name of names) {
    try {
      const { stdout } = await execFileAsync("where.exe", [name], {
        windowsHide: true,
        timeout: RESOLVE_TIMEOUT,
      })
      const first = String(stdout || "")
        .split(/\r?\n/)
        .map(item => item.trim())
        .find(item => item && fs.existsSync(item) && /\.(exe|com)$/i.test(item))
      if (first) return first
    } catch {}
  }
  return ""
}

async function whereSearchOf(keyword) {
  try {
    const { stdout } = await execFileAsync("where.exe", [`*${keyword}*`], {
      windowsHide: true,
      timeout: RESOLVE_TIMEOUT,
      maxBuffer: 4 * 1024 * 1024,
    })
    return String(stdout || "")
      .split(/\r?\n/)
      .map(item => item.trim())
      .filter(item => item && fs.existsSync(item) && /\.(exe|com)$/i.test(item))
  } catch {
    return []
  }
}

async function scanInstallDirs(keyword) {
  if (!keyword) return []
  const pattern = `*${String(keyword).replace(/'/g, "''")}*.exe`
  const script = [
    '$roots=@($env:ProgramFiles, ${env:ProgramFiles(x86)}, ($env:LOCALAPPDATA + "\\Programs")) | Where-Object { $_ -and (Test-Path $_) }',
    `Get-ChildItem -Path $roots -Filter '${pattern}' -File -Recurse -Depth 3 -ErrorAction SilentlyContinue | Select-Object -First ${MAX_CANDIDATES} -ExpandProperty FullName | ConvertTo-Json -Compress`,
  ].join("; ")
  const text = await runPowerShell(script, SCAN_TIMEOUT).catch(() => "")
  return asJsonList(text)
    .map(item => String(item || "").trim())
    .filter(Boolean)
}

function appLabel(app) {
  return `${app.Name}（AppID: ${app.AppID}）`
}

async function resolveProgram(program) {
  const value = String(program || "").trim()
  if (!value) return { error: "缺少程序名、完整路径或 AppID" }

  const apps = await startMenuApps().catch(() => [])
  const byId = apps.find(item => String(item.AppID).toLowerCase() === value.toLowerCase())
  if (byId)
    return /[\\/]/.test(value) && fs.existsSync(value)
      ? { path: value }
      : { appId: byId.AppID, appName: byId.Name }
  if (value.includes("!") || /^\{[0-9A-Fa-f-]{36}\}/.test(value))
    return { appId: value, appName: value }
  if (/[\\/]/.test(value))
    return fs.existsSync(value) ? { path: value } : { error: `程序不存在：${value}` }

  const lower = value.toLowerCase()
  const exact = apps.filter(item => String(item.Name).trim().toLowerCase() === lower)
  const matches = exact.length
    ? exact
    : apps.filter(item => String(item.Name).toLowerCase().includes(lower))
  if (matches.length === 1) return { appId: matches[0].AppID, appName: matches[0].Name }
  if (matches.length > 1) {
    const list = matches.slice(0, 8).map(appLabel).join("、")
    return { error: `「${value}」匹配到多个程序：${list}。请改用完整路径或 AppID。` }
  }

  const path = await commandPathOf(value)
  if (path) return { path }

  const found = await whereSearchOf(value)
  if (found.length === 1) return { path: found[0] }
  if (found.length > 1)
    return { error: `找到多个可执行文件：${found.slice(0, 8).join("、")}。请改用完整路径。` }
  return { error: `找不到程序「${value}」，可以先用 find_program 查找正确的名称或路径。` }
}

async function spawnProgram(command, args, options = {}) {
  const child = options.appId
    ? spawn("explorer.exe", [`shell:AppsFolder\\${options.appId}`], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      })
    : spawn(command, args, {
        cwd: options.cwd || process.cwd(),
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      })
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("启动超时")), LAUNCH_TIMEOUT)
      child.once("spawn", () => {
        clearTimeout(timer)
        resolve()
      })
      child.once("error", err => {
        clearTimeout(timer)
        reject(err)
      })
    })
  } catch (err) {
    return { success: false, error: `启动失败：${err.message}` }
  }
  child.unref()
  return { success: true, child }
}

async function launchProgram(args) {
  const program = String(args?.program || "").trim()
  const list = Array.isArray(args?.args)
    ? args.args.map(String)
    : args?.args
      ? [String(args.args)]
      : []
  const cwd = String(args?.cwd || "").trim()
  const target = await resolveProgram(program)
  if (target.error) return { success: false, error: target.error }

  if (target.appId) {
    if (list.length)
      return {
        success: false,
        error: "通过开始菜单启动的程序不支持启动参数，需要参数时请改用完整路径。",
      }
    const outcome = await spawnProgram(null, [], { appId: target.appId })
    if (!outcome.success) return outcome
    return { success: true, result: `已启动 ${target.appName || program}` }
  }

  const outcome = await spawnProgram(target.path, list, { cwd })
  if (!outcome.success) return outcome
  return { success: true, result: `已启动 ${program}（PID ${outcome.child.pid}）` }
}

const DISABLED_RESULT = { success: false, error: "主人没有开启「允许 AI 启动和查找本机程序」" }

export function registerLaunchTools() {
  if (!enabled()) return false

  const disabled = new Set((AIToolRegistry.builtinDisabledTools || []).map(String))
  let count = 0

  if (!disabled.has("find_program")) {
    AIToolRegistry.sources.delete("find_program")
    if (
      AIToolRegistry.registerRawTool({
        name: "find_program",
        description: [
          "【查找本机程序】按关键词查找已安装的程序和可执行文件。",
          "会在开始菜单、PATH 和常见安装目录里搜索；关键词留空时列出开始菜单里的程序。",
          "查到名称、AppID 或完整路径后，再用 launch_program 启动。",
          "参数：keyword（程序名或关键词，可选）。",
        ].join("\n"),
        pluginName: "内置工具",
        pluginKey: "builtin:find_program",
        permission: "master",
        danger: "high",
        parameters: {
          type: "object",
          properties: {
            keyword: { type: "string", description: "程序名或关键词，留空列出开始菜单程序" },
          },
          required: [],
        },
        handler: async args => {
          if (!enabled()) return DISABLED_RESULT
          const keyword = String(args?.keyword || "").trim()
          const lower = keyword.toLowerCase()
          const apps = (await startMenuApps().catch(() => [])).filter(item =>
            lower ? String(item.Name).toLowerCase().includes(lower) : true,
          )
          const paths = keyword ? await whereSearchOf(keyword) : []
          const scanned =
            keyword && !apps.length && !paths.length ? await scanInstallDirs(keyword) : []

          const seen = new Set()
          const lines = []
          const push = (key, line) => {
            if (seen.has(key)) return
            seen.add(key)
            lines.push(line)
          }
          for (const app of apps) push(`app:${String(app.AppID).toLowerCase()}`, appLabel(app))
          for (const item of [...paths, ...scanned]) push(`path:${item.toLowerCase()}`, item)

          if (!lines.length)
            return {
              success: false,
              error: keyword ? `没有找到包含「${keyword}」的程序` : "没有找到可用的程序",
            }
          const shown = lines.slice(0, MAX_CANDIDATES)
          return {
            success: true,
            result: `找到 ${lines.length} 个程序：\n${shown.join("\n")}${
              lines.length > shown.length ? `\n…另有 ${lines.length - shown.length} 个未显示` : ""
            }`,
          }
        },
      })
    )
      count++
  }

  if (!disabled.has("launch_program")) {
    AIToolRegistry.sources.delete("launch_program")
    if (
      AIToolRegistry.registerRawTool({
        name: "launch_program",
        description: [
          "【启动本机程序】按主人的要求启动本机程序，可以带启动参数。",
          "program 支持程序名、完整路径或 find_program 返回的 AppID；名称不唯一时会返回候选，需要先确认。",
          "通过开始菜单启动的程序不支持参数，需要参数时请使用完整路径。",
          "参数：program（必填）、args（参数数组，可选）、cwd（工作目录，可选）。",
        ].join("\n"),
        pluginName: "内置工具",
        pluginKey: "builtin:launch_program",
        permission: "master",
        danger: "high",
        parameters: {
          type: "object",
          properties: {
            program: { type: "string", description: "程序名、完整路径或 AppID" },
            args: {
              type: "array",
              items: { type: "string" },
              description: "启动参数，可选",
            },
            cwd: { type: "string", description: "工作目录，可选" },
          },
          required: ["program"],
        },
        handler: async args => {
          if (!enabled()) return DISABLED_RESULT
          return launchProgram(args)
        },
      })
    )
      count++
  }

  return count > 0
}
