import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import Renderer from "../renderer/loader.js"
import cfg from "../config/config.js"

const tplFile = fileURLToPath(new URL("./resources/status.html", import.meta.url))
const pluginRoot = fileURLToPath(new URL("../../plugins/", import.meta.url))
const IS_WIN = process.platform === "win32"

const RING_W = 104
const RING_GAP = 8
const RING_STROKE = 11
const RING_PERIMETER = 3.14 * (RING_W - RING_GAP - RING_STROKE)

const PLATFORM_NAME = { win32: "Windows", linux: "Linux", darwin: "macOS" }


function execText(command, args, timeout = 8000) {
  return new Promise(resolve => {
    execFile(command, args, { timeout, maxBuffer: 8 * 1024 * 1024, encoding: "buffer" }, (err, stdout) => {
      if (!stdout?.length) return resolve("")
      try {
        resolve(new TextDecoder(IS_WIN ? "gbk" : "utf-8").decode(stdout))
      } catch {
        resolve(Buffer.from(stdout).toString("utf8"))
      }
    })
  })
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function parseCsv(text) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && line.includes(","))
  if (lines.length < 2) return []
  const header = lines[0].replace(/^\uFEFF/, "").split(",").map(cell => cell.trim())
  return lines.slice(1).map(line => {
    const cells = line.split(",")
    const row = {}
    header.forEach((key, index) => {
      row[key] = (cells[index] ?? "").trim()
    })
    return row
  })
}

function fileSize(bytes, digits = 2) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value <= 0) return "0 B"
  const units = ["B", "K", "M", "G", "T"]
  let index = 0
  let size = value
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index++
  }
  if (index === 0) return `${Math.round(size)} B`
  return `${size.toFixed(digits)} ${units[index]}B`
}

function fileSizeParts(bytes) {
  const text = fileSize(bytes)
  const matched = text.match(/^([\d.]+)\s*(.+)$/)
  return matched ? { size: matched[1], unit: matched[2] } : { size: "0", unit: "B" }
}

function humanDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—"
  const total = Math.floor(ms / 1000)
  const day = Math.floor(total / 86400)
  const hour = Math.floor((total % 86400) / 3600)
  const min = Math.floor((total % 3600) / 60)
  const sec = total % 60
  if (day) return `${day}天${hour}时`
  if (hour) return `${hour}时${min}分`
  if (min) return `${min}分${sec}秒`
  return `${sec}秒`
}

