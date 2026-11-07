import fs from "node:fs"
import template from "art-template"
import plugin from "../plugins/plugin.js"
import Renderer from "../renderer/loader.js"
import { fileURLToPath } from "node:url"
import { getHelpConfig, normalizeHelpConfig, buildHelpGroups, helpText, helpFooterText, HELP_VERSION } from "./HelpConfig.js"
import { getThemeData } from "./HelpTheme.js"

const tplFile = fileURLToPath(new URL("./resources/help.html", import.meta.url))
const tplSource = fs.readFileSync(tplFile, "utf8")
const previewTpl = template.compile(tplSource)
const RULE = /^#?(?:帮助|菜单|功能|指令|说明|使用说明|命令|help)(?:\s+([\s\S]+))?$/i

const PREVIEW_MAX_GROUPS = 80
const PREVIEW_MAX_ITEMS = 200

const PREVIEW_EXTRA = `<style>
html, body { background: transparent !important; }
body { padding: 0 !important; }
#panel { box-shadow: none !important; }
.group-head, .cell:not(.empty) { cursor: pointer; }
.group:hover { outline: 1px solid rgba(122, 162, 255, 0.55); outline-offset: -1px; }
.cell:not(.empty):hover { background: rgba(122, 162, 255, 0.18); }
</style>
<script>
(function () {
  function reportSize() {
    var body = document.body
    var rect = body.getBoundingClientRect()
    parent.postMessage({
      type: "help-preview-size",
      width: Math.ceil(Math.max(rect.width, body.scrollWidth)),
      height: Math.ceil(Math.max(rect.height, body.scrollHeight))
    }, "*")
  }
  window.addEventListener("load", reportSize)
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(reportSize)
  setTimeout(reportSize, 60)
  document.addEventListener("click", function (event) {
    var group = event.target.closest(".group[data-group-index]")
    if (!group) return
    var cell = event.target.closest(".cell[data-item-index]")
    parent.postMessage({
      type: "help-preview-edit",
      group: Number(group.dataset.groupIndex),
      item: cell ? Number(cell.dataset.itemIndex) : null
    }, "*")
  })
})()
</script>`

function previewText(value, limit) {
  if (typeof value !== "string" && typeof value !== "number") return ""
  return String(value).trim().slice(0, limit)
}

function normalizePreviewList(helpList) {
  if (!Array.isArray(helpList)) return []
  return helpList.slice(0, PREVIEW_MAX_GROUPS).map(group => {
    const source = group && typeof group === "object" ? group : {}
    const list = Array.isArray(source.list) ? source.list : []
    return {
      group: previewText(source.group || source.name, 100),
      desc: previewText(source.desc, 300),
      auth: previewText(source.auth, 20),
      list: list.slice(0, PREVIEW_MAX_ITEMS).map(item => {
        const entry = item && typeof item === "object" ? item : {}
        return {
          icon: previewText(entry.icon, 2000),
          title: previewText(entry.title, 200),
          desc: previewText(entry.desc, 500),
        }
      }),
    }
  })
}

export function renderHelpPreviewHtml({ helpCfg, helpList, themeName } = {}) {
  const normalized = normalizeHelpConfig({ helpCfg, helpList: normalizePreviewList(helpList) })
  const cfgData = normalized.helpCfg
  const helpGroups = buildHelpGroups(normalized.helpList, { isMaster: true }, "", cfgData.colCount, {
    previewAssets: true,
  })
  const width = Math.min(2500, Math.max(800, cfgData.colCount * cfgData.colWidth + 60))
  const theme = getThemeData(cfgData, typeof themeName === "string" ? themeName : "", { preview: true })
  const html = previewTpl({
    helpCfg: cfgData,
    helpGroups,
    keyword: "",
    width,
    cellWidth: (100 / cfgData.colCount).toFixed(4),
    helpFooter: helpFooterText(cfgData),
    helpVersion: HELP_VERSION,
    ...theme,
  })
  return { html: html.replace("</body>", `${PREVIEW_EXTRA}</body>`), themeName: theme.themeName, width }
}

export async function renderHelpPanel({ keyword = "", isMaster = true } = {}) {
  const { helpCfg, helpList } = getHelpConfig()
  const helpGroups = buildHelpGroups(helpList, { isMaster }, keyword, helpCfg.colCount)
  if (!helpGroups.length) return { helpCfg, helpGroups, image: null }

  const width = Math.min(2500, Math.max(800, helpCfg.colCount * helpCfg.colWidth + 60))
  const data = {
    helpCfg,
    helpGroups,
    keyword,
    width,
    cellWidth: (100 / helpCfg.colCount).toFixed(4),
    helpFooter: helpFooterText(helpCfg),
    helpVersion: HELP_VERSION,
    bare: true,
    ...getThemeData(helpCfg),
  }

  const image =
    (await Renderer.render("help/panel", {
      tplFile,
      saveId: "panel",
      imgType: "png",
      omitBackground: true,
      ...data,
    })) || null
  return { helpCfg, helpGroups, image }
}

export class HelpPanel extends plugin {
  constructor() {
    super({
      name: "帮助面板",
      dsc: "可自定义内容与皮肤的帮助面板",
      event: "message",
      priority: 100,
      aiTool: false,
      rule: [
        {
          reg: RULE,
          fnc: "help",
        },
      ],
    })
  }

  async help(e) {
    const keyword = String(String(e.msg || "").match(RULE)?.[1] || "").trim()
    let result
    try {
      result = await renderHelpPanel({ keyword, isMaster: e.isMaster === true })
    } catch (err) {
      Bot.makeLog("warn", ["帮助面板图片生成失败", err.message], "HelpPanel")
    }

    const { helpCfg, helpGroups, image } = result || { helpCfg: null, helpGroups: [], image: null }
    if (!helpGroups.length) {
      return this.reply(
        keyword
          ? `没有找到与「${keyword}」相关的功能。`
          : "帮助面板还没有内容，可在 config/config/help.yaml 中配置。",
        true,
      )
    }
    if (image) return this.reply(segment.image(image))
    return this.reply(helpText(helpCfg, helpGroups), true)
  }
}
