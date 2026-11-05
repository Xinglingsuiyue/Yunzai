/**
 * AI 回忆存储 — 以“经历”为核心的长期记忆。
 *
 * 记忆分两种：
 *   episode 一件事的完整经历（发生了什么、感受、想法、行动、验收、关系变化…）
 *   fact    简短、可复用的事实与偏好（兼容旧版扁平记忆）
 *
 * 关键能力：
 *   - 结构化维度：事件、感受、意愿、计划、思考、学习、行动、核对、沉淀、纠错、
 *     主人意见、交付、验收、心情、精力、关系与信任、兴趣、品味、看法、关联
 *   - 关联图谱：显式 links + 共享标签/人物形成的隐式关联，支持“想起一件勾起另一件”
 *   - 关系状态：trust / affinity 由经历逐步累积，独立于单条记忆保存
 *   - 深度：重要度、关联数量、维度丰富度共同决定，关联越多记忆越“深”
 *   - 连续性：最近经历、未完成计划、教训与纠错可注入提示词，接上昨天的自己
 */
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { WEBUI_DATA_DIR } from "../webui/dataDir.js"
import { isGroupId, normalizeGroupId as normalizeGroupKey } from "../config/config.js"

const STORE_FILE = path.join(WEBUI_DATA_DIR, "ai_memories.json")
const HARD_LIMIT = 2000
const STORE_VERSION = 2
const MAX_LINKS = 20
const MAX_LIST_ITEMS = 12
const LIST_FIELDS = ["feelings", "intentions", "actions", "interests", "taste", "opinions", "people"]
// 六种基础情绪：写入时只打标签，不枚举组合名。组合名交给回话措辞，
// 存进库只会让检索和展示都变重。
const EMOTIONS = ["joy", "sadness", "anger", "fear", "surprise", "disgust"]
const EMOTION_ALIASES = {
  joy: "joy", "乐": "joy", "快乐": "joy", "开心": "joy", "高兴": "joy", "喜": "joy",
  sadness: "sadness", "悲": "sadness", "悲伤": "sadness", "难过": "sadness", "哀": "sadness",
  anger: "anger", "怒": "anger", "愤怒": "anger", "生气": "anger", "气": "anger",
  fear: "fear", "惧": "fear", "恐惧": "fear", "害怕": "fear", "怕": "fear",
  surprise: "surprise", "惊": "surprise", "惊讶": "surprise", "吃惊": "surprise", "意外": "surprise",
  disgust: "disgust", "厌": "disgust", "厌恶": "disgust", "反感": "disgust", "恶心": "disgust",
}
const EMOTION_LABELS = { joy: "乐", sadness: "悲", anger: "怒", fear: "惧", surprise: "惊", disgust: "厌" }
// 强度低于这个值的不再自动注入，只保留可搜索：久未触碰的低重要度记忆不该每轮占上下文
const MIN_INJECT_STRENGTH = 3
const TEXT_FIELDS = [
  "title",
  "event",
  "desire",
  "reasoning",
  "learning",
  "verification",
  "lessons",
  "corrections",
  "masterOpinion",
  "delivery",
  "acceptance",
  "mood",
  "energy",
]
const DEFAULT_RELATION = {
  trust: 50,
  affinity: 50,
  interactions: 0,
  lastMood: "",
  lastEnergy: "",
  note: "",
  updatedAt: "",
}

function newId() {
  return `m_${crypto.randomBytes(5).toString("hex")}`
}

function text(value, max = 4000) {
  return String(value ?? "").slice(0, max)
}

function clampNumber(value, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Math.min(max, Math.max(min, number))
}

/** 情绪标签：主情绪 + 可选次情绪 + 强度 1-3；没有证据时整体为空 */
/** 承诺：只有 text 有值才算一条；status 只允许 open / done / dropped */
function normalizePromise(input, fallbackAt = "") {
  const source = input && typeof input === "object" ? input : {}
  const promiseText = text(source.text || source.promise || source.content, 300).trim()
  if (!promiseText) return { text: "", due: "", status: "", madeAt: "", doneAt: "", evidence: "" }
  const status = ["done", "dropped"].includes(source.status) ? source.status : "open"
  return {
    text: promiseText,
    due: text(source.due, 100).trim(),
    status,
    madeAt: normalizeDate(source.madeAt, fallbackAt || new Date().toISOString()),
    doneAt: source.doneAt ? normalizeDate(source.doneAt) : "",
    evidence: text(source.evidence, 300).trim(),
  }
}

function normalizeEmotion(input) {
  const source = input && typeof input === "object" ? input : {}
  const primary = EMOTION_ALIASES[String(source.primary || "").trim().toLowerCase()] ||
    EMOTION_ALIASES[String(source.primary || "").trim()] || ""
  const secondary = [...new Set(
    (Array.isArray(source.secondary) ? source.secondary : String(source.secondary || "").split(/[,，、+\s]+/))
      .map(item => EMOTION_ALIASES[String(item || "").trim().toLowerCase()] || EMOTION_ALIASES[String(item || "").trim()] || "")
      .filter(Boolean),
  )].filter(item => item !== primary).slice(0, 2)
  const intensity = clampNumber(source.intensity, 1, 3)
  if (!primary && !secondary.length) return { primary: "", secondary: [], intensity: 0 }
  return { primary: primary || secondary[0], secondary: primary ? secondary : secondary.slice(1), intensity: intensity === null ? 2 : Math.round(intensity) }
}

/** 给检索与提示词用的短标签，如「怒/厌·强」 */
function emotionLabel(emotion) {
  const value = normalizeEmotion(emotion)
  if (!value.primary) return ""
  const words = [value.primary, ...value.secondary].map(item => EMOTION_LABELS[item] || item).join("/")
  const level = value.intensity >= 3 ? "强" : value.intensity === 1 ? "弱" : ""
  return level ? `${words}·${level}` : words
}

// 中文按二元组、英文按整词切；虚词不参与，避免「的了吗」把两条无关记忆连起来
const STOP_WORDS = new Set([
  "的", "了", "是", "我", "你", "他", "她", "它", "在", "有", "和", "就", "也", "都", "这", "那", "不",
  "一个", "上", "下", "来", "去", "说", "要", "会", "能", "对", "得", "着", "过", "还", "很", "太", "没",
  "什么", "怎么", "为什么", "可以", "现在", "今天", "昨天", "明天", "刚才", "这个", "那个", "自己",
  "the", "and", "for", "you", "are", "was", "were", "that", "this", "with", "have", "not", "but",
])
// Node 自带 ICU 中文分词，比二元组准：能分出「炒饭」而不是「么炒」「炒饭」各算一个
let wordSegmenter = null
try {
  wordSegmenter = new Intl.Segmenter("zh-CN", { granularity: "word" })
} catch {}

function wordsOf(value) {
  const raw = String(value || "")
  const tokens = new Set()
  if (wordSegmenter) {
    for (const item of wordSegmenter.segment(raw)) {
      if (!item.isWordLike) continue
      const word = item.segment.trim().toLowerCase()
      if (!word || STOP_WORDS.has(word)) continue
      // 单字虚词太多，只保留长度 >=2 的中文词与 >=3 的英文词
      if (/^[a-z0-9]+$/.test(word) ? word.length >= 3 : word.length >= 2) tokens.add(word)
    }
  }
  for (const number of raw.match(/\d{2,}/g) || []) tokens.add(number)
  return tokens
}

