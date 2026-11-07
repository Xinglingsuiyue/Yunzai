import YAML from "yaml"
import fs from "node:fs"
import chokidar from "chokidar"
import _ from "lodash"
import EventEmitter from "node:events"

export function normalizeGroupId(id) {
  return String(id ?? "").replace(/[\uF03A\uFF1A]/g, ":")
}

export function isGroupId(id) {
  return /^\d{3,20}$/.test(String(id ?? "")) ||
    /^\d{3,20}:[\dA-Za-z_-]{6,64}$/.test(normalizeGroupId(id))
}

export default new (class Cfg {
  constructor() {
    this.config = {}
    this.watcher = {}
    this.initCfg()

    if (this.getAllCfg("bot").file_watch === false) {
      class FSWatcher extends EventEmitter {
        constructor() {
          super()
        }
        on() {
          return this
        }
        addListener() {
          return this
        }
        start() {}
        close() {}
        ref() {
          return this
        }
        unref() {
          return this
        }
      }
      const watch = new FSWatcher()
      fs.watch = () => watch
      chokidar.watch = () => watch
      chokidar.FSWatcher = FSWatcher

      for (const i in this.watcher) {
        this.watcher[i].close()
        delete this.watcher[i]
      }
      this.watch = () => {}
    }

    return new Proxy(this, {
      get: (target, prop) => target[prop] ?? target.getAllCfg(String(prop)),
    })
  }

  initCfg() {
    const path = "config/config/"
    const pathDef = "config/default_config/"
    const filesDef = fs.readdirSync(pathDef)
    if (fs.existsSync(path)) {
      const files = fs.readdirSync(path)
      for (const i of filesDef)
        if (!files.includes(i)) fs.copyFileSync(`${pathDef}${i}`, `${path}${i}`)
    } else fs.cpSync(pathDef, path, { recursive: true })
  }

  get masterQQ() {
    const other = this.getAllCfg("other")
    if (other.masterQQs) return other.masterQQs
    let masterQQ = other.masterQQ || []

    if (!Array.isArray(masterQQ)) masterQQ = [masterQQ]

    return (this.config["config.other"].masterQQs = masterQQ.map(i => Number(i) || i))
  }

  get master() {
    const other = this.getAllCfg("other")
    if (other.masters) return other.masters
    let master = other.master || []

    if (!Array.isArray(master)) master = [master]

    const masters = {}
    for (let i of master) {
      i = i.split(":")
      const bot_id = i.shift()
      const user_id = i.join(":")
      if (Array.isArray(masters[bot_id])) masters[bot_id].push(user_id)
      else masters[bot_id] = [user_id]
    }
    return (this.config["config.other"].masters = masters)
  }

  get uin() {
    return Object.keys(this.master)
  }
  get qq() {
    return this.uin
  }

  get package() {
    if (this._package) return this._package
    return (this._package = JSON.parse(fs.readFileSync("package.json", "utf8")))
  }

  getGroup(bot_id = "", group_id = "") {
    const rawBotId = String(bot_id)
    const rawGroupId = normalizeGroupId(group_id)
    const bareGroupId =
      rawBotId && rawGroupId.startsWith(`${rawBotId}:`)
        ? rawGroupId.slice(rawBotId.length + 1)
        : rawGroupId
    const fullGroupId = `${rawBotId}:${bareGroupId}`

    let config = this.getAllCfg("group")
    const hasOwn = [rawGroupId, bareGroupId, fullGroupId].some(id => config[id])
    if (!hasOwn && group_id && Date.now() - (this._groupReloadAt || 0) > 3000) {
      this._groupReloadAt = Date.now()
      const live = this.readYamlFile("config", "group")
      if (live) {
        this.config["config.group"] = live
        config = this.getAllCfg("group")
      }
    }

    return {
      ...config.default,
      ...config[`${rawBotId}:default`],
      ...config[rawGroupId],
      ...config[bareGroupId],
      ...config[fullGroupId],
    }
  }

  getOther() {
    return this.getAllCfg("other")
  }

  getdefSet(name) {
    return this.getYaml("default_config", name)
  }

  getConfig(name) {
    return this.getYaml("config", name)
  }

  getAllCfg(name) {
    return {
      ...this.getdefSet(name),
      ...this.getConfig(name),
    }
  }

  readYamlFile(type, name) {
    const file = `config/${type}/${name}.yaml`
    try {
      const parsed = YAML.parse(fs.readFileSync(file, "utf8"))
      return parsed && typeof parsed === "object" ? parsed : undefined
    } catch {
      return undefined
    }
  }

  getYaml(type, name) {
    const key = `${type}.${name}`
    if (key in this.config) return this.config[key]
    const file = `config/${type}/${name}.yaml`

    try {
      this.config[key] = YAML.parse(fs.readFileSync(file, "utf8"))
    } catch (err) {
      Bot.makeLog("trace", ["读取配置文件", file, "错误", err], "Config")
      return (this.config[key] = undefined)
    }

    this.watch(file, name, type)
    return this.config[key]
  }

  watch(file, name, type = "default_config") {
    const key = `${type}.${name}`
    if (this.watcher[key]) return

    this.watcher[key] = chokidar.watch(file)
    this.watcher[key].on(
      "change",
      _.debounce(() => {
        delete this.config[key]
        if (typeof Bot !== "object") return
        Bot.makeLog("mark", `[修改配置文件][${type}][${name}]`, "Config")
        if (`change_${name}` in this) this[`change_${name}`]()
      }, 5000),
    )
  }

  async change_bot() {
    ;(await import("./log.js")).default()
  }
})()
