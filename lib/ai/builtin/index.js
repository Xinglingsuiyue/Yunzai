export default [
  {
    name: "builtin/ai-actions.js",
    path: new URL("./actions.js", import.meta.url).href,
    builtin: true,
  },
  {
    name: "builtin/ai-persona.js",
    path: new URL("./persona.js", import.meta.url).href,
    builtin: true,
  },
  {
    name: "builtin/ai-commands.js",
    path: new URL("./commands.js", import.meta.url).href,
    builtin: true,
  },
]
