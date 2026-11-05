import fs from "node:fs"

const { version: botVersion } = JSON.parse(
  fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
)

export class version extends plugin {
  constructor() {
    super({
      name: "版本",
      dsc: "#版本",
      event: "message",
      priority: 10,
      rule: [{ reg: /^#版本$/, fnc: "version" }],
    })
  }

  async version() {
    await this.reply(`TRSS-Yunzai v${botVersion}\nhttps://github.com/Xinglingsuiyue/Yunzai`)
    return true
  }
}