function clockText(date = new Date()) {
  const pad = value => String(value).padStart(2, "0")
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function fullClock(date = new Date()) {
  const pad = value => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function ring(percent, medium = 80) {
  const value = Number(percent) || 0
  const ratio = Math.max(0, Math.min(1, value / 100))
  const color = value >= 90 ? "#d73403" : value >= medium ? "#ffa500" : "#84A0DF"
  return { color, dash: (RING_PERIMETER - RING_PERIMETER * ratio).toFixed(1) }
}

async function collectCpuLoad() {
  return cpuUsage(300)
}

async function cpuUsage(sampleMs = 300) {
  const start = await cpuSnapshot()
  await sleep(sampleMs)
  const now = await cpuSnapshot()
  if (!start || !now) return await selfCpuPercent()
  let idle = now.idle - start.idle
  let total = now.total - start.total
  if (!(total > 0) || idle < 0 || total < idle) return await selfCpuPercent()
  return Math.max(0, Math.min(100, (1 - idle / total) * 100))
}

async function cpuSnapshot() {
  const fromProc = await readProcStat()
  if (fromProc) return fromProc
  return readNodeCpuTimes()
}

function readNodeCpuTimes() {
  let list
  try {
    list = os.cpus()
  } catch {
    return null
  }
  if (!Array.isArray(list) || !list.length) return null
  let idle = 0
  let total = 0
  for (const cpu of list) {
    const times = cpu?.times || {}
    for (const value of Object.values(times)) total += Number(value) || 0
    idle += Number(times.idle) || 0
  }
  return total > 0 ? { idle, total, elapsed: process.hrtime.bigint() } : null
}

async function readProcStat() {
  try {
    const text = await fs.readFile("/proc/stat", "utf8")
    const line = text.split("\n").find(row => row.startsWith("cpu "))
    if (!line) return null
    const nums = line.trim().split(/\s+/).slice(1).map(Number)
    if (nums.length < 4 || nums.some(value => !Number.isFinite(value))) return null
    const idle = (nums[3] || 0) + (nums[4] || 0)
    const total = nums.reduce((sum, value) => sum + value, 0)
    return total > 0 ? { idle, total, elapsed: process.hrtime.bigint() } : null
  } catch {
    return null
  }
}

let selfCpuBaseline = null
let lastSelfUsage = 0
async function selfCpuPercent() {
  const usage = process.cpuUsage()
  const nowNs = process.hrtime.bigint()
  const point = { cpuNs: (usage.user + usage.system) * 1000, wallNs: nowNs }
  if (!selfCpuBaseline) {
    selfCpuBaseline = point
    return lastSelfUsage
  }
  const wallNs = Number(point.wallNs - selfCpuBaseline.wallNs)
  const cpuNs = point.cpuNs - selfCpuBaseline.cpuNs
  selfCpuBaseline = point
  if (!(wallNs > 0)) return lastSelfUsage
  const cores = await cpuCount()
  const percent = Math.max(0, Math.min(100 * cores, (cpuNs / wallNs) * 100))
  lastSelfUsage = percent
  return percent
}

let cachedProcCpu = null
async function readProcCpuInfo() {
  if (cachedProcCpu) return cachedProcCpu
  const info = { cores: 0, model: "", mhz: 0 }
  try {
    const text = await fs.readFile("/proc/cpuinfo", "utf8")
    info.cores = (text.match(/^processor\s*:/gm) || []).length
    const field = names => {
      for (const name of names) {
        const matched = text.match(new RegExp(`^\\s*${name}\\s*:\\s*(.+)$`, "m"))
        if (matched) return matched[1].trim()
      }
      return ""
    }
    info.model = field(["Hardware", "model name", "Processor", "cpu model"])
    info.mhz = Number(field(["cpu MHz", "clock"])) || 0
  } catch {}
  cachedProcCpu = info
  return info
}

async function readCpuFreq() {
  try {
    const text = await fs.readFile("/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq", "utf8")
    const khz = Number(text.trim())
    if (khz > 0) return khz / 1000
  } catch {}
  return 0
}

let cachedCpuCount = 0
async function cpuCount() {
  if (cachedCpuCount > 0) return cachedCpuCount
  let count = 0
  try {
    count = os.cpus()?.length || 0
  } catch {}
  const info = await readProcCpuInfo()
  if (info.cores > count) count = info.cores
  if (!count) count = Number(process.env.NUMBER_OF_PROCESSORS) || Number(process.env.NUM) || 1
  cachedCpuCount = Math.max(1, count)
  return cachedCpuCount
}


function shortCpuName(name) {
  return String(name || "")
    .replace(/\((R|TM|C)\)/gi, "")
    .replace(/Qualcomm\s+Technologies,?\s*Inc\.?/gi, "Qualcomm")
    .replace(/\b(GenuineIntel|AuthenticAMD|Intel|AMD)\b/gi, "")
    .replace(/\bCPU\b|\bProcessor\b/gi, "")
    .replace(/@.*$/, "")
    .replace(/\s+/g, " ")
    .trim()
}

function cpuManufacturer(name) {
  if (/intel/i.test(name)) return "Intel"
  if (/amd/i.test(name)) return "AMD"
  if (/qualcomm/i.test(name)) return "Qualcomm"
  if (/mediatek/i.test(name)) return "MediaTek"
  return String(name || "").split(/\s+/)[0] || "未知"
}

function terminalName() {
  const env = process.env
  if (env.WT_SESSION) return "Windows Terminal"
  if (env.MSYSTEM) return `MSYS2 ${env.MSYSTEM}`
  if (env.TERM_PROGRAM) return env.TERM_PROGRAM
  if (env.TERM) return `${path.basename(env.SHELL || "sh")} (${env.TERM})`
  if (env.ComSpec) return path.basename(env.ComSpec)
  if (env.SHELL) return path.basename(env.SHELL)
  return "未知"
}

async function readTextFile(file) {
  try {
    return await fs.readFile(file, "utf8")
  } catch {
    return ""
  }
}

async function findInPath(bin) {
  if (!bin) return ""
  const exts = IS_WIN ? String(process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""]
  for (const dir of String(process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const file = path.join(dir, bin + ext)
      try {
        await fs.access(file)
        return file
      } catch {}
    }
  }
  return ""
}

let cachedAndroidProps
async function readAndroidProps() {
  if (cachedAndroidProps !== undefined) return cachedAndroidProps
  const props = {}
  const bins = ["getprop", "/data/data/com.termux/files/usr/bin/getprop", "/system/bin/getprop"]
  for (const bin of bins) {
    const out = await execText(bin, [], 4000)
    if (!out.includes("ro.product")) continue
    for (const line of out.split(/\r?\n/)) {
      const matched = line.match(/^\[([^\]]+)\]: \[(.*)\]$/)
      if (matched) props[matched[1]] = matched[2]
    }
    if (Object.keys(props).length) break
  }
  if (!Object.keys(props).length) {
    for (const file of ["/system/build.prop", "/vendor/build.prop", "/product/build.prop", "/odm/build.prop"]) {
      for (const line of (await readTextFile(file)).split(/\r?\n/)) {
        const matched = line.match(/^([A-Za-z0-9_.-]+)=(.*)$/)
        if (matched) props[matched[1]] = matched[2].trim()
      }
    }
  }
  cachedAndroidProps = Object.keys(props).length ? props : null
  return cachedAndroidProps
}

function formatBuildTime(seconds) {
  const value = Number(seconds)
  if (!Number.isFinite(value) || value <= 0) return ""
  const date = new Date(value * 1000)
  const pad = number => String(number).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function androidRows(props) {
  if (!props) return null
  const value = key => String(props[key] || "").trim()
  const model = value("ro.product.model")
  const market = value("ro.product.marketname") || model
  const name = value("ro.product.name")
  const device = value("ro.product.device")
  const rows = [
    { key: "设备", color: "#82df0e", value: device && name && name !== device ? `${device} / ${name}` : device || name },
    { key: "型号", color: "#AFCD9C", value: market && market !== model ? `${market} (${model})` : market },
    {
      key: "安卓",
      color: "#3CB371",
      value: [
        value("ro.build.version.release") && `Android ${value("ro.build.version.release")}`,
        value("ro.build.version.sdk") && `SDK ${value("ro.build.version.sdk")}`,
      ]
        .filter(Boolean)
        .join(" "),
    },
    { key: "版本", color: "#20B2AA", value: [value("ro.build.version.incremental"), value("ro.build.display.id")].filter(Boolean).join(" / ") },
    { key: "编译", color: "#776FA4", value: formatBuildTime(value("ro.build.date.utc")) },
    { key: "基带", color: "#788760", value: value("gsm.version.baseband").split(",")[0].trim() },
  ].filter(item => item.value)
  return rows.length ? rows : null
}

async function pickLinuxHost(androidProps) {
  if (androidProps) {
    const value = ["ro.product.marketname", "ro.product.model", "ro.product.name"]
      .map(key => String(androidProps[key] || "").trim())
      .find(Boolean)
    if (value) return value
  }
  const vendor = (await readTextFile("/sys/devices/virtual/dmi/id/sys_vendor")).trim()
  const product = (await readTextFile("/sys/devices/virtual/dmi/id/product_name")).trim()
  if (product && !/to be filled|system product|o\.e\.m/i.test(product)) return [vendor, product].filter(Boolean).join(" ")
  const tree = (await readTextFile("/proc/device-tree/model")).replace(/\0/g, "").trim()
  return tree || os.hostname()
}

let cachedLinuxGpus = null
async function readLinuxGpus(androidProps) {
  if (cachedLinuxGpus) return cachedLinuxGpus
  const gpus = []
  const push = name => {
    const text = String(name || "").replace(/\0/g, "").replace(/\s+/g, " ").trim()
    if (text && !gpus.some(item => item.toLowerCase() === text.toLowerCase())) gpus.push(text)
  }
  push((await readTextFile("/sys/class/kgsl/kgsl-3d0/gpu_model")).trim())
  if (!gpus.length) push((await readTextFile("/sys/class/misc/mali0/device/gpuinfo")).split(/\r?\n/)[0])
  if (!gpus.length) push((await readTextFile("/sys/class/drm/card0/device/product_name")).trim())
  if (!gpus.length) push((await readTextFile("/sys/class/drm/card0/device/gpu_model")).trim())
  if (!gpus.length) {
    const out = await execText("lspci", [], 4000)
    for (const line of out.split(/\r?\n/)) {
      if (!/(VGA compatible|3D|Display) controller/i.test(line)) continue
      const name = line.split(": ").slice(1).join(": ").replace(/\s*\(rev [^)]*\)\s*$/i, "")
      push((name.match(/\[([^\]]+)\]/) || [])[1] || name)
    }
  }
  if (!gpus.length) {
    const egl = String(androidProps?.["ro.hardware.egl"] || "").toLowerCase()
    if (egl.includes("adreno")) push("Adreno")
    else if (egl.includes("mali")) push("Mali")
  }
  if (gpus.length) cachedLinuxGpus = gpus
  return gpus
}

