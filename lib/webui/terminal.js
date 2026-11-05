import { spawn, spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const BASE_DIR = path.dirname(fileURLToPath(import.meta.url))
const RC_FILE = path.join(BASE_DIR, "terminal-rc.bash")
const PROJECT_ROOT = path.resolve(BASE_DIR, "..", "..")

const MAX_CLIENT_SESSIONS = 4
const MAX_TOTAL_SESSIONS = 12
const MAX_INPUT_BYTES = 16 * 1024
const MAX_HISTORY_BYTES = 64 * 1024
const MAX_PRE_BYTES = 64 * 1024
const READY_TIMEOUT = 8000
const READY_MARKER = "\x1eYUNZAI_TERM_READY\x1e"
const READY_COMMAND =
  "printf '\\036YUNZAI_TERM_PID:%s\\036' \"$(cat /proc/$$/winpid 2>/dev/null || echo 0)\"; printf '\\036YUNZAI_TERM_READY\\036'\n"
const SHELL_PID_RE = /\x1eYUNZAI_TERM_PID:(\d+)\x1e/
const SHELL_PID_STRIP = /\x1eYUNZAI_TERM_PID:\d+\x1e/g
const PING_INTERVAL = 20 * 1000
const SWEEP_INTERVAL = 30 * 1000
const IDLE_TIMEOUT = 60 * 60 * 1000
const DETACHED_TIMEOUT = 10 * 60 * 1000
const EXITED_KEEP = 10 * 60 * 1000
const OUTPUT_FLUSH_DELAY = 16
const OUTPUT_FLUSH_SIZE = 32 * 1024

const sessions = new Map()
const streams = new Map()
let sweepTimer = null
let exitHookInstalled = false

function logTerminal(message, error) {
  try {
    globalThis.Bot?.makeLog("error", ["WebUI 终端", message, error], "WebUI")
  } catch {}
}

function terminalError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function normalizeClientId(value) {
  const id = String(value || "").trim()
  return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : ""
}

function isActive(session) {
  return session.status === "starting" || session.status === "running"
}

function findBash() {
  const custom = String(process.env.YUNZAI_TERM_SHELL || "").trim()
  if (custom && fs.existsSync(custom)) return custom
  if (process.platform !== "win32") {
    for (const file of ["/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash"])
      if (fs.existsSync(file)) return file
    return ""
  }
  const roots = [process.env.MSYS2_ROOT, "C:\\msys64", "C:\\msys32"]
  if (process.env.ProgramFiles) {
    roots.push(path.join(process.env.ProgramFiles, "Git"))
    roots.push(path.join(process.env.ProgramFiles, "Git", "usr"))
  }
  for (const root of roots) {
    if (!root) continue
    for (const file of [path.join(root, "usr", "bin", "bash.exe"), path.join(root, "bin", "bash.exe")])
      if (fs.existsSync(file)) return file
  }
  return ""
}

function findScript(bash) {
  const exe = process.platform === "win32" ? "script.exe" : "script"
  const candidates = [path.join(path.dirname(bash), exe)]
  if (process.platform === "win32") {
    candidates.push(path.join(path.dirname(bash), "..", "usr", "bin", exe))
    candidates.push("C:\\msys64\\usr\\bin\\script.exe")
  } else {
    candidates.push("/usr/bin/script", "/bin/script")
  }
  return candidates.find(file => fs.existsSync(file)) || ""
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function doubleQuote(value) {
  return `"${String(value).replace(/(["\\$`])/g, "\\$1")}"`
}

function toPosixPath(filePath) {
  let value = String(filePath).replace(/\\/g, "/")
  const match = /^([A-Za-z]):\//.exec(value)
  if (match) value = `/${match[1].toLowerCase()}${value.slice(2)}`
  return value
}

