import cfg from "../../lib/config/config.js"

export class disPri extends plugin {
  constructor() {
    super({
      name: "禁止私聊",
      dsc: "开启私聊禁用后，除主人外所有私聊消息一律不响应",
      event: "message.private",
      priority: -Infinity,
    })
  }

  async accept() {
    if (!cfg.other?.disablePrivate || this.e.isMaster) return
    this.sendTips()
    return "return"
  }

  async sendTips() {
    if (this.e.user_id == this.e.self_id) return

    /** cd */
    const key = `Yz:disablePrivate:${this.e.user_id}`
    if (await redis.get(key)) return

    this.e.reply(cfg.other.disableMsg)
    redis.setEx(key, 10, "1")
  }
}

export class disFriPoke extends plugin {
  constructor() {
    super({
      name: "禁止私聊",
      dsc: "开启私聊禁用后，除主人外所有私聊消息一律不响应",
      event: "notice.friend.poke",
      priority: -Infinity,
    })
  }

  async accept() {
    if (!cfg.other?.disablePrivate || this.e.isMaster) return
    this.e.reply(cfg.other.disableMsg)
    return "return"
  }
}
