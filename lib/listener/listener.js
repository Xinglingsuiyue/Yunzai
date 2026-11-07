import PluginsLoader from "../plugins/loader.js"

export default class EventListener {
  constructor(data) {
    this.prefix = data.prefix || ""
    this.event = data.event
    this.once = data.once || false
    this.plugins = PluginsLoader
  }
}
