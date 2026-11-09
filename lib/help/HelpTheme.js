import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import YAML from "yaml"
import { WEBUI_DATA_DIR } from "../webui/dataDir.js"

const THEME_DIR = path.join(process.cwd(), "resources", "help", "theme")
const CUSTOM_THEME_DIR = path.join(WEBUI_DATA_DIR, "help-themes")
const CUSTOM_THEME_RE = /^custom-[a-f0-9]{12}$/
const DEFAULT_THEME = "default"
const MAX_THUMB_BYTES = 400 * 1024
const MAX_CSS_BYTES = 128 * 1024

const MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
}

const STYLE_DEFAULTS = {
  accentColor: "#c8a96b",
  fontColor: "#f2e6cf",
  fontShadow: "0 1px 10px rgba(0, 0, 0, 0.45)",
  descColor: "#9aa4b4",
  descShadow: "none",
  contBgColor: "rgba(24, 29, 38, 0.72)",
  contBgBlur: 6,
  headerBgColor: "rgba(255, 255, 255, 0.05)",
  rowBgColor1: "rgba(255, 255, 255, 0.028)",
  rowBgColor2: "rgba(255, 255, 255, 0.006)",
}

const MAIN_CANDIDATES = ["main.png", "main.jpg", "main.jpeg", "main.webp"]
const BG_CANDIDATES = ["bg.jpg", "bg.png", "bg.webp"]
const THUMB_CANDIDATES = ["thumb.jpg", "thumb.png", "thumb.webp"]
const UPLOAD_MIME_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
}

