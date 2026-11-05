/**
 * AI 知识库核心模块 — 文件存储、全文搜索、CRUD、知识条目管理
 *
 * 知识条目策略：
 * 1. 条目带 scope（master/public/group:xxx/user:xxx），检索按会话权限过滤
 * 2. 时间衰减 + 访问次数加权，常用且较新的知识优先
 * 3. 写入时合并近重复条目，保留 revision 与历史快照
 * 4. 容量满时把冷条目归档到 NDJSON，而不是直接删除
 * 5. 查询过宽或无权访问时诚实拒答
 */
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { WEBUI_DATA_DIR } from "../webui/dataDir.js"

const DAY_MS = 86400000
const MAX_HISTORY = 5

export default class KnowledgeBase {
  /** 默认存储路径 */
  static DEFAULT_PATH = path.join(WEBUI_DATA_DIR, "ai_knowledge.json")

  /** 常见泛化词：查询去掉它们后没有剩余内容时视为过宽 */
  static STOPWORDS = new Set([
    "的", "了", "是", "在", "我", "你", "他", "她", "它", "我们", "你们", "他们",
    "这", "那", "这个", "那个", "这些", "那些", "什么", "怎么", "如何", "为什么",
    "哪", "哪些", "多少", "吗", "呢", "吧", "啊", "呀", "哦", "嗯", "请", "帮",
    "帮忙", "查", "查一下", "一下", "告诉", "知道", "记得", "关于", "有关", "可以",
    "能否", "是否", "有没有", "还", "有", "和", "与", "或", "就", "都", "也",
    "很", "太", "再", "又", "把", "被", "让", "给", "对", "从", "到", "里面",
    "中", "上", "下", "叫", "说", "看", "看看", "找", "找一下", "搜索", "搜",
    "the", "a", "an", "is", "are", "was", "were", "what", "which", "who", "how",
    "why", "when", "where", "and", "or", "of", "to", "for", "in", "on", "about",
  ])

  /**
   * @param {Object} opts
   * @param {string} opts.storagePath 存储文件路径
   * @param {string} opts.archivePath 冷条目归档路径（默认同目录 *_archive.ndjson）
   * @param {number} opts.maxEntries 最大条目数（默认 1000）
   * @param {number} opts.maxEntrySize 单条最大字符数（默认 10000）
   * @param {number} opts.coldAfterDays 超过该天数未访问视为冷条目（默认 180）
   * @param {number} opts.recencyHalfLifeDays 时间衰减半衰期（默认 90 天）
   * @param {number} opts.mergeSimilarity 内容相似度合并阈值（默认 0.85）
   * @param {boolean} opts.autoSave 是否自动保存（默认 true）
   */
  constructor(opts = {}) {
    this.storagePath = opts.storagePath || KnowledgeBase.DEFAULT_PATH
    this.archivePath =
      opts.archivePath ||
      this.storagePath.replace(/\.json$/i, "") + "_archive.ndjson"
    this.maxEntries = Math.max(1, opts.maxEntries || 1000)
    this.maxEntrySize = opts.maxEntrySize || 10000
    this.coldAfterDays = opts.coldAfterDays ?? 180
    this.recencyHalfLifeDays = opts.recencyHalfLifeDays ?? 90
    this.mergeSimilarity = opts.mergeSimilarity ?? 0.85
    this.autoSave = opts.autoSave !== false

    /** @type {Array<Object>} */
    this.entries = []

    /** @type {Map<string, number>} 索引加速 */
    this._idIndex = new Map()

    this._loaded = false
    this._dirty = false
  }

  // ===================== 持久化 =====================

