import cfg from "../config/config.js"
import common from "../common/common.js"
import PluginsLoader from "../plugins/loader.js"
import { createLoginPanel } from "./LoginPanel.js"

const DEFAULT_WORDS = ["云崽登录"]

function configuredWords(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || "").split(/[,，、\s]+/)
  return [...new Set(list.map(item => String(item || "").trim()).filter(Boolean))]
}

function loginWords(webui = cfg.webui || {}) {
  const custom = configuredWords(webui.loginCommands)
  if (custom.length) return custom
  return webui.disableDefaultLoginCommand === true ? [] : DEFAULT_WORDS
}

function buildRule(words) {
  const list = [...new Set((words || []).map(word => String(word || "").trim()).filter(Boolean))]
  if (!list.length) return null
  const escaped = list
    .sort((a, b) => b.length - a.length)
    .map(word => word.replace(/^#+/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .filter(Boolean)
  if (!escaped.length) return null
  return `^#(?:${escaped.join("|")})$`
}

function currentRule() {
  const rule = buildRule([...loginWords(), ...configuredWords(cfg.webui?.loginCommands)])
  return rule ? [{ reg: rule, fnc: "panel" }] : []
}

export function refreshLoginRule() {
  const entries = (PluginsLoader.priority || []).filter(
    entry => entry.plugin instanceof WebPanelLogin,
  )
  for (const entry of entries) entry.plugin.rule = currentRule()
  return entries.length
}

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
    super({
      name: "管理面板登录",
      dsc: "获取 WebUI 管理面板地址与临时登录码",
      event: "message",
      priority: 100,
      aiTool: false,
      rule: currentRule(),
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
    const buildForward = target =>
      target?.makeForwardMsg ? target.makeForwardMsg(segments.map(message => ({ message }))) : common.makeForwardMsg(e, segments)

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

    return this.reply(await buildForward(e.friend))
  }
}
