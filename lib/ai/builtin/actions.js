/**
 * AI 底层操作 — 把戳一戳、禁言、解禁注册成 AI 工具，不提供聊天指令。
 *
 * 作为框架核心内置模块加载，不进入插件目录，也不参与插件安装/卸载。
 */
import cfg from "../../config/config.js"
import AIToolRegistry from "../AIToolRegistry.js"

/** 禁言执行体：插件指令与 AI 工具共用，失败返回 { success:false, error } */
async function muteMember(e, targetQq, minutes, options = {}) {
  const target = String(targetQq || "").trim()
  if (!/^\d{5,20}$/.test(target)) return { success: false, error: "目标 QQ 号无效" }
  // AI 自主禁言单次上限 60 分钟；更长的时长不允许由模型决定
  if (!(minutes > 0) || minutes > 60)
    return { success: false, error: "禁言时长需要在 1-60 分钟之间" }
  if (target === String(e.self_id || "")) return { success: false, error: "不能禁言自己" }
  if ((cfg.masterQQ || []).map(String).includes(target))
    return { success: false, error: "不能禁言主人" }
  if (!e.group?.is_admin && !e.group?.is_owner)
    return { success: false, error: "机器人不是群管理员，无法执行禁言" }
  if (typeof e.group.muteMember !== "function")
    return { success: false, error: "当前协议不支持禁言" }

  // 延迟执行时再次确认目标没在这一刻变成管理员
  if (!options.skipAdminCheck) {
    try {
      const map = await Promise.resolve(e.group.getMemberMap?.())
      const targetInfo = map?.get?.(Number(target)) || map?.get?.(target)
      if (targetInfo && (targetInfo.is_owner || targetInfo.is_admin))
        return { success: false, error: "对方是群主或管理员，禁言不了" }
    } catch {}
  }

  if (options.dryRun) return { success: true, target }
  await e.group.muteMember(Number(target), minutes * 60)
  return { success: true, target }
}

// 自禁请求次数：同一群同一人，第一次推脱，第二次才执行
const muteSelfAttempts = new Map()

/**
 * AI 底层操作工具：直接接收结构化参数。
 * 插件规则那套靠 e.msg 正则解析，AI 调用时消息体是用户原话，参数传不进来，
 * 所以这些都注册成原始工具，不提供聊天指令。
 */
