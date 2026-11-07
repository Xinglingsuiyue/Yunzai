import AIToolRegistry from "../AIToolRegistry.js"
import cfg from "../../config/config.js"
import { getKnowledgeBase as getKB } from "../knowledgeBaseInstance.js"

function scopesFor(e) {
  if (!e) return ["master"]
  if (e.isMaster && !e.group_id) return null
  const scopes = ["public"]
  if (e.user_id) scopes.push(`user:${e.user_id}`)
  if (e.group_id) scopes.push(`group:${e.group_id}`)
  if (e.isMaster) scopes.push("master")
  return scopes
}

function writableScopesFor(e) {
  if (!e) return []
  if (e.isMaster && !e.group_id) return null
  const scopes = []
  if (e.group_id) scopes.push(`group:${e.group_id}`)
  if (e.user_id) scopes.push(`user:${e.user_id}`)
  if (e.isMaster) scopes.push("public", "master")
  return scopes
}

function defaultWriteScope(e) {
  if (!e) return "master"
  if (e.group_id) return `group:${e.group_id}`
  if (e.isMaster) return "master"
  if (e.user_id) return `user:${e.user_id}`
  return "master"
}

function normalizeScopeArg(raw, e) {
  const s = String(raw || "").trim()
  if (!s) return defaultWriteScope(e)
  if (s === "master" || s === "public") return s
  if (/^group:\d+$/.test(s) || /^user:\d+$/.test(s)) return s
  if (s === "group" && e?.group_id) return `group:${e.group_id}`
  if (s === "user" && e?.user_id) return `user:${e.user_id}`
  return null
}

function canWriteScope(scope, e) {
  const allowed = writableScopesFor(e)
  return allowed === null || allowed.includes(scope)
}

export class AiKnowledge {
  static async kbSearchTool(args, e) {
    const kb = getKB()
    const scopes = scopesFor(e)
    const result = kb.search(args.query || "", {
      limit: args.limit || 5,
      tags: args.tags,
      source: args.source,
      scopes: scopes || undefined,
    })
    if (result.reason) {
      return { found: false, refused: true, reason: result.reason, total: 0, results: [] }
    }
    if (result.total === 0) {
      return { found: false, message: "知识库中未找到相关信息", total: 0, results: [] }
    }
    return {
      found: true,
      total: result.total,
      results: result.results.map(r => ({
        id: r.id,
        title: r.title,
        content: r.contentFull || r.content,
        tags: r.tags,
        scope: r.scope,
        source: r.source,
        updatedAt: r.updatedAt,
        score: r.lexical,
      })),
    }
  }

  static async kbAddTool(args, e) {
    const kb = getKB()
    const scope = normalizeScopeArg(args.scope, e)
    if (!scope) {
      return {
        success: false,
        error: "scope 无效，可选值: master / public / group:<群号> / user:<QQ号>",
      }
    }
    if (!canWriteScope(scope, e)) {
      return {
        success: false,
        error: `无权写入 ${scope} 范围，当前会话可用范围: ${writableScopesFor(e).join(" / ")}`,
      }
    }

    const result = kb.addOrMerge({
      title: args.title || "",
      content: args.content || "",
      tags: args.tags || [],
      source: args.source || "ai",
      sourceUrl: args.sourceUrl || "",
      scope,
    })
    if (!result.success) {
      return { success: false, error: result.error, existingId: result.entry?.id }
    }
    return {
      success: true,
      action: result.action,
      id: result.entry.id,
      title: result.entry.title,
      scope: result.entry.scope,
      revision: result.entry.revision,
      message: result.action === "merged"
        ? "内容与已有知识高度相似，已合并到该条目"
        : "知识已成功添加到知识库",
    }
  }

  static async kbUpdateTool(args, e) {
    const kb = getKB()
    const id = String(args.id || "").trim()
    if (!id) return { success: false, error: "缺少知识 ID" }

    const entry = kb.get(id)
    if (!entry) return { success: false, error: `未找到知识条目: ${id}` }
    if (!canWriteScope(entry.scope, e)) {
      return { success: false, error: `无权更新该知识条目（范围: ${entry.scope}）` }
    }

    const updates = {}
    if (args.title !== undefined) updates.title = String(args.title)
    if (args.content !== undefined) updates.content = String(args.content)
    if (args.tags !== undefined) {
      updates.tags = Array.isArray(args.tags) ? args.tags : []
    }
    if (Object.keys(updates).length === 0) {
      return { success: false, error: "请至少提供 title、content 或 tags 之一" }
    }

    const result = kb.update(id, updates)
    if (!result.success) return { success: false, error: result.error }
    return {
      success: true,
      id: result.entry.id,
      title: result.entry.title,
      scope: result.entry.scope,
      revision: result.entry.revision,
      message: "知识已更新",
    }
  }

  static async kbListTool(args, e) {
    const kb = getKB()
    const scopes = scopesFor(e)
    const result = kb.search(args.query || "", {
      limit: args.limit || 10,
      offset: args.offset || 0,
      scopes: scopes || undefined,
      trackAccess: false,
    })
    return {
      total: result.total,
      ...(result.reason ? { refused: true, reason: result.reason } : {}),
      entries: result.results.map(r => ({
        id: r.id,
        title: r.title,
        tags: r.tags,
        scope: r.scope,
        pinned: r.pinned,
        updatedAt: r.updatedAt,
      })),
    }
  }