function readDirNames() {
  try {
    return fs
      .readdirSync(THEME_DIR, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch {
    return []
  }
}

function readCustomNames() {
  try {
    return fs
      .readdirSync(CUSTOM_THEME_DIR, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && CUSTOM_THEME_RE.test(entry.name))
      .map(entry => entry.name)
  } catch {
    return []
  }
}

function isThemeDir(dir) {
  return ["theme.yaml", "theme.css", ...MAIN_CANDIDATES, ...BG_CANDIDATES].some(name =>
    fs.existsSync(path.join(dir, name)),
  )
}

function themeDirOf(name) {
  return CUSTOM_THEME_RE.test(name) ? path.join(CUSTOM_THEME_DIR, name) : path.join(THEME_DIR, name)
}

function themeNames() {
  const names = readDirNames().filter(name => isThemeDir(path.join(THEME_DIR, name)))
  for (const name of readCustomNames()) {
    if (isThemeDir(path.join(CUSTOM_THEME_DIR, name))) names.push(name)
  }
  return names
}

function toNameList(value) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
  if (typeof value === "string") return value.split(",").map(item => item.trim()).filter(Boolean)
  return []
}

function pickTheme(theme, exclude, forced) {
  const names = themeNames()
  if (!names.length) return DEFAULT_THEME

  if (forced && names.includes(forced)) return forced

  const excluded = new Set(toNameList(exclude))
  const wanted = typeof theme === "string" ? theme.trim() : ""
  const isAll = !wanted || wanted.toLowerCase() === "all"

  let pool
  if (isAll) {
    pool = names.filter(name => !excluded.has(name))
  } else {
    const wantedNames = toNameList(theme).filter(name => names.includes(name))
    pool = wantedNames.length ? wantedNames : names.filter(name => !excluded.has(name))
  }
  if (!pool.length) pool = names
  return pool[Math.floor(Math.random() * pool.length)] || DEFAULT_THEME
}

const PREVIEW_TOKENS = { main: "help-asset:theme-main", bg: "help-asset:theme-bg" }

function imageDataUrl(dir, file, maxBytes = Infinity, placeholder = "") {
  const name = path.basename(String(file || ""))
  if (!name) return ""
  const target = path.join(dir, name)
  const ext = path.extname(name).slice(1).toLowerCase()
  const mime = MIME[ext]
  if (!mime) return ""
  try {
    if (!fs.existsSync(target) || fs.statSync(target).size > maxBytes) return ""
    if (placeholder) return placeholder
    return `data:${mime};base64,${fs.readFileSync(target).toString("base64")}`
  } catch {
    return ""
  }
}

function findImage(dir, configured, candidates, placeholder = "") {
  const explicit = imageDataUrl(dir, configured, Infinity, placeholder)
  if (explicit) return explicit
  for (const name of candidates) {
    const url = imageDataUrl(dir, name, Infinity, placeholder)
    if (url) return url
  }
  return ""
}

function readTheme(name, options = {}) {
  const names = themeNames()
  const themeName = names.includes(name) ? name : names.includes(DEFAULT_THEME) ? DEFAULT_THEME : names[0]
  if (!themeName) return { name: DEFAULT_THEME, label: "", style: {}, main: "", bg: "", css: "" }

  const dir = themeDirOf(themeName)
  let doc = {}
  const yamlFile = path.join(dir, "theme.yaml")
  if (fs.existsSync(yamlFile)) {
    try {
      const parsed = YAML.parse(fs.readFileSync(yamlFile, "utf8"))
      if (parsed && typeof parsed === "object") doc = parsed
    } catch (err) {
      Bot.makeLog("warn", [`帮助皮肤 ${themeName} 的 theme.yaml 解析失败`, err.message], "HelpTheme")
    }
  }

  let css = ""
  const cssFile = path.join(dir, "theme.css")
  try {
    if (fs.existsSync(cssFile) && fs.statSync(cssFile).size <= MAX_CSS_BYTES)
      css = fs.readFileSync(cssFile, "utf8")
  } catch {}

  let style = {}
  if (doc.style && typeof doc.style === "object") {
    style = doc.style
  } else {
    for (const [key, value] of Object.entries(doc)) {
      if (key === "main" || key === "bg" || key === "name" || key === "css") continue
      if (value !== null && typeof value !== "object") style[key] = value
    }
  }

  return {
    name: themeName,
    label: typeof doc.label === "string" ? doc.label.trim().slice(0, 40) : "",
    style,
    main: findImage(dir, doc.main, MAIN_CANDIDATES, options.preview ? PREVIEW_TOKENS.main : ""),
    bg: findImage(dir, doc.bg, BG_CANDIDATES, options.preview ? PREVIEW_TOKENS.bg : ""),
    css,
  }
}

function resolveStyle(themeStyle, helpCfg) {
  const style = { ...STYLE_DEFAULTS, ...themeStyle }
  for (const [key, value] of Object.entries(helpCfg)) {
    if (!(key in STYLE_DEFAULTS)) continue
    if (value === "" || value === undefined || value === null) continue
    style[key] = value
  }
  return style
}

function buildStyleTag(style, theme, helpCfg) {
  const blur = Number(style.contBgBlur)
  const vars = {
    "--accent": style.accentColor,
    "--title-color": style.fontColor,
    "--title-shadow": style.fontShadow,
    "--desc-color": style.descColor,
    "--desc-shadow": style.descShadow,
    "--cont-bg": style.contBgColor,
    "--cont-blur": `${helpCfg.bgBlur === false ? 0 : Number.isFinite(blur) ? blur : 0}px`,
    "--header-bg": style.headerBgColor,
    "--row-bg1": style.rowBgColor1,
    "--row-bg2": style.rowBgColor2,
  }
  const css = [`:root{${Object.entries(vars).map(([key, value]) => `${key}:${value}`).join(";")}}`]
  if (theme.css) css.push(theme.css)
  if (theme.main)
    css.push(
      `#panel{background-image:linear-gradient(155deg,rgba(8,10,14,.5),rgba(8,10,14,.8)),url("${theme.main}");background-size:cover;background-position:center;}`,
    )
  if (theme.bg)
    css.push(
      `body{background-image:linear-gradient(160deg,rgba(8,10,14,.85),rgba(8,10,14,.95)),url("${theme.bg}");background-size:cover;background-position:center;background-attachment:fixed;}`,
    )

  return `<style data-theme="${theme.name}">${css.join("\n")}</style>`
}

export function listHelpThemes() {
  return themeNames()
}

function themeMainName(dir) {
  for (const name of MAIN_CANDIDATES) if (fs.existsSync(path.join(dir, name))) return name
  return ""
}

function themeThumbName(dir) {
  for (const name of THUMB_CANDIDATES) if (fs.existsSync(path.join(dir, name))) return name
  return ""
}

function themeDetailOf(name) {
  const theme = readTheme(name)
  const style = resolveStyle(theme.style, {})
  const dir = themeDirOf(theme.name)
  const previewName = themeThumbName(dir) || themeMainName(dir)
  return {
    name: theme.name,
    label: theme.label || theme.name,
    custom: CUSTOM_THEME_RE.test(theme.name),
    hasThumb: !!previewName,
    style: {
      accentColor: style.accentColor,
      fontColor: style.fontColor,
      descColor: style.descColor,
      contBgColor: style.contBgColor,
      headerBgColor: style.headerBgColor,
    },
  }
}

export function listHelpThemeDetails() {
  return themeNames().map(themeDetailOf)
}

function themeError(message) {
  const error = new Error(message)
  error.status = 400
  return error
}

function removeFile(file) {
  try {
    fs.unlinkSync(file)
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
}

function removeDir(dir) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    if (error.code === "ENOENT") return
    throw error
  }
  for (const entry of entries) {
    const target = path.join(dir, entry.name)
    if (entry.isDirectory()) removeDir(target)
    else removeFile(target)
  }
  fs.rmdirSync(dir)
}

