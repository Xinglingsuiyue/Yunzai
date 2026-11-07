import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import AIToolRegistry from "../AIToolRegistry.js"
import AIStickerStore, { IMAGE_EXT, MAX_IMAGE_BYTES, sniffExt } from "../AIStickerStore.js"

const BASE_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(BASE_DIR, "..", "..", "..")
const STICKER_DIR = path.join(PROJECT_ROOT, "data", "stickers")

const FETCH_TIMEOUT = 10000
const REFRESH_TIMEOUT = 5000
const VISION_TIMEOUT = 30000

const sendHistory = new Map()

function checkSendGate(conversationId, cfg) {
  const now = Date.now()
  const key = String(conversationId || "global")
  const state = sendHistory.get(key) || { lastAt: 0, hits: [] }
  const maxPerHour = Math.max(0, Number(cfg.maxPerHour) || 0)
  state.hits = (state.hits || []).filter(at => now - at < 3600000)
  if (maxPerHour > 0 && state.hits.length >= maxPerHour) {
    return { ok: false, reason: `这一小时已经发过 ${state.hits.length} 张表情了` }
  }
  return { ok: true, state, key, now }
}

function commitSend(key, state, now) {
  state.lastAt = now
  state.hits = [...(state.hits || []), now]
  sendHistory.set(key, state)
}
const DEFAULT_CATEGORIES = ["开心", "悲伤", "生气", "无语", "尴尬", "鼓励", "疑惑", "害羞", "其他"]
const IMAGE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

export const stickerStore = new AIStickerStore(STICKER_DIR)

function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input
  if (input instanceof Uint8Array) return Buffer.from(input)
  return null
}

async function loadImageBuffer(source) {
  return (await fetchImageBuffer(source)).buffer
}

function logImageIssue(parts) {
  try {
    globalThis.Bot?.makeLog?.("debug", ["表情图片获取失败", ...parts], "表情包")
  } catch {}
}

export function sanitizeImageSource(source) {
  let raw = String(source || "")
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, "")
  if (!raw) return ""
  const cq = raw.match(/\[CQ:image[^\]]*\]/i)
  if (cq) {
    const url = cq[0].match(/url=([^,\]]+)/i)
    const file = cq[0].match(/file=([^,\]]+)/i)
    raw = (url?.[1] || file?.[1] || "").trim()
  }
  for (let i = 0; i < 3; i++) {
    const next = raw
      .replace(/&amp;/gi, "&")
      .replace(/&#0*38;/g, "&")
      .replace(/&#x0*26;/gi, "&")
    if (next === raw) break
    raw = next
  }
  return raw.trim()
}

function isBlockedImageHost(url) {
  let host = ""
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "")
  } catch {
    return true
  }
  if (!host) return true
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true
  if (host === "::1" || host === "0.0.0.0") return true
  if (/^(fc|fd|fe80)/.test(host)) return true
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
  }
  return false
}

