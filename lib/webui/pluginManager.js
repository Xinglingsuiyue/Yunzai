import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import cfg from "../config/config.js"
import PluginsLoader from "../plugins/loader.js"
import { listPluginConfigEntries } from "./config.js"
import { WEBUI_DATA_DIR } from "./dataDir.js"
import { addPendingRemoval, clearPendingRemoval, pendingRemovalNames, removePluginDir } from "./pluginPendingRemove.js"

const ROOT = process.cwd()
const PLUGINS_DIR = path.join(ROOT, "plugins")
const CACHE_FILE = path.join(WEBUI_DATA_DIR, "plugin-index-cache.json")
const JS_CACHE_FILE = path.join(WEBUI_DATA_DIR, "js-plugin-index-cache.json")
// 单文件插件的启停状态：{ disabled: ["example/主动复读.js"] }
const SINGLE_STATE_FILE = path.join(WEBUI_DATA_DIR, "plugin-single-state.json")
const CACHE_VERSION = 1
const CACHE_TTL = 6 * 60 * 60 * 1000
const MAX_OUTPUT = 200000

const PROTECTED = new Map([
  ["webui", "WebUI 自身"],
  ["system", "框架核心"],
  ["adapter", "框架适配器"],
  ["other", "框架内置插件"],
  ["example", "框架示例插件"],
])

const DEFAULT_GIT_HOSTS = [
  "github.com",
  "gitee.com",
  "gitlab.com",
  "gitcode.com",
  "git.trss.me",
  "org.trss.me",
]

const INDEX_SOURCES = [
  {
    id: "gitee",
    label: "Gitee",
    base: "https://gitee.com/yhArcadia/Yunzai-Bot-plugins-index/raw/main",
    repo: "https://gitee.com/yhArcadia/Yunzai-Bot-plugins-index",
  },
  {
    id: "github",
    label: "GitHub",
    base: "https://raw.githubusercontent.com/yhArcadia/Yunzai-Bot-plugins-index/main",
    repo: "https://github.com/yhArcadia/Yunzai-Bot-plugins-index",
  },
]

const INDEX_FILES = [
  { file: "README.md", category: "recommended", heading: /推荐插件/ },
  { file: "Function-Plugin.md", category: "function", heading: /功能类插件索引/ },
  { file: "Game-Plugin.md", category: "game", heading: /游戏IP类插件索引/ },
]

// 单 JS 插件库：表格列依次为 名称 / 作者 / 源码 / 备注
const JS_INDEX_SOURCES = [
  {
    id: "gitee",
    label: "Gitee",
    url: "https://gitee.com/yhArcadia/Yunzai-Bot-plugins-index/raw/main/JS-Plugin.md",
    repo: "https://gitee.com/yhArcadia/Yunzai-Bot-plugins-index/blob/main/JS-Plugin.md",
  },
  {
    id: "github",
    label: "GitHub",
    url: "https://raw.githubusercontent.com/yhArcadia/Yunzai-Bot-plugins-index/main/JS-Plugin.md",
    repo: "https://github.com/yhArcadia/Yunzai-Bot-plugins-index/blob/main/JS-Plugin.md",
  },
]

const JS_HOSTS = new Set([
  "gitee.com",
  "raw.githubusercontent.com",
  "github.com",
  "gitcode.com",
  "raw.gitcode.com",
])

const CATEGORY_LABELS = {
  recommended: "推荐",
  function: "功能",
  game: "游戏",
  local: "本地",
}

export class PluginManagerError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}
let busyAction = ""
let indexPromise = null

function plainText(value) {
  return String(value || "")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function repoNameFromUrl(link) {
  try {
    const url = new URL(link)
    const segments = url.pathname.split("/").filter(Boolean)
    if (segments.length < 2) return ""
    let name = decodeURIComponent(segments[segments.length - 1])
    name = name.replace(/\.git$/i, "").trim()
    return /^[\p{L}\p{N}._-]{1,80}$/u.test(name) ? name : ""
  } catch {
    return ""
  }
}

function normalizeRepoLink(link) {
  let value = String(link || "").trim()
  if (!value) return ""
  value = value.replace(/^git\+/, "")
  const ssh = value.match(/^git@([^:]+):(.+)$/)
  if (ssh) value = `https://${ssh[1]}/${ssh[2]}`
  const sshUrl = value.match(/^ssh:\/\/git@([^/]+)\/(.+)$/)
  if (sshUrl) value = `https://${sshUrl[1]}/${sshUrl[2]}`
  return value.replace(/\.git$/i, "")
}

function linkFromCell(cell) {
  const match = String(cell || "").match(/\[([^\]]*)]\(([^)\s]+)(?:\s+"[^"]*")?\)/)
  if (!match) return null
  return { text: plainText(match[1]), url: match[2].trim() }
}

function linksFromCell(cell) {
  const links = []
  const re = /\[([^\]]*)]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  let match
  while ((match = re.exec(String(cell || "")))) {
    const name = plainText(match[1]).replace(/^@+/, "").trim()
    if (name) links.push({ name, url: match[2].trim() })
  }
  return links
}

function parseTableRows(text, heading) {
  const lines = String(text || "").split(/\r?\n/)
  const headingIndex = lines.findIndex(line => line.trim().startsWith("##") && heading.test(line))
  if (headingIndex < 0) return []
  let index = headingIndex + 1
  let separator = false
  for (; index < lines.length; index++) {
    const line = lines[index].trim()
    if (/^\|[\s:|-]+\|$/.test(line)) {
      separator = true
      index++
      break
    }
  }
  if (!separator) return []

  const rows = []
  for (; index < lines.length; index++) {
    const line = lines[index].trim()
    if (!line) continue
    if (!line.startsWith("|")) break
    const columns = line.replace(/^\||\|$/g, "").split("|").map(item => item.trim())
    if (columns.length < 3) continue
    rows.push([columns[0], columns[1], columns.slice(2).join(" | ")])
  }
  return rows
}

function parseIndexText(text, category) {
  const rows = parseTableRows(text, INDEX_FILES.find(item => item.category === category)?.heading || /./)
  const entries = []
  for (const [titleCell, authorCell, descriptionCell] of rows) {
    const linkInfo = linkFromCell(titleCell)
    const link = linkInfo?.url || ""
    const name = repoNameFromUrl(link)
    if (!name) continue
    let title = linkInfo?.text || plainText(titleCell)
    if (!title || /^名称$/.test(title)) continue
    const deprecated = /^~~[\s\S]+~~$/.test(titleCell.trim()) || /^~~[\s\S]+~~$/.test(String(title).trim())
    title = plainText(title)
    if (!title) continue
    const authorLinks = linksFromCell(authorCell)
    const authors = authorLinks.length
      ? authorLinks.map(item => item.name)
      : plainText(authorCell)
          .split(/[,，、/]/)
          .map(item => item.replace(/^@+/, "").trim())
          .filter(Boolean)
    entries.push({
      name,
      title,
      link,
      authors: [...new Set(authors)],
      authorLinks,
      description: plainText(descriptionCell),
      category,
      categoryLabel: CATEGORY_LABELS[category] || category,
      deprecated,
    })
  }
  return entries
}