function sizeText(bytes) {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / 1024 / 1024)}MB` : `${Math.round(bytes / 1024)}KB`
}

function sniffExt(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png"
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg"
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString() === "RIFF" &&
    buf.subarray(8, 12).toString() === "WEBP"
  )
    return "webp"
  return ""
}

function validateImage(buffer, mime, maxBytes, label) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw themeError("仅支持 PNG / JPEG / WebP 图片")
  if (buffer.length > maxBytes) throw themeError(`${label}不能超过 ${sizeText(maxBytes)}`)
  const ext = sniffExt(buffer)
  const expected = UPLOAD_MIME_EXT[String(mime || "").split(";")[0].trim().toLowerCase()]
  if (!ext || !expected || ext !== expected) throw themeError("仅支持 PNG / JPEG / WebP 图片")
  return { buf: buffer, ext }
}

export function saveHelpTheme({ buffer, mime, label } = {}) {
  const image = validateImage(buffer, mime, Infinity, "背景图")
  const id = `custom-${crypto.createHash("sha1").update(image.buf).digest("hex").slice(0, 12)}`
  const dir = path.join(CUSTOM_THEME_DIR, id)
  try {
    fs.mkdirSync(dir, { recursive: true })
    for (const name of MAIN_CANDIDATES) {
      const file = path.join(dir, name)
      if (name !== `main.${image.ext}` && fs.existsSync(file)) removeFile(file)
    }
    fs.writeFileSync(path.join(dir, `main.${image.ext}`), image.buf)
    const name = String(label || "")
      .trim()
      .replace(/\.(png|jpe?g|webp)$/i, "")
      .slice(0, 40)
    fs.writeFileSync(path.join(dir, "theme.yaml"), `label: ${JSON.stringify(name || id)}\n`)
  } catch (error) {
    const wrapped = new Error(`皮肤保存失败: ${error.message}`)
    wrapped.status = 500
    throw wrapped
  }
  return { value: id, theme: themeDetailOf(id) }
}

export function saveHelpThemeThumb({ name, buffer, mime } = {}) {
  const target = String(name || "").trim()
  if (!CUSTOM_THEME_RE.test(target)) throw themeError("只能为上传的皮肤添加缩略图")
  const dir = path.join(CUSTOM_THEME_DIR, target)
  if (!fs.existsSync(dir)) throw themeError("自定义皮肤不存在")
  const image = validateImage(buffer, mime, MAX_THUMB_BYTES, "缩略图")
  try {
    for (const candidate of THUMB_CANDIDATES) {
      const file = path.join(dir, candidate)
      if (candidate !== `thumb.${image.ext}` && fs.existsSync(file)) removeFile(file)
    }
    fs.writeFileSync(path.join(dir, `thumb.${image.ext}`), image.buf)
  } catch (error) {
    const wrapped = new Error(`缩略图保存失败: ${error.message}`)
    wrapped.status = 500
    throw wrapped
  }
  return { value: target, theme: themeDetailOf(target) }
}

export function deleteHelpTheme(name) {
  const target = String(name || "").trim()
  if (!CUSTOM_THEME_RE.test(target)) throw themeError("只能删除上传的自定义皮肤")
  try {
    const dir = path.join(CUSTOM_THEME_DIR, target)
    removeDir(dir)
    if (fs.existsSync(dir)) throw new Error("目录仍存在，可能被占用")
  } catch (error) {
    const wrapped = new Error(`皮肤删除失败: ${error.message}`)
    wrapped.status = 500
    throw wrapped
  }
  return { value: target }
}

export function getThemeData(helpCfg, forcedTheme = "", options = {}) {
  const theme = readTheme(pickTheme(helpCfg.theme, helpCfg.themeExclude, forcedTheme), {
    preview: options.preview === true,
  })
  return {
    themeName: theme.name,
    themeStyle: buildStyleTag(resolveStyle(theme.style, helpCfg), theme, helpCfg),
  }
}

export function getThemeAssets(name) {
  const theme = readTheme(typeof name === "string" ? name : "")
  const dir = themeDirOf(theme.name)
  const thumbName = themeThumbName(dir) || themeMainName(dir)
  return {
    themeName: theme.name,
    main: theme.main,
    bg: theme.bg,
    thumb: thumbName ? imageDataUrl(dir, thumbName, MAX_THUMB_BYTES) : "",
  }
}
