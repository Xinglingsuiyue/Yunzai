import aiModules from "../ai/builtin/index.js"

/** 框架核心内置模块，不位于 plugins 目录，不参与插件安装/卸载。 */
export default [
  ...aiModules,
  {
    name: "builtin/help.js",
    path: new URL("../help/plugin.js", import.meta.url).href,
    builtin: true,
  },
  {
    name: "builtin/webui-panel.js",
    path: new URL("../webui/plugin.js", import.meta.url).href,
    builtin: true,
  },
]
