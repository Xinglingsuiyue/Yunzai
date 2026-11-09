import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { WEBUI_DATA_DIR } from "../webui/dataDir.js"

const ICON_DIR = path.join(WEBUI_DATA_DIR, "help-icons")
const MAX_LIST_ICONS = 100

const MIME_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
}

const EXT_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
}

const NAME_RE = /^ic-[a-f0-9]{12}\.(?:png|jpe?g|webp|gif)$/
const VALUE_RE = /^icon:([a-zA-Z0-9._-]+)$/
const cache = new Map()

function iconError(message) {
  const error = new Error(message)
  error.status = 400
  return error
}

function sniffExt(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png"
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg"
  if (buf.length >= 4 && buf.subarray(0, 3).toString() === "GIF") return "gif"
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString() === "RIFF" &&
    buf.subarray(8, 12).toString() === "WEBP"
  )
    return "webp"
  return ""
}

export function saveHelpIcon(buffer, mime) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw iconError("仅支持 PNG / JPEG / WebP / GIF 图片")
  const buf = buffer
  const ext = sniffExt(buf)
  const expected = MIME_EXT[String(mime || "").split(";")[0].trim().toLowerCase()]
  if (!ext || !expected || ext !== expected) throw iconError("图片格式校验失败")

  const name = `ic-${crypto.createHash("sha1").update(buf).digest("hex").slice(0, 12)}.${ext}`
  const target = path.join(ICON_DIR, name)
  try {
    if (!fs.existsSync(target)) {
      fs.mkdirSync(ICON_DIR, { recursive: true })
      fs.writeFileSync(target, buf)
    }
  } catch (error) {
    const wrapped = new Error(`图标保存失败: ${error.message}`)
    wrapped.status = 500
    throw wrapped
  }
  cache.set(name, `data:${EXT_MIME[ext]};base64,${buf.toString("base64")}`)
  return { value: `icon:${name}`, name }
}

export function helpIconDataUrl(name) {
  const file = path.basename(String(name || ""))
  if (!NAME_RE.test(file)) return ""
  if (cache.has(file)) return cache.get(file)
  try {
    const target = path.join(ICON_DIR, file)
    if (!fs.existsSync(target)) return ""
    const ext = path.extname(file).slice(1).toLowerCase()
    const mime = EXT_MIME[ext]
    if (!mime) return ""
    const url = `data:${mime};base64,${fs.readFileSync(target).toString("base64")}`
    cache.set(file, url)
    return url
  } catch {
    return ""
  }
}

export function resolveIconValue(value) {
  const match = VALUE_RE.exec(String(value || "").trim())
  return match ? helpIconDataUrl(match[1]) : ""
}

export function listHelpIcons() {
  try {
    return fs
      .readdirSync(ICON_DIR)
      .filter(name => NAME_RE.test(name))
      .sort()
      .slice(0, MAX_LIST_ICONS)
      .map(name => ({ name }))
  } catch {
    return []
  }
}

export function readHelpIconFile(name) {
  const file = path.basename(String(name || ""))
  if (!NAME_RE.test(file)) return null
  const ext = path.extname(file).slice(1).toLowerCase()
  const mime = EXT_MIME[ext]
  if (!mime) return null
  try {
    const target = path.join(ICON_DIR, file)
    if (!fs.existsSync(target)) return null
    return { buffer: fs.readFileSync(target), mime }
  } catch {
    return null
  }
}
