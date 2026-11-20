import crypto from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import sqlite3 from "sqlite3"
import { DATA_DIR } from "../webui/dataDir.js"
import { computeImageHash, hashSimilarity, prepareVisionImage } from "./imageSimilarity.js"

const BASE_DIR = path.join(DATA_DIR, "characters")
const DB_FILE = path.join(BASE_DIR, "characters.sqlite3")
const IMAGE_DIR = path.join(BASE_DIR, "images")
const ANALYSIS_CONCURRENCY = 2
const VISION_TIMEOUT = 60000
const MAX_IMAGE_BYTES = 16 * 1024 * 1024
const EXT_MIME = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" }
const FIELD_LABELS = {
  hair: "发色与发型",
  eyes: "眼睛",
  outfit: "常见服装",
  accessories: "配饰与道具",
  distinctive: "标志性特征",
}
const FIELD_TOPK = { hair: 1, eyes: 1, outfit: 3, accessories: 3, distinctive: 4 }

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`
}

function clean(value, max = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max)
}

function parseList(value) {
  if (Array.isArray(value)) return value.map(item => clean(item, 80)).filter(Boolean)
  const raw = String(value ?? "").trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.map(item => clean(item, 80)).filter(Boolean)
  } catch {}
  return raw.split(/[,，、;；\n]+/).map(item => clean(item, 80)).filter(Boolean)
}

function uniqueList(values, max = 40) {
  const out = []
  const seen = new Set()
  for (const value of values || []) {
    const item = clean(value, 80)
    if (!item) continue
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
    if (out.length >= max) break
  }
  return out
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

function parseObservation(value) {
  if (!value) return null
  try {
    const data = JSON.parse(value)
    return data && typeof data === "object" ? data : null
  } catch {
    return null
  }
}

function normalizeObservation(input) {
  const data = input && typeof input === "object" ? input : {}
  return {
    matches: data.matches !== false,
    description: clean(data.description || data.scene || data.note, 500),
    hair: clean(data.hair, 200),
    eyes: clean(data.eyes, 200),
    outfit: clean(data.outfit, 300),
    accessories: clean(data.accessories, 300),
    distinctive: clean(data.distinctive, 300),
    notes: clean(data.notes, 500),
  }
}

function mapCharacter(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    work: row.work || "",
    aliases: parseList(row.aliases),
    tags: parseList(row.tags),
    appearance: row.appearance || "",
    notes: row.notes || "",
    appearanceLocked: Number(row.appearance_locked) === 1,
    source: row.source || "webui",
    imageCount: Number(row.image_count || 0),
    analyzedCount: Number(row.analyzed_count || 0),
    pendingCount: Number(row.pending_count || 0),
    coverImageId: row.cover_image_id || "",
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
  }
}

function mapImage(row) {
  if (!row) return null
  return {
    id: row.id,
    characterId: row.character_id,
    mime: row.mime || "",
    hash: row.hash || "",
    status: row.status || "pending",
    observation: parseObservation(row.observation),
    error: row.error || "",
    createdAt: Number(row.created_at || 0),
    analyzedAt: Number(row.analyzed_at || 0),
  }
}

function extractJson(text) {
  const value = String(text || "").trim()
  if (!value) return null
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : value
  const match = body.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0])
  } catch {
    return null
  }
}

function topValues(values, count) {
  const stats = new Map()
  for (const value of values) {
    const key = String(value || "").trim()
    if (!key) continue
    const entry = stats.get(key) || { value: key, count: 0, order: stats.size }
    entry.count += 1
    stats.set(key, entry)
  }
  return [...stats.values()]
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .slice(0, count)
    .map(item => item.value)
}

export class AICharacterStore {
  constructor(options = {}) {
    this.baseDir = options.baseDir || BASE_DIR
    this.dbFile = options.dbFile || path.join(this.baseDir, "characters.sqlite3")
    this.imageDir = options.imageDir || path.join(this.baseDir, "images")
    this.db = null
    this.ready = null
    this.hasFts = false
    this.getClient = null
    this.queue = []
    this.queued = new Set()
    this.running = 0
  }

  configure(options = {}) {
    if (typeof options.getClient === "function") this.getClient = options.getClient
    return this
  }

  async load() {
    if (!this.ready) {
      this.ready = this._open().catch(error => {
        this.ready = null
        throw error
      })
    }
    return this.ready
  }

  async _open() {
    await fsp.mkdir(this.imageDir, { recursive: true })
    const db = await new Promise((resolve, reject) => {
      const instance = new sqlite3.Database(this.dbFile, error => {
        if (error) reject(error)
        else resolve(instance)
      })
    })
    this.db = db
    await this._run("PRAGMA journal_mode=WAL")
    await this._run("PRAGMA busy_timeout=3000")
    await this._run(`
      CREATE TABLE IF NOT EXISTS characters (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        work TEXT NOT NULL DEFAULT '',
        aliases TEXT NOT NULL DEFAULT '[]',
        tags TEXT NOT NULL DEFAULT '[]',
        appearance TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        appearance_locked INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'webui',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
    await this._run(`
      CREATE TABLE IF NOT EXISTS character_images (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL,
        file TEXT NOT NULL,
        mime TEXT NOT NULL DEFAULT '',
        hash TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        observation TEXT NOT NULL DEFAULT '',
        error TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        analyzed_at INTEGER NOT NULL DEFAULT 0
      )
    `)
    await this._run("CREATE INDEX IF NOT EXISTS idx_character_images_character ON character_images(character_id)")
    await this._run("CREATE INDEX IF NOT EXISTS idx_character_images_hash ON character_images(hash)")
    try {
      await this._run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS character_fts USING fts5(
          name, work, aliases, tags, appearance,
          content='characters', content_rowid='rowid', tokenize='trigram'
        )
      `)
      await this._run(`
        CREATE TRIGGER IF NOT EXISTS character_fts_ai AFTER INSERT ON characters BEGIN
          INSERT INTO character_fts(rowid, name, work, aliases, tags, appearance)
          VALUES (new.rowid, new.name, new.work, new.aliases, new.tags, new.appearance);
        END
      `)
      await this._run(`
        CREATE TRIGGER IF NOT EXISTS character_fts_ad AFTER DELETE ON characters BEGIN
          INSERT INTO character_fts(character_fts, rowid, name, work, aliases, tags, appearance)
          VALUES ('delete', old.rowid, old.name, old.work, old.aliases, old.tags, old.appearance);
        END
      `)
      await this._run(`
        CREATE TRIGGER IF NOT EXISTS character_fts_au AFTER UPDATE ON characters BEGIN
          INSERT INTO character_fts(character_fts, rowid, name, work, aliases, tags, appearance)
          VALUES ('delete', old.rowid, old.name, old.work, old.aliases, old.tags, old.appearance);
          INSERT INTO character_fts(rowid, name, work, aliases, tags, appearance)
          VALUES (new.rowid, new.name, new.work, new.aliases, new.tags, new.appearance);
        END
      `)
      this.hasFts = true
    } catch {
      this.hasFts = false
    }
    await this._run("UPDATE character_images SET status='pending' WHERE status='analyzing'")
    return this
  }

  _run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (error) {
        if (error) reject(error)
        else resolve({ lastID: this.lastID, changes: this.changes })
      })
    })
  }

  _all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (error, rows) => {
        if (error) reject(error)
        else resolve(rows || [])
      })
    })
  }

  _get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (error, row) => {
        if (error) reject(error)
        else resolve(row || null)
      })
    })
  }

  _characterSelect(where = "", params = [], suffix = "") {
    return this._all(
      `SELECT c.*,
        (SELECT COUNT(*) FROM character_images i WHERE i.character_id=c.id) AS image_count,
        (SELECT COUNT(*) FROM character_images i WHERE i.character_id=c.id AND i.status='analyzed') AS analyzed_count,
        (SELECT COUNT(*) FROM character_images i WHERE i.character_id=c.id AND i.status IN ('pending','analyzing')) AS pending_count,
        (SELECT i.id FROM character_images i WHERE i.character_id=c.id
          ORDER BY CASE WHEN i.status='analyzed' THEN 0 ELSE 1 END, i.created_at ASC LIMIT 1) AS cover_image_id
      FROM characters c
      ${where}
      ${suffix}`,
      params,
    )
  }

  async _charactersByIds(ids) {
    const out = []
    for (let i = 0; i < ids.length; i += 400) {
      const chunk = ids.slice(i, i + 400)
      out.push(
        ...(await this._characterSelect(`WHERE c.id IN (${chunk.map(() => "?").join(",")})`, chunk)),
      )
    }
    return out
  }

  async list(query = "", limit = 0) {
    await this.load()
    const keyword = clean(query, 200)
    const safeLimit = Number(limit) > 0 ? Math.floor(Number(limit)) : 0
    const suffix = `ORDER BY c.updated_at DESC${safeLimit ? " LIMIT ?" : ""}`
    const params = safeLimit ? [safeLimit] : []
    if (!keyword) return (await this._characterSelect("", [], suffix)).map(mapCharacter)

    const like = `%${keyword}%`
    const matched = new Map()
    if (this.hasFts && keyword.length >= 3) {
      try {
        const terms = keyword.split(/\s+/).filter(Boolean)
        const expression = terms.map(term => `"${term.replace(/"/g, '""')}"`).join(" ")
        const rows = await this._all(
          "SELECT c.id FROM character_fts f JOIN characters c ON c.rowid=f.rowid WHERE character_fts MATCH ? ORDER BY rank",
          [expression],
        )
        for (const row of rows) matched.set(row.id, true)
      } catch {}
    }
    const rows = await this._all(
      `SELECT id FROM characters
       WHERE name LIKE ? OR work LIKE ? OR aliases LIKE ? OR tags LIKE ? OR appearance LIKE ? OR notes LIKE ?
       ORDER BY updated_at DESC${safeLimit ? " LIMIT ?" : ""}`,
      [like, like, like, like, like, like, ...(safeLimit ? [safeLimit] : [])],
    )
    for (const row of rows) if (!matched.has(row.id)) matched.set(row.id, true)
    if (!matched.size) return []
    const ids = [...matched.keys()]
    const characters = (await this._charactersByIds(ids)).map(mapCharacter)
    const order = new Map(ids.map((id, index) => [id, index]))
    characters.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    return safeLimit ? characters.slice(0, safeLimit) : characters
  }

  async get(id) {
    await this.load()
    const rows = await this._characterSelect("WHERE c.id=?", [String(id || "")])
    return mapCharacter(rows[0]) || null
  }

  async hasAny() {
    await this.load()
    const row = await this._get("SELECT 1 AS ok FROM characters LIMIT 1")
    return !!row
  }

  async findByName(name, work = "") {
    await this.load()
    const target = clean(name, 80)
    if (!target) return null
    const rows = await this._all(
      `SELECT * FROM characters
       WHERE LOWER(name)=LOWER(?) OR aliases LIKE ? OR (LOWER(name)=LOWER(?) AND LOWER(work)=LOWER(?))
       ORDER BY created_at ASC LIMIT 10`,
      [target, `%${target}%`, target, clean(work, 120)],
    )
    const items = rows.map(mapCharacter)
    if (!work) return items[0] || null
    return items.find(item => item.work && item.work.toLowerCase() === work.toLowerCase()) || items[0] || null
  }

  async create(input = {}) {
    await this.load()
    const name = clean(input.name, 80)
    if (!name) throw Object.assign(new Error("请填写角色名"), { status: 400 })
    const now = Date.now()
    const id = newId("ch")
    const aliases = uniqueList(parseList(input.aliases), 20)
    const tags = uniqueList(parseList(input.tags), 30)
    const appearance = clean(input.appearance, 2000)
    await this._run(
      `INSERT INTO characters
       (id, name, work, aliases, tags, appearance, notes, appearance_locked, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name,
        clean(input.work, 120),
        JSON.stringify(aliases),
        JSON.stringify(tags),
        appearance,
        clean(input.notes, 2000),
        appearance && input.appearanceLocked !== false ? 1 : 0,
        clean(input.source, 20) || "webui",
        now,
        now,
      ],
    )
    return this.get(id)
  }

  async update(id, input = {}) {
    await this.load()
    const current = await this.get(id)
    if (!current) throw Object.assign(new Error("角色不存在"), { status: 404 })
    const fields = []
    const params = []
    const put = (column, value) => {
      fields.push(`${column}=?`)
      params.push(value)
    }
    if (input.name !== undefined) {
      const name = clean(input.name, 80)
      if (!name) throw Object.assign(new Error("请填写角色名"), { status: 400 })
      put("name", name)
    }
    if (input.work !== undefined) put("work", clean(input.work, 120))
    if (input.aliases !== undefined) put("aliases", JSON.stringify(uniqueList(parseList(input.aliases), 20)))
    if (input.tags !== undefined) put("tags", JSON.stringify(uniqueList(parseList(input.tags), 30)))
    if (input.appearance !== undefined) put("appearance", clean(input.appearance, 2000))
    if (input.notes !== undefined) put("notes", clean(input.notes, 2000))
    if (input.appearanceLocked !== undefined) put("appearance_locked", input.appearanceLocked ? 1 : 0)
    else if (input.appearance !== undefined) put("appearance_locked", 1)
    put("updated_at", Date.now())
    params.push(String(id))
    await this._run(`UPDATE characters SET ${fields.join(", ")} WHERE id=?`, params)
    if (input.appearanceLocked === false) await this.recomputeAppearance(id)
    return this.get(id)
  }

  async remove(id) {
    await this.load()
    const images = await this._all("SELECT id, file FROM character_images WHERE character_id=?", [String(id)])
    await this._run("DELETE FROM character_images WHERE character_id=?", [String(id)])
    await this._run("DELETE FROM characters WHERE id=?", [String(id)])
    await fsp.rm(path.join(this.imageDir, String(id)), { recursive: true, force: true }).catch(() => {})
    return images.length
  }

  async listImages(characterId) {
    await this.load()
    const rows = await this._all(
      "SELECT * FROM character_images WHERE character_id=? ORDER BY created_at DESC",
      [String(characterId)],
    )
    return rows.map(mapImage)
  }

  async getImage(imageId) {
    await this.load()
    const row = await this._get("SELECT * FROM character_images WHERE id=?", [String(imageId)])
    if (!row) return null
    return { ...mapImage(row), file: row.file }
  }

  async getImageFile(characterId, imageId) {
    const image = await this.getImage(imageId)
    if (!image || image.characterId !== String(characterId)) return null
    const abs = path.join(this.imageDir, String(characterId), image.file)
    if (!fs.existsSync(abs)) return null
    return { image, abs }
  }

  async addImage(characterId, buffer, options = {}) {
    await this.load()
    const character = await this.get(characterId)
    if (!character) throw Object.assign(new Error("角色不存在"), { status: 404 })
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw Object.assign(new Error("图片内容为空"), { status: 400 })
    if (buffer.length > MAX_IMAGE_BYTES) throw Object.assign(new Error("图片不能超过 16MB"), { status: 413 })
    const ext = sniffExt(buffer)
    if (!ext) throw Object.assign(new Error("仅支持 PNG、JPG、GIF、WebP、BMP 图片"), { status: 400 })
    const mime = EXT_MIME[ext]
    const id = newId("ci")
    const dir = path.join(this.imageDir, String(characterId))
    await fsp.mkdir(dir, { recursive: true })
    const file = `${id}.${ext}`
    await fsp.writeFile(path.join(dir, file), buffer)
    let hash = ""
    try {
      hash = await computeImageHash(buffer, mime)
    } catch {}
    const now = Date.now()
    await this._run(
      `INSERT INTO character_images
       (id, character_id, file, mime, hash, status, observation, error, created_at, analyzed_at)
       VALUES (?, ?, ?, ?, ?, 'pending', '', '', ?, 0)`,
      [id, String(characterId), file, mime, hash, now],
    )
    return this.getImage(id)
  }

  async removeImage(imageId) {
    await this.load()
    const image = await this.getImage(imageId)
    if (!image) return false
    const removedWasAnalyzed = image.status === "analyzed"
    await this._run("DELETE FROM character_images WHERE id=?", [String(imageId)])
    await fsp.rm(path.join(this.imageDir, String(image.characterId), image.file), { force: true }).catch(() => {})
    await this.recomputeAppearance(image.characterId)
    if (removedWasAnalyzed) await this._clearAutoAppearanceIfNoEvidence(image.characterId)
    return true
  }

  async pendingImageIds(characterId) {
    await this.load()
    const rows = await this._all(
      "SELECT id FROM character_images WHERE character_id=? AND status IN ('pending','failed') ORDER BY created_at ASC",
      [String(characterId)],
    )
    return rows.map(row => row.id)
  }

  queueAnalysis(imageIds = []) {
    const ids = [...new Set((imageIds || []).map(String).filter(Boolean))]
    let added = 0
    for (const id of ids) {
      if (this.queued.has(id)) continue
      this.queued.add(id)
      this.queue.push(id)
      added += 1
    }
    if (this.db) this._pump()
    else this.load().then(() => this._pump()).catch(() => {})
    return added
  }

  _pump() {
    if (!this.db) return
    while (this.running < ANALYSIS_CONCURRENCY && this.queue.length) {
      const id = this.queue.shift()
      this.running += 1
      this.analyzeImage(id)
        .catch(() => {})
        .finally(() => {
          this.queued.delete(id)
          this.running -= 1
          this._pump()
        })
    }
  }

  async analyzeImage(imageId) {
    await this.load()
    const image = await this.getImage(imageId)
    if (!image) return { ok: false, error: "图片不存在" }
    if (image.status === "analyzing") return { ok: false, error: "正在分析中" }
    const previousStatus = image.status
    const character = await this.get(image.characterId)
    if (!character) return { ok: false, error: "角色不存在" }
    const client = this.getClient?.()
    if (!client) {
      await this._run("UPDATE character_images SET status='pending', error=? WHERE id=?", ["没有可用的识图模型", String(imageId)])
      await this.recomputeAppearance(image.characterId)
      if (previousStatus === "analyzed") await this._clearAutoAppearanceIfNoEvidence(image.characterId)
      return { ok: false, error: "没有可用的识图模型" }
    }
    await this._run("UPDATE character_images SET status='analyzing', error='' WHERE id=?", [String(imageId)])
    let buffer
    try {
      buffer = await fsp.readFile(path.join(this.imageDir, image.characterId, image.file))
    } catch {
      await this._run("UPDATE character_images SET status='failed', error=? WHERE id=?", ["图片文件丢失", String(imageId)])
      await this.recomputeAppearance(image.characterId)
      if (previousStatus === "analyzed") await this._clearAutoAppearanceIfNoEvidence(image.characterId)
      return { ok: false, error: "图片文件丢失" }
    }
    try {
      const observation = await this._describe(buffer, image.mime || "image/png", character)
      const status = observation.matches === false ? "mismatch" : "analyzed"
      await this._run(
        "UPDATE character_images SET status=?, observation=?, error='', analyzed_at=? WHERE id=?",
        [status, JSON.stringify(observation), Date.now(), String(imageId)],
      )
      await this.recomputeAppearance(image.characterId)
      if (previousStatus === "analyzed") await this._clearAutoAppearanceIfNoEvidence(image.characterId)
      return { ok: true, image: await this.getImage(imageId) }
    } catch (error) {
      const message = clean(error?.message || error || "识图失败", 200)
      await this._run("UPDATE character_images SET status='failed', error=? WHERE id=?", [message, String(imageId)])
      await this.recomputeAppearance(image.characterId)
      if (previousStatus === "analyzed") await this._clearAutoAppearanceIfNoEvidence(image.characterId)
      return { ok: false, error: message }
    }
  }

  async _describe(buffer, mime, character) {
    const prepared = await prepareVisionImage(buffer, mime, { maxEdge: 1280, force: true })
    const dataUrl = `data:${prepared.mime};base64,${prepared.buffer.toString("base64")}`
    const target = character.work ? `「${character.name}」（出自《${character.work}》）` : `「${character.name}」`
    const prompt = [
      `这是用于教 AI 认识${target}的参考图。`,
      "只描述图中这个角色的外观，不要猜身份，也不要评价画风以外的内容。",
      "只输出 JSON，不要代码块和解释：",
      '{"matches":true,"description":"一句话描述这张图里的角色状态","hair":"发色与发型","eyes":"瞳色与眼型","outfit":"服装","accessories":"配饰与道具","distinctive":"标志性特征","notes":"其他有助于辨认的细节"}',
      "如果图中没有这个角色，或明显不是同一角色，matches 填 false，其余字段留空。",
      "不确定的字段留空，不要编造。",
    ].join("\n")
    const result = await this.getClient().chat(
      [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      { maxTokens: 700, temperature: 0.2, timeout: VISION_TIMEOUT, requestKind: "character" },
    )
    const text = String(result?.content || "").trim()
    if (!text) throw new Error("识图模型没有返回内容")
    const parsed = extractJson(text)
    if (!parsed) return normalizeObservation({ matches: true, description: text })
    return normalizeObservation(parsed)
  }

  async recomputeAppearance(characterId) {
    await this.load()
    const row = await this._get("SELECT appearance_locked FROM characters WHERE id=?", [String(characterId)])
    if (!row || Number(row.appearance_locked) === 1) return null
    const rows = await this._all(
      "SELECT observation FROM character_images WHERE character_id=? AND status='analyzed' AND observation<>''",
      [String(characterId)],
    )
    const buckets = { hair: [], eyes: [], outfit: [], accessories: [], distinctive: [] }
    for (const item of rows) {
      const observation = parseObservation(item.observation)
      if (!observation || observation.matches === false) continue
      for (const key of Object.keys(buckets)) if (observation[key]) buckets[key].push(observation[key])
    }
    const parts = []
    for (const key of Object.keys(buckets)) {
      const values = topValues(buckets[key], FIELD_TOPK[key])
      if (!values.length) continue
      parts.push(`${FIELD_LABELS[key]}：${values.join(" / ")}`)
    }
    if (!parts.length) return null
    const appearance = parts.join("；").slice(0, 2000)
    await this._run(
      "UPDATE characters SET appearance=? WHERE id=? AND appearance_locked=0",
      [appearance, String(characterId)],
    )
    return appearance
  }

  async _clearAutoAppearanceIfNoEvidence(characterId) {
    const row = await this._get(
      "SELECT 1 AS ok FROM character_images WHERE character_id=? AND status='analyzed' LIMIT 1",
      [String(characterId)],
    )
    if (row) return false
    await this._run("UPDATE characters SET appearance='' WHERE id=? AND appearance_locked=0", [String(characterId)])
    return true
  }

  async matchByHashes(hashes = [], options = {}) {
    await this.load()
    const list = (hashes || []).filter(Boolean)
    if (!list.length) return []
    const minSimilarity = Number(options.minSimilarity) || 85
    const limit = Math.max(1, Math.floor(Number(options.limit) || 3))
    const rows = await this._all(
      `SELECT i.hash, i.id AS image_id, c.*
       FROM character_images i JOIN characters c ON c.id=i.character_id
       WHERE i.hash<>'' AND i.status<>'mismatch'`,
    )
    const best = new Map()
    for (const row of rows) {
      let similarity = 0
      for (const hash of list) similarity = Math.max(similarity, hashSimilarity(hash, row.hash))
      if (similarity < minSimilarity) continue
      const current = best.get(row.id)
      if (!current || similarity > current.similarity) {
        best.set(row.id, {
          ...mapCharacter(row),
          similarity: Math.round(similarity),
          matchedImageId: row.image_id,
        })
      }
    }
    return [...best.values()].sort((a, b) => b.similarity - a.similarity).slice(0, limit)
  }

  async upsertFromFact(input = {}) {
    const name = clean(input.name, 80)
    if (!name) return null
    const existing = await this.findByName(name, input.work)
    if (existing) {
      const aliases = uniqueList([...(existing.aliases || []), ...parseList(input.aliases)], 20)
      const tags = uniqueList([...(existing.tags || []), ...parseList(input.tags)], 30)
      const patch = {}
      if (aliases.length !== (existing.aliases || []).length) patch.aliases = aliases
      if (tags.length !== (existing.tags || []).length) patch.tags = tags
      if (!existing.appearance && input.appearance) {
        patch.appearance = clean(input.appearance, 2000)
        patch.appearanceLocked = false
      }
      if (!existing.work && input.work) patch.work = clean(input.work, 120)
      if (Object.keys(patch).length) return this.update(existing.id, patch)
      return existing
    }
    return this.create({
      name,
      work: input.work,
      aliases: input.aliases,
      tags: input.tags,
      appearance: input.appearance,
      source: "ai",
    })
  }

  async stats() {
    await this.load()
    const character = await this._get("SELECT COUNT(*) AS total FROM characters")
    const images = await this._get("SELECT COUNT(*) AS total FROM character_images")
    const analyzed = await this._get("SELECT COUNT(*) AS total FROM character_images WHERE status='analyzed'")
    const pending = await this._get("SELECT COUNT(*) AS total FROM character_images WHERE status IN ('pending','analyzing')")
    return {
      characters: Number(character?.total || 0),
      images: Number(images?.total || 0),
      analyzed: Number(analyzed?.total || 0),
      pending: Number(pending?.total || 0),
    }
  }
}

export const characterStore = new AICharacterStore()
export default characterStore
