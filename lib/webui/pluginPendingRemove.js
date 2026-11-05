import fs from "node:fs"
import path from "node:path"
import { WEBUI_DATA_DIR } from "./dataDir.js"

const PLUGINS_DIR = path.resolve(process.cwd(), "plugins")

export const PENDING_REMOVE_FILE = path.join(WEBUI_DATA_DIR, "plugin-pending-remove.json")

function validName(name) {
  return /^[\p{L}\p{N}._-]{1,80}$/u.test(name) && name !== "." && name !== ".." && !name.startsWith(".")
}

export function readPendingRemovals() {
  try {
    const raw = JSON.parse(fs.readFileSync(PENDING_REMOVE_FILE, "utf8"))
    const list = Array.isArray(raw?.plugins) ? raw.plugins : []
    return list
      .filter(item => validName(String(item?.name || "")))
      .map(item => ({ name: String(item.name), at: Number(item.at) || 0 }))
  } catch {
    return []
  }
}

function writePendingRemovals(list) {
  try {
    fs.mkdirSync(path.dirname(PENDING_REMOVE_FILE), { recursive: true })
    const temp = `${PENDING_REMOVE_FILE}.tmp`
    fs.writeFileSync(temp, JSON.stringify({ plugins: list }, null, 2), "utf8")
    fs.renameSync(temp, PENDING_REMOVE_FILE)
  } catch {}
}

export function pendingRemovalNames() {
  return new Set(readPendingRemovals().map(item => item.name))
}

export function addPendingRemoval(name) {
  if (!validName(name)) return
  const list = readPendingRemovals().filter(item => item.name !== name)
  list.push({ name, at: Date.now() })
  writePendingRemovals(list)
}

export function clearPendingRemoval(name) {
  const list = readPendingRemovals()
  if (!list.some(item => item.name === name)) return
  writePendingRemovals(list.filter(item => item.name !== name))
}

export async function removePluginDir(name) {
  if (!validName(name)) return false
  const dir = path.resolve(PLUGINS_DIR, name)
  if (path.dirname(dir) !== PLUGINS_DIR) return false
  if (!fs.existsSync(dir)) return true
  try {
    const stat = fs.lstatSync(dir)
    if (stat.isSymbolicLink()) fs.unlinkSync(dir)
    else await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 })
  } catch {}
  return !fs.existsSync(dir)
}

/** 启动扫描插件前调用：此时没有进程内句柄，Windows 上才能删掉被 SQLite 占用的目录 */
export async function purgePendingRemovals() {
  const list = readPendingRemovals()
  if (!list.length) return { removed: [], failed: [] }
  const removed = []
  const failed = []
  for (const item of list) {
    if (await removePluginDir(item.name)) removed.push(item.name)
    else failed.push(item.name)
  }
  if (removed.length) writePendingRemovals(list.filter(item => !removed.includes(item.name)))
  return { removed, failed }
}