function buildShell() {
  const bash = findBash()
  if (bash) {
    const normalized = bash.replace(/\\/g, "/")
    const rc = RC_FILE.replace(/\\/g, "/")
    const script = findScript(bash)
    if (script) {
      const inner = `${shellQuote(normalized)} --noprofile --rcfile ${shellQuote(rc)}`
      return {
        kind: "bash",
        pty: true,
        command: bash,
        args: ["-lc", `exec script -q -c ${doubleQuote(inner)} /dev/null`],
      }
    }
    return {
      kind: "bash",
      pty: false,
      command: bash,
      args: ["--noprofile", "--rcfile", RC_FILE, "-i"],
    }
  }
  if (process.platform === "win32")
    return {
      kind: "cmd",
      pty: false,
      command: process.env.ComSpec || "cmd.exe",
      args: ["/Q", "/K", "chcp 65001>nul"],
    }
  return { kind: "sh", pty: false, command: "/bin/sh", args: ["-i"] }
}

function buildEnv() {
  const env = {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    TERM_PROGRAM: "Yunzai-WebUI",
    YUNZAI_NODE_DIR: toPosixPath(path.dirname(process.execPath)),
    // msys2 登录 profile 在 SHLVL<=1 且无 CHERE_INVOKING 时会 cd 到 HOME，
    // 按 msys2 约定声明保留启动目录，否则终端会跑到用户主目录。
    CHERE_INVOKING: "1",
  }
  const locale = env.LC_ALL || env.LANG || ""
  if (!/utf-?8/i.test(locale)) {
    env.LANG = "zh_CN.UTF-8"
    env.LC_ALL = "zh_CN.UTF-8"
  }
  return env
}

function snapshot(session, withHistory) {
  const data = {
    id: session.id,
    name: session.name,
    status: session.status,
    ready: session.ready,
    pty: session.pty,
    echo: !session.pty,
    exitCode: session.exitCode,
    signal: session.signal,
    createdAt: session.createdAt,
  }
  if (withHistory) data.history = session.history.join("")
  return data
}

function broadcastToClient(clientId, event, data) {
  const entry = streams.get(clientId)
  if (entry) entry.send(event, data)
}

function trimHistory(session) {
  while (session.historyBytes > MAX_HISTORY_BYTES && session.history.length) {
    if (session.history.length === 1) {
      const tail = session.history[0].slice(-MAX_HISTORY_BYTES)
      session.history[0] = tail
      session.historyBytes = Buffer.byteLength(tail)
      return
    }
    const first = session.history.shift()
    session.historyBytes -= Buffer.byteLength(first)
  }
}

function appendHistory(session, text) {
  session.history.push(text)
  session.historyBytes += Buffer.byteLength(text)
  trimHistory(session)
}

function flushOutput(session) {
  if (session.outTimer) {
    clearTimeout(session.outTimer)
    session.outTimer = null
  }
  if (!session.pending) return
  const data = session.pending
  session.pending = ""
  broadcastToClient(session.clientId, "output", { sessionId: session.id, data })
}

function queueOutput(session, text) {
  session.pending += text
  if (session.pending.length >= OUTPUT_FLUSH_SIZE) return flushOutput(session)
  if (!session.outTimer)
    session.outTimer = setTimeout(() => {
      session.outTimer = null
      flushOutput(session)
    }, OUTPUT_FLUSH_DELAY)
}

function captureShellPid(session, text) {
  const match = SHELL_PID_RE.exec(text)
  if (match) session.innerPid = Number(match[1]) || 0
  return text.replace(SHELL_PID_STRIP, "")
}

function forceReady(session) {
  if (session.ready) return
  session.ready = true
  if (session.readyTimer) {
    clearTimeout(session.readyTimer)
    session.readyTimer = null
  }
  const rest = captureShellPid(session, session.pre).replace(READY_MARKER, "")
  session.pre = ""
  session.preBytes = 0
  if (rest) {
    appendHistory(session, rest)
    queueOutput(session, rest)
  }
  broadcastToClient(session.clientId, "update", snapshot(session, false))
}