let cachedShell
async function shellInfo() {
  if (cachedShell !== undefined) return cachedShell
  let result = ""
  if (IS_WIN) {
    const out = await execText("powershell", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], 4000)
    const version = out.split(/\r?\n/).map(line => line.trim()).find(line => /^\d+(\.\d+)+$/.test(line)) || ""
    if (version) result = `PowerShell ${version}`
    else if (process.env.ComSpec) result = path.basename(process.env.ComSpec, ".exe")
  } else {
    const candidates = [...new Set([path.basename(process.env.SHELL || ""), "bash", "zsh", "sh"].filter(Boolean))]
    for (const name of candidates) {
      const out = await execText(name, ["--version"], 3000)
      if (!out) continue
      const version = (out.match(/(\d+\.\d+(?:\.\d+)?)/) || [])[1] || ""
      result = `${name} ${version}`.trim()
      break
    }
  }
  cachedShell = result
  return result
}

let cachedEditor
async function editorInfo() {
  if (cachedEditor !== undefined) return cachedEditor
  const envEditor = path.basename(process.env.VISUAL || process.env.EDITOR || "").replace(/\.exe$/i, "")
  const candidates = envEditor ? [envEditor] : IS_WIN ? ["code", "notepad"] : ["vim", "nvim", "nano", "vi", "emacs"]
  let result = envEditor
  for (const name of candidates) {
    if (!(await findInPath(name))) continue
    const out = await execText(name, ["--version"], 3000)
    const version =
      (out.match(/Vi IMproved\s+(\d+(?:\.\d+)+)/i) ||
        out.match(/NVIM v(\d+(?:\.\d+)+)/i) ||
        out.match(/version\s+(\d+(?:\.\d+)+)/i) ||
        [])[1] || ""
    result = `${name === "vi" && /VIM/i.test(out) ? "vim" : name} ${version}`.trim()
    break
  }
  cachedEditor = result
  return result
}

let cachedPackages
async function packageLabel() {
  if (cachedPackages && Date.now() - cachedPackages.at < 10 * 60 * 1000) return cachedPackages.value
  let value = ""
  if (IS_WIN) {
    const pkg = cfg.package || {}
    const count = Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.devDependencies }).length
    value = count ? `${count} 个依赖` : ""
  } else {
    const managers = [
      { bin: "pacman", args: ["-Q"], name: "pacman" },
      { bin: "dpkg-query", args: ["-W", "-f", "${db:Status-Abbrev} ${Package}\\n"], name: "dpkg", onlyInstalled: true },
      { bin: "rpm", args: ["-qa"], name: "rpm" },
      { bin: "apk", args: ["info"], name: "apk" },
      { bin: "opkg", args: ["list-installed"], name: "opkg" },
    ]
    for (const manager of managers) {
      if (!(await findInPath(manager.bin))) continue
      const out = await execText(manager.bin, manager.args, 8000)
      if (!out) continue
      const lines = out.split(/\r?\n/).filter(line => line.trim())
      const count = manager.onlyInstalled ? lines.filter(line => line.startsWith("ii ")).length : lines.length
      if (count > 0) {
        value = `${count} (${manager.name})`
        break
      }
    }
    if (!value) {
      try {
        const count = (await fs.readdir("/var/lib/pacman/local")).filter(name => name !== "ALPM_DB_VERSION").length
        if (count > 0) value = `${count} (pacman)`
      } catch {}
    }
  }
  cachedPackages = { at: Date.now(), value }
  return value
}

let cachedGit
async function gitVersion() {
  if (cachedGit !== undefined) return cachedGit
  const out = await execText("git", ["--version"], 3000)
  cachedGit = (out.match(/(\d+\.\d+(?:\.\d+)?)/) || [])[1] || ""
  return cachedGit
}

async function collectSystemInfo() {
  if (!IS_WIN) return collectSystemInfoUnix()

  const [osOut, cpuOut, boardOut, biosOut, videoOut, chipOut, pageOut, csOut] = await Promise.all([
    execText("wmic", ["os", "get", "Caption,Version,BuildNumber", "/format:csv"]),
    execText("wmic", ["cpu", "get", "Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed", "/format:csv"]),
    execText("wmic", ["baseboard", "get", "Product,Manufacturer", "/format:csv"]),
    execText("wmic", ["bios", "get", "SMBIOSBIOSVersion,Manufacturer", "/format:csv"]),
    execText("wmic", ["path", "Win32_VideoController", "get", "Name,CurrentHorizontalResolution,CurrentVerticalResolution", "/format:csv"]),
    execText("wmic", ["memorychip", "get", "Speed,Capacity", "/format:csv"]),
    execText("wmic", ["pagefile", "get", "AllocatedBaseSize,CurrentUsage", "/format:csv"]),
    execText("wmic", ["path", "Win32_ComputerSystem", "get", "Manufacturer,Model", "/format:csv"]),
  ])

  const osRow = parseCsv(osOut)[0] || {}
  const cpuRow = parseCsv(cpuOut)[0] || {}
  const boardRow = parseCsv(boardOut)[0] || {}
  const biosRow = parseCsv(biosOut)[0] || {}
  const chipRows = parseCsv(chipOut)
  const pageRow = parseCsv(pageOut)[0] || {}
  const csRow = parseCsv(csOut)[0] || {}

  const gpus = []
  let resolution = ""
  for (const row of parseCsv(videoOut)) {
    const name = row.Name || ""
    if (!name) continue
    if (/oray|idd|remote|virtual|basic display|microsoft/i.test(name)) continue
    gpus.push(name)
    const width = Number(row.CurrentHorizontalResolution)
    const height = Number(row.CurrentVerticalResolution)
    if (!resolution && width > 0 && height > 0) resolution = `${width}x${height}`
  }

  const cpuName = cpuRow.Name || os.cpus()[0]?.model || ""
  const cpuMhz = Number(cpuRow.MaxClockSpeed) || 0
  const memSpeed = Number(chipRows[0]?.Speed) || 0
  const swapTotal = (Number(pageRow.AllocatedBaseSize) || 0) * 1024 * 1024
  const swapUsed = Math.min(Number(pageRow.CurrentUsage) || 0, Number(pageRow.AllocatedBaseSize) || 0) * 1024 * 1024
  const model = csRow.Model || ""
  const host = /to be filled|system product|o\.e\.m/i.test(model) ? os.hostname() : model
  const [shell, editor] = await Promise.all([shellInfo(), editorInfo()])

  return {
    osName: PLATFORM_NAME.win32,
    osCaption: (osRow.Caption || "").replace(/^Microsoft\s+/i, ""),
    osVersion: osRow.Version || os.release(),
    kernel: osRow.Version || os.release(),
    host,
    board: [boardRow.Manufacturer, boardRow.Product].filter(Boolean).join(" ").replace(/\s*\(.*$/, "").trim(),
    bios: [biosRow.Manufacturer, biosRow.SMBIOSBIOSVersion].filter(Boolean).join(" "),
    terminal: terminalName(),
    resolution,
    gpus,
    shell,
    editor,
    android: null,
    memSpeed,
    swap: { total: swapTotal, used: swapUsed },
    cpu: {
      name: cpuName,
      shortName: shortCpuName(cpuName),
      manufacturer: cpuManufacturer(cpuName),
      cores: Number(cpuRow.NumberOfCores) || os.cpus().length,
      threads: Number(cpuRow.NumberOfLogicalProcessors) || os.cpus().length,
      speed: cpuMhz >= 1000 ? `${(cpuMhz / 1000).toFixed(1)}GHz` : cpuMhz ? `${cpuMhz}MHz` : "",
    },
  }
}

let cachedOsRelease = null
async function readOsRelease() {
  if (cachedOsRelease) return cachedOsRelease
  let name = ""
  try {
    const text = await fs.readFile("/etc/os-release", "utf8")
    const field = key => text.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]?.replace(/^"|"$/g, "").trim() || ""
    name = (field("PRETTY_NAME") || [field("NAME"), field("VERSION_ID")].filter(Boolean).join(" "))
      .replace(/\s+Linux$/i, "")
  } catch {}
  cachedOsRelease = { name }
  return cachedOsRelease
}

