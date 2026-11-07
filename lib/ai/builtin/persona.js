import plugin from "../../plugins/plugin.js"
import AIManager from "../AIManager.js"
import { aiAdmin } from "../AIAdminStore.js"
import puppeteer from "../../puppeteer/puppeteer.js"
import { fileURLToPath } from "node:url"

const tplFile = fileURLToPath(new URL("./resources/persona.html", import.meta.url))
const RESET_WORDS = new Set(["默认", "主人格"])

function admin() {
  return Bot.aiAdmin || aiAdmin
}

function clip(value, max = 80) {
  const content = String(value || "")
    .replace(/\s+/g, " ")
    .trim()
  return content.length > max ? `${content.slice(0, max)}…` : content
}

function findPreset(raw) {
  const query = String(raw || "")
    .replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, "")
    .trim()
  if (!query) return { preset: null }
  const presets = admin().list("presets")
  const exact =
    presets.find(item => item.id === query) ||
    presets.find(item => item.name === query) ||
    presets.find(item => item.name.toLowerCase() === query.toLowerCase())
  if (exact) return { preset: exact }
  const matches = presets.filter(item => {
    const name = String(item.name || "").toLowerCase()
    const role = String(item.roleName || "").toLowerCase()
    return name.includes(query.toLowerCase()) || role.includes(query.toLowerCase())
  })
  if (matches.length === 1) return { preset: matches[0] }
  if (matches.length > 1)
    return { error: `有多个角色匹配「${query}」：${matches.map(item => item.name).join("、")}` }
  return { error: `没有这个角色：${query}` }
}

function canSwitch(e) {
  if (e?.isMaster) return true
  if (!e?.isGroup) return false
  const group = admin().getGroup(e.group_id)
  return group?.allowAdminPersona === true && !!(e.member?.is_owner || e.member?.is_admin)
}

function permissionHint(e) {
  if (e?.isGroup && admin().getGroup(e.group_id)?.allowAdminPersona === true)
    return "你没有权限设置人格。仅限超级用户或群管理员"
  return "你没有权限设置人格。仅限超级用户"
}

function sourceLabel(source) {
  if (source === "group") return "本群人格"
  if (source === "private") return "本次私聊人格"
  return "主人格"
}

function contextLine(e, currentName) {
  if (e?.isGroup)
    return `群·${e.group_name || "群聊"}(${e.group_id})·当前人格:${currentName}`
  if (e?.user_id)
    return `私聊·${e.sender?.card || e.sender?.nickname || e.user_id}(${e.user_id})·当前人格:${currentName}`
  return `会话·当前人格:${currentName}`
}

function renderFallbackList(data) {
  const lines = [`人格设置（${data.total}）`, `当前人格：${data.currentName}（${data.sourceLabel}）`]
  if (data.presets.length) {
    lines.push("")
    for (const preset of data.presets)
      lines.push(`${preset.current ? "▶" : "·"} ${preset.name}${preset.roleName ? `（${preset.roleName}）` : ""}`)
  }
  lines.push("")
  if (data.canSwitch)
    lines.push("发送 persona 查看全部，persona预设名 切换人格，persona默认 恢复主人格。")
  else lines.push(data.permissionText)
  return lines.join("\n")
}

export class AiPersona extends plugin {
  constructor() {
    super({
      name: "AI人格设置",
      dsc: "按群/私聊切换人格，查看人格设置图片；主人格保持不变",
      event: "message",
      priority: 60,
      aiTool: false,
      rule: [
        {
          reg: "^#?persona(?:\\s*[（(]\\s*([^）)]*?)\\s*[）)]|\\s*(.+?))?\\s*$",
          fnc: "persona",
        },
      ],
    })
  }

  async persona(e) {
    this.e = e
    const match = String(e.msg || "").match(this.rule[0].reg)
    const query = String(match?.[1] ?? match?.[2] ?? "").trim()
    if (!query) return this.showPresets(e)

    if (!canSwitch(e)) return this.reply(permissionHint(e), true)

    if (RESET_WORDS.has(query.toLowerCase())) {
      if (e.isGroup) {
        const group = admin().getGroup(e.group_id)
        const selfId = String(e.self_id || "")
        if (selfId && group?.botPresets?.[selfId]) {
          const next = { ...group.botPresets }
          delete next[selfId]
          admin().setGroup(e.group_id, { botPresets: next })
        } else {
          admin().setGroup(e.group_id, { presetId: "" })
        }
      } else admin().setPrivatePreset(e.user_id, "")
      const current = AIManager._resolvePresetInfo(e)
      return this.reply(
        e.isGroup
          ? `本群已恢复跟随主人格「${current.preset?.name || "未设置"}」；主人格本身未改变。`
          : `本次私聊已恢复跟随主人格「${current.preset?.name || "未设置"}」；主人格本身未改变。`,
        true,
      )
    }

    const found = findPreset(query)
    if (found.error) return this.reply(found.error, true)
    if (!found.preset) return this.reply("没有这个角色", true)

    let scopedToBot = false
    if (e.isGroup) {
      const group = admin().getGroup(e.group_id)
      const selfId = String(e.self_id || "")
      if (selfId && group?.botPresets?.[selfId]) {
        admin().setGroup(e.group_id, {
          botPresets: { ...group.botPresets, [selfId]: found.preset.id },
        })
        scopedToBot = true
      } else {
        admin().setGroup(e.group_id, { presetId: found.preset.id })
      }
    } else admin().setPrivatePreset(e.user_id, found.preset.id)

    const main = admin().getActivePreset()
    return this.reply(
      e.isGroup
        ? scopedToBot
          ? `当前账号在本群的人格已切换为「${found.preset.name}」；其他账号不受影响，主人格「${main?.name || "未设置"}」保持不变。`
          : `本群人格已切换为「${found.preset.name}」，只影响本群；主人格「${main?.name || "未设置"}」保持不变。`
        : `本次私聊人格已切换为「${found.preset.name}」，只影响本次私聊；主人格「${main?.name || "未设置"}」保持不变。`,
      true,
    )
  }

  async showPresets(e) {
    const info = AIManager._resolvePresetInfo(e)
    const currentName = info.preset?.name || "未设置"
    const can = canSwitch(e)
    const presets = admin()
      .list("presets")
      .map(item => ({
        id: item.id,
        name: item.name,
        roleName: item.roleName || "",
        description: clip(item.description || item.personality, 90),
      }))
    const data = {
      title: "人格设置",
      subtitle: contextLine(e, currentName),
      source: info.source,
      sourceLabel: sourceLabel(info.source),
      currentName,
      canSwitch: can,
      permissionText: can ? "" : permissionHint(e),
      total: presets.length,
      presets: presets.map((preset, index) => ({
        ...preset,
        index: index + 1,
        current: preset.id === info.preset?.id,
      })),
    }

    if (!data.total) {
      return this.reply(
        `还没有配置人格。请先在 WebUI「预设管理」中创建；\n当前${data.sourceLabel}：${data.currentName}。`,
        true,
      )
    }

    try {
      const img = await puppeteer.screenshot("ai-persona/persona", {
        tplFile,
        saveId: "persona",
        ...data,
      })
      if (img) return this.reply(img)
    } catch (err) {
      Bot.makeLog("warn", ["人格设置图片生成失败", err.message], "AiPersona")
    }

    return this.reply(renderFallbackList(data), true)
  }
}