export async function fetchImageBuffer(source) {
  const raw = sanitizeImageSource(source)
  if (!raw) return { buffer: null, error: "图片地址为空" }
  if (raw.startsWith("base64://")) {
    const buffer = Buffer.from(raw.slice(9), "base64")
    return buffer.length ? { buffer } : { buffer: null, error: "base64 数据为空" }
  }
  if (/^data:image\//i.test(raw)) {
    const buffer = Buffer.from(raw.split(",")[1] || "", "base64")
    return buffer.length ? { buffer } : { buffer: null, error: "data URL 内容为空" }
  }
  if (/^https?:\/\//i.test(raw)) {
    if (isBlockedImageHost(raw)) return { buffer: null, error: "不支持读取内网或本机图片地址" }
    const variants = raw.startsWith("http://") ? [raw, `https://${raw.slice(7)}`] : [raw]
    let lastError = "下载失败"
    for (const url of variants) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
      try {
        let current = url
        let response
        for (let hop = 0; hop <= 3; hop++) {
          response = await fetch(current, {
            signal: controller.signal,
            redirect: "manual",
            headers: { "User-Agent": IMAGE_UA, Referer: "https://qun.qq.com/", Accept: "image/*,*/*;q=0.8" },
          })
          const location = response.headers.get("location")
          if (response.status < 300 || response.status >= 400 || !location) break
          const next = new URL(location, current).toString()
          if (isBlockedImageHost(next)) {
            lastError = "跳转目标指向内网或本机，已拒绝"
            response = null
            break
          }
          current = next
        }
        if (!response) continue
        if (!response.ok) {
          const body = await response.text().catch(() => "")
          lastError = `HTTP ${response.status}${body ? ` ${body.slice(0, 120)}` : ""}`
          continue
        }
        const length = Number(response.headers.get("content-length") || 0)
        if (length && length > MAX_IMAGE_BYTES) return { buffer: null, error: "图片超过 8MB" }
        const array = Buffer.from(await response.arrayBuffer())
        if (array.length > MAX_IMAGE_BYTES) return { buffer: null, error: "图片超过 8MB" }
        if (!mimeOfBuffer(array)) {
          lastError = "返回的内容不是图片"
          continue
        }
        return { buffer: array, url }
      } catch (err) {
        lastError = err?.name === "AbortError" ? "下载超时" : err.message
      } finally {
        clearTimeout(timer)
      }
    }
    try {
      logImageIssue([new URL(raw).host, lastError])
    } catch {
      logImageIssue([lastError])
    }
    return { buffer: null, error: lastError }
  }
  const file = raw.startsWith("file://") ? fileURLToPath(raw) : raw
  let exists = false
  try {
    exists = file.length < 260 && fs.existsSync(file)
  } catch {
    exists = false
  }
  if (exists) {
    const stat = fs.statSync(file)
    if (stat.size > MAX_IMAGE_BYTES) return { buffer: null, error: "图片超过 8MB" }
    return { buffer: fs.readFileSync(file) }
  }

  if (/^[A-Za-z0-9+/=\s]{64,}$/.test(raw)) {
    const buffer = Buffer.from(raw.replace(/\s/g, ""), "base64")
    if (buffer.length && sniffExt(buffer)) return { buffer }
  }
  return { buffer: null, error: "无法识别的图片地址" }
}

function mimeOfBuffer(buffer) {
  const ext = (() => {
    if (buffer[0] === 0x89 && buffer[1] === 0x50) return "png"
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return "jpg"
    if (buffer.slice(0, 3).toString() === "GIF") return "gif"
    if (buffer.slice(0, 4).toString() === "RIFF") return "webp"
    if (buffer[0] === 0x42 && buffer[1] === 0x4d) return "bmp"
    return ""
  })()
  return ext ? `image/${ext === "jpg" ? "jpeg" : ext}` : ""
}

function imageRefFromSegment(seg) {
  if (!seg || typeof seg !== "object") return null
  const data = seg.data || {}
  const type = seg.type || data.type || ""
  const asUrl = value =>
    typeof value === "string" && /^(https?:\/\/|base64:\/\/|data:image\/)/i.test(value) ? value : ""
  const url = asUrl(seg.url) || asUrl(data.url) || asUrl(seg.origin) || asUrl(data.origin) ||
    asUrl(seg.file) || asUrl(data.file)
  const file = String(data.file || seg.file || data.path || seg.path || "")
  if (type === "image") {
    const source = url || file
    return source ? { url, file } : null
  }
  if (type === "mface" || type === "marketface") {
    const emojiId = String(data.emoji_id || data.emojiId || seg.emoji_id || seg.emojiId || "")
    const emojiUrl =
      url || (emojiId ? `https://gxh.vip.qq.com/club/item/parcel/item/${emojiId.slice(0, 2)}/${emojiId}/raw300.gif` : "")
    return emojiUrl ? { url: emojiUrl, file: emojiId } : null
  }
  return null
}

function dedupeRefs(refs) {
  const list = []
  const index = new Map()
  for (const ref of refs) {
    const key = ref?.url || ref?.file
    if (!key) continue
    if (index.has(key)) {
      const existing = list[index.get(key)]
      if (!existing.file && ref.file) existing.file = ref.file
      continue
    }
    index.set(key, list.length)
    list.push({ ...ref })
  }
  return list
}