function termsOf(value) {
  const tokens = wordsOf(value)
  if (tokens.size) return tokens
  // 分词不可用时退回二元组，保证仍能匹配
  for (const segment of String(value || "").replace(/[^\u4e00-\u9fa5]+/g, " ").split(/\s+/))
    for (let i = 0; i < segment.length - 1; i++) tokens.add(segment.slice(i, i + 2))
  return tokens
}

/** 字面相关度 0-1：共同词 / 查询词数；没有一个共同实词就判 0 */
function relevanceOf(queryTerms, targetTerms) {
  if (!queryTerms?.size || !targetTerms?.size) return 0
  let shared = 0
  for (const term of queryTerms) if (targetTerms.has(term)) shared++
  if (!shared) return 0
  return Math.min(1, shared / Math.max(2, queryTerms.size))
}

function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags || "").split(/[,，]/)
  return [...new Set(list.map(tag => text(tag, 60).trim()).filter(Boolean))].slice(0, 10)
}

function normalizeList(value, max = MAX_LIST_ITEMS) {
  const list = Array.isArray(value) ? value : String(value || "").split(/[,，、;\n]/)
  return [...new Set(list.map(item => text(item, 300).trim()).filter(Boolean))].slice(0, max)
}

function normalizeScope(scope) {
  const value = text(scope, 60).trim()
  if (!value || value === "global") return "global"
  if (/^group:.+$/.test(value) && isGroupId(value.slice(6)))
    return `group:${normalizeGroupKey(value.slice(6))}`
  if (/^user:\d{3,20}$/.test(value)) return value
  return null
}

/** 关系状态使用会话上下文，而不是记忆可见范围。 */
function normalizeRelationScope(scope) {
  const value = text(scope, 60).trim()
  if (!value || value === "global") return "global"
  if (/^group:.+$/.test(value) && isGroupId(value.slice(6)))
    return `group:${normalizeGroupKey(value.slice(6))}`
  if (/^(user|private):\d{3,20}$/.test(value)) return value
  return null
}

function defaultRelationScope(scope) {
  const value = normalizeScope(scope)
  if (!value) return "global"
  if (value.startsWith("group:")) return value
  if (value.startsWith("user:")) return `private:${value.slice(5)}`
  return "global"
}

function normalizeGroupId(value) {
  const id = text(value, 20).trim()
  return /^\d{3,20}$/.test(id) ? id : ""
}

function normalizeOriginChat(value) {
  const raw = text(value, 40).trim()
  return /^(group|private):\d{3,20}$/.test(raw) ? raw : ""
}

function originPrivacy(originChat) {
  const value = String(originChat || "")
  if (value.startsWith("private:")) return "private"
  if (value.startsWith("group:")) return "group"
  return "shared"
}

function normalizeContent(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "")
}

function normalizeKind(value, fallback = "fact") {
  return value === "episode" ? "episode" : value === "fact" ? "fact" : fallback
}

function normalizeDate(value, fallback = new Date().toISOString()) {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return fallback
  return new Date(time).toISOString()
}

function sameDay(a, b) {
  return String(a || "").slice(0, 10) === String(b || "").slice(0, 10)
}

function normalizeRelationship(input = {}) {
  const source = input && typeof input === "object" ? input : {}
  return {
    trust: clampNumber(source.trust, 0, 100),
    affinity: clampNumber(source.affinity, 0, 100),
    note: text(source.note, 500).trim(),
  }
}

function normalizeRelation(input = {}) {
  const source = input && typeof input === "object" ? input : {}
  const base = { ...DEFAULT_RELATION }
  const trust = clampNumber(source.trust, 0, 100)
  const affinity = clampNumber(source.affinity, 0, 100)
  if (trust !== null) base.trust = Math.round(trust)
  if (affinity !== null) base.affinity = Math.round(affinity)
  base.interactions = Math.max(0, Math.floor(Number(source.interactions) || 0))
  base.lastMood = text(source.lastMood, 200).trim()
  base.lastEnergy = text(source.lastEnergy, 200).trim()
  base.note = text(source.note, 500).trim()
  base.updatedAt = text(source.updatedAt, 40) || ""
  return base
}

function emptyEntry(id) {
  return {
    id,
    kind: "fact",
    scope: "global",
    title: "",
    content: "",
    event: "",
    feelings: [],
    desire: "",
    intentions: [],
    reasoning: "",
    learning: "",
    actions: [],
    verification: "",
    lessons: "",
    corrections: "",
    masterOpinion: "",
    delivery: "",
    acceptance: "",
    mood: "",
    energy: "",
    // 情绪标签与自由文本 feelings/mood 并存：标签负责检索与排序，文本负责细节
    emotion: { primary: "", secondary: [], intensity: 0 },
    relationship: { trust: null, affinity: null, note: "" },
    interests: [],
    taste: [],
    opinions: [],
    people: [],
    links: [],
    tags: [],
    importance: 2,
    depth: 0,
    occurredAt: "",
    source: "manual",
    originChat: "",
    originGroupId: "",
    // 外部锚点：这三样只能从消息事件里取，不允许模型自己填
    originUserId: "",
    originMessageId: "",
    originExcerpt: "",
    // 双时间轴：validTo 有值表示这条事实已被推翻，只保留历史不再注入
    validFrom: "",
    validTo: "",
    supersededBy: "",
    // 情感驱动演化：同一条记忆随关系变化被重新解读，原内容不动，只叠加新的理解
    valence: 0,
    reinterpretations: [],
    pinned: false,
    useCount: 0,
    lastUsedAt: "",
    // 已遗忘：长期没被想起、又不重要的条目留档但不参与注入与检索，可恢复
    archivedAt: "",
    archiveReason: "",
    // 再巩固：编码时的情绪与最近一次想起时的情绪分开记，别互相覆盖
    encodedEmotion: null,
    lastRecallEmotion: "",
    lastRecalledAt: "",
    // 承诺：答应别人的事单独记，它和「打算做」不同——没做完会一直挂在待办里
    promise: { text: "", due: "", status: "", madeAt: "", doneAt: "", evidence: "" },
    revision: 1,
    createdAt: "",
    updatedAt: "",
  }
}

