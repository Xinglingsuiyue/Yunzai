export const BUCKET_MIN_ITEMS = 3

const SHRINK_RATIO = 0.9
const SUMMARY_TIMEOUT = 60000
const MAX_BUCKET_ITEMS = 40

const KIND_LABEL = { episode: "经历", fact: "事实" }
const SCOPE_LABEL = scope => {
  if (!scope) return "未知"
  if (scope === "global") return "通用"
  if (scope.startsWith("group:")) return `群 ${scope.slice(6)}`
  if (scope.startsWith("user:")) return `用户 ${scope.slice(5)}`
  return scope
}

export function buildBuckets(entries) {
  const buckets = new Map()
  for (const entry of entries) {
    if (!entry || entry.validTo) continue

    if (entry.pinned) continue
    const tags = (entry.tags || []).map(tag => String(tag).trim()).filter(Boolean).sort()
    const key = `${entry.scope}|${entry.kind}|${tags[0] || "_"}|${tags[1] || ""}`
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(entry)
  }

  return [...buckets.entries()]
    .filter(([, items]) => items.length >= BUCKET_MIN_ITEMS)
    .map(([key, items]) => ({ key, items: items.slice(0, MAX_BUCKET_ITEMS) }))
}

function renderEntries(items) {
  return items
    .map((entry, index) => {
      const body = String(entry.content || entry.title || "").replace(/\s+/g, " ").trim()
      return `${index + 1}. ${body.slice(0, 300)}`
    })
    .join("\n")
}

export function buildSummaryPrompt(bucket, items) {
  const sample = items[0] || {}
  const kind = KIND_LABEL[sample.kind] || "记忆"
  const scope = SCOPE_LABEL(sample.scope)
  return [
    `你在整理关于「${scope}」的${kind}记忆，把下面 ${items.length} 条合并成更少的条目。`,
    "",
    "规则：",
    `- 合并后条数必须少于 ${items.length} 条；能合成一条就合成一条。`,
    "- 只合并讲同一件事或同一类信息的条目；不相干的内容分开保留。",
    "- 不要丢事实细节：人名、数字、时间、偏好取值都要保留。",
    "- 不要新增原文没有的内容，也不要推测或补充。",
    "- 如果新条目与旧条目重复、矛盾，以最近的说法为准。",
    "- 每条用一句中文写清楚，不超过 60 字。",
    "",
    "原始记忆：",
    renderEntries(items),
    "",
    "只输出 JSON 数组，每项形如 {\"content\":\"合并后的一句话\"}，不要解释、不要 Markdown。",
    "如果这些记忆本来就不该合并，输出 []。",
  ].join("\n")
}

export function parseSummary(text) {
  const raw = String(text || "").trim()
  if (!raw) return []
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : raw
  const start = body.indexOf("[")
  const end = body.lastIndexOf("]")
  if (start < 0 || end <= start) return []
  let data
  try {
    data = JSON.parse(body.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []
  const out = []
  for (const item of data) {
    const content =
      typeof item === "string" ? item : String(item?.content ?? item?.title ?? "").trim()
    const clean = content.replace(/\s+/g, " ").trim()

    const normalized = clean.replace(/^\d+[.、)]\s*/, "").replace(/^["“]|["”]$/g, "").trim()

    if (!normalized) continue
    if (out.some(existing => existing === normalized)) continue
    out.push(normalized)
  }
  return out
}

export function validateSummary(items, summarized) {
  if (!Array.isArray(summarized) || !summarized.length)
    return { ok: false, reason: "模型没有给出可用的合并结果" }
  if (summarized.length >= items.length)
    return { ok: false, reason: `合并后条数没有减少（${items.length} → ${summarized.length}）` }
  if (summarized.length > Math.floor(items.length * SHRINK_RATIO))
    return { ok: false, reason: `合并幅度太小（${items.length} → ${summarized.length}），不值得替换` }
  const originals = new Set(
    items.map(entry => String(entry.content || entry.title || "").replace(/\s+/g, " ").trim()),
  )

  if (summarized.every(text => originals.has(text)))
    return { ok: false, reason: "结果与原记忆逐条相同" }

  const originalLength = [...originals].join("").length
  const summaryLength = summarized.join("").length
  if (originalLength >= 40 && summaryLength > originalLength * 1.5)
    return { ok: false, reason: "合并后内容反而变长，疑似编造" }
  return { ok: true }
}

async function summarizeBucket(client, bucket, items) {
  if (!client) return null
  let timer
  try {
    const result = await Promise.race([
      client.chat([{ role: "user", content: buildSummaryPrompt(bucket, items) }], {
        maxTokens: 800,
        temperature: 0.2,
        timeout: SUMMARY_TIMEOUT,
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("摘要超时")), SUMMARY_TIMEOUT)
        timer.unref?.()
      }),
    ])
    return parseSummary(result?.content)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function compressMemories({ entries = [], getClient, store, dryRun = false, maxBuckets = 5 } = {}) {
  if (!store) return { ok: false, error: "缺少记忆存储" }
  const buckets = buildBuckets(entries).slice(0, Math.max(1, maxBuckets))
  const results = []
  let replaced = 0

  let archived = 0
  let created = 0

  for (const bucket of buckets) {
    const before = bucket.items
    const summarized = await summarizeBucket(getClient?.(), bucket, before)
    if (!summarized) {
      results.push({ key: bucket.key, ok: false, reason: "模型调用失败或超时", kept: before.length })
      continue
    }
    const verdict = validateSummary(before, summarized)
    if (!verdict.ok) {
      results.push({ key: bucket.key, ok: false, reason: verdict.reason, kept: before.length })
      continue
    }
    if (dryRun) {
      results.push({
        key: bucket.key,
        ok: true,
        dryRun: true,
        before: before.length,
        after: summarized.length,
        preview: summarized.slice(0, 3),
      })
      continue
    }

    const template = before[0]
    const createdEntries = []
    for (const content of summarized) {
      const added = store.add({
        content,
        title: content.slice(0, 60),
        scope: template.scope,
        kind: template.kind,
        tags: template.tags || [],
        importance: Math.max(...before.map(entry => Number(entry.importance) || 1)),
        originGroupId: template.originGroupId,
        originChat: template.originChat,

        ...(template.presetId ? { presetId: template.presetId, presetName: template.presetName || "" } : {}),
      })
      if (added?.success) createdEntries.push(added.entry)
    }

    if (!createdEntries.length) {
      results.push({ key: bucket.key, ok: false, reason: "新记忆写入失败，已保留原条目", kept: before.length })
      continue
    }

    const byId = createdEntries[0].id
    for (const entry of before) store.supersede(entry.id, { byId, reason: "被合并整理取代" })
    replaced++
    archived += before.length
    created += createdEntries.length
    results.push({
      key: bucket.key,
      ok: true,
      before: before.length,
      after: createdEntries.length,
      archived: before.map(entry => entry.id),
    })
  }

  return {
    ok: true,
    dryRun,
    buckets: buckets.length,
    replaced,
    archived,
    created,
    results,
  }
}