async function collectSystemInfoUnix() {
  const [release, machine, meminfo, releaseInfo, androidProps, shell, editor] = await Promise.all([
    execText("uname", ["-r"]),
    execText("uname", ["-m"]),
    fs.readFile("/proc/meminfo", "utf8").catch(() => ""),
    readOsRelease(),
    readAndroidProps(),
    shellInfo(),
    editorInfo(),
  ])
  const [host, gpus] = await Promise.all([pickLinuxHost(androidProps), readLinuxGpus(androidProps)])
  const pick = key => Number(String(meminfo).match(new RegExp(`${key}:\\s+(\\d+)`))?.[1] || 0) * 1024
  const procCpu = await readProcCpuInfo()
  const nodeCpu = os.cpus()?.[0]
  const cpuName = procCpu.model || nodeCpu?.model || ""
  const cpuMhz = procCpu.mhz || nodeCpu?.speed || (await readCpuFreq())
  const cores = await cpuCount()
  return {
    osName: PLATFORM_NAME[process.platform] || process.platform,
    osCaption: releaseInfo.name,
    osVersion: machine.trim() || os.arch(),
    kernel: release.trim() || os.release(),
    host,
    board: "",
    bios: "",
    terminal: terminalName(),
    resolution: "",
    gpus,
    shell,
    editor,
    android: androidRows(androidProps),
    memSpeed: 0,
    swap: { total: pick("SwapTotal"), used: pick("SwapTotal") - pick("SwapFree") },
    cpu: {
      name: cpuName,
      shortName: shortCpuName(cpuName),
      manufacturer: cpuManufacturer(cpuName),
      cores,
      threads: cores,
      speed: cpuMhz >= 1000 ? `${(cpuMhz / 1000).toFixed(1)}GHz` : cpuMhz ? `${cpuMhz}MHz` : "",
    },
  }
}


async function collectDisks() {
  if (IS_WIN) {
    const rows = parseCsv(
      await execText("wmic", ["logicaldisk", "get", "Caption,FileSystem,Size,FreeSpace", "/format:csv"]),
    )
    return rows
      .map(row => {
        const total = Number(row.Size)
        const free = Number(row.FreeSpace)
        if (!row.Caption || !Number.isFinite(total) || total <= 0) return null
        return buildDisk(row.Caption, row.FileSystem, total, Number.isFinite(free) ? free : 0)
      })
      .filter(Boolean)
  }

  const parse = (text, withType) => {
    const disks = []
    const seen = new Set()
    for (const line of text.split(/\r?\n/).slice(1)) {
      const cols = line.trim().split(/\s+/)
      if (cols.length < (withType ? 7 : 6)) continue
      const offset = withType ? 1 : 0
      const total = Number(cols[offset + 1]) * 1024
      const used = Number(cols[offset + 2]) * 1024
      const free = Number(cols[offset + 3]) * 1024
      if (!Number.isFinite(total) || total <= 0) continue
      const mount = cols.slice(offset + 5).join(" ") || "/"
      if (seen.has(mount)) continue
      seen.add(mount)
      disks.push(buildDisk(mount === "/" ? "/ (根目录)" : mount, withType ? cols[1] : "", total, free, used))
    }
    return disks
  }
  let disks = parse(await execText("df", ["-kPT"], 8000), true)
  if (!disks.length) disks = parse(await execText("df", ["-kP"], 8000), false)
  return disks
}

function parseDiskstats(text) {
  let read = 0
  let write = 0
  for (const line of text.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 11) continue
    if (!/^(sd[a-z]+|hd[a-z]+|vd[a-z]+|xvd[a-z]+|mmcblk\d+|nvme\d+n\d+)$/.test(cols[2])) continue
    read += Number(cols[5]) || 0
    write += Number(cols[9]) || 0
  }
  return read || write ? { read: read * 512, write: write * 512 } : null
}

async function readDiskBytesWin() {
  const rows = parseCsv(
    await execText(
      "wmic",
      ["path", "Win32_PerfRawData_PerfDisk_PhysicalDisk", "get", "Name,DiskReadBytesPersec,DiskWriteBytesPersec", "/format:csv"],
      8000,
    ),
  )
  let read = 0
  let write = 0
  let found = false
  for (const row of rows) {
    if (!row.Name || /_total/i.test(row.Name)) continue
    const r = Number(row.DiskReadBytesPersec)
    const w = Number(row.DiskWriteBytesPersec)
    if (!Number.isFinite(r) || !Number.isFinite(w)) continue
    read += r
    write += w
    found = true
  }
  return found ? { read, write } : null
}