function mergeIndexEntries(entries) {
  const map = new Map()
  for (const entry of entries) {
    if (entry.deprecated) continue
    const key = entry.name.toLowerCase()
    const existing = map.get(key)
    if (!existing) {
      map.set(key, {
        ...entry,
        authors: [...entry.authors],
        authorLinks: [...entry.authorLinks],
        sources: [entry.source],
      })
      continue
    }
    existing.sources = [...new Set([...existing.sources, entry.source])]
    existing.authors = [...new Set([...existing.authors, ...entry.authors])]
    const known = new Set(existing.authorLinks.map(item => item.url))
    for (const link of entry.authorLinks) if (!known.has(link.url)) existing.authorLinks.push(link)
    if (!existing.description || entry.description.length > existing.description.length)
      existing.description = entry.description
    if (!existing.link) existing.link = entry.link
    const priority = { recommended: 3, function: 2, game: 1 }
    if ((priority[entry.category] || 0) > (priority[existing.category] || 0)) {
      existing.category = entry.category
      existing.categoryLabel = entry.categoryLabel
    }
  }
  return [...map.values()]
}

async function fetchText(url, timeout = 18000) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: { "User-Agent": "TRSS-Yunzai-WebUI/1.0" },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const text = await response.text()
  if (!text.trim()) throw new Error("返回内容为空")
  return text
}

/* ---------------- 单 JS 插件库（JS-Plugin.md） ---------------- */

// 表格里的源码链接经常指向仓库页面（blob/tree），这里统一转成能直接下载的 raw 地址
function toRawSourceUrl(link) {
  const text = String(link || "").trim()
  if (!text) return ""
  let url
  try {
    url = new URL(text)
  } catch {
    return ""
  }
  if (!/^https?:$/.test(url.protocol) || !JS_HOSTS.has(url.hostname.toLowerCase())) return ""
  const host = url.hostname.toLowerCase()

  if (host === "gitee.com") {
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent)
    // /owner/repo/blob/branch/path -> /owner/repo/raw/branch/path
    if (parts.length >= 5 && parts[2] === "blob")
      return `https://gitee.com/${parts[0]}/${parts[1]}/raw/${parts.slice(3).join("/")}`
    if (parts.length >= 5 && parts[2] === "raw") return url.href
    return ""
  }

  if (host === "github.com") {
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent)
    // /owner/repo/blob/branch/path -> raw.githubusercontent.com
    if (parts.length >= 5 && parts[2] === "blob")
      return `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${parts.slice(3).join("/")}`
    // /owner/repo/raw/branch/path -> 同源重定向，保留但视为可用
    if (parts.length >= 5 && parts[2] === "raw") return url.href
    return ""
  }

  if (host === "raw.githubusercontent.com" || host === "raw.gitcode.com") return url.href

  if (host === "gitcode.com") {
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent)
    // gitcode 的 /raw/ 会返回 HTML 页面，必须换成 raw.gitcode.com
    if (parts.length >= 5 && ["blob", "raw"].includes(parts[2]))
      return `https://raw.gitcode.com/${parts[0]}/${parts[1]}/raw/${parts.slice(3).join("/")}`
    return ""
  }

  return ""
}

function jsFileName(url, fallback) {
  try {
    const pathname = decodeURIComponent(new URL(url).pathname)
    const base = pathname.split("/").filter(Boolean).pop() || ""
    if (/\.js$/i.test(base)) return base
  } catch {}
  return `${String(fallback || "plugin").replace(/[\\/:*?"<>|]/g, "_")}.js`
}

/** 解析 JS-Plugin.md：名称 / 作者 / 源码 / 备注，源码列可能同时给出多个镜像 */
function parseJsIndexText(text) {
  const entries = []
  let inTable = false
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    let line = rawLine.trim()
    if (line.startsWith("<!--")) continue
    // 上游表里有几行漏了行首竖线，补回来再按表格解析
    if (inTable && !line.startsWith("|") && line.includes("](") && (line.match(/\|/g) || []).length >= 2)
      line = `|${line}`
    if (!line.startsWith("|")) continue
    if (/^\|[\s:|-]+\|$/.test(line)) {
      inTable = true
      continue
    }
    if (!inTable) continue
    // 上游表里有个别行把两条记录粘在一起，用 || 拆开再各自解析
    for (const segment of line.split("||")) {
      const cells = segment.replace(/^\||\|$/g, "").split("|").map(item => item.trim())
      if (cells.length < 3) continue
      const nameInfo = linkFromCell(cells[0])
      const authorLinks = linksFromCell(cells[1])
      const sourceLinks = linksFromCell(cells[2])
      const rawUrls = [...new Set(sourceLinks.map(item => toRawSourceUrl(item.url)).filter(Boolean))]
      if (!rawUrls.length) continue
      const title = plainText(nameInfo?.text || cells[0])
      if (!title || /^名称$/.test(title)) continue
      const authors = authorLinks.length
        ? authorLinks.map(item => item.name)
        : plainText(cells[1])
            .split(/[,，、/]/)
            .map(item => item.replace(/^@+/, "").trim())
            .filter(Boolean)
      entries.push({
        title,
        file: jsFileName(rawUrls[0], title),
        downloadUrls: rawUrls,
        link: nameInfo?.url || sourceLinks[0]?.url || rawUrls[0],
        authors: [...new Set(authors)],
        authorLinks,
        description: plainText(cells.slice(3).join(" ")),
      })
    }
  }
  return entries
}