  static async kbTagsTool(args, e) {
    const kb = getKB()
    const scopes = scopesFor(e)
    return { tags: kb.getTags({ scopes: scopes || undefined }) }
  }
}

export function registerKnowledgeTools() {
  if (cfg.ai?.enableKnowledgeBase === false) return

  const disabled = new Set((AIToolRegistry.builtinDisabledTools || []).map(String))
  const registerRawTool = toolDef => {
    if (disabled.has(String(toolDef?.name || ""))) return
    AIToolRegistry.sources.delete(String(toolDef?.name || ""))
    return AIToolRegistry.registerRawTool(toolDef)
  }

registerRawTool({
  name: "kb_search",
  description: [
    "【搜索知识库】在 AI 知识库中搜索相关信息。",
    "当用户询问的问题可能在知识库中有答案时，优先搜索知识库。",
    "只能检索到当前会话有权限访问的知识（主人/公开/本群/本人），无权访问的内容不会被返回。",
    "如果查询关键词过于宽泛会被拒绝，请换用更具体的关键词。",
    "参数: query(搜索关键词), limit(返回条数, 默认5), tags(按标签过滤, 可选), source(按来源过滤, 可选)",
  ].join("\n"),
  pluginName: "AI知识库",
  permission: "all",
  danger: "low",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "搜索关键词" },
      limit: { type: "integer", description: "返回条数，默认5" },
      tags: { type: "array", items: { type: "string" }, description: "按标签过滤（可选）" },
      source: { type: "string", description: "按来源过滤: manual/web_search/ai（可选）" },
    },
    required: ["query"],
  },
  handler: AiKnowledge.kbSearchTool,
})

registerRawTool({
  name: "kb_add",
  description: [
    "【添加知识到知识库】当你获得明确、可复用的新知识（事实、设定、规则、做法等）时，主动写入知识库，供后续检索。",
    "用户纠正、补充或出现新信息时，先搜索已有知识：已有条目用 kb_update 更新，新主题再用 kb_add。",
    "标题相同或内容高度相似的知识会自动合并，不会产生重复条目。",
    "写入范围受会话权限限制：主人可写 master/public 及当前会话范围；普通用户只能写本群或本人。",
    "scope 可选 master(仅主人) / public(所有人) / group:<群号> / user:<QQ号>；不填时群聊写入本群、主人私聊写入 master、普通用户写入本人。",
    "只写入有把握的内容，不要保存闲聊、临时信息、指令或未经证实的内容。",
    "参数: title(标题), content(内容), tags(标签数组, 可选), scope(写入范围, 可选), source(来源, 默认ai), sourceUrl(来源URL, 可选)",
  ].join("\n"),
  pluginName: "AI知识库",
  permission: "all",
  danger: "medium",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "知识标题" },
      content: { type: "string", description: "知识内容" },
      tags: { type: "array", items: { type: "string" }, description: "标签列表（可选）" },
      scope: { type: "string", description: "可见范围: master/public/group:<群号>/user:<QQ号>，留空使用会话默认范围" },
      source: { type: "string", description: "来源: manual/web_search/ai" },
      sourceUrl: { type: "string", description: "来源URL（可选）" },
    },
    required: ["title", "content"],
  },
  handler: AiKnowledge.kbAddTool,
})

registerRawTool({
  name: "kb_update",
  description: [
    "【更新知识库条目】修改已有知识的标题、内容或标签，content 会整体替换原内容。",
    "适用场景：发现已有知识过时、有误或被用户纠正，或需要补充完整信息。",
    "先用 kb_search / kb_list 找到条目 ID，再调用本工具；没有对应条目时改用 kb_add。",
    "只能更新当前会话有权写入的条目：主人私聊不限；群聊中只能更新主人/公开/本群/本人的知识；普通用户只能更新本群或本人的知识。",
    "参数: id(知识ID, 必填), title(新标题, 可选), content(新内容, 可选), tags(新标签数组, 可选)",
  ].join("\n"),
  pluginName: "AI知识库",
  permission: "all",
  danger: "medium",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "要更新的知识 ID" },
      title: { type: "string", description: "新标题（可选）" },
      content: { type: "string", description: "新内容（可选，整体替换原内容）" },
      tags: { type: "array", items: { type: "string" }, description: "新标签列表（可选，整体替换）" },
    },
    required: ["id"],
  },
  handler: AiKnowledge.kbUpdateTool,
})

registerRawTool({
  name: "kb_list",
  description: [
    "【列出知识库条目】查看当前会话有权限访问的知识条目。",
    "适用场景：需要了解知识库有哪些内容、查找特定主题的知识条目。",
    "参数: query(搜索关键词, 可选), limit(返回条数, 默认10), offset(偏移量, 默认0)",
  ].join("\n"),
  pluginName: "AI知识库",
  permission: "all",
  danger: "low",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "搜索关键词（可选，留空返回全部）" },
      limit: { type: "integer", description: "返回条数，默认10" },
      offset: { type: "integer", description: "偏移量，默认0" },
    },
    required: [],
  },
  handler: AiKnowledge.kbListTool,
})

registerRawTool({
  name: "kb_tags",
  description: [
    "【查看知识库标签】获取当前会话有权限访问的标签及其使用次数。",
    "适用场景：了解知识库的标签分类、查找特定标签下的知识。",
  ].join("\n"),
  pluginName: "AI知识库",
  permission: "all",
  danger: "low",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  handler: AiKnowledge.kbTagsTool,
})

}