function ingest(session, text) {
  if (session.closed) return
  session.lastActive = Date.now()
  if (!session.ready) {
    session.pre += text
    session.preBytes += Buffer.byteLength(text)
    const index = session.pre.indexOf(READY_MARKER)
    if (index === -1) {
      if (session.preBytes > MAX_PRE_BYTES) {
        const start = Math.max(0, session.pre.length - MAX_PRE_BYTES)
        session.pre = session.pre.slice(start)
        session.preBytes = Buffer.byteLength(session.pre)
      }
      return
    }
    const rest = session.pre
      .slice(index + READY_MARKER.length)
      .replace(SHELL_PID_STRIP, "")
    captureShellPid(session, session.pre.slice(0, index))
    session.pre = ""
    session.preBytes = 0
    session.ready = true
    if (session.readyTimer) {
      clearTimeout(session.readyTimer)
      session.readyTimer = null
    }
    if (rest) {
      appendHistory(session, rest)
      queueOutput(session, rest)
    }
    broadcastToClient(session.clientId, "update", snapshot(session, false))
    return
  }
  appendHistory(session, text)
  queueOutput(session, text)
}

// Windows 下 script.exe 内层 bash 的父进程关系不可靠，taskkill /T 常漏杀，
// 因此用 ready 阶段回传的 Windows PID 精确定位内层 shell。
function killTree(pid, sync) {
  if (!pid) return
  const args = ["/PID", String(pid), "/T", "/F"]
  if (sync) {
    try {
      spawnSync("taskkill", args, { windowsHide: true, stdio: "ignore", timeout: 2000 })
    } catch {}
    return
  }
  try {
    spawn("taskkill", args, { windowsHide: true, stdio: "ignore", detached: true }).unref()
  } catch (error) {
    logTerminal("结束终端进程失败", error)
  }
}

function killProcess(session) {
  const child = session.child
  if (!child?.pid) return
  if (process.platform === "win32") {
    killTree(child.pid, false)
    if (session.innerPid && session.innerPid !== child.pid) killTree(session.innerPid, false)
    return
  }
  try {
    process.kill(-child.pid, "SIGKILL")
  } catch (error) {
    try {
      child.kill("SIGKILL")
    } catch (fallbackError) {
      logTerminal("结束终端进程失败", fallbackError)
    }
  }
}

// Cygwin 的 fork 子进程不保证挂在 taskkill /T 的进程树上，
// 因此先让 shell 自己中断前台命令并退出，再按 PID 兜底强制清理。
function terminateSession(session, wasActive) {
  const child = session.child
  if (!child?.pid) return
  if (process.platform !== "win32") {
    killProcess(session)
    return
  }
  if (!wasActive || !child.stdin?.writable) {
    killProcess(session)
    return
  }
  try {
    child.stdin.write("\x03")
  } catch {}
  const exitTimer = setTimeout(() => {
    try {
      if (child.stdin.writable) child.stdin.write("exit\r")
    } catch {}
  }, 200)
  exitTimer.unref?.()
  const forceTimer = setTimeout(() => {
    killProcess(session)
  }, 900)
  forceTimer.unref?.()
}

function disposeSession(session) {
  if (session.readyTimer) clearTimeout(session.readyTimer)
  if (session.outTimer) clearTimeout(session.outTimer)
  session.readyTimer = null
  session.outTimer = null
  sessions.delete(session.id)
}

function closeSession(session, reason) {
  if (session.closed) return
  const wasActive = isActive(session)
  session.closed = true
  session.status = "closed"
  flushOutput(session)
  if (session.outTimer) {
    clearTimeout(session.outTimer)
    session.outTimer = null
  }
  disposeSession(session)
  broadcastToClient(session.clientId, "closed", { sessionId: session.id, reason })
  terminateSession(session, wasActive)
}

function nextSessionName() {
  const used = new Set()
  for (const session of sessions.values()) {
    const match = /^终端 (\d+)$/.exec(session.name)
    if (match) used.add(Number(match[1]))
  }
  let seq = 1
  while (used.has(seq)) seq++
  return `终端 ${seq}`
}