async function fetchJsIndex() {
  const settled = await Promise.allSettled(
    JS_INDEX_SOURCES.map(async source => {
      const text = await fetchText(source.url)
      return { source, entries: parseJsIndexText(text) }
    }),
  )
  const sources = []
  const merged = new Map()
  for (let index = 0; index < settled.length; index++) {
    const meta = JS_INDEX_SOURCES[index]
    const result = settled[index]
    if (result.status === "rejected") {
      sources.push({ id: meta.id, label: meta.label, repo: meta.repo, ok: false, count: 0, error: String(result.reason?.message || result.reason) })
      continue
    }
    const entries = result.value.entries
    sources.push({ id: meta.id, label: meta.label, repo: meta.repo, ok: entries.length > 0, count: entries.length, error: entries.length ? "" : "未解析到插件" })
    for (const entry of entries) {
      // 同名文件可能来自不同仓库，用源码地址区分，避免把两个插件错并成一个
      const key = `${entry.file.toLowerCase()}|${String(entry.downloadUrls[0] || "").toLowerCase()}`
      const existing = merged.get(key)
      if (existing) {
        existing.sources = [...new Set([...existing.sources, meta.id])]
        existing.downloadUrls = [...new Set([...existing.downloadUrls, ...entry.downloadUrls])]
        existing.authors = [...new Set([...existing.authors, ...entry.authors])]
        if (!existing.description) existing.description = entry.description
        continue
      }
      merged.set(key, { ...entry, sources: [meta.id] })
    }
  }
  const used = new Set()
  const entries = [...merged.values()].map(entry => {
    let file = entry.file
    if (used.has(file.toLowerCase())) {
      const base = file.replace(/\.js$/i, "")
      const suffix = String(entry.title || "插件").replace(/[\\/:*?"<>|]/g, "_")
      file = `${base}-${suffix}.js`
      let index = 2
      while (used.has(file.toLowerCase())) file = `${base}-${suffix}-${index++}.js`
    }
    used.add(file.toLowerCase())
    return { ...entry, file }
  })
  return { entries, sources }
}

function readJsCache() {
  try {
    const parsed = JSON.parse(fs.readFileSync(JS_CACHE_FILE, "utf8"))
    if (parsed?.version !== CACHE_VERSION || !Array.isArray(parsed.entries)) return null
    return parsed
  } catch {
    return null
  }
}

function writeJsCache(data) {
  try {
    fs.mkdirSync(path.dirname(JS_CACHE_FILE), { recursive: true })
    fs.writeFileSync(JS_CACHE_FILE, JSON.stringify({ version: CACHE_VERSION, ...data }, null, 2))
  } catch (error) {
    try {
      Bot.makeLog("warn", `单 JS 插件索引缓存写入失败: ${error.message}`, "WebUI")
    } catch {}
  }
}

let jsIndexPromise = null

async function getJsIndex(force) {
  if (!force) {
    const cache = readJsCache()
    if (cache && Date.now() - cache.updatedAt < CACHE_TTL) return { ...cache, fromCache: true, stale: false }
  }
  if (jsIndexPromise) return jsIndexPromise
  jsIndexPromise = (async () => {
    const cache = readJsCache()
    try {
      const result = await fetchJsIndex()
      if (result.entries.length) {
        const data = { updatedAt: Date.now(), entries: result.entries, sources: result.sources }
        writeJsCache(data)
        return { ...data, fromCache: false, stale: false }
      }
      if (cache) return { ...cache, fromCache: true, stale: true }
      return { updatedAt: 0, entries: [], sources: result.sources, fromCache: false, stale: true }
    } catch (error) {
      if (cache) return { ...cache, fromCache: true, stale: true }
      return {
        updatedAt: 0,
        entries: [],
        sources: JS_INDEX_SOURCES.map(source => ({
          id: source.id,
          label: source.label,
          repo: source.repo,
          ok: false,
          count: 0,
          error: error.message,
        })),
        fromCache: false,
        stale: true,
      }
    } finally {
      jsIndexPromise = null
    }
  })()
  return jsIndexPromise
}

async function fetchSource(source) {
  const settled = await Promise.allSettled(
    INDEX_FILES.map(async item => {
      const text = await fetchText(`${source.base}/${item.file}`)
      return parseIndexText(text, item.category)
    }),
  )
  const entries = []
  const errors = []
  for (let index = 0; index < settled.length; index++) {
    const result = settled[index]
    if (result.status === "fulfilled") for (const entry of result.value) entries.push({ ...entry, source: source.id })
    else errors.push(`${INDEX_FILES[index].file}: ${result.reason?.message || result.reason}`)
  }
  return {
    id: source.id,
    label: source.label,
    repo: source.repo,
    ok: entries.length > 0,
    count: entries.length,
    error: errors.join("；"),
    entries,
  }
}

async function fetchIndex() {
  const results = await Promise.all(INDEX_SOURCES.map(source => fetchSource(source)))
  const entries = mergeIndexEntries(results.flatMap(result => result.entries))
  const sources = results.map(({ entries: _entries, ...rest }) => rest)
  return { entries, sources }
}

function readCache() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"))
    if (parsed?.version !== CACHE_VERSION || !Array.isArray(parsed.entries)) return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(data) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true })
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ version: CACHE_VERSION, ...data }, null, 2))
  } catch (error) {
    try {
      Bot.makeLog("warn", `插件索引缓存写入失败: ${error.message}`, "WebUI")
    } catch {}
  }
}

async function getIndex(force) {
  if (!force) {
    const cache = readCache()
    if (cache && Date.now() - cache.updatedAt < CACHE_TTL) return { ...cache, fromCache: true, stale: false }
  }
  if (indexPromise) return indexPromise
  indexPromise = (async () => {
    const cache = readCache()
    try {
      const result = await fetchIndex()
      if (result.entries.length) {
        const data = { updatedAt: Date.now(), entries: result.entries, sources: result.sources }
        writeCache(data)
        return { ...data, fromCache: false, stale: false }
      }
      if (cache) return { ...cache, fromCache: true, stale: true }
      return { updatedAt: 0, entries: [], sources: result.sources, fromCache: false, stale: true }
    } catch (error) {
      if (cache) return { ...cache, fromCache: true, stale: true }
      return {
        updatedAt: 0,
        entries: [],
        sources: INDEX_SOURCES.map(source => ({
          id: source.id,
          label: source.label,
          repo: source.repo,
          ok: false,
          count: 0,
          error: error.message,
        })),
        fromCache: false,
        stale: true,
      }
    } finally {
      indexPromise = null
    }
  })()
  return indexPromise
}

function readPackage(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"))
  } catch {
    return null
  }
}

