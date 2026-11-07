import AIToolRegistry from "../AIToolRegistry.js"

const MEMBER_PAGE_SIZE = 100
const MAX_HISTORY = 50
const DEFAULT_HISTORY = 20
const MEMBER_TIMEOUT = 20000
const HISTORY_TIMEOUT = 15000

async function withTimeout(promise, ms, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}超时（${Math.round(ms / 1000)} 秒）`)), ms)
        timer.unref?.()
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function groupOf(e) {
  if (e?.group) return e.group
  const bot = e?.bot
  if (bot && typeof bot.pickGroup === "function" && e?.group_id) return bot.pickGroup(e.group_id)
  return null
}

function memberRole(member) {
  if (typeof member?.role === "string" && member.role) return member.role
  if (member?.is_owner) return "owner"
  if (member?.is_admin) return "admin"
  return "member"
}

const ROLE_CN = { owner: "群主", admin: "管理", member: "成员" }

function displayName(member) {
  return String(member?.card || member?.nickname || member?.nick || member?.user_id || "")
}

function messageLine(msg) {
  if (!msg) return null
  const data = msg.data || msg
  const sender = data.sender || {}
  const who = String(sender.card || sender.nickname || sender.user_id || data.user_id || "未知")
  const segments = Array.isArray(data.message) ? data.message : []
  const parts = []
  for (const seg of segments) {
    const type = seg?.type || seg?.data?.type
    const segData = seg?.data || {}
    if (type === "text") parts.push(String(segData.text || ""))
    else if (type === "image") parts.push("[图片]")
    else if (type === "mface" || type === "marketface") parts.push("[表情]")
    else if (type === "face") parts.push("[表情]")
    else if (type === "at") parts.push(`@${segData.qq || segData.name || "某人"}`)
    else if (type === "reply") continue
    else if (type === "record") parts.push("[语音]")
    else if (type === "video") parts.push("[视频]")
    else if (type === "file") parts.push("[文件]")
    else if (type === "forward") parts.push("[聊天记录]")
  }
  const text = parts.join("").trim() || String(data.raw_message || "").trim()
  if (!text) return null
  return {
    message_id: String(data.message_id ?? ""),
    seq: String(data.message_seq ?? data.seq ?? ""),
    time: Number(data.time || 0),
    user_id: String(sender.user_id || data.user_id || ""),
    name: who,
    text: text.slice(0, 300),
  }
}

export function registerChatTools(deps = {}) {
  const disabled = new Set((AIToolRegistry.builtinDisabledTools || []).map(String))
  const register = (name, def) => {
    if (disabled.has(name)) return

    AIToolRegistry.sources.delete(name)
    AIToolRegistry.registerRawTool({ ...def, name, pluginName: "群聊信息", pluginKey: `builtin:${name}` })
  }

  register("group_info_query", {
    description: [
      "【群资料】查看群名称、群号、人数上限、群主。",
      "适用场景：用户问「这个群叫什么」「群里有多少人」。",
      "参数: 无。不传群号时查当前群。",
      "只能查当前会话所在的群，不能跨群查询。",
      "被问到你自己的账号、昵称、头像或群身份时，改用 self_profile 查询。",
    ].join("\n"),
    permission: "all",
    danger: "low",
    needsGroup: true,
    parameters: { type: "object", properties: {}, required: [] },
    handler: async (args = {}, e) => {
      const group = groupOf(e)
      if (!group) return { success: false, error: "当前不在群聊里，拿不到群资料" }
      try {
        let info = null
        try {
          info = await withTimeout(Promise.resolve(group.getInfo?.(true, true)), MEMBER_TIMEOUT, "获取群资料")
        } catch {}

        const memberCount = Number(info?.member_count ?? info?.memberCount ?? 0) || null
        return {
          success: true,
          group_id: String(e?.group_id || ""),
          group_name: String(info?.group_name || info?.groupName || e?.group_name || "未知"),
          member_count: memberCount,
          max_member_count: Number(info?.max_member_count || 0) || null,
          owner_id: String(info?.owner_id || ""),
          note: memberCount ? "" : "协议端没有返回人数，只能确认群名",
        }
      } catch (err) {
        return { success: false, error: `获取群资料失败：${err.message}` }
      }
    },
  })

  register("self_profile", {
    description: [
      "【我是谁】查询你自己（机器人）的账号资料，返回 JSON：account（QQ 号）、nickname（昵称）、avatar（头像图片地址）、group_card、group_role。",
      "只要用户在问你自己的事就必须先调用：问「你头像」「看得到自己的头像吗」「你长什么样」「你 QQ 号」「你叫什么」「你是不是管理」都算。",
      "注意：查得到不等于能看见画质。你拿到的是头像的图片地址，不是画面内容；被问「你能看到自己头像吗」时，按实际能力回答——能给地址但不能描述画面。",
      "不要凭人设想象自己的样子（比如「一条蓝头发的鱼」），那不是查到的。",
    ].join("\n"),
    permission: "all",
    danger: "low",
    parameters: { type: "object", properties: {}, required: [] },
    handler: async (args = {}, e) => {
      const selfId = String(e?.self_id || e?.bot?.uin || "")
      const client = e?.bot || globalThis.Bot?.bots?.[selfId]
      const nickname = String(client?.nickname || client?.info?.nickname || "").trim()
      let avatar = String(client?.avatar || "").trim()
      if (!avatar && Number(selfId) > 0) avatar = `https://q1.qlogo.cn/g?b=qq&s=0&nk=${selfId}`
      const result = {
        success: true,
        account: selfId,
        nickname,
        avatar,
      }
      const group = groupOf(e)
      if (group && typeof group.pickMember === "function") {
        try {
          const member = await withTimeout(Promise.resolve(group.pickMember(selfId).getInfo?.()), 5000, "查询自身身份")
          if (member) {
            result.group_card = String(member.card || "").trim()
            result.group_role = ROLE_CN[memberRole(member)] || "成员"
            if (!result.nickname) result.nickname = String(member.nickname || "").trim()
          }
        } catch {}
      }
      return result
    },
  })

  register("group_member_list", {
    description: [
      "【群成员】列出群里的成员，含昵称、群名片、角色。",
      "适用场景：用户问「群里都有谁」「谁是管理」「某某在不在群里」。",
      `参数: role(只列某类成员：owner 群主 / admin 管理，可选), offset(跳过前几人，默认0), pageSize(本页人数，默认${MEMBER_PAGE_SIZE})`,
      "不传 offset 时只看第一页；成员多的大群/频道要用 offset 翻页，配合返回的 hasMore 继续查。",
      "返回的 total 才是群总人数，不要用本页条数当成群规模；也不要据此断言某人不在群里。",
    ].join("\n"),
    permission: "all",
    danger: "low",
    needsGroup: true,
    parameters: {
      type: "object",
      properties: {
        role: { type: "string", description: "只列指定角色：owner / admin，可选" },
        offset: { type: "integer", description: "跳过前几人，用于翻页，默认 0" },
        pageSize: { type: "integer", description: `本页人数，默认 ${MEMBER_PAGE_SIZE}` },
      },
      required: [],
    },
    handler: async (args = {}, e) => {
      const group = groupOf(e)
      if (!group) return { success: false, error: "当前不在群聊里，拿不到成员列表" }
      const pageSize = Math.max(1, Number(args.pageSize) || MEMBER_PAGE_SIZE)
      const offset = Math.max(0, Number(args.offset) || 0)
      const roleFilter = String(args.role || "").trim().toLowerCase()
      try {
        let rows = []
        const map = await withTimeout(Promise.resolve(group.getMemberMap?.()), MEMBER_TIMEOUT, "获取群成员")
        if (map && typeof map.values === "function") {
          rows = [...map.values()]
        } else {
          const ids = await withTimeout(Promise.resolve(group.getMemberList?.()), MEMBER_TIMEOUT, "获取群成员")
          rows = (ids || []).map(id => ({ user_id: id }))
        }
        const total = rows.length
        const matchedAll = rows
          .map(member => ({
            user_id: String(member.user_id || ""),
            name: displayName(member),
            role: ROLE_CN[memberRole(member)] || memberRole(member),
          }))
          .filter(member => !roleFilter || member.role === ROLE_CN[roleFilter])

        const budget = 3600
        const page = []
        let used = 120
        for (let i = offset; i < matchedAll.length && page.length < pageSize; i++) {
          const size = JSON.stringify(matchedAll[i]).length + 1
          if (page.length && used + size > budget) break
          page.push(matchedAll[i])
          used += size
        }
        const nextOffset = offset + page.length
        return {
          success: true,
          group_id: String(e?.group_id || ""),
          total,
          matched: matchedAll.length,
          offset,
          returned: page.length,
          hasMore: nextOffset < matchedAll.length,
          nextOffset: nextOffset < matchedAll.length ? nextOffset : null,
          members: page,
        }
      } catch (err) {
        return { success: false, error: `获取群成员失败：${err.message}` }
      }
    },
  })

  register("chat_history_recent", {
    description: [
      "【聊天记录】拉取当前会话最近的若干条消息，用于理解刚才在聊什么。",
      "适用场景：用户问「刚才说了什么」「前面提到的那个」你自己没接上，或需要回顾上下文。",
      "参数: count(条数，默认20，最多50), user_id(只看某个人发的，可选)",
      "只返回有文字的文本内容，图片/表情以 [图片][表情] 占位。",
      "不要用它逐条复述聊天记录；用户问「谁说了什么」时再引用具体几条。",
    ].join("\n"),
    permission: "all",
    danger: "low",
    parameters: {
      type: "object",
      properties: {
        count: { type: "integer", description: `条数，默认 ${DEFAULT_HISTORY}，最多 ${MAX_HISTORY}` },
        user_id: { type: "string", description: "只看这个 QQ 号发的消息，可选" },
      },
      required: [],
    },
    handler: async (args = {}, e) => {
      const count = Math.min(MAX_HISTORY, Math.max(1, Number(args.count) || DEFAULT_HISTORY))
      const onlyUser = String(args.user_id || "").trim()
      const isGroup = Boolean(e?.isGroup || e?.group_id)
      try {
        let list = []
        if (isGroup) {
          const group = groupOf(e)
          if (!group) return { success: false, error: "当前不在群聊里，拿不到聊天记录" }

          const fetch = anchor => withTimeout(Promise.resolve(group.getChatHistory?.(anchor, count + 1)), HISTORY_TIMEOUT, "获取聊天记录")
          try {
            list = await fetch(0)
          } catch {
            list = await fetch(Number(e?.seq || e?.message_seq || 0))
          }
        } else {
          const friend = e?.friend || (e?.bot && e?.user_id ? e.bot.pickFriend?.(e.user_id) : null)
          if (!friend) return { success: false, error: "拿不到私聊记录" }
          list = await withTimeout(Promise.resolve(friend.getChatHistory?.(0, count + 1)), HISTORY_TIMEOUT, "获取聊天记录")
        }

        const currentId = String(e?.message_id ?? "")
        let lines = (Array.isArray(list) ? list : [])
          .map(messageLine)
          .filter(Boolean)

          .filter(item => !currentId || String(item.message_id || "") !== currentId)
        if (onlyUser) lines = lines.filter(item => item.user_id === onlyUser)
        lines = lines.slice(-count)

        if (!lines.length) return { success: false, error: "没有拿到聊天记录，可能协议端不支持或消息太旧" }
        return {
          success: true,
          scope: isGroup ? "group" : "private",
          count: lines.length,
          messages: lines,
          note: "按时间从早到晚排列。",
        }
      } catch (err) {
        return { success: false, error: `获取聊天记录失败：${err.message}` }
      }
    },
  })
}

export { MEMBER_PAGE_SIZE, MAX_HISTORY, DEFAULT_HISTORY }
