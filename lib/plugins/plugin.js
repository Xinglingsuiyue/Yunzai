const stateArr = {}
const SymbolTimeout = Symbol("Timeout")
const SymbolResolve = Symbol("Resolve")
export const PluginCleanup = Symbol("PluginCleanup")

export default class plugin {
  constructor({
    name = "your-plugin",
    dsc = "无",
    handler,
    namespace,
    event = "message",
    priority = 5000,
    task = { name: "", fnc: "", cron: "" },
    rule = [],
    aiDesc = "",
    aiTool,
  }) {
    this.name = name
    this.dsc = dsc
    this.event = event
    this.priority = priority
    this.task = task
    this.rule = rule
    this.aiDesc = aiDesc
    this.aiTool = aiTool

    if (handler) {
      this.handler = handler
      this.namespace = namespace || ""
    }
  }

  reply(msg = "", quote = false, data = {}) {
    if (!this.e?.reply || !msg) return false
    return this.e.reply(msg, quote, data)
  }

  addCleanup(dispose, restore) {
    if (typeof dispose !== "function" || (restore !== undefined && typeof restore !== "function"))
      throw new TypeError("插件资源回收与恢复必须为函数")
    ;(this[PluginCleanup] ??= []).push({ dispose, restore, active: true })
  }

  conKey(isGroup = false) {
    return `${this.name}.${this.self_id || this.e.self_id}.${isGroup ? this.group_id || this.e.group_id : this.user_id || this.e.user_id}`
  }

  setContext(type, isGroup, time = 120, timeout = "操作超时已取消") {
    const key = this.conKey(isGroup)
    stateArr[key] ??= {}
    const oldContext = stateArr[key][type]
    if (oldContext) {
      clearTimeout(oldContext[SymbolTimeout])
      oldContext[SymbolResolve]?.(false)
    }

    const context = this.e
    stateArr[key][type] = context
    if (time)
      context[SymbolTimeout] = setTimeout(() => {
        if (stateArr[key]?.[type] !== context) return
        const resolve = context[SymbolResolve]
        delete stateArr[key][type]
        if (!Object.keys(stateArr[key]).length) delete stateArr[key]
        resolve ? resolve(false) : this.reply(timeout, true)
      }, time * 1000)
    return context
  }

  getContext(type, isGroup) {
    if (type) return stateArr[this.conKey(isGroup)]?.[type]
    return stateArr[this.conKey(isGroup)]
  }

  finish(type, isGroup) {
    const key = this.conKey(isGroup)
    const context = stateArr[key]?.[type]
    if (context) {
      clearTimeout(context[SymbolTimeout])
      delete stateArr[key][type]
      if (!Object.keys(stateArr[key]).length) delete stateArr[key]
    }
  }

  awaitContext(...args) {
    return new Promise(
      resolve => (this.setContext("resolveContext", ...args)[SymbolResolve] = resolve),
    )
  }

  resolveContext(context) {
    for (const isGroup of [false, true])
      if (this.getContext("resolveContext", isGroup) === context)
        this.finish("resolveContext", isGroup)
    context?.[SymbolResolve]?.(this.e)
  }

  async renderImg(plugin, tpl, data, cfg) {
    return this.e.runtime.render(plugin, tpl, data, cfg)
  }
}
