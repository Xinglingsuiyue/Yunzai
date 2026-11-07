import lodash from "lodash"
import fs from "node:fs/promises"
import { fileURLToPath } from "node:url"
import common from "../common/common.js"
import cfg from "../config/config.js"
import puppeteer from "../puppeteer/puppeteer.js"
import Handler from "./handler.js"

const { version: yunzaiVersion } = JSON.parse(
  await fs.readFile(new URL("../../package.json", import.meta.url), "utf-8"),
)
const layoutPath = fileURLToPath(new URL("../render/layout/", import.meta.url))
const tplPath = fileURLToPath(new URL("../render/tpl/", import.meta.url))


export default class Runtime {
  constructor(e) {
    this.e = e

    this.handler = {
      has: Handler.has,
      call: Handler.call,
      callAll: Handler.callAll,
    }
  }

  get cfg() {
    return cfg
  }

  get common() {
    return common
  }

  get puppeteer() {
    return puppeteer
  }

  async render(plugin, path, data = {}, cfg = {}) {
    path = path.replace(/.html$/, "")
    let paths = lodash.filter(path.split("/"), p => !!p)
    path = paths.join("/")
    await Bot.mkdir(`temp/html/${plugin}/${path}`)
    let pluResPath = `../../../${lodash.repeat("../", paths.length)}plugins/${plugin}/resources/`
    data = {
      sys: {
        scale: 1,
      },
      copyright: `Created By TRSS-Yunzai<span class="version">${yunzaiVersion}</span> `,
      _res_path: pluResPath,
      _tpl_path: tplPath,
      defaultLayout: `${layoutPath}default.html`,
      elemLayout: `${layoutPath}elem.html`,

      ...data,

      _plugin: plugin,
      _htmlPath: path,
      pluResPath,
      tplFile: `./plugins/${plugin}/resources/${path}.html`,
      saveId: data.saveId || data.save_id || paths[paths.length - 1],
    }
    if (cfg.beforeRender) {
      data = cfg.beforeRender({ data }) || data
    }
    if (process.argv.includes("dev")) {
      const saveDir = `temp/ViewData/${plugin}`
      await Bot.mkdir(saveDir)
      const file = `${saveDir}/${data._htmlPath.split("/").join("_")}.json`
      await fs.writeFile(file, JSON.stringify(data))
    }
    let base64 = await puppeteer.screenshot(`${plugin}/${path}`, data)
    if (cfg.retType === "base64") {
      return base64
    }
    let ret = true
    if (base64) {
      if (cfg.recallMsg) {
        ret = await this.e.reply(base64, false, {})
      } else {
        ret = await this.e.reply(base64)
      }
    }
    return cfg.retType === "msgId" ? ret : true
  }

  static async init(e) {
    e.runtime = new Runtime(e)
    return e.runtime
  }
}