function readReadmeTitle(dir) {
  for (const name of ["README.md", "readme.md", "Readme.md"]) {
    try {
      const text = fs.readFileSync(path.join(dir, name), "utf8").slice(0, 20000)
      const match = text.match(/^#\s+(.+)$/m)
      if (match) {
        const title = plainText(match[1]).slice(0, 120)
        if (title) return title
      }
    } catch {}
  }
  return ""
}

function readGitRemote(dir) {
  try {
    const text = fs.readFileSync(path.join(dir, ".git", "config"), "utf8")
    const match = text.match(/^\s*url\s*=\s*(.+)$/m)
    return match ? normalizeRepoLink(match[1].trim()) : ""
  } catch {
    return ""
  }
}

function authorText(author) {
  if (!author) return ""
  if (typeof author === "string") return plainText(author).replace(/^@+/, "")
  if (Array.isArray(author)) return author.map(authorText).filter(Boolean).join("、")
  if (typeof author === "object") return plainText(author.name || author.nickname || author.email || "")
  return ""
}

function localPluginInfo(name) {
  const dir = path.join(PLUGINS_DIR, name)
  let stat
  try {
    stat = fs.statSync(dir)
  } catch {
    return null
  }
  if (!stat.isDirectory() || name.startsWith(".")) return null
  const pkg = readPackage(dir)
  const title = plainText(pkg?.displayName || pkg?.title || "").slice(0, 120) || readReadmeTitle(dir) || name
  const packageLink = normalizeRepoLink(
    typeof pkg?.repository === "string" ? pkg.repository : pkg?.repository?.url || pkg?.homepage || "",
  )
  return {
    name,
    title,
    author: authorText(pkg?.author) || authorText(pkg?.contributors),
    description: plainText(pkg?.description || ""),
    link: packageLink || readGitRemote(dir),
    version: String(pkg?.version || ""),
    hasGit: fs.existsSync(path.join(dir, ".git")),
    hasPackage: !!pkg,
  }
}

/** 没有 index.js 的目录插件：把每个 .js 当成独立插件列出来 */
function readSingleFilePlugins(folder) {
  const dir = path.join(PLUGINS_DIR, folder)
  const lower = folder.toLowerCase()
  // 框架内置目录（system/adapter/other/webui）仍按整目录展示，避免把核心文件拆成可停用项
  if (PROTECTED.has(lower) && lower !== "example") return []
  let files = []
  try {
    if (fs.existsSync(path.join(dir, "index.js"))) return []
    files = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith(".js") && !entry.name.startsWith("."))
      .map(entry => entry.name)
  } catch {
    return []
  }
  return files.map(file => {
    const full = path.join(dir, file)
    let stat = null
    try {
      stat = fs.statSync(full)
    } catch {}
    const key = `${folder}/${file}`
    const title = file.replace(/\.js$/i, "")
    return {
      name: key,
      key,
      file,
      folder,
      singleFile: true,
      title,
      author: "",
      description: "",
      link: "",
      version: "",
      hasGit: false,
      hasPackage: false,
      installed: true,
      loaded: false,
      configs: 0,
      hasGuoba: false,
      protected: PROTECTED.has(folder.toLowerCase()),
      protectedReason: PROTECTED.get(folder.toLowerCase()) || "",
      sources: [],
      authors: [],
      authorLinks: [],
      category: "local",
      categoryLabel: CATEGORY_LABELS.local,
      canUninstall: false,
      canRemoveFile: true,
      canToggle: true,
      canEdit: lower === "example",
      canUpdate: false,
      updatedAt: stat ? stat.mtimeMs : 0,
    }
  })
}

