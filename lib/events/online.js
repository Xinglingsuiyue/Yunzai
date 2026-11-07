import EventListener from "../listener/listener.js"

export default class onlineEvent extends EventListener {
  constructor() {
    super({
      event: "online",
      once: true,
    })
  }

  async execute() {
    logger.mark("----^_^----")
  }
}
