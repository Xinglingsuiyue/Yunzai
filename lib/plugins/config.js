import fs from "node:fs/promises"
import YAML from "yaml"
import _ from "lodash"
import chokidar from "chokidar"
import cfg from "../config/config.js"
import util from "../util.js"
const map = new Map()

export async function watcher() {
  try {
    logger.debug("配置文件", this.configFile, "发生变化")
    const configData = YAML.parse(await fs.readFile(this.configFile, "utf8"))
    _.merge(this.config, configData)
  } catch (err) {
    logger.error("配置文件", this.configFile, "读取失败", err)
  }
}

export default async function makeConfig(name, config = {}, keep = {}, opts = {}) {
  if (map.has(name)) return map.get(name)

  const configFile = `config/${name}.yaml`
  const configSave = util.debounce(
    typeof opts.replacer === "function"
      ? async () => fs.writeFile(configFile, await opts.replacer(YAML.stringify(config)), "utf8")
      : () => fs.writeFile(configFile, YAML.stringify(config), "utf8"),
  )

  const ret = { config, configSave, configFile }
  map.set(name, ret)

  let configData
  try {
    configData = YAML.parse(await fs.readFile(configFile, "utf8"))
    _.merge(config, configData)
  } catch (err) {
    logger.debug("配置文件", configFile, "读取失败", err)
  }
  _.merge(config, keep)

  if (YAML.stringify(config) != YAML.stringify(configData)) await configSave()

  if (typeof opts.watch === "boolean" ? opts.watch : cfg.bot.file_watch)
    ret.watcher = chokidar.watch(configFile).on("change", _.debounce(watcher.bind(ret), 5000))

  return ret
}