/** 单独的「单文件插件」清单：example 这类目录里的每个 js */
function listSingleFilePlugins() {
  const loadedKeys = new Set((PluginsLoader.priority || []).map(entry => String(entry.key || "")))
  const disabledKeys = new Set(disabledPluginKeys())
  const pendingRemove = pendingRemovalNames()
  let folders = []
  try {
    folders = fs
      .readdirSync(PLUGINS_DIR, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
      .map(entry => entry.name)
  } catch {
    return []
  }
  const plugins = []
  for (const folder of folders) {
    if (pendingRemove.has(folder)) continue
    for (const single of readSingleFilePlugins(folder)) {
      const enabled = !disabledKeys.has(single.key)
      plugins.push({ ...single, enabled, loaded: enabled && loadedKeys.has(single.key) })
    }
  }
  return plugins.sort((a, b) => String(a.name).localeCompare(String(b.name), "zh-CN"))
}

function readLocalPlugins() {
  let names = []
  try {
    names = fs
      .readdirSync(PLUGINS_DIR, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
      .map(entry => entry.name)
  } catch {
    return []
  }
  const configMap = new Map(listPluginConfigEntries().plugins.map(entry => [entry.key, entry]))
  const loadedRoots = new Set((PluginsLoader.priority || []).map(entry => String(entry.key || "").split("/")[0]))
  // 已卸载但重启后才删得掉的目录，不再当作已安装插件显示
  const pendingRemove = pendingRemovalNames()
  const plugins = []
  for (const name of names) {
    if (pendingRemove.has(name)) continue
    const info = localPluginInfo(name)
    if (!info) continue
    // 单文件目录（如 example）不在这里出条目，统一放到单独的「单文件插件」区
    if (readSingleFilePlugins(name).length) continue
    const config = configMap.get(name)
    plugins.push({
      ...info,
      installed: true,
      loaded: loadedRoots.has(name),
      enabled: true,
      configs: config?.configs.length || 0,
      hasGuoba: !!config?.hasGuoba,
      protected: PROTECTED.has(name.toLowerCase()),
      protectedReason: PROTECTED.get(name.toLowerCase()) || "",
      sources: [],
      authors: info.author ? [info.author] : [],
      authorLinks: [],
      category: "local",
      categoryLabel: CATEGORY_LABELS.local,
      canUninstall: !PROTECTED.has(name.toLowerCase()),
      canUpdate: info.hasGit && !PROTECTED.has(name.toLowerCase()),
    })
  }
  return plugins
}

function buildPluginList(remoteEntries, locals, sourcesMeta) {
  const localMap = new Map(locals.map(item => [item.name.toLowerCase(), item]))
  const sourceLabelMap = new Map(INDEX_SOURCES.map(item => [item.id, item.label]))
  const plugins = []

  for (const remote of remoteEntries) {
    const local = localMap.get(remote.name.toLowerCase())
    if (local) localMap.delete(remote.name.toLowerCase())
    const sourceLabels = (remote.sources || []).map(id => sourceLabelMap.get(id) || id)
    if (local) {
      plugins.push({
        ...local,
        title: remote.title || local.title,
        author: remote.authors?.join("、") || local.author,
        authors: remote.authors?.length ? remote.authors : local.authors,
        authorLinks: remote.authorLinks || [],
        description: remote.description || local.description,
        link: remote.link || local.link,
        sources: sourceLabels,
        category: remote.category,
        categoryLabel: remote.categoryLabel,
        installed: true,
        status: local.loaded ? "loaded" : "installed",
        canInstall: false,
      })
    } else {
      plugins.push({
        name: remote.name,
        title: remote.title,
        author: remote.authors?.join("、") || "",
        authors: remote.authors || [],
        authorLinks: remote.authorLinks || [],
        description: remote.description || "",
        link: remote.link,
        version: "",
        hasGit: false,
        hasPackage: false,
        installed: false,
        loaded: false,
        configs: 0,
        hasGuoba: false,
        protected: PROTECTED.has(remote.name.toLowerCase()),
        protectedReason: PROTECTED.get(remote.name.toLowerCase()) || "",
        sources: sourceLabels,
        category: remote.category,
        categoryLabel: remote.categoryLabel,
        status: "available",
        canInstall: true,
        canUninstall: false,
        canUpdate: false,
      })
    }
  }

  for (const local of localMap.values()) {
    plugins.push({
      ...local,
      status: local.loaded ? "loaded" : "installed",
      canInstall: false,
    })
  }

  plugins.sort((a, b) => {
    if (a.installed !== b.installed) return a.installed ? -1 : 1
    if (a.loaded !== b.loaded) return a.loaded ? -1 : 1
    return String(a.title || a.name).localeCompare(String(b.title || b.name), "zh-CN")
  })

  const stats = {
    total: plugins.length,
    installed: plugins.filter(item => item.installed).length,
    available: plugins.filter(item => !item.installed).length,
    loaded: plugins.filter(item => item.loaded).length,
    configurable: plugins.filter(item => item.installed && item.configs > 0).length,
  }

  return {
    plugins,
    stats,
    sources: sourcesMeta,
  }
}

export async function listPluginManager({ force = false } = {}) {
  const [index, locals, jsIndex] = await Promise.all([
    getIndex(force),
    Promise.resolve(readLocalPlugins()),
    getJsIndex(force),
  ])
  const data = buildPluginList(index.entries, locals, index.sources)
  const localSingles = listSingleFilePlugins()
  const localNames = new Set(localSingles.map(item => item.file.toLowerCase()))
  const available = jsIndex.entries
    .map(entry => ({
      ...entry,
      installed: localNames.has(String(entry.file).toLowerCase()),
    }))
    .sort((a, b) => Number(a.installed) - Number(b.installed) || String(a.title).localeCompare(String(b.title), "zh-CN"))
  return {
    ...data,
    singleFiles: localSingles,
    singleIndex: {
      entries: available,
      sources: jsIndex.sources,
      updatedAt: jsIndex.updatedAt || 0,
      fromCache: !!jsIndex.fromCache,
      stale: !!jsIndex.stale,
    },
    updatedAt: index.updatedAt || 0,
    fromCache: !!index.fromCache,
    stale: !!index.stale,
  }
}

function allowedGitHosts() {
  const extra = Array.isArray(cfg.webui?.pluginHosts) ? cfg.webui.pluginHosts : []
  return [...new Set([...DEFAULT_GIT_HOSTS, ...extra.map(item => String(item || "").trim().toLowerCase()).filter(Boolean)])]
}

function validateGitLink(raw) {
  const link = String(raw || "").trim()
  if (!link) throw new PluginManagerError("请输入插件 Git 地址")
  if (/[\0\r\n]/.test(link)) throw new PluginManagerError("插件地址包含非法字符")
  let url
  try {
    url = new URL(link)
  } catch {
    throw new PluginManagerError("插件地址无效")
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new PluginManagerError("仅支持 http/https 协议的 Git 地址")
  if (url.username || url.password) throw new PluginManagerError("插件地址不能包含账号或令牌")
  if (url.search || url.hash) throw new PluginManagerError("插件地址不能包含查询参数或锚点")
  const hostname = url.hostname.toLowerCase()
  const allowed = allowedGitHosts()
  if (!allowed.some(host => hostname === host || hostname.endsWith(`.${host}`)))
    throw new PluginManagerError(`不允许从 ${hostname} 安装插件`)
  const name = repoNameFromUrl(url.toString())
  if (!name) throw new PluginManagerError("无法从地址中识别插件名称")
  if (PROTECTED.has(name.toLowerCase()))
    throw new PluginManagerError(`「${name}」是内置插件，不能通过插件管理安装覆盖`, 409)
  return { link: url.toString(), name }
}

function existingPluginNames() {
  try {
    return new Set(
      fs
        .readdirSync(PLUGINS_DIR, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name.toLowerCase()),
    )
  } catch {
    return new Set()
  }
}

function resolvePluginDir(name) {
  const text = String(name || "").trim()
  if (!text || !/^[\p{L}\p{N}._-]{1,80}$/u.test(text) || text === "." || text === ".." || text.startsWith("."))
    throw new PluginManagerError("插件名称无效")
  const dir = path.resolve(PLUGINS_DIR, text)
  if (path.dirname(dir) !== path.resolve(PLUGINS_DIR)) throw new PluginManagerError("插件路径无效")
  if (!fs.existsSync(dir)) throw new PluginManagerError(`插件「${text}」不存在`, 404)
  return { name: text, dir }
}

function runProcess(command, args, { cwd = ROOT, timeout = 120000 } = {}) {
  return new Promise(resolve => {
    let stdout = ""
    let stderr = ""
    let settled = false
    let child
    try {
      child = spawn(command, args, { cwd, windowsHide: true, env: process.env })
    } catch (error) {
      return resolve({ code: -1, error: error.message, stdout, stderr })
    }

    const finish = result => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL")
      } catch {}
      finish({ code: -1, error: `执行超时（${Math.round(timeout / 1000)} 秒）`, stdout, stderr, timedOut: true })
    }, timeout)

    const append = (current, chunk) => (current + String(chunk)).slice(-MAX_OUTPUT)
    child.stdout?.on("data", chunk => {
      stdout = append(stdout, chunk)
    })
    child.stderr?.on("data", chunk => {
      stderr = append(stderr, chunk)
    })
    child.on("error", error => finish({ code: -1, error: error.message, stdout, stderr }))
    child.on("close", code => finish({ code, stdout, stderr }))
  })
}

function tail(text, size = 3000) {
  const value = String(text || "").trim()
  return value.length > size ? value.slice(-size) : value
}

function pnpmScript() {
  const nodeDir = path.dirname(process.execPath)
  const candidates = [
    path.join(nodeDir, "node_modules", "pnpm", "bin", "pnpm.cjs"),
    path.join(nodeDir, "..", "lib", "node_modules", "pnpm", "bin", "pnpm.cjs"),
  ]
  return candidates.find(file => fs.existsSync(file)) || ""
}

async function installDependencies(dir, autoInstall) {
  if (!autoInstall || !fs.existsSync(path.join(dir, "package.json"))) return { skipped: true }
  const script = pnpmScript()
  if (!script) return { skipped: true, error: "未找到 pnpm，请手动安装依赖后重启 Bot" }
  const result = await runProcess(process.execPath, [script, "install"], { cwd: ROOT, timeout: 300000 })
  if (result.code !== 0) {
    return {
      skipped: false,
      error: `依赖安装失败：${result.error || tail(result.stderr) || `退出码 ${result.code}`}`,
    }
  }
  return { skipped: false, output: tail(result.stdout || result.stderr, 1000) }
}

