import fs from "node:fs/promises"
import fsSync from "node:fs"
import lodash from "lodash"
import cfg from "../config/config.js"
import plugin, { PluginCleanup } from "./plugin.js"
import schedule from "node-schedule"
import { segment } from "oicq"
import chokidar from "chokidar"
import moment from "moment"
import path from "node:path"
import Runtime from "./runtime.js"
import Handler from "./handler.js"
import AIManager from "../ai/AIManager.js"
import AIToolRegistry from "../ai/AIToolRegistry.js"
import builtinModules from "../builtin/index.js"
import { WEBUI_DATA_DIR } from "../webui/dataDir.js"
import { pendingRemovalNames, purgePendingRemovals } from "../webui/pluginPendingRemove.js"

const SINGLE_STATE_FILE = path.join(WEBUI_DATA_DIR, "plugin-single-state.json")

global.plugin = plugin
global.segment = segment

class PluginsLoader {
  priority = []
  handler = {}
  task = []
  dir = "plugins"

  groupCD = {}
  singleCD = {}

  watcher = {}
  taskMap = new Map()
  initializerMap = new Map()
  pluginOperations = new Map()
  pluginCountMap = new Map()
  eventCache = new WeakMap()
  eventMap = {
    message: ["post_type", "message_type", "sub_type"],
    notice: ["post_type", "notice_type", "sub_type"],
    request: ["post_type", "request_type", "sub_type"],
  }

  msgThrottle = {}

  async getPlugins() {
    const files = await fs.readdir(this.dir, { withFileTypes: true })
    const ret = []
    const pendingRemove = pendingRemovalNames()
    for (const val of files) {
      if (val.isFile()) continue
      if (pendingRemove.has(val.name)) continue
      const tmp = {
        name: val.name,
        path: `../../${this.dir}/${val.name}`,
      }

      if (await Bot.fsStat(`${this.dir}/${val.name}/index.js`)) {
        tmp.path = `${tmp.path}/index.js`
        ret.push(tmp)
        continue
      }

      const apps = await fs.readdir(`${this.dir}/${val.name}`, { withFileTypes: true })
      for (const app of apps) {
        if (!app.isFile()) continue
        if (!app.name.endsWith(".js")) continue
        this.watch(val.name, app.name)
        if (this.isSinglePluginDisabled(`${val.name}/${app.name}`)) continue
        ret.push({
          name: `${tmp.name}/${app.name}`,
          path: `${tmp.path}/${app.name}`,
        })
      }
    }
    return ret
  }

  isSinglePluginDisabled(key) {
    const file = SINGLE_STATE_FILE
    try {
      const stat = fsSync.statSync(file)
      if (this._singleStateMtime !== stat.mtimeMs) {
        const raw = JSON.parse(fsSync.readFileSync(file, "utf8"))
        this._singleDisabled = new Set(Array.isArray(raw?.disabled) ? raw.disabled.map(String) : [])
        this._singleStateMtime = stat.mtimeMs
      }
      return this._singleDisabled.has(String(key))
    } catch {
      this._singleDisabled = new Set()
      this._singleStateMtime = 0
      return false
    }
  }

