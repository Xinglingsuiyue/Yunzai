/**
 * 管理面板快捷登录指令。
 *
 * 主人在 QQ 里发「#云崽登录」，拿到带一次性登录码的面板地址。
 * 群里默认私聊发，避免地址被群成员看到。
 * 呼出方式可在 WebUI 基础配置里改：自定义指令词，或直接禁用默认词。
 */
import cfg from "../config/config.js"
import common from "../common/common.js"
import { createLoginPanel } from "./LoginPanel.js"

/** 内置同义写法；可用 disableDefaultLoginCommand 整体关掉 */
const DEFAULT_WORDS = ["云崽登录"]

/** 配置里的登录指令词：数组或以逗号/顿号/空白分隔的字符串 */
function configuredWords(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || "").split(/[,，、\s]+/)
  return [...new Set(list.map(item => String(item || "").trim()).filter(Boolean))]
}

/** 当前生效的指令词表：自定义优先，默认词可单独禁用 */
function loginWords(webui = cfg.webui || {}) {
  const custom = configuredWords(webui.loginCommands)
  if (custom.length) return custom
  return webui.disableDefaultLoginCommand === true ? [] : DEFAULT_WORDS
}

/** 拼规则：必须带 # 才触发，避免聊天里随口提到就被当成指令 */
function buildRule(words) {
  const list = [...new Set((words || []).map(word => String(word || "").trim()).filter(Boolean))]
  if (!list.length) return null
  const escaped = list
    .sort((a, b) => b.length - a.length)
    // 配置里写了 # 就先去掉，下面统一补上
    .map(word => word.replace(/^#+/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .filter(Boolean)
  if (!escaped.length) return null
  return `^#(?:${escaped.join("|")})$`
}

/**
 * 拼回复段落：每段单独一条转发消息，跟锅巴一样按类型分成几屏。
 * 码本身已经在链接末尾，不再单独重复一遍数字。
 */
function buildSegments(panel, opts = {}) {
  const segments = ["欢迎回来主人~ 这是您的登录地址："]
  const push = (label, list) => {
    if (list.length) segments.push(`${label}：\n${list.join("\n")}`)
  }
  if (opts.onlyCustom) {
    if (panel.custom.length) push("自定义地址", panel.custom)
    else segments.push("已启用「只发送自定义地址」，但 config/config/webui.yaml 里还没填 customAddresses。")
  } else {
    push("自定义地址", panel.custom)
    // IPv6 不单列，直接跟在同类地址后面
    push("内网地址", [...panel.local, ...(panel.localV6 || [])])
    push("外网地址", [...panel.remote, ...(panel.remoteV6 || [])])
    const all = [
      ...panel.custom,
      ...panel.local,
      ...(panel.localV6 || []),
      ...panel.remote,
      ...(panel.remoteV6 || []),
    ]
    if (!all.length) segments.push("没能生成地址，请检查 server.yaml 的 url 与端口配置。")
  }
  if (panel.code) {
    segments.push(
      "临时登录码，3 分钟内有效，用一次就失效。登录成功后浏览器会记住令牌，过期再发指令重新获取。",
    )
  } else {
    segments.push("临时码生成失败（Redis 不可用），请在面板登录页手动填入访问令牌。")
  }
  return segments
}

export class WebPanelLogin extends plugin {
  constructor() {
    // 注册时把默认词与自定义词一起编进规则；改配置后需要重载插件（WebUI 保存时会提示）
    const rule = buildRule([...loginWords(), ...configuredWords(cfg.webui?.loginCommands)])
    super({
      name: "管理面板登录",
      dsc: "获取 WebUI 管理面板地址与临时登录码",
      event: "message",
      priority: 100,
      // 这是主人用的运维指令，不该被 AI 当成工具调用
      aiTool: false,
      rule: rule ? [{ reg: rule, fnc: "panel" }] : [],
    })
  }

  async panel(e) {
    if (e.isMaster !== true) return this.reply("这个指令只有主人能用。", true)

    const webui = cfg.webui || {}
    if (webui.enable === false) return this.reply("WebUI 已在 config/config/webui.yaml 中关闭。", true)

    const customHosts = Array.isArray(webui.customAddresses)
      ? webui.customAddresses.map(item => String(item || "").trim()).filter(Boolean)
      : String(webui.customAddresses || "").split(",").map(item => item.trim()).filter(Boolean)
    const onlyCustom = webui.onlyCustomAddress === true

    let panel
    try {
      panel = await createLoginPanel(e, {
        basePath: String(webui.path || "/webui"),
        port: Number(cfg.server?.port) || 0,
        customHosts,
        onlyCustom,
      })
    } catch (err) {
      Bot.makeLog("error", ["生成面板地址失败", err.message], "WebPanel")
      return this.reply("生成面板地址失败，请查看后台日志。", true)
    }

    const segments = buildSegments(panel, { onlyCustom })
    // 私信用 friend 的转发能力，群里用事件自身的
    const buildForward = target =>
      target?.makeForwardMsg ? target.makeForwardMsg(segments.map(message => ({ message }))) : common.makeForwardMsg(e, segments)

    // 群里默认转私聊：地址等于管理权限，不能让群成员看到
    if (e.isGroup && webui.loginInGroup !== true) {
      try {
        const friend = Bot.pickFriend(e.user_id)
        await friend.sendMsg(await buildForward(friend))
        return this.reply("面板地址和临时登录码已私聊发给你了~", true)
      } catch (err) {
        Bot.makeLog("warn", ["面板地址私聊发送失败", err.message], "WebPanel")
        return this.reply("私聊发送失败，请先加我好友，或者私聊发送这条指令。", true)
      }
    }

    // 不传第二个参数：合并转发带上引用会连着刚才那条指令一起引用，很乱
    return this.reply(await buildForward(e.friend))
  }
}