async function readDiskBytes() {
  if (IS_WIN) return readDiskBytesWin()
  return parseDiskstats(await readTextFile("/proc/diskstats"))
}

let diskIoCache = { at: 0, value: null }
async function collectDiskIO() {
  if (Date.now() - diskIoCache.at < 5000) return diskIoCache.value
  const first = await readDiskBytes()
  let value = null
  if (first) {
    const startedAt = Date.now()
    await sleep(500)
    const second = await readDiskBytes()
    const span = (Date.now() - startedAt) / 1000
    if (second && span > 0.1) {
      const read = Math.max(0, (second.read - first.read) / span)
      const write = Math.max(0, (second.write - first.write) / span)
      value = { read, write, total: read + write }
    }
  }
  diskIoCache = { at: Date.now(), value }
  return value
}

function buildDisk(mount, type, total, free, usedBytes) {
  const used = Number.isFinite(usedBytes) ? usedBytes : total - free
  const percent = Math.round((used / total) * 100)
  const progress = ring(percent, 70)
  return {
    mount,
    type: type || "未知",
    size: fileSize(total),
    used: fileSize(used),
    available: fileSize(free),
    percent,
    color: progress.color,
    dash: progress.dash,
  }
}


async function collectRedis() {
  const client = globalThis.redis
  if (!client?.isReady) return null
  try {
    const info = String(await client.sendCommand(["INFO"]))
    const pick = key => {
      const matched = info.match(new RegExp(`${key}:([^\\r\\n]+)`))
      return matched ? matched[1].trim() : ""
    }
    const usedBytes = Number(pick("used_memory")) || 0
    const maxmemory = Number(pick("maxmemory")) || 0
    const usageRatio = maxmemory > 0 ? (usedBytes / maxmemory) * 100 : (usedBytes / os.totalmem()) * 100
    const uptimeSec = Number(pick("uptime_in_seconds")) || 0
    const clients = Number(pick("connected_clients")) || 0
    const blocked = Number(pick("blocked_clients")) || 0
    const keyspace = []
    for (const line of String(await client.sendCommand(["INFO", "keyspace"])).split(/\r?\n/)) {
      const matched = line.match(/^db(\d+):keys=(\d+),expires=(\d+),avg_ttl=(\d+)/)
      if (!matched) continue
      const ttl = Number(matched[4]) || 0
      keyspace.push({
        db: `db${matched[1]}`,
        keys: matched[2],
        expires: matched[3],
        avgTtl: ttl > 0 ? humanDuration(ttl) : "—",
      })
    }
    const hits = Number(pick("keyspace_hits")) || 0
    const misses = Number(pick("keyspace_misses")) || 0
    const hitTotal = hits + misses
    const hitRate = hitTotal > 0 ? (hits / hitTotal) * 100 : 100
    const fragRatio = Number(pick("mem_fragmentation_ratio")) || 0
    const totalCommands = Number(pick("total_commands_processed")) || 0
    const opsPerSec = Number(pick("instantaneous_ops_per_sec")) || 0
    const totalKeys = keyspace.reduce((sum, item) => sum + Number(item.keys || 0), 0)

    recordRedisClients(clients)

    return {
      version: pick("redis_version"),
      uptime: humanDuration(uptimeSec * 1000),
      used: fileSize(usedBytes),
      peak: pick("used_memory_peak_human") || "",
      maxmemory: maxmemory > 0 ? fileSize(maxmemory) : "",
      clients,
      blocked,
      usagePercent: usageRatio.toFixed(1),
      usageColor: usageRatio >= 90 ? "#d73403" : usageRatio >= 70 ? "#ffa500" : "#84A0DF",
      keyspace,
      chart: buildSpark(monitor.redisHistory),
      health: [
        { label: "命中率", value: `${hitRate.toFixed(1)}%`, ok: hitRate >= 80 },
        { label: "键总数", value: String(totalKeys), ok: true },
        { label: "碎片率", value: fragRatio ? fragRatio.toFixed(2) : "—", ok: fragRatio < 1.5 },
        { label: "阻塞", value: String(blocked), ok: !blocked },
        { label: "命令总数", value: String(totalCommands), ok: true },
        { label: "每秒操作", value: String(opsPerSec), ok: true },
      ],
    }
  } catch {
    return null
  }
}


const PROCESS_COLUMNS = ["ProcessId", "Name", "KernelModeTime", "UserModeTime", "WorkingSetSize"]

function normalizeState(status) {
  const value = String(status || "").toLowerCase()
  if (value === "running" || value.includes("正在运行")) return "running"
  if (value.includes("not responding") || value.includes("未响应") || value.includes("无响应")) return "blocked"
  if (value.includes("suspend") || value.includes("暂停")) return "sleeping"
  return "unknown"
}

function parseProcessRows(text) {
  const rows = []
  for (const row of parseCsv(text)) {
    const pid = Number(row.ProcessId)
    const name = row.Name || ""
    if (!pid || !name || /system idle process/i.test(name)) continue
    rows.push({
      pid,
      name,
      ticks: (Number(row.KernelModeTime) || 0) + (Number(row.UserModeTime) || 0),
      mem: Number(row.WorkingSetSize) || 0,
    })
  }
  return rows
}

function parseTasklistStates(text) {
  const states = new Map()
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const cells = (line.match(/"([^"]*)"/g) || []).map(cell => cell.slice(1, -1))
    if (cells.length < 6) continue
    states.set(Number(cells[1]), normalizeState(cells[5]))
  }
  return states
}