  async load(isRefresh = false) {
    if (isRefresh) {
      const keys = new Set([
        ...this.priority.map(i => i.key),
        ...this.taskMap.keys(),
        ...this.pluginCountMap.keys(),
        ...this.initializerMap.keys(),
        ...this.pluginOperations.keys(),
      ])
      for (const key of keys) await this.unloadPlugin(key)
    }
    if (this.priority.length) return

    try {
      const purged = await purgePendingRemovals()
      if (purged.removed.length)
        Bot.makeLog("info", `已清理残留插件目录：${purged.removed.join("、")}`, "Plugin")
      if (purged.failed.length)
        Bot.makeLog("warn", `残留插件目录仍被占用：${purged.failed.join("、")}`, "Plugin")
    } catch {}

    Bot.makeLog("info", "-----------", "Plugin")
    Bot.makeLog("info", "加载插件中...", "Plugin")

    const files = await this.getPlugins()
    const modules = [...files, ...builtinModules]
    this.pluginCount = 0
    this.builtinCount = 0
    const packageErr = []

    await Promise.allSettled(
      modules.map(async file => {
        if (
          (await Bot.sleep(
            cfg.bot.plugin_load_timeout * 1000,
            this.importPlugin(file, packageErr),
          )) === Bot.sleepTimeout
        )
          Bot.makeLog("error", `插件加载超时 ${logger.red(file.name)}`, "Plugin")
      }),
    )

    this.packageTips(packageErr)
    this.createTask()

    Bot.makeLog("info", `加载定时任务[${this.task.length}个]`, "Plugin")
    Bot.makeLog("info", `加载插件[${this.pluginCount - this.builtinCount}个]`, "Plugin")
    if (builtinModules.length)
      Bot.makeLog("info", `已挂载核心内置模块[${builtinModules.length}个]`, "Plugin")
    if (cfg.ai?.autoRegisterTools === true) {
      const stats = AIToolRegistry.getStats()
      Bot.makeLog("info", `注册 AI 工具[${stats.totalTools}个]`, "AITool")
    }

    this.priority = lodash.orderBy(this.priority, ["priority"], ["asc"])
  }

  load_time = {}
  async importPlugin(file, packageErr) {
    const start_time = Date.now()
    let success = true
    this.pluginCountMap.set(file.name, 0)
    try {
      const module = await import(file.path)
      const app = module.apps ? { ...module.apps } : module
      const pluginArray = []
      lodash.forEach(app, p => pluginArray.push(this.loadPlugin(file, p)))
      for (const i of await Promise.allSettled(pluginArray))
        if (i?.status && i.status !== "fulfilled") {
          success = false
          Bot.makeLog("error", [`插件加载错误 ${logger.red(file.name)}`, i], "Plugin")
        }
    } catch (error) {
      success = false
      if (packageErr && error.stack.includes("Cannot find package")) {
        packageErr.push({ error, file })
      } else {
        Bot.makeLog("error", [`插件加载错误 ${logger.red(file.name)}`, error], "Plugin")
      }
    }
    this.load_time[file.name] = Date.now() - start_time
    return success
  }

  async loadPlugin(file, p) {
    if (!p?.prototype) return
    this.pluginCount++
    if (file.builtin) this.builtinCount++
    this.pluginCountMap.set(file.name, (this.pluginCountMap.get(file.name) ?? 0) + 1)
    const init = new p()
    Bot.makeLog("debug", `加载插件 [${file.name}][${init.name}]`, "Plugin")
    try {
      if (init.init && (await init.init()) === "return") {
        await this.disposeInitializers([init])
        return
      }
      this.collectTask(init.task, init.name, file.name)
      const plugin = new p()
      if (plugin.rule)
        for (const i of plugin.rule) if (!(i.reg instanceof RegExp)) i.reg = new RegExp(i.reg)

      const namespace = plugin.namespace || file.name
      const entry = {
        plugin,
        class: p,
        key: file.name,
        name: plugin.name,
        priority: plugin.priority,
        namespace,
        builtin: !!file.builtin,
      }
      this.priority.push(entry)
      AIToolRegistry.registerPlugin(entry)
      this.registerHandlers(plugin, namespace)
      if (init[PluginCleanup]?.length) {
        const initializers = this.initializerMap.get(file.name) ?? new Set()
        initializers.add(init)
        this.initializerMap.set(file.name, initializers)
      }
    } catch (error) {
      await this.disposeInitializers([init])
      throw error
    }
  }

  registerHandlers(plugin, namespace = plugin.namespace) {
    if (!plugin.handler) return
    lodash.forEach(plugin.handler, ({ fn, key, priority }) => {
      Handler.add({
        ns: namespace,
        key,
        self: plugin,
        priority: priority ?? plugin.priority,
        fn: plugin[fn],
      })
    })
  }

