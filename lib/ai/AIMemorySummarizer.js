/**
 * 记忆摘要压缩 — 把同一作用域下的多条相近记忆合并成一条更概括的记忆。
 *
 * 为什么要它：衰减只降低排序权重、不减少条数。同一个事实被反复记下时，
 * 库里会堆积「常用的服务器是阿里云」「用户常用服务器为阿里云」这类重复条目，
 * 注入和检索都会变慢。这里按 作用域+分类 分桶，桶内条目够多时交给模型合并，
 * 整桶替换成更少的条目。
 *
 * 最重要的原则是「宁可不动，也不要污染」：
 * 模型返回空、解析为空、结果与原文一致、合并后条数反而变多——一律放弃并保留原条目。
 */
/** 桶内至少要这么多条才值得合并 */
export const BUCKET_MIN_ITEMS = 3
/** 合并后条数必须少于原来的这个比例，否则视为没整理出东西 */
const SHRINK_RATIO = 0.9
const SUMMARY_TIMEOUT = 60000
const MAX_BUCKET_ITEMS = 40

/** 记忆分类：决定哪些条目会被放进同一个桶 */
const KIND_LABEL = { episode: "经历", fact: "事实" }
const SCOPE_LABEL = scope => {
  if (!scope) return "未知"
  if (scope === "global") return "通用"
  if (scope.startsWith("group:")) return `群 ${scope.slice(6)}`
  if (scope.startsWith("user:")) return `用户 ${scope.slice(5)}`
  return scope
}

/**
 * 分桶：同一个作用域 + 同一种类型 + 共享至少一个标签（或都没有标签）才算一类。
 * 只按作用域分桶会把「群规」和「某人喜好」混在一起，合并出来就失去意义了。
 */
export function buildBuckets(entries) {
  const buckets = new Map()
  for (const entry of entries) {
    if (!entry || entry.validTo) continue
    // 固定条目是主人明确要求保留的，不参与合并
    if (entry.pinned) continue
    const tags = (entry.tags || []).map(tag => String(tag).trim()).filter(Boolean).sort()
    const key = `${entry.scope}|${entry.kind}|${tags[0] || "_"}|${tags[1] || ""}`
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(entry)
  }
  // 只保留够大的桶
  return [...buckets.entries()]
    .filter(([, items]) => items.length >= BUCKET_MIN_ITEMS)
    .map(([key, items]) => ({ key, items: items.slice(0, MAX_BUCKET_ITEMS) }))
}

/** 供提示词使用的条目清单 */
function renderEntries(items) {
  return items
    .map((entry, index) => {
      const body = String(entry.content || entry.title || "").replace(/\s+/g, " ").trim()
      return `${index + 1}. ${body.slice(0, 300)}`
    })
    .join("\n")
}

/** 合并提示词：要求条数减少、信息不丢、不编造 */
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

/** 从模型输出里取 JSON 数组，容忍 ```json 包裹与前后废话 */
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
    // 模型偶尔会把序号或引号带回来
    const normalized = clean.replace(/^\d+[.、)]\s*/, "").replace(/^["“]|["”]$/g, "").trim()
    // 只要非空就收下：长度是否合格交给记忆存储自己的规则判断
    if (!normalized) continue
    if (out.some(existing => existing === normalized)) continue
    out.push(normalized)
  }
  return out
}

/**
 * 判断这次摘要结果该不该采用。
 * 返回 { ok, reason } —— ok=false 时调用方必须原样保留记忆。
 */
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
  // 合并结果与原文逐条一致，等价于没整理
  if (summarized.every(text => originals.has(text)))
    return { ok: false, reason: "结果与原记忆逐条相同" }
  // 合并后总长度暴涨说明它在编故事；原文本身很短时不判这一条，否则会把正常合并也拦掉
  const originalLength = [...originals].join("").length
  const summaryLength = summarized.join("").length
  if (originalLength >= 40 && summaryLength > originalLength * 1.5)
    return { ok: false, reason: "合并后内容反而变长，疑似编造" }
  return { ok: true }
}

/** 调模型做一次合并；失败返回 null 而不是抛错 */
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

/**
 * 对一批记忆做压缩。
 * @param {Object} options
 * @param {Array}  options.entries      候选记忆（通常是某个作用域的全部）
 * @param {Function} options.getClient  取当前 AI 客户端
 * @param {Function} options.store      AIMemoryStore 实例
 * @param {boolean} options.dryRun      只分析不写入
 * @param {number} options.maxBuckets   本次最多处理几个桶
 * @returns {Promise<Object>} 结果汇总
 */
export async function compressMemories({ entries = [], getClient, store, dryRun = false, maxBuckets = 5 } = {}) {
  if (!store) return { ok: false, error: "缺少记忆存储" }
  const buckets = buildBuckets(entries).slice(0, Math.max(1, maxBuckets))
  const results = []
  let replaced = 0
  // 旧条目只是标记失效留档，不物理删除，所以叫 archived 而不是 removed
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

    // 合并后沿用第一条的元信息（作用域、来源、人格），避免串味
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
        // 人格归属要一并带过去，否则压缩后全变成「公共记忆」
        ...(template.presetId ? { presetId: template.presetId, presetName: template.presetName || "" } : {}),
      })
      if (added?.success) createdEntries.push(added.entry)
    }
    // 新条目一条都没建起来时，绝不能动旧的
    if (!createdEntries.length) {
      results.push({ key: bucket.key, ok: false, reason: "新记忆写入失败，已保留原条目", kept: before.length })
      continue
    }
    // 旧条目留档不删除：标记为「已被新记忆取代」，仍可回查，但不再注入上下文
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
