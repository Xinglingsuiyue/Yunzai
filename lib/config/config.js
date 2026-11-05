import YAML from "yaml"
import fs from "node:fs"
import chokidar from "chokidar"
import _ from "lodash"
import EventEmitter from "node:events"

/**
 * 官机群号的真实分隔符是 U+F03A（私用区字符，形似冒号），
 * 统一归一化成半角冒号，方便比较和校验。
 */
export function normalizeGroupId(id) {
  return String(id ?? "").replace(/[\uF03A\uFF1A]/g, ":")
}

/** 合法群号：纯数字，或官机「机器人号<分隔符>群openid」 */
export function isGroupId(id) {
  return /^\d{3,20}$/.test(String(id ?? "")) ||
    /^\d{3,20}:[\dA-Za-z_-]{6,64}$/.test(normalizeGroupId(id))
}

/** 配置文件 */
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

  /** 初始化配置 */
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

  /** 主人账号 */
  get masterQQ() {
    const other = this.getAllCfg("other")
    if (other.masterQQs) return other.masterQQs
    let masterQQ = other.masterQQ || []

    if (!Array.isArray(masterQQ)) masterQQ = [masterQQ]

    return (this.config["config.other"].masterQQs = masterQQ.map(i => Number(i) || i))
  }

  /** Bot账号:[主人帐号] */
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

  /** 机器人账号 */
  get uin() {
    return Object.keys(this.master)
  }
  get qq() {
    return this.uin
  }

  /** package.json */
  get package() {
    if (this._package) return this._package
    return (this._package = JSON.parse(fs.readFileSync("package.json", "utf8")))
  }

  /** 群配置 */
  getGroup(bot_id = "", group_id = "") {
    // 官机群的 group_id 形如「机器人号<分隔符>群openid」，分隔符是 U+F03A（私用区字符），
    // 看起来像冒号但不是 ':'，统一归一化后再匹配配置键
    const rawBotId = String(bot_id)
    const rawGroupId = normalizeGroupId(group_id)
    const bareGroupId =
      rawBotId && rawGroupId.startsWith(`${rawBotId}:`)
        ? rawGroupId.slice(rawBotId.length + 1)
        : rawGroupId
    const fullGroupId = `${rawBotId}:${bareGroupId}`

    // 缓存优先；缓存里没有这个群专属配置时，直接读文件兜底，
    // 避免 Windows 上 chokidar 漏掉 WebUI「写临时文件再 rename」的更新（3 秒节流）
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

  /** other配置 */
  getOther() {
    return this.getAllCfg("other")
  }

  /**
   * @param app  功能
   * @param name 配置文件名称
   */
  getdefSet(name) {
    return this.getYaml("default_config", name)
  }

  /** 用户配置 */
  getConfig(name) {
    return this.getYaml("config", name)
  }

  getAllCfg(name) {
    return {
      ...this.getdefSet(name),
      ...this.getConfig(name),
    }
  }

  /** 直接读文件，绕过内存缓存（Windows 上 chokidar 可能漏事件） */
  readYamlFile(type, name) {
    const file = `config/${type}/${name}.yaml`
    try {
      const parsed = YAML.parse(fs.readFileSync(file, "utf8"))
      return parsed && typeof parsed === "object" ? parsed : undefined
    } catch {
      return undefined
    }
  }

  /**
   * 获取配置yaml
   * @param type 默认配置-defSet，用户配置-config
   * @param name 名称
   */
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

  /** 监听配置文件 */
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
    /** 修改日志等级 */
    ;(await import("./log.js")).default()
  }
})()
