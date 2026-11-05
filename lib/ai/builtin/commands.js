/**
 * AI 会话管理命令 — 结束对话、查看状态、记忆与群聊总结。
 *
 * 作为框架核心内置模块加载；命令本身不注册成 AI 工具（aiTool: false），
 * 避免模型自己触发「清空记忆」这类破坏性操作。
 */
import plugin from "../../plugins/plugin.js"
import cfg from "../../config/config.js"
import AIManager from "../AIManager.js"
import { aiAdmin } from "../AIAdminStore.js"
import { stickerStore } from "./sticker.js"

function conversationOf(e) {
  return AIManager._conversationIdOf(e)
}

function fmtTime(timestamp) {
  if (!timestamp) return "无"
  const date = new Date(timestamp)
  const pad = n => String(n).padStart(2, "0")
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export class AiSessionCommands extends plugin {
  constructor() {
    super({
      name: "AI会话管理",
      dsc: "结束对话、查看对话状态、管理个人记忆、总结群聊",
      event: "message",
      priority: 40,
      aiTool: false,
      rule: [
        { reg: "^#结束对话$", fnc: "endChat" },
        { reg: "^#对话状态$", fnc: "chatStatus" },
        { reg: "^#我的记忆$", fnc: "myMemories" },
        { reg: "^#清除记忆$", fnc: "clearMemory" },
        { reg: "^#群聊总结$", fnc: "summarizeGroup" },
        { reg: "^#群AI状态$", fnc: "groupAiStatus" },
        { reg: "^#表情库(?:\\s+(.+))?$", fnc: "stickerStats" },
      ],
    })
  }

  async endChat(e) {
    this.e = e
    const conversationId = conversationOf(e)
    const had = AIManager.sessions.has(conversationId)
    AIManager.deleteSession(conversationId)
    return this.reply(had ? "已结束当前对话，上下文清空。" : "当前没有正在进行的对话。", true)
  }

  async chatStatus(e) {
    this.e = e
    const conversationId = conversationOf(e)
    const session = AIManager.sessions.get(conversationId)
    const preset = AIManager._resolvePreset(e)
    const lines = [
      `会话：${conversationId}`,
      `人格：${preset?.name || "默认"}`,
      `模型：${AIManager.defaultClient?.model || "未配置"}`,
      `渠道：${AIManager.defaultClient?.channelName || "未配置"}`,
    ]
    if (session) {
      const last = session.messages?.[session.messages.length - 1]
      lines.push(
        `消息数：${session.messages?.length || 0}`,
        `已压缩：${session._compressed ? "是" : "否"}`,
        `最近发言：${fmtTime(last?.time)}`,
      )
      if (Number.isFinite(session.maxContextTokens))
        lines.push(`上下文上限：${session.maxContextTokens} tokens`)
    } else {
      lines.push("状态：尚未开始对话")
    }
    return this.reply(lines.join("\n"), true)
  }

  async myMemories(e) {
    this.e = e
    if (aiAdmin.memoryConfig.enabled === false) return this.reply("记忆功能已关闭。", true)
    const result = AIManager.memoryStore.list({ pageSize: 200 })
    const visible = result.results
      .filter(entry =>
        AIManager.memoryStore.isVisible(entry, { groupId: e.group_id, userId: e.user_id }),
      )
      .slice(0, 8)
    if (!visible.length) return this.reply("还没有保存关于你的回忆。", true)
    const lines = [`关于你的回忆（共 ${visible.length} 条）：`]
    for (const entry of visible) {
      const text = String(entry.content || entry.event || entry.title || "").slice(0, 60)
      lines.push(`· ${text}`)
    }
    return this.reply(lines.join("\n"), true)
  }

  async clearMemory(e) {
    this.e = e
    if (aiAdmin.memoryConfig.enabled === false) return this.reply("记忆功能已关闭。", true)
    const scope = e.isGroup ? `group:${e.group_id}` : `user:${e.user_id}`
    const result = AIManager.memoryStore.list({ pageSize: 500 })
    let count = 0
    for (const entry of result.results) {
      if (String(entry.scope || "") !== scope) continue
      if (AIManager.memoryStore.remove(entry.id)) count++
    }
    return this.reply(count ? `已清除 ${count} 条本会话相关记忆。` : "没有可清除的记忆。", true)
  }

  async summarizeGroup(e) {
    this.e = e
    if (!e.isGroup) return this.reply("群聊总结只能在群里用。", true)
    if (cfg?.ai?.enabled !== true || !AIManager.defaultClient)
      return this.reply("AI 未启用，无法总结。", true)

    const session = AIManager.sessions.get(conversationOf(e))
    const messages = (session?.messages || []).slice(-40)
    if (messages.length < 4) return this.reply("最近聊天记录太少，没法总结。", true)

    const transcript = messages
      .map(message => `${message.role === "user" ? "群友" : "我"}: ${String(message.content).slice(0, 200)}`)
      .join("\n")
    try {
      // 用一次性请求，不写入任何会话，避免污染总结专用上下文
      const result = await AIManager.defaultClient.chat(
        [
          {
            role: "user",
            content: `请用 3-5 条要点总结下面这段群聊，每行一条，不要客套话：\n${transcript}`,
          },
        ],
        { maxTokens: 500, temperature: 0.3 },
      )
      return this.reply(String(result?.content || "总结失败").slice(0, 1200), true)
    } catch (error) {
      return this.reply(`总结失败：${error.message}`, true)
    }
  }

  async groupAiStatus(e) {
    this.e = e
    if (!e.isGroup) return this.reply("这条命令只能在群里用。", true)
    const group = aiAdmin.getGroup(e.group_id)
    const preset = AIManager._resolvePreset(e)
    const trigger = AIManager.getGroupTrigger(e.group_id)
    const proactive = aiAdmin.proactiveConfig
    const proactiveOn =
      group?.enabled !== false &&
      (group?.proactiveChat === true || (group?.proactiveChat !== false && proactive.enabled))
    const switchLabels = [
      trigger.at ? "@" : "",
      trigger.prefix ? "前缀" : "",
      trigger.keyword ? `关键词${trigger.keywords.length ? `（${trigger.keywords.join("/")}）` : ""}` : "",
      trigger.free ? "自由判断" : "",
    ].filter(Boolean)
    const lines = [
      `本群 AI：${group?.enabled === false ? "已关闭" : "已开启"}`,
      `人格：${preset?.name || "默认"}`,
      `触发方式：${switchLabels.length ? switchLabels.join(" + ") : "不主动回复"}`,
      `主动聊天：${proactiveOn ? "开启" : "关闭"}`,
    ]
    if (group?.disabledTools?.length) lines.push(`禁用工具：${group.disabledTools.length} 个`)
    return this.reply(lines.join("\n"), true)
  }

  async stickerStats(e) {
    this.e = e
    const cfg = aiAdmin.stickerConfig
    if (cfg.enabled === false) return this.reply("表情包功能已关闭。", true)
    const preset = AIManager._resolvePreset(e)
    const stats = stickerStore.stats({
      presetId: preset?.id || "",
      ownOnly: preset?.stickersOwnOnly === true,
      tags: preset?.stickerTags || [],
    })
    const pending = stickerStore.listPending().length
    const categories = stats.byCategory
      .slice(0, 6)
      .map(item => `${item.name}(${item.count})`)
      .join("、")
    const lines = [
      `可用表情：${stats.total} 张`,
      categories ? `分类：${categories}` : "分类：暂无",
    ]
    if (pending) lines.push(`待审核：${pending} 张`)
    return this.reply(lines.join("\n"), true)
  }
}

export default AiSessionCommands