function normalizeEntry(input = {}, fallbackScope = "global") {
  const entry = emptyEntry(text(input.id, 40) || newId())
  entry.kind = normalizeKind(input.kind, "fact")
  entry.scope = normalizeScope(input.scope) || normalizeScope(fallbackScope) || "global"
  entry.content = text(input.content, 4000).trim()
  entry.title = text(input.title, 200).trim()
  entry.event = text(input.event, 6000).trim()
  entry.desire = text(input.desire, 2000).trim()
  entry.reasoning = text(input.reasoning, 4000).trim()
  entry.learning = text(input.learning, 2000).trim()
  entry.verification = text(input.verification, 2000).trim()
  entry.lessons = text(input.lessons, 2000).trim()
  entry.corrections = text(input.corrections, 2000).trim()
  entry.masterOpinion = text(input.masterOpinion, 2000).trim()
  entry.delivery = text(input.delivery, 2000).trim()
  entry.acceptance = text(input.acceptance, 2000).trim()
  entry.mood = text(input.mood, 200).trim()
  entry.energy = text(input.energy, 200).trim()
  entry.emotion = normalizeEmotion(input.emotion)
  for (const field of LIST_FIELDS) entry[field] = normalizeList(input[field])
  entry.relationship = normalizeRelationship(input.relationship)
  entry.links = [...new Set((Array.isArray(input.links) ? input.links : []).map(id => text(id, 40).trim()).filter(Boolean))].slice(0, MAX_LINKS)
  entry.tags = normalizeTags(input.tags)
  const importance = clampNumber(input.importance, 1, 5)
  entry.importance = importance === null ? (entry.kind === "episode" ? 3 : 2) : Math.round(importance)
  entry.depth = clampNumber(input.depth, 0, 100) ?? 0
  entry.source = text(input.source || "manual", 40).trim() || "manual"
  entry.originChat = normalizeOriginChat(input.originChat)
  entry.originGroupId =
    normalizeGroupId(input.originGroupId) ||
    (entry.originChat.startsWith("group:") ? entry.originChat.slice(6) : "")
  entry.originUserId = String(input.originUserId || "").slice(0, 20)
  entry.originMessageId = String(input.originMessageId || "").slice(0, 40)
  entry.originExcerpt = text(input.originExcerpt, 300).trim()
  // 人格归属：各人格各自记账，空值表示不区分人格的公共记忆（旧数据都是空）
  entry.presetId = text(input.presetId, 40).trim()
  entry.presetName = text(input.presetName, 100).trim()
  entry.validFrom = normalizeDate(input.validFrom, new Date().toISOString())
  entry.validTo = input.validTo ? normalizeDate(input.validTo) : ""
  entry.supersededBy = text(input.supersededBy, 40).trim()
  // 情感值：-1 到 1，负为痛、正为暖，0 为中性
  const valence = clampNumber(input.valence, -1, 1)
  entry.valence = valence === null ? 0 : Math.round(valence * 100) / 100
  entry.reinterpretations = Array.isArray(input.reinterpretations)
    ? input.reinterpretations
        .filter(item => item && (item.text || item.note))
        .slice(-8)
        .map(item => ({
          at: normalizeDate(item.at, new Date().toISOString()),
          text: text(item.text || item.note, 500).trim(),
          byId: text(item.byId, 40).trim(),
          valence: clampNumber(item.valence, -1, 1) ?? 0,
        }))
    : []
  entry.pinned = input.pinned === true
  entry.useCount = Math.max(0, Math.floor(Number(input.useCount) || 0))
  entry.lastUsedAt = text(input.lastUsedAt, 40) || ""
  entry.archivedAt = input.archivedAt ? normalizeDate(input.archivedAt) : ""
  entry.archiveReason = text(input.archiveReason, 100).trim()
  entry.encodedEmotion = input.encodedEmotion ? normalizeEmotion(input.encodedEmotion) : null
  entry.lastRecallEmotion = text(input.lastRecallEmotion, 40).trim()
  entry.lastRecalledAt = input.lastRecalledAt ? normalizeDate(input.lastRecalledAt) : ""
  entry.promise = normalizePromise(input.promise, entry.occurredAt)
  entry.revision = Math.max(1, Math.floor(Number(input.revision) || 1))
  entry.createdAt = normalizeDate(input.createdAt)
  entry.updatedAt = normalizeDate(input.updatedAt, entry.createdAt)
  entry.occurredAt = normalizeDate(input.occurredAt, entry.createdAt)
  return entry
}

function entrySummary(entry) {
  return entry.content || entry.title || entry.event.slice(0, 200)
}

export default class AIMemoryStore {
  constructor(file = STORE_FILE) {
    this.file = file
    this.entries = []
    this.relations = {}
    this.loaded = false
    this._saveTimer = null
  }