  /** 从文件加载（兼容 v1 无 scope 数据） */
  load() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, "utf-8")
        const data = JSON.parse(raw)
        this.entries = (Array.isArray(data.entries) ? data.entries : []).map(entry =>
          this._normalizeEntry(entry),
        )
        this._rebuildIndex()
        this._loaded = true
        this._dirty = false
        return this.entries.length
      }
    } catch (err) {
      Bot?.makeLog?.("warn", ["知识库加载失败", err.message], "KnowledgeBase")
      try {
        const backup = `${this.storagePath}.corrupt-${Date.now()}`
        fs.copyFileSync(this.storagePath, backup)
        Bot?.makeLog?.("warn", ["已备份损坏的知识库文件", backup], "KnowledgeBase")
      } catch {}
    }
    this.entries = []
    this._loaded = true
    return 0
  }

  /** 保存到文件（先写临时文件再替换，降低中断损坏概率） */
  save() {
    try {
      const dir = path.dirname(this.storagePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      const data = {
        version: 2,
        updatedAt: new Date().toISOString(),
        total: this.entries.length,
        entries: this.entries,
      }
      const json = JSON.stringify(data, null, 2)
      const tmp = `${this.storagePath}.tmp`
      fs.writeFileSync(tmp, json, "utf-8")
      try {
        fs.renameSync(tmp, this.storagePath)
      } catch {
        fs.writeFileSync(this.storagePath, json, "utf-8")
        try { fs.unlinkSync(tmp) } catch {}
      }
      this._dirty = false
      return true
    } catch (err) {
      Bot?.makeLog?.("error", ["知识库保存失败", err.message], "KnowledgeBase")
      return false
    }
  }

  /** 标记已修改（autoSave 模式下延迟保存） */
  _markDirty() {
    this._dirty = true
    if (this.autoSave) {
      if (this._saveTimer) clearTimeout(this._saveTimer)
      this._saveTimer = setTimeout(() => this.save(), 500)
    }
  }

  /** 重建 ID 索引 */
  _rebuildIndex() {
    this._idIndex.clear()
    for (let i = 0; i < this.entries.length; i++) {
      this._idIndex.set(this.entries[i].id, i)
    }
  }

  /** 补全旧字段并迁移 v1 数据 */
  _normalizeEntry(entry) {
    const now = new Date().toISOString()
    return {
      id: entry.id || this._genId(),
      title: String(entry.title || "").trim(),
      content: String(entry.content || "").trim(),
      tags: Array.isArray(entry.tags)
        ? entry.tags.filter(Boolean).map(t => String(t).trim()).slice(0, 10)
        : [],
      source: entry.source || "manual",
      sourceUrl: entry.sourceUrl || "",
      scope: this._normalizeScope(entry.scope),
      pinned: entry.pinned === true,
      accessCount: Number(entry.accessCount) || 0,
      lastAccessedAt: entry.lastAccessedAt || "",
      revision: Number(entry.revision) || 1,
      history: Array.isArray(entry.history) ? entry.history.slice(-MAX_HISTORY) : [],
      createdAt: entry.createdAt || now,
      updatedAt: entry.updatedAt || entry.createdAt || now,
    }
  }

  _normalizeScope(scope) {
    const s = String(scope || "").trim()
    if (s === "master" || s === "public") return s
    if (/^group:\d+$/.test(s) || /^user:\d+$/.test(s)) return s
    return "master"
  }

  _normalizeTitle(title) {
    return String(title || "").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "")
  }

  // ===================== 生成 ID =====================

  _genId() {
    return crypto.randomUUID().slice(0, 8)
  }

  // ===================== CRUD =====================

  /**
   * 添加知识条目（标题完全重复会被拒绝）
   * @param {Object} entry
   * @returns {{ success: boolean, entry?: Object, error?: string }}
   */
  add(entry) {
    if (!entry.title?.trim()) {
      return { success: false, error: "标题不能为空" }
    }
    if (!entry.content?.trim()) {
      return { success: false, error: "内容不能为空" }
    }
    if (entry.content.length > this.maxEntrySize) {
      return { success: false, error: `内容超过最大长度限制 (${this.maxEntrySize} 字)` }
    }

    const scope = this._normalizeScope(entry.scope)
    const titleKey = this._normalizeTitle(entry.title)
    const dup = this.entries.find(
      e => e.scope === scope && this._normalizeTitle(e.title) === titleKey,
    )
    if (dup) {
      return {
        success: false,
        duplicate: true,
        entry: dup,
        error: `已存在相同标题的知识: "${entry.title}"，请使用更新操作`,
      }
    }

    if (this.entries.length >= this.maxEntries && !this._makeRoom()) {
      return { success: false, error: "知识库已满，且没有可归档的条目（全部为固定知识）" }
    }

    const now = new Date().toISOString()
    const newEntry = {
      id: this._genId(),
      title: entry.title.trim(),
      content: entry.content.trim(),
      tags: (entry.tags || [])
        .map(tag => String(tag ?? "").trim())
        .filter(Boolean)
        .slice(0, 10),
      source: entry.source || "manual",
      sourceUrl: entry.sourceUrl || "",
      scope,
      pinned: entry.pinned === true,
      accessCount: 0,
      lastAccessedAt: "",
      revision: 1,
      history: [],
      createdAt: now,
      updatedAt: now,
    }

    this.entries.push(newEntry)
    this._idIndex.set(newEntry.id, this.entries.length - 1)
    this._markDirty()

    return { success: true, entry: newEntry, action: "created" }
  }

  /**
   * 添加或合并：标题相同或内容高度相似时合并到已有条目
   * @param {Object} entry
   * @returns {{ success: boolean, action?: "created"|"merged", entry?: Object, error?: string }}
   */
  addOrMerge(entry) {
    if (!entry.title?.trim() || !entry.content?.trim()) {
      return this.add(entry)
    }

    const scope = this._normalizeScope(entry.scope)
    const titleKey = this._normalizeTitle(entry.title)
    const content = entry.content.trim()
    const dup = this.entries.find(
      e =>
        e.scope === scope &&
        (this._normalizeTitle(e.title) === titleKey ||
          this._similarity(e.content, content) >= this.mergeSimilarity),
    )

    if (dup) return this._mergeInto(dup, entry, scope)
    return this.add({ ...entry, scope })
  }

  _mergeInto(existing, entry, scope) {
    const content = entry.content.trim()
    let mergedContent = existing.content
    if (!mergedContent.includes(content)) {
      if (content.includes(mergedContent)) mergedContent = content
      else mergedContent = `${mergedContent}\n${content}`
    }
    if (mergedContent.length > this.maxEntrySize) {
      return { success: false, error: `合并后内容超过最大长度限制 (${this.maxEntrySize} 字)` }
    }

    this._pushHistory(existing)
    existing.content = mergedContent
    existing.tags = [...new Set([...(existing.tags || []), ...(entry.tags || [])])]
      .filter(Boolean)
      .map(t => String(t).trim())
      .slice(0, 10)
    if (entry.sourceUrl && !existing.sourceUrl) existing.sourceUrl = entry.sourceUrl
    existing.scope = scope
    existing.revision = (existing.revision || 1) + 1
    existing.updatedAt = new Date().toISOString()
    this._markDirty()

    return { success: true, action: "merged", entry: existing }
  }

  _pushHistory(entry) {
    entry.history = [
      ...(entry.history || []),
      {
        title: entry.title,
        content: entry.content,
        tags: [...(entry.tags || [])],
        updatedAt: entry.updatedAt,
      },
    ].slice(-MAX_HISTORY)
  }

  /**
   * 更新知识条目
   * @param {string} id 条目 ID
   * @param {Object} updates 更新的字段
   * @returns {{ success: boolean, entry?: Object, error?: string }}
   */
  update(id, updates) {
    const idx = this._idIndex.get(id)
    if (idx === undefined) {
      return { success: false, error: `未找到知识条目: ${id}` }
    }

    const entry = this.entries[idx]
    const changed = ["title", "content", "tags"].some(key => updates[key] !== undefined)

    if (updates.title !== undefined) {
      if (!updates.title?.trim()) return { success: false, error: "标题不能为空" }
      const dup = this.entries.find(
        e =>
          e.id !== id &&
          e.scope === this._normalizeScope(updates.scope ?? entry.scope) &&
          this._normalizeTitle(e.title) === this._normalizeTitle(updates.title),
      )
      if (dup) return { success: false, error: `已存在相同标题: "${updates.title}"` }
    }

    if (updates.content !== undefined) {
      if (!updates.content?.trim()) return { success: false, error: "内容不能为空" }
      if (updates.content.length > this.maxEntrySize) {
        return { success: false, error: `内容超过最大长度限制 (${this.maxEntrySize} 字)` }
      }
    }

    if (changed) this._pushHistory(entry)

    if (updates.title !== undefined) entry.title = updates.title.trim()
    if (updates.content !== undefined) entry.content = updates.content.trim()
    if (updates.tags !== undefined) {
      entry.tags = (updates.tags || []).filter(t => t).map(t => t.trim()).slice(0, 10)
    }
    if (updates.source !== undefined) entry.source = updates.source
    if (updates.sourceUrl !== undefined) entry.sourceUrl = updates.sourceUrl
    if (updates.scope !== undefined) entry.scope = this._normalizeScope(updates.scope)
    if (updates.pinned !== undefined) entry.pinned = updates.pinned === true

    if (changed) {
      entry.revision = (entry.revision || 1) + 1
      entry.updatedAt = new Date().toISOString()
    }
    this._markDirty()

    return { success: true, entry }
  }

  /** 固定/取消固定条目（固定条目不会被归档淘汰） */
  pin(id, pinned = true) {
    const entry = this.get(id)
    if (!entry) return { success: false, error: `未找到知识条目: ${id}` }
    entry.pinned = pinned === true
    this._markDirty()
    return { success: true, entry }
  }

  /**
   * 删除知识条目
   * @param {string} id 条目 ID
   * @returns {{ success: boolean, error?: string }}
   */
  delete(id) {
    const idx = this._idIndex.get(id)
    if (idx === undefined) {
      return { success: false, error: `未找到知识条目: ${id}` }
    }
    const deleted = this.entries.splice(idx, 1)[0]
    this._rebuildIndex()
    this._markDirty()
    return { success: true, title: deleted.title }
  }

  /**
   * 获取单条知识
   * @param {string} id
   * @returns {Object|null}
   */
  get(id) {
    const idx = this._idIndex.get(id)
    return idx !== undefined ? this.entries[idx] : null
  }

  // ===================== 搜索 =====================

  /**
   * 搜索知识库
   * @param {string} query 搜索关键词
   * @param {Object} opts
   * @param {string[]} opts.scopes 允许访问的范围（不传则不过滤，仅限内部/主人使用）
   * @param {string[]} opts.tags 按标签过滤
   * @param {string} opts.source 按来源过滤
   * @param {number} opts.limit 返回条数上限（默认 10）
   * @param {number} opts.offset 偏移量
   * @param {boolean} opts.trackAccess 是否记录访问（默认 true）
   * @returns {{ total: number, results: Array<Object>, reason?: string }}
   */
  search(query, opts = {}) {
    const limit = Math.max(1, opts.limit || 10)
    const offset = Math.max(0, opts.offset || 0)
    const q = String(query || "").toLowerCase().trim()

    let candidates = this.entries

    if (Array.isArray(opts.scopes)) {
      const allowed = new Set(opts.scopes)
      candidates = candidates.filter(e => allowed.has(e.scope))
    }

    if (opts.tags?.length) {
      candidates = candidates.filter(e => opts.tags.some(t => e.tags.includes(t)))
    }

    if (opts.source) {
      candidates = candidates.filter(e => e.source === opts.source)
    }

    if (!q) {
      const sorted = [...candidates].sort(
        (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt),
      )
      const total = sorted.length
      const results = sorted.slice(offset, offset + limit).map(e => this._formatResult(e, 1, 0))
      return { total, results }
    }

    if (!this._informativeQuery(q)) {
      return { total: 0, results: [], reason: "查询过于宽泛，未进行检索（请使用更具体的关键词）" }
    }

    const qCore = this._coreQuery(q)
    const useCore = qCore.length >= 2 && qCore !== q
    const now = Date.now()
    const scored = []
    for (const entry of candidates) {
      let lexical = this._lexicalScore(entry, q)
      if (useCore) lexical = Math.max(lexical, this._lexicalScore(entry, qCore))
      if (lexical <= 0) continue
      const recency = this._recency(entry, now)
      const access = 1 + 0.3 * Math.log1p(entry.accessCount || 0)
      scored.push({ entry, lexical, rank: lexical * (0.55 + 0.45 * recency) * access })
    }

    scored.sort(
      (a, b) =>
        b.rank - a.rank ||
        b.lexical - a.lexical ||
        b.entry.updatedAt.localeCompare(a.entry.updatedAt),
    )

    const total = scored.length
    const page = scored.slice(offset, offset + limit)

    if (opts.trackAccess !== false && page.length) {
      const nowIso = new Date().toISOString()
      for (const item of page) {
        item.entry.accessCount = (item.entry.accessCount || 0) + 1
        item.entry.lastAccessedAt = nowIso
      }
      this._markDirty()
    }

    return {
      total,
      results: page.map(item => this._formatResult(item.entry, item.rank, item.lexical)),
    }
  }

  /** 字段加权词面评分 */
  _lexicalScore(entry, q) {
    let score = 0
    const titleLower = entry.title.toLowerCase()
    const contentLower = entry.content.toLowerCase()
    const tagsLower = entry.tags.map(t => t.toLowerCase())
    const words = q.split(/\s+/).filter(Boolean)

    if (titleLower === q) score += 10
    else if (titleLower.includes(q)) score += 5
    else {
      for (const w of words) if (titleLower.includes(w)) score += 3
    }

    if (contentLower.includes(q)) score += 2
    else {
      for (const w of words) if (contentLower.includes(w)) score += 1
    }

    for (const tag of tagsLower) {
      if (tag === q) score += 4
      else if (tag.includes(q)) score += 2
    }

    return score
  }

  /** 时间衰减因子，固定知识不衰减 */
  _recency(entry, now = Date.now()) {
    if (entry.pinned) return 1
    const t = Date.parse(entry.updatedAt || entry.createdAt) || now
    return Math.pow(0.5, Math.max(0, now - t) / DAY_MS / this.recencyHalfLifeDays)
  }

  /** 查询去掉泛化词后是否还有有效内容 */
  _informativeQuery(q) {
    const compact = q.replace(/[\s\p{P}\p{S}]/gu, "")
    if (!compact) return false
    let rest = compact
    for (const w of KnowledgeBase.STOPWORDS) {
      rest = rest.split(w).join("")
    }
    return rest.length > 0
  }

  /** 剥离查询首尾的口语化泛化词，得到核心关键词 */
  _coreQuery(q) {
    let core = String(q || "").replace(/[\s\p{P}\p{S}]/gu, "")
    const words = [...KnowledgeBase.STOPWORDS].sort((a, b) => b.length - a.length)
    let changed = true
    while (changed && core) {
      changed = false
      for (const w of words) {
        if (core.length <= w.length) continue
        if (core.startsWith(w)) {
          core = core.slice(w.length)
          changed = true
          break
        }
        if (core.endsWith(w)) {
          core = core.slice(0, -w.length)
          changed = true
          break
        }
      }
    }
    return core
  }

  /** 字符二元组余弦相似度（用于写入时合并判断） */
  _similarity(a, b) {
    const left = this._bigrams(a)
    const right = this._bigrams(b)
    if (!left.size || !right.size) return 0
    let inter = 0
    for (const g of left) if (right.has(g)) inter++
    return inter / Math.sqrt(left.size * right.size)
  }

  _bigrams(text) {
    const s = String(text || "").toLowerCase().replace(/\s+/g, "")
    const set = new Set()
    for (let i = 0; i < s.length - 1; i++) {
      set.add(s.slice(i, i + 2))
    }
    return set
  }

  /**
   * 按标签获取知识
   * @param {string} tag
   * @param {number} limit
   * @param {Object} opts
   * @returns {Array<Object>}
   */
  getByTag(tag, limit = 10, opts = {}) {
    let list = this.entries.filter(e => e.tags.includes(tag))
    if (Array.isArray(opts.scopes)) {
      const allowed = new Set(opts.scopes)
      list = list.filter(e => allowed.has(e.scope))
    }
    return list
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map(e => this._formatResult(e, 0, 0))
  }

  /**
   * 获取所有标签
   * @param {Object} opts
   * @returns {Array<{tag: string, count: number}>}
   */
  getTags(opts = {}) {
    let entries = this.entries
    if (Array.isArray(opts.scopes)) {
      const allowed = new Set(opts.scopes)
      entries = entries.filter(e => allowed.has(e.scope))
    }
    const counts = new Map()
    for (const entry of entries) {
      for (const tag of entry.tags) {
        counts.set(tag, (counts.get(tag) || 0) + 1)
      }
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
  }

  // ===================== 批量操作 =====================

  /**
   * 批量导入
   * @param {Array<Object>} entries 条目数组
   * @param {string} source 来源标记
   * @returns {{ added: number, skipped: number, errors: string[] }}
   */
  importBatch(entries, source = "import") {
    let added = 0, skipped = 0
    const errors = []

    for (const entry of entries) {
      const result = this.add({ ...entry, source: entry.source || source })
      if (result.success) added++
      else { skipped++; errors.push(`${entry.title || "?"}: ${result.error}`) }
    }

    return { added, skipped, errors }
  }

  /**
   * 导出全部条目
   * @returns {Array<Object>}
   */
  exportAll() {
    return this.entries.map(e => ({ ...e }))
  }

  /**
   * 清空知识库（不影响归档文件）
   * @returns {number} 删除的条目数
   */
  clear() {
    const count = this.entries.length
    this.entries = []
    this._idIndex.clear()
    this._markDirty()
    return count
  }

  // ===================== 归档淘汰 =====================

  /** 容量满时为一条新知识腾位置；返回 false 表示无法腾出 */
  _makeRoom() {
    if (this.entries.length < this.maxEntries) return true

    const candidates = this.entries.filter(e => !e.pinned)
    if (candidates.length === 0) return false

    const now = Date.now()
    const ranked = candidates.map(e => {
      const last = Date.parse(e.lastAccessedAt || e.updatedAt || e.createdAt) || 0
      const idleDays = (now - last) / DAY_MS
      return {
        entry: e,
        cold: idleDays >= this.coldAfterDays ? 1 : 0,
        retention: this._recency(e, now) * (1 + 0.3 * Math.log1p(e.accessCount || 0)),
      }
    })
    ranked.sort((a, b) => b.cold - a.cold || a.retention - b.retention)

    const victim = ranked[0].entry
    if (!this._archiveEntry(victim)) return false

    const idx = this.entries.indexOf(victim)
    this.entries.splice(idx, 1)
    this._rebuildIndex()
    this._markDirty()
    Bot?.makeLog?.("info", [
      `知识库容量已满，归档冷条目: ${victim.title}`,
      `(最后访问: ${victim.lastAccessedAt || "从未"})`,
    ], "KnowledgeBase")
    return true
  }

  /** 追加写入归档文件，失败时不删除原条目 */
  _archiveEntry(entry) {
    try {
      fs.mkdirSync(path.dirname(this.archivePath), { recursive: true })
      fs.appendFileSync(
        this.archivePath,
        JSON.stringify({ ...entry, archivedAt: new Date().toISOString() }) + "\n",
        "utf-8",
      )
      return true
    } catch (err) {
      Bot?.makeLog?.("error", ["知识库归档失败", err.message], "KnowledgeBase")
      return false
    }
  }

  // ===================== 格式化 =====================

  _formatResult(entry, score, lexical) {
    return {
      id: entry.id,
      title: entry.title,
      content: entry.content.slice(0, 500),
      contentFull: entry.content.length > 500 ? entry.content : undefined,
      tags: entry.tags,
      source: entry.source,
      sourceUrl: entry.sourceUrl,
      scope: entry.scope,
      pinned: entry.pinned,
      accessCount: entry.accessCount,
      lastAccessedAt: entry.lastAccessedAt,
      revision: entry.revision,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      score: Number(Number(score || 0).toFixed(3)),
      lexical,
    }
  }

  // ===================== 统计 =====================

  getStats() {
    const sources = {}
    const scopes = {}
    let pinned = 0
    for (const e of this.entries) {
      sources[e.source] = (sources[e.source] || 0) + 1
      scopes[e.scope] = (scopes[e.scope] || 0) + 1
      if (e.pinned) pinned++
    }
    const tags = this.getTags()
    return {
      total: this.entries.length,
      maxEntries: this.maxEntries,
      pinned,
      scopes,
      storagePath: this.storagePath,
      archivePath: this.archivePath,
      sources,
      topTags: tags.slice(0, 10),
      lastUpdated: this.entries.length > 0
        ? this.entries.reduce((latest, e) => e.updatedAt > latest ? e.updatedAt : latest, "")
        : null,
    }
  }
}
