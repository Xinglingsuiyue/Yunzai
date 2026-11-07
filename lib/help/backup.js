import fs from "node:fs"
import path from "node:path"
import { WEBUI_DATA_DIR } from "../webui/dataDir.js"

const CONFIG_FILE = path.join(process.cwd(), "config", "config", "help.yaml")
const BACKUP_DIR = path.join(WEBUI_DATA_DIR, "help-backups")
const NAME_RE = /^help-\d{8}-\d{6}(?:-\d)?\.yaml$/
const MAX_BACKUPS = 100

function pad(value) {
  return String(value).padStart(2, "0")
}

function stampName() {
  const now = new Date()
  const base = `help-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  let name = `${base}.yaml`
  let index = 1
  while (fs.existsSync(path.join(BACKUP_DIR, name))) {
    name = `${base}-${index}.yaml`
    index += 1
  }
  return name
}

function describe(name) {
  const stat = fs.statSync(path.join(BACKUP_DIR, name))
  return { name, size: stat.size, time: stat.mtime.toISOString() }
}

function ensureDir() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
}

export function createHelpBackup() {
  if (!fs.existsSync(CONFIG_FILE)) {
    const error = new Error("help.yaml 不存在，无法备份")
    error.status = 404
    throw error
  }
  ensureDir()
  const name = stampName()
  fs.copyFileSync(CONFIG_FILE, path.join(BACKUP_DIR, name))
  return describe(name)
}

export function listHelpBackups() {
  try {
    return fs
      .readdirSync(BACKUP_DIR)
      .filter(name => NAME_RE.test(name))
      .map(describe)
      .sort((a, b) => (a.time < b.time ? 1 : -1))
      .slice(0, MAX_BACKUPS)
  } catch {
    return []
  }
}

export function restoreHelpBackup(name) {
  const file = path.basename(String(name || ""))
  if (!NAME_RE.test(file)) {
    const error = new Error("备份名称无效")
    error.status = 400
    throw error
  }
  const source = path.join(BACKUP_DIR, file)
  if (!fs.existsSync(source)) {
    const error = new Error("备份不存在")
    error.status = 404
    throw error
  }
  fs.copyFileSync(source, CONFIG_FILE)
  return describe(file)
}