export function collectImageRefs(e) {
  const refs = []
  const segments = Array.isArray(e?.message) ? e.message : []
  for (const seg of segments) {
    const ref = imageRefFromSegment(seg)
    if (ref) refs.push(ref)
  }
  const imgList = Array.isArray(e?.img) ? e.img : typeof e?.img === "string" && e.img ? [e.img] : []
  for (const item of imgList) {
    if (!item) continue
    if (typeof item === "string") refs.push({ url: item, file: "" })
    else {
      const ref = imageRefFromSegment(item)
      if (ref) refs.push(ref)
    }
  }
  return dedupeRefs(refs)
}

export function collectEventImages(e) {
  return [...new Set(collectImageRefs(e).map(ref => ref.url || ref.file).filter(Boolean))]
}

export async function collectStickerSources(e) {
  const refs = collectImageRefs(e)

  if (Array.isArray(e?._aiExtraImageRefs))
    for (const ref of e._aiExtraImageRefs) if (ref && (ref.url || ref.file)) refs.push(ref)
  if (Array.isArray(e?._aiExtraImages))
    for (const item of e._aiExtraImages) if (item) refs.push({ url: String(item), file: "" })
  if (typeof e?.getReply === "function") {
    try {
      const quoted = await e.getReply()
      if (quoted) refs.push(...collectImageRefs(quoted))
    } catch {}
  }
  return dedupeRefs(refs)
}

async function refreshSourceFromBot(e, ref) {
  const file = String(ref?.file || "").trim()
  const bot = e?.bot
  if (!file || !bot || typeof bot.sendApi !== "function") return ""

  let timer
  try {
    const info = await Promise.race([
      bot.sendApi("get_image", { file }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("刷新图片链接超时")), REFRESH_TIMEOUT)
        timer.unref?.()
      }),
    ])
    const fresh = sanitizeImageSource(info?.url || info?.file || "")
    return /^https?:\/\//i.test(fresh) ? fresh : ""
  } catch {
    return ""
  } finally {
    clearTimeout(timer)
  }
}

export async function loadStickerSource(ref, e) {
  const url = String(ref?.url || "").trim()
  const file = String(ref?.file || "").trim()

  let last = { buffer: null, error: "没有可用的图片地址" }
  for (const candidate of [url, file]) {
    if (!candidate) continue
    const direct = await fetchImageBuffer(candidate)
    if (direct.buffer) return direct
    last = direct
  }
  const fresh = await refreshSourceFromBot(e, ref)
  if (fresh && fresh !== url) {
    const retried = await fetchImageBuffer(fresh)
    if (retried.buffer) return retried
    last = retried
  }
  return last
}

