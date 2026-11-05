/**
 * plugin的runtime，可通过e.runtime访问
 *
 * 提供一些常用的运行时变量、方法及model获取
 * 降低对目录结构的依赖
 */
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

/**
 * 常用的处理方法
 */

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

  /**
   *
   * @param plugin plugin key
   * @param path html文件路径，相对于plugin resources目录
   * @param data 渲染数据
   * @param cfg 渲染配置
   * @param cfg.retType 返回值类型
   * * default/空：自动发送图片，返回true
   * * msgId：自动发送图片，返回msg id
   * * base64: 不自动发送图像，返回图像base64数据
   * @param cfg.beforeRender({data}) 可改写渲染的data数据
   * @returns {Promise<boolean>}
   */
  async render(plugin, path, data = {}, cfg = {}) {
    // 处理传入的path
    path = path.replace(/.html$/, "")
    let paths = lodash.filter(path.split("/"), p => !!p)
    path = paths.join("/")
    // 创建目录
    await Bot.mkdir(`temp/html/${plugin}/${path}`)
    // 自动计算pluResPath
    let pluResPath = `../../../${lodash.repeat("../", paths.length)}plugins/${plugin}/resources/`
    // 渲染data
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

      /** 默认参数 **/
      _plugin: plugin,
      _htmlPath: path,
      pluResPath,
      tplFile: `./plugins/${plugin}/resources/${path}.html`,
      saveId: data.saveId || data.save_id || paths[paths.length - 1],
    }
    // 处理beforeRender
    if (cfg.beforeRender) {
      data = cfg.beforeRender({ data }) || data
    }
    // 保存模板数据
    if (process.argv.includes("dev")) {
      // debug下保存当前页面的渲染数据，方便模板编写与调试
      // 由于只用于调试，开发者只关注自己当时开发的文件即可，暂不考虑app及plugin的命名冲突
      const saveDir = `temp/ViewData/${plugin}`
      await Bot.mkdir(saveDir)
      const file = `${saveDir}/${data._htmlPath.split("/").join("_")}.json`
      await fs.writeFile(file, JSON.stringify(data))
    }
    // 截图
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