  load() {
    let needsPersist = false
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"))
        const list = Array.isArray(parsed) ? parsed : parsed?.entries
        needsPersist = Array.isArray(parsed) || Number(parsed?.version) < STORE_VERSION
        this.relations = {}
        if (!Array.isArray(parsed) && parsed?.relations && typeof parsed.relations === "object") {
          for (const [scope, relation] of Object.entries(parsed.relations)) {
            const normalized = normalizeRelationScope(scope)
            if (normalized) this.relations[normalized] = normalizeRelation(relation)
          }
        }
        if (Array.isArray(list)) {
          const seen = new Set()
          this.entries = []
          for (const raw of list) {
            if (!raw || !(raw.content || raw.event || raw.title)) continue
            const entry = normalizeEntry(raw)
            if (seen.has(entry.id)) entry.id = newId()
            seen.add(entry.id)
            this.entries.push(entry)
          }
          const ids = new Set(this.entries.map(entry => entry.id))
          for (const entry of this.entries) entry.links = entry.links.filter(id => id !== entry.id && ids.has(id))
          this._recomputeDepths()
        }
      }
    } catch (error) {
      console.error(`[AIMemoryStore] 读取失败: ${error.message}`)
      this.entries = []
      this.relations = {}
      needsPersist = false
    }
    this.loaded = true
    if (needsPersist) this.flush()
    return this
  }

  _ensure() {
    if (!this.loaded) this.load()
  }

  save() {
    if (this._saveTimer) return
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null
      this.flush()
    }, 300)
    this._saveTimer.unref?.()
  }

  flush() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const temp = `${this.file}.tmp`
      fs.writeFileSync(
        temp,
        JSON.stringify({ version: STORE_VERSION, entries: this.entries, relations: this.relations }, null, 2),
        "utf8",
      )
      fs.renameSync(temp, this.file)
    } catch (error) {
      console.error(`[AIMemoryStore] 保存失败: ${error.message}`)
    }
  }

  get(id) {
    this._ensure()
    return this.entries.find(entry => entry.id === id) || null
  }

  add(input = {}, options = {}) {
    this._ensure()
    const scope = normalizeScope(input.scope)
    if (!scope) return { success: false, error: "scope 无效：可选 global / group:<群号> / user:<QQ号>" }
    const kind = normalizeKind(input.kind, "fact")
    const content = (text(input.content, 4000).trim() || text(input.title, 200).trim() || text(input.event, 4000).trim().slice(0, 300)).trim()
    if (!content) return { success: false, error: "记忆内容不能为空" }
    if (normalizeContent(content).length < 2) return { success: false, error: "记忆内容过短，无法作为记忆" }

    const now = new Date().toISOString()
    const occurredAt = normalizeDate(input.occurredAt, now)
    const normalized = normalizeContent(content)
    const originGroupId = normalizeGroupId(input.originGroupId || options.originGroupId)
    const originChat =
      normalizeOriginChat(input.originChat || options.originChat) ||
      (originGroupId ? `group:${originGroupId}` : "")
    const relationScope =
      normalizeRelationScope(options.relationScope) || defaultRelationScope(scope)
    const duplicate = this.entries.find(entry => {
      if (entry.scope !== scope || entry.kind !== kind) return false
      if (normalizeContent(entry.content) !== normalized) return false
      if (scope.startsWith("user:") && originPrivacy(entry.originChat) !== originPrivacy(originChat))
        return false
      return kind === "episode" ? sameDay(entry.occurredAt, occurredAt) : true
    })
    if (duplicate) {
      this._mergeInto(duplicate, input, occurredAt)
      duplicate.updatedAt = now
      duplicate.revision++
      if (kind === "episode") this._applyRelation(duplicate, relationScope)
      this._recomputeDepths()
      this.save()
      return { success: true, action: "merged", entry: duplicate }
    }

    const entry = normalizeEntry(
      {
        ...input,
        originChat,
        originGroupId,
        id: newId(),
        kind,
        scope,
        content,
        occurredAt,
        depth: 0,
        useCount: 0,
        lastUsedAt: "",
        revision: 1,
        createdAt: now,
        updatedAt: now,
      },
      scope,
    )
    this._applyLinks(entry, input.links)
    this.entries.push(entry)
    if (kind === "episode") this._applyRelation(entry, relationScope)
    // 容量上限来自记忆配置；调用方没传时用 5000 兜底，不能是 300——
    // 那会把配置里的容量设置架空，旧记忆被悄悄淘汰
    this._prune(Number(options.max) || 5000)
    this._recomputeDepths()
    this.save()
    return { success: true, action: "created", entry }
  }

  _mergeInto(entry, input, occurredAt) {
    const merged = normalizeEntry({ ...entry, ...input, id: entry.id, kind: entry.kind, scope: entry.scope, content: entry.content })
    for (const field of TEXT_FIELDS) {
      if (!entry[field] && merged[field]) entry[field] = merged[field]
    }
    for (const field of LIST_FIELDS) {
      entry[field] = [...new Set([...(entry[field] || []), ...(merged[field] || [])])].slice(0, MAX_LIST_ITEMS)
    }
    entry.tags = [...new Set([...(entry.tags || []), ...merged.tags])].slice(0, 10)
    entry.relationship = {
      trust: merged.relationship.trust ?? entry.relationship.trust,
      affinity: merged.relationship.affinity ?? entry.relationship.affinity,
      note: entry.relationship.note || merged.relationship.note,
    }
    entry.importance = Math.max(entry.importance || 1, merged.importance || 1)
    entry.pinned = entry.pinned || merged.pinned
    // 合并时只补空缺：已有情绪不被后来的条目覆盖
    if (!entry.emotion?.primary && merged.emotion?.primary) entry.emotion = merged.emotion
    // 承诺同理：旧的没结清就保留旧承诺，新条目只补空缺
    if (!entry.promise?.text && merged.promise?.text) entry.promise = merged.promise
    if (merged.occurredAt && !occurredAt) entry.occurredAt = merged.occurredAt
    this._applyLinks(entry, [...(entry.links || []), ...(input.links || [])])
  }

  _applyLinks(entry, rawLinks) {
    const current = new Set(entry.links || [])
    const next = new Set(
      (Array.isArray(rawLinks) ? rawLinks : [])
        .map(id => text(id, 40).trim())
        .filter(id => id && id !== entry.id && this.entries.some(item => item.id === id)),
    )
    for (const id of current) {
      if (next.has(id)) continue
      const target = this.get(id)
      if (target) target.links = (target.links || []).filter(link => link !== entry.id)
    }
    for (const id of next) {
      const target = this.get(id)
      if (target && !target.links.includes(entry.id)) {
        target.links = [...target.links, entry.id].slice(0, MAX_LINKS)
      }
    }
    entry.links = [...next].slice(0, MAX_LINKS)
  }

  _relation(scope) {
    return normalizeRelation(this.relations[scope] || DEFAULT_RELATION)
  }

  _applyRelation(entry, relationScope) {
    const scope =
      normalizeRelationScope(relationScope) || defaultRelationScope(entry.scope)
    if (!scope) return
    const relation = this._relation(scope)
    relation.interactions += 1
    const { trust, affinity } = entry.relationship || {}
    if (trust !== null && trust !== undefined) relation.trust = Math.round(relation.trust * 0.7 + trust * 0.3)
    if (affinity !== null && affinity !== undefined) relation.affinity = Math.round(relation.affinity * 0.7 + affinity * 0.3)
    if (entry.mood) relation.lastMood = entry.mood
    if (entry.energy) relation.lastEnergy = entry.energy
    if (entry.relationship?.note) relation.note = entry.relationship.note
    relation.updatedAt = new Date().toISOString()
    this.relations[scope] = relation
  }

  /**
   * 好感度按会话独立：群聊只读本群关系，私聊只读本次私聊关系。
   * 不合并 global / user / 其他群，避免不同群的信任与好感互相污染。
   */
  relationsFor({ groupId, userId } = {}) {
    this._ensure()
    let scope = groupId ? `group:${groupId}` : userId ? `private:${userId}` : "global"
    let relation = this._relation(scope)
    if (scope.startsWith("private:") && relation.interactions === 0) {
      const legacy = `user:${userId}`
      const legacyRelation = this._relation(legacy)
      if (legacyRelation.interactions > 0) {
        scope = legacy
        relation = legacyRelation
      }
    }
    if (relation.interactions <= 0) {
      return {
        list: [],
        merged: { ...DEFAULT_RELATION },
      }
    }
    return {
      list: [{ scope, ...relation }],
      merged: { ...relation },
    }
  }

  setRelation(scope, updates = {}) {
    this._ensure()
    const normalized = normalizeRelationScope(scope)
    if (!normalized) return { success: false, error: "scope 无效" }
    const relation = this._relation(normalized)
    const trust = clampNumber(updates.trust, 0, 100)
    const affinity = clampNumber(updates.affinity, 0, 100)
    if (trust !== null) relation.trust = Math.round(trust)
    if (affinity !== null) relation.affinity = Math.round(affinity)
    if (updates.note !== undefined) relation.note = text(updates.note, 500).trim()
    relation.updatedAt = new Date().toISOString()
    this.relations[normalized] = relation
    this.save()
    return { success: true, relation }
  }

  _recomputeDepths() {
    const tagIndex = new Map()
    const peopleIndex = new Map()
    const inbound = new Map()
    for (const entry of this.entries) {
      for (const tag of entry.tags || []) {
        if (!tagIndex.has(tag)) tagIndex.set(tag, new Set())
        tagIndex.get(tag).add(entry.id)
      }
      for (const person of entry.people || []) {
        if (!peopleIndex.has(person)) peopleIndex.set(person, new Set())
        peopleIndex.get(person).add(entry.id)
      }
      for (const id of entry.links || []) inbound.set(id, (inbound.get(id) || 0) + 1)
    }
    for (const entry of this.entries) {
      const related = new Set()
      for (const tag of entry.tags || []) {
        for (const id of tagIndex.get(tag) || []) if (id !== entry.id) related.add(id)
      }
      for (const person of entry.people || []) {
        for (const id of peopleIndex.get(person) || []) if (id !== entry.id) related.add(id)
      }
      const linkCount = (entry.links || []).length + (inbound.get(entry.id) || 0)
      const richFields = [
        ...LIST_FIELDS.filter(field => (entry[field] || []).length),
        ...TEXT_FIELDS.filter(field => entry[field]),
      ].length
      const base = (entry.importance || 1) * 10
      const linkBoost = Math.min(18, linkCount * 6)
      const relatedBoost = Math.min(24, related.size * 3)
      const richBoost = Math.min(16, Math.round(richFields * 1.3))
      entry.depth = Math.min(100, Math.round(base + linkBoost + relatedBoost + richBoost))
    }
  }

  _prune(max) {
    if (this.entries.length <= max) return
    const removable = this.entries
      .filter(entry => !entry.pinned)
      .sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)))
    while (this.entries.length > max && removable.length) {
      const target = removable.shift()
      this._removeEntry(target)
    }
    while (this.entries.length > max) this._removeEntry(this.entries[0])
  }

  _removeEntry(entry) {
    const index = this.entries.indexOf(entry)
    if (index === -1) return false
    this.entries.splice(index, 1)
    for (const other of this.entries) {
      if ((other.links || []).includes(entry.id))
        other.links = other.links.filter(id => id !== entry.id)
    }
    return true
  }

  /**
   * 情感驱动的再解读：同一条记忆，因关系或心境变化被重新理解。
   * 原内容一个字都不改，只在 reinterpretations 里追加新的读法，
   * 对应"乐极生悲""因爱生恨"——事情没变，看法变了。
   */
  reinterpret(id, { text: reading = "", valence = null, byId = "" } = {}) {
    this._ensure()
    const entry = this.get(id)
    if (!entry) return { success: false, error: "未找到该记忆" }
    const body = text(reading, 500).trim()
    if (!body) return { success: false, error: "再解读内容不能为空" }
    const value = clampNumber(valence, -1, 1)
    entry.reinterpretations = [
      ...(entry.reinterpretations || []),
      { at: new Date().toISOString(), text: body, byId: String(byId || "").slice(0, 40), valence: value ?? entry.valence ?? 0 },
    ].slice(-8)
    // 情感值向新解读靠拢，但不完全覆盖：保留一点原来的分量，避免情绪一闪就翻篇
    if (value !== null) entry.valence = Math.round(((entry.valence ?? 0) * 0.4 + value * 0.6) * 100) / 100
    entry.revision = (entry.revision || 1) + 1
    entry.updatedAt = new Date().toISOString()
    this.save()
    return { success: true, entry }
  }

  /**
   * 召回强化：批量刷新被用到的记忆，写盘延迟合并，避免每次检索都落盘。
   */
  touchUsed(ids = [], { emotion = null, now = Date.now() } = {}) {
    if (!Array.isArray(ids) || !ids.length) return 0
    const stamp = new Date(now).toISOString()
    let touched = 0
    for (const id of ids) {
      const entry = this.get(id)
      if (!entry) continue
      entry.useCount = (entry.useCount || 0) + 1
      entry.lastUsedAt = stamp
      // 再巩固：被想起时用当前情绪轻微染色。编码时的标签留在 encodedEmotion 里，
      // 新状态只按小系数混合，避免一次心情就把长期记忆改写。
      const current = normalizeEmotion(emotion)
      if (current.primary) {
        const base = normalizeEmotion(entry.emotion)
        if (base.primary) {
          // 编码时的标签只在第一次再巩固时留底，之后不再被覆盖
          if (!entry.encodedEmotion?.primary) entry.encodedEmotion = { ...base }
          entry.emotion = {
            primary: base.primary,
            secondary: base.secondary,
            intensity: Math.max(1, Math.min(3, Math.round(base.intensity * 0.85 + current.intensity * 0.15))),
          }
        }
        entry.lastRecallEmotion = current.primary
        entry.lastRecalledAt = stamp
      }
      touched++
    }
    if (touched) this.save()
    return touched
  }

  /**
   * 把一条记忆标记为「已被推翻」，保留在库里供回查，但不再注入上下文。
   * 对应双时间轴的 validTo：旧事实曾经为真，只是现在不再成立。
   */
  supersede(id, { byId = "", reason = "" } = {}) {
    this._ensure()
    const entry = this.get(id)
    if (!entry) return { success: false, error: "未找到该记忆" }
    if (entry.validTo) return { success: true, already: true, entry }
    entry.validTo = new Date().toISOString()
    entry.supersededBy = String(byId || "").slice(0, 40)
    if (reason) entry.corrections = text(reason, 2000).trim() || entry.corrections
    entry.revision = (entry.revision || 1) + 1
    entry.updatedAt = new Date().toISOString()
    this.save()
    return { success: true, entry }
  }

  update(id, updates = {}) {
    this._ensure()
    const entry = this.get(id)
    if (!entry) return { success: false, error: "未找到该记忆" }

    if (updates.kind !== undefined) entry.kind = normalizeKind(updates.kind, entry.kind)
    if (updates.content !== undefined) {
      const content = text(updates.content, 4000).trim()
      if (!content) return { success: false, error: "记忆内容不能为空" }
      entry.content = content
    }
    if (updates.scope !== undefined) {
      const scope = normalizeScope(updates.scope)
      if (!scope) return { success: false, error: "scope 无效" }
      entry.scope = scope
    }
    for (const field of TEXT_FIELDS) {
      if (updates[field] !== undefined) entry[field] = text(updates[field], field === "event" ? 6000 : 4000).trim()
    }
    for (const field of LIST_FIELDS) {
      if (updates[field] !== undefined) entry[field] = normalizeList(updates[field])
    }
    if (updates.relationship !== undefined) {
      const relationship = normalizeRelationship(updates.relationship)
      entry.relationship = {
        trust: relationship.trust ?? entry.relationship.trust,
        affinity: relationship.affinity ?? entry.relationship.affinity,
        note: relationship.note || entry.relationship.note,
      }
    }
    if (updates.tags !== undefined) entry.tags = normalizeTags(updates.tags)
    if (updates.emotion !== undefined) entry.emotion = normalizeEmotion(updates.emotion)
    if (updates.promise !== undefined) entry.promise = normalizePromise(updates.promise, entry.occurredAt)
    if (updates.pinned !== undefined) entry.pinned = updates.pinned === true
    if (updates.importance !== undefined) {
      const importance = clampNumber(updates.importance, 1, 5)
      if (importance !== null) entry.importance = Math.round(importance)
    }
    if (updates.occurredAt !== undefined) entry.occurredAt = normalizeDate(updates.occurredAt, entry.occurredAt)
    if (updates.links !== undefined) this._applyLinks(entry, updates.links)
    entry.updatedAt = new Date().toISOString()
    entry.revision++
    this._recomputeDepths()
    this.save()
    return { success: true, entry }
  }

  link(id, targetId) {
    this._ensure()
    const entry = this.get(id)
    const target = this.get(targetId)
    if (!entry || !target) return { success: false, error: "记忆不存在" }
    if (entry.id === target.id) return { success: false, error: "不能关联自身" }
    if (!entry.links.includes(target.id)) this._applyLinks(entry, [...entry.links, target.id])
    this._recomputeDepths()
    this.save()
    return { success: true, entry, target }
  }

  unlink(id, targetId) {
    this._ensure()
    const entry = this.get(id)
    if (!entry) return { success: false, error: "记忆不存在" }
    this._applyLinks(entry, entry.links.filter(link => link !== targetId))
    this._recomputeDepths()
    this.save()
    return { success: true, entry }
  }

  remove(id) {
    this._ensure()
    const entry = this.get(id)
    if (!entry) return false
    this._removeEntry(entry)
    this._recomputeDepths()
    this.save()
    return true
  }

  pin(id, pinned = true) {
    return this.update(id, { pinned })
  }

  /**
   * 两层遗忘的第二层：长期没被想起、又不重要的条目挪进「已遗忘」。
   * 只标记不删除，随时可在 WebUI 恢复；固定、被召回过的、高重要度的都跳过。
   */
  archiveStale({ days = 180, importanceBelow = 0.6, now = Date.now() } = {}) {
    this._ensure()
    const limit = Math.max(0, Number(days) || 180) * 86400000
    const threshold = clampNumber(importanceBelow, 0, 1) ?? 0.6
    const archived = []
    for (const entry of this.entries) {
      if (entry.archivedAt || entry.pinned || entry.validTo) continue
      if ((entry.importance || 0) / 5 >= threshold) continue
      if (Number(entry.useCount) > 0) continue
      const last = Date.parse(entry.lastUsedAt) || Date.parse(entry.updatedAt) || Date.parse(entry.createdAt) || 0
      if (!last || now - last < limit) continue
      entry.archivedAt = new Date(now).toISOString()
      entry.archiveReason = `超过 ${Math.round(limit / 86400000)} 天未想起且重要度不足`
      entry.updatedAt = entry.archivedAt
      archived.push(entry.id)
    }
    if (archived.length) {
      this._recomputeDepths()
      this.save()
    }
    return archived
  }

  /** 从「已遗忘」恢复 */
  restoreArchived(id) {
    this._ensure()
    const entry = this.get(id)
    if (!entry) return { success: false, error: "未找到该记忆" }
    entry.archivedAt = ""
    entry.archiveReason = ""
    entry.updatedAt = new Date().toISOString()
    entry.revision = (entry.revision || 1) + 1
    this.save()
    return { success: true, entry }
  }

  /** 用于相关度匹配的词集合：标题、摘要、事件、标签、人物，不含全部长文本 */
  _termsOf(entry) {
    const key = `${entry.id}:${entry.revision || 1}`
    if (!this._termsCache) this._termsCache = new Map()
    let terms = this._termsCache.get(key)
    if (!terms) {
      terms = termsOf(
        [entry.title, entry.content, entry.event, ...(entry.tags || []), ...(entry.people || []), entry.mood]
          .filter(Boolean)
          .join(" "),
      )
      // 缓存只留在内存里，不写进 memories.json
      if (this._termsCache.size > 4000) this._termsCache.clear()
      this._termsCache.set(key, terms)
    }
    return terms
  }

  /** 本轮用户消息与某条记忆的字面相关度；0 表示完全没共同语言 */
  relevance(entry, query) {
    return relevanceOf(termsOf(query), this._termsOf(entry))
  }

  /** 两条记忆是否在说同一件事：同一天 + 标题/摘要高度重叠 */
  _sameTopic(a, b) {
    if (!a || !b || a.id === b.id) return false
    const dayA = String(a.occurredAt || a.createdAt || "").slice(0, 10)
    const dayB = String(b.occurredAt || b.createdAt || "").slice(0, 10)
    if (!dayA || dayA !== dayB) return false
    const termsA = this._termsOf(a)
    const termsB = this._termsOf(b)
    if (!termsA.size || !termsB.size) return false
    let shared = 0
    for (const term of termsA) if (termsB.has(term)) shared++
    return shared / Math.min(termsA.size, termsB.size) >= 0.7
  }

  _searchText(entry) {
    return [
      entry.content,
      entry.title,
      entry.event,
      entry.desire,
      entry.reasoning,
      entry.learning,
      entry.verification,
      entry.lessons,
      entry.corrections,
      entry.masterOpinion,
      entry.delivery,
      entry.acceptance,
      entry.mood,
      entry.energy,
      entry.relationship?.note,
      ...LIST_FIELDS.flatMap(field => entry[field] || []),
      ...(entry.tags || []),
      emotionLabel(entry.emotion),
      entry.scope,
      entry.kind,
    ]
      .join(" ")
      .toLowerCase()
  }

  list(options = {}) {
    this._ensure()
    const query = String(options.query || "").trim().toLowerCase()
    const scope = options.scope ? normalizeScope(options.scope) : null
    const kind = options.kind === "episode" || options.kind === "fact" ? options.kind : null
    // 归档默认不出现；传 archived=true 只看已遗忘，all 则全部
    const archivedMode =
      options.archived === "all" ? "all" : options.archived === "only" || options.archived === true || options.archived === "true" ? "only" : "hide"
    // 情绪只在有值时参与加分，不做硬过滤：情绪不对但内容相关的记忆仍然该被想起
    const emotion = normalizeEmotion(options.emotion)
    const page = Math.max(1, Number(options.page) || 1)
    const pageSize = Math.min(200, Math.max(5, Number(options.pageSize) || 20))
    let list = this.entries.slice()
    if (archivedMode === "hide") list = list.filter(entry => !entry.archivedAt)
    else if (archivedMode === "only") list = list.filter(entry => !!entry.archivedAt)
    if (scope) list = list.filter(entry => entry.scope === scope)
    if (kind) list = list.filter(entry => entry.kind === kind)
    if (query || emotion.primary) {
      // 多词查询按空格拆开，要求每个词都出现；整串匹配会让「鸣潮 莫宁」这类查询永远 0 命中
      const terms = query.split(/\s+/).map(term => term.trim()).filter(Boolean)
      const scored = []
      for (const entry of list) {
        const text = this._searchText(entry)
        // 只给情绪时不做关键词过滤，否则空查询会把全部条目挡掉
        if (terms.length && !terms.every(term => text.includes(term))) continue
        // 命中标题或标签的排前面，避免只正文沾边的内容挤掉真正相关的条目
        const title = String(entry.title || "").toLowerCase()
        const tags = (entry.tags || []).map(tag => String(tag).toLowerCase())
        const titleHit = terms.filter(term => title.includes(term)).length
        const tagHit = terms.filter(term => tags.some(tag => tag.includes(term))).length
        const emotionHit = emotion.primary && entry.emotion?.primary
          ? entry.emotion.primary === emotion.primary
            ? 8
            : (entry.emotion.secondary || []).includes(emotion.primary)
              ? 4
              : 0
          : 0
        scored.push({ entry, score: titleHit * 3 + tagHit * 2 + emotionHit })
      }
      scored.sort(
        (a, b) =>
          b.score - a.score ||
          Number(b.entry.pinned) - Number(a.entry.pinned) ||
          String(b.entry.updatedAt).localeCompare(String(a.entry.updatedAt)),
      )
      list = scored.map(item => item.entry)
    } else
      list.sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          String(b.updatedAt).localeCompare(String(a.updatedAt)),
      )
    const total = list.length
    return { total, page, pageSize, results: list.slice((page - 1) * pageSize, page * pageSize) }
  }

  _scopesFor({ groupId, userId }) {
    const scopes = new Set(["global"])
    if (groupId) scopes.add(`group:${groupId}`)
    if (userId) scopes.add(`user:${userId}`)
    return scopes
  }

  /**
   * 记忆可见性：本人作用域可跨群认出同一个人。
   * 私聊来源的记忆在群里直接不可见：只靠提示词让模型「别说」并不可靠，
   * 内容一旦进上下文就存在被复述的风险。
   * 人格维度：记忆共享，不按人格切断；presetId 只用于标注「谁记下的」。
   */
  isVisible(entry, { groupId, userId, allowPrivateOrigin } = {}) {
    if (!entry) return false
    // 已被推翻的事实只留在库里供回查，不再注入上下文
    if (entry.validTo) return false
    // 已遗忘的条目同样只留档：注入与工具检索都看不到，WebUI 仍可查
    if (entry.archivedAt) return false
    // 群聊默认排除私聊来源的用户记忆，避免私密内容进群上下文
    const allowPrivate = allowPrivateOrigin === true
    if (groupId && !allowPrivate && this.isPrivateOrigin(entry)) return false
    const scopes = this._scopesFor({ groupId, userId })
    return scopes.has(entry.scope)
  }

  /** 这条记忆是否属于「私聊来源、当前却在群里」的情况，需要提示模型别主动提 */
  isPrivateOrigin(entry) {
    return originPrivacy(entry?.originChat) === "private"
  }

  /**
   * 记忆强度：重要度与召回次数决定「基底」，时间做指数衰减，被召回则回补。
   * 参照重要性衰减机制——不删除，只降低排序权重，久未触碰的自然沉底。
   */
  _strength(entry) {
    const now = Date.now()
    const last = Date.parse(entry.lastUsedAt) || Date.parse(entry.updatedAt) || Date.parse(entry.createdAt) || now
    const idleDays = Math.max(0, (now - last) / 86400000)
    // 召回次数只做小幅加成（上限 10）：早期按 20 上限会形成「越常被选中越不可能沉底」的死循环
    const base = (entry.importance || 1) * 20 + Math.min(10, (entry.useCount || 0))
    // 半衰期 30 天：三个月没被想起，权重降到一成左右
    const decay = Math.exp(-idleDays / 43)
    const stable = entry.pinned || entry.kind === "episode" ? 1.35 : 1
    return base * decay * stable
  }

  _score(entry, scopes, queryTerms = null, mood = null) {
    const now = Date.now()
    const occurred = Date.parse(entry.occurredAt) || Date.parse(entry.updatedAt) || now
    const days = Math.max(0, (now - occurred) / 86400000)
    const recency = Math.max(0, 30 - days * 0.5)
    const scopeBoost = entry.scope.startsWith("user:")
      ? 15
      : entry.scope.startsWith("group:")
        ? 10
        : scopes.has("global")
          ? 5
          : 0
    // 相关度占大头：没有共同词的记忆再重要也不该在聊别的事时冒出来
    const relevance = queryTerms ? relevanceOf(queryTerms, this._termsOf(entry)) * 60 : 0
    const moodMatch = mood && entry.emotion?.primary === mood ? 6 : 0
    return (
      (entry.pinned ? 1000 : 0) +
      this._strength(entry) +
      (entry.depth || 0) * 0.4 +
      recency +
      relevance +
      moodMatch +
      (entry.kind === "episode" ? 8 : 0) +
      scopeBoost
    )
  }

  /**
   * 构造当前会话的回忆上下文。
   * primary 为按重要度/深度/新鲜度选出的主记忆，linked 为它们勾起的关联记忆。
   */
  contextFor({ groupId, userId, presetId, query = "", mood = "" } = {}, limit = 8, options = {}) {
    this._ensure()
    const scopes = this._scopesFor({ groupId, userId })
    const candidates = this.entries.filter(entry => this.isVisible(entry, { groupId, userId }))
    if (!candidates.length) {
      return {
        primary: [],
        linked: [],
        groupId: groupId || "",
        relations: this.relationsFor({ groupId, userId }),
        continuity: { recent: [], openIntentions: [], lessons: [], corrections: [] },
      }
    }
    const queryTerms = query ? termsOf(query) : null
    const score = entry => this._score(entry, scopes, queryTerms, mood)
    const sorted = candidates.slice().sort((a, b) => score(b) - score(a))
    // 强度门槛：真正沉底的记忆不自动注入，但仍留在库里可被 memory_search 搜到；
    // 至少保留两条，避免小群因为记忆太少而突然失忆
    // 相关门：先把「这轮真提到了」的挑出来；完全无关的只在相关条目不足时补位，
    // 且补位最多两条（固定与最近经历），避免聊别的事时把最重的旧事硬端上来。
    const related = []
    const unrelated = []
    for (const entry of sorted) {
      if (queryTerms && relevanceOf(queryTerms, this._termsOf(entry)) > 0) related.push(entry)
      else unrelated.push(entry)
    }
    const primary = []
    const push = entry => {
      if (primary.length >= Math.max(1, limit)) return
      if (primary.some(item => this._sameTopic(item, entry))) return
      // 强度门槛：真正沉底的记忆不自动注入，仍可被 memory_search 搜到
      if (primary.length >= 2 && !entry.pinned && this._strength(entry) < MIN_INJECT_STRENGTH) return
      primary.push(entry)
    }
    for (const entry of related) push(entry)
    if (primary.length < Math.min(2, Math.max(1, limit))) {
      for (const entry of unrelated) {
        if (primary.length >= Math.min(2, Math.max(1, limit))) break
        push(entry)
      }
    }
    if (!primary.length && sorted.length) primary.push(sorted[0])
    // 注入不等于被使用：每轮注入都 touchUsed 会让常驻前排的记忆永不下沉，
    // 衰减彻底失效。强化只交给 recall（关键词真正命中）来做。
    const primaryIds = new Set(primary.map(entry => entry.id))
    const linkedLimit = Math.max(2, Math.min(8, options.linkedLimit || Math.round(limit / 2) || 4))
    const linked = []
    const seen = new Set(primaryIds)
    const pushLinked = (entry, reason) => {
      if (!entry || seen.has(entry.id) || !this.isVisible(entry, { groupId, userId }) || linked.length >= linkedLimit) return
      seen.add(entry.id)
      linked.push({ ...entry, _reason: reason })
    }
    for (const entry of primary) {
      for (const id of entry.links || []) pushLinked(this.get(id), "显式关联")
      const related = candidates
        .filter(item => item.id !== entry.id && !seen.has(item.id))
        .map(item => ({
          entry: item,
          sharedTags: (item.tags || []).filter(tag => (entry.tags || []).includes(tag)).length,
          sharedPeople: (item.people || []).filter(person => (entry.people || []).includes(person)).length,
        }))
        .filter(item => item.sharedTags || item.sharedPeople)
        .sort(
          (a, b) =>
            b.sharedTags * 2 + b.sharedPeople * 3 + (b.entry.depth || 0) * 0.1 -
            (a.sharedTags * 2 + a.sharedPeople * 3 + (a.entry.depth || 0) * 0.1),
        )
      for (const item of related) {
        const reason = [
          item.sharedTags ? `共同标签 ${item.sharedTags}` : "",
          item.sharedPeople ? `共同人物 ${item.sharedPeople}` : "",
        ]
          .filter(Boolean)
          .join(" / ")
        pushLinked(item.entry, reason)
      }
      if (linked.length >= linkedLimit) break
    }
    this.save()
    return {
      primary,
      linked: linked.map(({ _reason, ...entry }) => ({ entry, reason: _reason })),
      groupId: groupId || "",
      relations: this.relationsFor({ groupId, userId }),
      continuity: { ...this.continuity({ groupId, userId, presetId }, options.continuityLimit || 5) },
    }
  }

  /** “想起一件事又会勾起另外的事”：从一条记忆出发，沿显式关联与共享标签/人物扩散。 */
  recall(id, options = {}) {
    this._ensure()
    const anchor = this.get(String(id || ""))
    if (!anchor) return { success: false, error: "未找到该记忆" }
    const scopes = options.scopes ? new Set(options.scopes) : null
    const visible = entry =>
      options.context ? this.isVisible(entry, options.context) : !scopes || scopes.has(entry.scope)
    if (!visible(anchor)) return { success: false, error: "无权访问该记忆" }
    const limit = Math.min(30, Math.max(1, Number(options.limit) || 10))
    const maxDepth = Math.min(3, Math.max(1, Number(options.depth) || 2))
    const queue = [{ entry: anchor, depth: 0 }]
    const seen = new Set([anchor.id])
    const related = []
    while (queue.length && related.length < limit) {
      const { entry, depth } = queue.shift()
      if (depth >= maxDepth) continue
      const neighbors = new Map()
      const addNeighbor = (target, reason, weight) => {
        if (!target || target.id === entry.id || seen.has(target.id) || !visible(target)) return
        const existing = neighbors.get(target.id)
        if (existing) {
          existing.weight += weight
          if (!existing.reasons.includes(reason)) existing.reasons.push(reason)
        } else {
          neighbors.set(target.id, { entry: target, reasons: [reason], weight })
        }
      }
      for (const linkId of entry.links || []) {
        addNeighbor(this.get(linkId), "显式关联", 4)
      }
      for (const item of this.entries) {
        if (item.id === entry.id || item.scope !== entry.scope) continue
        const sharedTags = (item.tags || []).filter(tag => (entry.tags || []).includes(tag)).length
        const sharedPeople = (item.people || []).filter(person => (entry.people || []).includes(person)).length
        if (!sharedTags && !sharedPeople) continue
        addNeighbor(
          item,
          [sharedTags ? `共同标签 ${sharedTags}` : "", sharedPeople ? `共同人物 ${sharedPeople}` : ""]
            .filter(Boolean)
            .join(" / "),
          sharedTags * 1.5 + sharedPeople * 2,
        )
      }
      const ordered = [...neighbors.values()].sort(
        (a, b) => b.weight - a.weight || (b.entry.depth || 0) - (a.entry.depth || 0),
      )
      for (const neighbor of ordered) {
        if (seen.has(neighbor.entry.id)) continue
        seen.add(neighbor.entry.id)
        related.push({
          entry: neighbor.entry,
          reason: neighbor.reasons.join(" · "),
          depth: depth + 1,
        })
        queue.push({ entry: neighbor.entry, depth: depth + 1 })
        if (related.length >= limit) break
      }
    }
    // 真正被查出来用才算强化：锚点加满，关联按深度递减；顺带用当前情绪再巩固
    this.touchUsed([anchor.id, ...related.map(item => item.entry.id)], { emotion: options.emotion })
    return { success: true, anchor, related }
  }

  /** 最近经历、未完成计划、教训与纠错，用于跨会话连续性注入。 */
  continuity({ groupId, userId, presetId } = {}, limit = 5) {
    this._ensure()
    const episodes = this.entries
      .filter(entry => entry.kind === "episode" && this.isVisible(entry, { groupId, userId }))
      .sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)))
    const recent = episodes.slice(0, Math.max(1, limit))
    const openIntentions = []
    const promises = []
    const lessons = []
    const corrections = []
    // 承诺不看「最近 N 条经历」：答应了几天没做也仍然欠着，必须自己查出来
    for (const entry of episodes) {
      if (entry.promise?.status !== "open") continue
      promises.push({
        id: entry.id,
        title: entrySummary(entry),
        text: entry.promise.text,
        due: entry.promise.due,
        madeAt: entry.promise.madeAt,
      })
    }
    promises.sort((a, b) => String(a.madeAt).localeCompare(String(b.madeAt)))
    for (const entry of recent) {
      for (const item of entry.intentions || []) {
        if (openIntentions.length < 8) openIntentions.push({ id: entry.id, title: entrySummary(entry), text: item })
      }
      if (entry.lessons) lessons.push({ id: entry.id, title: entrySummary(entry), text: entry.lessons })
      if (entry.corrections) corrections.push({ id: entry.id, title: entrySummary(entry), text: entry.corrections })
    }
    return {
      recent,
      openIntentions,
      promises: promises.slice(0, 5),
      lessons: lessons.slice(0, 6),
      corrections: corrections.slice(0, 6),
    }
  }

  /** 兑现或放弃一条承诺：只改状态，原承诺文本与证据都留档 */
  settlePromise(id, { status = "done", evidence = "" } = {}) {
    this._ensure()
    const entry = this.get(id)
    if (!entry?.promise?.text) return { success: false, error: "这条回忆没有承诺" }
    // 只允许从「未结清」改一次：已完成/已放弃的再次调用不改状态
    if (entry.promise.status !== "open")
      return { success: false, error: "这条承诺已经结清过了", entry }
    entry.promise.status = status === "dropped" ? "dropped" : "done"
    entry.promise.doneAt = new Date().toISOString()
    if (evidence) entry.promise.evidence = text(evidence, 300).trim()
    entry.updatedAt = new Date().toISOString()
    entry.revision = (entry.revision || 1) + 1
    this.save()
    return { success: true, entry }
  }

  /** 待办清单：所有未结清的承诺，供注入与页面使用 */
  openPromises({ groupId, userId } = {}) {
    this._ensure()
    return this.entries
      .filter(entry => entry.promise?.status === "open" && this.isVisible(entry, { groupId, userId }))
      .sort((a, b) => String(a.promise.madeAt).localeCompare(String(b.promise.madeAt)))
  }

  /** 兼容旧调用：返回可注入的主记忆数组。 */
  forContext(context = {}, limit = 8) {
    return this.contextFor(context, limit).primary
  }

  stats() {
    this._ensure()
    const scopes = {}
    let pinned = 0
    let episodes = 0
    let facts = 0
    let depthTotal = 0
    let lastUpdated = ""
    for (const entry of this.entries) {
      scopes[entry.scope] = (scopes[entry.scope] || 0) + 1
      if (entry.pinned) pinned++
      if (entry.kind === "episode") episodes++
      else facts++
      depthTotal += entry.depth || 0
      if (entry.updatedAt > lastUpdated) lastUpdated = entry.updatedAt
    }
    const activeRelations = Object.values(this.relations).filter(
      relation => Number(relation.interactions) > 0,
    ).length
    return {
      total: this.entries.length,
      episodes,
      facts,
      pinned,
      scopes,
      relations: activeRelations,
      avgDepth: this.entries.length ? Math.round(depthTotal / this.entries.length) : 0,
      lastUpdated,
    }
  }

  clear() {
    this._ensure()
    this.entries = []
    this.relations = {}
    this.save()
    this.flush()
  }

  exportAll() {
    this._ensure()
    return {
      entries: this.entries.map(entry => JSON.parse(JSON.stringify(entry))),
      relations: JSON.parse(JSON.stringify(this.relations)),
    }
  }
}

export { HARD_LIMIT, STORE_VERSION, EMOTIONS, EMOTION_LABELS, normalizeEmotion, emotionLabel }