async function collectProcess() {
  if (!IS_WIN) return collectProcessUnix()

  const firstStart = Date.now()
  const tasklistTask = execText("tasklist", ["/fo", "csv", "/nh", "/v"])
  const first = parseProcessRows(
    await execText("wmic", ["path", "Win32_Process", "get", PROCESS_COLUMNS.join(","), "/format:csv"]),
  )
  const firstEnd = Date.now()
  const states = parseTasklistStates(await tasklistTask)
  await sleep(400)
  const secondStart = Date.now()
  const second = parseProcessRows(
    await execText("wmic", ["path", "Win32_Process", "get", PROCESS_COLUMNS.join(","), "/format:csv"]),
  )
  const secondEnd = Date.now()

  const readAt = (start, end) => (start + end) / 2
  const span = Math.max(1, readAt(secondStart, secondEnd) - readAt(firstStart, firstEnd))
  const previous = new Map(first.map(item => [item.pid, item.ticks]))
  const cores = os.cpus().length || 1

  const list = second.map(item => {
    const before = previous.get(item.pid)
    const delta = before === undefined ? 0 : Math.max(0, item.ticks - before)
    const cpu = before === undefined ? 0 : (delta / 1e7 / (span / 1000) / cores) * 100
    return {
      pid: item.pid,
      name: item.name,
      cpu,
      mem: item.mem,
      state: states.get(item.pid) || "unknown",
    }
  })

  const counts = { all: list.length, running: 0, blocked: 0, sleeping: 0, unknown: 0 }
  for (const item of list) counts[item.state] += 1

  const rows = list
    .slice()
    .sort((a, b) => b.mem - a.mem)
    .slice(0, 6)
  const pinned = aggregatePinned(list, ["node.exe", "redis-server.exe", "redis-server", "chrome.exe", "msedge.exe"])
  const visible = new Set(rows.map(item => item.pid))
  const extra = pinned.filter(item => !item.pids.every(pid => visible.has(pid)))

  const format = item => ({
    name: item.name,
    pid: item.pid,
    cpu: `${item.cpu.toFixed(1)}%`,
    mem: fileSize(item.mem),
    state: item.state,
  })
  const table = rows.map(format)
  if (extra.length) {
    table.push({ hr: true })
    for (const item of extra) table.push(format(item))
  }

  return { counts, list: table }
}

function aggregatePinned(list, names) {
  const groups = new Map()
  for (const item of list) {
    const key = item.name.toLowerCase()
    if (!names.includes(key)) continue
    const group = groups.get(key)
    if (group) {
      group.pids.push(item.pid)
      group.cpu += item.cpu
      group.mem += item.mem
      group.state = group.state === "running" ? "running" : item.state
    } else {
      groups.set(key, { name: item.name, pid: item.pid, pids: [item.pid], cpu: item.cpu, mem: item.mem, state: item.state })
    }
  }
  for (const group of groups.values()) {
    if (group.pids.length > 1) group.pid = group.pids.join(",")
  }
  return [...groups.values()]
}

async function collectProcessUnix() {
  const out = await execText("ps", ["-eo", "pid,pcpu,rss,comm,stat"])
  const list = []
  for (const line of out.split(/\r?\n/).slice(1)) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 5) continue
    const state = cols[cols.length - 1]
    list.push({
      pid: Number(cols[0]),
      cpu: Number(cols[1]) || 0,
      mem: (Number(cols[2]) || 0) * 1024,
      name: cols.slice(3, -1).join(" "),
      state: state.startsWith("R") ? "running" : state.startsWith("T") ? "sleeping" : state.startsWith("D") ? "blocked" : state.startsWith("S") ? "sleeping" : "unknown",
    })
  }
  const counts = { all: list.length, running: 0, blocked: 0, sleeping: 0, unknown: 0 }
  for (const item of list) counts[item.state] += 1
  const rows = list.slice().sort((a, b) => b.mem - a.mem).slice(0, 8)
  return {
    counts,
    list: rows.map(item => ({
      name: item.name,
      pid: item.pid,
      cpu: `${item.cpu.toFixed(1)}%`,
      mem: fileSize(item.mem),
      state: item.state,
    })),
  }
}


const SAMPLE_MS = 10000
const HISTORY_MAX = 36

const monitor = {
  timer: null,
  netAt: 0,
  netRx: 0,
  netTx: 0,
  netPushedAt: 0,
  netHistory: [],
  redisHistory: [],
  redisAt: 0,
  netTask: Promise.resolve(),
}

function recordRedisClients(clients) {
  const now = Date.now()
  if (now - monitor.redisAt < SAMPLE_MS * 0.8) return
  monitor.redisAt = now
  monitor.redisHistory.push(Number(clients) || 0)
  if (monitor.redisHistory.length > HISTORY_MAX) monitor.redisHistory.shift()
}

async function readNetTotals() {
  if (IS_WIN) {
    const text = await execText("netstat", ["-e"])
    for (const line of text.split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/)
      if (cols.length === 3 && /^\d+$/.test(cols[1]) && /^\d+$/.test(cols[2]))
        return { rx: Number(cols[1]), tx: Number(cols[2]) }
    }
    return null
  }
  try {
    const text = await fs.readFile("/proc/net/dev", "utf8")
    let rx = 0
    let tx = 0
    for (const line of text.split(/\r?\n/).slice(2)) {
      const [name, rest] = line.split(":")
      if (!rest || name.trim() === "lo") continue
      const cols = rest.trim().split(/\s+/)
      rx += Number(cols[0]) || 0
      tx += Number(cols[8]) || 0
    }
    return { rx, tx }
  } catch {
    return null
  }
}

async function updateNetwork() {
  const totals = await readNetTotals()
  if (!totals || (!totals.rx && !totals.tx)) return null
  const now = Date.now()
  let down = 0
  let up = 0
  if (monitor.netAt && now > monitor.netAt) {
    const span = (now - monitor.netAt) / 1000
    down = Math.max(0, (totals.rx - monitor.netRx) / span)
    up = Math.max(0, (totals.tx - monitor.netTx) / span)
    if (now - monitor.netPushedAt >= SAMPLE_MS * 0.8) {
      monitor.netPushedAt = now
      monitor.netHistory.push({ down, up })
      if (monitor.netHistory.length > HISTORY_MAX) monitor.netHistory.shift()
    }
  }
  monitor.netAt = now
  monitor.netRx = totals.rx
  monitor.netTx = totals.tx
  return { down, up, rx: totals.rx, tx: totals.tx }
}

function sampleNetwork() {
  monitor.netTask = monitor.netTask.then(updateNetwork, updateNetwork)
  return monitor.netTask
}

async function monitorTick() {
  try {
    await sampleNetwork()
    const client = globalThis.redis
    if (client?.isReady) {
      const info = String(await client.sendCommand(["INFO", "clients"])).match(/connected_clients:(\d+)/)
      if (info) recordRedisClients(Number(info[1]))
    }
  } catch {}
}

function startMonitor() {
  if (monitor.timer) return
  monitor.timer = setInterval(monitorTick, SAMPLE_MS)
  monitor.timer.unref?.()
  monitorTick()
}


