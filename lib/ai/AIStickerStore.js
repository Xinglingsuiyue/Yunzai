/**
 * 表情包仓库 — 按含义分类、以含义命名的本地图片库。
 *
 * 目录结构：data/stickers/<分类>/<含义>_<短哈希>.<ext>
 * 索引文件：data/stickers/index.json
 * 文件名即含义，方便人工直接浏览；索引记录描述、标签与使用次数。
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

const INDEX_VERSION = 1
const MAX_MEANING = 24
const MAX_DESC = 200
const MAX_TAGS = 12
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

const IMAGE_EXT = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/bmp", "bmp"],
])

function safeName(value, fallback = "未命名") {
  const text = String(value || "")
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "")
    .replace(/\s+/g, "")
    .trim()
  return text.slice(0, MAX_MEANING) || fallback
}

function sniffExt(buffer) {
  if (!buffer || buffer.length < 12) return ""
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "png"
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg"
  if (buffer.slice(0, 3).toString() === "GIF") return "gif"
  if (buffer.slice(0, 4).toString() === "RIFF" && buffer.slice(8, 12).toString() === "WEBP") return "webp"
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return "bmp"
  return ""
}

function shortHash(value) {
  let hash = 0x811c9dc5
  for (const char of String(value)) {
    hash ^= char.codePointAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36).slice(0, 6)
}

export default class AIStickerStore {
  constructor(baseDir) {
    this.dir = baseDir
    this.indexFile = path.join(baseDir, "index.json")
    this.pendingDir = path.join(baseDir, "_pending")
    this.pendingFile = path.join(baseDir, "_pending.json")
    this.entries = []
    this.pending = []
    this.loaded = false
  }

  _ensureDir() {
    fs.mkdirSync(this.dir, { recursive: true })
    fs.mkdirSync(this.pendingDir, { recursive: true })
  }

  load() {
    if (this.loaded) return this
    this._ensureDir()
    try {
      const raw = JSON.parse(fs.readFileSync(this.indexFile, "utf8"))
      this.entries = Array.isArray(raw?.entries) ? raw.entries : []
    } catch {
      this.entries = []
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.pendingFile, "utf8"))
      this.pending = Array.isArray(raw?.entries) ? raw.entries : []
    } catch {
      this.pending = []
    }
    this.loaded = true
    return this
  }

  savePending() {
    this._ensureDir()
    const tmp = `${this.pendingFile}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ version: INDEX_VERSION, entries: this.pending }, null, 2))
    fs.renameSync(tmp, this.pendingFile)
  }

  saveIndex() {
    this._ensureDir()
    const payload = { version: INDEX_VERSION, entries: this.entries }
    const tmp = `${this.indexFile}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2))
    fs.renameSync(tmp, this.indexFile)
  }

  /** 分类列表：目录 + 数量 */
  categories() {
    const map = new Map()
    for (const entry of this.entries) {
      const key = entry.category || "其他"
      map.set(key, (map.get(key) || 0) + 1)
    }
    return [...map.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"))
  }

  /**
   * 表情是否带有任一角色标签。
   * 只比 tags 字段且要求整词相等：早期把 meaning/category/description 也纳入
   * 子串匹配，导致「开心」命中别的人格同分类图、「汐」命中「今汐」，跨人格串图。
   */
  _matchesTags(entry, tags) {
    const wanted = (tags || []).map(tag => String(tag).trim().toLowerCase()).filter(Boolean)
    if (!wanted.length) return false
    const have = (entry.tags || []).map(tag => String(tag).trim().toLowerCase()).filter(Boolean)
    return wanted.some(tag => have.includes(tag))
  }

  list(options = {}) {
    const category = String(options.category || "").trim()
    const query = String(options.query || "").trim().toLowerCase()
    const presetId = String(options.presetId || "").trim()
    const tags = options.tags || []
    let rows = this.entries
    if (options.scopeByPreset !== false) {
      // 「只发自己表情」按角色标签筛选；否则按上传来源附加公共表情
      if (options.ownOnly === true && tags.length) {
        rows = rows.filter(entry => this._matchesTags(entry, tags))
      } else if (presetId) {
        rows = rows.filter(entry => !entry.presetId || entry.presetId === presetId)
      }
    }
    if (category) rows = rows.filter(entry => entry.category === category)
    if (query) {
      rows = rows.filter(entry =>
        [entry.meaning, entry.description, entry.category, ...(entry.tags || [])]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query),
      )
    }
    rows = [...rows].sort(
      (a, b) => (b.usedCount || 0) - (a.usedCount || 0) || (b.createdAt || 0) - (a.createdAt || 0),
    )
    return options.limit ? rows.slice(0, Number(options.limit)) : rows
  }

  get(id) {
    return this.entries.find(entry => entry.id === id) || null
  }

  /** 绝对路径 → 可对外提供的相对路径 */
  relPath(entry) {
    return entry?.file || ""
  }

  absPath(entry) {
    return entry?.file ? path.join(this.dir, entry.file) : ""
  }

  /**
   * 保存一张表情
   * @param {Buffer} buffer 图片数据
   * @param {Object} meta { meaning, category, description, tags, source, mimeType, senderName, groupId, presetId, presetName, skipReview, reviewTimeoutMs }
   * 需要审核时先进入待审区，主人放行或超时自动通过后才入库
   */
  add(buffer, meta = {}) {
    this.load()
    const prepared = this._prepare(buffer, meta)
    if (prepared.duplicate) return prepared
    if (!meta.skipReview && meta.requireReview !== false && meta.requireReview === true) {
      return this._enqueue(prepared, meta)
    }
    return this._commit(prepared, buffer)
  }

  /** 校验图片并算出落库所需信息 */
  _prepare(buffer, meta = {}) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("表情图片为空")
    if (buffer.length > MAX_IMAGE_BYTES) throw new Error("表情图片过大（最多 8MB）")
    // 以文件头为准，避免只改 Content-Type 就能塞入任意内容
    const ext = sniffExt(buffer)
    if (!ext) throw new Error("无法识别的图片格式")

    const category = safeName(meta.category, "其他")
    const meaning = safeName(meta.meaning, "未命名表情")
    const digest = crypto.createHash("sha1").update(buffer).digest("hex").slice(0, 12)
    const presetId = String(meta.presetId || "").slice(0, 40)
    const presetName = safeName(meta.presetName || "", "")

    // 同一人格内去重；不同人格互不影响
    const existing = this.entries.find(
      entry => entry.digest === digest && String(entry.presetId || "") === presetId,
    )
    if (existing) return { entry: existing, duplicate: true }
    const queued = this.pending.find(
      item => item.digest === digest && String(item.presetId || "") === presetId,
    )
    if (queued) return { entry: queued, duplicate: true, pending: true }

    const tags = Array.isArray(meta.tags)
      ? meta.tags.map(tag => safeName(tag, "")).filter(Boolean).slice(0, MAX_TAGS)
      : []
    return {
      duplicate: false,
      buffer,
      ext,
      category,
      meaning,
      digest,
      presetId,
      presetName,
      tags,
      meta,
    }
  }

  /** 正式写入表情库 */
  _commit(prepared, buffer) {
    const { category, meaning, digest, presetId, presetName, tags, ext, meta } = prepared
    // 分类目录下按预设分子目录，便于人工浏览也避免不同人格表情混在一起
    const relDir = presetName ? path.join(category, presetName) : category
    fs.mkdirSync(path.join(this.dir, relDir), { recursive: true })
    let base = `${meaning}_${shortHash(digest)}`
    let file = path.join(relDir, `${base}.${ext}`)
    let index = 2
    while (fs.existsSync(path.join(this.dir, file))) {
      base = `${meaning}_${shortHash(digest)}_${index++}`
      file = path.join(relDir, `${base}.${ext}`)
    }
    fs.writeFileSync(path.join(this.dir, file), buffer)

    const entry = {
      id: shortHash(`${digest}:${Date.now()}`) + digest.slice(0, 4),
      file: file.replace(/\\/g, "/"),
      meaning,
      category,
      presetId,
      presetName,
      description: String(meta.description || "").slice(0, MAX_DESC),
      tags,
      source: String(meta.source || "manual").slice(0, 32),
      senderName: String(meta.senderName || "").slice(0, 64),
      groupId: String(meta.groupId || "").slice(0, 32),
      digest,
      ext,
      size: buffer.length,
      usedCount: 0,
      lastUsedAt: 0,
      createdAt: Date.now(),
    }
    this.entries.push(entry)
    this.saveIndex()
    return { entry, duplicate: false }
  }

  /** 进入待审区：图片先落盘，索引单独存，审核前不可用 */
  _enqueue(prepared, meta) {
    const timeoutMs = Math.max(60 * 1000, Number(meta.reviewTimeoutMs) || 24 * 60 * 60 * 1000)
    const id = `pnd_${shortHash(`${prepared.digest}:${Date.now()}`)}${prepared.digest.slice(0, 4)}`
    const fileName = `${id}.${prepared.ext}`
    fs.writeFileSync(path.join(this.pendingDir, fileName), prepared.buffer)
    const item = {
      id,
      pending: true,
      file: `_pending/${fileName}`,
      meaning: prepared.meaning,
      category: prepared.category,
      presetId: prepared.presetId,
      presetName: prepared.presetName,
      description: String(meta.description || "").slice(0, MAX_DESC),
      tags: prepared.tags,
      source: String(meta.source || "manual").slice(0, 32),
      senderName: String(meta.senderName || "").slice(0, 64),
      groupId: String(meta.groupId || "").slice(0, 32),
      digest: prepared.digest,
      ext: prepared.ext,
      size: prepared.buffer.length,
      createdAt: Date.now(),
      expiresAt: Date.now() + timeoutMs,
    }
    this.pending.push(item)
    this.savePending()
    return { entry: item, duplicate: false, pending: true, expiresAt: item.expiresAt }
  }

  listPending() {
    this.load()
    this.autoApproveExpired()
    return [...this.pending].sort((a, b) => a.createdAt - b.createdAt)
  }

  getPending(id) {
    this.load()
    return this.pending.find(item => item.id === id) || null
  }

  /** 主人放行 */
  approve(id) {
    this.load()
    const index = this.pending.findIndex(item => item.id === id)
    if (index < 0) return null
    const item = this.pending[index]
    const abs = path.join(this.dir, item.file)
    let buffer = null
    try {
      buffer = fs.readFileSync(abs)
    } catch {
      this.pending.splice(index, 1)
      this.savePending()
      return null
    }
    // 先出队再校验，否则待审项会把自己判成重复
    this.pending.splice(index, 1)
    this.savePending()
    const prepared = this._prepare(buffer, {
      meaning: item.meaning,
      category: item.category,
      presetId: item.presetId,
      presetName: item.presetName,
      tags: item.tags,
      description: item.description,
      source: item.source,
      senderName: item.senderName,
      groupId: item.groupId,
    })
    try {
      fs.unlinkSync(abs)
    } catch {}
    if (prepared.duplicate) return { entry: prepared.entry, duplicate: true }
    const result = this._commit(prepared, buffer)
    return { ...result, approved: true }
  }

  /** 主人拒绝：删掉待审图片 */
  reject(id, reason = "") {
    this.load()
    const index = this.pending.findIndex(item => item.id === id)
    if (index < 0) return false
    const [item] = this.pending.splice(index, 1)
    try {
      fs.unlinkSync(path.join(this.dir, item.file))
    } catch {}
    this.savePending()
    try {
      globalThis.Bot?.makeLog?.("info", `表情审核拒绝 ${item.category}/${item.meaning} ${reason}`.trim(), "AISticker")
    } catch {}
    return true
  }

  /** 超时未审核自动放行 */
  autoApproveExpired(now = Date.now()) {
    this.load()
    let count = 0
    for (const item of [...this.pending]) {
      if (!item.expiresAt || item.expiresAt > now) continue
      const result = this.approve(item.id)
      if (result) count++
    }
    return count
  }

  update(id, patch = {}) {
    this.load()
    const entry = this.get(id)
    if (!entry) return null
    const renamed = patch.meaning !== undefined || patch.category !== undefined
    if (patch.meaning !== undefined) entry.meaning = safeName(patch.meaning, entry.meaning)
    if (patch.category !== undefined) entry.category = safeName(patch.category, entry.category)
    if (patch.description !== undefined) entry.description = String(patch.description || "").slice(0, MAX_DESC)
    if (patch.tags !== undefined)
      entry.tags = Array.isArray(patch.tags)
        ? patch.tags.map(tag => safeName(tag, "")).filter(Boolean).slice(0, MAX_TAGS)
        : []

    // 只在含义/分类变化时挪文件；补描述不该改动已入库的路径
    // 与 _commit 一致：有预设时落在分类下的人格子目录
    if (renamed) {
      const relDir = entry.presetName ? path.join(entry.category, entry.presetName) : entry.category
      const nextFile = path
        .join(relDir, `${entry.meaning}_${shortHash(entry.digest)}.${entry.ext}`)
        .replace(/\\/g, "/")
      if (nextFile !== entry.file) {
        fs.mkdirSync(path.join(this.dir, relDir), { recursive: true })
        const absOld = path.join(this.dir, entry.file)
        const absNew = path.join(this.dir, nextFile)
        try {
          if (fs.existsSync(absOld) && !fs.existsSync(absNew)) {
            fs.renameSync(absOld, absNew)
            entry.file = nextFile
          }
        } catch {}
      }
    }
    this.saveIndex()
    return entry
  }

  remove(id) {
    this.load()
    const index = this.entries.findIndex(entry => entry.id === id)
    if (index < 0) return false
    const [entry] = this.entries.splice(index, 1)
    try {
      fs.unlinkSync(path.join(this.dir, entry.file))
    } catch {}
    try {
      const dir = path.dirname(path.join(this.dir, entry.file))
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
    } catch {}
    this.saveIndex()
    return true
  }

  markUsed(id) {
    const entry = this.get(id)
    if (!entry) return
    entry.usedCount = (entry.usedCount || 0) + 1
    entry.lastUsedAt = Date.now()
    this.saveIndex()
  }

  stats(options = {}) {
    this.load()
    const presetId = String(options.presetId || "").trim()
    const tags = options.tags || []
    let rows = this.entries
    if (options.ownOnly === true && tags.length) {
      // 只发自己的表情：按角色标签统计
      rows = rows.filter(entry => this._matchesTags(entry, tags))
    } else if (presetId) {
      rows = rows.filter(entry => !entry.presetId || entry.presetId === presetId)
    }
    const map = new Map()
    for (const entry of rows) {
      const key = entry.category || "其他"
      map.set(key, (map.get(key) || 0) + 1)
    }
    const byCategory = [...map.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"))
    return {
      total: rows.length,
      categories: byCategory.length,
      byCategory,
      totalUsed: rows.reduce((sum, entry) => sum + (entry.usedCount || 0), 0),
    }
  }

  /**
   * 预设能否上传表情
   * @param {Object} preset 预设对象
   * @param {Object} config { uploadMode: "off"|"whitelist"|"blacklist", uploadWhitelist: [], uploadBlacklist: [] }
   */
  canUpload(preset, config = {}) {
    const mode = String(config.uploadMode || "off").toLowerCase()
    if (mode === "off") return true
    const id = String(preset?.id || "")
    if (!id) return false
    const whitelist = (config.uploadWhitelist || []).map(String)
    const blacklist = (config.uploadBlacklist || []).map(String)
    if (mode === "whitelist") return whitelist.includes(id)
    if (mode === "blacklist") return !blacklist.includes(id)
    return true
  }

  /** 按含义挑一张：优先本预设的表情；ownOnly 时完全不使用公共表情 */
  pickByMeaning(text, options = {}) {
    this.load()
    const query = String(text || "").trim().toLowerCase()
    const category = String(options.category || "").trim()
    const presetId = String(options.presetId || "").trim()
    const ownOnly = options.ownOnly === true
    const tags = options.tags || []
    let rows = this.entries
    if (ownOnly && tags.length) {
      // 「只发自己表情」按角色标签筛选，不再参考上传来源
      rows = rows.filter(entry => this._matchesTags(entry, tags))
    } else if (presetId) {
      rows = rows.filter(entry => !entry.presetId || entry.presetId === presetId)
    }
    if (category) rows = rows.filter(entry => entry.category === category)
    // 非标签模式下，优先本预设上传的表情
    const own = !ownOnly && presetId ? rows.filter(entry => entry.presetId === presetId) : []
    const pickFrom = list => {
      if (query) {
        const scored = list
          .map(entry => {
            const haystack = [entry.meaning, entry.description, entry.category, ...(entry.tags || [])]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
            let score = 0
            if (entry.meaning.toLowerCase() === query) score += 100
            if (entry.meaning.toLowerCase().includes(query)) score += 40
            if ((entry.tags || []).some(tag => tag.toLowerCase().includes(query))) score += 20
            if (entry.category.toLowerCase().includes(query)) score += 15
            if (entry.description.toLowerCase().includes(query)) score += 8
            if (haystack.includes(query)) score += 4
            return { entry, score }
          })
          .filter(item => item.score > 0)
          .sort((a, b) => b.score - a.score || (a.entry.usedCount || 0) - (b.entry.usedCount || 0))
        if (scored.length) return scored[0].entry
      }
      if (!list.length) return null
      return [...list].sort((a, b) => (a.usedCount || 0) - (b.usedCount || 0))[0]
    }
    return pickFrom(own) || pickFrom(rows)
  }
}

export { safeName, sniffExt, IMAGE_EXT, MAX_IMAGE_BYTES }