function lockOperation(action) {
  if (busyAction) throw new PluginManagerError(`正在${busyAction}，请稍候再试`, 409)
  busyAction = action
}

function unlockOperation() {
  busyAction = ""
}

/* ---------------- 单文件插件（example 这类无 index.js 的目录） ---------------- */

function readSingleState() {
  try {
    const raw = JSON.parse(fs.readFileSync(SINGLE_STATE_FILE, "utf8"))
    const disabled = Array.isArray(raw?.disabled) ? raw.disabled.map(String) : []
    return { disabled: [...new Set(disabled.filter(Boolean))] }
  } catch {
    return { disabled: [] }
  }
}

function writeSingleState(state) {
  const temp = `${SINGLE_STATE_FILE}.tmp`
  fs.mkdirSync(path.dirname(SINGLE_STATE_FILE), { recursive: true })
  fs.writeFileSync(temp, JSON.stringify({ disabled: state.disabled }, null, 2), "utf8")
  fs.renameSync(temp, SINGLE_STATE_FILE)
}

/** 已停用的单文件插件 key 列表，加载插件时用来跳过 */
export function disabledPluginKeys() {
  return readSingleState().disabled
}

/** 停用清单文件路径，供加载器直接读取 */
export const SINGLE_STATE_PATH = SINGLE_STATE_FILE

/** 解析并校验「目录/文件名.js」形式的单文件插件 key */
function resolveSinglePlugin(key) {
  const text = String(key || "").trim().replace(/\\/g, "/")
  const parts = text.split("/")
  if (parts.length !== 2) throw new PluginManagerError("单文件插件标识无效")
  const [folder, file] = parts
  if (
    !/^[\p{L}\p{N}._-]{1,80}$/u.test(folder) ||
    !/^[\p{L}\p{N}._\- ]{1,120}\.js$/iu.test(file)
  )
    throw new PluginManagerError("单文件插件标识无效")
  if (folder.startsWith(".") || file.startsWith(".")) throw new PluginManagerError("单文件插件标识无效")
  const dir = path.resolve(PLUGINS_DIR, folder)
  const target = path.resolve(dir, file)
  if (path.dirname(dir) !== path.resolve(PLUGINS_DIR) || path.dirname(target) !== dir)
    throw new PluginManagerError("插件路径无效")
  if (!fs.existsSync(target)) throw new PluginManagerError(`插件文件「${text}」不存在`, 404)
  if (fs.existsSync(path.join(dir, "index.js")))
    throw new PluginManagerError("该目录是包式插件，不支持按单文件管理", 400)
  return { key: `${folder}/${file}`, folder, file, dir, target }
}

/** 单个文件的开关文案 */
function singleFileToggleMessage(enabled, key) {
  return enabled ? `已启用「${key}」，立即生效` : `已停用「${key}」，立即生效`
}

export async function setSinglePluginEnabled({ key, enabled, confirm } = {}) {
  const target = resolveSinglePlugin(key)
  const wantEnabled = enabled === true
  if (!wantEnabled && String(confirm || "") !== target.key)
    throw new PluginManagerError("停用确认信息不匹配，请重新确认", 400)

  lockOperation(wantEnabled ? "启用单文件插件" : "停用单文件插件")
  try {
    const state = readSingleState()
    const set = new Set(state.disabled)
    if (wantEnabled) set.delete(target.key)
    else set.add(target.key)
    writeSingleState({ disabled: [...set] })

    // 热生效：停用就卸载，启用就重新导入
    const loader = PluginsLoader
    if (wantEnabled) {
      loader.watch?.(target.folder, target.file)
      await loader.importPlugin({
        name: target.key,
        path: `../../plugins/${target.key}?${Date.now()}`,
      })
      loader.priority = loader.priority.slice().sort((a, b) => (a.priority || 0) - (b.priority || 0))
      loader.createTask?.()
    } else {
      await loader.unloadPlugin(target.key, true)
    }

    return {
      ok: true,
      key: target.key,
      enabled: wantEnabled,
      restartRequired: false,
      message: singleFileToggleMessage(wantEnabled, target.key),
    }
  } finally {
    unlockOperation()
  }
}

export async function removeSinglePlugin({ key, confirm } = {}) {
  const target = resolveSinglePlugin(key)
  if (String(confirm || "") !== target.key)
    throw new PluginManagerError("删除确认信息不匹配，请重新确认", 400)

  lockOperation("删除单文件插件")
  try {
    await PluginsLoader.unloadPlugin(target.key, true)
    fs.unlinkSync(target.target)
    const state = readSingleState()
    if (state.disabled.includes(target.key)) {
      writeSingleState({ disabled: state.disabled.filter(item => item !== target.key) })
    }
    return {
      ok: true,
      key: target.key,
      message: `已删除「${target.key}」`,
    }
  } finally {
    unlockOperation()
  }
}

/** 读取单个单文件插件的源码，供 WebUI 编辑器使用 */
export function readSinglePluginSource({ key } = {}) {
  const target = resolveSinglePlugin(key)
  let stat = null
  try {
    stat = fs.statSync(target.target)
  } catch {}
  if (stat && stat.size > 2 * 1024 * 1024) throw new PluginManagerError("文件超过 2MB，无法在控制台编辑", 413)
  return {
    key: target.key,
    file: target.file,
    content: fs.readFileSync(target.target, "utf8"),
    updatedAt: stat ? stat.mtimeMs : 0,
  }
}

export async function createSinglePlugin({ file, content } = {}) {
  const raw = String(file || "").trim()
  if (!raw) throw new PluginManagerError("请填写插件文件名")
  const name = /\.js$/i.test(raw) ? raw : `${raw}.js`
  if (!/^[\p{L}\p{N}._\- ]{1,120}\.js$/iu.test(name)) throw new PluginManagerError("插件文件名无效")
  if (name.startsWith(".")) throw new PluginManagerError("插件文件名无效")

  const code = String(content ?? "")
  if (!code.trim()) throw new PluginManagerError("请粘贴插件代码")
  if (Buffer.byteLength(code, "utf8") > 2 * 1024 * 1024) throw new PluginManagerError("代码超过 2MB 上限")

  const dir = path.join(PLUGINS_DIR, "example")
  const target = path.join(dir, name)
  if (path.dirname(target) !== dir) throw new PluginManagerError("插件路径无效")
  if (fs.existsSync(target)) throw new PluginManagerError(`example/${name} 已存在`, 409)

  lockOperation("新建单 JS 插件")
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(target, code, "utf8")
    const key = `example/${name}`
    PluginsLoader.watch?.("example", name)
    const success = await PluginsLoader.importPlugin({ name: key, path: `../../plugins/${key}?${Date.now()}` })
    if (success) {
      PluginsLoader.priority = PluginsLoader.priority
        .slice()
        .sort((a, b) => (a.priority || 0) - (b.priority || 0))
      PluginsLoader.createTask?.()
    }
    return {
      ok: true,
      key,
      loaded: !!success,
      message: success ? `已新建并加载「${key}」` : `已保存「${key}」，但加载失败，请检查代码后重启`,
    }
  } finally {
    unlockOperation()
  }
}