  packageTips(packageErr) {
    if (!packageErr.length) return
    Bot.makeLog("error", "--------- 插件加载错误 ---------", "Plugin")
    for (const i of packageErr) {
      const pack = i.error.stack.match(/'(.+?)'/g)[0].replace(/'/g, "")
      Bot.makeLog("error", `${logger.cyan(i.file.name)} 缺少依赖 ${logger.red(pack)}`, "Plugin")
    }
    Bot.makeLog("error", `安装插件后请 ${logger.red("pnpm i")} 安装依赖`, "Plugin")
    Bot.makeLog("error", `仍报错${logger.red("进入插件目录")} pnpm add 依赖`, "Plugin")
    Bot.makeLog("error", "--------------------------------", "Plugin")
  }

  async deal(e) {
    this.count(e, "receive", e.message)
    if (!this.checkBlack(e)) return
    const groupCfg = cfg.getGroup(e.self_id, e.group_id)
    if (e.group_id) {
      const disabledBots = Array.isArray(groupCfg.disabledBots) ? groupCfg.disabledBots : []
      if (disabledBots.some(id => String(id) === String(e.self_id))) return
    }
    if (!this.checkLimit(e, groupCfg)) return
    this.dealEvent(e, groupCfg)
    if (e.only_reply_at) this.setLimit(e, groupCfg)
    this.reply(e)
    await Runtime.init(e)

    const priority = []
    for (const i of this.priority) {
      if (
        this.checkDisable(Object.assign(i.plugin, { e }), groupCfg) &&
        this.filtEvent(e, i.plugin)
      )
        priority.push(i)
    }

    for (const i of priority) {
      if (!i.plugin.getContext) continue
      const context = {
        ...i.plugin.getContext(),
        ...i.plugin.getContext(false, true),
      }
      if (!lodash.isEmpty(context)) {
        let ret
        for (const fnc in context)
          ret ||= await Object.assign(new i.class(e), { e })[fnc](context[fnc])
        if (ret === "continue") continue
        return
      }
    }

    if (!e.only_reply_at) {
      if (!(await this.runMatchedRule(e, priority))) await this.aiFallback(e)
      return
    }

    for (const i of priority)
      if (i.plugin.accept) {
        const res = await Object.assign(new i.class(e), { e }).accept(e)
        if (res === "return") return
        if (res) break
      }

    for (const i of priority) {
      if (i.plugin.rule)
        for (const v of i.plugin.rule) {
          if (v.event && !this.filtEvent(e, v)) continue

          if (!v.reg.test(e.msg)) continue
          const plugin = Object.assign(new i.class(e), { e })
          e.logFnc = `${logger.blue(`[${plugin.name}(${v.fnc})]`)}`

          Bot.makeLog(
            v.log === false ? "debug" : "info",
            `${e.logText}${e.logFnc}${logger.yellow("[开始处理]")}`,
            false,
          )

          if (this.filtPermission(e, v))
            try {
              const start_time = Date.now()
              const res = plugin[v.fnc] && (await plugin[v.fnc](e))
              if (res === false) continue
              Bot.makeLog(
                v.log === false ? "debug" : "mark",
                `${e.logText}${e.logFnc}${logger.green(`[完成${Bot.getTimeDiff(start_time)}]`)}`,
                false,
              )
            } catch (err) {
              Bot.makeLog("error", [`${e.logText}${e.logFnc}`, err], false)
            }
          return
        }
    }

    Bot.makeLog("debug", `${e.logText}${logger.blue(`[暂无插件处理]`)}`, false)
    await this.aiFallback(e)
  }

  async runMatchedRule(e, plugins) {
    const priority = plugins || this.priority
    for (const i of priority) {
      if (!i.plugin?.rule) continue
      for (const v of i.plugin.rule) {
        if (v.event && !this.filtEvent(e, v)) continue
        if (!(v.reg instanceof RegExp)) {
          try {
            v.reg = new RegExp(v.reg)
          } catch {
            continue
          }
        }
        if (!v.reg.test(e.msg)) continue
        if (!this.filtPermission(e, v)) return true
        const plugin = Object.assign(new i.class(e), { e })
        e.logFnc = `${logger.blue(`[${plugin.name}(${v.fnc})]`)}`
        Bot.makeLog("info", `${e.logText}${e.logFnc}${logger.yellow("[开始处理]")}`, false)
        try {
          const start_time = Date.now()
          const res = plugin[v.fnc] && (await plugin[v.fnc](e))
          if (res === false) continue
          Bot.makeLog(
            "mark",
            `${e.logText}${e.logFnc}${logger.green(`[完成${Bot.getTimeDiff(start_time)}]`)}`,
            false,
          )
        } catch (err) {
          Bot.makeLog("error", [`${e.logText}${e.logFnc}`, err], false)
        }
        return true
      }
    }
    return false
  }

  async aiFallback(e) {
    if (cfg.ai?.enabled !== true) return false
    try {
      return await AIManager.handleMessage(e)
    } catch (err) {
      Bot.makeLog("error", ["AI 消息处理错误", err], "AIManager")
      return false
    }
  }

  filtEvent(e, v) {
    if (!v.event) return false
    let cache = this.eventCache.get(v)
    if (!cache || cache.source !== v.event) {
      cache = { source: v.event, event: v.event.split(".") }
      this.eventCache.set(v, cache)
    }

    const eventMap = this.eventMap[e.post_type] || []
    const mappedEvent = cache.event.map((value, i) => (value === "*" ? value : e[eventMap[i]]))
    return v.event === mappedEvent.join(".")
  }

  filtPermission(e, v) {
    if (!v.permission || e.isMaster) return true

    if (v.permission === "master") {
      e.reply("暂无权限，只有主人才能操作")
      return false
    }

    if (e.isGroup) {
      if (v.permission === "owner" && !e.member.is_owner) {
        e.reply("暂无权限，只有群主才能操作")
        return false
      }
      if (v.permission === "admin" && !e.member.is_owner && !e.member.is_admin) {
        e.reply("暂无权限，只有管理员才能操作")
        return false
      }
    }

    return true
  }

  dealText(text = "") {
    if (cfg.bot["/→#"]) text = text.replace(/^\s*\/\s*/, "#")
    return text
      .replace(/^\s*[＃井]\s*/, "#")
      .replace(/^\s*[＊※]\s*/, "*")
      .trim()
  }

  dealEvent(e, groupCfg) {
    if (e.message)
      for (const i of e.message) {
        switch (i.type) {
          case "text":
            e.msg = (e.msg || "") + this.dealText(i.text)
            break
          case "image":
            if (Array.isArray(e.img)) e.img.push(i.url)
            else e.img = [i.url]
            break
          case "at":
            if (i.qq == e.self_id) e.atBot = true
            else e.at = i.qq
            break
          case "reply":
            e.reply_id = i.id
            if (e.group?.getMsg) e.getReply = () => e.group.getMsg(e.reply_id)
            else if (e.friend?.getMsg) e.getReply = () => e.friend.getMsg(e.reply_id)
            break
          case "file":
            e.file = i
            break
          case "xml":
          case "json":
            e.msg = (e.msg || "") + (typeof i.data === "string" ? i.data : JSON.stringify(i.data))
            break
        }
      }

    e.logText = ""
    e.sender && (e.sender.card ||= e.sender.nickname)
    if (e.message_type === "private" || e.notice_type === "friend") {
      e.isPrivate = true
      e.logText = `[${e.sender?.nickname ? `${e.sender.nickname}(${e.user_id})` : e.user_id}]`

      if (!e.recall && e.message_id && e.friend?.recallMsg)
        e.recall = e.friend.recallMsg.bind(e.friend, e.message_id)
    } else if (e.message_type === "group" || e.notice_type === "group") {
      e.isGroup = true
      e.logText = `[${e.group_name ? `${e.group_name}(${e.group_id})` : e.group_id}, ${e.sender?.card ? `${e.sender.card}(${e.user_id})` : e.user_id}]`

      if (!e.recall && e.message_id && e.group?.recallMsg)
        e.recall = e.group.recallMsg.bind(e.group, e.message_id)
    }

    e.logText = `${logger.cyan(e.logText)}${logger.red(`[${lodash.truncate(e.msg || e.raw_message || [e.post_type, e.notice_type, e.sub_type].filter(i => i).join("."), { length: 100 })}]`)}`

    Object.defineProperty(e, "isMaster", {
      value: e.user_id && cfg.master[e.self_id]?.includes(String(e.user_id)) ? true : false,
      writable: false,
      configurable: false,
    })

    if (e.msg && e.isGroup && !e.atBot) {
      groupCfg ||= cfg.getGroup(e.self_id, e.group_id)
      const alias = groupCfg.botAlias
      for (const i of Array.isArray(alias) ? alias : [alias])
        if (e.msg.startsWith(i)) {
          e.msg = e.msg.replace(i, "")
          e.hasAlias = true
          break
        }
    }

    e.only_reply_at = this.onlyReplyAt(e, groupCfg)
  }

  reply(e) {
    if (!e.reply?.bind) return
    const reply = e.reply.bind(e)

    e.reply = async (msg = "", quote = false, data = {}) => {
      if (!msg) return false

      let { recallMsg = 0, at = "" } = data

      if (at && e.isGroup) {
        if (at === true) at = e.user_id
        if (Array.isArray(msg)) msg.unshift(segment.at(at), "\n")
        else msg = [segment.at(at), "\n", msg]
      }

      if (quote && e.message_id) {
        if (Array.isArray(msg)) msg.unshift(segment.reply(e.message_id))
        else msg = [segment.reply(e.message_id), msg]
      }

      let res
      try {
        res = await reply(msg)
      } catch (err) {
        Bot.makeLog("error", ["发送消息错误", msg, err], e.self_id)
        res = { error: [err] }
      }

      if (recallMsg > 0 && res?.message_id) {
        if (e.group?.recallMsg)
          setTimeout(() => {
            e.group.recallMsg(res.message_id)
            if (e.message_id) e.group.recallMsg(e.message_id)
          }, recallMsg * 1000)
        else if (e.friend?.recallMsg)
          setTimeout(() => {
            e.friend.recallMsg(res.message_id)
            if (e.message_id) e.friend.recallMsg(e.message_id)
          }, recallMsg * 1000)
      }

      this.count(e, "send", msg)
      return res
    }
  }

  async count(e, type, msg) {
    const count = new Map([[`${type}:msg`, 1]])
    if (cfg.bot.msg_type_count)
      for (const i of Array.isArray(msg) ? msg : [msg]) {
        const key = `${type}:${i?.type || "text"}`
        count.set(key, (count.get(key) || 0) + 1)
      }
    await this.saveCounts(e, count)
  }

  async saveCount(e, type) {
    await this.saveCounts(e, new Map([[type, 1]]))
  }

  async saveCounts(e, count) {
    const key = []

    const now = moment()
    const day = now.format("YYYY:MM:DD")
    const month = now.format("YYYY:MM")
    const year = now.format("YYYY")
    for (const i of [day, month, year, "total"]) {
      key.push(`total:${i}`)
      if (e.self_id) key.push(`bot:${e.self_id}:${i}`)
      if (e.user_id) key.push(`user:${e.user_id}:${i}`)
      if (e.group_id) key.push(`group:${e.group_id}:${i}`)
    }

    const multi = redis.multi()
    for (const [type, value] of count)
      for (const i of key) multi.incrBy(`Yz:count:${type}:${i}`, value)
    await multi.exec()
  }

  collectTask(task, name, key) {
    if (!task) return
    const tasks = key && (this.taskMap.get(key) ?? new Set())
    if (key) this.taskMap.set(key, tasks)
    for (const i of Array.isArray(task) ? task : [task])
      if (i?.cron && i?.fnc) {
        i.name ??= name
        this.task.push(i)
        tasks?.add(i)
      }
  }

  async startTask(name, i) {
    try {
      const start_time = Date.now()
      Bot.makeLog(
        i.log === false ? "debug" : "mark",
        `${name}${logger.yellow("[开始处理]")}`,
        false,
      )
      await i.fnc()
      Bot.makeLog(
        i.log === false ? "debug" : "mark",
        `${name}${logger.green(`[完成${Bot.getTimeDiff(start_time)}]`)}`,
        false,
      )
    } catch (err) {
      Bot.makeLog("error", [name, err], false)
    }
  }

  createTask() {
    const created = new Set()
    for (const i of this.task) {
      if (i.job?.cancel) i.job.cancel()
      const name = `${logger.blue(`[${i.name}(${i.cron})]`)}`
      if (created.has(name)) {
        Bot.makeLog("warn", `重复定时任务 ${name} 已跳过`, "Task")
        continue
      }
      created.add(name)
      Bot.makeLog("debug", `加载定时任务 ${name}`, "Task")
      i.job = schedule.scheduleJob(
        i.cron.split(/\s+/).slice(0, 6).join(" "),
        this.startTask.bind(this, name, i),
      )
    }
  }

  checkLimit(e, config) {
    if (
      e.group &&
      (e.group.mute_left > 0 || (e.group.all_muted && !e.group.is_admin && !e.group.is_owner))
    )
      return false
    if (!e.message || e.isPrivate) return true

    config ||= cfg.getGroup(e.self_id, e.group_id)

    if (config.groupCD && this.groupCD[`${e.self_id}.${e.group_id}`]) return false

    if (config.singleCD && this.singleCD[`${e.self_id}.${e.group_id}.${e.user_id}`]) return false

    const msgId = `${e.self_id}:${e.user_id}:${e.raw_message}`
    if (this.msgThrottle[msgId]) return false

    this.msgThrottle[msgId] = true
    setTimeout(() => delete this.msgThrottle[msgId], 1000)

    return true
  }

  setLimit(e, config) {
    if (e.isPrivate) return
    config ||= cfg.getGroup(e.self_id, e.group_id)

    if (config.groupCD) {
      const key = `${e.self_id}.${e.group_id}`
      this.groupCD[key] = true
      setTimeout(() => delete this.groupCD[key], config.groupCD)
    }
    if (config.singleCD) {
      const key = `${e.self_id}.${e.group_id}.${e.user_id}`
      this.singleCD[key] = true
      setTimeout(() => delete this.singleCD[key], config.singleCD)
    }
  }

  onlyReplyAt(e, groupCfg) {
    if (!e.message || e.isPrivate) return true

    groupCfg ||= cfg.getGroup(e.self_id, e.group_id)

    if (groupCfg.onlyReplyAt === 0 || !groupCfg.botAlias) return true

    if (groupCfg.onlyReplyAt === 2 && e.isMaster) return true

    if (e.atBot) return true

    if (e.hasAlias) return true

    return false
  }

  checkBlack(e) {
    const other = cfg.getOther()

    if (other.blackUser?.length && other.blackUser.includes(Number(e.user_id) || String(e.user_id)))
      return false
    if (
      other.whiteUser?.length &&
      !other.whiteUser.includes(Number(e.user_id) || String(e.user_id))
    )
      return false

    if (e.group_id) {
      if (
        other.blackGroup?.length &&
        other.blackGroup.includes(Number(e.group_id) || String(e.group_id))
      )
        return false
      if (
        other.whiteGroup?.length &&
        !other.whiteGroup.includes(Number(e.group_id) || String(e.group_id))
      )
        return false
    }

    return true
  }

  checkDisable(p, groupCfg) {
    groupCfg ||= cfg.getGroup(p.e.self_id, p.e.group_id)
    if (groupCfg.disable?.length && groupCfg.disable.includes(p.name)) return false
    if (groupCfg.enable?.length && !groupCfg.enable.includes(p.name)) return false
    return true
  }

  async disposeInitializers(initializers) {
    const pending = []
    for (const init of initializers ?? [])
      for (const cleanup of init[PluginCleanup] ?? []) {
        if (!cleanup.active) continue
        cleanup.active = false
        try {
          pending.push({ init, promise: Promise.resolve(cleanup.dispose.call(init)) })
        } catch (error) {
          Bot.makeLog("error", ["插件资源回收错误", init.name, error], "Plugin")
        }
      }
    const results = await Promise.allSettled(pending.map(i => i.promise))
    for (const [index, result] of results.entries())
      if (result.status === "rejected")
        Bot.makeLog(
          "error",
          ["插件资源回收错误", pending[index].init.name, result.reason],
          "Plugin",
        )
  }

  async restoreInitializers(initializers) {
    for (const init of initializers ?? [])
      for (const cleanup of init[PluginCleanup] ?? []) {
        if (cleanup.active || !cleanup.restore) continue
        cleanup.active = true
        try {
          await cleanup.restore.call(init)
        } catch (error) {
          Bot.makeLog("error", ["插件资源恢复错误", init.name, error], "Plugin")
        }
      }
  }

  withPluginOperation(key, callback) {
    const previous = this.pluginOperations.get(key)
    if (!previous && !this.initializerMap.has(key)) return callback()

    const pending = Promise.withResolvers()
    const operation = pending.promise.finally(() => {
      if (this.pluginOperations.get(key) === operation) this.pluginOperations.delete(key)
    })
    this.pluginOperations.set(key, operation)
    const start = () => {
      try {
        Promise.resolve(callback()).then(pending.resolve, pending.reject)
      } catch (error) {
        pending.reject(error)
      }
    }
    if (previous) previous.catch(() => {}).then(start)
    else start()
    return operation
  }

  async unloadPlugin(key, closeWatcher = false) {
    return this.withPluginOperation(key, () => this.#unloadPlugin(key, closeWatcher))
  }

  async #unloadPlugin(key, closeWatcher = false) {
    const initializers = this.initializerMap.get(key)
    this.initializerMap.delete(key)
    const disposal = this.disposeInitializers(initializers)
    const entries = this.priority.filter(i => i.key === key)
    const namespaces = new Set(entries.map(i => i.namespace || i.plugin.namespace || key))
    for (const ns of namespaces) Handler.del(ns)

    const tasks = this.taskMap.get(key)
    if (tasks) {
      for (const i of tasks) i.job?.cancel?.()
      this.task = this.task.filter(i => !tasks.has(i))
      this.taskMap.delete(key)
    }

    this.priority = this.priority.filter(i => i.key !== key)
    AIToolRegistry.unregisterPlugin(key)
    const pluginCount = this.pluginCountMap.get(key) ?? entries.length
    if (typeof this.pluginCount === "number")
      this.pluginCount = Math.max(0, this.pluginCount - pluginCount)
    this.pluginCountMap.delete(key)
    delete this.load_time[key]

    if (closeWatcher) {
      const watcherKey = key.replace("/", ".")
      const watcher = this.watcher[watcherKey]
      if (watcher) {
        watcher.changeHandler?.cancel?.()
        watcher.unlinkHandler?.cancel?.()
        await Promise.resolve(watcher.close?.()).catch(() => {})
        delete this.watcher[watcherKey]
      }
    }
    await disposal
  }

  async changePlugin(key) {
    return this.withPluginOperation(key, () => this.#changePlugin(key))
  }

  async closePluginWatchers(name) {
    const prefix = `${name}.`
    for (const key of Object.keys(this.watcher)) {
      if (key !== name && !key.startsWith(prefix)) continue
      const watcher = this.watcher[key]
      delete this.watcher[key]
      try {
        watcher?.changeHandler?.cancel?.()
        watcher?.unlinkHandler?.cancel?.()
        await Promise.resolve(watcher?.close?.()).catch(() => {})
      } catch {}
    }
  }

  async #changePlugin(key) {
    if (this.isSinglePluginDisabled(key)) {
      await this.#unloadPlugin(key)
      return
    }
    const oldPriority = this.priority.filter(i => i.key === key)
    const oldTasks = this.taskMap.get(key)
    const oldInitializers = this.initializerMap.get(key)
    const oldPluginFileCount = this.pluginCountMap.get(key)
    const oldLoadTime = this.load_time[key]
    const oldPluginCount = this.pluginCount
    try {
      await this.#unloadPlugin(key)
      const success = await this.importPlugin({
        name: key,
        path: `../../${this.dir}/${key}?${moment().format("x")}`,
      })
      if (!success) {
        await this.#unloadPlugin(key)
        this.priority.push(...oldPriority)
        if (oldTasks) {
          const tasks = [...oldTasks]
          this.task.push(...tasks)
          this.taskMap.set(key, new Set(tasks))
        }
        if (oldLoadTime !== undefined) this.load_time[key] = oldLoadTime
        this.pluginCount = oldPluginCount
        if (oldPluginFileCount !== undefined) this.pluginCountMap.set(key, oldPluginFileCount)
        for (const i of oldPriority) {
          AIToolRegistry.registerPlugin(i)
          this.registerHandlers(i.plugin, i.namespace || key)
        }
        if (oldInitializers) {
          this.initializerMap.set(key, oldInitializers)
          await this.restoreInitializers(oldInitializers)
        }
      }
      this.priority = lodash.orderBy(this.priority, ["priority"], ["asc"])
      this.createTask()
    } catch (err) {
      Bot.makeLog("error", [`插件加载错误 ${logger.red(key)}`, err], "Plugin")
    }
  }

  watch(dirName, appName) {
    this.watchDir(dirName)
    if (this.watcher[`${dirName}.${appName}`]) return

    const file = `./${this.dir}/${dirName}/${appName}`
    const watcher = chokidar.watch(file)
    const key = `${dirName}/${appName}`

    const changeHandler = lodash.debounce(() => {
      Bot.makeLog("mark", `[修改插件][${dirName}][${appName}]`, "Plugin")
      this.changePlugin(key)
    }, 5000)
    watcher.on("change", changeHandler)

    const unlinkHandler = lodash.debounce(async () => {
      Bot.makeLog("mark", `[卸载插件][${dirName}][${appName}]`, "Plugin")
      await this.unloadPlugin(key, true)
    }, 5000)
    watcher.on("unlink", unlinkHandler)
    watcher.changeHandler = changeHandler
    watcher.unlinkHandler = unlinkHandler
    this.watcher[`${dirName}.${appName}`] = watcher
  }

  watchDir(dirName) {
    if (this.watcher[dirName]) return
    const watcher = chokidar.watch(`./${this.dir}/${dirName}/`)
    Bot.once("online", () => {
      const pendingPaths = new Set()
      const addHandler = lodash.debounce(async () => {
        const paths = [...pendingPaths]
        pendingPaths.clear()
        for (const PluPath of paths) {
          const appName = path.basename(PluPath)
          Bot.makeLog("mark", `[新增插件][${dirName}][${appName}]`, "Plugin")
          const key = `${dirName}/${appName}`
          await this.withPluginOperation(key, async () => {
            await this.importPlugin({
              name: key,
              path: `../../${this.dir}/${key}?${moment().format("X")}`,
            })
            this.priority = lodash.orderBy(this.priority, ["priority"], ["asc"])
            this.createTask()
            this.watch(dirName, appName)
          })
        }
      }, 5000)
      watcher.on("add", PluPath => {
        if (!PluPath.endsWith(".js")) return
        pendingPaths.add(PluPath)
        addHandler()
      })
    })
    this.watcher[dirName] = watcher
  }
}
export default new PluginsLoader()