function buildChart(history) {
  if (history.length < 3) return null
  const width = 600
  const height = 96
  const values = history.flatMap(item => [item.down, item.up])
  const max = Math.max(...values, 1024)
  const x = index => ((index / (history.length - 1)) * width).toFixed(1)
  const y = value => (height - 6 - (value / max) * (height - 16)).toFixed(1)
  const line = key => history.map((item, index) => `${x(index)},${y(item[key])}`).join(" ")
  return {
    down: line("down"),
    up: line("up"),
    max: fileSize(max) + "/s",
    span: `${Math.round(((history.length - 1) * SAMPLE_MS) / 1000)}秒`,
  }
}

function buildSpark(history) {
  if (history.length < 3) return null
  const width = 120
  const height = 26
  const max = Math.max(...history, 1)
  const points = history.map((value, index) => {
    const x = ((index / (history.length - 1)) * width).toFixed(1)
    const y = (height - 3 - (value / max) * (height - 8)).toFixed(1)
    return `${x},${y}`
  })
  return points.join(" ")
}


async function fetchAvatar(uin) {
  if (!uin) return ""
  try {
    const response = await fetch(`https://q1.qlogo.cn/g?b=qq&s=100&nk=${uin}`, {
      signal: AbortSignal.timeout(6000),
    })
    if (!response.ok) return ""
    const buffer = Buffer.from(await response.arrayBuffer())
    if (!buffer.length || buffer.length > 512 * 1024) return ""
    const type = response.headers.get("content-type") || "image/jpeg"
    return `data:${type};base64,${buffer.toString("base64")}`
  } catch {
    return ""
  }
}

async function coreMsgCounts(uin) {
  const redis = globalThis.redis
  const id = String(uin || "")
  if (!redis?.mGet || !id) return null
  try {
    const values = (await redis.mGet([
      `Yz:count:receive:msg:bot:${id}:total`,
      `Yz:count:send:msg:bot:${id}:total`,
    ])) || []
    return { recv: Number(values[0]) || 0, send: Number(values[1]) || 0 }
  } catch {
    return null
  }
}

function botStats(bot) {
  const stat = bot?.stat || {}
  let groupMember = 0
  try {
    for (const members of bot?.gml?.values() || []) groupMember += members?.size || 0
  } catch {}
  return {
    recv: Number(stat.recv_msg_cnt) || 0,
    send: Number(stat.sent_msg_cnt) || 0,
    friend: bot?.fl?.size || 0,
    group: bot?.gl?.size || 0,
    groupMember,
  }
}

export function botProtocol(bot) {
  const adapter = bot?.adapter || {}
  const version = bot?.version || {}
  const appName = version.app_name || version.name || adapter.name || ""
  const appVersion = version.app_version || ""
  const raw = String(version.version || "").trim()
  const matched = raw.match(/^(.*?)\s*v?(\d+(?:\.\d+)*)(?:[-+][\w.-]+)?$/)
  let name = (matched ? matched[1] : raw) || appName
  let number = matched ? matched[2] : appVersion
  name = name.replace(/\.onebot$/i, "")
  const protocol = number ? [name, `v${number}`].filter(Boolean).join(" ") : ""
  return {
    loginProtocol: adapter.name || "未知",
    protocolVersion: protocol,
  }
}

async function countPlugins() {
  let plugins = 0
  let js = 0
  try {
    const entries = await fs.readdir(pluginRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "example") continue
      try {
        await fs.access(path.join(pluginRoot, entry.name, "package.json"))
        plugins++
      } catch {}
    }
    js = (await fs.readdir(path.join(pluginRoot, "example"))).filter(name => name.endsWith(".js")).length
  } catch {}
  return { plugins, js }
}

function findBot(id) {
  const key = String(id || "")
  if (!key) return null
  return Bot.bots?.[key] || Bot[key] || null
}

function pickBot(e) {
  const selfId = e?.self_id ? String(e.self_id) : ""
  if (selfId && findBot(selfId)) return { uin: selfId, bot: findBot(selfId) }
  for (const id of Bot.uin || []) {
    const key = String(id)
    if (!(Number(key) > 0)) continue
    if (findBot(key)) return { uin: key, bot: findBot(key) }
  }
  return { uin: "", bot: null }
}


function listBots(e) {
  const list = []
  for (const id of Bot.uin || []) {
    const key = String(id)
    const bot = findBot(key)
    if (bot) list.push({ uin: key, bot })
  }
  return list.length ? list : [pickBot(e)]
}

async function botCard(uin, bot, avatar) {
  const stats = botStats(bot)
  const core = await coreMsgCounts(uin)
  if (core) {
    stats.recv = core.recv
    stats.send = core.send
  }
  const protocol = botProtocol(bot)
  const nickname = bot?.nickname || bot?.info?.nickname || cfg.bot?.name || "Yunzai"
  const online = Bot.isBotOnline ? Bot.isBotOnline(bot) : (bot?.isOnline?.() ?? true)
  const isQQ = Number(uin) > 0
  return {
    avatar,
    nickname,
    statusColor: online ? "#4ade80" : "#f87171",
    botRuntime: isQQ && bot?.stat?.start_time ? `Bot已运行 ${humanDuration(Date.now() - bot.stat.start_time * 1000)}` : "",
    ...protocol,
    friendCount: stats.friend,
    groupCount: stats.group,
    groupMemberCount: stats.groupMember,
    recvCount: stats.recv,
    sendCount: stats.send,
  }
}

export async function collectGauges() {
  const memory = process.memoryUsage()
  const ramTotal = os.totalmem()
  const ramFree = os.freemem()
  const ramUsed = Math.max(0, ramTotal - ramFree)
  const [cpuPercent, disks] = await Promise.all([collectCpuLoad(), collectDisks()])
  const ramPercent = (ramUsed / Math.max(1, ramTotal)) * 100
  const nodePercent = (memory.rss / Math.max(1, ramUsed)) * 100
  const procCpu = await readProcCpuInfo()
  const cpuName = shortCpuName(procCpu.model || os.cpus()?.[0]?.model || "")
  const cores = await cpuCount()
  const resource = (title, percent, detailed, info) => {
    const value = Math.round(percent)
    return { title, percent: value, inner: `${value}%`, detailed, info, ...ring(value) }
  }
  return {
    resources: [
      resource("CPU", cpuPercent, `${cores} 线程`, [cpuName || "未知处理器"]),
      resource("RAM", ramPercent, `${fileSize(ramTotal)} 总量`, [
        `${fileSize(ramUsed)} / ${fileSize(ramTotal)}`,
        `空闲 ${fileSize(ramFree)}`,
      ]),
      resource("Node", nodePercent, process.version, [
        `RSS ${fileSize(memory.rss)}`,
        `堆 ${fileSize(memory.heapUsed)} / ${fileSize(memory.heapTotal)}`,
      ]),
    ],
    disks,
  }
}