export async function saveSinglePlugin({ key, file, content } = {}) {
  const target = resolveSinglePlugin(key)
  const raw = String(file || "").trim() || target.file
  const name = /\.js$/i.test(raw) ? raw : `${raw}.js`
  if (!/^[\p{L}\p{N}._\- ]{1,120}\.js$/iu.test(name)) throw new PluginManagerError("插件文件名无效")
  if (name.startsWith(".")) throw new PluginManagerError("插件文件名无效")

  const code = String(content ?? "")
  if (!code.trim()) throw new PluginManagerError("插件代码不能为空")
  if (Buffer.byteLength(code, "utf8") > 2 * 1024 * 1024) throw new PluginManagerError("代码超过 2MB 上限")

  const renamed = name !== target.file
  const nextTarget = path.join(target.dir, name)
  if (path.dirname(nextTarget) !== target.dir) throw new PluginManagerError("插件路径无效")
  if (renamed && fs.existsSync(nextTarget)) throw new PluginManagerError(`example/${name} 已存在`, 409)

  const nextKey = `${target.folder}/${name}`
  const wasDisabled = readSingleState().disabled.includes(target.key)

  lockOperation("保存单 JS 插件")
  try {
    await PluginsLoader.unloadPlugin(target.key, true)
    if (renamed) fs.renameSync(target.target, nextTarget)
    fs.writeFileSync(nextTarget, code, "utf8")

    if (renamed && wasDisabled) {
      const state = readSingleState()
      writeSingleState({
        disabled: state.disabled.map(item => (item === target.key ? nextKey : item)).filter((item, i, arr) => arr.indexOf(item) === i),
      })
    }

    PluginsLoader.watch?.(target.folder, name)
    const success = !readSingleState().disabled.includes(nextKey)
      ? await PluginsLoader.importPlugin({ name: nextKey, path: `../../plugins/${nextKey}?${Date.now()}` })
      : false
    if (success) {
      PluginsLoader.priority = PluginsLoader.priority
        .slice()
        .sort((a, b) => (a.priority || 0) - (b.priority || 0))
      PluginsLoader.createTask?.()
    }
    return {
      ok: true,
      key: nextKey,
      renamed,
      loaded: !!success,
      message: success ? `已保存并重新加载「${nextKey}」` : `已保存「${nextKey}」`,
    }
  } finally {
    unlockOperation()
  }
}

/** 递归列出目录里的 .js 文件，返回相对路径 */
function listJsFiles(dir, base = dir, depth = 0) {
  if (depth > 6) return []
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files = []
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listJsFiles(full, base, depth + 1))
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue
    files.push(path.relative(base, full).replace(/\\/g, "/"))
  }
  return files
}

/** 克隆前先看一眼仓库里有哪些 js，供用户勾选 */
export async function listSinglePluginRepoFiles({ link } = {}) {
  const target = validateGitLink(link)
  lockOperation(`读取「${target.name}」的文件列表`)
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "yunzai-js-"))
  try {
    const result = await runProcess("git", ["clone", "--depth", "1", "--single-branch", target.link, temp], {
      timeout: 180000,
    })
    if (result.code !== 0)
      throw new PluginManagerError(
        `克隆失败：${result.error || tail(result.stderr) || `git 退出码 ${result.code}`}`,
        500,
      )
    const files = listJsFiles(temp).filter(rel => {
      const base = path.basename(rel)
      return /^[\p{L}\p{N}._\- ]{1,120}\.js$/iu.test(base) && !base.startsWith(".")
    })
    return {
      ok: true,
      name: target.name,
      files: files.map(rel => ({
        path: rel,
        name: path.basename(rel),
        exists: fs.existsSync(path.join(PLUGINS_DIR, "example", path.basename(rel))),
      })),
    }
  } finally {
    try {
      fs.rmSync(temp, { recursive: true, force: true })
    } catch {}
    unlockOperation()
  }
}

export async function cloneSinglePluginRepo({ link, files } = {}) {
  const target = validateGitLink(link)
  const wanted = (Array.isArray(files) ? files : []).map(item => String(item || "").trim()).filter(Boolean)
  if (!wanted.length) throw new PluginManagerError("请选择要导入的 js 文件")

  lockOperation(`克隆单 JS 插件「${target.name}」`)
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "yunzai-js-"))
  try {
    const result = await runProcess("git", ["clone", "--depth", "1", "--single-branch", target.link, temp], {
      timeout: 180000,
    })
    if (result.code !== 0)
      throw new PluginManagerError(
        `克隆失败：${result.error || tail(result.stderr) || `git 退出码 ${result.code}`}`,
        500,
      )

    const available = new Set(listJsFiles(temp))
    const dir = path.join(PLUGINS_DIR, "example")
    fs.mkdirSync(dir, { recursive: true })

    const imported = []
    const skipped = []
    const loaded = []
    for (const rel of wanted) {
      if (!available.has(rel)) {
        skipped.push(`${rel}（仓库中不存在）`)
        continue
      }
      const base = path.basename(rel)
      if (!/^[\p{L}\p{N}._\- ]{1,120}\.js$/iu.test(base) || base.startsWith(".")) {
        skipped.push(`${rel}（文件名不合法）`)
        continue
      }
      const dest = path.join(dir, base)
      if (fs.existsSync(dest)) {
        skipped.push(`${base}（本地已存在）`)
        continue
      }
      fs.copyFileSync(path.join(temp, rel), dest)
      const key = `example/${base}`
      PluginsLoader.watch?.("example", base)
      const ok = await PluginsLoader.importPlugin({ name: key, path: `../../plugins/${key}?${Date.now()}` })
      imported.push(base)
      if (ok) loaded.push(base)
    }

    if (loaded.length) {
      PluginsLoader.priority = PluginsLoader.priority.slice().sort((a, b) => (a.priority || 0) - (b.priority || 0))
      PluginsLoader.createTask?.()
    }
    if (!imported.length)
      throw new PluginManagerError(`没有可用文件被导入${skipped.length ? `：${skipped.join("、")}` : ""}`, 400)

    return {
      ok: true,
      source: target.name,
      imported,
      loaded,
      skipped,
      message: `已导入 ${imported.length} 个文件${
        loaded.length ? `，加载 ${loaded.length} 个` : ""
      }${skipped.length ? `；跳过 ${skipped.length} 个` : ""}`,
    }
  } finally {
    try {
      fs.rmSync(temp, { recursive: true, force: true })
    } catch {}
    unlockOperation()
  }
}

