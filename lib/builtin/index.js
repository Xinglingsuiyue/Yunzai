import aiModules from "../ai/builtin/index.js"

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