function createSession(clientId, requestedName) {
  const owned = [...sessions.values()].filter(session => session.clientId === clientId && isActive(session))
  if (owned.length >= MAX_CLIENT_SESSIONS)
    throw terminalError(429, `同一客户端最多同时运行 ${MAX_CLIENT_SESSIONS} 个终端`)

  if (sessions.size >= MAX_TOTAL_SESSIONS) {
    const exited = [...sessions.values()].filter(session => !isActive(session)).sort((a, b) => a.exitedAt - b.exitedAt)[0]
    if (exited) disposeSession(exited)
  }
  if (sessions.size >= MAX_TOTAL_SESSIONS)
    throw terminalError(429, `终端总数已达上限（${MAX_TOTAL_SESSIONS} 个），请先关闭不再使用的终端`)

  const shell = buildShell()
  const id = crypto.randomBytes(8).toString("hex")
  const child = spawn(shell.command, shell.args, {
    cwd: PROJECT_ROOT,
    env: buildEnv(),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  })

  const session = {
    id,
    clientId,
    name: requestedName || nextSessionName(),
    child,
    shellKind: shell.kind,
    pty: shell.pty,
    status: "starting",
    ready: false,
    exitCode: null,
    signal: "",
    history: [],
    historyBytes: 0,
    pending: "",
    outTimer: null,
    pre: "",
    preBytes: 0,
    stdoutDecoder: new TextDecoder("utf-8"),
    stderrDecoder: new TextDecoder("utf-8"),
    createdAt: Date.now(),
    lastActive: Date.now(),
    detachedAt: 0,
    exitedAt: 0,
    innerPid: 0,
    readyTimer: null,
    closed: false,
  }

  session.readyTimer = setTimeout(() => forceReady(session), READY_TIMEOUT)
  session.readyTimer.unref?.()
  sessions.set(id, session)
  startSweep()

  child.on("spawn", () => {
    session.status = "running"
    if (shell.kind === "bash") {
      try {
        child.stdin.write(READY_COMMAND)
      } catch (error) {
        logTerminal("终端初始化失败", error)
      }
    } else {
      const timer = setTimeout(() => forceReady(session), 600)
      timer.unref?.()
    }
    broadcastToClient(clientId, "update", snapshot(session, false))
  })

  child.stdout.on("data", chunk => {
    const text = session.stdoutDecoder.decode(chunk, { stream: true })
    if (text) ingest(session, text)
  })
  child.stderr.on("data", chunk => {
    const text = session.stderrDecoder.decode(chunk, { stream: true })
    if (text) ingest(session, text)
  })

  child.stdin.on("error", () => {})

  child.on("error", error => {
    if (session.closed) return
    session.status = "error"
    session.exitedAt = Date.now()
    if (session.readyTimer) {
      clearTimeout(session.readyTimer)
      session.readyTimer = null
    }
    const message = `\r\n\x1b[31m[终端启动失败] ${error.message}\x1b[0m\r\n`
    session.ready = true
    appendHistory(session, message)
    queueOutput(session, message)
    flushOutput(session)
    broadcastToClient(clientId, "exit", { sessionId: id, code: null, signal: "error", message: error.message })
    logTerminal("终端启动失败", error)
  })

  child.on("exit", (code, signal) => {
    if (session.closed) return
    session.status = "exited"
    session.exitCode = typeof code === "number" ? code : null
    session.signal = signal || ""
    session.exitedAt = Date.now()
    if (!session.ready) forceReady(session)
    flushOutput(session)
    broadcastToClient(clientId, "exit", { sessionId: id, code: session.exitCode, signal: session.signal })
  })

  if (!exitHookInstalled) {
    exitHookInstalled = true
    process.once("exit", () => {
      for (const item of sessions.values()) {
        if (!item.child?.pid) continue
        if (process.platform === "win32") {
          killTree(item.child.pid, true)
          if (item.innerPid && item.innerPid !== item.child.pid) killTree(item.innerPid, true)
        } else {
          try {
            process.kill(-item.child.pid, "SIGKILL")
          } catch {}
        }
      }
    })
  }

  return session
}

function startSweep() {
  if (sweepTimer) return
  sweepTimer = setInterval(sweep, SWEEP_INTERVAL)
  sweepTimer.unref?.()
}