export async function installSinglePlugin({ urls, title = "", file = "" } = {}) {
  const list = (Array.isArray(urls) ? urls : [urls]).map(item => String(item || "").trim()).filter(Boolean)
  if (!list.length) throw new PluginManagerError("缺少插件源码地址")

  const targets = [...new Set(list.map(item => toRawSourceUrl(item)).filter(Boolean))]
  if (!targets.length) throw new PluginManagerError("该源码地址不在允许的域名内")

  const name = jsFileName(targets[0], title || file || "plugin")
  if (!/^[\p{L}\p{N}._\- ]{1,120}\.js$/iu.test(name)) throw new PluginManagerError("插件文件名无效")

  const dir = path.join(PLUGINS_DIR, "example")
  const target = path.join(dir, name)
  if (path.dirname(target) !== dir) throw new PluginManagerError("插件路径无效")
  if (fs.existsSync(target)) throw new PluginManagerError(`example/${name} 已存在`, 409)

  lockOperation("安装单 JS 插件")
  try {
    // 索引里常给 Gitee / GitHub 两个镜像，逐个尝试直到拿到真正的 js
    let content = ""
    let lastError = null
    for (const candidate of targets) {
      try {
        const text = await fetchText(candidate, 30000)
        if (/^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text)) {
          lastError = new Error("返回的是网页而不是 js 文件")
          continue
        }
        content = text
        break
      } catch (error) {
        lastError = error
      }
    }
    if (!content) throw new PluginManagerError(`源码下载失败：${lastError?.message || "未知错误"}`, 502)

    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(target, content, "utf8")
    const key = `example/${name}`
    PluginsLoader.watch?.("example", name)
    await PluginsLoader.importPlugin({ name: key, path: `../../plugins/${key}?${Date.now()}` })
    PluginsLoader.priority = PluginsLoader.priority
      .slice()
      .sort((a, b) => (a.priority || 0) - (b.priority || 0))
    PluginsLoader.createTask?.()
    return { ok: true, key, message: `已安装并加载「${key}」` }
  } finally {
    unlockOperation()
  }
}

export async function installPlugin({ link, autoInstall = true } = {}) {
  const target = validateGitLink(link)
  const pending = pendingRemovalNames()
  const installed = existingPluginNames().has(target.name.toLowerCase()) && !pending.has(target.name)
  if (installed) throw new PluginManagerError(`插件「${target.name}」已安装`, 409)

  lockOperation("安装插件")
  const dir = path.join(PLUGINS_DIR, target.name)
  try {
    if (pending.has(target.name) && !(await removePluginDir(target.name)))
      throw new PluginManagerError(`插件「${target.name}」的旧文件仍被占用，请重启 Bot 后重试`, 409)
    clearPendingRemoval(target.name)
    const result = await runProcess("git", ["clone", "--depth", "1", "--single-branch", target.link, dir], {
      timeout: 180000,
    })
    if (result.code !== 0) {
      try {
        if (fs.existsSync(dir)) await fs.promises.rm(dir, { recursive: true, force: true })
      } catch {}
      throw new PluginManagerError(
        `插件安装失败：${result.error || tail(result.stderr) || `git 退出码 ${result.code}`}`,
        500,
      )
    }

    const deps = await installDependencies(dir, autoInstall)
    const info = localPluginInfo(target.name)
    return {
      ok: true,
      name: target.name,
      title: info?.title || target.name,
      restartRequired: true,
      dependencyWarning: deps.error || "",
      message: deps.error
        ? `插件「${target.name}」已下载，但${deps.error}`
        : `插件「${target.name}」安装完成，重启 Bot 后生效`,
    }
  } finally {
    unlockOperation()
  }
}

export async function uninstallPlugin({ name, confirm } = {}) {
  const target = resolvePluginDir(name)
  if (String(confirm || "") !== target.name)
    throw new PluginManagerError("卸载确认信息不匹配，请重新确认", 400)
  if (PROTECTED.has(target.name.toLowerCase()))
    throw new PluginManagerError(`「${target.name}」是内置插件，不能通过插件管理卸载`, 403)

  lockOperation("卸载插件")
  try {
    // 先让插件从加载器退场，插件自己登记的资源回收会释放数据库等句柄
    await unloadPluginGroup(target.name)
    const removed = await removePluginDir(target.name)
    if (!removed) {
      addPendingRemoval(target.name)
      return {
        ok: true,
        name: target.name,
        restartRequired: true,
        pendingRemove: true,
        message: `插件「${target.name}」已停用，文件仍被占用（数据库等），重启 Bot 后自动删除`,
      }
    }
    return {
      ok: true,
      name: target.name,
      restartRequired: true,
      message: `插件「${target.name}」已卸载，重启 Bot 后完全生效`,
    }
  } finally {
    unlockOperation()
  }
}

/** 卸载该目录下的全部插件条目（包式插件含各子文件条目） */
async function unloadPluginGroup(name) {
  const keys = new Set()
  for (const entry of PluginsLoader.priority || []) {
    const key = String(entry?.key || "")
    if (key === name || key.startsWith(`${name}/`)) keys.add(key)
  }
  for (const key of keys) {
    try {
      await PluginsLoader.unloadPlugin(key, true)
    } catch (error) {
      Bot.makeLog("warn", [`插件「${key}」卸载失败`, error], "WebUI")
    }
  }
  try {
    await PluginsLoader.closePluginWatchers?.(name)
  } catch {}
}

export async function updatePlugin({ name, autoInstall = true } = {}) {
  const target = resolvePluginDir(name)
  if (PROTECTED.has(target.name.toLowerCase()))
    throw new PluginManagerError(`「${target.name}」是内置插件，不支持在线更新`, 403)
  if (!fs.existsSync(path.join(target.dir, ".git")))
    throw new PluginManagerError(`插件「${target.name}」不是 Git 仓库，无法在线更新`, 400)

  lockOperation("更新插件")
  try {
    const result = await runProcess("git", ["pull", "--ff-only"], { cwd: target.dir, timeout: 120000 })
    if (result.code !== 0) {
      throw new PluginManagerError(
        `插件更新失败：${result.error || tail(result.stderr) || `git 退出码 ${result.code}`}`,
        500,
      )
    }
    const deps = await installDependencies(target.dir, autoInstall)
    return {
      ok: true,
      name: target.name,
      restartRequired: true,
      output: tail(result.stdout, 2000),
      dependencyWarning: deps.error || "",
      message: deps.error
        ? `插件「${target.name}」已更新，但${deps.error}`
        : `插件「${target.name}」已更新，重启 Bot 后生效`,
    }
  } finally {
    unlockOperation()
  }
}