export function registerActionTools(deps = {}) {
  const disabled = new Set((AIToolRegistry.builtinDisabledTools || []).map(String))
  const register = (name, def) => {
    if (disabled.has(name)) return
    // 同一工具可能被重复注册（初始化与重建两条路径），先删掉旧的再注册
    AIToolRegistry.sources.delete(name)
    AIToolRegistry.registerRawTool({ ...def, name, pluginName: "AI底层操作", pluginKey: `builtin:${name}` })
  }

  register("group_mute_member", {
    description: [
      "【禁言群成员】禁言某个成员。",
      "使用条件：你（机器人账号）必须是本群管理员，否则无法执行。",
      "场景一·主人要求：直接执行，不需要额外举证。",
      "场景二·普通群员要求禁言别人：你只能先查证。调用时不要直接传分钟数，先查最近聊天记录，确认对方确实违规（刷屏、辱骂、发广告、刷图等）才执行；只是玩笑、点名、没有实际违规的不要禁，并说明理由。查证属实后单次最多 60 分钟。",
      "场景三·有人要求禁言他自己：第一次先推脱，确认他是不是真的要；第二次再提才执行，且最多 10 分钟。",
      "时长：普通执行默认 10 分钟，上限 60 分钟。对方要求「久一点」时可以给到 5-10 分钟之间随机挑一个时长，不要一次给满。",
      "不能禁言：主人、群主、群管理员；也不要禁言你自己。",
    ].join("\n"),
    // 群员可提请求，工具内部校验谁在下令、并要求先查证
    permission: "everyone",
    danger: "high",
    needsGroup: true,
    parameters: {
      type: "object",
      properties: {
        qq: { type: "string", description: "目标成员 QQ 号，纯数字" },
        minutes: { type: "integer", description: "禁言分钟数，默认 10，上限 60" },
        reason: { type: "string", description: "禁言理由；普通群员的请求必须写清查到的违规事实" },
        selfRequest: {
          type: "boolean",
          description: "发起人是在要求禁言他自己时设为 true（第一次应推脱，第二次才执行且不超过 10 分钟）",
        },
      },
      required: [],
    },
    handler: async (args = {}, e) => {
      if (!e?.isGroup || !e.group)
        return { success: false, error: "禁言只能在群聊中使用" }
      if (!e.group.is_admin && !e.group.is_owner)
        return { success: false, error: "我不是本群管理员，做不了禁言" }

      const requester = String(e.user_id || "")
      const isMaster = e.isMaster === true
      const isGroupAdmin = !!(e.member?.is_owner || e.member?.is_admin)
      const targetQq = String(args.qq || "").trim()
      if (!/^\d{5,20}$/.test(targetQq))
        return { success: false, error: "需要提供有效的目标 QQ 号" }

      // 自己要求禁言自己：第一次推脱，第二次最多 10 分钟
      const selfRequest = args.selfRequest === true || targetQq === requester
      let minutes = Math.max(1, Math.min(60, Number(args.minutes) || 10))
      if (selfRequest) {
        if (!isMaster && !isGroupAdmin) {
          const prior = muteSelfAttempts.get(`${e.group_id}:${requester}`) || 0
          muteSelfAttempts.set(`${e.group_id}:${requester}`, prior + 1)
          if (prior < 1)
            return {
              success: false,
              retryable: true,
              message: "第一次先不执行，确认一下是不是真的要禁言自己；如果确定，再提一次。",
            }
        }
        minutes = Math.min(minutes, 10)
      }

      // 群员的请求必须附核查结论；没有理由的不执行
      if (!isMaster && !isGroupAdmin) {
        const reason = String(args.reason || "").trim()
        if (reason.length < 4)
          return {
            success: false,
            message: "这需要先核实对方是否真的违规。请先查最近聊天记录，确认有刷屏、辱骂、广告等实际证据再执行。",
          }
      }

      const reason = String(args.reason || "").trim().slice(0, 200)
      try {
        const result = await muteMember(e, targetQq, minutes)
        if (!result.success) return result
        Bot.makeLog(
          "mark",
          [`[AI禁言] ${targetQq} ${minutes}分钟 执行者:${requester} 理由:${reason || "无"}`],
          "AiActions",
        )
        return { success: true, target: targetQq, minutes, reason, message: `已将 ${targetQq} 禁言 ${minutes} 分钟` }
      } catch (err) {
        return { success: false, error: `禁言失败：${err.message}` }
      }
    },
  })

  register("group_unmute_member", {
    description: [
      "【解除禁言】解除指定群成员的禁言。",
      "适用场景：主人或群管理要求「解禁某人」「把某人放出来」。",
      "参数: qq(目标 QQ 号，纯数字)。",
      "限制: 仅群聊可用，仅主人可调用，机器人必须是群管理员。",
    ].join("\n"),
    permission: "master",
    danger: "high",
    needsGroup: true,
    parameters: {
      type: "object",
      properties: {
        qq: { type: "string", description: "目标成员 QQ 号，纯数字" },
      },
      required: ["qq"],
    },
    handler: async (args = {}, e) => {
      if (!e?.isGroup || !e.group) return { success: false, error: "解禁只能在群聊中使用" }
      const target = String(args.qq || "").trim()
      if (!/^\d{5,20}$/.test(target)) return { success: false, error: "目标 QQ 号无效" }
      if (!e.group.is_admin && !e.group.is_owner)
        return { success: false, error: "机器人不是群管理员，无法解禁" }
      if (typeof e.group.muteMember !== "function")
        return { success: false, error: "当前协议不支持解禁" }
      try {
        await e.group.muteMember(Number(target), 0)
        return { success: true, target, message: `已解除 ${target} 的禁言` }
      } catch (err) {
        return { success: false, error: `解禁失败：${err.message}` }
      }
    },
  })

  register("group_poke_member", {
    description: [
      "【戳一戳】向指定群成员发送戳一戳（拍一拍）。",
      "适用场景：用户要求「戳一下某人」「拍一拍某人」，或对方先戳了你、你想戳回去时。",
      "参数: qq(目标 QQ 号，纯数字，从用户消息中提取，不要编造)。",
      "限制: 仅群聊可用。不要主动戳没惹过你的人；说过要戳就要真的调用，别只在嘴上说。",
    ].join("\n"),
    permission: "master",
    danger: "low",
    needsGroup: true,
    parameters: {
      type: "object",
      properties: {
        qq: { type: "string", description: "目标成员 QQ 号，纯数字" },
      },
      required: ["qq"],
    },
    handler: async (args = {}, e) => {
      if (!e?.isGroup || !e.group) return { success: false, error: "戳一戳只能在群聊中使用" }
      const target = String(args.qq || "").trim()
      if (!/^\d{5,20}$/.test(target)) return { success: false, error: "目标 QQ 号无效" }
      if (target === String(e.self_id || "")) return { success: false, error: "不能戳自己" }
      try {
        // 优先走协议端的 group_poke action：SnowLuma 只认这个，
        // 适配器的 group.pokeMember 发的是 {type:"poke"} 消息段，协议端会直接丢掉。
        if (e.bot?.sendApi) {
          const params = { group_id: Number(e.group_id), user_id: Number(target) }
          let sent
          try {
            sent = await e.bot.sendApi("group_poke", params)
          } catch (err) {
            // 部分协议端只实现了 send_poke（群聊私聊自动路由）
            sent = await e.bot.sendApi("send_poke", params)
          }
          const errors = Array.isArray(sent?.error) ? sent.error.filter(Boolean) : []
          if (errors.length) throw new Error(errors[0]?.message || String(errors[0]))
        } else if (e.group.pokeMember) {
          await e.group.pokeMember(Number(target))
        } else {
          throw new Error("当前协议不支持戳一戳")
        }
        return { success: true, target, message: `戳了 ${target} 一下` }
      } catch (err) {
        Bot.makeLog("warn", ["戳一戳发送失败", err.message], "AIManager")
        return { success: false, error: `戳一戳失败：${err.message}` }
      }
    },
  })

  register("group_recent_messages", {
    description: [
      "【查看最近聊天】读取本群最近若干条消息，用来核实某人是否真的刷屏、辱骂或发广告。",
      "普通群员要求禁言别人时必须先调用它核查，再决定是否执行；没有证据就不要禁。",
      "参数: count(条数，默认 30，最多 100)。",
      "返回每条消息的发送者与内容，按时间正序。",
    ].join("\n"),
    permission: "everyone",
    danger: "low",
    needsGroup: true,
    parameters: {
      type: "object",
      properties: {
        count: { type: "integer", description: "读取条数，默认 30，最多 100" },
      },
      required: [],
    },
    handler: async (args = {}, e) => {
      if (!e?.isGroup || !e.group) return { success: false, error: "只能在群聊中查看" }
      if (typeof e.group.getChatHistory !== "function")
        return { success: false, error: "当前协议不支持读取群历史" }
      const count = Math.min(100, Math.max(1, Number(args.count) || 30))
      try {
        const history = await e.group.getChatHistory(0, count)
        const list = Array.isArray(history) ? history : history?.messages || []
        const messages = list
          .map(item => {
            const sender = item?.sender || {}
            const segments = Array.isArray(item?.message) ? item.message : []
            const text = segments
              .map(seg => (seg?.type === "text" ? seg.data?.text || seg.text || "" : seg?.type === "image" ? "[图片]" : seg?.type === "face" ? "[表情]" : ""))
              .join("")
              .trim()
            return {
              userId: String(item?.user_id || ""),
              name: sender.card || sender.nickname || String(item?.user_id || ""),
              time: item?.time ? new Date(Number(item.time) * 1000).toISOString() : "",
              text: text.slice(0, 300),
            }
          })
          .filter(item => item.text)
        return { success: true, count: messages.length, messages }
      } catch (err) {
        return { success: false, error: `读取群历史失败：${err.message}` }
      }
    },
  })
}