export async function collectStatus(e, { pro = false } = {}) {
  const { uin, bot } = pickBot(e)
  const targets = pro ? listBots(e) : [{ uin, bot }]
  const memory = process.memoryUsage()

  const ramTotal = os.totalmem()
  const ramFree = os.freemem()
  const ramUsed = ramTotal - ramFree

  const [cpuPercent, sys, disks, diskIo, processInfo, redisInfo, net, avatars, plugins, packages, git] = await Promise.all([
    collectCpuLoad(),
    collectSystemInfo(),
    collectDisks(),
    collectDiskIO(),
    collectProcess(),
    collectRedis(),
    sampleNetwork(),
    Promise.all(targets.map(item => fetchAvatar(Number(item.uin) > 0 ? item.uin : ""))),
    countPlugins(),
    packageLabel(),
    gitVersion(),
  ])
  const bots = await Promise.all(
    targets.map((item, index) => botCard(item.uin, item.bot, avatars[index])),
  )

  const ramPercent = (ramUsed / ramTotal) * 100
  const swapPercent = sys.swap.total > 0 ? (sys.swap.used / sys.swap.total) * 100 : 0
  const nodePercent = (memory.rss / Math.max(1, ramUsed)) * 100

  const resources = [
    {
      title: "CPU",
      inner: `${Math.round(cpuPercent)}%`,
      detailed: sys.cpu.shortName,
      info: [`${sys.cpu.manufacturer} ${sys.cpu.cores}核 ${sys.cpu.speed}`.trim()],
      ...ring(cpuPercent),
    },
    {
      title: "RAM",
      inner: `${Math.round(ramPercent)}%`,
      detailed: sys.memSpeed ? `${sys.memSpeed}MHz` : "",
      info: [`${fileSize(ramUsed)} / ${fileSize(ramTotal)}`, `空闲 ${fileSize(ramFree)}`],
      ...ring(ramPercent),
    },
    {
      title: "SWAP",
      inner: `${Math.round(swapPercent)}%`,
      detailed: `Available ${fileSize(sys.swap.total - sys.swap.used)}`,
      info: [`${fileSize(sys.swap.used)} / ${fileSize(sys.swap.total)}`],
      ...ring(swapPercent),
    },
    {
      title: "Node",
      inner: `${Math.round(nodePercent)}%`,
      detailed: process.version,
      info: [`总 ${fileSize(memory.rss)}`, `${fileSize(memory.heapTotal)} | ${fileSize(memory.heapUsed)}`],
      ...ring(nodePercent),
    },
  ].filter(item => item.title !== "SWAP" || sys.swap.total > 0)

  const fastInfo = [
    { key: "OS", color: "#6670F6", value: [sys.osCaption || sys.osName, sys.osVersion].filter(Boolean).join(" ") },
    { key: "主机", color: "#82df0e", value: sys.host },
    { key: "内核", color: "#6640F6", value: sys.kernel },
    { key: "包", color: "#F4A460", value: packages },
    { key: "Shell", color: "#20B2AA", value: sys.shell },
    { key: "编辑", color: "#C9A0DC", value: sys.editor },
    { key: "终端", color: "#5F9EA0", value: sys.terminal },
    { key: "CPU", color: "#95959B", value: `${sys.cpu.shortName} (${sys.cpu.threads}) ${sys.cpu.speed ? `@ ${sys.cpu.speed}` : ""}`.trim() },
    ...sys.gpus.map((name, index) => ({ key: index ? `GPU ${index + 1}` : "GPU", color: "#AFCD9C", value: name })),
    { key: "内存", color: "#788760", value: fileSize(ramTotal) },
    { key: "主板", color: "#7C92CE", value: sys.board },
    { key: "BIOS", color: "#776FA4", value: sys.bios },
    { key: "分辨率", color: "#FF69B4", value: sys.resolution },
  ].filter(item => item.value)
  for (const row of sys.android || []) {
    if (!fastInfo.some(item => item.value === row.value)) fastInfo.push(row)
  }

  const hasNetwork = !!net
  const down = hasNetwork ? fileSizeParts(net.down) : null
  const up = hasNetwork ? fileSizeParts(net.up) : null
  const chart = hasNetwork ? buildChart(monitor.netHistory) : null
  const showNetwork = hasNetwork && !!(down || up || chart)

  return {
    width: statusImageWidth(),
    bots,
    infoCards: [
      { title: "系统", main: sys.osName, secondary: sys.osCaption },
      { title: "主机名", main: os.hostname(), secondary: sys.host && sys.host !== os.hostname() ? `Host ${sys.host}` : "" },
      {
        title: "运行时间",
        main: humanDuration(os.uptime() * 1000),
        secondary: clockText(new Date(Date.now() - os.uptime() * 1000)),
      },
      { title: "插件数", main: `${plugins.plugins} plugins`, secondary: `${plugins.js} js` },
    ],
    resources,
    disks,
    hasDisks: disks.length > 0,
    diskIo: diskIo
      ? {
          read: fileSizeParts(diskIo.read),
          write: fileSizeParts(diskIo.write),
          total: fileSizeParts(diskIo.total),
        }
      : null,
    network: showNetwork
      ? {
          down,
          up,
          rx: fileSizeParts(net.rx),
          tx: fileSizeParts(net.tx),
          chart,
        }
      : null,
    hasNetwork: showNetwork,
    redis: redisInfo,
    hasRedis: !!redisInfo,
    processInfo,
    fastInfo,
    footer: {
      line1: `Created By Yunzai v${cfg.package?.version || ""}`,
      line2: [`Node ${process.version}`, `V8 ${process.versions.v8 || ""}`, git && `Git ${git}`, fullClock()].filter(Boolean).join(" & "),
    },
  }
}

function statusImageScale() {
  const value = Number(cfg.webui?.statusImageScale)
  return Number.isFinite(value) ? Math.min(3, Math.max(1, value)) : 2
}

function statusImageWidth() {
  const value = Number(cfg.webui?.statusImageWidth)
  if (Number.isFinite(value) && value > 0) return Math.min(900, Math.max(420, value))
  return 560
}

export async function renderStatusImage(e, options) {
  const data = await collectStatus(e, options)
  return Renderer.render("status/status", {
    tplFile,
    saveId: "status",
    ...data,
    scale: statusImageScale(),
    quality: 95,
  }).catch(() => null)
}

startMonitor()