async function describeWithVision(buffer, client) {
  if (!client) return null
  const mime = mimeOfBuffer(buffer)
  if (!mime) return null
  const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`
  try {
    const result = await client.chat(
      [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "看这张表情包，用一句中文说明它的含义和适合发送的场景，给出一个最贴切的情绪分类（如 开心/悲伤/生气/无语/尴尬/鼓励/疑惑/害羞），再给 2-4 个方便日后检索的关键词。格式：含义 | 分类 | 说明 | 关键词1,关键词2",
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      { maxTokens: 200, temperature: 0.2, timeout: VISION_TIMEOUT },
    )
    const text = String(result?.content || "").trim()
    if (!text) return null
    const parts = text.split("|").map(part => part.trim())

    const stripLabel = value => String(value || "").replace(/^[\s*#]*(?:含义|分类|说明|场景|关键词|标签)[\s*]*[:：]\s*/, "").trim()

    const isPlaceholder = value => /^(?:含义|分类|说明|场景|关键词|标签)\d*$/.test(String(value || "").trim())
    const meaning = stripLabel(parts[0])
    const category = stripLabel(parts[1])
    const description = stripLabel(parts[2])
    const tags = stripLabel(parts[3])
      .split(/[,，、;；\s]+/)
      .map(tag => stripLabel(tag).replace(/^#+/, "").trim())
      .filter(tag => tag && !isPlaceholder(tag))
    if (isPlaceholder(meaning) || isPlaceholder(description) || isPlaceholder(category))
      return { meaning: "", category: "", description: "", tags }
    return {
      meaning,
      category,
      description: description || text,
      tags,
    }
  } catch {
    return null
  }
}

const collectHistory = new Map()

export async function autoCollectSticker(e, cfg, deps = {}) {
  if (!cfg || cfg.enabled === false || cfg.autoSave === false) return false
  const chance = Math.max(0, Math.min(100, Number(cfg.autoCollectChance) || 0))
  if (chance <= 0) return false
  const segments = Array.isArray(e?.message) ? e.message : []
  const stickerSeg = segments.find(seg => {
    const type = seg?.type || seg?.data?.type
    const data = seg?.data || {}
    if (type === "mface" || type === "marketface") return true
    if (type !== "image") return false
    if (Number(data.sub_type ?? seg.sub_type) === 1) return true

    return /动画表情|表情包/.test(String(data.summary || seg.summary || ""))
  })
  if (!stickerSeg) return false

  const key = e?.group_id ? `g:${e.self_id}.${e.group_id}` : `u:${e.self_id}.${e.user_id}`
  const now = Date.now()
  const gap = Math.max(0, Number(cfg.autoCollectIntervalMinutes) || 0) * 60000
  const last = collectHistory.get(key) || 0
  if (gap > 0 && now - last < gap) return false
  collectHistory.set(key, now)

  if (Math.random() * 100 >= chance) return false

  const ref = imageRefFromSegment(stickerSeg)
  if (!ref) return false
  const loaded = await loadStickerSource(ref, e)
  if (!loaded.buffer) return false

  const preset = deps.preset || null

  let meaning = "待命名"
  let category = "其他"
  let description = ""
  let tags = []
  if (deps.describe) {
    try {
      const described = await deps.describe(loaded.buffer)
      if (described?.meaning) meaning = described.meaning
      if (described?.category) category = described.category
      if (described?.description) description = described.description
      if (Array.isArray(described?.tags)) tags = described.tags
    } catch {}
  }
  try {
    const result = stickerStore.add(loaded.buffer, {
      meaning,
      category,
      description,
      tags,
      mimeType: mimeOfBuffer(loaded.buffer),
      source: "auto",
      senderName: e?.sender?.card || e?.sender?.nickname || "",
      groupId: e?.group_id ? String(e.group_id) : "",
      presetId: preset?.id || "",
      presetName: preset?.name || "",
      requireReview: cfg.requireReview === true,
      reviewTimeoutMs: (Number(cfg.reviewTimeoutHours) || 24) * 3600 * 1000,
    })

    return !!result?.entry && result.duplicate !== true
  } catch {
    return false
  }
}

export function registerStickerTools(deps = {}) {
  const getClient = deps.getClient || (() => null)
  const enabled = deps.enabled || (() => true)
  const getConfig = deps.getConfig || (() => ({ enabled: true }))
  const config = () => getConfig() || {}
  const currentPreset = e => e?.__preset || deps.getPreset?.(e) || null

  const disabled = new Set((AIToolRegistry.builtinDisabledTools || []).map(String))
  const registerRawTool = toolDef => {
    if (disabled.has(String(toolDef?.name || ""))) return
    AIToolRegistry.sources.delete(String(toolDef?.name || ""))
    return AIToolRegistry.registerRawTool(toolDef)
  }

  registerRawTool({
    name: "sticker_save",
    description: [
      "【保存表情包】把一张表情存进表情库，供以后按含义发送。",
      "参数: meaning(这张表情的含义，必填，会作为文件名), category(分类，如 开心/悲伤/无语/生气，必填), description(补充说明，可选), tags(标签数组，可选；本预设设置了角色标签时会自动补上，也可自己写「今汐、开心」这种), imageIndex(用消息里第几张图，从 1 开始，可选，默认 1), imageUrl(图片地址，可选), imageBase64(base64 图片数据，可选)",
      "消息带多张图时要逐张保存，用 imageIndex 指定第几张（1、2、3…），不要重复保存同一张。",
      "QQ 表情/动画表情也是图片，直接保存当前消息里的那张即可，不用传 imageUrl；引用消息里的表情也能保存。",
      "只有补充外部图片时才传 imageUrl，必须是纯 http(s) 链接，不要带 [CQ:image,...] 包装或 &amp; 转义。",
      "调用前应确认自己确实看清或读懂了这张图；看不清就先问用户，不要瞎猜含义。",
    ].join("\n"),
    pluginName: "表情包",
    permission: "all",
    danger: "medium",
    parameters: {
      type: "object",
      properties: {
        meaning: { type: "string", description: "表情的含义，会作为文件名" },
        category: { type: "string", description: "分类，如 开心/悲伤/无语/生气/鼓励" },
        description: { type: "string", description: "更详细的说明" },
        tags: { type: "array", items: { type: "string" }, description: "标签" },
        imageIndex: { type: "integer", description: "用消息里的第几张图，从 1 开始，默认 1" },
        imageUrl: { type: "string", description: "图片地址，纯 http 链接；省略则用于当前消息或引用消息里的图片" },
        imageBase64: { type: "string", description: "base64 图片数据（不带前缀）" },
      },
      required: ["meaning", "category"],
    },
    handler: async (args = {}, e) => {
      if (enabled() === false) return { success: false, error: "表情包功能已关闭" }
      const preset = currentPreset(e)
      const cfg = config()
      if (!stickerStore.canUpload(preset, cfg)) {
        return {
          success: false,
          error:
            cfg.uploadMode === "whitelist"
              ? `当前预设「${preset?.name || "未知"}」不在允许上传表情的白名单里`
              : `当前预设「${preset?.name || "未知"}」被禁止上传表情`,
        }
      }
      let buffer = null
      let loadError = ""
      if (args.imageBase64) {
        buffer = Buffer.from(String(args.imageBase64), "base64")
        if (!buffer.length) buffer = null
      }
      if (!buffer && args.imageUrl) {
        const result = await fetchImageBuffer(args.imageUrl)
        buffer = result.buffer
        loadError = result.error || ""
      }
      if (!buffer) {
        const sources = await collectStickerSources(e)
        const index = Math.max(1, Number(args.imageIndex) || 1) - 1
        const target = sources[index]
        if (target) {
          const result = await loadStickerSource(target, e)
          buffer = result.buffer
          if (!buffer && !loadError) loadError = result.error || ""
        } else if (sources.length) {
          return {
            success: false,
            error: `这条消息只有 ${sources.length} 张图，imageIndex=${index + 1} 超出范围`,
          }
        } else if (loadError) {
          return {
            success: false,
            error: `图片下载失败（${loadError}）。QQ 图片链接会过期，请让用户把表情重新发一次`,
          }
        } else {
          return {
            success: false,
            error: "这条消息里没有图片可保存。QQ 表情请直接发送或引用后再保存；外部图片请给纯 http 链接",
          }
        }
      }
      if (!buffer) return { success: false, error: `图片下载失败（${loadError || "无法识别的图片"}），请让用户重新发一次` }

      const roleTags = preset?.stickersOwnOnly ? preset?.stickerTags || [] : []
      const inputTags = Array.isArray(args.tags) ? args.tags : []
      const mergedTags = [...new Set([...roleTags, ...inputTags].map(tag => String(tag).trim()).filter(Boolean))]

      const { entry, duplicate } = await stickerStore.add(buffer, {
        meaning: args.meaning,
        category: args.category,
        description: args.description,
        tags: mergedTags,
        mimeType: mimeOfBuffer(buffer),
        source: e?.isGroup ? "group" : "chat",
        senderName: e?.sender?.card || e?.sender?.nickname || "",
        groupId: e?.group_id ? String(e.group_id) : "",
        presetId: preset?.id || "",
        presetName: preset?.name || "",
        requireReview: cfg.requireReview === true,
        reviewTimeoutMs: (Number(cfg.reviewTimeoutHours) || 24) * 3600 * 1000,
      })
      if (entry?.pending) {
        const hours = Number(cfg.reviewTimeoutHours) || 24
        return {
          success: true,
          pending: true,
          sticker: { id: entry.id, meaning: entry.meaning, category: entry.category },
          message: `已提交审核，等待主人放行；${hours} 小时内未处理会自动通过`,
          note: "审核通过前这张表情还不能发送。",
        }
      }
      return {
        success: true,
        duplicate,
        sticker: { id: entry.id, meaning: entry.meaning, category: entry.category },
        message: duplicate ? "这张表情库里已经有啦" : `已保存为「${entry.category}/${entry.meaning}」`,
        note: "以后想发这类表情，可以调用 sticker_send 并传入含义。",
      }
    },
  })

  registerRawTool({
    name: "sticker_send",
    description: [
      "【发表情包】按含义从表情库挑一张发出去。",
      "适用场景：想表达情绪、接梗、缓和气氛，或用户要求发某类表情。",
      "参数: meaning(想要表达的含义，如 开心/无语/点赞，可选), category(限定分类，可选)",
      "发不发、发哪张由你判断：读气氛觉得合适就发，不必每次都用。",
      "被拒绝时不要再重试，直接用文字回，也不要把失败原因说给用户。",
    ].join("\n"),
    pluginName: "表情包",
    permission: "all",
    danger: "low",
    parameters: {
      type: "object",
      properties: {
        meaning: { type: "string", description: "想表达的含义" },
        category: { type: "string", description: "限定分类" },
      },
      required: [],
    },
    handler: async (args = {}, e) => {
      if (enabled() === false) return { success: false, error: "表情包功能已关闭" }
      const preset = currentPreset(e)
      const cfg = config()

      const userText = String(e?.msg || e?.raw_message || "")
      const gate = checkSendGate(e?.isGroup ? `g:${e.self_id}.${e.group_id}` : `u:${e.self_id}.${e.user_id}`, cfg)
      if (!gate.ok) {
        globalThis.Bot?.makeLog?.("debug", ["表情发送被门控拦下", gate.reason, userText.slice(0, 40)], "表情包")
        return { success: false, error: "这次先不发表情，用文字回就好；不要提这个限制，也不要重试。" }
      }
      const scope = {
        presetId: preset?.id || "",
        ownOnly: preset?.stickersOwnOnly === true,
        tags: preset?.stickerTags || [],
      }

      const entry = stickerStore.pickByMeaning(args.meaning, { category: args.category, ...scope })
      if (!entry) {
        const available = stickerStore
          .list(scope)
          .slice(0, 30)
          .map(item => item.meaning)
          .join("、")
        return {
          success: false,
          error: preset?.stickersOwnOnly
            ? `当前人格只允许发送自己上传的表情，没有匹配「${args.meaning || ""}」的${available ? `；可用：${available}` : "，而且库里还是空的"}`
            : `表情库里没有匹配「${args.meaning || ""}」的表情${available ? `；可用：${available}` : "，库里还是空的"}`,
        }
      }
      const abs = stickerStore.absPath(entry)
      if (!fs.existsSync(abs)) return { success: false, error: "表情文件已丢失" }
      stickerStore.markUsed(entry.id)
      if (typeof e?.reply !== "function")
        return { success: false, error: "当前会话无法发表情，用文字回就好；不要告诉用户原因，也不要重试。" }
      try {
        const imageSegment = globalThis.segment?.image?.(abs) ?? abs
        const sent = await e.reply(imageSegment)

        const errors = Array.isArray(sent?.error) ? sent.error.filter(Boolean) : []
        if (errors.length) throw new Error(errors[0]?.message || String(errors[0]))
        commitSend(gate.key, gate.state, gate.now)
      } catch (err) {
        return { success: false, error: `发送失败: ${err.message}` }
      }
      return {
        success: true,
        sticker: { id: entry.id, meaning: entry.meaning, category: entry.category },
        message: `已发送「${entry.category}/${entry.meaning}」`,
      }
    },
  })

  registerRawTool({
    name: "sticker_search",
    description: [
      "【查找表情包】看看表情库里有哪些表情可用。",
      "参数: query(关键词，可选), category(分类，可选), limit(返回条数，默认10)",
      "只返回含义与分类，不返回图片；要发出去请用 sticker_send。",
    ].join("\n"),
    pluginName: "表情包",
    permission: "all",
    danger: "low",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "关键词" },
        category: { type: "string", description: "分类" },
        limit: { type: "integer", description: "返回条数，默认10" },
      },
      required: [],
    },
    handler: async (args = {}, e) => {
      if (enabled() === false) return { success: false, error: "表情包功能已关闭" }
      const preset = currentPreset(e)
      const rows = stickerStore.list({
        query: args.query,
        category: args.category,
        limit: Math.min(30, Math.max(1, Number(args.limit) || 10)),
        presetId: preset?.id || "",
        ownOnly: preset?.stickersOwnOnly === true,
        tags: preset?.stickerTags || [],
      })
      const stats = stickerStore.stats({
        presetId: preset?.id || "",
        ownOnly: preset?.stickersOwnOnly === true,
        tags: preset?.stickerTags || [],
      })
      return {
        success: true,
        total: stats.total,
        categories: stats.byCategory.map(item => `${item.name}(${item.count})`).join("、"),
        stickers: rows.map(entry => ({
          meaning: entry.meaning,
          category: entry.category,
          description: entry.description,
          usedCount: entry.usedCount,
        })),
        ...(rows.length ? {} : { message: "没有匹配的表情" }),
      }
    },
  })

  registerRawTool({
    name: "sticker_describe",
    description: [
      "【单独识图】当你看不到当前消息里的图片时，用它单独调用视觉模型识别一张图，返回含义与分类。",
      "只在你自己看不了图时才用；能直接看见图片就别调用，那等于把同一张图再看一遍。",
      "参数: imageUrl(图片地址，可选，默认取当前消息或引用消息的图片), imageBase64(可选)",
      "QQ 表情/动画表情直接识图即可，不用传地址；外部图片只传纯 http 链接。",
      "如果仍返回失败，就让用户直接给出含义。",
    ].join("\n"),
    pluginName: "表情包",
    permission: "all",
    danger: "low",
    parameters: {
      type: "object",
      properties: {
        imageUrl: { type: "string", description: "图片地址" },
        imageBase64: { type: "string", description: "base64 图片数据" },
      },
      required: [],
    },
    handler: async (args = {}, e) => {
      if (enabled() === false) return { success: false, error: "表情包功能已关闭" }
      let buffer = null
      let loadError = ""
      if (args.imageBase64) buffer = Buffer.from(String(args.imageBase64), "base64")
      if (!buffer && args.imageUrl) {
        const result = await fetchImageBuffer(args.imageUrl)
        buffer = result.buffer
        loadError = result.error || ""
      }
      if (!buffer) {
        const refs = (await collectStickerSources(e)).slice(0, 3)
        const results = await Promise.all(refs.map(ref => loadStickerSource(ref, e)))
        const hit = results.find(result => result.buffer)
        if (hit) buffer = hit.buffer
        else loadError = loadError || results.map(result => result.error).find(Boolean) || ""
      }
      if (!buffer)
        return {
          success: false,
          error: loadError ? `图片下载失败（${loadError}），请让用户重新发一次` : "没有找到可识别的图片",
        }
      const described = await describeWithVision(buffer, getClient())
      if (!described) return { success: false, error: "当前模型无法识图，请让用户说明这张表情的含义" }
      return {
        success: true,
        meaning: described.meaning,
        category: described.category,
        description: described.description,
        note: "确认无误后可直接用 sticker_save 保存。",
      }
    },
  })
}

export { STICKER_DIR, describeWithVision, loadImageBuffer, mimeOfBuffer, DEFAULT_CATEGORIES, IMAGE_EXT }
