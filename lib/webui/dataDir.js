import fs from "node:fs"
import path from "node:path"

export const DATA_DIR = path.resolve(process.cwd(), "data")
export const WEBUI_DATA_DIR = path.join(DATA_DIR, "webui")

const SUBDIRS = ["help-backups", "help-icons", "help-themes"]
const LEGACY_FILE_RE = /^(ai[-_]|plugin-index-cache)/

const DEFAULT_FILES = {
  "ai-admin.json": "{}\n",
  "ai_sessions.json": '{\n  "version": 1,\n  "sessions": {}\n}\n',
  "ai_memories.json": '{\n  "version": 2,\n  "entries": [],\n  "relations": {}\n}\n',
  "ai_knowledge.json": '{\n  "version": 2,\n  "updatedAt": "",\n  "total": 0,\n  "entries": []\n}\n',
  "ai_knowledge_archive.ndjson": "",
  "ai-records.ndjson": "",
  "plugin-index-cache.json": "{}\n",
}

function legacyNames() {
  try {
    return fs
      .readdirSync(DATA_DIR, { withFileTypes: true })
      .filter(item => item.isFile() && LEGACY_FILE_RE.test(item.name))
      .map(item => item.name)
  } catch {
    return []
  }
}

function moveLegacy(name) {
  const source = path.join(DATA_DIR, name)
  const target = path.join(WEBUI_DATA_DIR, name)
  if (!fs.existsSync(source)) return
  if (fs.existsSync(target)) {
    try {
      const sourceIsDir = fs.statSync(source).isDirectory()
      const targetIsEmptyDir =
        fs.statSync(target).isDirectory() && fs.readdirSync(target).length === 0
      if (!sourceIsDir || !targetIsEmptyDir) return
      fs.rmdirSync(target)
    } catch {
      return
    }
  }
  try {
    fs.renameSync(source, target)
  } catch {
    try {
      fs.cpSync(source, target, { recursive: true })
    } catch (error) {
      console.error(`[WebUI] 旧数据迁移失败 ${name}: ${error.message}`)
    }
  }
}

let ready = false

export function ensureWebuiData() {
  if (ready) return WEBUI_DATA_DIR
  ready = true
  try {
    fs.mkdirSync(WEBUI_DATA_DIR, { recursive: true })
    for (const name of [...SUBDIRS, ...legacyNames()]) moveLegacy(name)
    for (const dir of SUBDIRS) fs.mkdirSync(path.join(WEBUI_DATA_DIR, dir), { recursive: true })
    for (const [name, content] of Object.entries(DEFAULT_FILES)) {
      const file = path.join(WEBUI_DATA_DIR, name)
      if (!fs.existsSync(file)) fs.writeFileSync(file, content, "utf8")
    }
  } catch (error) {
    console.error(`[WebUI] 数据目录初始化失败: ${error.message}`)
  }
  return WEBUI_DATA_DIR
}

ensureWebuiData()
