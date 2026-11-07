import template from "art-template"
import chokidar from "chokidar"
import path from "node:path"
import fs from "node:fs"

export default class Renderer {
  constructor(data) {
    this.id = data.id || "renderer"
    this.type = data.type || "image"
    this.render = this[data.render || "render"]
    this.support_script = data.support_script ?? true
    this.dealTpl = Renderer.dealTpl.bind(Renderer)
  }

  static dir = "./temp/html"
  static html = {}
  static watcher = {}
  static tplQueue = new Map()

  static getTplPath(name, data) {
    return `./temp/html/${name}/${data.saveId ?? path.basename(String(name))}.html`
  }

  static async withTpl(name, data, render) {
    const key = path.resolve(this.getTplPath(name, data))
    const previous = this.tplQueue.get(key) || Promise.resolve()
    let release
    const current = new Promise(resolve => (release = resolve))
    this.tplQueue.set(key, current)
    await previous
    try {
      return await render()
    } finally {
      release()
      if (this.tplQueue.get(key) === current) this.tplQueue.delete(key)
    }
  }

  static createDir(dirname) {
    if (fs.existsSync(dirname)) {
      return true
    } else {
      if (this.createDir(path.dirname(dirname))) {
        fs.mkdirSync(dirname)
        return true
      }
    }
  }

  static readTpl(tplFile) {
    if (!this.html[tplFile]) {
      try {
        this.html[tplFile] = fs.readFileSync(tplFile, "utf8")
      } catch (error) {
        logger.error(`加载html错误：${tplFile}`)
        return false
      }
      this.watch(tplFile)
    }
    return this.html[tplFile]
  }

  static dealTpl(name, data) {
    const html = this.readTpl(data.tplFile)
    if (!html) return false

    data.resPath = `./resources/`
    const tmpHtml = template.render(html, data)
    this.createDir(`./temp/html/${name}`)
    const savePath = this.getTplPath(name, data)
    fs.writeFileSync(savePath, tmpHtml)

    logger.debug(`[图片生成][使用模板] ${savePath}`)
    return savePath
  }

  static watch(tplFile) {
    if (this.watcher[tplFile]) return

    const watcher = chokidar.watch(tplFile)
    watcher.on("change", () => {
      delete this.html[tplFile]
      logger.mark(`[修改html模板] ${tplFile}`)
    })

    this.watcher[tplFile] = watcher
  }
}