function sweep() {
  const now = Date.now()
  for (const session of [...sessions.values()]) {
    if (!isActive(session)) {
      if (now - session.exitedAt > EXITED_KEEP) disposeSession(session)
      continue
    }
    if (!streams.has(session.clientId)) {
      if (!session.detachedAt) session.detachedAt = now
      else if (now - session.detachedAt > DETACHED_TIMEOUT) closeSession(session, "detached")
    } else if (session.detachedAt) {
      session.detachedAt = 0
    }
    if (isActive(session) && now - session.lastActive > IDLE_TIMEOUT) closeSession(session, "idle")
  }
  if (!sessions.size && sweepTimer) {
    clearInterval(sweepTimer)
    sweepTimer = null
  }
}

function ownedSession(req, res, clientId, fail) {
  const session = sessions.get(String(req.params.id || ""))
  if (!session || session.clientId !== clientId) {
    fail(res, 404, "终端不存在或已关闭")
    return null
  }
  return session
}

export function registerTerminalRoutes(router, helpers) {
  const { initSSE, writeSSE, fail } = helpers

  router.post("/terminal/stream", (req, res) => {
    const clientId = normalizeClientId(req.body?.clientId)
    if (!clientId) return fail(res, 400, "缺少有效的客户端标识")

    const previous = streams.get(clientId)
    if (previous) {
      clearInterval(previous.pingTimer)
      if (previous.res !== res) {
        try {
          previous.send("replaced", {})
        } catch {}
        try {
          previous.res.end()
        } catch {}
      }
    }

    initSSE(res)
    const entry = {
      clientId,
      res,
      pingTimer: null,
      send(event, data) {
        writeSSE(res, event, data)
      },
    }
    streams.set(clientId, entry)
    for (const session of sessions.values())
      if (session.clientId === clientId) session.detachedAt = 0

    writeSSE(res, "hello", {
      sessions: [...sessions.values()]
        .filter(session => session.clientId === clientId)
        .map(session => snapshot(session, true)),
      now: Date.now(),
    })

    entry.pingTimer = setInterval(() => writeSSE(res, "ping", { time: Date.now() }), PING_INTERVAL)
    entry.pingTimer.unref?.()

    const cleanup = () => {
      clearInterval(entry.pingTimer)
      if (streams.get(clientId) === entry) streams.delete(clientId)
      if (!streams.has(clientId))
        for (const session of sessions.values())
          if (session.clientId === clientId) session.detachedAt = Date.now()
    }
    res.on("close", cleanup)
    res.on("error", cleanup)
  })

  router.post("/terminal/sessions", (req, res) => {
    const clientId = normalizeClientId(req.body?.clientId)
    if (!clientId) return fail(res, 400, "缺少有效的客户端标识")
    const name = String(req.body?.name || "").trim().slice(0, 40)
    try {
      const session = createSession(clientId, name)
      const data = snapshot(session, false)
      broadcastToClient(clientId, "created", { session: data })
      res.status(201).json({ ok: true, session: data })
    } catch (error) {
      fail(res, error.status || 500, error.message || "无法创建终端")
    }
  })

  router.post("/terminal/sessions/:id/input", (req, res) => {
    const clientId = normalizeClientId(req.body?.clientId)
    if (!clientId) return fail(res, 400, "缺少有效的客户端标识")
    const data = req.body?.data
    if (typeof data !== "string" || !data) return fail(res, 400, "缺少输入内容")
    if (Buffer.byteLength(data) > MAX_INPUT_BYTES) return fail(res, 413, "单次输入内容过长")
    const session = ownedSession(req, res, clientId, fail)
    if (!session) return
    if (!isActive(session) || !session.child?.stdin?.writable) return fail(res, 409, "终端已退出")
    session.lastActive = Date.now()
    try {
      session.child.stdin.write(data)
    } catch (error) {
      return fail(res, 500, "写入终端失败")
    }
    res.json({ ok: true })
  })

  router.post("/terminal/sessions/:id/close", (req, res) => {
    const clientId = normalizeClientId(req.body?.clientId)
    if (!clientId) return fail(res, 400, "缺少有效的客户端标识")
    const session = ownedSession(req, res, clientId, fail)
    if (!session) return
    closeSession(session, "user")
    res.json({ ok: true })
  })
}
