import plugin from "../../plugins/plugin.js"
import cfg, { normalizeGroupId } from "../../config/config.js"
import AIManager from "../AIManager.js"
import AIProactiveChat from "../AIProactiveChat.js"
import { aiAdmin } from "../AIAdminStore.js"
import { stickerStore, presetSendTags, generalTagsOf } from "./sticker.js"
import puppeteer from "../../puppeteer/puppeteer.js"
import { fileURLToPath } from "node:url"

const AFFINITY_TPL = fileURLToPath(new URL("./resources/affinity.html", import.meta.url))
const AFFINITY_REACT_CHANCE = 0.3
const SET_AFFINITY_RE = /^\s*#?设置好感度(?:\s+([\s\S]+))?$/

function conversationOf(e) {
  return AIManager._conversationIdOf(e)
}

function fmtTime(timestamp) {
  if (!timestamp) return "无"
  const date = new Date(timestamp)
  const pad = n => String(n).padStart(2, "0")
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function lastFour(value) {
  const id = String(value || "")
  return id.length > 4 ? id.slice(-4) : id
}

function formatAffinity(value) {
  const number = Number(value) || 0
  return Number.isInteger(number * 10) ? number.toFixed(1) : number.toFixed(2)
}

function memberName(member, userId = "") {
  const name = String(member?.card || member?.nickname || member?.nick || member?.name || "").trim()
  return name || `群友${lastFour(userId)}`
}

async function groupMemberMap(e, group) {
  const map = new Map()
  const add = (id, member) => {
    const uid = String(id || member?.user_id || "")
    if (uid) map.set(uid, member)
  }
  if (group) {
    try {
      if (typeof group.getMemberMap === "function") {
        const full = await AIManager._withTimeout(Promise.resolve(group.getMemberMap()), 8000)
        full?.forEach?.((member, id) => add(id, member))
      }
    } catch {}
    if (!map.size) {
      try {
        if (typeof group.getMemberList === "function") {
          const ids = await AIManager._withTimeout(Promise.resolve(group.getMemberList()), 8000)
          for (const id of ids || []) add(id, null)
        }
      } catch {}
    }
  }
  const senderId = String(e?.user_id || e?.sender?.user_id || "")
  if (senderId && !map.has(senderId)) map.set(senderId, e.sender || null)
  return map
}

function plainScore(value) {
  const number = Number(value) || 0
  return Number.isInteger(number) ? String(number) : String(Math.round(number * 100) / 100)
}

function atNameOf(e, target) {
  const targetId = String(target || "")
  for (const seg of AIManager._messageSegments(e).segments) {
    if ((seg?.type || seg?.data?.type) !== "at") continue
    const qq = String(seg.qq ?? seg.data?.qq ?? "")
    if (qq !== targetId) continue
    return String(seg.name || seg.data?.name || "").trim()
  }
  return ""
}

function affinityViewSettings(groupId) {
  const group = groupId ? aiAdmin.getGroup(groupId) : null
  const resolve = (value, fallback) =>
    value === null || value === undefined ? fallback === true : value === true
  return {
    admin: resolve(group?.affinityViewAdmin, cfg.ai?.affinityViewAdmin),
    member: resolve(group?.affinityViewMember, cfg.ai?.affinityViewMember),
  }
}

async function isGroupManager(e) {
  if (e.member?.is_owner || e.member?.is_admin) return true
  const role = String(e.sender?.role || "").toLowerCase()
  if (role === "owner" || role === "admin") return true
  try {
    const group = e.group || e.bot?.pickGroup?.(e.group_id)
    const member = group?.pickMember?.(e.user_id)
    const info = await AIManager._withTimeout(Promise.resolve(member?.getInfo?.()), 5000)
    return !!(info?.is_owner || info?.is_admin)
  } catch {
    return false
  }
}

async function canViewAffinity(e) {
  if (e.isMaster) return true
  const settings = affinityViewSettings(e.group_id)
  if (settings.member) return true
  if (!settings.admin) return false
  return isGroupManager(e)
}

function affinityDirection(before, after) {
  return after > before ? "提高" : after < before ? "降低" : "没有变化"
}

function injectAffinityNotice(e, text) {
  if (cfg.ai?.enabled !== true || !AIManager.defaultClient) return null
  const conversationId = AIManager._conversationIdOf(e)
  const session = AIManager.getSession(conversationId, { e })
  session.messages = (session.messages || []).filter(
    message => !(message.role === "system" && String(message.content || "").startsWith("[关系调整]")),
  )
  session.addSystemMessage(text)
  AIManager._persistSession(conversationId, session, e)
  return conversationId
}

async function maybeReactToAffinityChange(e, targetName, direction) {
  if (Math.random() >= AFFINITY_REACT_CHANCE) return
  if (cfg.ai?.enabled !== true || !AIManager.defaultClient) return
  const group = aiAdmin.getGroup(e.group_id)
  if (group?.enabled === false) return
  if ((group?.disabledBots || []).some(id => String(id) === String(e.self_id || ""))) return
  const conversationId = AIManager._conversationIdOf(e)
  const prompt = [
    `[系统] 主人刚刚把你对「${targetName}」的好感度${direction === "没有变化" ? "设为原值" : `${direction}了`}。`,
    "你对这件事想说什么就用平时群聊的方式回一句；可以直接发牢骚，也可以只是知道了。",
    "不想说就只回复「不插话」。不要提数值，也不要提这条是系统提示。",
  ].join("")
  try {
    const result = await AIManager.chat(conversationId, prompt, { e, ephemeralUserMessage: true })
    if (!result?.content || result.finishReason === "budget") return
    if (AIProactiveChat.isDecline(result.content)) return
    const content = AIManager._sanitizeReply(result.content, AIManager._resolvePreset(e), {})
    if (content) await e.reply(content)
  } catch (error) {
    Bot.makeLog("warn", ["好感度调整后的 AI 回应失败", error.message], "AiAffinity")
  }
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
        { reg: "^\\s*#?查看好感度$", fnc: "viewAffinity" },
        { reg: "^\\s*#?设置好感度(?:\\s+[\\s\\S]+)?$", fnc: "setAffinity" },
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
    if (!AIManager.isMemoryEnabledFor(e)) return this.reply("记忆功能已关闭。", true)
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
    if (!AIManager.isMemoryEnabledFor(e)) return this.reply("记忆功能已关闭。", true)
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

      const client = AIManager._roleChatClient("summary") || AIManager.defaultClient
      const result = await client.chat(
        [
          {
            role: "user",
            content: `请用 3-5 条要点总结下面这段群聊，每行一条，不要客套话：\n${transcript}`,
          },
        ],
        { maxTokens: 500, temperature: 0.3, requestKind: "summary" },
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

  async setAffinity(e) {
    this.e = e
    if (!e.isGroup) return this.reply("设置好感度只能在群里用。", true)
    if (!e.isMaster) return this.reply("只有主人可以设置好感度。", true)

    const matched = String(e.msg || "").match(SET_AFFINITY_RE)
    const raw = String(matched?.[1] || "").trim()
    if (!raw) return this.reply("用法：#设置好感度 @某人 30（不@就是设置自己）", true)

    const selfId = String(e.self_id || "")
    const ats = AIManager._atTargetsOf(e)
    const others = ats.filter(qq => String(qq) !== selfId)
    if (others.length > 1) return this.reply("一次只能设置一个人的好感度。", true)
    if (!others.length && ats.length) return this.reply("别@我，@要设置的人，或者不@设置你自己。", true)

    if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(raw))
      return this.reply("好感度要填 -100 到 100 之间的数字。", true)
    const value = Number(raw)
    if (!Number.isFinite(value) || value < -100 || value > 100)
      return this.reply("好感度要填 -100 到 100 之间的数字。", true)

    const target = String(others[0] || e.user_id || "")
    if (!/^[\dA-Za-z_-]{3,64}$/.test(target)) return this.reply("找不到要设置的人。", true)
    if (target === selfId) return this.reply("不能把好感度设给机器人自己。", true)

    const groupId = normalizeGroupId(e.group_id)
    const before = Number(
      AIManager.memoryStore.relationsFor({ groupId, userId: target }).merged.affinity,
    ) || 0
    const after = Math.round(value * 100) / 100
    const result = AIManager.memoryStore.setRelation(`group:${groupId}:user:${target}`, { affinity: after })
    if (!result.success) return this.reply(`设置失败：${result.error}`, true)

    const isSelf = target === String(e.user_id || "")
    const targetName =
      (isSelf ? memberName(e.sender, target) : atNameOf(e, target)) || `群友${lastFour(target)}`
    const direction = affinityDirection(before, after)

    injectAffinityNotice(
      e,
      `[关系调整] 主人刚刚把你对「${targetName}」的好感度从 ${plainScore(before)} 调整为 ${plainScore(after)}（${direction}）。这是主人的直接设定，已经生效。不要向群友透露这次调整或任何好感数值。`,
    )
    await maybeReactToAffinityChange(e, targetName, direction)
  }

  async viewAffinity(e) {
    this.e = e
    if (!e.isGroup) return this.reply("好感度只能在群里查看。", true)
    if (!(await canViewAffinity(e))) return this.reply("你没有查看好感度的权限。", true)
    const groupId = normalizeGroupId(e.group_id)
    const group = e.group || e.bot?.pickGroup?.(e.group_id) || null
    const relations = AIManager.memoryStore.activeRelationsForGroup(groupId)
    if (!relations.length) return this.reply("本群近30天还没有活跃记录。", true)

    const members = await groupMemberMap(e, group)
    const rows = relations
      .map(item => {
        const userId = String(item.userId || "")
        const affinity = Number(item.affinity) || 0
        return {
          name: memberName(members.get(userId), userId),
          uid: lastFour(userId),
          score: formatAffinity(affinity),
          tone: affinity > 0 ? "pos" : affinity < 0 ? "neg" : "zero",
          affinity,
          interactions: Number(item.interactions) || 0,
        }
      })
      .sort(
        (a, b) =>
          b.affinity - a.affinity ||
          b.interactions - a.interactions ||
          a.name.localeCompare(b.name, "zh-CN"),
      )

    const groupName = String(e.group_name || group?.group_name || group?.name || "").trim() || "本群"
    const data = { groupName, groupId, total: rows.length, rows }
    try {
      const img = await puppeteer.screenshot("ai-affinity/board", {
        tplFile: AFFINITY_TPL,
        saveId: "board",
        imgType: "png",
        omitBackground: true,
        scale: 1.5,
        ...data,
      })
      if (img) return this.reply(img)
    } catch (error) {
      Bot.makeLog("warn", ["好感度图片生成失败", error.message], "AiAffinity")
    }

    const lines = [
      `好感度 · ${groupName}(${groupId})`,
      ...rows.slice(0, 20).map((row, index) => `${index + 1}. ${row.name} ${row.uid} ${row.score}`),
    ]
    if (rows.length > 20) lines.push(`…共 ${rows.length} 人`)
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
      tags: presetSendTags(preset),
      generalTags: generalTagsOf(cfg),
    })
    const pending = stickerStore.listPending().length
    const tagLine = [
      ["情绪", stats.tagGroups?.emotion],
      ["场景", stats.tagGroups?.scene],
      ["归属", stats.tagGroups?.ownership],
    ]
      .map(([label, list]) =>
        list?.length
          ? `${label}：${list
              .slice(0, 4)
              .map(item => `${item.name}(${item.count})`)
              .join("、")}`
          : "",
      )
      .filter(Boolean)
      .join("；")
    const lines = [
      `可用表情：${stats.total} 张`,
      tagLine || "标签：暂无",
    ]
    if (pending) lines.push(`待审核：${pending} 张`)
    return this.reply(lines.join("\n"), true)
  }
}

export default AiSessionCommands
