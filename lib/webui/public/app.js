(function () {
  "use strict";

  const THEME_KEY = "yunzai-webui-theme";
  const LOGIN_PREF_KEY = "yunzai-webui-login";
  const NAV_KEY = "yunzai-webui-collapsed";

  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));

  const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = value => String(value === null || value === undefined ? "" : value).replace(/[&<>"']/g, ch => ESC_MAP[ch]);
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

  const NAV_ITEMS = [
    { id: "dashboard", label: "仪表盘", icon: "grid", group: "工作台", keywords: "overview home 首页 状态" },
    { id: "ai", label: "状态", icon: "spark", group: "AI", keywords: "模型 渠道 选择 会话 context" },
    { id: "ai-system", label: "设置", icon: "settings", group: "AI", keywords: "system 开关 触发 回复 权限 ai.yaml 采样 温度 上下文 压缩" },
    { id: "ai-stickers", label: "表情", icon: "grid", group: "AI", keywords: "sticker 表情包 表情 分类 含义" },
    { id: "ai-groups", label: "群设置", icon: "users", group: "AI", keywords: "group 群聊 AI 触发 预设 工具限制" },
    { id: "ai-presets", label: "预设管理", icon: "book", group: "AI", keywords: "preset 人格 提示词 参数" },
    { id: "ai-channels", label: "渠道管理", icon: "database", group: "AI", keywords: "channel 渠道 模型 key 接口" },
    { id: "ai-voice", label: "语音设置", icon: "message", group: "AI", keywords: "voice tts 语音 合成 朗读" },
    { id: "ai-proxies", label: "代理设置", icon: "arrow", group: "AI", keywords: "proxy 代理 网络 socks" },
    { id: "ai-skills", label: "技能中心", icon: "puzzle", group: "AI", keywords: "skill 技能 关键词 注入" },
    { id: "ai-mcp", label: "MCP 服务", icon: "puzzle", group: "AI", keywords: "mcp 工具 服务 stdio http" },
    { id: "ai-tool-config", label: "工具配置", icon: "tool", group: "AI", keywords: "tool 工具 禁用 回合 工具调用 按需加载" },
    { id: "tools", label: "工具", icon: "tool", group: "AI", keywords: "function tools 工具" },
    { id: "ai-image", label: "绘图预设", icon: "spark", group: "AI", keywords: "image 绘图 生图 预设" },
    { id: "knowledge", label: "知识库", icon: "book", group: "数据", keywords: "knowledge kb 知识 条目 检索" },
    { id: "ai-memories", label: "回忆管理", icon: "database", group: "数据", keywords: "memory 回忆 记忆 注入 提取" },
    { id: "ai-stats", label: "调用统计", icon: "sliders", group: "数据", keywords: "stats 统计 token 趋势 错误" },
    { id: "ai-sessions", label: "数据记录", icon: "message", group: "数据", keywords: "session history 会话 历史 记录 record chat tool 调用 工具" },
    { id: "config-basic", label: "基础配置", icon: "settings", group: "配置管理", keywords: "config bot ai other webui 基础 配置" },
    { id: "config-group", label: "群组配置", icon: "users", group: "配置管理", keywords: "group 群聊 权限 冷却 配置" },
    { id: "help-panel", label: "帮助面板", icon: "book", group: "配置管理", keywords: "help 帮助 面板 菜单 皮肤 主题 图标 备份 分组" },
    { id: "config-other", label: "其他配置", icon: "database", group: "配置管理", keywords: "server redis db renderer milky satori 配置" },
    { id: "config-plugin", label: "插件配置", icon: "sliders", group: "插件配置", keywords: "plugin guoba yaml 插件 配置" },
    { id: "plugins", label: "插件管理", icon: "puzzle", group: "配置管理", keywords: "plugin 重载 目录 定时任务" },
    { id: "accounts", label: "账号显示", icon: "bot", group: "系统", keywords: "account bot 账号 登录 状态" },
    { id: "groups", label: "群聊与好友", icon: "users", group: "系统", keywords: "group friend 群 好友" },
    { id: "logs", label: "日志", icon: "file", group: "系统", keywords: "log error 错误 命令" },
    { id: "terminal", label: "终端", icon: "terminal", group: "系统", keywords: "terminal shell bash cmd 终端 命令 代码 执行" },
    { id: "backend", label: "后台", icon: "tool", group: "系统", keywords: "backend 后台 控制台 指令 命令 主人" },
  ];

  const CONFIG_VIEWS = {
    basic: { page: "config-basic", main: "#configBasicMain", nav: "#configBasicNav" },
    other: { page: "config-other", main: "#configOtherMain", nav: "#configOtherNav" },
    group: { page: "config-group", main: "#groupCfgMain", nav: "#groupCfgScopes" },
    plugin: { page: "config-plugin", main: "#pluginCfgMain", nav: "#pluginCfgNav" },
    "ai-system": { page: "ai-system", main: "#aiSystemMain" },
  };

  const PERMISSION_LABELS = {
    all: "所有人",
    everyone: "所有人",
    master: "仅主人",
    owner: "群主",
    admin: "管理员",
  };

  const PERMISSION_PILLS = {
    all: "pill-green",
    everyone: "pill-green",
    master: "pill-amber",
    owner: "pill-pink",
    admin: "pill-blue",
  };

  const permissionKey = value => {
    const key = String(value || "all");
    return key === "all" ? "everyone" : key;
  };

  const TRIGGER_LABELS = {
    at: "仅 @ 机器人",
    prefix: "前缀触发",
    keyword: "关键词触发",
    atOrPrefix: "@ 或前缀",
    free: "自由判断",
    any: "多开关组合",
    all: "所有消息",
    none: "不响应",
  };

  const SOURCE_LABELS = {
    manual: "手动添加",
    chat: "对话写入",
    ai: "AI 写入",
    import: "批量导入",
    webui: "WebUI",
    archive: "归档",
  };

  const state = {
    basePath: computeBasePath(),
    token: "",
    tokenRequired: false,
    allowWrite: true,
    theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
    started: false,
    page: "dashboard",
    overview: null,
    overviewAt: 0,
    startTime: 0,
    ai: null,
    aiModels: null,
    pluginManager: { data: null, tab: "installed", query: "", busy: "", limit: 60, singleTab: "installed", singleQuery: "" },
    groups: null,
    accounts: null,
    statusImage: { scale: 2, proForAll: false, loading: false },
    kb: { page: 1, pageSize: 12, query: "", scope: "", tag: "" },
    kbData: null,
    toolQuery: "",
    toolPerm: "",
    toolLimit: 60,
    configFiles: null,
    configBasic: { name: "bot", detail: null, loading: false },
    configOther: { name: "server", detail: null, loading: false },
    configGroup: { botId: "", groupId: "", list: null, detail: null, loading: false, loadedKey: "" },
    helpPanel: {
      detail: null,
      themes: [],
      icons: {},
      iconMisses: new Set(),
      draft: null,
      snapshot: "",
      previewTheme: "",
      previewSeq: 0,
      previewTimer: 0,
      frame: null,
      selection: { group: 0, item: 0 },
      dialogOpen: false,
      advancedOpen: false,
      loading: false,
      preload: null,
      preloadPromise: null,
    },
    configPlugin: { list: null, plugin: "", id: "", detail: null, loading: false },
    configSections: {},
    aiYaml: { detail: null, runtime: null, "ai-system": null },
    aiSections: {},
    channelTestFilter: "all",
    aiTools: { data: null, query: "", limit: 80 },
    aiMemories: { data: null, query: "", scope: "", kind: "", archived: "", page: 1, pageSize: 20 },
    aiRecords: { data: null, query: "", type: "", days: "7", success: "", page: 1, pageSize: 30 },
    aiStats: { data: null, days: 7 },
    aiSessions: { data: null, query: "", page: 1, pageSize: 20 },
    aiToolCalls: { data: null, query: "", days: "7", success: "", page: 1, pageSize: 30 },
    aiGroups: { data: null, query: "" },
    groupTab: "groups",
    groupQuery: "",
    logs: { type: "command", auto: true, timer: null, loading: false },
    palette: { open: false, query: "", index: 0, items: [] },
  };

  /* ---------------- 基础工具 ---------------- */

  function computeBasePath() {
    let pathname = window.location.pathname.replace(/\/+$/, "");
    if (pathname.endsWith("/index.html")) pathname = pathname.slice(0, -"/index.html".length);
    return pathname || "/webui";
  }

  function safeGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function safeSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      /* 忽略隐私模式下的存储异常 */
    }
  }

  function apiUrl(path) {
    return `${state.basePath}/api${path}`;
  }

  function apiAssetUrl(path) {
    const url = apiUrl(path);
    return state.token ? `${url}?token=${encodeURIComponent(state.token)}` : url;
  }

  function botAvatarUrl(bot) {
    return bot && bot.hasAvatar ? apiAssetUrl(`/avatar/${encodeURIComponent(bot.self_id || "")}`) : "";
  }

  function helpIconUrl(name) {
    return apiAssetUrl(`/help/icon/${encodeURIComponent(name)}`);
  }

  function authHeaders(extra) {
    const headers = Object.assign({}, extra || {});
    if (state.token) headers["X-WebUI-Token"] = state.token;
    return headers;
  }

  function clearStoredToken() {
    state.token = "";
  }

  /** 令牌被服务端判定失效：清掉保存的令牌，但保留用户的勾选偏好 */
  function invalidateSavedToken() {
    const prefs = readLoginPrefs();
    if (prefs.token) writeLoginPrefs({ remember: prefs.remember, auto: prefs.auto, token: "" });
  }

  function dropLegacyToken() {
    try {
      window.localStorage.removeItem("yunzai-webui-token");
    } catch (error) {
      /* ignore */
    }
  }

  /* 登录偏好：记住令牌 / 自动登录。令牌只存在本机 localStorage。 */
  function readLoginPrefs() {
    let prefs = {};
    try {
      prefs = JSON.parse(safeGet(LOGIN_PREF_KEY) || "{}") || {};
    } catch (error) {
      prefs = {};
    }
    return {
      remember: prefs.remember === true,
      auto: prefs.auto === true,
      token: typeof prefs.token === "string" ? prefs.token : "",
    };
  }

  function writeLoginPrefs(prefs) {
    try {
      safeSet(
        LOGIN_PREF_KEY,
        JSON.stringify({
          remember: prefs.remember === true,
          auto: prefs.auto === true,
          token: prefs.remember ? String(prefs.token || "") : "",
        }),
      );
    } catch (error) {
      /* ignore */
    }
  }

  function clearLoginPrefs() {
    try {
      window.localStorage.removeItem(LOGIN_PREF_KEY);
    } catch (error) {
      /* ignore */
    }
  }

  async function fetchSession() {
    const response = await fetch(apiUrl("/session"), {
      headers: authHeaders(),
      cache: "no-store",
    });
    let data = {};
    try {
      data = await response.json();
    } catch (error) {
      data = {};
    }
    if (!response.ok) throw new Error(data.message || `无法连接 WebUI 服务（HTTP ${response.status}）`);
    if (data.basePath) state.basePath = data.basePath;
    state.tokenRequired = !!data.tokenRequired;
    state.allowWrite = data.allowWrite !== false;
    return data;
  }

  async function api(path, options) {
    const opts = options || {};
    const method = opts.method || "GET";
    const headers = authHeaders(opts.headers);
    let body;
    if (opts.rawBody !== undefined) {
      body = opts.rawBody;
    } else if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    if (method !== "GET" && method !== "HEAD") headers["X-WebUI-Request"] = "1";

    const response = await fetch(apiUrl(path), { method, headers, body, cache: opts.cache || "no-store" });
    let data = {};
    try {
      data = await response.json();
    } catch (error) {
      data = {};
    }

    // 只认 WebUI 自己的鉴权错误标识；上游服务的 401 不能把人踢回登录页
    if (data.error === "unauthorized" || data.error === "forbidden" || data.error === "too_many_attempts") {
      clearStoredToken();
      invalidateSavedToken();
      showLogin({ tokenRequired: state.tokenRequired, allowWrite: state.allowWrite }, data.message || "登录状态已失效，请重新验证。");
      throw new Error(data.message || "没有访问权限");
    }

    if (!response.ok) {
      const error = new Error(data.message || `请求失败（HTTP ${response.status}）`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function apiSSE(path, body, handlers, signal) {
    const headers = authHeaders({
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "X-WebUI-Request": "1",
    });
    const response = await fetch(apiUrl(path), {
      method: "POST",
      headers,
      body: JSON.stringify(body || {}),
      cache: "no-store",
      signal,
    });
    if (!response.ok) {
      let data = {};
      try {
        data = await response.json();
      } catch (error) {
        data = {};
      }
      if (data.error === "unauthorized" || data.error === "forbidden" || data.error === "too_many_attempts") {
        clearStoredToken();
        invalidateSavedToken();
        showLogin({ tokenRequired: state.tokenRequired, allowWrite: state.allowWrite }, data.message || "登录状态已失效，请重新验证。");
      }
      throw new Error(data.message || `请求失败（HTTP ${response.status}）`);
    }
    if (!response.body) throw new Error("当前浏览器不支持流式响应");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let event = "message";
    let dataLines = [];
    const dispatch = () => {
      if (!dataLines.length) {
        event = "message";
        return;
      }
      const raw = dataLines.join("\n");
      let data;
      try {
        data = JSON.parse(raw);
      } catch (error) {
        data = raw;
      }
      try {
        handlers?.[event]?.(data);
      } catch (error) {
        console.error(error);
      }
      event = "message";
      dataLines = [];
    };
    const consumeLine = line => {
      if (line === "") {
        dispatch();
        return;
      }
      if (line.startsWith("event:")) event = line.slice(6).trim() || "message";
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) consumeLine(line);
    }
    buffer += decoder.decode();
    if (buffer) for (const line of buffer.split(/\r?\n/)) consumeLine(line);
    dispatch();
  }

  function setBusy(button, busy) {
    if (!button) return;
    button.classList.toggle("busy", !!busy);
    button.disabled = !!busy;
  }

  /** 移动端点按被省略的长文本：弹窗显示完整内容 */
  function showFullText(text) {
    const content = String(text || "").trim();
    if (!content) return;
    openModal({
      title: "完整内容",
      width: "narrow",
      body: `<div class="modal-body"><p class="config-fulltext">${esc(content)}</p></div>`,
      footer: '<button type="button" class="btn btn-primary" data-close>知道了</button>',
    });
  }

  function toast(message, type, title) {
    const kind = type || "success";
    const layer = $("#toasts");
    if (!layer) return;
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    const iconName = kind === "error" ? "alert" : kind === "info" ? "info" : "check";
    const heading = title || (kind === "error" ? "操作失败" : kind === "info" ? "提示" : "操作成功");
    el.innerHTML = `<span class="t-icon">${icon(iconName)}</span><div><strong>${esc(heading)}</strong><p>${esc(message)}</p></div>`;
    layer.appendChild(el);
    window.setTimeout(() => {
      el.style.transition = "opacity .2s ease, transform .2s ease";
      el.style.opacity = "0";
      el.style.transform = "translateY(-4px)";
      window.setTimeout(() => el.remove(), 240);
    }, 3400);
    while (layer.children.length > 5) layer.firstElementChild.remove();
  }

  function handleError(error) {
    if (!error) return;
    console.error(error);
    const login = $("#login");
    if (login && !login.hidden) return;
    toast(error.message || String(error), "error");
  }

  function emptyState(title, description, iconName, outline) {
    return `<div class="empty${outline ? " empty-outline" : ""}">
      <span class="empty-icon">${icon(iconName || "file")}</span>
      <strong>${esc(title)}</strong>
      ${description ? `<p>${esc(description)}</p>` : ""}
    </div>`;
  }

  function tableEmpty(colspan, text) {
    return `<tr class="table-empty"><td colspan="${colspan}">${esc(text)}</td></tr>`;
  }

  function miniStat(label, value, iconName, tile) {
    return `<div class="mini-stat">
      <span class="mini-icon tile-${tile}">${icon(iconName)}</span>
      <div><small>${esc(label)}</small><strong>${esc(String(value))}</strong></div>
    </div>`;
  }

  function pill(text, variant, dot) {
    const label = String(text ?? "");
    return `<span class="pill ${variant || ""}" data-fulltext="${esc(label)}" title="${esc(label)}">${dot ? '<span class="dot"></span>' : ""}${esc(label)}</span>`;
  }

  function kvRow(label, valueHtml, valueClass) {
    return `<div class="kv"><span>${esc(label)}</span><span class="kv-val ${valueClass || ""}">${valueHtml}</span></div>`;
  }

  function boolPill(value, onText, offText) {
    return value ? pill(onText || "开启", "pill-green") : pill(offText || "关闭", "");
  }

  /* ---------------- 格式化 ---------------- */

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function toDate(value) {
    if (value === null || value === undefined || value === "") return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === "number") {
      const ms = value < 1e12 ? value * 1000 : value;
      const date = new Date(ms);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function fmtNum(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString("zh-CN") : "0";
  }

  // Token 量级用 k/m/b 缩写，窄屏卡片放不下完整数字
  function fmtToken(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "0";
    const abs = Math.abs(number);
    if (abs < 1000) return fmtNum(Math.round(number));
    const units = [
      [1e9, "b"],
      [1e6, "m"],
      [1e3, "k"],
    ];
    let index = units.findIndex(([base]) => abs >= base);
    let [base, suffix] = units[index];
    let scaled = number / base;
    if (scaled >= 999.5 && index > 0) {
      [base, suffix] = units[index - 1];
      scaled = number / base;
    }
    const digits = Math.abs(scaled) >= 100 ? 0 : 1;
    return `${scaled.toFixed(digits).replace(/\.0$/, "")}${suffix}`;
  }

  function fmtBytes(bytes) {
    const number = Number(bytes);
    if (!Number.isFinite(number) || number <= 0) return "0 MB";
    const mb = number / 1024 / 1024;
    return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
  }

  function fmtDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "—";
    const total = Math.floor(ms / 1000);
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (days > 0) return `${days} 天 ${hours} 小时`;
    if (hours > 0) return `${hours} 小时 ${minutes} 分`;
    if (minutes > 0) return `${minutes} 分 ${seconds} 秒`;
    return `${seconds} 秒`;
  }

  function fmtClock(value) {
    const date = toDate(value);
    if (!date) return "—";
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function fmtDateTime(value) {
    const date = toDate(value);
    if (!date) return "—";
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function fmtRelative(value) {
    const date = toDate(value);
    if (!date) return "—";
    const diff = Date.now() - date.getTime();
    if (diff < 0) return fmtClock(value);
    const seconds = Math.floor(diff / 1000);
    if (seconds < 45) return "刚刚";
    if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))} 分钟前`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
    if (seconds < 2592000) return `${Math.floor(seconds / 86400)} 天前`;
    return fmtClock(value);
  }

  function scopeLabel(scope) {
    if (!scope) return "未知";
    if (scope === "master") return "主人";
    if (scope === "public") return "公开";
    if (scope.startsWith("group:")) return `群 ${scope.slice(6)}`;
    if (scope.startsWith("user:")) return `用户 ${scope.slice(5)}`;
    return scope;
  }

  function scopeVariant(scope) {
    if (scope === "master") return "pill-amber";
    if (scope === "public") return "pill-blue";
    if (String(scope).startsWith("group:")) return "pill-green";
    if (String(scope).startsWith("user:")) return "pill-pink";
    return "";
  }

  function permissionLabel(permission) {
    const key = String(permission || "all").toLowerCase();
    return PERMISSION_LABELS[key] || permission || "未知";
  }

  function permissionPill(permission) {
    const key = String(permission || "all").toLowerCase();
    return pill(permissionLabel(key), PERMISSION_PILLS[key] || "");
  }

  function triggerLabel(mode) {
    return TRIGGER_LABELS[mode] || mode || "—";
  }

  /** 群列表的触发方式：四项各带一盏灯，开启绿、关闭黄 */
  function triggerLightsHtml(ai, globalSwitches) {
    const hasOwn =
      ai &&
      (ai.triggerAt !== undefined ||
        ai.triggerPrefix !== undefined ||
        ai.triggerKeyword !== undefined ||
        ai.triggerFree !== undefined);
    const src = hasOwn ? ai : {
      triggerAt: globalSwitches?.at,
      triggerPrefix: globalSwitches?.prefix,
      triggerFree: globalSwitches?.free,
      proactiveChat: null,
    };
    // 主动聊天在群级是「关闭」，未设置时跟随全局配置
    const proactive = ai?.proactiveChat === undefined || ai?.proactiveChat === null
      ? globalSwitches?.proactive === true
      : ai.proactiveChat === true;
    const items = [
      ["@", src.triggerAt === true],
      ["前缀", src.triggerPrefix === true],
      ["自由", src.triggerFree === true],
      ["主动", proactive],
    ];
    return `<div class="trigger-lights">${items
      .map(
        ([label, on]) =>
          `<span class="trigger-light ${on ? "is-on" : "is-off"}" title="${label}：${on ? "开启" : "关闭"}"><span class="light" aria-hidden="true"></span>${label}</span>`,
      )
      .join("")}</div>`;
  }

  function sourceLabel(source) {
    return SOURCE_LABELS[source] || source || "未知";
  }

  function applyTheme(theme) {
    state.theme = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = state.theme;
    safeSet(THEME_KEY, state.theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", state.theme === "dark" ? "#0d0d0f" : "#f6f6f7");
  }

  function toggleTheme() {
    applyTheme(state.theme === "dark" ? "light" : "dark");
  }

  /* ---------------- 概览 / 仪表盘 ---------------- */

  async function loadOverview(force) {
    if (!force && state.overview && Date.now() - state.overviewAt < 20000) {
      renderOverview(state.overview);
      return state.overview;
    }
    const data = await api("/overview");
    state.overview = data;
    state.overviewAt = Date.now();
    state.startTime = data.startTime || 0;
    renderOverview(data);
    // 总览先出，表盘随后补上最新数值
    if (state.page === "dashboard") refreshGauges().catch(() => {});
    return data;
  }

  function invalidateOverview() {
    state.overviewAt = 0;
  }

  function renderOverview(data) {
    renderSidebar(data);
    renderDashboard(data);
    renderGlobalMeta(data);
  }

  function renderGlobalMeta(data) {
    const avatar = $("#avatar");
    const bot = (data.bots || [])[0];
    const name = bot && bot.nickname ? bot.nickname : data.botName || "Yunzai";
    const avatarUrl = botAvatarUrl(bot);
    avatar.title = bot ? `${name} · ${bot.self_id}` : name;
    if (avatarUrl) {
      avatar.textContent = "";
      avatar.style.backgroundImage = `url("${avatarUrl}")`;
      avatar.classList.add("has-image");
    } else {
      avatar.textContent = name.trim().slice(0, 1).toUpperCase() || "Y";
      avatar.style.backgroundImage = "";
      avatar.classList.remove("has-image");
    }
  }

  /** 协议端状态只用颜色灯表示：绿=已接入，黄=未接入；WebUI 能打开就说明云崽在运行，不再有灰色态 */
  function setBotOnlineState(bots) {
    const online = bots.some(bot => bot.isQQ && bot.online);
    const state = online ? "协议端已接入" : "未接入协议端";
    const dot = $("#botDot");
    if (dot) {
      dot.className = "status-dot " + (online ? "online" : "offline");
      dot.setAttribute("aria-label", state);
    }
    const pill = $("#sysStatusPill");
    if (pill) {
      pill.className = `pill ${online ? "pill-green" : "pill-amber"}`;
      pill.setAttribute("aria-label", state);
    }
  }

  /** 定时轻量轮询账号状态，避免停留页面时显示过期在线状态 */
  async function pollBotStatus() {
    if (document.hidden || !state.started) return;
    if (state.tokenRequired && !state.token) return;
    try {
      const data = await api("/bots");
      const bots = data.bots || [];
      const known = state.overview?.bots || [];
      // 账号集合或昵称变化（协议端接入/断开、换号）时重拉总览，顶栏和侧栏才不会一直停在旧账号
      const changed =
        bots.length !== known.length ||
        bots.some((bot, index) => {
          const old = known[index];
          return !old || old.self_id !== bot.self_id || old.nickname !== bot.nickname;
        });
      if (changed) {
        state.overviewAt = 0;
        await loadOverview(true);
        return;
      }
      // 只同步在线状态，保留概览里的头像 data URI
      if (state.overview) {
        const states = new Map(bots.map(bot => [bot.self_id, bot.online]));
        state.overview.bots = (state.overview.bots || []).map(bot => ({
          ...bot,
          online: states.get(bot.self_id) === true,
        }));
      }
      setBotOnlineState(bots);
    } catch {}
  }

  function startBotStatusPoll() {
    window.setInterval(pollBotStatus, 10000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) pollBotStatus();
    });
  }

  function renderSidebar(data) {
    const bots = data.bots || [];
    setBotOnlineState(bots);
    $("#botVersion").textContent = data.version ? `v${data.version}` : "";

    const bot = bots.find(item => item.isQQ);
    $("#botName").textContent = bot && bot.nickname ? bot.nickname : data.botName || "Yunzai Bot";
    $("#botSub").textContent = bot
      ? `${bot.self_id}${data.serverPort ? ` · :${data.serverPort}` : ""}`
      : data.serverPort
        ? `HTTP :${data.serverPort}`
        : "等待运行状态";

    const counts = data.counts || {};
    const toolBadge = $("#navToolCount");
    const kbBadge = $("#navKbCount");
    toolBadge.textContent = fmtNum(counts.tools);
    toolBadge.hidden = !counts.tools;
    kbBadge.textContent = fmtNum(counts.kbEntries);
    kbBadge.hidden = !counts.kbEntries;
  }

  function renderDashboard(data) {
    const counts = data.counts || {};
    const ai = data.ai || {};
    const kb = data.kb || {};
    const bots = data.bots || [];

    $("#statTools").textContent = fmtNum(counts.tools);
    $("#statToolsFoot").textContent = `${fmtNum(counts.sessions)} 个活跃会话`;
    $("#statKb").textContent = fmtNum(counts.kbEntries);
    $("#statKbFoot").textContent = `${fmtNum(kb.pinned)} 条固定知识`;
    $("#statPlugins").textContent = fmtNum(counts.plugins);
    $("#statPluginsFoot").textContent = `${fmtNum(counts.pluginPackages)} plugins · ${fmtNum(counts.pluginSingles)} js`;
    $("#statUptime").textContent = data.startTime ? fmtDuration(Date.now() - data.startTime) : "—";
    $("#statUptimeFoot").textContent = data.startTime ? `启动于 ${fmtClock(data.startTime)}` : "启动时间未知";

    setBotOnlineState(bots);
    renderGauges(data.gauges);

    const memory = data.memory || {};
    $("#sysInfo").innerHTML = [
      kvRow("版本", data.version ? `<span class="mono">v${esc(data.version)}</span>` : "—"),
      kvRow("启动方式", esc(data.startType || "—")),
      kvRow("运行环境", `<span class="mono">${esc(data.node || "—")}</span> <span class="muted">${esc(data.platform || "")}</span>`),
      kvRow("进程", `<span class="mono">PID ${esc(data.pid || "—")}</span>`),
      kvRow("内存", `<span class="mono">${esc(fmtBytes(memory.rss))}</span> <span class="muted">/ 堆 ${esc(fmtBytes(memory.heapUsed))}</span>`),
      kvRow("HTTP 服务", data.serverPort ? `<span class="mono">:${esc(data.serverPort)}</span>` : "—"),
      kvRow("WebUI", `<span class="mono">${esc(data.webui && data.webui.basePath ? data.webui.basePath : state.basePath)}</span> ${data.webui && data.webui.tokenRequired ? pill("令牌保护", "pill-amber") : pill("本机访问", "pill-outline")}`),
      kvRow("启动时间", `<span class="mono">${esc(fmtDateTime(data.startTime))}</span>`),
    ].join("");

    const aiPill = $("#aiStatusPill");
    aiPill.className = `pill ${ai.enabled ? (ai.initialized ? "pill-green" : "pill-blue") : ""}`;
    aiPill.innerHTML = `<span class="dot"></span>${ai.enabled ? (ai.initialized ? "运行中" : "已启用") : "未启用"}`;
    $("#aiInfo").innerHTML = [
      kvRow("渠道", ai.channel ? `<span class="mono">${esc(ai.channel)}</span>` : "—"),
      kvRow("API Key", ai.hasApiKey ? pill("已配置", "pill-green") : pill("未配置", "pill-amber")),
      kvRow("群聊触发", esc(triggerLabel(ai.groupTrigger))),
      kvRow("群聊 / 私聊", `${toggleLight(ai.groupChat, "群聊")}${toggleLight(ai.privateChat, "私聊")}`),
      kvRow("知识库", ai.knowledgeBase ? pill("启用", "pill-green") : pill("关闭", "")),
      kvRow("活跃会话", `${fmtNum(counts.sessions)} 个`),
    ].join("");

    const recent = data.recent || [];
    $("#recentLogs").innerHTML = recent.length
      ? recent
          .map(line => `<div class="cmd-row"><span class="dot"></span><span class="cmd-text" title="${esc(line)}">${esc(line)}</span></div>`)
          .join("")
      : emptyState("暂无日志", "今天的日志记录会显示在这里。", "file");

    const total = Number(kb.total) || 0;
    const max = Number(kb.maxEntries) || 0;
    $("#kbUsageText").textContent = `${fmtNum(total)} / ${fmtNum(max)} 条`;
    $("#kbUsageBar").style.width = max > 0 ? `${Math.min(100, (total / max) * 100).toFixed(1)}%` : "0%";

    const scopes = Object.entries(kb.scopes || {}).sort((a, b) => b[1] - a[1]);
    $("#kbScopes").innerHTML = scopes.length
      ? scopes
          .map(([scope, count]) => `<span class="chip">${esc(scopeLabel(scope))}<span class="count">${fmtNum(count)}</span></span>`)
          .join("")
      : `<span class="muted" style="font-size:11.5px">暂无知识</span>`;

    const tags = kb.topTags || [];
    $("#kbTags").innerHTML = tags.length
      ? tags.map(item => `<span class="chip">#${esc(item.tag)}<span class="count">${fmtNum(item.count)}</span></span>`).join("")
      : `<span class="muted" style="font-size:11.5px">暂无标签</span>`;
  }

  function toggleLight(on, label) {
    return `<span class="toggle-light"><span class="status-dot ${on ? "online" : "red"}"></span>${esc(label)}</span>`;
  }

  const GAUGE_CIRCUMFERENCE = 3.14 * 85;

  function gaugeView(item, options) {
    const opts = options || {};
    const percent = Math.max(0, Math.min(100, Number(item.percent) || 0));
    return {
      key: String(opts.title || item.title || ""),
      color: item.color || "#84A0DF",
      title: opts.title || item.title || "—",
      inner: item.inner || `${Math.round(percent)}%`,
      detailed: item.detailed || "",
      info: (item.info || []).filter(Boolean),
      dash: (GAUGE_CIRCUMFERENCE * (1 - percent / 100)).toFixed(1),
    };
  }

  /** 初始渲染时环从 0 开始增长，之后原地更新，避免每次轮询重建元素而丢失过渡 */
  function gaugeHtml(view) {
    const info = view.info.map(line => `<div class="gauge-info">${esc(line)}</div>`).join("");
    return `<div class="gauge" data-gauge-key="${esc(view.key)}">
      <div class="gauge-ring" style="--gauge-color:${esc(view.color)}">
        <svg viewBox="0 0 104 104" aria-hidden="true">
          <circle class="gauge-track" cx="52" cy="52" r="42.5"></circle>
          <circle class="gauge-value" cx="52" cy="52" r="42.5" stroke-dasharray="${GAUGE_CIRCUMFERENCE.toFixed(1)}" stroke-dashoffset="${GAUGE_CIRCUMFERENCE.toFixed(1)}" data-dash="${view.dash}"></circle>
        </svg>
        <span class="gauge-num">${esc(view.inner)}</span>
      </div>
      <div class="gauge-title">${esc(view.title)}</div>
      ${view.detailed ? `<div class="gauge-detail" title="${esc(view.detailed)}">${esc(view.detailed)}</div>` : ""}
      ${info}
    </div>`;
  }

  function updateGaugeNode(node, view) {
    const ring = node.querySelector(".gauge-ring");
    if (ring) ring.style.setProperty("--gauge-color", view.color);
    const circle = node.querySelector(".gauge-value");
    if (circle) {
      circle.dataset.dash = view.dash;
      circle.style.strokeDashoffset = view.dash;
    }
    const num = node.querySelector(".gauge-num");
    if (num) num.textContent = view.inner;
    const detail = node.querySelector(".gauge-detail");
    if (detail && view.detailed) {
      detail.textContent = view.detailed;
      detail.title = view.detailed;
    }
    const infoNodes = node.querySelectorAll(".gauge-info");
    view.info.forEach((line, index) => {
      if (infoNodes[index]) infoNodes[index].textContent = line;
    });
  }

  function mountGauges(container, views, emptyText) {
    if (!container) return;
    const nodes = Array.from(container.children).filter(node => node.classList.contains("gauge"));
    if (
      views.length &&
      nodes.length === views.length &&
      views.every((view, index) => nodes[index].dataset.gaugeKey === view.key)
    ) {
      views.forEach((view, index) => updateGaugeNode(nodes[index], view));
      return;
    }
    if (!views.length) {
      container.innerHTML = `<div class="gauge-empty muted">${esc(emptyText)}</div>`;
      return;
    }
    container.innerHTML = views.map(gaugeHtml).join("");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        container.querySelectorAll(".gauge-value").forEach(circle => {
          circle.style.strokeDashoffset = circle.dataset.dash;
        });
      });
    });
  }

  function renderGauges(gauges) {
    const resources = (gauges?.resources || []).map(item => gaugeView(item));
    const disks = (gauges?.disks || []).map(item =>
      gaugeView({
        ...item,
        title: item.mount,
        detailed: `${item.used} / ${item.size}`,
        info: [`可用 ${item.available}`, `文件系统 ${item.type}`],
      }),
    );
    mountGauges($("#resourceGauges"), resources, "暂无资源数据");
    mountGauges($("#diskGauges"), disks, "暂无磁盘数据");
  }

  /** 仪表盘停留时轮询表盘，CPU / 内存 / 磁盘占用才会跟着变 */
  async function refreshGauges() {
    if (document.hidden || !state.started || state.page !== "dashboard") return;
    if (state.tokenRequired && !state.token) return;
    try {
      const data = await api("/gauges");
      if (state.page !== "dashboard") return;
      if (state.overview) state.overview.gauges = data.gauges;
      renderGauges(data.gauges);
    } catch {}
  }

  function startGaugePoll() {
    window.setInterval(refreshGauges, 6000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshGauges();
    });
  }

  /* ---------------- AI / 工具 ---------------- */

  async function loadAI(force) {
    if (!force && state.ai) {
      renderAI();
      renderTools();
      loadAIModels(force).catch(() => {});
      renderModelFallbackPanel().catch(() => {});
      return state.ai;
    }
    const data = await api("/ai");
    state.ai = data;
    renderAI();
    renderTools();
    await loadAIModels(force).catch(() => null);
    // 备选模型池已并入状态页，打开状态时一并加载
    renderModelFallbackPanel().catch(() => {});
    return data;
  }

  function renderAI() {
    const data = state.ai;
    if (!data) return;
    const sessions = data.sessions || [];

    $("#aiStatStatus").textContent = data.enabled ? (data.initialized ? "运行中" : "已启用") : "未启用";
    $("#aiStatStatusFoot").textContent = data.enabled ? "" : "在「AI → 设置」中启用";
    const modelEl = $("#aiStatModel");
    modelEl.textContent = data.model || "未选择";
    modelEl.title = data.model || "";
    $("#aiStatModelFoot").textContent = data.activeChannel?.name
      ? `${data.activeChannel.name}${data.activePreset ? ` · 预设 ${data.activePreset.name}` : ""}`
      : data.enabled
        ? "未指定渠道"
        : "AI 未启用";
    $("#aiStatSessions").textContent = fmtNum(sessions.length);
    $("#aiStatSessionsFoot").textContent = "";

    const keyPill = $("#aiKeyPill");
    keyPill.className = `pill ${data.hasApiKey ? "pill-green" : "pill-amber"}`;
    keyPill.textContent = data.hasApiKey ? "API Key 已配置" : "API Key 未配置";

    $("#aiConfig").innerHTML = [
      kvRow("超时 / 重试", `${data.timeout ? `${fmtNum(data.timeout)} ms` : "—"} / ${data.maxRetries === undefined ? "—" : fmtNum(data.maxRetries)} 次`),
      kvRow("上下文上限", data.maxContextTokens ? `${fmtToken(data.maxContextTokens)} tokens` : "—"),
      kvRow("历史轮数", data.maxHistoryTurns ? `${fmtNum(data.maxHistoryTurns)} 轮` : "—"),
    ].join("");

    $("#aiFlags").innerHTML = [
      kvRow("群聊触发", pill(triggerLabel(data.groupTrigger), "pill-blue")),
      kvRow("群聊响应", boolPill(data.groupChat)),
      kvRow("私聊响应", boolPill(data.privateChat)),
      kvRow("主人自由回复", boolPill(data.masterFree)),
      kvRow("自动注册工具", boolPill(data.autoRegisterTools)),
      kvRow("单次工具上限", data.maxToolsPerRequest ? `${fmtNum(data.maxToolsPerRequest)} 个` : "不限制"),
      kvRow("允许主人工具", boolPill(data.allowMasterTools)),
      kvRow("知识库", boolPill(data.knowledgeBase)),
    ].join("");

    const disabledItems = []
      .concat((data.disabledTools || []).map(name => `工具：${name}`))
      .concat((data.disabledToolPlugins || []).map(name => `插件：${name}`));
    const disabledWrap = $("#aiDisabledWrap");
    if (disabledItems.length) {
      disabledWrap.hidden = false;
      $("#aiDisabledTools").innerHTML = disabledItems.map(item => `<span class="chip">${esc(item)}</span>`).join("");
    } else {
      disabledWrap.hidden = true;
      $("#aiDisabledTools").innerHTML = "";
    }

    renderAiSessionRows(sessions);
  }

  const AI_ADAPTER_LABELS = { openai: "OpenAI", gemini: "Gemini", claude: "Claude" };
  let aiModelApplying = false;

  async function loadAIModels(force) {
    if (!force && state.aiModels) {
      renderAIModels();
      return state.aiModels;
    }
    const data = await api("/ai/models");
    state.aiModels = data;
    renderAIModels();
    return data;
  }

  function aiAdapterLabel(item) {
    const label = AI_ADAPTER_LABELS[item?.adapterType] || "OpenAI";
    return item?.adapterType === "openai" && item?.apiFormat === "responses" ? `${label} · Responses` : label;
  }

  function aiSelectableChannels(pool) {
    const all = pool?.channels || [];
    const channels = all.filter(item => item.enabled);
    for (const id of [pool?.activeChannelId, pool?.effectiveChannelId]) {
      const channel = all.find(item => item.id === id);
      if (channel && !channels.includes(channel)) channels.push(channel);
    }
    return channels;
  }

  function aiChannelModels(channel) {
    return channel ? [...new Set([...(channel.models || []), channel.model].filter(Boolean))] : [];
  }

  const AI_MODEL_GLYPHS = {
    deepseek: [
    "M23.748 4.482c-.254-.124-.364.113-.512.234-.051.039-.094.09-.137.136-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.156-.708-.311-.955-.65-.172-.241-.219-.51-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.093.172.187.129.323-.082.28-.18.552-.266.833-.055.179-.137.217-.329.14a5.526 5.526 0 01-1.736-1.18c-.857-.828-1.631-1.742-2.597-2.458a11.365 11.365 0 00-.689-.471c-.985-.957.13-1.743.388-1.836.27-.098.093-.432-.779-.428-.872.004-1.67.295-2.687.684a3.055 3.055 0 01-.465.137 9.597 9.597 0 00-2.883-.102c-1.885.21-3.39 1.102-4.497 2.623C.082 8.606-.231 10.684.152 12.85c.403 2.284 1.569 4.175 3.36 5.653 1.858 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.133-.284 4.994-1.86.47.234.962.327 1.78.397.63.059 1.236-.03 1.705-.128.735-.156.684-.837.419-.961-2.155-1.004-1.682-.595-2.113-.926 1.096-1.296 2.746-2.642 3.392-7.003.05-.347.007-.565 0-.845-.004-.17.035-.237.23-.256a4.173 4.173 0 001.545-.475c1.396-.763 1.96-2.015 2.093-3.517.02-.23-.004-.467-.247-.588zM11.581 18c-2.089-1.642-3.102-2.183-3.52-2.16-.392.024-.321.471-.235.763.09.288.207.486.371.739.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.167-1.361-.802-2.5-1.86-3.301-3.307-.774-1.393-1.224-2.887-1.298-4.482-.02-.386.093-.522.477-.592a4.696 4.696 0 011.529-.039c2.132.312 3.946 1.265 5.468 2.774.868.86 1.525 1.887 2.202 2.891.72 1.066 1.494 2.082 2.48 2.914.348.292.625.514.891.677-.802.09-2.14.11-3.054-.614zm1-6.44a.306.306 0 01.415-.287.302.302 0 01.2.288.306.306 0 01-.31.307.303.303 0 01-.304-.308zm3.11 1.596c-.2.081-.399.151-.59.16a1.245 1.245 0 01-.798-.254c-.274-.23-.47-.358-.552-.758a1.73 1.73 0 01.016-.588c.07-.327-.008-.537-.239-.727-.187-.156-.426-.199-.688-.199a.559.559 0 01-.254-.078c-.11-.054-.2-.19-.114-.358.028-.054.16-.186.192-.21.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.391.451.462.576.685.914.176.265.336.537.445.848.067.195-.019.354-.25.452z",
    ],
    openai: [
    "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z",
    ],
    claude: [
    "M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z",
    ],
    gemini: [
    "M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81",
    ],
    qwen: [
    "M19.713 2.825h-5.907c0-.251-.066-.503-.196-.728L12.819.728A1.46 1.46 0 0 0 11.559 0h-1.58c-.52 0-1 .275-1.26.728l-2.42 4.19a1.45 1.45 0 0 0 0 1.453l.791 1.37c.26.448.74.727 1.26.727h11.36c.52 0 1-.275 1.26-.728l.79-1.37a1.45 1.45 0 0 0 0-1.451l-.79-1.37a1.46 1.46 0 0 0-1.26-.728zM.195 9.905l2.951 5.115a1.46 1.46 0 0 0-.531.531l-.791 1.37a1.45 1.45 0 0 0 0 1.452l.79 1.37c.26.448.74.727 1.26.727h4.84c.52 0 1-.275 1.26-.728l.79-1.37a1.45 1.45 0 0 0 0-1.451L5.086 7.083a1.46 1.46 0 0 0-1.26-.728h-1.58c-.52 0-1 .276-1.26.728l-.79 1.37a1.45 1.45 0 0 0 0 1.452m15.888 13.367 2.951-5.115c.217.125.469.196.728.196h1.582c.52 0 1-.275 1.26-.728l.79-1.37a1.45 1.45 0 0 0 0-1.451l-2.42-4.191a1.46 1.46 0 0 0-1.259-.728h-1.582c-.52 0-1 .276-1.259.728l-5.678 9.838a1.45 1.45 0 0 0 0 1.452l.79 1.37c.26.448.74.727 1.26.727h1.582c.52 0 1-.275 1.26-.728z",
    ],
    zhipu: [
    "M11.991 23.503a.24.24 0 00-.244.248.24.24 0 00.244.249.24.24 0 00.245-.249.24.24 0 00-.22-.247l-.025-.001zM9.671 5.365a1.697 1.697 0 011.099 2.132l-.071.172-.016.04-.018.054c-.07.16-.104.32-.104.498-.035.71.47 1.279 1.186 1.314h.366c1.309.053 2.338 1.173 2.286 2.523-.052 1.332-1.152 2.38-2.478 2.327h-.174c-.715.018-1.274.64-1.239 1.368 0 .124.018.23.053.337.209.373.54.658.96.8.75.23 1.517-.125 1.9-.782l.018-.035c.402-.64 1.17-.96 1.92-.711.854.284 1.378 1.226 1.099 2.167a1.661 1.661 0 01-2.077 1.102 1.711 1.711 0 01-.907-.711l-.017-.035c-.2-.323-.463-.58-.851-.711l-.056-.018a1.646 1.646 0 00-1.954.746 1.66 1.66 0 01-1.065.764 1.677 1.677 0 01-1.989-1.279c-.209-.906.332-1.83 1.257-2.043a1.51 1.51 0 01.296-.035h.018c.68-.071 1.151-.622 1.116-1.333a1.307 1.307 0 00-.227-.693 2.515 2.515 0 01-.366-1.403 2.39 2.39 0 01.366-1.208c.14-.195.21-.444.227-.693.018-.71-.506-1.261-1.186-1.332l-.07-.018a1.43 1.43 0 01-.299-.07l-.05-.019a1.7 1.7 0 01-1.047-2.114 1.68 1.68 0 012.094-1.101zm-5.575 10.11c.26-.264.639-.367.994-.27.355.096.633.379.728.74.095.362-.007.748-.267 1.013-.402.41-1.053.41-1.455 0a1.062 1.062 0 010-1.482zm14.845-.294c.359-.09.738.024.992.297.254.274.344.665.237 1.025-.107.36-.396.634-.756.718-.551.128-1.1-.22-1.23-.781a1.05 1.05 0 01.757-1.26zm-.064-4.39c.314.32.49.753.49 1.206 0 .452-.176.886-.49 1.206-.315.32-.74.5-1.185.5-.444 0-.87-.18-1.184-.5a1.727 1.727 0 010-2.412 1.654 1.654 0 012.369 0zm-11.243.163c.364.484.447 1.128.218 1.691a1.665 1.665 0 01-2.188.923c-.855-.36-1.26-1.358-.907-2.228a1.68 1.68 0 011.33-1.038c.593-.08 1.183.169 1.547.652zm11.545-4.221c.368 0 .708.2.892.524.184.324.184.724 0 1.048a1.026 1.026 0 01-.892.524c-.568 0-1.03-.47-1.03-1.048 0-.579.462-1.048 1.03-1.048zm-14.358 0c.368 0 .707.2.891.524.184.324.184.724 0 1.048a1.026 1.026 0 01-.891.524c-.569 0-1.03-.47-1.03-1.048 0-.579.461-1.048 1.03-1.048zm10.031-1.475c.925 0 1.675.764 1.675 1.706s-.75 1.705-1.675 1.705-1.674-.763-1.674-1.705c0-.942.75-1.706 1.674-1.706zm-2.626-.684c.362-.082.653-.356.761-.718a1.062 1.062 0 00-.238-1.028 1.017 1.017 0 00-.996-.294c-.547.14-.881.7-.752 1.257.13.558.675.907 1.225.783zm0 16.876c.359-.087.644-.36.75-.72a1.062 1.062 0 00-.237-1.019 1.018 1.018 0 00-.985-.301 1.037 1.037 0 00-.762.717c-.108.361-.017.754.239 1.028.245.263.606.377.953.305l.043-.01zM17.19 3.5a.631.631 0 00.628-.64c0-.355-.279-.64-.628-.64a.631.631 0 00-.628.64c0 .355.28.64.628.64zm-10.38 0a.631.631 0 00.628-.64c0-.355-.28-.64-.628-.64a.631.631 0 00-.628.64c0 .355.279.64.628.64zm-5.182 7.852a.631.631 0 00-.628.64c0 .354.28.639.628.639a.63.63 0 00.627-.606l.001-.034a.62.62 0 00-.628-.64zm5.182 9.13a.631.631 0 00-.628.64c0 .355.279.64.628.64a.631.631 0 00.628-.64c0-.355-.28-.64-.628-.64zm10.38.018a.631.631 0 00-.628.64c0 .355.28.64.628.64a.631.631 0 00.628-.64c0-.355-.279-.64-.628-.64zm5.182-9.148a.631.631 0 00-.628.64c0 .354.279.639.628.639a.631.631 0 00.628-.64c0-.355-.28-.64-.628-.64zm-.384-4.992a.24.24 0 00.244-.249.24.24 0 00-.244-.249.24.24 0 00-.244.249c0 .142.122.249.244.249zM11.991.497a.24.24 0 00.245-.248A.24.24 0 0011.99 0a.24.24 0 00-.244.249c0 .133.108.236.223.247l.021.001zM2.011 6.36a.24.24 0 00.245-.249.24.24 0 00-.244-.249.24.24 0 00-.244.249.24.24 0 00.244.249zm0 11.263a.24.24 0 00-.243.248.24.24 0 00.244.249.24.24 0 00.244-.249.252.252 0 00-.244-.248zm19.995-.018a.24.24 0 00-.245.248.24.24 0 00.245.25.24.24 0 00.244-.25.252.252 0 00-.244-.248z",
    ],
    hunyuan: [
    "M12 0c6.627 0 12 5.373 12 12s-5.373 12-12 12S0 18.627 0 12 5.373 0 12 0zm1.652 1.123l-.01-.001c.533.097 1.023.233 1.41.404 6.084 2.683 7.396 9.214 1.601 14.338a3.781 3.781 0 01-5.337-.328 3.654 3.654 0 01-.884-3.044c-1.934.6-3.295 2.305-3.524 4.45-.204 1.912.324 4.044 2.056 5.634l.245.067C10.1 22.876 11.036 23 12 23c6.075 0 11-4.925 11-11 0-5.513-4.056-10.08-9.348-10.877zM2.748 6.21c-.178.269-.348.536-.51.803l-.235.394.078-.167A10.957 10.957 0 001 12c0 4.919 3.228 9.083 7.682 10.49l.214.065C3.523 18.528 2.84 14.149 6.47 8.68A2.234 2.234 0 102.748 6.21zm10.157-5.172c4.408 1.33 3.61 5.41 2.447 6.924-.86 1.117-2.922 1.46-3.708 2.238-.666.657-1.077 1.462-1.212 2.291A5.303 5.303 0 0112 12.258a5.672 5.672 0 001.404-11.169 10.51 10.51 0 00-.5-.052z",
    ],
    wenxin: [
    "M11.32 1.176a1.4 1.4 0 011.36 0l8.64 4.843c.421.234.68.67.68 1.141v9.68c0 .472-.259.908-.68 1.143l-8.64 4.84a1.4 1.4 0 01-1.36 0l-8.64-4.84A1.31 1.31 0 012 16.84V7.159c0-.471.259-.907.68-1.142l8.64-4.84zm7.42 13.839V8.227L12.002 12 12 19.551l6.059-3.394a1.31 1.31 0 00.68-1.142zM12.68 4.833a1.393 1.393 0 00-1.36 0L5.944 7.846c-.421.235-.68.67-.68 1.142v6.027c0 .47.259.905.68 1.142l2.795 1.566V11.09a1.546 1.546 0 00.221.79 1.527 1.527 0 01-.216-.834l.004-.094.02-.15.018-.084.017-.062.039-.117.062-.142.035-.065.081-.13.094-.122.084-.091.08-.075.125-.1.071-.048.134-.076 5.87-3.29-2.796-1.566z",
    ],
    doubao: [
    "M5.31 15.756c.172-3.75 1.883-5.999 2.549-6.739-3.26 2.058-5.425 5.658-6.358 8.308v1.12C1.501 21.513 4.226 24 7.59 24a6.59 6.59 0 002.2-.375c.353-.12.7-.248 1.039-.378.913-.899 1.65-1.91 2.243-2.992-4.877 2.431-7.974.072-7.763-4.5l.002.001z",
    "M22.57 10.283c-1.212-.901-4.109-2.404-7.397-2.8.295 3.792.093 8.766-2.1 12.773a12.782 12.782 0 01-2.244 2.992c3.764-1.448 6.746-3.457 8.596-5.219 2.82-2.683 3.353-5.178 3.361-6.66a2.737 2.737 0 00-.216-1.084v-.002zM14.303 1.867C12.955.7 11.248 0 9.39 0 7.532 0 5.883.677 4.545 1.807 2.791 3.29 1.627 5.557 1.5 8.125v9.201c.932-2.65 3.097-6.25 6.357-8.307.5-.318 1.025-.595 1.569-.829 1.883-.801 3.878-.932 5.746-.706-.222-2.83-.718-5.002-.87-5.617h.001z",
    "M17.305 4.961a199.47 199.47 0 01-1.08-1.094c-.202-.213-.398-.419-.586-.622l-1.333-1.378c.151.615.648 2.786.869 5.617 3.288.395 6.185 1.898 7.396 2.8-1.306-1.275-3.475-3.487-5.266-5.323z",
    ],
    kimi: [
    "M21.846 0a1.923 1.923 0 110 3.846H20.15a.226.226 0 01-.227-.226V1.923C19.923.861 20.784 0 21.846 0z",
    "M11.065 11.199l7.257-7.2c.137-.136.06-.41-.116-.41H14.3a.164.164 0 00-.117.051l-7.82 7.756c-.122.12-.302.013-.302-.179V3.82c0-.127-.083-.23-.185-.23H3.186c-.103 0-.186.103-.186.23V19.77c0 .128.083.23.186.23h2.69c.103 0 .186-.102.186-.23v-3.25c0-.069.025-.135.069-.178l2.424-2.406a.158.158 0 01.205-.023l6.484 4.772a7.677 7.677 0 003.453 1.283c.108.012.2-.095.2-.23v-3.06c0-.117-.07-.212-.164-.227a5.028 5.028 0 01-2.027-.807l-5.613-4.064c-.117-.078-.132-.279-.028-.381z",
    ],
    minimax: [
    "M16.278 2c1.156 0 2.093.927 2.093 2.07v12.501a.74.74 0 00.744.709.74.74 0 00.743-.709V9.099a2.06 2.06 0 012.071-2.049A2.06 2.06 0 0124 9.1v6.561a.649.649 0 01-.652.645.649.649 0 01-.653-.645V9.1a.762.762 0 00-.766-.758.762.762 0 00-.766.758v7.472a2.037 2.037 0 01-2.048 2.026 2.037 2.037 0 01-2.048-2.026v-12.5a.785.785 0 00-.788-.753.785.785 0 00-.789.752l-.001 15.904A2.037 2.037 0 0113.441 22a2.037 2.037 0 01-2.048-2.026V18.04c0-.356.292-.645.652-.645.36 0 .652.289.652.645v1.934c0 .263.142.506.372.638.23.131.514.131.744 0a.734.734 0 00.372-.638V4.07c0-1.143.937-2.07 2.093-2.07zm-5.674 0c1.156 0 2.093.927 2.093 2.07v11.523a.648.648 0 01-.652.645.648.648 0 01-.652-.645V4.07a.785.785 0 00-.789-.78.785.785 0 00-.789.78v14.013a2.06 2.06 0 01-2.07 2.048 2.06 2.06 0 01-2.071-2.048V9.1a.762.762 0 00-.766-.758.762.762 0 00-.766.758v3.8a2.06 2.06 0 01-2.071 2.049A2.06 2.06 0 010 12.9v-1.378c0-.357.292-.646.652-.646.36 0 .653.29.653.646V12.9c0 .418.343.757.766.757s.766-.339.766-.757V9.099a2.06 2.06 0 012.07-2.048 2.06 2.06 0 012.071 2.048v8.984c0 .419.343.758.767.758.423 0 .766-.339.766-.758V4.07c0-1.143.937-2.07 2.093-2.07z",
    ],
    stepfun: [
    "M12 0C5.372 0 0 5.372 0 12s5.372 12 12 12 12-5.372 12-12S18.628 0 12 0zM8.762 19.614H4.376v-4.386h4.386v4.386zm5.423 0H9.798v-4.386h4.387v4.386zm0-5.42H9.798V9.81h4.387v4.386zm0-5.418H9.798V4.39h4.387v4.386zm5.422-.004h-4.386V4.386h4.386v4.386z",
    ],
    baichuan: [
    "M7.333 2h-3.2l-2 4.333V17.8L0 22h5.2l2.028-4.2L7.333 2zm7.334 0h-5.2v20h5.2V2zM16.8 7.733H22V22h-5.2V7.733zM22 2h-5.2v4.133H22V2z",
    ],
    sensenova: [
      { d: "M23 8.333h-7.333v7.334H23V8.333z" },
      { d: "M1 1v14.667h7.333V8.333h7.334V1H1z", o: ".33" },
      { d: "M14.038 4.333h.17l1.459 1.456v.17l-1.63-1.626zM13.224 4.333h.17l2.273 2.268v.17l-2.443-2.438zM12.41 4.333h.17l3.087 3.08v.17l-3.257-3.25zM11.596 4.333h.17l3.9 3.892v.108h-.06l-4.01-4zM10.782 4.333h.17l4.01 4h-.17l-4.01-4zM9.968 4.333h.17l4.009 4h-.17l-4.01-4zM9.154 4.333h.17l4.009 4h-.17l-4.01-4zM8.34 4.333h.17l4.01 4h-.17l-4.01-4zM7.521 4.333h.17l4.01 4h-.17l-4.01-4zM6.707 4.333h.17l4.01 4h-.17l-4.01-4zM5.892 4.333h.17l4.009 4h-.17l-4.01-4zM5.077 4.333h.17l4.01 4h-.17l-4.01-4zM4.333 4.403v-.07h.1l4.01 4h-.11v.06l-4-3.99zM4.333 5.215v-.17l4 3.991v.17l-4-3.99zM4.333 6.027v-.17l4 3.991v.17l-4-3.99zM4.333 6.84v-.17l4 3.99v.17l-4-3.99zM4.333 7.652v-.17l4 3.99v.17l-4-3.99zM4.333 8.464v-.17l4 3.99v.17l-4-3.99zM4.333 9.276v-.17l4 3.991v.17l-4-3.991zM4.333 10.088v-.17l4 3.991v.17l-4-3.991zM4.333 10.9v-.17l4 3.991v.17l-4-3.991zM4.333 11.712v-.17l4 3.991v.134h-.036l-3.964-3.955zM4.333 12.526v-.17l3.318 3.31h-.17l-3.148-3.14zM4.333 13.34v-.169l2.502 2.496h-.17L4.333 13.34zM4.333 14.152v-.169l1.688 1.684h-.17l-1.518-1.514zM4.333 14.965v-.17l.874.872h-.17l-.704-.702zM15.667 5.146l-.815-.813h.17l.645.644v.169z" },
      { d: "M23 15.667h-7.333V23H23v-7.333z", o: ".33" },
      { d: "M15.667 15.667H8.333V23h7.334v-7.333z" },
    ],
    yi: [
    "M18.62 13.927c.611 0 1.107.505 1.107 1.128v5.817c0 .623-.496 1.128-1.108 1.128a1.118 1.118 0 01-1.108-1.128v-5.817c0-.623.496-1.128 1.108-1.128zM16.59 3.052a1.094 1.094 0 011.562-.129c.466.404.522 1.116.126 1.59l-5.938 7.111v9.147c0 .624-.496 1.129-1.108 1.129a1.118 1.118 0 01-1.108-1.129v-9.477l.003-.088.01-.087c.015-.232.102-.462.261-.654l6.192-7.413zM2.906 2.256a1.094 1.094 0 011.559.157l4.387 5.45a1.142 1.142 0 01-.155 1.587 1.094 1.094 0 01-1.559-.157l-4.387-5.45a1.144 1.144 0 01.06-1.498l.095-.09z",
    ],
    grok: [
    "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z",
    ],
    llama: [
    "M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.358-2.602zm-10.201.553c1.265 0 2.058.791 2.675 1.446.307.327.737.871 1.234 1.579l-1.02 1.566c-.757 1.163-1.882 3.017-2.837 4.338-1.191 1.649-1.81 1.817-2.486 1.817-.524 0-1.038-.237-1.383-.794-.263-.426-.464-1.13-.464-2.046 0-2.221.63-4.535 1.66-6.088.454-.687.964-1.226 1.533-1.533a2.264 2.264 0 0 1 1.088-.285z",
    ],
    bytedance: [
    "M19.8772 1.4685L24 2.5326v18.9426l-4.1228 1.0563V1.4685zm-13.3481 9.428l4.115 1.0641v8.9786l-4.115 1.0642v-11.107zM0 2.572l4.115 1.0642v16.7354L0 21.428V2.572zm17.4553 5.6205v11.107l-4.1228-1.0642V9.2568l4.1228-1.0642z",
    ],
    baidu: [
    "M9.154 0C7.71 0 6.54 1.658 6.54 3.707c0 2.051 1.171 3.71 2.615 3.71 1.446 0 2.614-1.659 2.614-3.71C11.768 1.658 10.6 0 9.154 0zm7.025.594C14.86.58 13.347 2.589 13.2 3.927c-.187 1.745.25 3.487 2.179 3.735 1.933.25 3.175-1.806 3.422-3.364.252-1.555-.995-3.364-2.362-3.674a1.218 1.218 0 0 0-.261-.03zM3.582 5.535a2.811 2.811 0 0 0-.156.008c-2.118.19-2.428 3.24-2.428 3.24-.287 1.41.686 4.425 3.297 3.864 2.617-.561 2.262-3.68 2.183-4.362-.125-1.018-1.292-2.773-2.896-2.75zm16.534 1.753c-2.308 0-2.617 2.119-2.617 3.616 0 1.43.121 3.425 2.988 3.362 2.867-.063 2.553-3.238 2.553-3.988 0-.745-.62-2.99-2.924-2.99zm-8.264 2.478c-1.424.014-2.708.925-3.323 1.947-1.118 1.868-2.863 3.05-3.112 3.363-.25.309-3.61 2.116-2.864 5.42.746 3.301 3.365 3.237 3.365 3.237s1.93.19 4.171-.31c2.24-.495 4.17.123 4.17.123s5.233 1.748 6.665-1.616c1.43-3.364-.808-5.109-.808-5.109s-2.99-2.306-4.736-4.798c-1.072-1.665-2.348-2.268-3.528-2.257zm-2.234 3.84l1.542.024v8.197H7.758c-1.47-.291-2.055-1.292-2.13-1.462-.072-.173-.488-.976-.268-2.343.635-2.049 2.447-2.196 2.447-2.196h1.81zm3.964 2.39v3.881c.096.413.612.488.612.488h1.614v-4.343h1.689v5.782h-3.915c-1.517-.39-1.59-1.465-1.59-1.465v-4.317zm-5.458 1.147c-.66.197-.978.708-1.05.928-.076.22-.247.78-.1 1.269.294 1.095 1.248 1.144 1.248 1.144h1.37v-3.34z",
    ],
    mistral: [
      "M3.428 3.4h3.429v3.428h3.429v3.429h-.002 3.431V6.828h3.427V3.4h3.43v13.714H24v3.429H13.714v-3.428h-3.428v-3.429h-3.43v3.428h3.43v3.429H0v-3.429h3.428V3.4zm10.286 13.715h3.428v-3.429h-3.427v3.429z",
    ],
    gemma: [
      "M12.34 5.953a8.233 8.233 0 01-.247-1.125V3.72a8.25 8.25 0 015.562 2.232H12.34zm-.69 0c.113-.373.199-.755.257-1.145V3.72a8.25 8.25 0 00-5.562 2.232h5.304zm-5.433.187h5.373a7.98 7.98 0 01-.267.696 8.41 8.41 0 01-1.76 2.65L6.216 6.14zm-.264-.187H2.977v.187h2.915a8.436 8.436 0 00-2.357 5.767H0v.186h3.535a8.436 8.436 0 002.357 5.767H2.977v.186h2.976v2.977h.187v-2.915a8.436 8.436 0 005.767 2.357V24h.186v-3.535a8.436 8.436 0 005.767-2.357v2.915h.186v-2.977h2.977v-.186h-2.915a8.436 8.436 0 002.357-5.767H24v-.186h-3.535a8.436 8.436 0 00-2.357-5.767h2.915v-.187h-2.977V2.977h-.186v2.915a8.436 8.436 0 00-5.767-2.357V0h-.186v3.535A8.436 8.436 0 006.14 5.892V2.977h-.187v2.976zm6.14 14.326a8.25 8.25 0 005.562-2.233H12.34c-.108.367-.19.743-.247 1.126v1.107zm-.186-1.087a8.015 8.015 0 00-.258-1.146H6.345a8.25 8.25 0 005.562 2.233v-1.087zm-8.186-7.285h1.107a8.23 8.23 0 001.125-.247V6.345a8.25 8.25 0 00-2.232 5.562zm1.087.186H3.72a8.25 8.25 0 002.232 5.562v-5.304a8.012 8.012 0 00-1.145-.258zm15.47-.186a8.25 8.25 0 00-2.232-5.562v5.315c.367.108.743.19 1.126.247h1.107zm-1.086.186c-.39.058-.772.144-1.146.258v5.304a8.25 8.25 0 002.233-5.562h-1.087zm-1.332 5.69V12.41a7.97 7.97 0 00-.696.267 8.409 8.409 0 00-2.65 1.76l3.346 3.346zm0-6.18v-5.45l-.012-.013h-5.451c.076.235.162.468.26.696a8.698 8.698 0 001.819 2.688 8.698 8.698 0 002.688 1.82c.228.097.46.183.696.259zM6.14 17.848V12.41c.235.078.468.167.696.267a8.403 8.403 0 012.688 1.799 8.404 8.404 0 011.799 2.688c.1.228.19.46.267.696H6.152l-.012-.012zm0-6.245V6.326l3.29 3.29a8.716 8.716 0 01-2.594 1.728 8.14 8.14 0 01-.696.259zm6.257 6.257h5.277l-3.29-3.29a8.716 8.716 0 00-1.728 2.594 8.135 8.135 0 00-.259.696zm-2.347-7.81a9.435 9.435 0 01-2.88 1.96 9.14 9.14 0 012.88 1.94 9.14 9.14 0 011.94 2.88 9.435 9.435 0 011.96-2.88 9.14 9.14 0 012.88-1.94 9.435 9.435 0 01-2.88-1.96 9.434 9.434 0 01-1.96-2.88 9.14 9.14 0 01-1.94 2.88z",
    ],
    perplexity: [
      "M19.785 0v7.272H22.5V17.62h-2.935V24l-7.037-6.194v6.145h-1.091v-6.152L4.392 24v-6.465H1.5V7.188h2.884V0l7.053 6.494V.19h1.09v6.49L19.786 0zm-7.257 9.044v7.319l5.946 5.234V14.44l-5.946-5.397zm-1.099-.08l-5.946 5.398v7.235l5.946-5.234V8.965zm8.136 7.58h1.844V8.349H13.46l6.105 5.54v2.655zm-8.982-8.28H2.59v8.195h1.8v-2.576l6.192-5.62zM5.475 2.476v4.71h5.115l-5.115-4.71zm13.219 0l-5.115 4.71h5.115v-4.71z",
    ],
    groq: [
      "M12.036 2c-3.853-.035-7 3-7.036 6.781-.035 3.782 3.055 6.872 6.908 6.907h2.42v-2.566h-2.292c-2.407.028-4.38-1.866-4.408-4.23-.029-2.362 1.901-4.298 4.308-4.326h.1c2.407 0 4.358 1.915 4.365 4.278v6.305c0 2.342-1.944 4.25-4.323 4.279a4.375 4.375 0 01-3.033-1.252l-1.851 1.818A7 7 0 0012.029 22h.092c3.803-.056 6.858-3.083 6.879-6.816v-6.5C18.907 4.963 15.817 2 12.036 2z",
    ],
    together: [
      "M23.197 4.503A6 6 0 0015 2.307a5.973 5.973 0 00-2.995 4.933l5.996.008v.515h-5.996c.039.937.298 1.87.8 2.74a6 6 0 1010.39-6z",
      "M.805 4.5A6 6 0 003 12.697a5.972 5.972 0 005.77.127L5.779 7.627l.446-.257 2.997 5.192A6 6 0 10.804 4.5z",
      "M12 23.894a6 6 0 005.999-6c0-2.13-1.1-3.996-2.775-5.06l-3.005 5.189-.444-.258 2.997-5.192A6 6 0 1012 23.894z",
    ],
    nvidia: [
      "M10.212 8.976V7.62c.127-.01.256-.017.388-.021 3.596-.117 5.957 3.184 5.957 3.184s-2.548 3.647-5.282 3.647a3.227 3.227 0 01-1.063-.175v-4.109c1.4.174 1.681.812 2.523 2.258l1.873-1.627a4.905 4.905 0 00-3.67-1.846 6.594 6.594 0 00-.729.044m0-4.476v2.025c.13-.01.259-.019.388-.024 5.002-.174 8.261 4.226 8.261 4.226s-3.743 4.69-7.643 4.69c-.338 0-.675-.031-1.007-.092v1.25c.278.038.558.057.838.057 3.629 0 6.253-1.91 8.794-4.169.421.347 2.146 1.193 2.501 1.564-2.416 2.083-8.048 3.763-11.24 3.763-.308 0-.603-.02-.894-.048V19.5H24v-15H10.21zm0 9.756v1.068c-3.356-.616-4.287-4.21-4.287-4.21a7.173 7.173 0 014.287-2.138v1.172h-.005a3.182 3.182 0 00-2.502 1.178s.615 2.276 2.507 2.931m-5.961-3.3c1.436-1.935 3.604-3.148 5.961-3.336V6.523C5.81 6.887 2 10.723 2 10.723s2.158 6.427 8.21 7.015v-1.166C5.77 16 4.25 10.958 4.25 10.958h-.002z",
    ],
    azure: [
      { d: "M18.397 15.296H7.4a.51.51 0 00-.347.882l7.066 6.595c.206.192.477.298.758.298h6.226l-2.706-7.775z", o: ".75" },
      { d: "M8.295.857c-.477 0-.9.304-1.053.756L.495 21.605a1.11 1.11 0 001.052 1.466h5.43c.477 0 .9-.304 1.053-.755l1.341-3.975-2.318-2.163a.51.51 0 01.347-.882h3L15.271.857H8.295z", o: ".5" },
      "M17.193 1.613a1.11 1.11 0 00-1.052-.756h-7.81.035c.477 0 .9.304 1.052.756l6.748 19.992a1.11 1.11 0 01-1.052 1.466h-.12 7.895a1.11 1.11 0 001.052-1.466L17.193 1.613z",
    ],
    bedrock: [
      "M13.05 15.513h3.08c.214 0 .389.177.389.394v1.82a1.704 1.704 0 011.296 1.661c0 .943-.755 1.708-1.685 1.708-.931 0-1.686-.765-1.686-1.708 0-.807.554-1.484 1.297-1.662v-1.425h-2.69v4.663a.395.395 0 01-.188.338l-2.69 1.641a.385.385 0 01-.405-.002l-4.926-3.086a.395.395 0 01-.185-.336V16.3L2.196 14.87A.395.395 0 012 14.555L2 14.528V9.406c0-.14.073-.27.192-.34l2.465-1.462V4.448c0-.129.062-.249.165-.322l.021-.014L9.77 1.058a.385.385 0 01.407 0l2.69 1.675a.395.395 0 01.185.336V7.6h3.856V5.683a1.704 1.704 0 01-1.296-1.662c0-.943.755-1.708 1.685-1.708.931 0 1.685.765 1.685 1.708 0 .807-.553 1.484-1.296 1.662v2.311a.391.391 0 01-.389.394h-4.245v1.806h6.624a1.69 1.69 0 011.64-1.313c.93 0 1.685.764 1.685 1.707 0 .943-.754 1.708-1.685 1.708a1.69 1.69 0 01-1.64-1.314H13.05v1.937h4.953l.915 1.18a1.66 1.66 0 01.84-.227c.931 0 1.685.764 1.685 1.707 0 .943-.754 1.708-1.685 1.708-.93 0-1.685-.765-1.685-1.708 0-.346.102-.668.276-.937l-.724-.935H13.05v1.806zM9.973 1.856L7.93 3.122V6.09h-.778V3.604L5.435 4.669v2.945l2.11 1.36L9.712 7.61V5.334h.778V7.83c0 .136-.07.263-.184.335L7.963 9.638v2.081l1.422 1.009-.446.646-1.406-.998-1.53 1.005-.423-.66 1.605-1.055v-1.99L5.038 8.29l-2.26 1.34v1.676l1.972-1.189.398.677-2.37 1.429V14.3l2.166 1.258 2.27-1.368.397.677-2.176 1.311V19.3l1.876 1.175 2.365-1.426.398.678-2.017 1.216 1.918 1.201 2.298-1.403v-5.78l-4.758 2.893-.4-.675 5.158-3.136V3.289L9.972 1.856zM16.13 18.47a.913.913 0 00-.908.92c0 .507.406.918.908.918a.913.913 0 00.907-.919.913.913 0 00-.907-.92zm3.63-3.81a.913.913 0 00-.908.92c0 .508.406.92.907.92a.913.913 0 00.908-.92.913.913 0 00-.908-.92zm1.555-4.99a.913.913 0 00-.908.92c0 .507.407.918.908.918a.913.913 0 00.907-.919.913.913 0 00-.907-.92zM17.296 3.1a.913.913 0 00-.907.92c0 .508.406.92.907.92a.913.913 0 00.908-.92.913.913 0 00-.908-.92z",
    ],
    ai21: [
      "M6.47 17l-.367-1.189H2.718L2.35 17H0l3.398-9.789h2.026L8.864 17H6.47zm-2.052-6.993l-1.17 4.028H5.56l-1.142-4.028zm4.707-2.796h2.23V17h-2.23V7.211zM11.955 15c.1-.483.277-.946.524-1.37.214-.359.482-.68.795-.951.32-.273.658-.52 1.013-.741.28-.168.54-.33.781-.483.222-.14.433-.296.632-.468.172-.148.317-.325.428-.525.107-.199.16-.423.157-.65 0-.392-.104-.674-.313-.846a1.176 1.176 0 00-.775-.259 1.207 1.207 0 00-.863.329c-.231.219-.347.585-.347 1.098H11.8a3.387 3.387 0 01.224-1.245c.146-.377.371-.716.66-.993.306-.29.667-.514 1.06-.657A4.04 4.04 0 0115.183 7c.42-.002.84.057 1.244.175.376.107.73.287 1.04.531.305.246.55.562.714.923.185.419.275.875.265 1.335.005.39-.084.774-.259 1.12-.167.328-.38.63-.632.894-.246.259-.517.49-.808.693-.29.2-.554.37-.789.51-.326.224-.596.417-.809.58a3.872 3.872 0 00-.51.455 1.229 1.229 0 00-.265.434 1.633 1.633 0 00-.074.517h4.078V17h-6.606a9.24 9.24 0 01.183-2zM18.8 8.93a5.05 5.05 0 001.135-.105c.25-.049.484-.156.686-.314.163-.139.28-.324.34-.532.068-.25.1-.51.095-.77H23V17h-2.243v-6.475H18.8V8.93z",
    ],
    cerebras: [
      "M14.121 2.701a9.299 9.299 0 000 18.598V22.7c-5.91 0-10.7-4.791-10.7-10.701S8.21 1.299 14.12 1.299V2.7zm4.752 3.677A7.353 7.353 0 109.42 17.643l-.901 1.074a8.754 8.754 0 01-1.08-12.334 8.755 8.755 0 0112.335-1.08l-.901 1.075zm-2.255.844a5.407 5.407 0 00-5.048 9.563l-.656 1.24a6.81 6.81 0 016.358-12.043l-.654 1.24zM14.12 8.539a3.46 3.46 0 100 6.922v1.402a4.863 4.863 0 010-9.726v1.402z",
      "M15.407 10.836a2.24 2.24 0 00-.51-.409 1.084 1.084 0 00-.544-.152c-.255 0-.483.047-.684.14a1.58 1.58 0 00-.84.912c-.074.203-.11.416-.11.631 0 .218.036.43.11.631a1.594 1.594 0 00.84.913c.2.093.43.14.684.14.216 0 .417-.046.602-.135.188-.09.35-.225.475-.392l.928 1.006c-.14.14-.3.261-.482.363a3.367 3.367 0 01-1.083.38c-.17.026-.317.04-.44.04a3.315 3.315 0 01-1.182-.21 2.825 2.825 0 01-.961-.597 2.816 2.816 0 01-.644-.929 2.987 2.987 0 01-.238-1.21c0-.444.08-.847.238-1.21.15-.35.368-.666.643-.929.278-.261.605-.464.962-.596a3.315 3.315 0 011.182-.21c.355 0 .712.068 1.072.204.361.138.685.36.944.649l-.962.97z",
    ],
    deepinfra: [
      "M3.294 7.821A2.297 2.297 0 011 5.527a2.297 2.297 0 012.294-2.295A2.297 2.297 0 015.59 5.527 2.297 2.297 0 013.294 7.82zm0-3.688a1.396 1.396 0 000 2.79 1.396 1.396 0 000-2.79zM3.294 14.293A2.297 2.297 0 011 11.998a2.297 2.297 0 012.294-2.294 2.297 2.297 0 012.295 2.294 2.297 2.297 0 01-2.295 2.295zm0-3.688a1.395 1.395 0 000 2.788 1.395 1.395 0 100-2.788zM3.294 20.761A2.297 2.297 0 011 18.467a2.297 2.297 0 012.294-2.295 2.297 2.297 0 012.295 2.295 2.297 2.297 0 01-2.295 2.294zm0-3.688a1.396 1.396 0 000 2.79 1.396 1.396 0 000-2.79zM20.738 7.821a2.297 2.297 0 01-2.295-2.294 2.297 2.297 0 012.294-2.295 2.297 2.297 0 012.295 2.295 2.297 2.297 0 01-2.294 2.294zm0-3.688a1.396 1.396 0 101.395 1.395c0-.77-.626-1.395-1.395-1.395zM20.738 14.293a2.297 2.297 0 01-2.295-2.295 2.297 2.297 0 012.294-2.294 2.297 2.297 0 012.295 2.294 2.297 2.297 0 01-2.294 2.295zm0-3.688c-.769 0-1.395.625-1.395 1.393a1.396 1.396 0 002.79 0c0-.77-.626-1.393-1.395-1.393zM20.738 20.761a2.297 2.297 0 01-2.295-2.294 2.297 2.297 0 012.294-2.295 2.297 2.297 0 012.295 2.295 2.297 2.297 0 01-2.294 2.294zm0-3.688a1.396 1.396 0 101.395 1.395c0-.77-.626-1.395-1.395-1.395zM12.016 11.057a2.297 2.297 0 01-2.294-2.294 2.297 2.297 0 012.294-2.295 2.297 2.297 0 012.295 2.295 2.297 2.297 0 01-2.295 2.294zm0-3.688a1.396 1.396 0 101.395 1.395c0-.77-.625-1.395-1.395-1.395zM12.017 4.589a2.297 2.297 0 01-2.295-2.295A2.297 2.297 0 0112.017 0a2.297 2.297 0 012.294 2.294 2.297 2.297 0 01-2.294 2.295zm0-3.688a1.396 1.396 0 101.395 1.395c0-.77-.626-1.395-1.395-1.395zM12.017 17.529a2.297 2.297 0 01-2.295-2.295 2.297 2.297 0 012.295-2.294 2.297 2.297 0 012.294 2.294 2.297 2.297 0 01-2.294 2.295zm0-3.688a1.396 1.396 0 101.395 1.395c0-.77-.626-1.395-1.395-1.395zM12.016 24a2.297 2.297 0 01-2.294-2.295 2.297 2.297 0 012.294-2.294 2.297 2.297 0 012.295 2.294A2.297 2.297 0 0112.016 24zm0-3.688a1.396 1.396 0 101.395 1.395c0-.77-.625-1.395-1.395-1.395z",
      "M8.363 8.222a.742.742 0 01-.277-.053l-1.494-.596a.75.75 0 11.557-1.392l1.493.595a.75.75 0 01-.278 1.446h-.001zM8.363 14.566a.743.743 0 01-.277-.053l-1.494-.595a.75.75 0 11.557-1.393l1.493.596a.75.75 0 01-.278 1.445h-.001zM17.124 11.397a.741.741 0 01-.277-.054l-1.493-.595a.75.75 0 11.555-1.392l1.493.595a.75.75 0 01-.278 1.446zM17.124 5.05a.744.744 0 01-.277-.054L15.354 4.4a.75.75 0 01.555-1.392l1.493.596a.75.75 0 01-.278 1.445zM17.124 17.739a.743.743 0 01-.277-.053l-1.494-.596a.75.75 0 11.556-1.392l1.493.596a.75.75 0 01-.278 1.445zM6.91 17.966a.75.75 0 01-.279-1.445l1.494-.595a.749.749 0 11.556 1.392l-1.493.595a.743.743 0 01-.277.053H6.91zM6.91 11.66a.75.75 0 01-.279-1.446l1.494-.595a.75.75 0 01.556 1.392l-1.493.595a.743.743 0 01-.277.053H6.91zM6.91 5.033a.75.75 0 01-.279-1.446l1.494-.595a.75.75 0 01.556 1.392l-1.493.596a.744.744 0 01-.277.053H6.91zM8.363 21.364a.743.743 0 01-.277-.053l-1.494-.596a.75.75 0 01.555-1.392l1.494.595a.75.75 0 01-.278 1.446zM15.63 8.223a.75.75 0 01-.278-1.447l1.494-.595a.75.75 0 01.556 1.393l-1.494.595a.744.744 0 01-.276.054h-.002zM15.63 14.567a.75.75 0 01-.278-1.446l1.494-.596a.75.75 0 01.556 1.394l-1.494.595a.743.743 0 01-.276.053h-.002zM15.63 21.363a.749.749 0 01-.278-1.445l1.494-.595a.75.75 0 11.555 1.392l-1.494.595a.741.741 0 01-.277.053z",
    ],
    fireworks: [
      "M14.8 5l-2.801 6.795L9.195 5H7.397l3.072 7.428a1.64 1.64 0 003.038.002L16.598 5H14.8zm1.196 10.352l5.124-5.244-.699-1.669-5.596 5.739a1.664 1.664 0 00-.343 1.807 1.642 1.642 0 001.516 1.012L16 17l8-.02-.699-1.669-7.303.041h-.002zM2.88 10.104l.699-1.669 5.596 5.739c.468.479.603 1.189.343 1.807a1.643 1.643 0 01-1.516 1.012l-8-.018-.002.002.699-1.669 7.303.042-5.122-5.246z",
    ],
    sambanova: [
      "M23 23h-1.223V8.028c0-3.118-2.568-5.806-5.744-5.806H8.027c-3.176 0-5.744 2.565-5.744 5.686 0 3.119 2.568 5.684 5.744 5.684h.794c1.346 0 2.445 1.1 2.445 2.444 0 1.346-1.1 2.446-2.445 2.446H1v-1.223h7.761c.671 0 1.223-.551 1.223-1.16 0-.67-.552-1.16-1.223-1.16h-.794C4.177 14.872 1 11.756 1 7.909 1 4.058 4.176 1 8.027 1h8.066C19.88 1 23 4.239 23 8.028V23z",
      "M8.884 12.672c1.71.06 3.361 1.588 3.361 3.422 0 1.833-1.528 3.421-3.421 3.421H1v1.223h7.761c2.568 0 4.705-2.077 4.705-4.644 0-.672-.123-1.283-.43-1.894-.245-.551-.67-1.1-1.099-1.528-.489-.429-1.039-.734-1.65-.977-.525-.175-1.048-.193-1.594-.212-.218-.008-.441-.016-.669-.034-.428 0-1.406-.245-1.956-.61a3.369 3.369 0 01-1.223-1.406c-.183-.489-.305-.977-.305-1.528A3.417 3.417 0 017.96 4.482h8.066c1.895 0 3.422 1.65 3.422 3.483v15.032h1.223V8.027c0-2.568-2.077-4.768-4.645-4.768h-8c-2.568 0-4.705 2.077-4.705 4.646 0 .67.123 1.282.43 1.894a4.45 4.45 0 001.099 1.528c.429.428 1.039.734 1.588.976.306.123.611.183.976.246.857.06 1.406.123 1.466.123h.003z",
      "M1 23h7.761v-.003c3.85 0 7.03-3.116 7.09-7.026 0-3.79-3.117-6.906-6.967-6.906H8.09c-.672 0-1.222-.552-1.222-1.16 0-.608.487-1.16 1.159-1.16h8.069c.608 0 1.159.611 1.159 1.283v14.97h1.223V8.024c0-1.345-1.1-2.505-2.445-2.505H7.967a2.451 2.451 0 00-2.445 2.445 2.45 2.45 0 002.445 2.445h.794c3.176 0 5.744 2.568 5.744 5.684s-2.568 5.684-5.744 5.684H1V23z",
    ],
    xai: [
      "M6.469 8.776L16.512 23h-4.464L2.005 8.776H6.47zm-.004 7.9l2.233 3.164L6.467 23H2l4.465-6.324zM22 2.582V23h-3.659V7.764L22 2.582zM22 1l-9.952 14.095-2.233-3.163L17.533 1H22z",
    ],
    meta: [
      "M6.897 4c1.915 0 3.516.932 5.43 3.376l.282-.373c.19-.246.383-.484.58-.71l.313-.35C14.588 4.788 15.792 4 17.225 4c1.273 0 2.469.557 3.491 1.516l.218.213c1.73 1.765 2.917 4.71 3.053 8.026l.011.392.002.25c0 1.501-.28 2.759-.818 3.7l-.14.23-.108.153c-.301.42-.664.758-1.086 1.009l-.265.142-.087.04a3.493 3.493 0 01-.302.118 4.117 4.117 0 01-1.33.208c-.524 0-.996-.067-1.438-.215-.614-.204-1.163-.56-1.726-1.116l-.227-.235c-.753-.812-1.534-1.976-2.493-3.586l-1.43-2.41-.544-.895-1.766 3.13-.343.592C7.597 19.156 6.227 20 4.356 20c-1.21 0-2.205-.42-2.936-1.182l-.168-.184c-.484-.573-.837-1.311-1.043-2.189l-.067-.32a8.69 8.69 0 01-.136-1.288L0 14.468c.002-.745.06-1.49.174-2.23l.1-.573c.298-1.53.828-2.958 1.536-4.157l.209-.34c1.177-1.83 2.789-3.053 4.615-3.16L6.897 4zm-.033 2.615l-.201.01c-.83.083-1.606.673-2.252 1.577l-.138.199-.01.018c-.67 1.017-1.185 2.378-1.456 3.845l-.004.022a12.591 12.591 0 00-.207 2.254l.002.188c.004.18.017.36.04.54l.043.291c.092.503.257.908.486 1.208l.117.137c.303.323.698.492 1.17.492 1.1 0 1.796-.676 3.696-3.641l2.175-3.4.454-.701-.139-.198C9.11 7.3 8.084 6.616 6.864 6.616zm10.196-.552l-.176.007c-.635.048-1.223.359-1.82.933l-.196.198c-.439.462-.887 1.064-1.367 1.807l.266.398c.18.274.362.56.55.858l.293.475 1.396 2.335.695 1.114c.583.926 1.03 1.6 1.408 2.082l.213.262c.282.326.529.54.777.673l.102.05c.227.1.457.138.718.138.176.002.35-.023.518-.073.338-.104.61-.32.813-.637l.095-.163.077-.162c.194-.459.29-1.06.29-1.785l-.006-.449c-.08-2.871-.938-5.372-2.2-6.798l-.176-.189c-.67-.683-1.444-1.074-2.27-1.074z",
    ],
    muse: [
      "M5.91 3.869C6.777 3.869 7.396 4.546 7.396 5.607 7.396 6.669 7.225 7.626 6.941 9.659 6.738 11.084 6.389 13.258 6.243 14.162 6.523 13.628 7.178 12.378 7.294 12.144 8.666 9.375 10.096 6.901 10.508 6.246 11.054 5.372 11.535 5.021 12.278 5.021 12.664 5.022 13.124 5.217 13.352 5.477 13.66 5.829 13.725 6.398 13.714 7.019 13.698 7.97 13.574 9.486 13.405 11.177 13.33 11.929 13.185 13.466 13.087 14.496 13.965 12.925 15.591 10.035 16.246 9.025 16.817 8.146 17.392 7.579 18.164 7.579 18.83 7.579 19.651 8.05 19.603 9.302 19.531 11.149 19.264 15.174 19.143 16.979 19.96 15.79 21.033 14.029 21.436 13.367 21.842 12.698 22.26 12.157 22.894 12.139 23.544 12.12 23.979 12.562 23.999 13.244 24.019 13.927 23.612 14.694 23.072 15.565 22.486 16.511 21.831 17.523 21.033 18.468 20.236 19.413 19.502 20.131 18.384 20.131 17.382 20.131 16.677 19.465 16.628 18.246 16.602 17.607 16.723 16.234 16.814 15.16 16.92 13.917 17.048 12.717 17.137 11.923 16.256 13.535 14.402 16.912 13.568 18.23 12.752 19.52 12.355 19.974 11.493 19.975 10.631 19.975 10.253 19.354 10.241 18.42 10.227 17.407 10.988 11.324 11.246 9.297 10.828 10.191 9.801 12.385 9.157 13.69 8.534 14.953 7.489 17.135 6.73 18.393 6.184 19.298 5.57 19.975 4.66 19.975 3.75 19.975 3.236 19.363 3.236 18.379 3.236 17.395 3.521 15.756 3.827 13.723 3.98 12.739 4.155 11.667 4.352 10.53 4.496 9.708 4.746 8.26 4.9 7.371 4.2 8.461 2.941 10.423 2.558 11.014 2.131 11.671 1.749 12.15 1.115 12.15 0.416 12.15 0 11.605 0 10.971 0 10.337 0.322 9.848 0.846 8.988 1.518 7.883 2.726 6.377 3.388 5.586 4.168 4.654 4.947 3.869 5.91 3.869Z",
    ],
    mercury: [
      "M12 2.4 3.2 7.4v9.2L12 21.6l8.8-5V7.4L12 2.4zm0 1.9 7 4v3.1l-7-4-7 4V8.3l7-4zm-7 8.3 6 3.4v3.5l-6-3.4v-3.5zm8 6.9v-3.5l6-3.4v3.5l-6 3.4z",
    ],
    thinkingmachines: [
      "M4 5h5v5H4V5zm11 0h5v5h-5V5zM4 14h5v5H4v-5zm11 0h5v5h-5v-5zM10 10h4v4h-4v-4z",
    ],
    google: [
      "M23 12.245c0-.905-.075-1.565-.236-2.25h-10.54v4.083h6.186c-.124 1.014-.797 2.542-2.294 3.569l-.021.136 3.332 2.53.23.022C21.779 18.417 23 15.593 23 12.245z",
      "M12.225 23c3.03 0 5.574-.978 7.433-2.665l-3.542-2.688c-.948.648-2.22 1.1-3.891 1.1a6.745 6.745 0 01-6.386-4.572l-.132.011-3.465 2.628-.045.124C4.043 20.531 7.835 23 12.225 23z",
      "M5.84 14.175A6.65 6.65 0 015.463 12c0-.758.138-1.491.361-2.175l-.006-.147-3.508-2.67-.115.054A10.831 10.831 0 001 12c0 1.772.436 3.447 1.197 4.938l3.642-2.763z",
      "M12.225 5.253c2.108 0 3.529.892 4.34 1.638l3.167-3.031C17.787 2.088 15.255 1 12.225 1 7.834 1 4.043 3.469 2.197 7.062l3.63 2.763a6.77 6.77 0 016.398-4.572z",
    ],
    poolside: "<g clip-path=\"url(#mi-poolside-lobe-icons-poolside-0-_R_0_)\"><mask height=\"24\" id=\"mi-poolside-lobe-icons-poolside-4-_R_0_\" maskUnits=\"userSpaceOnUse\" style=\"mask-type:alpha\" width=\"24\" x=\"0\" y=\"0\"><path d=\"M24 0H0v24h24V0z\" fill=\"url(#mi-poolside-lobe-icons-poolside-1-_R_0_)\"></path><path d=\"M24 0H0v24h24V0z\" fill=\"url(#mi-poolside-lobe-icons-poolside-2-_R_0_)\"></path><path d=\"M24 0H0v24h24V0z\" fill=\"url(#mi-poolside-lobe-icons-poolside-3-_R_0_)\"></path></mask><g mask=\"url(#mi-poolside-lobe-icons-poolside-4-_R_0_)\"><path d=\"M6.742 22.786a11.93 11.93 0 01-5.232-4.963 11.98 11.98 0 01-1.463-6.886.975.975 0 011.943.173c-.178 2.005.246 4 1.226 5.769a9.968 9.968 0 003.526 3.685l4.586-9.405c-1.795-.598-3.29-.338-3.425-.312l-.058.012a.972.972 0 01-1.054-.576c-.24-.448-.96-1.544-1.834-1.97-.873-.426-2.218-.289-2.651-.195a.977.977 0 01-1.087-1.38C4.117.792 11.315-1.686 17.262 1.215c5.946 2.9 8.422 10.093 5.529 16.038l-.01.02c-2.903 5.94-10.095 8.414-16.039 5.514zm6.338-10.773l-4.586 9.405c4.629 1.73 9.896-.192 12.304-4.558-.338-.524-.932-1.275-1.62-1.61-.888-.434-2.19-.292-2.637-.198a.989.989 0 01-.616-.055.984.984 0 01-.49-.473c-.028-.058-.739-1.438-2.355-2.51zM5.81 6.56c.747.365 1.356.944 1.81 1.49 1.406-2.15 3.314-3.774 4.787-4.82a20.81 20.81 0 011.66-1.067A10.078 10.078 0 003.882 6.077c.617.042 1.297.174 1.929.482zm12.671-2.243c.09.624.152 1.294.182 1.965.083 1.801-.021 4.296-.844 6.722.686.018 1.484.14 2.214.495.652.318 1.198.8 1.628 1.28a10.082 10.082 0 00-3.18-10.462zm-5.394 5.46a9.522 9.522 0 012.984 2.287c1.075-3.493.606-7.402.215-8.85-1.381.584-4.75 2.62-6.84 5.618a9.515 9.515 0 013.64.944z\"></path></g></g><defs><linearGradient gradientUnits=\"userSpaceOnUse\" id=\"mi-poolside-lobe-icons-poolside-1-_R_0_\" x1=\"6.75\" x2=\"5.625\" y1=\"20.55\" y2=\"20.55\"><stop stop-color=\"currentColor\"></stop><stop offset=\"1\" stop-color=\"currentColor\" stop-opacity=\"0\"></stop></linearGradient><linearGradient gradientUnits=\"userSpaceOnUse\" id=\"mi-poolside-lobe-icons-poolside-2-_R_0_\" x1=\"6.825\" x2=\"7.2\" y1=\"11.85\" y2=\"11.137\"><stop stop-color=\"currentColor\" stop-opacity=\"0\"></stop><stop offset=\"1\" stop-color=\"currentColor\"></stop></linearGradient><linearGradient gradientUnits=\"userSpaceOnUse\" id=\"mi-poolside-lobe-icons-poolside-3-_R_0_\" x1=\".975\" x2=\".975\" y1=\"20.512\" y2=\"10.912\"><stop stop-color=\"currentColor\"></stop><stop offset=\".105\" stop-color=\"currentColor\" stop-opacity=\".9\"></stop><stop offset=\".904\" stop-color=\"currentColor\" stop-opacity=\".04\"></stop><stop offset=\"1\" stop-color=\"currentColor\" stop-opacity=\"0\"></stop></linearGradient><clipPath id=\"mi-poolside-lobe-icons-poolside-0-_R_0_\"><path d=\"M0 0h24v24H0z\" fill=\"currentColor\"></path></clipPath></defs>",
    cohere: [
      "M8.128 14.099c.592 0 1.77-.033 3.398-.703 1.897-.781 5.672-2.2 8.395-3.656 1.905-1.018 2.74-2.366 2.74-4.18A4.56 4.56 0 0018.1 1H7.549A6.55 6.55 0 001 7.55c0 3.617 2.745 6.549 7.128 6.549z",
      "M9.912 18.61a4.387 4.387 0 012.705-4.052l3.323-1.38c3.361-1.394 7.06 1.076 7.06 4.715a5.104 5.104 0 01-5.105 5.104l-3.597-.001a4.386 4.386 0 01-4.386-4.387z",
      "M4.776 14.962A3.775 3.775 0 001 18.738v.489a3.776 3.776 0 007.551 0v-.49a3.775 3.775 0 00-3.775-3.775z",
    ],
  }

  const AI_MODEL_VENDORS = [
    { id: 'openai', name: 'OpenAI', color: '#10a37f', re: /(^|\/)(gpt|o[134](?:-|$)|chatgpt|davinci|text-embedding|whisper)/i },
    { id: 'claude', name: 'Claude', color: '#d97757', re: /claude|sonnet|opus|haiku/i },
    { id: 'gemini', name: 'Gemini', color: '#4285f4', re: /gemini|palm|bison/i },
    { id: 'gemma', name: 'Gemma', color: '#4285f4', re: /gemma/i },
    { id: 'deepseek', name: 'DeepSeek', color: '#4d6bfe', re: /deepseek/i },
    { id: 'qwen', name: '通义千问', color: '#615ced', re: /qwen|qwq|tongyi|通义/i },
    { id: 'zhipu', name: '智谱', color: '#3859ff', re: /glm|chatglm|zhipu/i },
    { id: 'kimi', name: 'Kimi', color: '#1f2329', re: /kimi|moonshot/i },
    { id: 'doubao', name: '豆包', color: '#325ab4', re: /doubao|skylark/i },
    { id: 'wenxin', name: '文心', color: '#2932e1', re: /ernie|wenxin|文心/i },
    { id: 'hunyuan', name: '混元', color: '#0052d9', re: /hunyuan|混元/i },
    { id: 'minimax', name: 'MiniMax', color: '#ee2c5b', re: /minimax|abab/i },
    { id: 'stepfun', name: '阶跃星辰', color: '#0a67c8', re: /stepfun|step-[0-9]/i },
    { id: 'baichuan', name: '百川', color: '#1c64f2', re: /baichuan/i },
    { id: 'sensenova', name: 'SenseNova', color: '#1a1a1a', re: /sensenova|sensechat|sensenova-\d|nova-[\w-]*chat/i },
    { id: 'yi', name: '零一万物', color: '#003425', re: /^(yi-|yi\d)|01-ai/i },
    { id: 'grok', name: 'Grok', color: '#111111', re: /grok/i },
    { id: 'xai', name: 'xAI', color: '#111111', re: /^xai-|x-ai/i },
    { id: 'muse', name: 'Muse', color: '#6b4fbb', re: /^muse-(?!glimmer)/i },
    { id: 'llama', name: 'Llama', color: '#0866ff', re: /llama|nemoguard/i },
    { id: 'meta', name: 'Meta', color: '#0064e0', re: /^meta-|muse-glimmer/i },
    { id: 'poolside', name: 'Poolside', color: '#0e7c66', re: /poolside|laguna/i },
    { id: 'google', name: 'Google', color: '#4285f4', re: /google|deplot/i },
    { id: 'mercury', name: 'Mercury', color: '#4a4a8a', re: /mercury-\d/i },
    { id: 'thinkingmachines', name: 'Thinking Machines', color: '#111111', re: /thinkingmachines|inkling/i },
    { id: 'mistral', name: 'Mistral', color: '#fa520f', re: /mistral|mixtral|codestral|pixtral/i },
    { id: 'perplexity', name: 'Perplexity', color: '#20808d', re: /perplexity|sonar/i },
    { id: 'groq', name: 'Groq', color: '#f55036', re: /groq/i },
    { id: 'together', name: 'Together', color: '#0f6fff', re: /together/i },
    { id: 'nvidia', name: 'NVIDIA', color: '#76b900', re: /nvidia|nemotron|riva-|ising-/i },    { id: 'azure', name: 'Azure', color: '#0078d4', re: /azure|azureopenai/i },
    { id: 'bedrock', name: 'Bedrock', color: '#ff9900', re: /bedrock/i },
    { id: 'ai21', name: 'AI21', color: '#e91e63', re: /ai21|jamba/i },
    { id: 'cerebras', name: 'Cerebras', color: '#f15a24', re: /cerebras/i },
    { id: 'deepinfra', name: 'DeepInfra', color: '#0b5fff', re: /deepinfra/i },
    { id: 'fireworks', name: 'Fireworks', color: '#5019c5', re: /fireworks/i },
    { id: 'sambanova', name: 'SambaNova', color: '#ee7624', re: /sambanova/i },
    { id: 'cohere', name: 'Cohere', color: '#39594d', re: /cohere|command-r/i },
    { id: 'bytedance', name: '字节跳动', color: '#325ab4', re: /bytedance/i },
    { id: 'baidu', name: '百度', color: '#2932e1', re: /baidu/i },
  ]

  function aiModelVendor(model, channel) {
    const name = String(model || '')
    const hit = AI_MODEL_VENDORS.find(item => item.re.test(name))
    if (hit) return hit
    const channelText = `${channel?.name || ""} ${channel?.baseURL || ""}`
    const byChannel = AI_MODEL_VENDORS.find(item => item.re.test(channelText))
    if (byChannel) return byChannel
    return { id: 'default', name: '自定义模型', color: 'var(--text-3)' }
  }

  function aiModelIconHtml(model, channel, extraClass = "") {
    const vendor = aiModelVendor(model, channel)
    const label = `${vendor.name} · ${model || ""}`
    const glyphs = AI_MODEL_GLYPHS[vendor.id]
    let glyph
    if (typeof glyphs === "string") {
      // 复杂图标（渐变 / mask）直接存原始标记，id 已在生成时加过前缀
      glyph = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${glyphs}</svg>`
    } else if (Array.isArray(glyphs)) {
      glyph = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${glyphs
        .map(item => {
          const d = typeof item === "string" ? item : item.d
          const opacity = typeof item === "string" ? "" : item.o
          return `<path d="${d}"${opacity ? ` fill-opacity="${opacity}"` : ""}/>`
        })
        .join("")}</svg>`
    } else {
      glyph = `<span class="model-icon-fallback">${esc((vendor.name || "?").slice(0, 1))}</span>`
    }
    return `<span class="model-icon ${extraClass}" style="--model-color:${vendor.color}" title="${esc(label)}" aria-label="${esc(vendor.name)}">${glyph}</span>`
  }

  function renderAiModelSelect(channelId, preferredModel) {
    const pool = state.aiModels;
    const channels = aiSelectableChannels(pool);
    const channel = channels.find(item => item.id === channelId) || null;
    const models = aiChannelModels(channel);
    const current = pool?.current || {};
    let selected = preferredModel && models.includes(preferredModel) ? preferredModel : "";
    if (!selected && channel) {
      if (channel.id === pool.effectiveChannelId && current.model && models.includes(current.model))
        selected = current.model;
      else if (channel.model && models.includes(channel.model)) selected = channel.model;
      else selected = models[0] || "";
    }
    const select = $("#aiModelName");
    select.innerHTML = models.length
      ? models
          .map(model => `<option value="${esc(model)}" ${model === selected ? "selected" : ""}>${esc(aiModelVendor(model, channel).name)} · ${esc(model)}</option>`)
          .join("")
      : '<option value="">该渠道未配置模型</option>';
    select.disabled = !models.length || !state.allowWrite;
    // 下拉本身放不下图标，用选中态旁的徽标补上
    const badge = $("#aiModelBadge");
    if (badge) {
      badge.innerHTML = models.length && selected ? aiModelIconHtml(selected, channel) : "";
      badge.hidden = !models.length || !selected;
    }
    $("#aiModelApply").disabled = aiModelApplying || !state.allowWrite || !channel || !models.length;
  }

  function renderAIModels() {
    const data = state.aiModels;
    if (!data) return;
    const channels = aiSelectableChannels(data);
    const current = data.current || {};
    const activeId = data.activeChannelId || "";
    const effectiveId = data.effectiveChannelId || "";
    const effectiveChannel = channels.find(item => item.id === effectiveId) || null;

    $("#aiCurrentModel").textContent = current.model || "未选择模型";
    $("#aiCurrentModel").title = current.model || "";
    const meta = [
      `<span class="pill ${activeId ? "pill-blue" : "pill-outline"}">${activeId ? "指定渠道" : "按优先级自动"}</span>`,
    ];
    if (effectiveChannel) meta.push(`<span class="chip">${esc(effectiveChannel.name)}</span>`);
    if (current.adapterType) meta.push(`<span class="chip">${esc(aiAdapterLabel(current))}</span>`);
    if (current.preset) meta.push(`<span class="chip">预设 ${esc(current.preset.name)}</span>`);
    if (current.presetModel) meta.push('<span class="pill pill-amber">预设固定模型</span>');
    $("#aiCurrentMeta").innerHTML = meta.join("");
    $("#aiCurrentEndpoint").textContent = current.baseURL || "—";
    $("#aiCurrentEndpoint").title = current.baseURL || "";

    const preferredId = channels.some(item => item.id === (activeId || effectiveId))
      ? activeId || effectiveId
      : channels[0]?.id || "";
    const channelSelect = $("#aiModelChannel");
    channelSelect.innerHTML = channels.length
      ? channels
          .map(
            item =>
              `<option value="${esc(item.id)}" ${item.id === preferredId ? "selected" : ""}>${esc(item.name)}${item.enabled ? "" : "（已停用）"}</option>`,
          )
          .join("")
      : '<option value="">暂无可用渠道</option>';
    channelSelect.disabled = !channels.length || !state.allowWrite;
    renderAiModelSelect(preferredId, "");

    const notes = [];
    if (!channels.length) {
      notes.push("还没有启用的渠道，请先到「渠道管理」添加渠道并获取模型。");
    } else {
      if (!activeId) notes.push("当前按优先级自动选择渠道，应用后会将该渠道设为指定渠道。");
      if (current.presetModel)
        notes.push(`预设「${current.preset?.name || ""}」固定使用 ${current.presetModel}，会覆盖这里的模型选择。`);
    }
    const note = $("#aiModelNote");
    note.hidden = !notes.length;
    note.className = `ai-model-note${current.presetModel ? " warning" : ""}`;
    note.innerHTML = notes
      .map(text => `<div class="ai-model-note-row">${icon("info")}<span>${esc(text)}</span></div>`)
      .join("");

    const enabledChannels = channels.filter(item => item.enabled && aiChannelModels(item).length);
    $("#aiPoolCount").textContent = `${fmtNum((data.pool || []).length)} 个模型`;
    $("#aiModelPool").innerHTML = enabledChannels.length
      ? enabledChannels
          .map(
            channel => `<div class="ai-pool-group">
              <span class="ai-pool-channel">${aiModelIconHtml(aiChannelModels(channel)[0] || "", channel)}${esc(channel.name)}</span>
              <div class="chips">${aiChannelModels(channel)
                .map(model => {
                  const active = channel.id === effectiveId && model === current.model;
                  return `<button type="button" class="chip ai-pool-chip ${active ? "active" : ""}" data-ai-pool-channel="${esc(channel.id)}" data-ai-pool-model="${esc(model)}" ${state.allowWrite ? "" : "disabled"}>${aiModelIconHtml(model, channel)}${esc(model)}</button>`;
                })
                .join("")}</div>
            </div>`,
          )
          .join("")
      : `<div class="channel-empty">${icon("database")}<strong>模型池为空</strong><span>在渠道管理中添加或获取模型后，这里会列出所有可用模型。</span></div>`;
  }

  async function applyAiModelSelection(channelId, model) {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    if (aiModelApplying) return;
    const channel = (state.aiModels?.channels || []).find(item => item.id === channelId);
    if (!channel) return toast("请选择渠道", "info");
    if (!model) return toast("该渠道还没有可用模型", "info");
    aiModelApplying = true;
    const button = $("#aiModelApply");
    setBusy(button, true);
    try {
      const result = await api("/ai/models/apply", { method: "POST", body: { channelId: channel.id, model } });
      toast(result.message || `已切换到 ${model}`);
      state.ai = null;
      state.aiSections.channels = null;
      invalidateOverview();
      await loadAI(true);
    } catch (error) {
      handleError(error);
    } finally {
      aiModelApplying = false;
      setBusy(button, false);
      renderAiModelSelect($("#aiModelChannel").value, $("#aiModelName").value);
    }
  }

  function initAIModelPicker() {
    $("#aiModelChannel").addEventListener("change", event => {
      renderAiModelSelect(event.target.value, "");
    });
    $("#aiModelApply").addEventListener("click", () => {
      applyAiModelSelection($("#aiModelChannel").value, $("#aiModelName").value);
    });
    $("#aiModelPool").addEventListener("click", event => {
      const chip = event.target.closest("[data-ai-pool-channel]");
      if (chip) applyAiModelSelection(chip.dataset.aiPoolChannel, chip.dataset.aiPoolModel);
    });
  }

  // 会话 ID 形如 group:群号:bot:账号 / private:QQ号 / backend:xxx，列表里显示成人能读的短标签
  function sessionLabel(id) {
    const raw = String(id || "");
    const groupMatch = raw.match(/^group:(\d+)(?::bot:(\d+))?/)
    if (groupMatch) return groupMatch[2] ? `群 ${groupMatch[1]} · ${groupMatch[2]}` : `群 ${groupMatch[1]}`
    const privateMatch = raw.match(/^private:(\d+)(?::bot:(\d+))?/)
    if (privateMatch) return privateMatch[2] ? `私聊 ${privateMatch[1]} · ${privateMatch[2]}` : `私聊 ${privateMatch[1]}`
    return raw.length > 34 ? `${raw.slice(0, 34)}…` : raw
  }

  function renderAiSessionRows(sessions) {
    const pillEl = $("#sessionCountPill");
    pillEl.textContent = `${fmtNum(sessions.length)} 个会话`;

    if (!sessions.length) {
      $("#sessionRows").innerHTML = tableEmpty(6, "当前没有活跃会话");
      return;
    }

    $("#sessionRows").innerHTML = sessions
      .map(session => {
        const id = session.id || "";
        const label = sessionLabel(id);
        const compressed = session.compressed
          ? pill(`已压缩${session.compressedTurnCount ? ` · ${session.compressedTurnCount} 轮` : ""}`, "pill-green")
          : pill("正常", "pill-outline");
        return `<tr>
          <td><span class="mono" title="${esc(id)}">${esc(label)}</span></td>
          <td class="cell-num">${fmtNum(session.messageCount)}</td>
          <td class="cell-num">${fmtNum(session.turnCount)}</td>
          <td class="cell-num" title="${fmtNum(session.tokenCount)}">${fmtToken(session.tokenCount)}</td>
          <td>${compressed}</td>
          <td title="${esc(fmtDateTime(session.lastActivity))}">${esc(fmtRelative(session.lastActivity))}</td>
        </tr>`;
      })
      .join("");
  }

  function renderTools() {
    const data = state.ai;
    if (!data) return;
    const stats = data.toolStats || {};
    const tools = data.tools || [];

    $("#toolStats").innerHTML = [
      miniStat("工具总数", fmtNum(stats.totalTools), "tool", 1),
      miniStat("插件来源", fmtNum(stats.plugins), "puzzle", 2),
      miniStat("已跳过", fmtNum(stats.skipped), "info", 3),
      miniStat("重名冲突", fmtNum(stats.collisions), "alert", 4),
    ].join("");

    const permissions = Array.from(new Set(tools.map(tool => permissionKey(tool.permission))));
    if (state.toolPerm && !permissions.includes(state.toolPerm)) state.toolPerm = "";
    const order = ["all", "everyone", "master", "admin", "owner"];
    permissions.sort((a, b) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.localeCompare(b);
    });
    $("#toolPermFilter").innerHTML = [
      `<button type="button" data-perm="" class="${state.toolPerm === "" ? "active" : ""}">全部</button>`,
      ...permissions.map(permission => {
        const key = String(permission);
        return `<button type="button" data-perm="${esc(key)}" class="${state.toolPerm === key ? "active" : ""}">${esc(permissionLabel(key))}</button>`;
      }),
    ].join("");

    const query = state.toolQuery.trim().toLowerCase();
    const filtered = tools.filter(tool => {
      if (state.toolPerm && permissionKey(tool.permission) !== state.toolPerm) return false;
      if (!query) return true;
      return `${tool.name || ""} ${tool.plugin || ""} ${tool.description || ""}`.toLowerCase().includes(query);
    });

    $("#toolCountText").textContent = query || state.toolPerm
      ? `显示 ${fmtNum(filtered.length)} / ${fmtNum(tools.length)} 个工具`
      : `共 ${fmtNum(tools.length)} 个工具 · 来自 ${fmtNum(stats.plugins)} 个来源`;

    if (!filtered.length) {
      $("#toolRows").innerHTML = tableEmpty(7, tools.length ? "没有匹配的工具" : "尚未注册 AI 工具");
      return;
    }

    $("#toolRows").innerHTML =
      filtered
        .slice(0, state.toolLimit)
        .map(
          tool => `<tr>
          <td><span class="mono" style="font-weight:600">${esc(tool.name)}</span></td>
          <td><div class="cell-desc" title="${esc(tool.description || "")}">${esc(tool.description || "—")}</div></td>
          <td>${esc(tool.plugin || "—")}</td>
          <td>${permissionPill(tool.permission)}</td>
          <td>${dangerPill(tool.danger)}</td>
          <td>${tool.needsGroup ? pill("需要群聊", "pill-blue") : pill("任意", "")}</td>
          <td><span class="mono">${esc(tool.event || "—")}</span></td>
        </tr>`,
        )
        .join("") + moreRow(7, "tool", filtered.length, state.toolLimit);
  }

  function moreRow(colspan, type, total, limit) {
    if (total <= limit) return "";
    return `<tr class="table-more"><td colspan="${colspan}">
      <div class="table-more-inner">
        <span>已显示 ${fmtNum(limit)} / ${fmtNum(total)} 条</span>
        <button type="button" class="btn btn-outline btn-sm" data-more="${type}">加载更多</button>
      </div>
    </td></tr>`;
  }

  /* ---------------- 知识库 ---------------- */

  async function loadKnowledge(options) {
    const opts = options || {};
    if (opts.page !== undefined) state.kb.page = opts.page;
    if (opts.resetPage) state.kb.page = 1;
    if (opts.query !== undefined) state.kb.query = opts.query;
    if (opts.scope !== undefined) state.kb.scope = opts.scope;
    if (opts.tag !== undefined) state.kb.tag = opts.tag;

    const params = new URLSearchParams();
    params.set("page", String(state.kb.page));
    params.set("pageSize", String(state.kb.pageSize));
    if (state.kb.query) params.set("query", state.kb.query);
    if (state.kb.scope) params.set("scope", state.kb.scope);
    if (state.kb.tag) params.set("tag", state.kb.tag);

    const data = await api(`/knowledge?${params.toString()}`);
    state.kbData = data;

    const totalPages = Math.max(1, Math.ceil((data.total || 0) / (data.pageSize || state.kb.pageSize)));
    if ((data.total || 0) > 0 && data.page > totalPages) {
      state.kb.page = totalPages;
      return loadKnowledge();
    }

    renderKbStats(data.stats || {});
    renderKbFilters(data);
    renderKbList(data);
    renderKbPager(data);
    mountAiSharedParams("knowledge").catch(handleError);
    return data;
  }

  function renderKbStats(stats) {
    $("#kbStats").innerHTML = [
      miniStat("总条目", fmtNum(stats.total), "book", 1),
      miniStat("固定知识", fmtNum(stats.pinned), "pin", 2),
      miniStat("作用域", fmtNum(Object.keys(stats.scopes || {}).length), "database", 3),
      miniStat("最后更新", stats.lastUpdated ? fmtRelative(stats.lastUpdated) : "—", "clock", 4),
    ].join("");
  }

  function renderKbFilters(data) {
    const statsScopes = (data.stats && data.stats.scopes) || {};
    const scopes = Object.keys(statsScopes);
    const rank = scope => (scope === "master" ? 0 : scope === "public" ? 1 : scope.startsWith("group:") ? 2 : 3);
    scopes.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

    const select = $("#kbScope");
    const current = state.kb.scope;
    const options = [`<option value="">全部作用域</option>`];
    scopes.forEach(scope => {
      options.push(`<option value="${esc(scope)}">${esc(scopeLabel(scope))}（${fmtNum(statsScopes[scope])}）</option>`);
    });
    if (current && !scopes.includes(current)) {
      options.push(`<option value="${esc(current)}">${esc(scopeLabel(current))}</option>`);
    }
    select.innerHTML = options.join("");
    select.value = current || "";

    const search = $("#kbSearch");
    if (document.activeElement !== search && search.value !== state.kb.query) search.value = state.kb.query;

    const tagWrap = $("#kbTagChips");
    const tags = (data.tags || []).slice(0, 12);
    if (!tags.length && !state.kb.tag) {
      tagWrap.hidden = true;
      tagWrap.innerHTML = "";
      return;
    }
    const chips = tags.map(item => {
      const active = state.kb.tag === item.tag;
      return `<button type="button" class="chip ${active ? "active" : ""}" data-tag="${esc(item.tag)}">#${esc(item.tag)}<span class="count">${fmtNum(item.count)}</span></button>`;
    });
    if (state.kb.tag && !tags.some(item => item.tag === state.kb.tag)) {
      chips.push(`<button type="button" class="chip active" data-tag="${esc(state.kb.tag)}">#${esc(state.kb.tag)}</button>`);
    }
    tagWrap.hidden = false;
    tagWrap.innerHTML = `<span class="filter-label">标签</span>${chips.join("")}`;
  }

  function renderKbList(data) {
    const results = data.results || [];
    $("#kbCount").textContent = `${fmtNum(data.total)} 条知识${state.kb.query ? ` · 搜索「${state.kb.query}」` : ""}`;

    if (!results.length) {
      const filtered = !!(state.kb.query || state.kb.scope || state.kb.tag);
      $("#kbList").innerHTML = filtered
        ? emptyState("没有匹配的知识", "换一个关键词，或清除作用域与标签筛选。", "search", true)
        : emptyState("还没有知识条目", "点击右上角「添加知识」，或在对话中使用 kb_add 写入。", "book", true);
      return;
    }

    const canWrite = state.allowWrite;
    $("#kbList").innerHTML = results
      .map(entry => {
        const tags = (entry.tags || []).map(tag => `<span class="kb-tag">#${esc(tag)}</span>`).join("");
        const pinControl = canWrite
          ? `<button type="button" class="kb-pin ${entry.pinned ? "pinned" : ""}" data-kb-action="pin" title="${entry.pinned ? "取消固定" : "固定知识"}">${icon("pin")}</button>`
          : entry.pinned
            ? `<span class="kb-pin pinned" title="固定知识">${icon("pin")}</span>`
            : "";
        const actions = canWrite
          ? `<button type="button" class="icon-btn" data-kb-action="edit" title="编辑">${icon("edit")}</button>
             <button type="button" class="icon-btn danger" data-kb-action="delete" title="删除">${icon("trash")}</button>`
          : `<button type="button" class="icon-btn" data-kb-action="view" title="查看">${icon("file")}</button>`;
        return `<article class="kb-item" data-id="${esc(entry.id)}">
          <div class="kb-main">
            <div class="kb-title-row">
              ${pinControl}
              <h4>${esc(entry.title)}</h4>
              <span class="pill ${scopeVariant(entry.scope)}">${esc(scopeLabel(entry.scope))}</span>
              <span class="kb-tags">${tags}</span>
            </div>
            <p class="kb-excerpt">${esc(entry.content || "")}</p>
            <div class="kb-meta">
              <span title="${esc(fmtDateTime(entry.updatedAt))}">更新于 ${esc(fmtRelative(entry.updatedAt))}</span>
              <span>访问 ${fmtNum(entry.accessCount)} 次</span>
              <span>修订 ${fmtNum(entry.revision || 1)}</span>
              <span>来源 ${esc(sourceLabel(entry.source))}</span>
            </div>
          </div>
          <div class="kb-actions">${actions}</div>
        </article>`;
      })
      .join("");
  }

  function renderKbPager(data) {
    const pager = $("#kbPager");
    const total = Number(data.total) || 0;
    if (!total) {
      pager.innerHTML = `<span>暂无记录</span>`;
      return;
    }
    const pageSize = Number(data.pageSize) || state.kb.pageSize;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    pager.innerHTML = `<span>共 ${fmtNum(total)} 条知识 · 第 ${fmtNum(data.page)} / ${fmtNum(totalPages)} 页</span>
      <div class="pager-btns">
        <button type="button" class="btn btn-outline btn-sm" data-page-step="-1" ${data.page <= 1 ? "disabled" : ""}>上一页</button>
        <button type="button" class="btn btn-outline btn-sm" data-page-step="1" ${data.page >= totalPages ? "disabled" : ""}>下一页</button>
      </div>`;
  }

  async function openKbModal(entry) {
    if (!state.started) return;
    const readOnly = !state.allowWrite;
    let full = entry || null;

    if (entry) {
      try {
        const data = await api(`/knowledge/${encodeURIComponent(entry.id)}`);
        full = data.entry || entry;
      } catch (error) {
        handleError(error);
        return;
      }
    }

    let scope = full && full.scope ? full.scope : state.kb.scope || "master";
    if (!/^(master|public|group:\d+|user:\d+)$/.test(scope)) scope = "master";
    const scopeType = scope.startsWith("group:") ? "group" : scope.startsWith("user:") ? "user" : scope;
    const scopeId = scope.includes(":") ? scope.split(":")[1] : "";
    const disabled = readOnly ? "disabled" : "";
    const scopeOptions = [
      ["master", "主人（所有对话）"],
      ["public", "公开（所有人）"],
      ["group", "指定群聊"],
      ["user", "指定用户"],
    ]
      .map(([value, label]) => `<option value="${value}" ${scopeType === value ? "selected" : ""}>${label}</option>`)
      .join("");

    const body = `
      <div class="modal-tabs">
        <div class="segmented">
          <button type="button" class="active" data-tab="basic">基础信息</button>
          <button type="button" data-tab="advanced">高级设置</button>
        </div>
      </div>
      <div class="modal-body">
        <div class="form-error" data-form-error></div>
        <div class="modal-pane active" data-pane="basic">
          <label class="field">
            <span>标题</span>
            <input data-field="title" maxlength="120" placeholder="一句话概括这条知识" value="${esc(full ? full.title : "")}" ${disabled} />
            <span class="hint">标题相同或内容高度相似时，会与已有知识自动合并。</span>
          </label>
          <label class="field">
            <span>内容</span>
            <textarea data-field="content" placeholder="写下需要长期记住的事实、偏好或规则…" ${disabled}>${esc(full ? full.contentFull || full.content || "" : "")}</textarea>
            <span class="hint" data-counter></span>
          </label>
          <label class="field">
            <span>标签</span>
            <input data-field="tags" placeholder="用逗号分隔，例如：群设置, 偏好" value="${esc(full ? (full.tags || []).join(", ") : "")}" ${disabled} />
            <span class="hint">最多 10 个标签，用于检索与筛选。</span>
          </label>
        </div>
        <div class="modal-pane" data-pane="advanced">
          <div class="field-row">
            <label class="field">
              <span>作用域</span>
              <select data-field="scopeType" ${disabled}>${scopeOptions}</select>
              <span class="hint">scope 决定哪些会话可以检索到这条知识。</span>
            </label>
            <label class="field" data-scope-wrap>
              <span>群号 / QQ 号</span>
              <input data-field="scopeId" inputmode="numeric" placeholder="例如 123456789" value="${esc(scopeId)}" ${disabled} />
            </label>
          </div>
          <div class="switch-row">
            <div>
              <strong>固定知识</strong>
              <small>固定知识不会因容量清理被归档，并在检索排序中优先。</small>
            </div>
            <label class="switch">
              <input type="checkbox" data-field="pinned" ${full && full.pinned ? "checked" : ""} ${disabled} />
              <span class="track"></span>
            </label>
          </div>
          ${
            entry
              ? `<div class="mini-label">记录信息</div>
                 <div class="kv-list">
                   ${kvRow("来源", esc(sourceLabel(full.source)))}
                   ${kvRow("创建时间", `<span class="mono">${esc(fmtDateTime(full.createdAt))}</span>`)}
                   ${kvRow("更新时间", `<span class="mono">${esc(fmtDateTime(full.updatedAt))}</span>`)}
                   ${kvRow("修订 / 访问", `${fmtNum(full.revision || 1)} / ${fmtNum(full.accessCount || 0)}`)}
                   ${kvRow("条目 ID", `<span class="mono">${esc(full.id)}</span>`)}
                 </div>`
              : `<div class="mini-label">提示</div>
                 <p class="confirm-text" style="margin-top:6px">写入后，AI 会在相应作用域的对话中检索到这条知识；敏感信息请谨慎保存。</p>`
          }
        </div>
      </div>`;

    const footer = readOnly
      ? `<button class="btn btn-outline" data-close>关闭</button>`
      : `<button class="btn btn-outline" data-close>取消</button>
         <button class="btn btn-primary" data-save>${entry ? "保存修改" : "添加知识"}</button>`;

    const modal = openModal({
      title: readOnly ? "查看知识条目" : entry ? "编辑知识条目" : "添加知识",
      subtitle: readOnly
        ? "只读模式：可在 config/config/webui.yaml 中开启 allowWrite"
        : entry
          ? `修订 ${fmtNum(full.revision || 1)} · 更新于 ${fmtRelative(full.updatedAt)}`
          : "写入一条可被 AI 检索与复用的知识。",
      body,
      footer,
      width: "wide",
    });

    const root = modal.root;
    const scopeSelect = $('[data-field="scopeType"]', root);
    const scopeWrap = $("[data-scope-wrap]", root);
    const contentEl = $('[data-field="content"]', root);
    const counter = $("[data-counter]", root);
    const formError = $("[data-form-error]", root);

    const syncScope = () => {
      const type = scopeSelect.value;
      scopeWrap.hidden = type !== "group" && type !== "user";
    };
    const syncCounter = () => {
      counter.textContent = `已输入 ${fmtNum(contentEl.value.length)} 字`;
    };

    scopeSelect.addEventListener("change", syncScope);
    contentEl.addEventListener("input", syncCounter);
    syncScope();
    syncCounter();

    $$("[data-tab]", root).forEach(button => {
      button.addEventListener("click", () => {
        $$("[data-tab]", root).forEach(item => item.classList.toggle("active", item === button));
        $$("[data-pane]", root).forEach(pane => pane.classList.toggle("active", pane.dataset.pane === button.dataset.tab));
      });
    });

    if (readOnly) return;

    const showFormError = message => {
      formError.textContent = message;
      formError.classList.add("show");
    };

    const saveButton = $("[data-save]", root);
    saveButton.addEventListener("click", async () => {
      formError.classList.remove("show");
      const title = $('[data-field="title"]', root).value.trim();
      const content = contentEl.value.trim();
      const tags = $('[data-field="tags"]', root)
        .value.split(/[,，]/)
        .map(tag => tag.trim())
        .filter(Boolean);
      const type = scopeSelect.value;
      const scopeIdValue = $('[data-field="scopeId"]', root).value.trim();
      const pinned = $('[data-field="pinned"]', root).checked;
      let nextScope = type;

      if (!title) return showFormError("标题不能为空");
      if (!content) return showFormError("内容不能为空");
      if (type === "group" || type === "user") {
        if (!/^\d+$/.test(scopeIdValue)) return showFormError(type === "group" ? "请填写有效的群号" : "请填写有效的 QQ 号");
        nextScope = `${type}:${scopeIdValue}`;
      }

      setBusy(saveButton, true);
      try {
        if (entry) {
          const result = await api(`/knowledge/${encodeURIComponent(entry.id)}`, {
            method: "PATCH",
            body: { title, content, tags, scope: nextScope, pinned },
          });
          toast(result.message || "知识已更新");
        } else {
          const result = await api("/knowledge", {
            method: "POST",
            body: { title, content, tags, scope: nextScope, pinned },
          });
          toast(result.message || "知识已添加");
        }
        modal.close();
        await refreshAfterKbChange();
      } catch (error) {
        showFormError(error.message || "保存失败");
      } finally {
        setBusy(saveButton, false);
      }
    });
  }

  async function refreshAfterKbChange() {
    invalidateOverview();
    if (state.page === "knowledge") await loadKnowledge();
    else if (state.page === "dashboard") await loadOverview(true);
  }

  async function toggleKbPin(entry) {
    try {
      await api(`/knowledge/${encodeURIComponent(entry.id)}`, { method: "PATCH", body: { pinned: !entry.pinned } });
      toast(entry.pinned ? "已取消固定" : "已固定知识");
      await refreshAfterKbChange();
    } catch (error) {
      handleError(error);
    }
  }

  async function deleteKbEntry(entry) {
    const archived = !!(state.kbData && state.kbData.stats && state.kbData.stats.archivePath);
    const confirmed = await confirmDialog({
      title: "删除知识条目",
      message: archived
        ? `确定删除「${entry.title}」吗？条目会移出知识库，并归档到归档文件中，可由管理员恢复。`
        : `确定删除「${entry.title}」吗？当前未启用归档，此操作无法撤销。`,
      confirmText: "删除",
      danger: true,
    });
    if (!confirmed) return;

    try {
      const result = await api(`/knowledge/${encodeURIComponent(entry.id)}`, { method: "DELETE" });
      toast(result.message || "已删除");
      await refreshAfterKbChange();
    } catch (error) {
      handleError(error);
    }
  }

  async function exportKnowledge() {
    try {
      const response = await fetch(apiUrl("/knowledge/export"), {
        headers: state.token ? { "X-WebUI-Token": state.token } : {},
      });
      if (!response.ok) {
        let message = `导出失败（HTTP ${response.status}）`;
        try {
          const data = await response.json();
          if (data.message) message = data.message;
        } catch {}
        throw new Error(message);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ai_knowledge_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("已开始下载知识库 JSON 备份", "info");
    } catch (error) {
      handleError(error);
    }
  }

  /* ---------------- 插件 ---------------- */

  const PLUGIN_INDEX_SOURCES = [
    { id: "gitee", label: "Gitee", repo: "https://gitee.com/yhArcadia/Yunzai-Bot-plugins-index" },
    { id: "github", label: "GitHub", repo: "https://github.com/yhArcadia/Yunzai-Bot-plugins-index" },
  ];

  const JS_INDEX_SOURCES = [
    { id: "gitee", label: "Gitee", repo: "https://gitee.com/yhArcadia/Yunzai-Bot-plugins-index/blob/main/JS-Plugin.md" },
    { id: "github", label: "GitHub", repo: "https://github.com/yhArcadia/Yunzai-Bot-plugins-index/blob/main/JS-Plugin.md" },
  ];

  function safeHttpUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
    } catch {
      return "";
    }
  }

  function pluginByName(name) {
    const data = state.pluginManager.data;
    return (
      (data?.plugins || []).find(item => item.name === name) ||
      (data?.singleFiles || []).find(item => item.name === name) ||
      null
    );
  }

  async function loadPlugins(force) {
    if (!force && state.pluginManager.data) {
      renderPlugins();
      return state.pluginManager.data;
    }
    const data = await api(`/plugin-manager${force ? "?refresh=1" : ""}`);
    state.pluginManager.data = data;
    renderPlugins();
    return data;
  }

  function pluginSourcesHtml(label, sources, fallback) {
    const list = sources?.length ? sources : fallback;
    return (
      `<span class="plugin-sources-label">${esc(label)}</span>` +
      list
        .map(source => {
          const repo = safeHttpUrl(source.repo);
          const ok = source.ok !== false;
          const count = Number(source.count) || 0;
          const text = `${fmtNum(count)} 个`;
          const title = source.error || repo || source.label || source.id;
          const inner = `<span class="status-dot ${ok ? "online" : "offline"}"></span><span>${esc(
            source.label || source.id,
          )}</span><b>${esc(ok || count ? text : "不可用")}</b>`;
          return repo
            ? `<a class="plugin-source" href="${esc(repo)}" target="_blank" rel="noopener" title="${esc(title)}">${inner}</a>`
            : `<span class="plugin-source" title="${esc(title)}">${inner}</span>`;
        })
        .join("")
    );
  }

  function renderPluginSources(data) {
    const root = $("#pluginSources");
    if (!root) return;
    root.innerHTML = pluginSourcesHtml("插件库", data?.sources, PLUGIN_INDEX_SOURCES);
  }

  function pluginStatusHtml(plugin) {
    if (!plugin.installed) return pill("未安装", "pill-outline");
    const parts = [plugin.loaded ? pill("已加载", "pill-green", true) : pill("已安装", "pill-blue")];
    if (plugin.protected) parts.push(pill("内置", "pill-amber"));
    return parts.join(" ");
  }

  function pluginAuthorHtml(plugin) {
    const links = (plugin.authorLinks || [])
      .map(item => ({ name: item.name, url: safeHttpUrl(item.url) }))
      .filter(item => item.name && item.url);
    if (links.length) {
      return links
        .map(item => `<a class="plugin-link" href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.name)}</a>`)
        .join("、");
    }
    return plugin.author ? esc(plugin.author) : '<span class="muted">—</span>';
  }

  function pluginTitleHtml(plugin) {
    const tags = [];
    if (plugin.categoryLabel && plugin.category !== "local")
      tags.push(pill(plugin.categoryLabel, plugin.category === "recommended" ? "pill-amber" : "pill-outline"));
    if (plugin.hasGuoba) tags.push(pill("Guoba", "pill-pink"));
    if (plugin.configs) tags.push(pill(`${fmtNum(plugin.configs)} 项配置`, "pill-outline"));
    return `<div class="cell-main"><strong>${esc(plugin.title || plugin.name)}</strong>${
      tags.length ? `<div class="plugin-tags">${tags.join("")}</div>` : ""
    }</div>`;
  }

  function pluginActionsHtml(plugin) {
    if (!plugin.installed) {
      const disabled = !state.allowWrite || state.pluginManager.busy ? "disabled" : "";
      return `<button type="button" class="btn btn-primary btn-sm" data-plugin-install="${esc(plugin.name)}" ${disabled} title="${
        state.allowWrite ? "安装到 plugins 目录" : "WebUI 当前为只读模式"
      }">${icon("download")}安装</button>`;
    }
    const buttons = [];
    if (plugin.configs) {
      buttons.push(
        `<button type="button" class="btn btn-outline btn-sm" data-plugin-config="${esc(
          plugin.name,
        )}">${icon("sliders")}配置</button>`,
      );
    }
    if (plugin.canUpdate) {
      buttons.push(
        `<button type="button" class="btn btn-ghost btn-sm" data-plugin-update="${esc(plugin.name)}" ${busyOrReadonly()}>${icon(
          "refresh",
        )}更新</button>`,
      );
    }
    if (plugin.canUninstall) {
      buttons.push(
        `<button type="button" class="btn btn-danger btn-sm" data-plugin-uninstall="${esc(plugin.name)}" ${busyOrReadonly()}>${icon(
          "trash",
        )}卸载</button>`,
      );
    }
    if (!buttons.length) return '<span class="muted">内置插件</span>';
    return buttons.join("");
  }

  function busyOrReadonly() {
    return state.allowWrite && !state.pluginManager.busy ? "" : "disabled";
  }

  function pluginMatches(plugin, query) {
    if (!query) return true;
    return [
      plugin.title,
      plugin.name,
      plugin.author,
      ...(plugin.authors || []),
      plugin.description,
      plugin.categoryLabel,
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  }

  function renderSinglePlugins(data) {
    const installed = data?.singleFiles || [];
    const index = data?.singleIndex || {};
    const tab = state.pluginManager.singleTab || "installed";
    const query = (state.pluginManager.singleQuery || "").trim().toLowerCase();
    const sources = $("#singlePluginSources");
    if (sources) sources.innerHTML = pluginSourcesHtml("example", index.sources, JS_INDEX_SOURCES);
    const meta = $("#singlePluginMeta");
    $$("#singlePluginTabs [data-single-tab]").forEach(button => {
      const isInstalled = button.dataset.singleTab === "installed";
      button.classList.toggle("active", button.dataset.singleTab === tab);
      button.innerHTML = `${isInstalled ? "已安装" : "未安装"}<span>${fmtNum(
        isInstalled ? installed.length : (index.entries || []).filter(item => !item.installed).length,
      )}</span>`;
    });
    if (meta) {
      const parts = [`<span>共 ${fmtNum((index.entries || []).length)} 个插件</span>`];
      if (index.updatedAt) parts.push(`<span>索引更新于 ${esc(fmtDateTime(index.updatedAt))}</span>`);
      else parts.push('<span class="muted">索引尚未同步</span>');
      if (index.stale) parts.push(pill("索引不可用，展示旧缓存", "pill-amber"));
      else if (index.fromCache) parts.push(pill("缓存", "pill-outline"));
      else if (index.updatedAt) parts.push(pill("刚刚同步", "pill-green"));
      meta.innerHTML = parts.join("");
    }

    const body = $("#singlePluginRows");
    if (!body) return;
    const match = item =>
      !query ||
      [item.title, item.file, item.name, item.description, ...(item.authors || [])]
        .join(" ")
        .toLowerCase()
        .includes(query);

    if (tab === "available") {
      const rows = (index.entries || []).filter(item => !item.installed).filter(match);
      if (!rows.length) {
        body.innerHTML = tableEmpty(6, query ? "没有匹配的插件" : "插件库暂无可安装的单 js 插件");
        return;
      }
      body.innerHTML = rows
        .slice(0, 120)
        .map(item => {
          const link = safeHttpUrl(item.link || item.downloadUrls?.[0] || "");
          return `<tr>
            <td><div class="cell-main"><strong>${esc(item.title)}</strong></div></td>
            <td><span class="mono">${esc(item.file)}</span></td>
            <td>${esc((item.authors || []).join("、") || "—")}</td>
            <td><div class="cell-desc" title="${esc(item.description || "")}">${esc(item.description || "暂无说明")}</div></td>
            <td>${link ? `<a class="plugin-link" href="${esc(link)}" target="_blank" rel="noopener">来源</a>` : pill("可安装", "pill-blue")}</td>
            <td class="cell-actions"><button type="button" class="btn btn-primary btn-sm" data-single-install="${esc(
              item.file,
            )}" ${busyOrReadonly()}>${icon("download")}安装</button></td>
          </tr>`;
        })
        .join("");
      return;
    }

    const rows = installed.filter(match);
    if (!rows.length) {
      body.innerHTML = tableEmpty(6, query ? "没有匹配的插件" : "example 目录内暂无 js 文件");
      return;
    }
    body.innerHTML = rows
      .map(plugin => {
        const enabled = plugin.enabled !== false;
        const status = [
          enabled
            ? pill(plugin.loaded ? "已加载" : "已启用", plugin.loaded ? "pill-green" : "pill-blue", plugin.loaded)
            : pill("已停用", "pill-outline"),
          plugin.protected ? pill("内置", "pill-amber") : "",
        ]
          .filter(Boolean)
          .join(" ");
        const buttons = [
          plugin.canEdit
            ? `<button type="button" class="btn btn-outline btn-sm" data-single-edit="${esc(plugin.name)}" ${busyOrReadonly()}>${icon(
                "edit",
              )}编辑</button>`
            : "",
          `<button type="button" class="btn btn-ghost btn-sm" data-plugin-toggle="${esc(plugin.name)}" data-plugin-enabled="${
            enabled ? "0" : "1"
          }" ${busyOrReadonly()}>${enabled ? `${icon("close")}停用` : `${icon("check")}启用`}</button>`,
          `<button type="button" class="btn btn-danger btn-sm" data-plugin-remove-file="${esc(
            plugin.name,
          )}" ${busyOrReadonly()}>${icon("trash")}删除</button>`,
        ]
          .filter(Boolean)
          .join("");
        return `<tr>
          <td><div class="cell-main"><strong>${esc(plugin.title || plugin.file)}</strong></div></td>
          <td><span class="mono">${esc(plugin.name)}</span></td>
          <td>—</td>
          <td><div class="cell-desc">${esc(plugin.description || "暂无说明")}</div></td>
          <td>${status}</td>
          <td class="cell-actions">${buttons}</td>
        </tr>`;
      })
      .join("");
  }

  function renderPlugins() {
    const data = state.pluginManager.data;
    if (!data) return;
    renderSinglePlugins(data);
    const plugins = data.plugins || [];
    const sources = data.sources || [];
    const stats = data.stats || {};
    const busy = state.pluginManager.busy;

    $("#pluginStats").innerHTML = [
      miniStat("插件库", fmtNum(stats.total ?? plugins.length), "puzzle", 1),
      miniStat("已安装", fmtNum(stats.installed), "grid", 2),
      miniStat("未安装", fmtNum(stats.available), "download", 3),
      miniStat("已加载", fmtNum(stats.loaded), "check", 4),
    ].join("");

    const customButton = $("#pluginInstallCustom");
    if (customButton) {
      customButton.disabled = !state.allowWrite || !!busy;
      customButton.title = state.allowWrite ? "" : "WebUI 当前为只读模式";
    }

    renderPluginSources(data);

    $$("#pluginTabs [data-plugin-tab]").forEach(button => {
      const tab = button.dataset.pluginTab;
      button.classList.toggle("active", tab === state.pluginManager.tab);
      button.innerHTML = `${tab === "installed" ? "已安装" : "未安装"}<span>${fmtNum(
        tab === "installed" ? stats.installed : stats.available,
      )}</span>`;
    });

    const meta = [];
    meta.push(`<span>共 ${fmtNum(stats.total)} 个插件</span>`);
    if (data.updatedAt) meta.push(`<span>索引更新于 ${esc(fmtDateTime(data.updatedAt))}</span>`);
    else meta.push('<span class="muted">索引尚未同步</span>');
    if (data.stale) meta.push(pill("索引不可用，展示旧缓存", "pill-amber"));
    else if (data.fromCache) meta.push(pill("缓存", "pill-outline"));
    else if (data.updatedAt) meta.push(pill("刚刚同步", "pill-green"));
    if (busy) meta.push(`<span class="plugin-busy"><span class="spinner"></span>${esc(busy)}</span>`);
    const failed = sources.filter(source => !source.ok && source.error);
    if (failed.length) {
      meta.push(
        `<span class="plugin-source-warning" title="${esc(
          failed.map(source => `${source.label || source.id}: ${source.error}`).join("\n"),
        )}">${icon("alert")}${esc(failed.map(source => source.label || source.id).join("、"))} 索引读取失败</span>`,
      );
    }
    $("#pluginStoreMeta").innerHTML = meta.join("");

    const tab = state.pluginManager.tab;
    const tabPlugins = plugins.filter(plugin => (tab === "installed" ? plugin.installed : !plugin.installed));
    const query = state.pluginManager.query.trim().toLowerCase();
    const filtered = tabPlugins.filter(plugin => pluginMatches(plugin, query));

    if (!filtered.length) {
      let emptyText = "没有匹配的插件";
      if (!query) {
        if (!plugins.length && data.stale) emptyText = "插件索引暂不可用，请检查网络后点击「同步插件库」";
        else if (tab === "installed") emptyText = "尚未安装插件";
        else emptyText = "插件库中没有未安装的插件";
      }
      $("#pluginRows").innerHTML = tableEmpty(6, emptyText);
      return;
    }

    $("#pluginRows").innerHTML =
      filtered
        .slice(0, state.pluginManager.limit)
        .map(plugin => {
          const repo = safeHttpUrl(plugin.link);
          const nameHtml = repo
            ? `<a class="plugin-link mono" href="${esc(repo)}" target="_blank" rel="noopener">${esc(plugin.name)}</a>`
            : `<span class="mono">${esc(plugin.name)}</span>`;
          return `<tr>
          <td>${pluginTitleHtml(plugin)}</td>
          <td><div class="cell-main">${nameHtml}${plugin.version ? `<small>v${esc(plugin.version)}</small>` : ""}</div></td>
          <td>${pluginAuthorHtml(plugin)}</td>
          <td><div class="cell-desc" title="${esc(plugin.description || "")}">${
            plugin.description ? esc(plugin.description) : '<span class="muted">暂无说明</span>'
          }</div></td>
          <td>${pluginStatusHtml(plugin)}</td>
          <td class="cell-actions">${pluginActionsHtml(plugin)}</td>
        </tr>`;
        })
        .join("") + moreRow(6, "pluginstore", filtered.length, state.pluginManager.limit);
  }

  async function runPluginAction({ path, body, busy, title, progress }) {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    if (state.pluginManager.busy) return toast("已有插件操作正在进行，请稍候", "info");
    state.pluginManager.busy = busy || "正在执行插件操作";
    renderPlugins();
    toast(progress || "正在执行插件操作…", "info", title);
    try {
      const result = await api(path, { method: "POST", body });
      toast(result.message || "操作完成", result.dependencyWarning ? "info" : "success", title);
      state.pluginManager.data = null;
      state.configPlugin.list = null;
      await loadPlugins();
      invalidateOverview();
    } catch (error) {
      handleError(error);
    } finally {
      state.pluginManager.busy = "";
      renderPlugins();
    }
  }

  async function installIndexPlugin(name) {
    const plugin = pluginByName(name);
    if (!plugin) return;
    if (!plugin.link) return toast("该插件在索引中缺少安装地址", "error");
    const confirmed = await confirmDialog({
      title: "安装插件",
      message: `将把「${plugin.title || plugin.name}」从 ${plugin.link} 克隆到 plugins/${
        plugin.name
      }，存在 package.json 时自动安装依赖。安装完成后需重启 Bot 才会加载，请仅安装可信来源的插件。`,
      confirmText: "安装",
    });
    if (!confirmed) return;
    await runPluginAction({
      path: "/plugin-manager/install",
      body: { link: plugin.link, autoInstall: true },
      busy: `正在安装「${plugin.name}」`,
      title: "安装插件",
      progress: `正在克隆 ${plugin.name}…`,
    });
  }

  async function updateManagedPlugin(name) {
    const plugin = pluginByName(name);
    if (!plugin) return;
    const confirmed = await confirmDialog({
      title: "更新插件",
      message: `将对「${plugin.title || plugin.name}」执行 git pull --ff-only，存在 package.json 时安装依赖。更新后需重启 Bot 才会完全生效。`,
      confirmText: "更新",
    });
    if (!confirmed) return;
    await runPluginAction({
      path: "/plugin-manager/update",
      body: { name, autoInstall: true },
      busy: `正在更新「${name}」`,
      title: "更新插件",
      progress: `正在拉取 ${name} 的最新代码…`,
    });
  }

  function openUninstallPluginModal(plugin) {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    const modal = openModal({
      title: "卸载插件",
      subtitle: `将删除 plugins/${plugin.name} 目录`,
      body: `<div class="modal-body">
        <p class="confirm-text">此操作会移除插件文件且不可撤销。若插件正在运行，重启 Bot 后会完全卸载。</p>
        <label class="field"><span>输入插件名称 <code>${esc(plugin.name)}</code> 以确认</span>
          <input id="pluginUninstallConfirm" type="text" autocomplete="off" spellcheck="false" placeholder="${esc(
            plugin.name,
          )}" />
        </label>
        <p class="plugin-install-error" id="pluginUninstallError" hidden>名称不匹配，请重新输入</p>
      </div>`,
      footer: `<button type="button" class="btn btn-outline" data-close>取消</button>
        <button type="button" class="btn btn-danger" id="pluginUninstallSubmit" disabled>${icon("trash")}卸载</button>`,
      width: "narrow",
    });
    const input = $("#pluginUninstallConfirm", modal.root);
    const submit = $("#pluginUninstallSubmit", modal.root);
    const errorBox = $("#pluginUninstallError", modal.root);
    input.addEventListener("input", () => {
      errorBox.hidden = true;
      submit.disabled = input.value.trim() !== plugin.name;
    });
    const run = async () => {
      if (input.value.trim() !== plugin.name) {
        errorBox.hidden = false;
        return;
      }
      modal.close();
      await runPluginAction({
        path: "/plugin-manager/uninstall",
        body: { name: plugin.name, confirm: input.value.trim() },
        busy: `正在卸载「${plugin.name}」`,
        title: "卸载插件",
        progress: `正在移除 ${plugin.name}…`,
      });
    };
    submit.addEventListener("click", run);
    input.addEventListener("keydown", event => {
      if (event.key === "Enter" && !submit.disabled) {
        event.preventDefault();
        run();
      }
    });
    window.setTimeout(() => input.focus(), 30);
  }

  async function toggleSinglePlugin(key, enabled) {    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    if (state.pluginManager.busy) return toast("已有插件操作正在进行，请稍候", "info");
    if (!enabled) {
      const confirmed = await confirmDialog({
        title: "停用单文件插件",
        message: `将停用「${key}」，立即热卸载，文件保留在 plugins 目录。可随时重新启用。`,
        confirmText: "停用",
      });
      if (!confirmed) return;
    }
    await runPluginAction({
      path: "/plugin-manager/single/toggle",
      body: { key, enabled, confirm: enabled ? "" : key },
      busy: `正在${enabled ? "启用" : "停用"}「${key}」`,
      title: enabled ? "启用单文件插件" : "停用单文件插件",
      progress: `正在${enabled ? "加载" : "卸载"} ${key}…`,
    });
  }

  async function installSinglePlugin(file) {
    const index = state.pluginManager.data?.singleIndex || {};
    const entry = (index.entries || []).find(item => item.file === file);
    if (!entry) return toast("未找到该单 js 插件", "error");
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    const confirmed = await confirmDialog({
      title: "安装单 js 插件",
      message: `将把「${entry.title}」的源码下载到 plugins/example/${entry.file} 并立即加载。来源：${
        entry.downloadUrls?.[0] || entry.link
      }。单 js 插件与整包插件同样有执行权限，请仅安装可信来源。`,
      confirmText: "安装",
    });
    if (!confirmed) return;
    await runPluginAction({
      path: "/plugin-manager/single/install",
      body: { urls: entry.downloadUrls || [entry.link], title: entry.title, file: entry.file },
      busy: `正在安装「${entry.title}」`,
      title: "安装单 js 插件",
      progress: `正在下载 ${entry.file}…`,
    });
  }

  function openCloneSinglePluginModal() {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    if (state.pluginManager.busy) return toast("已有插件操作正在进行，请稍候", "info");

    const modal = openModal({
      title: "从 Git 仓库克隆单 js 插件",
      subtitle: "浅克隆后只挑选 js 文件复制到 plugins/example，不保留仓库目录",
      body: `<div class="modal-body">
        <label class="field"><span>Git 仓库地址</span>
          <input id="cloneRepoLink" type="url" autocomplete="off" spellcheck="false" placeholder="https://github.com/owner/js-plugins" />
          <span class="hint">支持 GitHub、Gitee、GitLab、GitCode 等公开仓库；地址不能包含账号、令牌、查询参数或锚点。</span>
        </label>
        <div class="clone-repo-actions">
          <button type="button" class="btn btn-outline btn-sm" id="cloneRepoFetch">${icon("search")}读取 js 文件</button>
          <span class="muted" id="cloneRepoHint">先读取仓库，再勾选要导入的文件</span>
        </div>
        <div class="clone-repo-files" id="cloneRepoFiles" hidden></div>
        <p class="plugin-install-error" id="cloneRepoError" hidden></p>
      </div>`,
      footer: `<button type="button" class="btn btn-outline" data-close>取消</button>
        <button type="button" class="btn btn-primary" id="cloneRepoSubmit" disabled>${icon("download")}导入所选</button>`,
      width: "wide",
    });

    const root = modal.root;
    const linkInput = $("#cloneRepoLink", root);
    const fetchButton = $("#cloneRepoFetch", root);
    const submit = $("#cloneRepoSubmit", root);
    const listBox = $("#cloneRepoFiles", root);
    const hint = $("#cloneRepoHint", root);
    const errorBox = $("#cloneRepoError", root);
    const fail = message => {
      errorBox.textContent = message;
      errorBox.hidden = false;
    };
    const syncSubmit = () => {
      submit.disabled = !listBox.querySelector("input[type=checkbox]:checked");
    };

    const loadFiles = async () => {
      const link = linkInput.value.trim();
      errorBox.hidden = true;
      if (!link) return fail("请输入插件 Git 地址");
      if (!safeHttpUrl(link)) return fail("地址必须是有效的 http/https URL");
      fetchButton.disabled = true;
      hint.textContent = "正在克隆并读取文件列表…";
      listBox.hidden = true;
      listBox.innerHTML = "";
      submit.disabled = true;
      try {
        const data = await api("/plugin-manager/single/repo", { method: "POST", body: { link } });
        const files = data.files || [];
        if (!files.length) {
          hint.textContent = "仓库里没有可导入的 js 文件";
          return;
        }
        hint.textContent = `共 ${fmtNum(files.length)} 个 js 文件，勾选后导入`;
        listBox.innerHTML = files
          .map(
            file => `<label class="clone-repo-file">
              <input type="checkbox" value="${esc(file.path)}" ${file.exists ? "disabled" : ""} />
              <span class="mono">${esc(file.path)}</span>
              ${file.exists ? pill("已存在", "pill-amber") : ""}
            </label>`,
          )
          .join("");
        listBox.hidden = false;
      } catch (error) {
        hint.textContent = "读取失败";
        fail(error.message || String(error));
      } finally {
        fetchButton.disabled = false;
      }
    };

    fetchButton.addEventListener("click", loadFiles);
    linkInput.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        loadFiles();
      }
    });
    listBox.addEventListener("change", syncSubmit);

    submit.addEventListener("click", async () => {
      const link = linkInput.value.trim();
      const files = [...listBox.querySelectorAll("input[type=checkbox]:checked")].map(item => item.value);
      if (!files.length) return fail("请至少勾选一个文件");
      submit.disabled = true;
      errorBox.hidden = true;
      try {
        const result = await api("/plugin-manager/single/clone", { method: "POST", body: { link, files } });
        modal.close();
        toast(result.message || "已导入", result.skipped?.length ? "info" : "success", "克隆单 js 插件");
        state.pluginManager.data = null;
        await loadPlugins();
        invalidateOverview();
      } catch (error) {
        submit.disabled = false;
        fail(error.message || String(error));
      }
    });
    window.setTimeout(() => linkInput.focus(), 30);
  }

  async function openSinglePluginEditor(name) {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    if (state.pluginManager.busy) return toast("已有插件操作正在进行，请稍候", "info");

    const editing = !!name;
    let file = name ? name.split("/").pop() : "";
    let content = "";
    if (editing) {
      try {
        const data = await api(`/plugin-manager/single/source?key=${encodeURIComponent(name)}`);
        file = data.file || file;
        content = data.content || "";
      } catch (error) {
        handleError(error);
        return;
      }
    }

    const modal = openModal({
      title: editing ? "编辑单 js 插件" : "新建单 js 插件",
      subtitle: editing ? `plugins/${name}` : "直接粘贴代码保存到 plugins/example，保存后立即加载",
      body: `<div class="modal-body">
        <label class="field"><span>插件文件名</span>
          <input id="singleEditorFile" type="text" autocomplete="off" spellcheck="false" placeholder="我的插件.js" value="${esc(
            file,
          )}" />
          <span class="hint">保存在 plugins/example 下，改名会同时重命名文件。不写 .js 会自动补上。</span>
        </label>
        <label class="field"><span>插件代码</span>
          <textarea id="singleEditorContent" class="single-editor-code" spellcheck="false" placeholder="import plugin from '../../lib/plugins/plugin.js' …">${esc(
            content,
          )}</textarea>
        </label>
        <p class="plugin-install-error" id="singleEditorError" hidden></p>
      </div>`,
      footer: `<button type="button" class="btn btn-outline" data-close>取消</button>
        <button type="button" class="btn btn-primary" id="singleEditorSubmit">${icon("save")}${
          editing ? "保存" : "创建并加载"
        }</button>`,
      width: "wide",
    });

    const root = modal.root;
    const fileInput = $("#singleEditorFile", root);
    const codeInput = $("#singleEditorContent", root);
    const submit = $("#singleEditorSubmit", root);
    const errorBox = $("#singleEditorError", root);
    const fail = message => {
      errorBox.textContent = message;
      errorBox.hidden = false;
    };
    codeInput.addEventListener("input", () => {
      errorBox.hidden = true;
    });

    const run = async () => {
      const nextFile = fileInput.value.trim();
      const code = codeInput.value;
      if (!nextFile) return fail("请填写插件文件名");
      if (!code.trim()) return fail("请粘贴插件代码");

      submit.disabled = true;
      errorBox.hidden = true;
      try {
        const oldKey = name;
        const result = editing
          ? await api("/plugin-manager/single/save", {
              method: "POST",
              body: { key: oldKey, file: nextFile, content: code },
            })
          : await api("/plugin-manager/single/create", {
              method: "POST",
              body: { file: nextFile, content: code },
            });
        modal.close();
        toast(result.message || "已保存", "success", editing ? "编辑单 js 插件" : "新建单 js 插件");
        state.pluginManager.data = null;
        await loadPlugins();
        invalidateOverview();
      } catch (error) {
        submit.disabled = false;
        fail(error.message || String(error));
      }
    };
    submit.addEventListener("click", run);
  }

  function openRemoveSinglePluginModal(plugin) {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    const key = plugin.key || plugin.name;
    const modal = openModal({
      title: "删除单文件插件",
      subtitle: `将删除 plugins/${key}（目录保留）`,
      body: `<div class="modal-body">
        <p class="confirm-text">只删除这个 js 文件，所在目录和其它插件文件不受影响。此操作不可撤销。</p>
        <label class="field"><span>输入文件名 <code>${esc(key)}</code> 以确认</span>
          <input id="pluginSingleRemoveConfirm" type="text" autocomplete="off" spellcheck="false" placeholder="${esc(
            key,
          )}" />
        </label>
        <p class="plugin-install-error" id="pluginSingleRemoveError" hidden>名称不匹配，请重新输入</p>
      </div>`,
      footer: `<button type="button" class="btn btn-outline" data-close>取消</button>
        <button type="button" class="btn btn-danger" id="pluginSingleRemoveSubmit" disabled>${icon("trash")}删除</button>`,
      width: "narrow",
    });
    const input = $("#pluginSingleRemoveConfirm", modal.root);
    const submit = $("#pluginSingleRemoveSubmit", modal.root);
    const errorBox = $("#pluginSingleRemoveError", modal.root);
    input.addEventListener("input", () => {
      errorBox.hidden = true;
      submit.disabled = input.value.trim() !== key;
    });
    const run = async () => {
      if (input.value.trim() !== key) {
        errorBox.hidden = false;
        return;
      }
      modal.close();
      await runPluginAction({
        path: "/plugin-manager/single/remove",
        body: { key, confirm: input.value.trim() },
        busy: `正在删除「${key}」`,
        title: "删除单文件插件",
        progress: `正在移除 ${key}…`,
      });
    };
    submit.addEventListener("click", run);
    input.addEventListener("keydown", event => {
      if (event.key === "Enter" && !submit.disabled) {
        event.preventDefault();
        run();
      }
    });
    window.setTimeout(() => input.focus(), 30);
  }

  function openInstallPluginModal() {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    const modal = openModal({
      title: "安装自定义插件",
      subtitle: "从 Git 仓库克隆到 plugins 目录，重启 Bot 后加载",
      body: `<div class="modal-body">
        <label class="field"><span>Git 仓库地址</span>
          <input id="pluginInstallLink" type="url" autocomplete="off" spellcheck="false" placeholder="https://github.com/owner/plugin" />
          <span class="hint">支持 GitHub、Gitee、GitLab、GitCode 等公开仓库；地址不能包含账号、令牌、查询参数或锚点。</span>
        </label>
        <label class="plugin-check">
          <input type="checkbox" id="pluginInstallDeps" checked />
          <span><strong>安装依赖</strong><small>存在 package.json 时在项目根目录执行 pnpm install</small></span>
        </label>
        <div class="plugin-install-tip">${icon("info")}插件代码在重启后才会加载；依赖安装可能触发包脚本，请仅安装可信来源。</div>
        <p class="plugin-install-error" id="pluginInstallError" hidden></p>
      </div>`,
      footer: `<button type="button" class="btn btn-outline" data-close>取消</button>
        <button type="button" class="btn btn-primary" id="pluginInstallSubmit">${icon("download")}开始安装</button>`,
    });
    const linkInput = $("#pluginInstallLink", modal.root);
    const depsInput = $("#pluginInstallDeps", modal.root);
    const submit = $("#pluginInstallSubmit", modal.root);
    const errorBox = $("#pluginInstallError", modal.root);
    const fail = message => {
      errorBox.textContent = message;
      errorBox.hidden = false;
    };
    const run = async () => {
      const link = linkInput.value.trim();
      if (!link) return fail("请输入插件 Git 地址");
      if (!safeHttpUrl(link)) return fail("地址必须是有效的 http/https URL");
      modal.close();
      const confirmed = await confirmDialog({
        title: "确认安装",
        message: `将从 ${link} 克隆插件到 plugins 目录，${depsInput.checked ? "并在存在 package.json 时安装依赖。" : "不自动安装依赖。"}安装完成后需重启 Bot 才会加载，请仅安装可信来源的插件。`,
        confirmText: "安装",
      });
      if (!confirmed) return;
      let name = "";
      try {
        name = decodeURIComponent(new URL(link).pathname.split("/").filter(Boolean).pop() || "").replace(/\.git$/i, "");
      } catch {}
      await runPluginAction({
        path: "/plugin-manager/install",
        body: { link, autoInstall: depsInput.checked },
        busy: `正在安装「${name || "自定义插件"}」`,
        title: "安装自定义插件",
        progress: "正在克隆插件仓库…",
      });
    };
    submit.addEventListener("click", run);
    linkInput.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        run();
      }
    });
    window.setTimeout(() => linkInput.focus(), 30);
  }


  /* ---------------- 配置管理 ---------------- */

  function configPathKey(field) {
    return (Array.isArray(field.path) ? field.path : [field.key]).join(".");
  }

  function configPageState(view) {
    if (view === "basic") return state.configBasic;
    if (view === "other") return state.configOther;
    if (view === "group") return state.configGroup;
    if (view === "ai-system") return state.aiYaml;
    return state.configPlugin;
  }

  function configDetail(view) {
    if (view === "ai-system") return state.aiYaml[view];
    const pageState = configPageState(view);
    return pageState ? pageState.detail : null;
  }

  function findConfigField(view, key) {
    const detail = configDetail(view);
    return detail ? (detail.fields || []).find(field => configPathKey(field) === key) : null;
  }

  function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value)
        .sort()
        .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
        .join(",")}}`;
    }
    return JSON.stringify(value);
  }

  function configEqual(a, b) {
    return stableStringify(a) === stableStringify(b);
  }

  function formatConfigSize(bytes) {
    const number = Number(bytes);
    if (!Number.isFinite(number) || number <= 0) return "0 B";
    if (number < 1024) return `${number} B`;
    if (number < 1024 * 1024) return `${(number / 1024).toFixed(1)} KB`;
    return `${(number / 1024 / 1024).toFixed(2)} MB`;
  }

  function configLoadingHtml(text) {
    return `<div class="config-loading"><span class="spinner"></span>${esc(text || "正在加载配置…")}</div>`;
  }

  function configErrorHtml(error, view) {
    return `<div class="config-error">${icon("alert")}<strong>加载失败</strong><p>${esc(error?.message || String(error))}</p>
      <button class="btn btn-outline btn-sm" type="button" data-config-retry="${view}">${icon("refresh")}重试</button></div>`;
  }

  function configSwitchHtml(field, disabled) {
    const editor = field.editor === "switch01" ? "switch01" : "switch";
    const checked = editor === "switch01" ? Number(field.value) === 1 : field.value === true;
    return `<label class="switch">
      <input type="checkbox" data-config-control data-editor="${editor}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} />
      <span class="track"></span>
      <span class="config-switch-text">${checked ? "开启" : "关闭"}</span>
    </label>`;
  }

  function configCandidateOf(item) {
    if (typeof item === "string") return { value: item, label: item };
    const value = String(item?.value ?? item?.name ?? "");
    return { value, label: String(item?.label || item?.name || value) };
  }

  function configTagHtml(value, label, disabled) {
    const text = label && String(label) !== String(value) ? String(label) : String(value);
    return `<span class="config-tag" data-tag-value="${esc(value)}" data-tag-label="${esc(text)}" title="${esc(text)}"><span class="config-tag-text">${esc(text)}</span>${
      disabled ? "" : '<button type="button" data-tag-remove aria-label="移除">×</button>'
    }</span>`;
  }

  function configTagLabel(editor, value) {
    const button = $$("[data-tag-pick]", editor || document).find(item => item.dataset.tagPick === String(value));
    return button?.dataset.tagLabel || String(value);
  }

  function configTagsHtml(field, disabled) {
    const values = Array.isArray(field.value) ? field.value : [];
    const candidates = (Array.isArray(field.candidates) ? field.candidates : [])
      .map(configCandidateOf)
      .filter(item => item.value);
    const labels = field.valueLabels && typeof field.valueLabels === "object" ? field.valueLabels : {};
    const tags = values.map(value => configTagHtml(value, labels[String(value)], disabled)).join("");
    const picked = new Set(values.map(String));
    const candidateHtml = candidates.length
      ? `<div class="config-candidates">
        <div class="config-candidates-head"><span>可选项</span><small>点击名称即可${disabled ? "查看" : "添加或移除"}</small></div>
        <div class="config-candidate-list">
          ${candidates
            .map(item => {
              const active = picked.has(item.value);
              return `<button type="button" class="config-candidate${active ? " active" : ""}" data-tag-pick="${esc(item.value)}" data-tag-label="${esc(item.label)}" title="${esc(item.label)}" ${
                disabled ? "disabled" : ""
              } aria-pressed="${active ? "true" : "false"}">${icon(active ? "check" : "plus")}<span class="config-candidate-text">${esc(item.label)}</span></button>`;
            })
            .join("")}
        </div>
      </div>`
      : "";
    return `<div class="config-list-editor">
      <div class="config-tags">
        ${!values.length ? `<span class="config-tags-empty">${disabled ? "未配置" : candidates.length ? "尚未选择，点击下方名称添加" : esc(field.emptyHint || "尚未添加，在下方输入后回车")}</span>` : ""}
        ${tags}
      </div>
      ${candidateHtml}
      ${
        disabled
          ? ""
          : `<div class="config-list-add">
        <input class="config-input" type="text" data-tag-input placeholder="${candidates.length ? "也可手动输入名称，回车添加" : "输入内容后回车添加"}" autocomplete="off" aria-label="添加一项" />
      </div>`
      }
    </div>`;
  }

  function configSubControlHtml(sub, value, disabled, row) {
    const locked = disabled || sub.readOnly ? "disabled" : "";
    if (sub.secret) {
      const secretSet = !!(row && row.__secretSet && row.__secretSet[sub.key]);
      return `<input class="config-input" type="password" data-sub-field="${esc(sub.key)}" data-sub-type="string" data-sub-secret="1" data-sub-secret-set="${secretSet ? "1" : "0"}" value="" placeholder="${secretSet ? "已设置，留空保持原值" : "未设置"}" autocomplete="new-password" ${locked} />`;
    }
    if (sub.editor === "switch" || sub.type === "boolean") {
      return `<label class="switch"><input type="checkbox" data-sub-field="${esc(sub.key)}" data-sub-type="boolean" ${value ? "checked" : ""} ${locked} /><span class="track"></span><span class="config-switch-text">${value ? "开启" : "关闭"}</span></label>`;
    }
    if (sub.editor === "textarea") {
      return `<textarea class="config-input text-area" data-sub-field="${esc(sub.key)}" data-sub-type="string" rows="3" ${locked}>${esc(value ?? "")}</textarea>`;
    }
    if (sub.options?.length) {
      const current = value === null || value === undefined ? "" : String(value);
      let options = sub.options
        .map(option => `<option value="${esc(option.value)}" ${String(option.value) === current ? "selected" : ""}>${esc(option.label)}</option>`)
        .join("");
      if (!sub.options.some(option => String(option.value) === current)) {
        options = `<option value="${esc(current)}" selected>${esc(current || "—")}</option>${options}`;
      }
      return `<select class="config-input" data-sub-field="${esc(sub.key)}" data-sub-type="${esc(sub.type)}" ${locked}>${options}</select>`;
    }
    if (sub.type === "number") {
      return `<input class="config-input" type="number" step="any" data-sub-field="${esc(sub.key)}" data-sub-type="number" value="${value === null || value === undefined ? "" : esc(value)}" ${locked} />`;
    }
    return `<input class="config-input" type="text" data-sub-field="${esc(sub.key)}" data-sub-type="${esc(sub.type || "string")}" value="${value === null || value === undefined ? "" : esc(value)}" ${locked} />`;
  }

  function subformRowHtml(field, row, disabled) {
    const schemas = field.schemas || [];
    const values = row && typeof row === "object" ? row : {};
    const origin = Number.isInteger(values.__origin) ? values.__origin : -1;
    return `<div class="subform-row" data-subform-row data-subform-origin="${origin}">
      <div class="subform-grid">
        ${schemas
          .map(
            sub => `<label class="subform-field"><span>${esc(sub.label || sub.key)}${sub.required ? ' <em class="req">*</em>' : ""}</span>${configSubControlHtml(sub, values[sub.key], disabled, values)}</label>`,
          )
          .join("")}
      </div>
      ${field.multiple === false || disabled ? "" : `<button type="button" class="icon-btn subform-remove" data-subform-remove title="删除条目" aria-label="删除条目">${icon("trash")}</button>`}
    </div>`;
  }

  function configSubformHtml(field, disabled) {
    const multiple = field.multiple !== false;
    const rows = multiple ? (Array.isArray(field.value) ? field.value : []) : [field.value || {}];
    return `<div class="subform" data-subform>
      ${rows.length ? rows.map(row => subformRowHtml(field, row, disabled)).join("") : '<div class="subform-empty">尚未添加条目</div>'}
    </div>
    ${
      multiple && !disabled
        ? `<button type="button" class="btn btn-outline btn-sm config-subform-add" data-subform-add="${esc(configPathKey(field))}">${icon("plus")}添加一项</button>`
        : ""
    }`;
  }

  /** 模型池下拉：候选项来自「状态」页里已添加的模型，留空表示跟随主模型 */
  function configModelPoolHtml(field, disabled) {
    const current = String(field.value ?? "");
    const seen = new Set();
    const groups = [];
    for (const channel of aiSelectableChannels(state.aiModels).filter(item => item.enabled !== false)) {
      const models = aiChannelModels(channel).filter(model => !seen.has(model));
      if (!models.length) continue;
      for (const model of models) seen.add(model);
      groups.push(
        `<optgroup label="${esc(channel.name)}">${models
          .map(model => `<option value="${esc(model)}" ${model === current ? "selected" : ""}>${esc(model)}</option>`)
          .join("")}</optgroup>`,
      );
    }
    const unknown =
      current && !seen.has(current)
        ? `<option value="${esc(current)}" selected>${esc(current)}（已不在模型池）</option>`
        : "";
    const empty = groups.length
      ? `<option value="" ${current ? "" : "selected"}>跟随主模型</option>`
      : `<option value="" ${current ? "" : "selected"}>跟随主模型（尚未添加模型）</option>`;
    return `<select class="config-input" data-config-control ${disabled ? "disabled" : ""}>${empty}${groups.join("")}${unknown}</select>`;
  }

  function configControlHtml(field, disabled) {
    const editor = field.editor;
    const locked = disabled ? "disabled" : "";
    if (editor === "switch" || editor === "switch01") return configSwitchHtml(field, disabled);
    if (editor === "subform") return configSubformHtml(field, disabled);
    if (editor === "model-pool") return configModelPoolHtml(field, disabled);
    if (editor === "list" || field.type === "array") return configTagsHtml(field, disabled);
    if (editor === "json") {
      const text = field.value === null || field.value === undefined ? "" : JSON.stringify(field.value, null, 2);
      return `<textarea class="config-input" data-config-control rows="5" ${locked}>${esc(text)}</textarea>`;
    }
    if (editor === "select" || field.options?.length) {
      const options = field.options || [];
      let optionHtml = options
        .map(option => `<option value="${esc(option.value)}" ${String(option.value) === String(field.value ?? "") ? "selected" : ""}>${esc(option.label)}</option>`)
        .join("");
      if (field.value !== null && field.value !== undefined && !options.some(option => String(option.value) === String(field.value))) {
        optionHtml = `<option value="${esc(field.value)}" selected>${esc(field.value)}</option>${optionHtml}`;
      }
      return `<select class="config-input" data-config-control ${locked}>${optionHtml || '<option value="">—</option>'}</select>`;
    }

    const value = field.secret ? "" : field.value;
    const placeholder = field.secret
      ? field.hasValue
        ? "已设置，留空保持不变"
        : "未设置"
      : field.placeholder || "";
    if (editor === "textarea" || (typeof value === "string" && (value.length > 90 || value.includes("\n")))) {
      return `<textarea class="config-input text-area" data-config-control rows="4" placeholder="${esc(placeholder)}" ${locked}>${esc(value ?? "")}</textarea>`;
    }
    return `<input class="config-input" type="${field.type === "number" ? "number" : field.secret ? "password" : "text"}" ${
      field.type === "number" ? 'step="any"' : ""
    } data-config-control value="${value === null || value === undefined ? "" : esc(value)}" placeholder="${esc(placeholder)}" autocomplete="${field.secret ? "new-password" : "off"}" ${locked} />`;
  }

  function configFieldHtml(field, options) {
    const opts = options || {};
    const key = configPathKey(field);
    const badges = [];
    if (opts.group && !opts.isDefault) {
      badges.push(field.overridden ? pill("已覆盖", "pill-amber") : pill("继承", ""));
    }
    if (field.readOnly) badges.push(pill("只读", "pill-outline"));
    if (field.restartRequired) badges.push(pill("需重启", "pill-amber"));
    if (field.fromDefault) badges.push(pill("默认值", ""));
    if (field.secret) badges.push(pill(field.hasValue ? "已设置" : "未设置", "pill-outline"));

    const reset =
      opts.group && (field.overridden || (opts.isDefault && !configEqual(field.value, field.defaultValue)))
        ? `<button type="button" class="btn btn-ghost btn-sm" data-group-reset="${esc(key)}">${icon("refresh")}恢复${opts.isDefault ? "默认" : "继承"}</button>`
        : "";
    const wide =
      field.wide === true ||
      field.readOnly ||
      ["textarea", "json", "list", "subform"].includes(field.editor) ||
      field.type === "array" ||
      field.type === "object";
    const disabled = !!field.readOnly || !state.allowWrite;

    const help = field.help && String(field.help).trim() !== String(field.label || field.key).trim() ? field.help : "";
    // 过长的说明折叠两行，悬停看 title、点击弹窗看全文
    const helpLong = help && String(help).length > 46;
    const helpHtml = help
      ? `<div class="config-help${helpLong ? " clamp" : ""}"${helpLong ? ` title="${esc(help)}" data-fulltext="${esc(help)}"` : ""}>${esc(help)}</div>`
      : "";
    return `<div class="config-field${wide ? " wide" : ""}" data-config-key="${esc(key)}" data-editor="${esc(field.editor || "text")}" data-field-type="${esc(field.type || "string")}">
      <div class="config-label"><span>${esc(field.label || field.key)}</span>${field.required ? '<em class="req">*</em>' : ""}${badges.join("")}${reset}</div>
      ${helpHtml}
      ${configControlHtml(field, disabled)}
    </div>`;
  }

  function configSectionKey(view, detail) {
    if (view === "plugin" && detail?.plugin?.key) return `plugin:${detail.plugin.key}:${detail.id || ""}`;
    return view;
  }

  function configFieldsHtml(fields, options) {
    const opts = options || {};
    const sections = [];
    let current = null;
    for (const field of fields || []) {
      // 由其他页面管理的项留在字段表里供校验写入，但不在这里显示
      if (field.hidden) continue;
      const name = field.section || "";
      if (!current || current.name !== name) {
        current = { name, fields: [] };
        sections.push(current);
      }
      current.fields.push(field);
    }
    if (!sections.length) return "";
    if (sections.length === 1) {
      return `<div class="config-section">
        ${sections[0].name ? `<div class="config-section-title">${esc(sections[0].name)}</div>` : ""}
        <div class="config-fields">${sections[0].fields.map(field => configFieldHtml(field, opts)).join("")}</div>
      </div>`;
    }
    const sectionKey = opts.sectionKey || "default";
    let active = Number(state.configSections[sectionKey]);
    if (!Number.isInteger(active) || active < 0 || active >= sections.length) active = 0;
    state.configSections[sectionKey] = active;
    return `<div class="config-section-tabs" role="tablist" data-config-section-tabs="${esc(sectionKey)}">
      ${sections
        .map(
          (section, index) =>
            `<button type="button" role="tab" class="config-section-tab ${index === active ? "active" : ""}" aria-selected="${
              index === active ? "true" : "false"
            }" data-config-section-tab="${index}">${esc(section.name || "通用")}</button>`,
        )
        .join("")}
    </div>
    ${sections
      .map(
        (section, index) => `<div class="config-section" data-config-section="${index}" ${index === active ? "" : "hidden"}>
          <div class="config-fields">${section.fields.map(field => configFieldHtml(field, opts)).join("")}</div>
        </div>`,
      )
      .join("")}`;
  }

  function configPanelHtml(detail, view, options) {
    const opts = options || {};
    const title = opts.title || detail.title || "配置";
    const description = opts.description !== undefined ? opts.description : detail.description;
    const badges = [];
    if (opts.badge) badges.push(pill(opts.badge, opts.badgeVariant || "pill-blue"));
    if (detail.kind) badges.push(pill(detail.kind === "guoba" ? "Guoba" : "YAML", detail.kind === "guoba" ? "pill-pink" : "pill-outline"));

    const meta = [];
    if (detail.file) meta.push(`<span class="mono">${esc(detail.file)}</span>`);
    if (detail.updatedAt) meta.push(`<span>更新于 ${esc(fmtDateTime(detail.updatedAt))}</span>`);
    if (detail.size) meta.push(`<span>${esc(formatConfigSize(detail.size))}</span>`);
    if (opts.meta) meta.push(opts.meta);
    const note = opts.note !== undefined ? opts.note : detail.note;
    const saveButton = `<button class="btn btn-primary" type="button" data-config-save="${view}" ${
      state.allowWrite ? "" : 'disabled title="WebUI 当前为只读模式"'
    }>${icon("save")}保存修改</button>`;

    return `<div class="config-main-head">
      <div><h3>${esc(title)}</h3>${description ? `<p>${esc(description)}</p>` : ""}</div>
      <div class="config-main-actions">${badges.join("")}${saveButton}</div>
    </div>
    ${
      meta.length || note
        ? `<div class="config-meta">${meta.join("")}${note ? `<span class="config-note">${esc(note)}</span>` : ""}</div>`
        : ""
    }
    ${
      state.allowWrite
        ? ""
        : `<div class="config-readonly">${icon("lock")}WebUI 当前为只读模式，保存、恢复与移除操作已禁用。</div>`
    }
    <div class="config-form" data-config-form="${view}">${configFieldsHtml(detail.fields, {
      ...opts,
      sectionKey: opts.sectionKey || configSectionKey(view, detail),
    })}</div>
    <div class="config-foot"><span class="config-dirty" data-config-dirty="${view}">未修改</span></div>`;
  }

  function collectSubformValue(field, node) {
    const schemas = field.schemas || [];
    const rows = $$("[data-subform-row]", node).map(rowNode => {
      const origin = Number.parseInt(rowNode.dataset.subformOrigin ?? "-1", 10);
      const existing = Number.isInteger(origin) && origin >= 0;
      const out = { __origin: existing ? origin : -1 };
      const secretSet = {};
      for (const sub of schemas) {
        const input = $$("[data-sub-field]", rowNode).find(item => item.dataset.subField === sub.key);
        if (!input) continue;
        if (sub.secret) {
          const value = input.value.trim();
          const kept = input.dataset.subSecretSet === "1";
          if (!value && !kept && sub.required) throw new Error(`「${sub.label || sub.key}」不能为空`);
          out[sub.key] = value;
          secretSet[sub.key] = kept || !!value;
          continue;
        }
        let value;
        if (sub.editor === "switch" || sub.type === "boolean") value = !!input.checked;
        else if (sub.editor === "textarea") value = input.value;
        else if (sub.options?.length) {
          value = input.value;
          if (sub.type === "number" && value !== "") value = Number(value);
        } else if (sub.type === "number") {
          const raw = input.value.trim();
          value = raw === "" ? undefined : Number(raw);
        } else value = input.value;

        if (value === undefined || value === "") {
          if (sub.required) throw new Error(`「${sub.label || sub.key}」不能为空`);
          continue;
        }
        if (sub.type === "number" && !Number.isFinite(value)) throw new Error(`「${sub.label || sub.key}」必须是数字`);
        out[sub.key] = value;
      }
      if (Object.keys(secretSet).length) out.__secretSet = secretSet;
      return out;
    });
    if (field.multiple === false) return rows[0] || { __origin: -1 };
    return rows;
  }

  function collectFieldValue(node, field) {
    const editor = field.editor;
    if (editor === "switch" || editor === "switch01") {
      const input = $('input[type="checkbox"]', node);
      const checked = !!(input && input.checked);
      return editor === "switch01" ? (checked ? 1 : 0) : checked;
    }
    if (editor === "subform") return collectSubformValue(field, node);
    if (editor === "list" || field.type === "array") {
      const tags = $$(".config-tag", node).map(tag => tag.dataset.tagValue).filter(value => value !== "");
      if (!tags.length && (field.value === null || field.value === undefined)) return field.value;
      return tags;
    }
    if (editor === "json") {
      const text = ($("textarea", node)?.value || "").trim();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch (error) {
        throw new Error("不是有效的 JSON");
      }
    }

    const input = $("input, textarea, select", node);
    if (!input) return field.value;
    if (editor === "select" || field.options?.length) {
      if (field.type === "number") return input.value === "" ? null : Number(input.value);
      if (field.type === "boolean") return input.value === "true";
      if (input.value === "" && (field.value === null || field.value === undefined)) return field.value;
      return input.value;
    }
    if (field.type === "number") {
      const raw = input.value.trim();
      if (!raw) return null;
      const number = Number(raw);
      if (!Number.isFinite(number)) throw new Error("必须是数字");
      return number;
    }
    if (input.value === "" && (field.value === null || field.value === undefined)) return field.value;
    return input.value;
  }

  function collectConfigChanges(view) {
    const detail = configDetail(view);
    const main = $(CONFIG_VIEWS[view].main);
    if (!detail || !main) return [];
    const nodes = new Map($$("[data-config-key]", main).map(node => [node.dataset.configKey, node]));
    const changes = [];
    for (const field of detail.fields || []) {
      if (field.readOnly) continue;
      const node = nodes.get(configPathKey(field));
      if (!node) continue;
      let value;
      try {
        value = collectFieldValue(node, field);
      } catch (error) {
        throw new Error(`${field.label || configPathKey(field)}：${error.message}`);
      }
      if (field.secret && (value === "" || value === null || value === undefined)) continue;
      if (configEqual(value, field.value)) continue;
      changes.push({ field, value });
    }
    return changes;
  }

  function updateConfigDirty(view) {
    const detail = configDetail(view);
    const main = $(CONFIG_VIEWS[view].main);
    if (!detail || !main) return;
    let count = 0;
    let valid = true;
    try {
      count = collectConfigChanges(view).length;
    } catch (error) {
      valid = false;
    }
    $$(`[data-config-dirty="${view}"]`, main).forEach(node => {
      node.textContent = !valid ? "有修改待校验" : count ? `${count} 项待保存` : "未修改";
      node.classList.toggle("active", !valid || count > 0);
    });
  }

  /* ----- 基础 / 其他配置 ----- */

  async function loadConfigFiles(force) {
    if (!force && state.configFiles) {
      renderConfigFileNavs();
      return state.configFiles;
    }
    const data = await api("/config/files");
    state.configFiles = data;
    renderConfigFileNavs();
    return data;
  }

  function configFilesFor(view) {
    const groups = state.configFiles?.groups || [];
    return groups.find(group => group.id === (view === "basic" ? "basic" : "other"))?.files || [];
  }

  function renderConfigFileNavs() {
    renderConfigFileNav("basic", configFilesFor("basic"), state.configBasic.name);
    renderConfigFileNav("other", configFilesFor("other"), state.configOther.name);
  }

  function renderConfigFileNav(view, files, activeName) {
    const root = $(CONFIG_VIEWS[view].nav);
    if (!root) return;
    if (!files.length) {
      root.innerHTML = '<div class="config-side-empty">没有可编辑的配置文件</div>';
      return;
    }
    root.innerHTML = files
      .map(
        file => `<button type="button" class="config-file-item ${file.name === activeName ? "active" : ""}" data-config-file="${esc(file.name)}" data-config-view="${view}">
          <span class="config-file-icon">${icon("file")}</span>
          <span class="config-file-text"><strong>${esc(file.title)}</strong><small>${esc(file.name)}.yaml · ${esc(formatConfigSize(file.size))}</small></span>
        </button>`,
      )
      .join("");
  }

  async function loadCoreConfigPage(view, force) {
    const files = await loadConfigFiles(force);
    const group = (files.groups || []).find(item => item.id === (view === "basic" ? "basic" : "other"));
    const pageState = configPageState(view);
    let name = pageState.name;
    if (!group?.files.some(file => file.name === name)) name = group?.files[0]?.name || "";
    if (!name) {
      $(CONFIG_VIEWS[view].main).innerHTML = emptyState("没有可编辑的配置", "请检查 config/config 目录。", "file");
      return null;
    }
    pageState.name = name;
    return loadCoreFile(view, name, force);
  }

  async function loadCoreFile(view, name, force) {
    const pageState = configPageState(view);
    const main = $(CONFIG_VIEWS[view].main);
    pageState.name = name;
    if (!force && pageState.detail && pageState.detail.name === name) {
      renderConfigFileNavs();
      renderCoreConfig(view);
      return pageState.detail;
    }

    renderConfigFileNavs();
    main.innerHTML = configLoadingHtml("正在加载配置…");
    try {
      pageState.detail = await api(`/config/file/${encodeURIComponent(name)}`);
      renderCoreConfig(view);
      return pageState.detail;
    } catch (error) {
      main.innerHTML = configErrorHtml(error, view);
      throw error;
    }
  }

  function renderCoreConfig(view) {
    const detail = configDetail(view);
    const main = $(CONFIG_VIEWS[view].main);
    if (!detail || !main) return;
    main.innerHTML = configPanelHtml(detail, view);
    updateConfigDirty(view);
  }

/* ----- 帮助面板 ----- */

  const HELP_MAIN_KEYS = new Set(["title", "subTitle", "colCount", "colWidth", "bgBlur", "tableBorder", "footer"])
  const HELP_THEME_KEYS = new Set(["theme", "themeExclude"])
  const HELP_ICON_MAX_BYTES = 1024 * 1024
  const HELP_THEME_MAX_BYTES = 6 * 1024 * 1024
  const HELP_ASSET_ICON_RE = /help-asset:icon\/([a-zA-Z0-9._-]+)/g
  const HELP_COLOR_PRESETS = {
    accentColor: ["#c8a96b", "#e8c37a", "#7aa2ff", "#6fd3c7", "#c792ea", "#ff9aa2", "#ffd166", "#9be15d"],
    fontColor: ["#ffffff", "#f2e6cf", "#e6e9f0", "#d9c7a3", "#cfe3ff", "#ffe9a8", "#ffd7d7", "#d6ffe8"],
    descColor: ["#c3c9d4", "#9aa4b4", "#8fa3b8", "#b0a48f", "#8fc7a8", "#c9a8a8", "#a8a2c9", "#7f8b9e"],
    contBgColor: [
      "rgba(24, 29, 38, 0.5)",
      "rgba(24, 29, 38, 0.72)",
      "rgba(24, 29, 38, 0.86)",
      "rgba(12, 18, 26, 0.66)",
      "rgba(34, 24, 28, 0.72)",
      "rgba(16, 28, 24, 0.7)",
    ],
    headerBgColor: [
      "rgba(255, 255, 255, 0.05)",
      "rgba(255, 255, 255, 0.1)",
      "rgba(0, 0, 0, 0.18)",
      "rgba(122, 162, 255, 0.16)",
      "rgba(200, 169, 107, 0.18)",
    ],
    rowBgColor1: ["rgba(255, 255, 255, 0.03)", "rgba(255, 255, 255, 0.06)", "rgba(0, 0, 0, 0.12)", "rgba(0, 0, 0, 0.05)", "transparent"],
    rowBgColor2: ["rgba(255, 255, 255, 0.008)", "rgba(255, 255, 255, 0.02)", "rgba(0, 0, 0, 0.05)", "rgba(0, 0, 0, 0.02)", "transparent"],
  }
  const HELP_SHADOW_PRESETS = [
    { label: "无", value: "none" },
    { label: "清晰", value: "0 1px 2px rgba(0, 0, 0, 0.85)" },
    { label: "柔和", value: "0 1px 6px rgba(0, 0, 0, 0.45)" },
    { label: "发光", value: "0 0 12px rgba(0, 0, 0, 0.9)" },
    { label: "描边", value: "0 0 1px rgba(0, 0, 0, 1), 0 1px 1px rgba(0, 0, 0, 1)" },
  ]
  const HELP_ICON_EMOJIS = [
    "📖", "🔎", "🎭", "🖥", "💬", "🧠", "📚", "🛠", "🌊", "🌪", "👉", "🔇", "🔊", "🧩", "🎛", "⚙️",
    "🔧", "🧭", "📌", "📎", "📝", "✉️", "📢", "🔔", "⏰", "📊", "🎨", "🎮", "🎵", "📷", "🖼️", "🌟",
    "✨", "🔥", "⚡", "💡", "🚀", "🛡️", "🔒", "🔑", "👤", "👥", "🤖", "🪄", "💾", "☁️", "🌐", "✅",
  ]

  function helpDraftFrom(detail) {
    const helpCfg = {}
    for (const field of detail?.fields || []) {
      if (!Array.isArray(field.path) || field.path[0] !== "helpCfg") continue
      helpCfg[field.path[1]] = field.value
    }
    const listField = (detail?.fields || []).find(field => configPathKey(field) === "helpList")
    const helpList = Array.isArray(listField?.value) ? listField.value : []
    return { helpCfg, helpList: JSON.parse(JSON.stringify(helpList)) }
  }

  function helpThemeList() {
    return (state.helpPanel.themes || []).map(item => (typeof item === "string" ? { name: item } : item))
  }

  function helpThemeNames() {
    return helpThemeList()
      .map(theme => theme.name)
      .filter(Boolean)
  }

  function helpThemeLabel(theme) {
    return theme.label || theme.name
  }

  function helpThemeListOf(value) {
    if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
    const text = String(value ?? "").trim()
    if (!text || text.toLowerCase() === "all") return []
    return text
      .split(",")
      .map(item => item.trim())
      .filter(Boolean)
  }

  function helpThemeMode(value) {
    const text = Array.isArray(value) ? value.join(",") : String(value ?? "").trim()
    return !text || text.toLowerCase() === "all" ? "all" : "selected"
  }

  function helpSetThemeMode(mode) {
    const hp = state.helpPanel
    if (!hp.draft) return
    if (mode === "all") hp.draft.helpCfg.theme = "all"
    else {
      const selected = helpThemeListOf(hp.draft.helpCfg.theme)
      const names = helpThemeNames()
      hp.draft.helpCfg.theme = (selected.length ? selected : names.slice(0, 1)).join(",")
    }
  }

  function helpToggleTheme(name) {
    const hp = state.helpPanel
    const selected = helpThemeListOf(hp.draft.helpCfg.theme)
    const next = selected.includes(name) ? selected.filter(item => item !== name) : [...selected, name]
    hp.draft.helpCfg.theme = next.length ? next.join(",") : "all"
  }

  function helpToggleThemeExclude(name) {
    const hp = state.helpPanel
    const current = Array.isArray(hp.draft.helpCfg.themeExclude) ? hp.draft.helpCfg.themeExclude : []
    hp.draft.helpCfg.themeExclude = current.includes(name)
      ? current.filter(item => item !== name)
      : [...current, name]
  }

  function helpUpdatesFromDraft() {
    const hp = state.helpPanel
    const updates = []
    for (const field of hp.detail?.fields || []) {
      if (!Array.isArray(field.path) || field.path[0] !== "helpCfg") continue
      let value = hp.draft.helpCfg[field.path[1]]
      if (field.type === "number") value = helpNumber(value, field.defaultValue ?? 0)
      else if (field.type === "boolean") value = value !== false
      else if (field.type === "array") value = Array.isArray(value) ? value : []
      else if (typeof value === "string") value = value.trim()
      else if (value === undefined || value === null) value = ""
      updates.push({ path: field.path, value })
    }
    updates.push({ path: ["helpList"], value: hp.draft.helpList })
    return updates
  }

  function helpIsDirty() {
    const hp = state.helpPanel
    if (!hp.snapshot || !hp.draft) return false
    return JSON.stringify(helpUpdatesFromDraft()) !== hp.snapshot
  }

  function helpClampSelection() {
    const hp = state.helpPanel
    const groups = hp.draft?.helpList || []
    hp.selection.group = Math.min(Math.max(0, hp.selection.group), Math.max(0, groups.length - 1))
    const list = groups[hp.selection.group]?.list || []
    hp.selection.item = Math.min(Math.max(0, hp.selection.item), Math.max(0, list.length - 1))
  }

  function helpPanelSnapshot(detail, themes, icons) {
    return {
      detail,
      themes: Array.isArray(themes?.themes) ? themes.themes : [],
      icons: (icons?.icons || []).map(info => info?.name).filter(Boolean),
      at: Date.now(),
    };
  }

  function fetchHelpPanelData() {
    return Promise.all([api("/config/file/help"), api("/help/themes"), api("/help/icons")]).then(
      ([detail, themes, icons]) => helpPanelSnapshot(detail, themes, icons),
    );
  }

  /** 仪表盘空闲后先把帮助面板数据取回来，点开时不再等网络 */
  function prefetchHelpPanel() {
    const hp = state.helpPanel;
    if (hp.detail) return Promise.resolve(null);
    if (hp.preload) return Promise.resolve(hp.preload);
    if (!hp.preloadPromise) {
      hp.preloadPromise = fetchHelpPanelData()
        .then(data => {
          hp.preload = data;
          return data;
        })
        .catch(error => {
          hp.preloadPromise = null;
          throw error;
        });
    }
    return hp.preloadPromise;
  }

  async function loadHelpPanel(force) {
    const hp = state.helpPanel;
    const cfgBox = $("#helpCfgBody")
    if (!cfgBox) return null
    if (!force && hp.detail && hp.draft) {
      renderHelpPanelPage()
      return hp.detail
    }
    cfgBox.innerHTML = configLoadingHtml("正在加载帮助面板配置…")
    const dialogBody = $("#helpContentBody")
    if (dialogBody) dialogBody.innerHTML = configLoadingHtml("正在加载帮助配置…")
    try {
      let data = !force && hp.preload ? hp.preload : null;
      if (!data && !force && hp.preloadPromise) {
        data = await hp.preloadPromise.catch(() => null);
      }
      if (!data) data = await fetchHelpPanelData();
      hp.preload = data;
      hp.detail = data.detail;
      hp.themes = data.themes;
      hp.icons = {};
      hp.iconMisses = new Set();
      for (const name of data.icons) hp.icons[name] = helpIconUrl(name);
      hp.draft = helpDraftFrom(hp.detail);
      hp.snapshot = JSON.stringify(helpUpdatesFromDraft());
      hp.previewTheme = "";
      helpClampSelection();
      renderHelpPanelPage();
      renderHelpContentDialog();
      await refreshHelpPreview({ reset: true });
      return hp.detail;
    } catch (error) {
      cfgBox.innerHTML = configErrorHtml(error, "help-panel");
      if (dialogBody) dialogBody.innerHTML = "";
      throw error;
    }
  }

  function renderHelpPanelPage() {
    const hp = state.helpPanel
    if (!hp.draft || !hp.detail) return
    const fields = (hp.detail.fields || []).filter(field => Array.isArray(field.path) && field.path[0] === "helpCfg")
    const mainFields = fields.filter(field => HELP_MAIN_KEYS.has(field.path[1]))
    const styleFields = fields.filter(
      field => !HELP_MAIN_KEYS.has(field.path[1]) && !HELP_THEME_KEYS.has(field.path[1]),
    )
    const hasStyle = styleFields.some(field => String(hp.draft.helpCfg[field.path[1]] ?? "").trim())
    $("#helpCfgBody").innerHTML = `<div class="config-fields">${mainFields.map(helpFieldHtml).join("")}</div>
      ${helpThemeBlockHtml()}
      ${
        styleFields.length
          ? `<details class="help-details" ${hasStyle ? "open" : ""}>
              <summary>颜色与细节</summary>
              <div class="config-fields">${styleFields.map(helpFieldHtml).join("")}</div>
            </details>`
          : ""
      }`
    ;["helpSave", "helpRollback", "helpSkin", "helpBackup"].forEach(id => {
      const button = $(`#${id}`)
      if (button) button.disabled = !state.allowWrite
    })
  }

  function helpFieldHtml(field) {
    const key = field.path[1]
    const value = state.helpPanel.draft.helpCfg[key]
    const disabled = !state.allowWrite
    const help = field.help && field.help !== field.label ? field.help : ""
    let control

    if (key === "colCount") {
      control = `<div class="help-col-seg">${[2, 3, 4, 5]
        .map(
          count =>
            `<button type="button" class="help-col-option ${Number(value) === count ? "active" : ""}" data-help-col="${count}" ${
              disabled ? "disabled" : ""
            }>${count}</button>`,
        )
        .join("")}</div>`
    } else if (field.type === "boolean") {
      const checked = value !== false
      control = `<label class="switch">
        <input type="checkbox" data-help-cfg="${esc(key)}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} />
        <span class="track"></span>
        <span class="config-switch-text">${checked ? "开启" : "关闭"}</span>
      </label>`
    } else if (field.type === "number") {
      const min = key === "colWidth" ? 100 : ""
      const max = key === "colWidth" ? 500 : ""
      control = `<input class="config-input" type="number" step="1" ${min === "" ? "" : `min="${min}"`} ${
        max === "" ? "" : `max="${max}"`
      } data-help-cfg="${esc(key)}" value="${esc(value ?? "")}" ${disabled ? "disabled" : ""} />`
    } else {
      const placeholder = field.defaultValue ? `默认：${field.defaultValue}` : ""
      control = `<input class="config-input" data-help-cfg="${esc(key)}" value="${esc(value ?? "")}" placeholder="${esc(
        placeholder,
      )}" ${disabled ? "disabled" : ""} />`
    }

    return `<div class="config-field" data-help-field="${esc(configPathKey(field))}">
      <div class="config-label"><span>${esc(field.label || key)}</span></div>
      ${help ? `<div class="config-help">${esc(help)}</div>` : ""}
      ${control}
      ${helpPresetHtml(key, value, disabled)}
    </div>`
  }

  function helpPresetHtml(key, value, disabled) {
    const current = String(value ?? "").trim()
    const colors = HELP_COLOR_PRESETS[key]
    if (colors) {
      return `<div class="help-swatches">${colors
        .map(color => {
          const active = current.toLowerCase() === color.toLowerCase()
          return `<button type="button" class="help-swatch ${active ? "active" : ""}" style="background-color:${color}" title="${esc(
            color,
          )}" data-help-preset="${esc(key)}" data-help-value="${esc(color)}" ${disabled ? "disabled" : ""}></button>`
        })
        .join("")}</div>`
    }
    if (key === "fontShadow" || key === "descShadow") {
      return `<div class="help-presets">${HELP_SHADOW_PRESETS.map(item => {
        const active = current === item.value
        return `<button type="button" class="help-preset ${active ? "active" : ""}" data-help-preset="${esc(
          key,
        )}" data-help-value="${esc(item.value)}" ${disabled ? "disabled" : ""}>${esc(item.label)}</button>`
      }).join("")}</div>`
    }
    return ""
  }

  function helpThemeBlockHtml() {
    const hp = state.helpPanel
    const mode = helpThemeMode(hp.draft.helpCfg.theme)
    const selected = helpThemeListOf(hp.draft.helpCfg.theme)
    const excluded = Array.isArray(hp.draft.helpCfg.themeExclude) ? hp.draft.helpCfg.themeExclude : []
    const themes = helpThemeList()
    const disabled = !state.allowWrite
    const chips = themes
      .map(
        theme =>
          `<button type="button" class="help-chip ${
            selected.includes(theme.name) ? "active" : ""
          }" title="${esc(theme.name)}" data-help-theme-toggle="${esc(theme.name)}" ${
            disabled ? "disabled" : ""
          }>${esc(helpThemeLabel(theme))}</button>`,
      )
      .join("")
    const excludeChips = themes
      .map(
        theme =>
          `<button type="button" class="help-chip ${
            excluded.includes(theme.name) ? "active" : ""
          }" title="${esc(theme.name)}" data-help-theme-exclude="${esc(theme.name)}" ${
            disabled ? "disabled" : ""
          }>${esc(helpThemeLabel(theme))}</button>`,
      )
      .join("")
    return `<div class="help-theme-block">
      <div class="config-field">
        <div class="config-label"><span>指定皮肤</span></div>
        <div class="config-help">关闭时随机使用全部皮肤。</div>
        <label class="switch">
          <input type="checkbox" data-help-theme-mode ${mode === "selected" ? "checked" : ""} ${
            disabled ? "disabled" : ""
          } />
          <span class="track"></span>
          <span class="config-switch-text">${mode === "selected" ? "指定" : "随机全部"}</span>
        </label>
      </div>
      ${
        mode === "selected"
          ? `<div class="config-field">
              <div class="config-label"><span>皮肤</span></div>
              <div class="config-help">选中后按顺序随机展示，可多选。</div>
              <div class="help-theme-chips">${chips || '<span class="muted">暂无可用皮肤</span>'}</div>
            </div>`
          : ""
      }
      <div class="config-field">
        <div class="config-label"><span>排除皮肤</span></div>
        <div class="config-help">随机时忽略这些皮肤。</div>
        <div class="help-theme-chips">${excludeChips || '<span class="muted">暂无可用皮肤</span>'}</div>
      </div>
    </div>`
  }

  function renderHelpContentDialog() {
    const hp = state.helpPanel
    const body = $("#helpContentBody")
    if (!body || !hp.draft) return
    helpClampSelection()
    const groups = hp.draft.helpList
    const disabled = !state.allowWrite
    if (!groups.length) {
      body.innerHTML = `<div class="help-empty">还没有分组。</div>
        <div class="help-dialog-actions">
          <button class="btn btn-primary btn-sm" type="button" data-help-add-group ${disabled ? "disabled" : ""}>添加分组</button>
        </div>`
      return
    }

    const groupIndex = hp.selection.group
    const group = groups[groupIndex] || {}
    const items = Array.isArray(group.list) ? group.list : []
    const itemIndex = hp.selection.item
    const item = items[itemIndex] || null
    const auth = String(group.auth || "").toLowerCase()
    const masterOnly = auth === "master" || auth === "admin"
    const groupOptions = groups
      .map(
        (entry, index) =>
          `<option value="${index}" ${index === groupIndex ? "selected" : ""}>${esc(
            entry.group || entry.name || `分组 ${index + 1}`,
          )}</option>`,
      )
      .join("")
    const itemOptions = items
      .map(
        (entry, index) =>
          `<option value="${index}" ${index === itemIndex ? "selected" : ""}>${esc(
            entry.title || `项目 ${index + 1}`,
          )}</option>`,
      )
      .join("")

    body.innerHTML = `<div class="help-dialog-block">
        <div class="help-dialog-row">
          <span class="help-dialog-label">分组</span>
          <select class="config-input" data-help-group-select ${disabled ? "disabled" : ""}>${groupOptions}</select>
          <div class="help-actions">
            <button class="btn btn-ghost" type="button" data-help-group-shift="-1" title="上移分组" ${
              disabled || groupIndex === 0 ? "disabled" : ""
            }>↑</button>
            <button class="btn btn-ghost" type="button" data-help-group-shift="1" title="下移分组" ${
              disabled || groupIndex === groups.length - 1 ? "disabled" : ""
            }>↓</button>
          </div>
        </div>
        <div class="help-dialog-row">
          <label class="switch help-master-switch" title="仅主人可见">
            <input type="checkbox" data-help-group-auth ${masterOnly ? "checked" : ""} ${disabled ? "disabled" : ""} />
            <span class="track"></span>
            <span class="config-switch-text">仅主人可见</span>
          </label>
          <span class="help-dialog-spacer"></span>
          <button class="btn btn-outline btn-sm" type="button" data-help-add-group ${disabled ? "disabled" : ""}>添加分组</button>
          <button class="btn btn-outline btn-sm help-danger" type="button" data-help-remove-group ${
            disabled ? "disabled" : ""
          }>删除该组</button>
        </div>
        <input class="config-input" data-help-group-name value="${esc(
          group.group || group.name || "",
        )}" placeholder="分组标题" ${disabled ? "disabled" : ""} />
        <input class="config-input" data-help-group-desc value="${esc(
          group.desc || "",
        )}" placeholder="分组描述（可选）" ${disabled ? "disabled" : ""} />
      </div>
      <div class="help-dialog-divider"></div>
      ${
        items.length
          ? `<div class="help-dialog-block">
              <div class="help-dialog-row">
                <span class="help-dialog-label">项目</span>
                <select class="config-input" data-help-item-select ${disabled ? "disabled" : ""}>${itemOptions}</select>
                <div class="help-actions">
                  <button class="btn btn-ghost" type="button" data-help-item-shift="-1" title="左移" ${
                    disabled || itemIndex === 0 ? "disabled" : ""
                  }>←</button>
                  <button class="btn btn-ghost" type="button" data-help-item-shift="1" title="右移" ${
                    disabled || itemIndex === items.length - 1 ? "disabled" : ""
                  }>→</button>
                </div>
              </div>
              <div class="help-dialog-item">
                <button class="help-icon-btn" type="button" data-help-icon title="选择或上传图标" ${
                  disabled ? "disabled" : ""
                }>${helpIconInner(item?.icon)}</button>
                <input class="config-input" data-help-item-title value="${esc(
                  item?.title || "",
                )}" placeholder="名称" ${disabled ? "disabled" : ""} />
                <input class="config-input" data-help-item-desc value="${esc(
                  item?.desc || "",
                )}" placeholder="说明" ${disabled ? "disabled" : ""} />
              </div>
              <div class="help-dialog-row help-dialog-row-end">
                <button class="btn btn-outline btn-sm" type="button" data-help-add-item ${disabled ? "disabled" : ""}>添加项目</button>
                <button class="btn btn-outline btn-sm help-danger" type="button" data-help-remove-item ${
                  disabled ? "disabled" : ""
                }>删除该项</button>
              </div>
            </div>`
          : `<div class="help-dialog-block">
              <div class="help-empty">该分组还没有项目。</div>
              <div class="help-dialog-row help-dialog-row-end">
                <button class="btn btn-outline btn-sm" type="button" data-help-add-item ${disabled ? "disabled" : ""}>添加项目</button>
              </div>
            </div>`
      }`
  }

  function helpIconInner(value) {
    const text = String(value ?? "").trim()
    if (!text) return '<span class="help-icon-empty">＋</span>'
    if (/^(https?:\/\/|data:image\/)/i.test(text)) return `<img src="${esc(text)}" alt="" />`
    const match = /^icon:([a-zA-Z0-9._-]+)$/.exec(text)
    if (match) {
      const url = state.helpPanel.icons?.[match[1]]
      return url ? `<img src="${esc(url)}" alt="" />` : '<span class="help-icon-empty">🖼</span>'
    }
    return `<span class="help-icon-text">${esc(Array.from(text).slice(0, 4).join(""))}</span>`
  }

  function helpNumber(value, fallback) {
    const number = Number(value)
    return Number.isFinite(number) ? number : fallback
  }

  function moveHelpEntry(list, from, dir) {
    const to = from + dir
    if (!Array.isArray(list) || to < 0 || to >= list.length) return
    const [entry] = list.splice(from, 1)
    list.splice(to, 0, entry)
  }

  function onHelpPanelInput(event) {
    const hp = state.helpPanel
    if (!hp.draft) return
    const target = event.target

    if (target.closest("[data-help-theme-mode]")) {
      helpSetThemeMode(target.checked ? "selected" : "all")
      hp.previewTheme = ""
      renderHelpPanelPage()
      scheduleHelpPreview(0)
      return
    }
    if (target.closest("[data-help-group-auth]")) {
      const group = hp.draft.helpList[hp.selection.group]
      if (group) {
        if (target.checked) group.auth = "master"
        else delete group.auth
      }
      scheduleHelpPreview()
      return
    }
    const cfgEl = target.closest("[data-help-cfg]")
    if (cfgEl) {
      const key = cfgEl.dataset.helpCfg
      let value
      if (cfgEl.type === "checkbox") value = cfgEl.checked
      else if (cfgEl.type === "number") value = helpNumber(cfgEl.value, hp.draft.helpCfg[key])
      else value = cfgEl.value
      hp.draft.helpCfg[key] = value
      const text = cfgEl.closest(".switch")?.querySelector(".config-switch-text")
      if (text) text.textContent = cfgEl.checked ? "开启" : "关闭"
      const presetBox = cfgEl.closest(".config-field")?.querySelector(".help-swatches, .help-presets")
      if (presetBox) {
        const current = String(value ?? "").trim()
        presetBox.querySelectorAll("[data-help-preset]").forEach(button => {
          button.classList.toggle("active", button.dataset.helpValue === current)
        })
      }
      scheduleHelpPreview()
      return
    }
    if (target.closest("[data-help-group-select]")) {
      hp.selection.group = Number(target.value) || 0
      hp.selection.item = 0
      renderHelpContentDialog()
      return
    }
    if (target.closest("[data-help-item-select]")) {
      hp.selection.item = Number(target.value) || 0
      renderHelpContentDialog()
      return
    }
    if (target.closest("[data-help-group-name]")) {
      const group = hp.draft.helpList[hp.selection.group]
      if (group) group.group = target.value
      scheduleHelpPreview()
      return
    }
    if (target.closest("[data-help-group-desc]")) {
      const group = hp.draft.helpList[hp.selection.group]
      if (group) group.desc = target.value
      scheduleHelpPreview()
      return
    }
    if (target.closest("[data-help-item-title]")) {
      const item = hp.draft.helpList[hp.selection.group]?.list?.[hp.selection.item]
      if (item) item.title = target.value
      scheduleHelpPreview()
      return
    }
    if (target.closest("[data-help-item-desc]")) {
      const item = hp.draft.helpList[hp.selection.group]?.list?.[hp.selection.item]
      if (item) item.desc = target.value
      scheduleHelpPreview()
    }
  }

  async function onHelpPanelClick(event) {
    const hp = state.helpPanel
    if (!hp.draft) return
    const target = event.target

    if (target.closest("#helpAdvanced")) return setHelpDrawer(!hp.advancedOpen)
    if (target.closest("[data-help-drawer-close]")) return setHelpDrawer(false)
    if (target.closest("[data-help-dialog-close]")) return closeHelpContentDialog()

    if (!state.allowWrite) return

    if (target.closest("#helpSave")) return saveHelpPanel($("#helpSave"))
    if (target.closest("#helpRollback")) return rollbackHelpPanel()
    if (target.closest("#helpSkin")) return openHelpSkinModal()
    if (target.closest("#helpBackup")) return openHelpBackupModal()

    const preset = target.closest("[data-help-preset]")
    if (preset) {
      const key = preset.dataset.helpPreset
      const value = preset.dataset.helpValue
      if (!key) return
      hp.draft.helpCfg[key] = value
      const input = $("#helpCfgBody")?.querySelector(`[data-help-cfg="${key}"]`)
      if (input) input.value = value
      preset.closest(".help-swatches, .help-presets")?.querySelectorAll("[data-help-preset]").forEach(button => {
        button.classList.toggle("active", button === preset)
      })
      scheduleHelpPreview(0)
      return
    }

    const colButton = target.closest("[data-help-col]")
    if (colButton) {
      hp.draft.helpCfg.colCount = Number(colButton.dataset.helpCol) || 3
      renderHelpPanelPage()
      scheduleHelpPreview(0)
      return
    }

    const themeToggle = target.closest("[data-help-theme-toggle]")
    if (themeToggle) {
      helpToggleTheme(themeToggle.dataset.helpThemeToggle)
      hp.previewTheme = ""
      renderHelpPanelPage()
      scheduleHelpPreview(0)
      return
    }

    const themeExclude = target.closest("[data-help-theme-exclude]")
    if (themeExclude) {
      helpToggleThemeExclude(themeExclude.dataset.helpThemeExclude)
      hp.previewTheme = ""
      renderHelpPanelPage()
      scheduleHelpPreview(0)
      return
    }

    if (target.closest("[data-help-add-group]")) {
      hp.draft.helpList.push({ group: "新分组", desc: "", list: [] })
      hp.selection.group = hp.draft.helpList.length - 1
      hp.selection.item = 0
      renderHelpContentDialog()
      scheduleHelpPreview(0)
      return
    }

    if (target.closest("[data-help-remove-group]")) {
      const group = hp.draft.helpList[hp.selection.group]
      if (!group) return
      const name = group.group || group.name || `分组 ${hp.selection.group + 1}`
      const ok = await confirmDialog({
        title: "删除分组",
        message: `确定删除「${name}」及其全部项目吗？保存后生效。`,
        danger: true,
        confirmText: "删除",
      })
      if (!ok) return
      hp.draft.helpList.splice(hp.selection.group, 1)
      hp.selection.group = Math.max(0, hp.selection.group - 1)
      hp.selection.item = 0
      renderHelpContentDialog()
      scheduleHelpPreview(0)
      return
    }

    const groupShift = target.closest("[data-help-group-shift]")
    if (groupShift) {
      const dir = Number(groupShift.dataset.helpGroupShift)
      const from = hp.selection.group
      moveHelpEntry(hp.draft.helpList, from, dir)
      hp.selection.group = Math.min(Math.max(0, from + dir), hp.draft.helpList.length - 1)
      renderHelpContentDialog()
      scheduleHelpPreview(0)
      return
    }

    if (target.closest("[data-help-add-item]")) {
      const group = hp.draft.helpList[hp.selection.group]
      if (!group) return
      if (!Array.isArray(group.list)) group.list = []
      group.list.push({ icon: "", title: "", desc: "" })
      hp.selection.item = group.list.length - 1
      renderHelpContentDialog()
      scheduleHelpPreview(0)
      return
    }

    if (target.closest("[data-help-remove-item]")) {
      const list = hp.draft.helpList[hp.selection.group]?.list
      if (!Array.isArray(list) || !list.length) return
      list.splice(hp.selection.item, 1)
      hp.selection.item = Math.max(0, hp.selection.item - 1)
      renderHelpContentDialog()
      scheduleHelpPreview(0)
      return
    }

    const itemShift = target.closest("[data-help-item-shift]")
    if (itemShift) {
      const dir = Number(itemShift.dataset.helpItemShift)
      const list = hp.draft.helpList[hp.selection.group]?.list
      if (!Array.isArray(list)) return
      const from = hp.selection.item
      moveHelpEntry(list, from, dir)
      hp.selection.item = Math.min(Math.max(0, from + dir), list.length - 1)
      renderHelpContentDialog()
      scheduleHelpPreview(0)
      return
    }

    if (target.closest("[data-help-icon]")) openHelpIconModal()
  }

  function openHelpContentDialog(groupIndex, itemIndex) {
    const hp = state.helpPanel
    if (!hp.draft) return
    if (Number.isFinite(groupIndex)) hp.selection.group = groupIndex
    if (Number.isFinite(itemIndex)) hp.selection.item = itemIndex
    const dialog = $("#helpContentDialog")
    if (!dialog) return
    if (dialog.hidden) {
      dialog.hidden = false
      dialog.style.left = ""
      dialog.style.top = ""
      dialog.style.transform = ""
      dialog.classList.remove("is-dragging")
    }
    hp.dialogOpen = true
    renderHelpContentDialog()
  }

  function closeHelpContentDialog() {
    const dialog = $("#helpContentDialog")
    if (dialog) dialog.hidden = true
    state.helpPanel.dialogOpen = false
  }

  function setHelpDrawer(open) {
    const drawer = $("#helpAdvancedDrawer")
    if (!drawer) return
    drawer.hidden = !open
    state.helpPanel.advancedOpen = !!open
  }

  function setupHelpDialogDrag() {
    const dialog = $("#helpContentDialog")
    const handle = $("#helpDialogDrag")
    if (!dialog || !handle || handle.dataset.bound) return
    handle.dataset.bound = "1"
    let dragging = false
    let startX = 0
    let startY = 0
    let startLeft = 0
    let startTop = 0

    handle.addEventListener("pointerdown", event => {
      if (event.target.closest("button")) return
      const stage = $("#helpStage")
      if (!stage) return
      const stageRect = stage.getBoundingClientRect()
      const rect = dialog.getBoundingClientRect()
      startLeft = rect.left - stageRect.left
      startTop = rect.top - stageRect.top
      startX = event.clientX
      startY = event.clientY
      dragging = true
      dialog.classList.add("is-dragging")
      dialog.style.left = `${startLeft}px`
      dialog.style.top = `${startTop}px`
      dialog.style.transform = "none"
      handle.setPointerCapture(event.pointerId)
    })
    handle.addEventListener("pointermove", event => {
      if (!dragging) return
      const stage = $("#helpStage")
      if (!stage) return
      const maxLeft = Math.max(0, stage.clientWidth - dialog.offsetWidth)
      const maxTop = Math.max(0, stage.clientHeight - dialog.offsetHeight)
      dialog.style.left = `${Math.min(Math.max(0, startLeft + event.clientX - startX), maxLeft)}px`
      dialog.style.top = `${Math.min(Math.max(0, startTop + event.clientY - startY), maxTop)}px`
    })
    const end = () => {
      dragging = false
      dialog.classList.remove("is-dragging")
    }
    handle.addEventListener("pointerup", end)
    handle.addEventListener("pointercancel", end)
  }

  function setupHelpStage() {
    const stage = $("#helpStage")
    if (!stage || stage.dataset.bound) return
    stage.dataset.bound = "1"
    setupHelpDialogDrag()
    const drawer = $("#helpAdvancedDrawer")
    if (drawer && drawer.parentElement !== document.body) {
      document.body.appendChild(drawer)
      drawer.addEventListener("click", onHelpPanelClick)
      drawer.addEventListener("input", onHelpPanelInput)
      drawer.addEventListener("change", onHelpPanelInput)
    }
    window.addEventListener("message", event => {
      const frame = $("#helpLiveFrame")
      if (!frame || event.source !== frame.contentWindow) return
      const data = event.data || {}
      if (data.type === "help-preview-size") {
        const width = Number(data.width)
        const height = Number(data.height)
        if (width > 0 && height > 0) helpFrameScale(width, height)
        return
      }
      if (data.type === "help-preview-edit" && state.helpPanel.draft) {
        openHelpContentDialog(
          Math.max(0, Number(data.group) || 0),
          data.item === null || data.item === undefined ? 0 : Math.max(0, Number(data.item) || 0),
        )
      }
    })
    window.addEventListener("resize", () => {
      const frame = state.helpPanel.frame
      if (frame) helpFrameScale(frame.width, frame.height)
    })
  }

  async function rollbackHelpPanel() {
    const hp = state.helpPanel
    if (!hp.detail || !hp.draft) return
    if (!helpIsDirty()) return toast("没有未保存的修改", "info")
    const ok = await confirmDialog({
      title: "回滚修改",
      message: "放弃所有未保存的修改，恢复到已保存的帮助配置？",
      danger: true,
      confirmText: "回滚",
    })
    if (!ok) return
    hp.draft = helpDraftFrom(hp.detail)
    hp.snapshot = JSON.stringify(helpUpdatesFromDraft())
    hp.previewTheme = ""
    helpClampSelection()
    renderHelpPanelPage()
    renderHelpContentDialog()
    await refreshHelpPreview({ reset: true })
    toast("已回滚到已保存配置", "success", "回滚完成")
  }

  function helpSkinPanelHtml() {
    const hp = state.helpPanel
    const mode = helpThemeMode(hp.draft.helpCfg.theme)
    const selected = helpThemeListOf(hp.draft.helpCfg.theme)
    const excluded = Array.isArray(hp.draft.helpCfg.themeExclude) ? hp.draft.helpCfg.themeExclude : []
    const cards = helpThemeList()
      .map(theme => {
        const style = theme.style || {}
        const accent = style.accentColor || "#c8a96b"
        const thumb = helpThemeThumbUrl(theme)
        const cardStyle = [
          `--theme-accent:${accent}`,
          `--theme-title:${style.fontColor || "#f2e6cf"}`,
          `background:${style.contBgColor || "#171d27"}`,
          `background-image:linear-gradient(160deg, rgba(10, 12, 18, .35), rgba(10, 12, 18, .7)), ${
            thumb ? `url('${thumb}')` : "none"
          }`,
          "background-size:cover",
          "background-position:center",
        ].join(";")
        const isSelected = mode === "selected" && selected.includes(theme.name)
        const isExcluded = excluded.includes(theme.name)
        return `<div class="help-theme-card ${isSelected ? "selected" : ""}" style="${esc(cardStyle)}">
          <button type="button" class="help-theme-pick" title="${esc(theme.name)}" data-help-skin-pick="${esc(
            theme.name,
          )}">
            <span class="help-theme-sample"><span class="help-theme-sample-title">帮助</span><span class="help-theme-sample-bar"></span></span>
            <span class="help-theme-name">${esc(helpThemeLabel(theme))}</span>
            <span class="help-theme-state">${theme.custom ? "自定义皮肤" : mode === "all" ? "随机使用" : isSelected ? "已选用" : "点击选用"}</span>
          </button>
          <button type="button" class="help-theme-exclude ${isExcluded ? "active" : ""}" data-help-skin-exclude="${esc(
            theme.name,
          )}">${isExcluded ? "已排除随机" : "排除随机"}</button>
          ${
            theme.custom
              ? `<button type="button" class="help-theme-delete" data-help-skin-delete="${esc(
                  theme.name,
                )}">删除皮肤</button>`
              : ""
          }
        </div>`
      })
      .join("")
    return `<div class="help-skin-modes">
        <button type="button" class="help-chip ${mode === "all" ? "active" : ""}" data-help-skin-all>随机全部皮肤</button>
        <span class="muted">排除项仅在随机全部时生效；修改保存后生效</span>
      </div>
      <div class="help-theme-grid">${cards || '<div class="help-empty">暂无可用皮肤</div>'}</div>`
  }

  function helpThemeThumbBlob(file) {
    return new Promise(resolve => {
      const url = URL.createObjectURL(file)
      const image = new Image()
      image.onload = () => {
        try {
          const scale = Math.min(1, 640 / Math.max(image.width, image.height))
          const canvas = document.createElement("canvas")
          canvas.width = Math.max(1, Math.round(image.width * scale))
          canvas.height = Math.max(1, Math.round(image.height * scale))
          canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height)
          canvas.toBlob(blob => resolve(blob), "image/jpeg", 0.82)
        } catch {
          resolve(null)
        } finally {
          URL.revokeObjectURL(url)
        }
      }
      image.onerror = () => {
        URL.revokeObjectURL(url)
        resolve(null)
      }
      image.src = url
    })
  }

  async function uploadHelpTheme(file) {
    const hp = state.helpPanel
    const mime = file.type || (/\.png$/i.test(file.name) ? "image/png" : /\.webp$/i.test(file.name) ? "image/webp" : "image/jpeg")
    const result = await api("/help/theme", {
      method: "POST",
      headers: { "Content-Type": mime, "X-Help-Theme-Label": encodeURIComponent(file.name) },
      rawBody: file,
    })
    const name = String(result?.value || "")
    if (!name) throw new Error("皮肤上传失败")
    const thumb = await helpThemeThumbBlob(file)
    if (thumb) {
      await api(`/help/theme/thumb?name=${encodeURIComponent(name)}`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        rawBody: thumb,
      }).catch(() => {})
    }
    const themes = await api("/help/themes").catch(() => null)
    if (themes?.themes) hp.themes = themes.themes
    else if (!helpThemeList().some(theme => theme.name === name))
      hp.themes = [...helpThemeList(), result.theme || { name, label: file.name, custom: true }]
    return result.theme || { name, label: file.name, custom: true }
  }

  function openHelpSkinModal() {
    const hp = state.helpPanel
    if (!hp.draft) return
    const modal = openModal({
      title: "皮肤",
      subtitle: "选择随机全部，或指定使用其中几个皮肤",
      width: "wide",
      body: `<div class="help-skin-upload">
          <label class="btn btn-outline btn-sm" for="helpSkinUpload">上传背景图</label>
          <input type="file" id="helpSkinUpload" accept="image/png,image/jpeg,image/webp" hidden />
          <span class="muted">PNG / JPG / WebP，不超过 6MB，作为面板背景</span>
        </div>
        <div class="help-skin-panel" data-help-skin-body></div>`,
      footer: `<button type="button" class="btn btn-outline" data-close>关闭</button>
        <button type="button" class="btn btn-primary" id="helpSkinSave">保存并预览</button>`,
    })
    const root = modal.root
    const body = $("[data-help-skin-body]", root)
    const render = () => {
      body.innerHTML = helpSkinPanelHtml()
      const save = $("#helpSkinSave", root)
      if (save) save.disabled = !state.allowWrite
    }
    root.addEventListener("click", async event => {
      if (!state.allowWrite) return
      const del = event.target.closest("[data-help-skin-delete]")
      if (del) {
        const name = del.dataset.helpSkinDelete
        const theme = helpThemeList().find(item => item.name === name)
        const ok = await confirmDialog({
          title: "删除皮肤",
          message: `确定删除自定义皮肤「${theme ? helpThemeLabel(theme) : name}」吗？`,
          danger: true,
          confirmText: "删除",
        })
        if (!ok) return
        try {
          await api("/help/theme/delete", { method: "POST", body: { name } })
          hp.themes = helpThemeList().filter(item => item.name !== name)
          const selected = helpThemeListOf(hp.draft.helpCfg.theme).filter(item => item !== name)
          hp.draft.helpCfg.theme = selected.length ? selected.join(",") : "all"
          const excluded = Array.isArray(hp.draft.helpCfg.themeExclude) ? hp.draft.helpCfg.themeExclude : []
          hp.draft.helpCfg.themeExclude = excluded.filter(item => item !== name)
          if (hp.previewTheme === name) hp.previewTheme = ""
          render()
          renderHelpPanelPage()
          scheduleHelpPreview(0)
          toast("已删除皮肤", "success")
        } catch (error) {
          handleError(error)
        }
        return
      }
      if (event.target.closest("[data-help-skin-all]")) {
        hp.draft.helpCfg.theme = "all"
      } else {
        const pick = event.target.closest("[data-help-skin-pick]")
        if (pick) {
          const name = pick.dataset.helpSkinPick
          if (helpThemeMode(hp.draft.helpCfg.theme) === "all") hp.draft.helpCfg.theme = name
          else helpToggleTheme(name)
        } else {
          const exclude = event.target.closest("[data-help-skin-exclude]")
          if (!exclude) return
          helpToggleThemeExclude(exclude.dataset.helpSkinExclude)
        }
      }
      hp.previewTheme = ""
      render()
      renderHelpPanelPage()
      scheduleHelpPreview(0)
    })
    const fileInput = $("#helpSkinUpload", root)
    fileInput?.addEventListener("change", async () => {
      const file = fileInput.files?.[0]
      fileInput.value = ""
      if (!file) return
      if (file.size > HELP_THEME_MAX_BYTES) return toast("背景图不能超过 6MB", "error")
      try {
        const theme = await uploadHelpTheme(file)
        hp.draft.helpCfg.theme = theme.name
        hp.previewTheme = ""
        render()
        renderHelpPanelPage()
        scheduleHelpPreview(0)
        toast(`已添加皮肤「${helpThemeLabel(theme)}」`, "success", "上传成功")
      } catch (error) {
        handleError(error)
      }
    })
    $("#helpSkinSave", root).addEventListener("click", () => {
      modal.close()
      saveHelpPanel($("#helpSave"))
    })
    render()
  }

  async function openHelpBackupModal() {
    const modal = openModal({
      title: "备份与恢复",
      subtitle: "备份保存在 data/webui/help-backups，可随时恢复",
      width: "narrow",
      body: '<div class="help-backup-body" id="helpBackupBody"></div>',
      footer: `<button type="button" class="btn btn-outline" data-close>关闭</button>
        <button type="button" class="btn btn-primary" id="helpBackupNow">立即备份</button>`,
    })
    const root = modal.root
    const body = $("#helpBackupBody", root)

    const load = async () => {
      body.innerHTML = configLoadingHtml("正在读取备份…")
      try {
        const data = await api("/help/backups")
        const backups = Array.isArray(data?.backups) ? data.backups : []
        body.innerHTML = backups.length
          ? `<div class="help-backup-list">${backups
              .map(
                backup => `<div class="help-backup-row">
                  <div class="help-backup-meta">
                    <strong>${esc(backup.name)}</strong>
                    <small>${new Date(backup.time).toLocaleString()} · ${(backup.size / 1024).toFixed(1)} KB</small>
                  </div>
                  <button type="button" class="btn btn-outline btn-sm" data-help-backup-restore="${esc(
                    backup.name,
                  )}">恢复</button>
                </div>`,
              )
              .join("")}</div>`
          : '<div class="help-empty">还没有备份，点击「立即备份」创建。</div>'
      } catch (error) {
        body.innerHTML = `<div class="help-empty">${esc(error?.message || "读取备份失败")}</div>`
      }
    }

    const backupNow = $("#helpBackupNow", root)
    backupNow.addEventListener("click", async () => {
      setBusy(backupNow, true)
      try {
        const data = await api("/help/backup", { method: "POST", body: {} })
        toast(`已备份为 ${data?.backup?.name || "新备份"}`, "success", "备份成功")
        await load()
      } catch (error) {
        handleError(error)
      } finally {
        setBusy(backupNow, false)
      }
    })

    body.addEventListener("click", async event => {
      const button = event.target.closest("[data-help-backup-restore]")
      if (!button) return
      if (button.dataset.confirmReady !== "1") {
        body.querySelectorAll("[data-help-backup-restore]").forEach(item => {
          item.dataset.confirmReady = ""
          item.textContent = "恢复"
        })
        button.dataset.confirmReady = "1"
        button.textContent = "确认恢复"
        return
      }
      setBusy(button, true)
      try {
        await api("/help/backup/restore", { method: "POST", body: { name: button.dataset.helpBackupRestore } })
        toast("已恢复备份并重新载入配置", "success", "恢复成功")
        modal.close()
        await loadHelpPanel(true)
      } catch (error) {
        handleError(error)
        setBusy(button, false)
      }
    })

    await load()
  }

  function openHelpIconModal() {
    const hp = state.helpPanel
    const entry = hp.draft.helpList[hp.selection.group]?.list?.[hp.selection.item]
    if (!entry) return toast("请先在预览中选择一个条目", "info")
    const uploaded = Object.entries(hp.icons || {})
      .map(
        ([name, url]) =>
          `<button type="button" class="help-icon-cell" data-help-icon-uploaded="${esc(name)}" title="${esc(
            name,
          )}"><img src="${esc(url)}" alt="" /></button>`,
      )
      .join("")
    const modal = openModal({
      title: "选择图标",
      subtitle: "点击直接应用，或上传自定义图片",
      body: `<div class="help-icon-picker">
        <div class="help-icon-current">
          <span class="help-icon-preview">${helpIconInner(entry.icon)}</span>
          <span class="muted">当前图标</span>
        </div>
        <div class="help-icon-grid">${HELP_ICON_EMOJIS.map(
          emoji => `<button type="button" class="help-icon-cell" data-help-icon-pick="${emoji}">${emoji}</button>`,
        ).join("")}</div>
        <div class="help-icon-custom">
          <input class="config-input" id="helpIconCustom" maxlength="4" placeholder="自定义字符（最多 4 个）" />
          <button class="btn btn-outline btn-sm" type="button" id="helpIconCustomApply">使用</button>
          <button class="btn btn-outline btn-sm" type="button" id="helpIconEmpty">空图标</button>
        </div>
        <div class="help-icon-upload">
          <label class="btn btn-outline btn-sm" for="helpIconFile">${icon("download")}上传图片</label>
          <input type="file" id="helpIconFile" accept="image/png,image/jpeg,image/webp,image/gif" hidden />
          <span class="muted">PNG / JPG / WebP / GIF，不超过 1MB</span>
        </div>
        ${uploaded ? `<div class="help-icon-uploaded"><span class="muted">已上传图标</span><div class="help-icon-grid">${uploaded}</div></div>` : ""}
      </div>`,
    })
    const root = modal.root
    const apply = iconValue => {
      entry.icon = iconValue
      modal.close()
      renderHelpContentDialog()
      scheduleHelpPreview(0)
    }
    root.addEventListener("click", event => {
      const pick = event.target.closest("[data-help-icon-pick]")
      if (pick) return apply(pick.dataset.helpIconPick)
      const uploadedButton = event.target.closest("[data-help-icon-uploaded]")
      if (uploadedButton) return apply(`icon:${uploadedButton.dataset.helpIconUploaded}`)
      if (event.target.closest("#helpIconEmpty")) return apply("")
      if (event.target.closest("#helpIconCustomApply")) {
        const input = $("#helpIconCustom", root)
        const text = String(input?.value || "").trim()
        if (!text) return toast("请输入字符", "info")
        return apply(text)
      }
    })
    const fileInput = $("#helpIconFile", root)
    fileInput?.addEventListener("change", () => {
      const file = fileInput.files?.[0]
      if (!file) return
      if (file.size > HELP_ICON_MAX_BYTES)
        return toast(`图标不能超过 ${Math.round(HELP_ICON_MAX_BYTES / 1024 / 1024)}MB`, "error")
      const mime =
        file.type ||
        (/\.png$/i.test(file.name)
          ? "image/png"
          : /\.gif$/i.test(file.name)
            ? "image/gif"
            : /\.webp$/i.test(file.name)
              ? "image/webp"
              : "image/jpeg")
      const reader = new FileReader()
      reader.onload = async () => {
        try {
          const result = await api("/help/icon", {
            method: "POST",
            headers: { "Content-Type": mime },
            rawBody: file,
          })
          if (!result?.value) throw new Error("图标保存失败")
          hp.icons[result.name] = String(reader.result || "")
          apply(result.value)
        } catch (error) {
          handleError(error)
        }
      }
      reader.readAsDataURL(file)
    })
  }

  async function saveHelpPanel(button) {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info")
    const hp = state.helpPanel
    if (!hp.draft || !hp.detail) return
    const updates = helpUpdatesFromDraft()

    setBusy(button, true)
    try {
      const result = await api("/config/file/help", { method: "POST", body: { updates } })
      toast(result.message || "帮助面板已保存", "success", "保存成功")
      const detail = result.detail || (await api("/config/file/help"))
      hp.detail = detail
      hp.draft = helpDraftFrom(detail)
      hp.snapshot = JSON.stringify(helpUpdatesFromDraft())
      helpClampSelection()
      renderHelpPanelPage()
      renderHelpContentDialog()
    } catch (error) {
      handleError(error)
    } finally {
      setBusy(button, false)
    }
  }

  function helpFrameScale(width, height) {
    const wrap = $("#helpLiveWrap")
    const frame = $("#helpLiveFrame")
    const canvas = $("#helpStageCanvas")
    if (!wrap || !frame || !canvas) return
    state.helpPanel.frame = { width, height }
    const available = Math.max(280, canvas.clientWidth - 12)
    const scale = Math.min(1, available / width)
    wrap.style.width = `${Math.round(width * scale)}px`
    wrap.style.height = `${Math.round(height * scale)}px`
    frame.style.width = `${width}px`
    frame.style.height = `${height}px`
    frame.style.transform = `scale(${scale})`
    wrap.hidden = false
    const empty = $("#helpPreviewEmpty")
    if (empty) empty.hidden = true
  }

  function scheduleHelpPreview(delay = 280) {
    const hp = state.helpPanel
    window.clearTimeout(hp.previewTimer)
    hp.previewTimer = window.setTimeout(() => {
      refreshHelpPreview().catch(handleError)
    }, delay)
  }

  function helpThemeImageUrl(name, kind) {
    if (!name) return "";
    return apiAssetUrl(`/help/theme/image/${encodeURIComponent(name)}/${kind}`);
  }

  function helpThemeThumbUrl(theme) {
    return theme?.hasThumb ? helpThemeImageUrl(theme.name, "thumb") : "";
  }

  async function helpPreviewHtml(data) {
    const hp = state.helpPanel
    let html = String(data.html)
    if (html.includes("help-asset:theme-")) {
      html = html
        .replaceAll("help-asset:theme-main", helpThemeImageUrl(data.themeName, "main"))
        .replaceAll("help-asset:theme-bg", helpThemeImageUrl(data.themeName, "bg"))
    }
    let unknown = []
    html.replace(HELP_ASSET_ICON_RE, (_, name) => {
      if (!hp.icons[name] && !hp.iconMisses.has(name)) unknown.push(name)
      return ""
    })
    if (unknown.length) {
      const icons = await api("/help/icons").catch(() => null)
      for (const info of icons?.icons || [])
        if (info?.name) hp.icons[info.name] = helpIconUrl(info.name)
      for (const name of unknown) if (!hp.icons[name]) hp.iconMisses.add(name)
    }
    return html.replace(HELP_ASSET_ICON_RE, (_, name) => hp.icons[name] || "")
  }

  async function refreshHelpPreview(options) {
    const hp = state.helpPanel
    const frame = $("#helpLiveFrame")
    if (!frame || !hp.draft) return
    if (options?.reset) hp.previewTheme = ""
    const seq = ++hp.previewSeq
    const empty = $("#helpPreviewEmpty")
    if (empty) {
      empty.hidden = false
      empty.innerHTML = '<span class="spinner"></span>正在生成预览…'
    }
    try {
      const data = state.allowWrite
        ? await api("/help/preview/html", {
            method: "POST",
            body: { helpCfg: hp.draft.helpCfg, helpList: hp.draft.helpList, themeName: hp.previewTheme },
          })
        : await api(`/help/preview/html${hp.previewTheme ? `?theme=${encodeURIComponent(hp.previewTheme)}` : ""}`)
      if (seq !== hp.previewSeq) return
      if (!data?.html) throw new Error("预览生成失败")
      hp.previewTheme = data.themeName || hp.previewTheme
      const html = await helpPreviewHtml(data)
      if (seq !== hp.previewSeq) return
      const wrap = $("#helpLiveWrap")
      if (wrap) wrap.hidden = false
      frame.srcdoc = html
    } catch (error) {
      if (seq !== hp.previewSeq) return
      if (empty) {
        empty.hidden = false
        empty.textContent = error?.message || "预览生成失败"
      }
    }
  }

  /* ----- 群组配置 ----- */

  async function loadGroupConfigPage(force) {
    const groupState = state.configGroup;
    if (force || !groupState.list) {
      groupState.list = await api("/config/group");
      renderGroupInputs();
      renderGroupScopes();
    }
    if (force || !groupState.loadedKey) await loadGroupEffective(true);
    else renderGroupConfig();
  }

  function renderGroupInputs() {
    const groupState = state.configGroup;
    $("#groupCfgBot").value = groupState.botId;
    $("#groupCfgGroup").value = groupState.groupId;
    $$(".config-combo.open").forEach(combo => renderGroupComboMenu(combo, { filter: false }));
  }

  function groupComboOptions(kind) {
    const list = state.configGroup.list || {};
    if (kind === "bot") {
      return (list.bots || [])
        .filter(bot => /^\d{3,20}$/.test(String(bot.id || "")))
        .map(bot => ({
          value: String(bot.id),
          label: bot.name || String(bot.id),
          meta: [String(bot.id), bot.online === false ? "离线" : "在线"].join(" · "),
        }));
    }
    return (list.groups || [])
      .filter(group => String(group.id || "").trim())
      .map(group => {
        const count = Number(group.memberCount)
        const id = String(group.id)
        // 官机群号是「机器人号<U+F03A>群openid」，群配置的 key 就是 botId:groupId，
        // 所以这里只取 openid 部分，避免与 Bot 账号拼成重复前缀
        const openid = /^(\d+)[\uF03A\uFF1A:](.+)$/.exec(id)
        const value = openid ? openid[2] : id
        const label = group.name || (openid ? `官机群 · ${value.slice(-6)}` : id)
        return {
          value,
          label,
          meta: [id, count ? `${fmtNum(count)} 人` : ""].filter(Boolean).join(" · "),
        }
      })
  }

  function renderGroupComboMenu(combo, { filter = true } = {}) {
    const kind = combo.dataset.comboKind;
    const input = combo.querySelector("input");
    const menu = combo.querySelector(".config-combo-menu");
    const query = filter ? input.value.trim().toLowerCase() : "";
    const matched = groupComboOptions(kind).filter(
      item => !query || item.value.includes(query) || item.label.toLowerCase().includes(query),
    );
    const rows = query
      ? matched
      : [{ value: "", label: kind === "bot" ? "全部 Bot" : "全部群聊", meta: "" }, ...matched];
    menu.dataset.active = "-1";
    menu.innerHTML = rows.length
      ? rows
          .map(
            item => `<button type="button" class="config-combo-item" role="option" data-combo-value="${esc(item.value)}">
              <span>${esc(item.label)}</span><small>${esc(item.meta)}</small>
            </button>`,
          )
          .join("")
      : `<div class="config-combo-empty">没有匹配的${kind === "bot" ? "账号" : "群聊"}</div>`;
  }

  function closeGroupCombos() {
    $$(".config-combo.open").forEach(combo => {
      combo.classList.remove("open");
      combo.querySelector(".config-combo-menu").hidden = true;
      combo.querySelector("input").setAttribute("aria-expanded", "false");
      combo.querySelector(".config-combo-toggle").setAttribute("aria-expanded", "false");
    });
  }

  function openGroupCombo(combo, { filter = false } = {}) {
    closeGroupCombos();
    renderGroupComboMenu(combo, { filter });
    combo.classList.add("open");
    combo.querySelector(".config-combo-menu").hidden = false;
    combo.querySelector("input").setAttribute("aria-expanded", "true");
    combo.querySelector(".config-combo-toggle").setAttribute("aria-expanded", "true");
  }

  function setGroupComboActive(combo, index) {
    const menu = combo.querySelector(".config-combo-menu");
    const items = $$(".config-combo-item", menu);
    items.forEach((item, i) => item.classList.toggle("active", i === index));
    menu.dataset.active = String(index);
    if (index >= 0) items[index]?.scrollIntoView({ block: "nearest" });
  }

  function chooseGroupCombo(combo, value) {
    combo.querySelector("input").value = value;
    closeGroupCombos();
    applyGroupSelection();
  }

  function setupGroupCombo(combo) {
    const input = combo.querySelector("input");
    const toggle = combo.querySelector(".config-combo-toggle");
    const menu = combo.querySelector(".config-combo-menu");
    toggle.addEventListener("click", () => {
      if (combo.classList.contains("open")) {
        closeGroupCombos();
        return;
      }
      openGroupCombo(combo);
      input.focus();
    });
    input.addEventListener("focus", () => {
      if (!combo.classList.contains("open")) closeGroupCombos();
    });
    input.addEventListener("blur", () => {
      setTimeout(() => {
        if (!combo.contains(document.activeElement)) closeGroupCombos();
      }, 0);
    });
    input.addEventListener("input", () => {
      if (combo.classList.contains("open")) renderGroupComboMenu(combo);
      else openGroupCombo(combo, { filter: true });
    });
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        const active = Number(menu.dataset.active || -1);
        if (combo.classList.contains("open") && active >= 0) {
          const item = $$(".config-combo-item", menu)[active];
          if (item) chooseGroupCombo(combo, item.dataset.comboValue || "");
          return;
        }
        closeGroupCombos();
        applyGroupSelection();
        return;
      }
      if (event.key === "Escape") {
        if (combo.classList.contains("open")) closeGroupCombos();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      if (!combo.classList.contains("open")) {
        openGroupCombo(combo);
        return;
      }
      const items = $$(".config-combo-item", menu);
      if (!items.length) return;
      const current = Number(menu.dataset.active || -1);
      const next =
        event.key === "ArrowDown"
          ? Math.min(items.length - 1, current + 1)
          : Math.max(0, current <= 0 ? 0 : current - 1);
      setGroupComboActive(combo, next);
    });
    menu.addEventListener("mousedown", event => event.preventDefault());
    menu.addEventListener("click", event => {
      const item = event.target.closest(".config-combo-item");
      if (item) chooseGroupCombo(combo, item.dataset.comboValue || "");
    });
  }

  function renderGroupScopes() {
    const groupState = state.configGroup;
    const root = $("#groupCfgScopes");
    if (!root) return;
    const scopes = groupState.list?.scopes || [];
    if (!scopes.length) {
      root.innerHTML = '<div class="config-side-empty">暂无作用范围</div>';
      return;
    }
    const active = groupState.detail?.scopeId || "default";
    root.innerHTML = scopes
      .map(
        scope => `<button type="button" class="config-file-item ${scope.id === active ? "active" : ""}" data-group-scope="${esc(scope.id)}">
          <span class="config-file-icon">${icon(scope.id === "default" ? "users" : "pin")}</span>
          <span class="config-file-text"><strong>${esc(scope.label || scope.id)}</strong><small>${Number(scope.count) ? `${fmtNum(scope.count)} 项${scope.id === "default" ? "默认值" : "覆盖"}` : scope.id === "default" ? "无配置项" : "无覆盖"}</small></span>
        </button>`,
      )
      .join("");
  }

  async function loadGroupEffective(force) {
    const groupState = state.configGroup;
    const main = $("#groupCfgMain");
    const key = `${groupState.botId}:${groupState.groupId}`;
    if (!force && groupState.detail && groupState.loadedKey === key) {
      renderGroupConfig();
      return groupState.detail;
    }

    main.innerHTML = configLoadingHtml("正在加载群组配置…");
    try {
      const params = new URLSearchParams();
      if (groupState.botId) params.set("botId", groupState.botId);
      if (groupState.groupId) params.set("groupId", groupState.groupId);
      const detail = await api(`/config/group/effective?${params.toString()}`);
      groupState.detail = detail;
      groupState.loadedKey = key;
      renderGroupConfig();
      renderGroupScopes();
      updateGroupControls();
      return detail;
    } catch (error) {
      main.innerHTML = configErrorHtml(error, "group");
      throw error;
    }
  }

  function renderGroupConfig() {
    const groupState = state.configGroup;
    const detail = groupState.detail;
    const main = $("#groupCfgMain");
    if (!detail || !main) return;
    const meta = ['<span class="mono">config/config/group.yaml</span>'];
    if (groupState.list?.file?.updatedAt) meta.push(`<span>更新于 ${esc(fmtDateTime(groupState.list.file.updatedAt))}</span>`);
    if (groupState.list?.file?.size) meta.push(`<span>${esc(formatConfigSize(groupState.list.file.size))}</span>`);
    main.innerHTML = configPanelHtml(detail, "group", {
      title: `群组配置 · ${detail.scopeLabel || detail.scopeId}`,
      description: detail.note,
      badge: detail.isDefault ? "全局默认" : "作用范围",
      badgeVariant: detail.isDefault ? "pill-blue" : "pill-amber",
      meta: meta.join(""),
      group: true,
      isDefault: !!detail.isDefault,
    });
    updateConfigDirty("group");
    updateGroupControls();
  }

  function updateGroupControls() {
    const groupState = state.configGroup;
    const detail = groupState.detail;
    const remove = $("#groupCfgRemove");
    if (!remove) return;
    const exists = !!groupState.list?.scopes?.some(scope => scope.id === detail?.scopeId);
    remove.disabled = !state.allowWrite || !detail || detail.isDefault || !exists;
    const meta = $("#groupCfgScopeMeta");
    if (!detail) {
      meta.textContent = "正在加载作用范围…";
      return;
    }
    meta.innerHTML = `<span class="mono">${esc(detail.scopeId || "default")}</span>${pill(
      detail.scopeLabel || detail.scopeId,
      detail.isDefault ? "pill-blue" : "pill-amber",
    )}<span>${detail.isDefault ? "内建默认配置" : `${fmtNum(detail.overriddenCount)} 项覆盖`}</span><span>${esc(detail.note || "")}</span>`;
  }

  function applyGroupSelection() {
    closeGroupCombos();
    const groupState = state.configGroup;
    const botId = $("#groupCfgBot").value.trim();
    const groupId = $("#groupCfgGroup").value.trim();
    if (botId && !/^\d{3,20}$/.test(botId)) {
      toast("Bot 账号应为 3-20 位数字", "error");
      return;
    }
    // 官机群号形如「机器人号<U+F03A>群openid」，分隔符是私用区字符，不是纯数字
    if (groupId && !/^[\dA-Za-z_:.\uF03A\uFF1A-]{3,80}$/.test(groupId)) {
      toast("群号格式无效", "error");
      return;
    }
    groupState.botId = botId;
    groupState.groupId = groupId;
    loadGroupEffective(true).catch(handleError);
  }

  function selectGroupScope(scopeId) {
    closeGroupCombos();
    const groupState = state.configGroup;
    let botId = "";
    let groupId = "";
    if (scopeId === "default") {
      botId = "";
      groupId = "";
    } else if (scopeId.includes(":")) {
      const [bot, group] = scopeId.split(":");
      botId = bot || "";
      groupId = group === "default" ? "" : group || "";
    } else {
      groupId = scopeId;
    }
    groupState.botId = botId;
    groupState.groupId = groupId;
    $("#groupCfgBot").value = botId;
    $("#groupCfgGroup").value = groupId;
    loadGroupEffective(true).catch(handleError);
  }

  async function resetGroupField(key) {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    const groupState = state.configGroup;
    const field = findConfigField("group", key);
    if (!field || !groupState.detail) return;
    try {
      const result = await api("/config/group", {
        method: "POST",
        body: { botId: groupState.botId, groupId: groupState.groupId, resets: [field.path] },
      });
      toast(result.message || "已恢复", "success");
      await loadGroupConfigPage(true);
    } catch (error) {
      handleError(error);
    }
  }

  async function removeGroupScope() {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    const groupState = state.configGroup;
    const detail = groupState.detail;
    if (!detail || detail.isDefault) return;
    const confirmed = await confirmDialog({
      title: "删除群聊覆盖",
      message: `将删除「${detail.scopeLabel || detail.scopeId}」的全部覆盖项，并回退到上一层配置。`,
      confirmText: "删除",
      danger: true,
    });
    if (!confirmed) return;
    try {
      const params = new URLSearchParams();
      if (groupState.botId) params.set("botId", groupState.botId);
      if (groupState.groupId) params.set("groupId", groupState.groupId);
      const result = await api(`/config/group?${params.toString()}`, { method: "DELETE" });
      toast(result.message || "已删除覆盖", "success");
      await loadGroupConfigPage(true);
    } catch (error) {
      handleError(error);
    }
  }

  /* ----- 插件配置 ----- */

  async function loadPluginConfigList(force) {
    if (!force && state.configPlugin.list) {
      renderPluginCfgNav();
      return state.configPlugin.list;
    }
    state.configPlugin.loading = true;
    renderPluginCfgNav();
    try {
      const data = await api("/plugin-config");
      state.configPlugin.list = data;
      const flat = [];
      for (const plugin of data.plugins || []) {
        for (const config of plugin.configs || []) flat.push({ plugin: plugin.key, id: config.id, kind: config.kind });
      }
      const current = state.configPlugin;
      if (!flat.some(item => item.plugin === current.plugin && item.id === current.id)) {
        const preferred = flat.find(item => item.kind === "guoba") || flat[0];
        current.plugin = preferred?.plugin || "";
        current.id = preferred?.id || "";
        current.detail = null;
      }
      return data;
    } finally {
      state.configPlugin.loading = false;
      renderPluginCfgNav();
    }
  }

  function renderPluginCfgNav() {
    const root = $("#pluginCfgNav");
    if (!root) return;
    const plugins = state.configPlugin.list?.plugins || [];
    if (!plugins.length) {
      root.innerHTML = state.configPlugin.loading
        ? '<div class="nav-empty">正在加载…</div>'
        : '<div class="nav-empty">没有发现插件配置</div>';
      return;
    }
    root.innerHTML = plugins
      .map(plugin => {
        const configs = plugin.configs || [];
        const current =
          state.configPlugin.plugin === plugin.key && state.configPlugin.id
            ? configs.find(config => config.id === state.configPlugin.id)
            : null;
        const preferred = current || configs.find(config => config.kind === "guoba") || configs[0];
        if (!preferred) return "";
        const active = state.page === "config-plugin" && state.configPlugin.plugin === plugin.key;
        const iconUrl = plugin.hasIcon
          ? `${state.basePath}/api/plugin-icon?plugin=${encodeURIComponent(plugin.key)}${
              state.token ? `&token=${encodeURIComponent(state.token)}` : ""
            }`
          : "";
        const fallbackColor = plugin.iconColor
          ? ` style="color:${esc(plugin.iconColor)};border-color:${esc(plugin.iconColor)}"`
          : "";
        const avatar = iconUrl
          ? `<img class="plugin-cfg-icon" src="${esc(iconUrl)}" alt="" loading="lazy" />`
          : `<span class="plugin-cfg-icon plugin-cfg-icon-fallback"${fallbackColor}>${esc(
              (plugin.title || plugin.key).slice(0, 1).toUpperCase(),
            )}</span>`;
        return `<button type="button" class="nav-item plugin-cfg-item ${active ? "active" : ""}" data-plugin-cfg="${esc(
          plugin.key,
        )}" data-config-id="${esc(preferred.id)}" title="${esc(
          plugin.key,
        )}">
          ${avatar}
          <span class="nav-label">${esc(plugin.title || plugin.key)}</span>
          ${configs.length > 1 ? `<span class="nav-count">${configs.length}</span>` : ""}
        </button>`;
      })
      .join("");
  }

  async function loadPluginConfigPage(force) {
    await loadPluginConfigList(force);
    const current = state.configPlugin;
    if (!current.plugin || !current.id) {
      $("#pluginCfgMain").innerHTML = emptyState("没有可编辑的插件配置", "插件目录中未发现 Guoba 表单或可编辑 YAML。", "sliders");
      return null;
    }
    return loadPluginConfigDetail(current.plugin, current.id, force);
  }

  async function loadPluginConfigDetail(plugin, id, force) {
    const current = state.configPlugin;
    const main = $("#pluginCfgMain");
    current.plugin = plugin;
    current.id = id;
    renderPluginCfgNav();
    if (!force && current.detail && current.detail.plugin?.key === plugin && current.detail.id === id) {
      renderPluginConfig();
      return current.detail;
    }

    main.innerHTML = configLoadingHtml("正在读取插件配置…");
    try {
      const params = new URLSearchParams({ plugin, id });
      current.detail = await api(`/plugin-config/detail?${params.toString()}`);
      renderPluginConfig();
      return current.detail;
    } catch (error) {
      main.innerHTML = configErrorHtml(error, "plugin");
      throw error;
    }
  }

  async function selectPluginConfigAndLoad(plugin, id) {
    state.configPlugin.plugin = plugin;
    state.configPlugin.id = id;
    await loadPluginConfigDetail(plugin, id, true);
  }

  function renderPluginConfig() {
    const detail = state.configPlugin.detail;
    const main = $("#pluginCfgMain");
    if (!detail || !main) return;
    const pluginTitle = detail.plugin?.title || detail.plugin?.name || detail.plugin?.key;
    const entry = (state.configPlugin.list?.plugins || []).find(plugin => plugin.key === detail.plugin?.key);
    const configs = entry?.configs || [];
    const tabs =
      configs.length > 1
        ? `<div class="config-tabs">${configs
            .map(
              config => `<button type="button" class="config-tab ${
                config.id === state.configPlugin.id ? "active" : ""
              }" data-config-plugin="${esc(detail.plugin.key)}" data-config-tab="${esc(config.id)}">
                ${icon(config.kind === "guoba" ? "sliders" : "file")}
                <span>${esc(config.title)}</span>
                <small>${esc(config.kind === "guoba" ? "Guoba" : "YAML")}</small>
              </button>`,
            )
            .join("")}</div>`
        : "";
    main.innerHTML =
      tabs +
      configPanelHtml(detail, "plugin", {
        title: pluginTitle && pluginTitle !== detail.title ? `${pluginTitle} · ${detail.title}` : detail.title,
        description: detail.plugin?.description || detail.description,
        meta: detail.plugin?.key ? `<span>${esc(detail.plugin.key)}</span>` : "",
      });
    updateConfigDirty("plugin");
  }

  async function openPluginConfigItem(pluginKey, configId) {
    showPage("config-plugin", { skipLoad: true });
    openPluginCfgNavGroup();
    try {
      await loadPluginConfigList();
      const plugin = (state.configPlugin.list?.plugins || []).find(item => item.key === pluginKey);
      if (!plugin || !plugin.configs?.length) {
        toast("该插件没有可编辑配置", "info");
        return;
      }
      const config =
        (configId && plugin.configs.find(item => item.id === configId)) ||
        plugin.configs.find(item => item.kind === "guoba") ||
        plugin.configs[0];
      await selectPluginConfigAndLoad(pluginKey, config.id);
    } catch (error) {
      handleError(error);
    }
  }

  function openPluginConfig(pluginKey) {
    return openPluginConfigItem(pluginKey);
  }

  /* ----- 保存 / 交互 ----- */

  async function saveConfigView(view, button) {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    const detail = configDetail(view);
    if (!detail) return;
    let changes;
    try {
      changes = collectConfigChanges(view);
    } catch (error) {
      return toast(error.message, "error", "无法保存");
    }
    if (!changes.length) return toast("没有需要保存的修改", "info");

    const updates = changes.map(item => ({ path: item.field.path, value: item.value }));
    setBusy(button, true);
    try {
      let result;
      if (view === "basic" || view === "other") {
        const pageState = configPageState(view);
        result = await api(`/config/file/${encodeURIComponent(pageState.name)}`, { method: "POST", body: { updates } });
      } else if (view === "ai-system") {
        result = await api("/config/file/ai", { method: "POST", body: { updates } });
      } else if (view === "group") {
        result = await api("/config/group", {
          method: "POST",
          body: { botId: state.configGroup.botId, groupId: state.configGroup.groupId, updates },
        });
      } else {
        const body = { plugin: state.configPlugin.plugin, id: state.configPlugin.id };
        if (detail.kind === "guoba") {
          const data = {};
          for (const item of changes) data[item.field.key || configPathKey(item.field)] = item.value;
          body.data = data;
        } else body.updates = updates;
        result = await api("/plugin-config/save", { method: "POST", body });
      }

      toast(
        `${result.message || "配置已保存"}${result.restartRequired ? "（需重启 Bot 后生效）" : ""}`,
        "success",
        "保存成功",
      );
      if (view === "plugin" && detail.kind === "guoba") {
        await loadPluginConfigDetail(state.configPlugin.plugin, state.configPlugin.id, true);
      } else {
        await reloadConfigView(view);
      }
      invalidateOverview();
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(button, false);
    }
  }

  async function reloadConfigView(view) {
    if (view === "basic" || view === "other") {
      await loadConfigFiles(true);
      await loadCoreFile(view, configPageState(view).name, true);
    } else if (view === "ai-system") {
      await loadAiYamlPage(view, true);
    } else if (view === "group") {
      await loadGroupConfigPage(true);
    } else {
      await loadPluginConfigList(true);
      if (state.configPlugin.plugin && state.configPlugin.id) {
        await loadPluginConfigDetail(state.configPlugin.plugin, state.configPlugin.id, true);
      }
    }
  }

  async function refreshConfigPage(view, button) {
    setBusy(button, true);
    try {
      if (view === "basic" || view === "other") await loadCoreConfigPage(view, true);
      else if (view === "group") await loadGroupConfigPage(true);
      else await loadPluginConfigPage(true);
      toast("配置已刷新", "info");
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(button, false);
    }
  }

  function addConfigTag(input) {
    const value = input.value.trim();
    if (!value) return;
    const editor = input.closest(".config-list-editor");
    const container = editor?.querySelector(".config-tags");
    if (!container) return;
    const exists = $$(".config-tag", container).some(tag => tag.dataset.tagValue === value);
    if (!exists) {
      container.querySelector(".config-tags-empty")?.remove();
      container.insertAdjacentHTML("beforeend", configTagHtml(value, configTagLabel(editor, value), false));
    }
    input.value = "";
    syncTagPickState(input.closest(".config-list-editor"), value, true);
    syncAiKeywordSwitch(input.closest("[data-config-form]")?.dataset.configForm);
    updateDirtyFromConfigNode(input);
  }

  function removeConfigTag(button) {
    const tag = button.closest(".config-tag");
    const editor = tag?.closest(".config-list-editor");
    const container = editor?.querySelector(".config-tags");
    const form = tag?.closest("[data-config-form]");
    if (!tag || !container) return;
    tag.remove();
    if (!$$(".config-tag", container).length) {
      container.insertAdjacentHTML(
        "afterbegin",
        `<span class="config-tags-empty">${state.allowWrite ? "尚未选择，点击下方名称添加" : "未配置"}</span>`,
      );
    }
    syncTagPickState(editor, tag.dataset.tagValue, false);
    if (form) syncAiKeywordSwitch(form.dataset.configForm);
    if (form) updateConfigDirty(form.dataset.configForm);
  }

  function toggleConfigTag(button) {
    const editor = button.closest(".config-list-editor");
    const container = editor?.querySelector(".config-tags");
    if (!editor || !container) return;
    const name = button.dataset.tagPick;
    const label = button.dataset.tagLabel || name;
    const active = button.getAttribute("aria-pressed") === "true";
    if (active) {
      const tag = $$(".config-tag", container).find(item => item.dataset.tagValue === name);
      if (tag) {
        tag.remove();
        if (!$$(".config-tag", container).length) {
          container.insertAdjacentHTML("afterbegin", '<span class="config-tags-empty">尚未选择，点击下方名称添加</span>');
        }
      }
    } else {
      container.querySelector(".config-tags-empty")?.remove();
      const exists = $$(".config-tag", container).some(item => item.dataset.tagValue === name);
      if (!exists) container.insertAdjacentHTML("beforeend", configTagHtml(name, label, false));
    }
    setTagPickState(button, !active);
    const form = editor.closest("[data-config-form]");
    if (form) syncAiKeywordSwitch(form.dataset.configForm);
    if (form) updateConfigDirty(form.dataset.configForm);
  }

  function setTagPickState(button, active) {
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
    const use = button.querySelector("use");
    if (use) use.setAttribute("href", active ? "#i-check" : "#i-plus");
  }

  function syncTagPickState(editor, name, active) {
    const button = $$("[data-tag-pick]", editor || document).find(item => item.dataset.tagPick === name);
    if (button) setTagPickState(button, active);
  }

  function addSubformRow(button) {
    const form = button.closest("[data-config-form]");
    if (!form) return;
    const field = findConfigField(form.dataset.configForm, button.dataset.subformAdd);
    const host = $("[data-subform]", button.closest(".config-field"));
    if (!field || !host) return;
    $(".subform-empty", host)?.remove();
    host.insertAdjacentHTML("beforeend", subformRowHtml(field, {}));
    updateDirtyFromConfigNode(button);
  }

  function removeSubformRow(button) {
    const row = button.closest("[data-subform-row]");
    const host = row?.closest("[data-subform]");
    if (!row || !host) return;
    const form = row.closest("[data-config-form]");
    row.remove();
    if (!$$("[data-subform-row]", host).length) {
      host.insertAdjacentHTML("beforeend", '<div class="subform-empty">尚未添加条目</div>');
    }
    if (form) updateConfigDirty(form.dataset.configForm);
  }

  function updateDirtyFromConfigNode(node) {
    const form = node.closest("[data-config-form]");
    if (form) updateConfigDirty(form.dataset.configForm);
  }

  function selectConfigSection(button) {
    const tabs = button.closest("[data-config-section-tabs]");
    const form = button.closest("[data-config-form]");
    if (!tabs || !form) return;
    const index = button.dataset.configSectionTab;
    state.configSections[tabs.dataset.configSectionTabs] = Number(index);
    $$("[data-config-section-tab]", tabs).forEach(tab => {
      const active = tab === button;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    $$("[data-config-section]", form).forEach(section => {
      section.hidden = section.dataset.configSection !== index;
    });
  }

  function handleConfigMainClick(event) {
    const sectionTab = event.target.closest("[data-config-section-tab]");
    if (sectionTab) {
      selectConfigSection(sectionTab);
      return;
    }
    const tab = event.target.closest("[data-config-tab]");
    if (tab) {
      selectPluginConfigAndLoad(tab.dataset.configPlugin, tab.dataset.configTab);
      return;
    }
    const save = event.target.closest("[data-config-save]");
    if (save) {
      saveConfigView(save.dataset.configSave, save);
      return;
    }
    const retry = event.target.closest("[data-config-retry]");
    if (retry) {
      retryConfigView(retry.dataset.configRetry);
      return;
    }
    const reset = event.target.closest("[data-group-reset]");
    if (reset) {
      resetGroupField(reset.dataset.groupReset);
      return;
    }
    const subAdd = event.target.closest("[data-subform-add]");
    if (subAdd) {
      addSubformRow(subAdd);
      return;
    }
    const subRemove = event.target.closest("[data-subform-remove]");
    if (subRemove) {
      removeSubformRow(subRemove);
      return;
    }
    const tagRemove = event.target.closest("[data-tag-remove]");
    if (tagRemove) {
      removeConfigTag(tagRemove);
      return;
    }
    // 触摸屏没有 hover：点被省略的标签文字时弹窗显示完整内容
    const tagText = event.target.closest(".config-tag-text");
    if (tagText && tagText.scrollWidth > tagText.clientWidth + 1) {
      const tag = tagText.closest(".config-tag");
      showFullText(tag?.dataset.tagLabel || tagText.textContent || "");
      return;
    }
    // 折叠的说明文字点一下也能看全文
    const helpClamp = event.target.closest(".config-help.clamp[data-fulltext]");
    if (helpClamp) {
      showFullText(helpClamp.dataset.fulltext);
      return;
    }
    const tagPick = event.target.closest("[data-tag-pick]");
    if (tagPick && !tagPick.disabled) {
      toggleConfigTag(tagPick);
      return;
    }
  }

  function handleConfigMainInput(event) {
    const target = event.target;
    if (target.matches("[data-config-control]") && target.type === "checkbox") {
      const text = target.closest(".switch")?.querySelector(".config-switch-text");
      if (text) text.textContent = target.checked ? "开启" : "关闭";
    }
    if (target.matches("[data-tag-input]")) return;
    const form = target.closest("[data-config-form]");
    if (form) updateConfigDirty(form.dataset.configForm);
  }

  function handleConfigMainKeydown(event) {
    const input = event.target.closest("[data-tag-input]");
    if (!input) return;
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addConfigTag(input);
    }
  }

  function handleConfigFocusOut(event) {
    const input = event.target.closest("[data-tag-input]");
    if (input) addConfigTag(input);
  }

  function retryConfigView(view) {
    if (view === "basic" || view === "other") {
      loadCoreFile(view, configPageState(view).name, true).catch(handleError);
    } else if (view === "ai-system") {
      loadAiYamlPage(view, true).catch(handleError);
    } else if (view === "group") {
      loadGroupConfigPage(true).catch(handleError);
    } else if (view === "help-panel") {
      loadHelpPanel(true).catch(handleError);
    } else {
      loadPluginConfigPage(true).catch(handleError);
    }
  }

  function initConfigPages() {
    const bindRefresh = (id, view) => {
      const button = $(id);
      if (button) button.addEventListener("click", () => refreshConfigPage(view, button));
    };
    bindRefresh("#configPluginRefresh", "plugin");

    $("#groupCfgApply").addEventListener("click", applyGroupSelection);
    $("#groupCfgRemove").addEventListener("click", removeGroupScope);
    $$(".config-combo[data-combo-kind]").forEach(setupGroupCombo);
    document.addEventListener("mousedown", event => {
      if (!event.target.closest(".config-combo")) closeGroupCombos();
    });

    $("#configBasicNav").addEventListener("click", handleConfigFileClick);
    $("#configOtherNav").addEventListener("click", handleConfigFileClick);
    $("#groupCfgScopes").addEventListener("click", event => {
      const button = event.target.closest("[data-group-scope]");
      if (button) selectGroupScope(button.dataset.groupScope);
    });
    $("#pluginCfgNav").addEventListener("click", event => {
      const button = event.target.closest("[data-plugin-cfg]");
      if (button) openPluginConfigItem(button.dataset.pluginCfg, button.dataset.configId);
    });

    Object.values(CONFIG_VIEWS).forEach(item => {
      const root = $(item.main);
      if (!root) return;
      root.addEventListener("click", handleConfigMainClick);
      root.addEventListener("input", handleConfigMainInput);
      root.addEventListener("change", handleConfigMainInput);
      root.addEventListener("keydown", handleConfigMainKeydown);
      root.addEventListener("focusout", handleConfigFocusOut);
    });

    const helpPage = $('[data-page="help-panel"]');
    if (helpPage) {
      helpPage.addEventListener("click", onHelpPanelClick);
      helpPage.addEventListener("input", onHelpPanelInput);
      helpPage.addEventListener("change", onHelpPanelInput);
      setupHelpStage();
    }
  }

  function handleConfigFileClick(event) {
    const button = event.target.closest("[data-config-file]");
    if (!button) return;
    loadCoreFile(button.dataset.configView, button.dataset.configFile).catch(handleError);
  }

  /* ---------------- 账号显示 ---------------- */

  async function loadAccounts(force) {
    if (!force && state.accounts) {
      renderAccounts();
      return state.accounts;
    }
    const data = await api("/accounts");
    state.accounts = data;
    renderAccounts();
    return data;
  }

  function accountAvatar(bot) {
    const avatarUrl = botAvatarUrl(bot);
    if (avatarUrl)
      return `<div class="account-avatar has-image" style="background-image:url(&quot;${esc(avatarUrl)}&quot;)"></div>`;
    return `<div class="account-avatar"></div>`;
  }

  function renderAccounts() {
    const data = state.accounts;
    if (!data) return;
    const bots = data.bots || [];
    if (!bots.length) {
      $("#accountCards").innerHTML = `<div class="account-empty">${emptyState("暂无登录账号", "协议端接入后会显示账号信息。", "bot")}</div>`;
      return;
    }
    $("#accountCards").innerHTML = bots
      .map(bot => {
        const online = bot.online === true;
        const runtime = bot.startTime ? `已运行 ${fmtDuration(Date.now() - bot.startTime)}` : "";
        const meta = [
          bot.isQQ && bot.loginProtocol ? `<span class="account-chip"><b>${esc(bot.loginProtocol)}</b></span>` : "",
          bot.isQQ && bot.protocolVersion ? `<span class="account-chip"><b>${esc(bot.protocolVersion)}</b></span>` : "",
          runtime ? `<span class="account-chip purple" data-account-start="${bot.startTime}">已运行 ${esc(fmtDuration(Date.now() - bot.startTime))}</span>` : "",
          bot.isQQ ? "" : `<span class="account-chip">控制台</span>`,
        ]
          .filter(Boolean)
          .join("");
        const stats = [
          ["好友", bot.friendCount],
          ["群组", bot.groupCount],
          ["群员", bot.groupMemberCount],
          ["收", bot.recvCount],
          ["发", bot.sendCount],
        ]
          .map(([label, value]) => `<span class="account-chip plain"><b>${fmtNum(value)}</b>${label}</span>`)
          .join("");
        return `<article class="account-card">
          <div class="account-avatar-wrap">
            ${accountAvatar(bot)}
            <span class="account-dot ${online ? "online" : "offline"}" title="${online ? "在线" : "离线"}"></span>
          </div>
          <div class="account-head">
            <div class="account-name">${esc(bot.nickname || "未命名账号")}<span class="mono">${esc(bot.self_id || "")}</span></div>
            <div class="account-chips">${meta}</div>
            <div class="account-chips">${stats}</div>
          </div>
        </article>`;
      })
      .join("");
  }

  /* ---------------- 群聊与好友 ---------------- */

  async function loadGroups(force) {
    if (!force && state.groups) {
      renderGroups();
      return state.groups;
    }
    const data = await api("/groups");
    state.groups = data;
    renderGroups();
    return data;
  }

  function renderGroups() {
    const data = state.groups;
    if (!data) return;
    const groups = data.groups || [];
    const friends = data.friends || [];
    const bots = data.bots || [];
    const online = bots.filter(bot => bot.online).length;

    $("#groupStats").innerHTML = [
      miniStat("群聊", fmtNum(groups.length), "users", 1),
      miniStat("好友", fmtNum(friends.length), "message", 2),
      miniStat("Bot 账号", `${fmtNum(online)} / ${fmtNum(bots.length)}`, "bot", 3),
    ].join("");

    $$("#groupTabs [data-group-tab]").forEach(button => {
      button.classList.toggle("active", button.dataset.groupTab === state.groupTab);
      button.textContent =
        button.dataset.groupTab === "groups" ? `群聊 ${fmtNum(groups.length)}` : `好友 ${fmtNum(friends.length)}`;
    });

    const query = state.groupQuery.trim().toLowerCase();
    const isGroups = state.groupTab === "groups";
    const list = isGroups
      ? groups.filter(group => !query || `${group.name || ""} ${group.group_id}`.toLowerCase().includes(query))
      : friends.filter(friend => !query || `${friend.nickname || ""} ${friend.remark || ""} ${friend.user_id}`.toLowerCase().includes(query));

    $("#groupCountText").textContent = isGroups
      ? `${fmtNum(list.length)} 个群聊${query ? ` · 共 ${fmtNum(groups.length)} 个` : ""}`
      : `${fmtNum(list.length)} 个好友${query ? ` · 共 ${fmtNum(friends.length)} 个` : ""}`;

    if (!list.length) {
      $("#groupRows").innerHTML = tableEmpty(4, isGroups ? "暂无群聊（可能尚未同步群列表）" : "暂无好友");
      return;
    }

    $("#groupRows").innerHTML = isGroups
      ? list
          .map(
            group => `<tr>
              <td><div class="cell-main"><strong>${esc(group.name || "未命名群聊")}</strong><small>${esc(group.group_id)}</small></div></td>
              <td><span class="mono">${esc(group.group_id)}</span></td>
              <td>${group.memberCount ? `${fmtNum(group.memberCount)}${group.maxMemberCount ? ` / ${fmtNum(group.maxMemberCount)}` : ""} 人` : "—"}</td>
              <td><span class="mono">${esc(group.botId || "—")}</span></td>
            </tr>`,
          )
          .join("")
      : list
          .map(
            friend => `<tr>
              <td><div class="cell-main"><strong>${esc(friend.nickname || "未命名好友")}</strong><small>${esc(friend.user_id)}</small></div></td>
              <td><span class="mono">${esc(friend.user_id)}</span></td>
              <td>${esc(friend.remark || "—")}</td>
              <td><span class="mono">${esc(friend.botId || "—")}</span></td>
            </tr>`,
          )
          .join("");
  }

  /* ---------------- 日志 ---------------- */

  async function loadLogs() {
    if (state.logs.loading) return;
    state.logs.loading = true;
    try {
      // 行数上限由 webui.yaml 的 logLines 决定（默认 300）
      const params = new URLSearchParams({ type: state.logs.type });
      const data = await api(`/logs?${params.toString()}`);
      renderLogs(data);
    } finally {
      state.logs.loading = false;
    }
  }

  function renderLogs(data) {
    const terminal = $("#logLines");
    const atBottom = terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 80;
    const lines = data.lines || [];
    const kind = data.type === "error" ? "错误" : "命令";

    $("#logsMeta").textContent = `已显示最后 ${fmtNum(lines.length)} 行 · 更新于 ${fmtClock(data.now || Date.now())}`;

    if (!lines.length) {
      terminal.innerHTML = `<div class="terminal-empty">${icon("file")}<strong>暂无${kind}日志</strong></div>`;
      return;
    }

    terminal.innerHTML = lines
      .map((line, index) => {
        const level = logLevel(line);
        return `<div class="log-line ${level}"><span class="ln">${index + 1}</span><span class="txt">${esc(line)}</span></div>`;
      })
      .join("");

    if (atBottom) terminal.scrollTop = terminal.scrollHeight;
  }

  function logLevel(line) {
    const text = String(line);
    const match = text.match(/\[(error|warn|mark|info|debug)\]/i) || text.match(/\b(ERROR|WARN|MARK)\b/i);
    if (!match) return "";
    const level = match[1].toLowerCase();
    return level === "error" || level === "warn" || level === "mark" || level === "info" ? level : "";
  }

  function updateLogTypeButtons() {
    $$("#logTypeBtns [data-log-type]").forEach(button => {
      button.classList.toggle("active", button.dataset.logType === state.logs.type);
    });
  }

  function syncLogAuto() {
    if (state.logs.timer) {
      window.clearInterval(state.logs.timer);
      state.logs.timer = null;
    }
    if (!state.logs.auto || state.page !== "logs") return;
    state.logs.timer = window.setInterval(async () => {
      try {
        await loadLogs();
      } catch (error) {
        state.logs.auto = false;
        const checkbox = $("#logAuto");
        if (checkbox) checkbox.checked = false;
        syncLogAuto();
        handleError(error);
      }
    }, 5000);
  }

  /* ---------------- 模态框 ---------------- */

  function openModal(options) {
    const opts = options || {};
    const layer = document.createElement("div");
    layer.className = "modal-layer";
    let topZ = 99;
    $$(".modal-layer").forEach(el => {
      topZ = Math.max(topZ, Number(el.style.zIndex) || 0);
    });
    layer.style.zIndex = String(topZ + 1);
    layer.innerHTML = `<div class="modal ${opts.width || ""}">
      <div class="modal-head">
        <div><h3>${esc(opts.title || "")}</h3>${opts.subtitle ? `<p>${esc(opts.subtitle)}</p>` : ""}</div>
        <button type="button" class="modal-close" data-close aria-label="关闭">${icon("close")}</button>
      </div>
      ${opts.body || ""}
      ${opts.footer ? `<div class="modal-foot">${opts.footer}</div>` : ""}
    </div>`;
    document.body.appendChild(layer);
    document.body.classList.add("modal-open");

    let closed = false;
    const onKey = event => {
      if (event.key !== "Escape") return;
      const layers = $$(".modal-layer");
      if (layers[layers.length - 1] !== layer) return;
      event.stopPropagation();
      close();
    };
    const close = () => {
      if (closed) return;
      closed = true;
      layer.remove();
      if (!$(".modal-layer:not([hidden])")) document.body.classList.remove("modal-open");
      document.removeEventListener("keydown", onKey);
      if (typeof opts.onClose === "function") opts.onClose();
    };

    document.addEventListener("keydown", onKey);
    layer.onclick = event => {
      if (event.target === layer) close();
    };
    $$("[data-close]", layer).forEach(button => button.addEventListener("click", close));

    return { root: layer, close };
  }

  function confirmDialog(options) {
    const opts = options || {};
    return new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        modal.close();
        resolve(value);
      };
      const modal = openModal({
        title: opts.title || "请确认",
        body: `<div class="modal-body"><p class="confirm-text">${esc(opts.message || "")}</p></div>`,
        footer: `<button type="button" class="btn btn-outline" data-cancel>${esc(opts.cancelText || "取消")}</button>
          <button type="button" class="btn ${opts.danger ? "btn-danger" : "btn-primary"}" data-confirm>${esc(opts.confirmText || "确认")}</button>`,
        width: "narrow",
        onClose: () => finish(false),
      });
      $("[data-cancel]", modal.root).addEventListener("click", () => finish(false));
      $("[data-confirm]", modal.root).addEventListener("click", () => finish(true));
    });
  }

  /* ---------------- 表情包 ---------------- */

  const stickerState = {
    items: [],
    categories: [],
    stats: { total: 0, categories: 0, totalUsed: 0 },
    category: "",
    query: "",
    config: { enabled: true, uploadMode: "off", uploadWhitelist: [], uploadBlacklist: [] },
    presets: [],
  };

  async function loadStickers(force) {
    initStickerPage()
    const params = new URLSearchParams()
    if (stickerState.query) params.set("query", stickerState.query)
    if (stickerState.category) params.set("category", stickerState.category)
    const data = await api(`/ai/stickers${params.toString() ? `?${params}` : ""}`)
    stickerState.items = data.items || []
    stickerState.categories = data.categories || []
    stickerState.stats = data.stats || { total: 0, categories: 0, totalUsed: 0 }
    stickerState.config = data.config || { enabled: true, uploadMode: "off" }
    stickerState.presets = data.presets || []
    refreshStickerPendingBadge()
    renderStickers()
    return data
  }

  function renderStickers() {
    const stats = stickerState.stats || {}
    $("#stickerStats").innerHTML = [
      miniStat("表情总数", fmtNum(stats.total || 0), "grid", 1),
      miniStat("分类数量", fmtNum(stats.categories || 0), "puzzle", 2),
      miniStat("累计使用", fmtNum(stats.totalUsed || 0), "spark", 3),
      miniStat("当前筛选", stickerState.category || "全部", "search", 4),
    ].join("")

    const enabledInput = $("#stickerEnabled")
    if (enabledInput) enabledInput.checked = stickerState.config.enabled !== false

    const cats = [{ name: "", count: stats.total || 0 }, ...stickerState.categories]
    $("#stickerCatCount").textContent = `共 ${fmtNum(stats.categories || 0)} 个分类`
    $("#stickerCats").innerHTML = cats
      .map(cat => {
        const label = cat.name || "全部表情"
        const active = (cat.name || "") === stickerState.category ? " active" : ""
        return `<button type="button" class="sticker-cat${active}" data-sticker-cat="${esc(cat.name)}">
          <span>${esc(label)}</span><span class="count">${fmtNum(cat.count)}</span>
        </button>`
      })
      .join("")

    $("#stickerCount").textContent = stickerState.items.length
      ? `显示 ${fmtNum(stickerState.items.length)} 张${stickerState.query ? `（搜索「${stickerState.query}」）` : ""}`
      : "暂无表情"

    const grid = $("#stickerGrid")
    if (!stickerState.items.length) {
      grid.innerHTML = `<div class="sticker-empty" style="grid-column:1/-1">
        <svg class="icon"><use href="#i-grid"></use></svg>
        <strong>${stickerState.query || stickerState.category ? "没有匹配的表情" : "表情库还是空的"}</strong>
        <span>${stickerState.query || stickerState.category ? "换个关键词或分类试试" : "上传表情，或让 AI 在聊天中自己存"}</span>
      </div>`
      return
    }

    grid.innerHTML = stickerState.items
      .map(item => `<article class="sticker-card" data-sticker-id="${esc(item.id)}">
        <div class="sticker-thumb"><img src="${esc(stickerImageUrl(item.id))}" alt="${esc(item.meaning)}" loading="lazy" /></div>
        <div class="sticker-meta">
          <strong title="${esc(item.meaning)}">${esc(item.meaning)}</strong>
          <small>${esc(item.category)} · 用过 ${fmtNum(item.usedCount || 0)} 次</small>
        </div>
        <div class="sticker-actions">
          <button type="button" data-sticker-edit="${esc(item.id)}">编辑</button>
          <button type="button" class="danger" data-sticker-del="${esc(item.id)}">删除</button>
        </div>
      </article>`)
      .join("")
  }

  // <img> 无法带自定义请求头，改用 token 查询参数
  function stickerImageUrl(id) {
    const base = apiUrl(`/ai/stickers/file/${encodeURIComponent(id)}`)
    return state.token ? `${base}?token=${encodeURIComponent(state.token)}` : base
  }

  function openStickerEditor(item) {
    const defaults = item || { meaning: "", category: stickerState.category || "开心", description: "", tags: [] }
    const categoryOptions = [
      ...new Set([
        "开心", "悲伤", "生气", "无语", "尴尬", "鼓励", "疑惑", "害羞", "其他",
        ...stickerState.categories.map(cat => cat.name),
      ]),
    ]
    const modal = openModal({
      title: "编辑表情",
      body: `<div class="modal-body">
        <div class="field"><span>含义（作为文件名）</span><input id="stickerFormMeaning" type="text" value="${esc(defaults.meaning)}" placeholder="如 开心大笑" autocomplete="off" /></div>
        <div class="field"><span>分类</span><input id="stickerFormCategory" type="text" value="${esc(defaults.category)}" list="stickerCatList" autocomplete="off" />
          <datalist id="stickerCatList">${categoryOptions.map(name => `<option value="${esc(name)}"></option>`).join("")}</datalist>
        </div>
        <div class="field"><span>说明（可选）</span><input id="stickerFormDesc" type="text" value="${esc(defaults.description || "")}" placeholder="这张表情适合什么场景" autocomplete="off" /></div>
        <div class="field"><span>标签（逗号分隔）</span><input id="stickerFormTags" type="text" value="${esc((defaults.tags || []).join("，"))}" placeholder="笑，开心" autocomplete="off" /></div>
      </div>`,
      footer: `<button type="button" class="btn btn-outline" data-cancel>取消</button>
        <button type="button" class="btn btn-primary" data-save>保存</button>`,
      width: "narrow",
    })
    const $in = sel => $(sel, modal.root)
    $("[data-cancel]", modal.root).addEventListener("click", () => modal.close())
    $("[data-save]", modal.root).addEventListener("click", async () => {
      const meaning = $in("#stickerFormMeaning").value.trim()
      const category = $in("#stickerFormCategory").value.trim() || "其他"
      if (!meaning) return toast("请填写含义", "info")
      const payload = {
        meaning,
        category,
        description: $in("#stickerFormDesc").value.trim(),
        tags: $in("#stickerFormTags")
          .value.split(/[,，]/)
          .map(tag => tag.trim())
          .filter(Boolean),
      }
      try {
        await api(`/ai/stickers/${encodeURIComponent(item.id)}`, { method: "PUT", body: payload })
        modal.close()
        toast("已更新", "success")
        await loadStickers(true)
      } catch (error) {
        handleError(error)
      }
    })
  }

  async function uploadStickerFiles(files) {
    for (const file of files) {
      if (!/^image\//.test(file.type)) {
        toast(`${file.name} 不是图片`, "info")
        continue
      }
      openStickerUpload(file)
      break
    }
  }

  function openStickerUpload(file) {
    const categoryOptions = [
      ...new Set(["开心", "悲伤", "生气", "无语", "尴尬", "鼓励", "疑惑", "害羞", "其他", ...stickerState.categories.map(cat => cat.name)]),
    ]
    const modal = openModal({
      title: "上传表情",
      body: `<div class="modal-body">
        <div class="sticker-upload-preview"><img src="${esc(URL.createObjectURL(file))}" alt="${esc(file.name)}" /></div>
        <div class="field"><span>含义（作为文件名）</span><input id="stickerFormMeaning" type="text" value="${esc(file.name.replace(/\.[^.]+$/, "").slice(0, 24))}" autocomplete="off" /></div>
        <div class="field"><span>分类</span><input id="stickerFormCategory" type="text" value="${esc(stickerState.category || "开心")}" list="stickerCatList2" autocomplete="off" />
          <datalist id="stickerCatList2">${categoryOptions.map(name => `<option value="${esc(name)}"></option>`).join("")}</datalist>
        </div>
        <div class="field"><span>说明（可选）</span><input id="stickerFormDesc" type="text" placeholder="这张表情适合什么场景" autocomplete="off" /></div>
        <div class="field"><span>标签（逗号分隔）</span><input id="stickerFormTags" type="text" placeholder="笑，开心" autocomplete="off" /></div>
      </div>`,
      footer: `<button type="button" class="btn btn-outline" data-cancel>取消</button>
        <button type="button" class="btn btn-primary" data-save>保存</button>`,
      width: "narrow",
    })
    const $in = sel => $(sel, modal.root)
    $("[data-cancel]", modal.root).addEventListener("click", () => modal.close())
    $("[data-save]", modal.root).addEventListener("click", async () => {
      const meaning = $in("#stickerFormMeaning").value.trim()
      const category = $in("#stickerFormCategory").value.trim() || "其他"
      if (!meaning) return toast("请填写含义", "info")
      const query = new URLSearchParams({
        meaning,
        category,
        description: $in("#stickerFormDesc").value.trim(),
        tags: $in("#stickerFormTags")
          .value.split(/[,，]/)
          .map(tag => tag.trim())
          .filter(Boolean)
          .join(","),
      })
      try {
        await api(`/ai/stickers?${query}`, {
          method: "POST",
          rawBody: file,
          headers: { "Content-Type": file.type || "image/png" },
        })
        modal.close()
        toast("已上传", "success")
        await loadStickers(true)
      } catch (error) {
        handleError(error)
      }
    })
  }

  async function deleteSticker(id) {
    const ok = await confirmDialog({ title: "删除表情", message: "确定要从表情库删除这张表情吗？文件也会一起删除。", danger: true, confirmText: "删除" })
    if (!ok) return
    try {
      await api(`/ai/stickers/${encodeURIComponent(id)}`, { method: "DELETE" })
      toast("已删除", "success")
      await loadStickers(true)
    } catch (error) {
      handleError(error)
    }
  }

  function initStickerPage() {
    const bind = (sel, event, handler) => {
      const el = $(sel)
      if (el && !el.dataset.bound) {
        el.dataset.bound = "1"
        el.addEventListener(event, handler)
      }
    }
    bind("#stickerEnabled", "change", async event => {
      try {
        await api("/ai/stickers/config", { method: "POST", body: { enabled: event.target.checked } })
        stickerState.config.enabled = event.target.checked
        toast(event.target.checked ? "已启用表情包" : "已关闭表情包", "success")
      } catch (error) {
        event.target.checked = !event.target.checked
        handleError(error)
      }
    })
    bind("#stickerUploadBtn", "click", () => $("#stickerFile")?.click())
    bind("#stickerPermBtn", "click", () => openStickerPermDialog())
    bind("#stickerGateBtn", "click", () => openStickerGateDialog())
    bind("#stickerEnrichBtn", "click", () => enrichStickers().catch(handleError))
    bind("#stickerPendingBtn", "click", () => openStickerPendingDialog().catch(handleError))
    bind("#stickerFile", "change", event => {
      const files = [...(event.target.files || [])]
      event.target.value = ""
      if (files.length) uploadStickerFiles(files).catch(handleError)
    })
    let timer = null
    bind("#stickerSearch", "input", event => {
      stickerState.query = event.target.value.trim()
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => loadStickers().catch(handleError), 300)
    })
    bind("#stickerCats", "click", event => {
      const btn = event.target.closest("[data-sticker-cat]")
      if (!btn) return
      stickerState.category = btn.dataset.stickerCat || ""
      loadStickers().catch(handleError)
    })
    bind("#stickerGrid", "click", event => {
      const edit = event.target.closest("[data-sticker-edit]")
      if (edit) {
        const item = stickerState.items.find(row => row.id === edit.dataset.stickerEdit)
        if (item) openStickerEditor(item)
        return
      }
      const del = event.target.closest("[data-sticker-del]")
      if (del) deleteSticker(del.dataset.stickerDel).catch(handleError)
    })
  }

  function openStickerGateDialog() {
    const cfg = stickerState.config || {}
    const modal = openModal({
      title: "自动收发",
      body: `<div class="modal-body">
        <label class="switch">
          <input type="checkbox" id="stickerAutoSave" ${cfg.autoSave !== false ? "checked" : ""} />
          <span class="track"></span><span>自动收集群里的表情</span>
        </label>
        <div class="field">
          <span>收集概率</span>
          <input id="stickerCollectChance" type="number" min="0" max="100" step="5" value="${esc(cfg.autoCollectChance ?? 35)}" />
        </div>
        <div class="field">
          <span>同一群最短间隔（分钟）</span>
          <input id="stickerCollectGap" type="number" min="0" step="1" value="${esc(cfg.autoCollectIntervalMinutes ?? 5)}" />
        </div>
        <div class="field">
          <span>每小时最多发送</span>
          <input id="stickerMaxPerHour" type="number" min="0" step="1" value="${esc(cfg.maxPerHour ?? 6)}" />
        </div>
      </div>`,
      footer: `<button type="button" class="btn btn-outline" data-cancel>取消</button>
        <button type="button" class="btn btn-primary" data-save>保存</button>`,
      width: "narrow",
    })
    const $in = sel => $(sel, modal.root)
    const numOf = (sel, fallback, min, max) => {
      const value = Number($in(sel).value)
      if (!Number.isFinite(value)) return fallback
      return Math.min(max, Math.max(min, value))
    }
    $("[data-cancel]", modal.root).addEventListener("click", () => modal.close())
    $("[data-save]", modal.root).addEventListener("click", async () => {
      try {
        const data = await api("/ai/stickers/config", {
          method: "POST",
          body: {
            autoSave: $in("#stickerAutoSave").checked,
            autoCollectChance: numOf("#stickerCollectChance", 35, 0, 100),
            autoCollectIntervalMinutes: numOf("#stickerCollectGap", 5, 0, 1440),
            maxPerHour: numOf("#stickerMaxPerHour", 6, 0, 200),
          },
        })
        stickerState.config = data.config || stickerState.config
        modal.close()
        toast(data.message || "已保存", "success")
      } catch (error) {
        handleError(error)
      }
    })
  }

  async function enrichStickers() {
    if (!stickerState.items.length) return toast("表情库是空的", "info")
    const lacking = stickerState.items.filter(item => !item.description || !(item.tags || []).length)
    if (!lacking.length) return toast("描述和标签都齐了", "success")
    const btn = $("#stickerEnrichBtn")
    if (btn) btn.disabled = true
    try {
      let done = 0
      let remaining = lacking.length
      // 一次最多处理 20 张，反复请求直到补齐或无可补
      for (let round = 0; round < 10 && remaining > 0; round++) {
        const data = await api("/ai/stickers/enrich", { method: "POST", body: { limit: 5 } })
        done += data.done || 0
        remaining = data.remaining || 0
        if (!data.done) break
        toast(`已补全 ${done} 张，还剩 ${remaining} 张`, "info")
      }
      await loadStickers(true)
      toast(done ? `补全完成，共 ${done} 张` : "这批没补出内容", done ? "success" : "info")
    } catch (error) {
      handleError(error)
    } finally {
      if (btn) btn.disabled = false
    }
  }

  function openStickerPermDialog() {
    const cfg = stickerState.config || {}
    const mode = cfg.uploadMode || "off"
    const presets = stickerState.presets || []
    const listHtml = (key, selected) =>
      presets.length
        ? presets
            .map(
              preset => `<label class="sticker-perm-item">
                <input type="checkbox" data-sticker-preset="${esc(key)}" value="${esc(preset.id)}" ${selected.has(preset.id) ? "checked" : ""} />
                <span>${esc(preset.name)}</span>
              </label>`,
            )
            .join("")
        : '<span class="muted">还没有预设</span>'
    const white = new Set(cfg.uploadWhitelist || [])
    const black = new Set(cfg.uploadBlacklist || [])
    const modal = openModal({
      title: "表情上传权限",
      body: `<div class="modal-body">
        <div class="field">
          <span>规则</span>
          <select id="stickerPermMode">
            <option value="off" ${mode === "off" ? "selected" : ""}>所有人格都可上传</option>
            <option value="whitelist" ${mode === "whitelist" ? "selected" : ""}>仅白名单人格可上传</option>
            <option value="blacklist" ${mode === "blacklist" ? "selected" : ""}>黑名单人格不可上传</option>
          </select>
        </div>
        <div class="field sticker-perm-group" data-sticker-perm-group="whitelist" ${mode === "whitelist" ? "" : "hidden"}>
          <span>白名单（勾选可上传的人格）</span>
          <div class="sticker-perm-list">${listHtml("whitelist", white)}</div>
        </div>
        <div class="field sticker-perm-group" data-sticker-perm-group="blacklist" ${mode === "blacklist" ? "" : "hidden"}>
          <span>黑名单（勾选不可上传的人格）</span>
          <div class="sticker-perm-list">${listHtml("blacklist", black)}</div>
        </div>
        <div class="field">
          <label class="switch">
            <input type="checkbox" id="stickerReviewEnabled" ${cfg.requireReview ? "checked" : ""} />
            <span class="track"></span><span>上传后需主人审核</span>
          </label>
          <div class="hint">开启后新表情先进入待审区，放行才入库；超时未处理会自动通过。</div>
        </div>
        <div class="field">
          <span>自动放行时长（小时）</span>
          <input id="stickerReviewHours" type="number" min="0" step="1" value="${esc(cfg.reviewTimeoutHours ?? 24)}" />
          <div class="hint">主人超过这个时间没有放行或拒绝，就自动同意。</div>
        </div>
        <div class="hint">无论规则如何，AI 平时只会发送自己人格的表情，不会串用其他人格的表情。</div>
      </div>`,
      footer: `<button type="button" class="btn btn-outline" data-cancel>取消</button>
        <button type="button" class="btn btn-primary" data-save>保存</button>`,
      width: "narrow",
    })
    const $in = sel => $(sel, modal.root)
    $in("#stickerPermMode").addEventListener("change", event => {
      const value = event.target.value
      $$("[data-sticker-perm-group]", modal.root).forEach(group => {
        group.hidden = group.dataset.stickerPermGroup !== value
      })
    })
    $("[data-cancel]", modal.root).addEventListener("click", () => modal.close())
    $("[data-save]", modal.root).addEventListener("click", async () => {
      const nextMode = $in("#stickerPermMode").value
      const collect = key =>
        $$(`[data-sticker-preset="${key}"]:checked`, modal.root).map(input => input.value)
      const hours = Number($in("#stickerReviewHours").value)
      try {
        await api("/ai/stickers/config", {
          method: "POST",
          body: {
            uploadMode: nextMode,
            uploadWhitelist: collect("whitelist"),
            uploadBlacklist: collect("blacklist"),
            requireReview: $in("#stickerReviewEnabled").checked,
            reviewTimeoutHours: Number.isFinite(hours) ? Math.max(0, hours) : 24,
          },
        })
        modal.close()
        toast("上传权限已保存", "success")
        await loadStickers(true)
      } catch (error) {
        handleError(error)
      }
    })
  }

  async function openStickerPendingDialog() {
    let data
    try {
      data = await api("/ai/stickers/pending")
    } catch (error) {
      handleError(error)
      return
    }
    const items = data.items || []
    const now = Date.now()
    const body = items.length
      ? `<div class="modal-body"><div class="sticker-pending-list">${items
          .map(item => {
            const left = Math.max(0, Math.round(((item.expiresAt || now) - now) / 60000))
            const leftText = left >= 60 ? `${Math.round(left / 60)} 小时` : `${left} 分钟`
            return `<div class="sticker-pending-item" data-pending-id="${esc(item.id)}">
              <img src="${esc(stickerPendingUrl(item.id))}" alt="${esc(item.meaning)}" loading="lazy" />
              <div class="sticker-pending-meta">
                <strong>${esc(item.meaning)}</strong>
                <small>${esc(item.category)} · ${esc(item.presetName || "公共")}</small>
                <small class="muted">${leftText} 后自动通过</small>
              </div>
              <div class="sticker-pending-actions">
                <button type="button" class="btn btn-primary btn-sm" data-approve="${esc(item.id)}">放行</button>
                <button type="button" class="btn btn-outline btn-sm" data-reject="${esc(item.id)}">拒绝</button>
              </div>
            </div>`
          })
          .join("")}</div></div>`
      : `<div class="modal-body"><div class="sticker-empty"><svg class="icon"><use href="#i-check"></use></svg><strong>没有待审核的表情</strong></div></div>`
    const modal = openModal({
      title: `待审核表情（${items.length}）`,
      body,
      footer: `<button type="button" class="btn btn-outline" data-cancel>关闭</button>`,
      width: "narrow",
    })
    $("[data-cancel]", modal.root).addEventListener("click", () => modal.close())
    modal.root.addEventListener("click", async event => {
      const approve = event.target.closest("[data-approve]")
      const reject = event.target.closest("[data-reject]")
      if (!approve && !reject) return
      const id = (approve || reject).dataset.approve || (approve || reject).dataset.reject
      try {
        if (approve) {
          await api(`/ai/stickers/pending/${encodeURIComponent(id)}/approve`, { method: "POST" })
          toast("已放行", "success")
        } else {
          await api(`/ai/stickers/pending/${encodeURIComponent(id)}/reject`, { method: "POST" })
          toast("已拒绝", "success")
        }
        modal.close()
        await loadStickers(true)
        openStickerPendingDialog()
      } catch (error) {
        handleError(error)
      }
    })
  }

  function stickerPendingUrl(id) {
    const base = apiUrl(`/ai/stickers/pending/${encodeURIComponent(id)}/file`)
    return state.token ? `${base}?token=${encodeURIComponent(state.token)}` : base
  }

  async function refreshStickerPendingBadge() {
    const badge = $("#stickerPendingBadge")
    if (!badge) return
    try {
      const data = await api("/ai/stickers/pending")
      const count = (data.items || []).length
      badge.textContent = String(count)
      badge.hidden = count === 0
    } catch {
      badge.hidden = true
    }
  }

  /* ---------------- 语音设置 ---------------- */

  const voiceState = { config: null, voices: [], bound: false }

  async function loadVoicePage() {
    initVoicePage()
    const data = await api("/ai/voice")
    voiceState.config = data.config || {}
    voiceState.voices = data.voices || []
    renderVoicePage()
    return data
  }

  function renderVoicePage() {
    const cfg = voiceState.config || {}
    const custom = cfg.provider === "custom"
    $("#voiceEnabled").checked = cfg.enabled !== false
    $("#voiceProvider").value = custom ? "custom" : "free"
    $("#voiceSpeed").value = cfg.speed ?? (custom ? 1 : 5)
    $("#voiceBaseURL").value = cfg.baseURL || ""
    $("#voiceApiKey").value = cfg.apiKey || ""
    $("#voiceModel").value = cfg.model || ""
    const select = $("#voiceVoice")
    select.innerHTML = voiceState.voices
      .map(item => `<option value="${esc(item.value)}">${esc(item.label)}</option>`)
      .join("")
    select.value = custom ? "zh" : cfg.voice || "zh"
    $("#voiceCustomVoice").value = custom ? cfg.voice || "" : ""
    toggleVoiceCustom()
  }

  function toggleVoiceCustom(resetSpeed) {
    const custom = $("#voiceProvider").value === "custom"
    const freeField = $("#voiceFreeVoiceField")
    const wrap = $("#voiceCustomFields")
    if (freeField) freeField.hidden = custom
    if (wrap) wrap.hidden = !custom
    const speed = $("#voiceSpeed")
    const hint = $("#voiceSpeedHint")
    if (speed) {
      speed.min = custom ? "0.25" : "1"
      speed.max = custom ? "4" : "15"
      speed.step = custom ? "0.05" : "1"
      if (resetSpeed) speed.value = custom ? "1" : "5"
      else {
        const value = Number(speed.value)
        if (!Number.isFinite(value) || value <= 0) speed.value = custom ? "1" : "5"
      }
    }
    if (hint) hint.textContent = custom ? "0.25-4，默认 1" : "1-15，默认 5"
  }

  function collectVoiceForm() {
    const custom = $("#voiceProvider").value === "custom"
    return {
      enabled: $("#voiceEnabled").checked,
      provider: custom ? "custom" : "free",
      voice: custom
        ? $("#voiceCustomVoice").value.trim() || "alloy"
        : $("#voiceVoice").value || "zh",
      speed: Number($("#voiceSpeed").value) || (custom ? 1 : 5),
      baseURL: $("#voiceBaseURL").value.trim(),
      apiKey: $("#voiceApiKey").value.trim(),
      model: $("#voiceModel").value.trim(),
    }
  }

  function initVoicePage() {
    if (voiceState.bound) return
    voiceState.bound = true
    $("#voiceProvider")?.addEventListener("change", () => toggleVoiceCustom(true))
    $("#voiceSave")?.addEventListener("click", async () => {
      try {
        const data = await api("/ai/voice", { method: "POST", body: collectVoiceForm() })
        voiceState.config = data.config || {}
        toast(data.message || "已保存", "success")
      } catch (error) {
        handleError(error)
      }
    })
    $("#voiceTestBtn")?.addEventListener("click", async () => {
      const note = $("#voiceTestNote")
      const player = $("#voicePlayer")
      try {
        if (note) note.textContent = "合成中…"
        const data = await api("/ai/voice/test", {
          method: "POST",
          body: {
            text: $("#voiceTestText").value.trim() || "你好，这是语音测试",
            config: collectVoiceForm(),
          },
        })
        if (player) {
          player.src = data.dataUrl
          player.hidden = false
          player.play().catch(() => {})
        }
        if (note) note.textContent = data.message || "合成成功"
      } catch (error) {
        if (note) note.textContent = error.message
      }
    })
  }

  /* ---------------- 主动聊天 ---------------- */

  const proactiveState = { config: null, aiEnabled: true }

  async function loadProactiveConfig() {
    const data = await api("/ai/proactive")
    proactiveState.config = data.config || {}
    proactiveState.aiEnabled = data.aiEnabled !== false
    return data
  }

  /** 主动聊天设置块，挂在「设置」页自由模式判定下方 */
  function proactiveBlockHtml() {
    const cfg = proactiveState.config || {}
    const field = (id, label, value, extra) =>
      `<label class="field"><span>${label}</span><input id="${id}" type="number" ${extra} value="${esc(value)}" ${state.allowWrite ? "" : "disabled"} /></label>`
    return `<div class="config-section proactive-block" data-proactive-block>
      <div class="proactive-head">
        <div><h3>主动聊天</h3></div>
        <div class="proactive-actions">
          <label class="switch"><input type="checkbox" id="proactiveEnabled" ${cfg.enabled === true ? "checked" : ""} ${state.allowWrite ? "" : "disabled"} /><span class="track"></span><span>全局开启</span></label>
          <button type="button" class="btn btn-primary btn-sm" id="proactiveSave" ${state.allowWrite ? "" : "disabled"}>${icon("save")}保存主动聊天</button>
        </div>
      </div>
      <div class="ai-form-grid" id="proactiveForm">
        ${field("proactiveInterval", "检查间隔（秒）", cfg.pollIntervalSeconds ?? 300, 'min="5"')}
        ${field("proactiveIdle", "最小沉默（秒）", cfg.minIdleSeconds ?? 1200, 'min="0"')}
        ${field("proactiveBase", "基础概率", cfg.baseProbability ?? 0.05, 'min="0" max="1" step="0.01"')}
        ${field("proactiveMax", "最高概率", cfg.maxProbability ?? 0.5, 'min="0" max="1" step="0.01"')}
        ${field("proactiveMinMessages", "触发前最少消息数", cfg.minMessagesBeforeTrigger ?? 10, 'min="0"')}
        ${field("proactiveCooldown", "冷却（秒）", cfg.cooldownSeconds ?? 5400, 'min="0"')}
        ${field("proactiveMaxPerHour", "每号每小时上限", cfg.maxPerHour ?? 20, 'min="0"')}
        ${field("proactiveMaxPerDay", "每日上限", cfg.maxPerDay ?? 6, 'min="0"')}
        ${field("proactiveQuietStart", "静默时段起始（点）", cfg.quietHoursStart ?? 0, 'min="0" max="23"')}
        ${field("proactiveQuietEnd", "静默时段结束（点）", cfg.quietHoursEnd ?? 6, 'min="0" max="23"')}
      </div>
      <div class="hint" id="proactiveResult">${proactiveState.aiEnabled === false ? "AI 总开关已关闭，主动聊天不会运行" : ""}</div>
    </div>`
  }

  function mountProactiveBlock(view) {
    if (view !== "ai-system") return
    const main = $(CONFIG_VIEWS[view].main)
    if (!main) return
    const form = $("[data-config-form]", main)
    if (!form) return
    $("[data-proactive-block]", main)?.remove()
    // 追加在最后一个分区之后，不落进两列网格
    form.insertAdjacentHTML("beforeend", proactiveBlockHtml())
    bindProactiveBlock(main)
  }

  function collectProactiveForm() {
    const num = id => Number($(id).value)
    return {
      enabled: $("#proactiveEnabled").checked,
      pollIntervalSeconds: num("#proactiveInterval"),
      minIdleSeconds: num("#proactiveIdle"),
      baseProbability: num("#proactiveBase"),
      maxProbability: num("#proactiveMax"),
      minMessagesBeforeTrigger: num("#proactiveMinMessages"),
      cooldownSeconds: num("#proactiveCooldown"),
      maxPerHour: num("#proactiveMaxPerHour"),
      maxPerDay: num("#proactiveMaxPerDay"),
      quietHoursStart: num("#proactiveQuietStart"),
      quietHoursEnd: num("#proactiveQuietEnd"),
    }
  }

  function bindProactiveBlock(root) {
    $("#proactiveSave", root)?.addEventListener("click", async () => {
      try {
        const data = await api("/ai/proactive", { method: "POST", body: collectProactiveForm() })
        proactiveState.config = data.config || {}
        toast(data.message || "已保存", "success")
      } catch (error) {
        handleError(error)
      }
    })
  }

  /* ---------------- 后台 ---------------- */

  const backendState = { history: [], bound: false, busy: false }

  async function loadBackendPage() {
    initBackendPage()
    const data = await api("/backend")
    backendState.history = data.history || []
    const protocolOnline = data.protocolOnline === true
    const statusBar = $("#backendStatus")
    if (statusBar) {
      statusBar.classList.toggle("on", protocolOnline)
      statusBar.classList.toggle("warn", !protocolOnline)
      statusBar.classList.remove("off")
      statusBar.setAttribute("aria-label", protocolOnline ? "协议端已接入" : "未接入协议端")
    }
    renderBackendLog()
    return data
  }

  // <img> 无法带自定义请求头，改用 token 查询参数
  function backendImageUrl(id) {
    const base = apiUrl(`/backend/image/${encodeURIComponent(id)}`)
    return state.token ? `${base}?token=${encodeURIComponent(state.token)}` : base
  }

  function backendImagesHtml(images) {
    const list = Array.isArray(images) ? images.filter(image => image?.id) : []
    if (!list.length) return ""
    return `<div class="backend-entry-media">${list
      .map(image => {
        const url = esc(backendImageUrl(image.id))
        return `<a class="backend-shot" href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${esc(image.name || "输出图片")}" /></a>`
      })
      .join("")}</div>`
  }

  function renderBackendLog() {
    const box = $("#backendLog")
    if (!box) return
    if (!backendState.history.length) {
      box.innerHTML = `<div class="backend-empty">${icon("tool")}<strong>还没有发送过指令</strong></div>`
      return
    }
    box.innerHTML = backendState.history
      .slice()
      .reverse()
      .map(item => {
        const images = backendImagesHtml(item.images)
        const placeholder = item.pending ? "等待响应…" : images ? "" : "（没有输出）"
        const output = item.output || placeholder
        return `<div class="backend-entry${item.pending ? " is-pending" : ""}">
        <div class="backend-entry-head">
          <span class="backend-entry-cmd">${esc(item.command)}</span>
          <span class="backend-entry-meta">${item.pending ? '<span class="backend-spinner"></span>处理中…' : `${item.durationMs} ms${item.dangerous ? " · 危险指令" : ""}`}</span>
        </div>
        ${output ? `<pre class="backend-entry-out">${esc(output)}</pre>` : ""}
        ${images}
      </div>`
      })
      .join("")
    box.scrollTop = box.scrollHeight
  }

  function initBackendPage() {
    if (backendState.bound) return
    backendState.bound = true
    $("#backendClear")?.addEventListener("click", async () => {
      try {
        await api("/backend/clear", { method: "POST" })
        backendState.history = []
        renderBackendLog()
        toast("已清空", "success")
      } catch (error) {
        handleError(error)
      }
    })
    $("#backendForm")?.addEventListener("submit", async event => {
      event.preventDefault()
      if (backendState.busy) return
      const input = $("#backendCommand")
      const command = input.value.trim()
      if (!command) return
      const button = $("#backendRun")
      backendState.busy = true
      if (button) button.disabled = true
      // 先插一条"进行中"记录，让界面立刻有反馈
      const pending = {
        command,
        output: "",
        images: [],
        durationMs: 0,
        dangerous: false,
        at: Date.now(),
        pending: true,
      }
      backendState.history.unshift(pending)
      input.value = ""
      renderBackendLog()
      const startedAt = Date.now()
      try {
        await apiSSE(
          "/backend/stream",
          {
            command,
            allowDangerous: $("#backendAllowDangerous")?.checked === true,
          },
          {
            chunk: data => {
              // 每收到一段就追加，长指令期间界面持续更新
              if (!data?.text) return
              pending.output = pending.output ? `${pending.output}\n${data.text}` : data.text
              backendState.history[0] = { ...pending }
              renderBackendLog()
            },
            image: data => {
              // 图片边生成边推过来，先占位显示，避免整轮结束后才出现
              if (!data?.image?.id) return
              pending.images = [...(pending.images || []), data.image]
              backendState.history[0] = { ...pending }
              renderBackendLog()
            },
            done: data => {
              pending.output = typeof data?.output === "string" ? data.output : pending.output
              if (Array.isArray(data?.images)) pending.images = data.images
              pending.durationMs = data?.durationMs ?? Date.now() - startedAt
              pending.dangerous = data?.dangerous === true
              pending.pending = false
              backendState.history[0] = { ...pending }
              renderBackendLog()
            },
            error: data => {
              pending.output = `发送失败：${data?.message || "未知错误"}`
              pending.durationMs = Date.now() - startedAt
              pending.pending = false
              backendState.history[0] = { ...pending }
              renderBackendLog()
            },
          },
        )
      } catch (error) {
        pending.output = `发送失败：${error.message}`
        pending.durationMs = Date.now() - startedAt
        pending.pending = false
        backendState.history[0] = { ...pending }
        renderBackendLog()
      } finally {
        backendState.busy = false
        if (button) button.disabled = false
        input.focus()
      }
    })
  }

  /* ---------------- 全局搜索 ---------------- */

  function paletteActions() {
    const query = state.palette.query.trim();
    const actions = [];

    if (query) {
      actions.push({
        id: "search-kb",
        label: `在知识库中搜索「${query}」`,
        sub: "搜索",
        icon: "search",
        run: () => openKnowledgeSearch(query),
      });
      actions.push({
        id: "search-plugins",
        label: `在插件中搜索「${query}」`,
        sub: "搜索",
        icon: "search",
        run: () => openPluginSearch(query),
      });
    }

    NAV_ITEMS.forEach(item => {
      actions.push({
        id: `nav-${item.id}`,
        label: item.label,
        sub: item.group,
        icon: item.icon,
        keywords: item.keywords,
        run: () => showPage(item.id),
      });
    });

    actions.push(
      { id: "refresh", label: "刷新当前页面", sub: "操作", icon: "refresh", run: refreshCurrent },
      {
        id: "theme",
        label: state.theme === "dark" ? "切换到浅色主题" : "切换到深色主题",
        sub: "外观",
        icon: state.theme === "dark" ? "sun" : "moon",
        run: toggleTheme,
      },
      { id: "add-kb", label: "添加知识", sub: "操作", icon: "plus", run: () => openKbModal(), disabled: !state.allowWrite },
      { id: "export-kb", label: "导出知识库 JSON", sub: "操作", icon: "download", run: exportKnowledge },
      {
        id: "error-logs",
        label: "查看错误日志",
        sub: "操作",
        icon: "file",
        run: () => {
          state.logs.type = "error";
          updateLogTypeButtons();
          showPage("logs");
        },
      },
    );

    return actions;
  }

  function filterPalette(actions) {
    const query = state.palette.query.trim().toLowerCase();
    if (!query) return actions;
    return actions.filter(action => {
      if (action.id.startsWith("search-")) return true;
      return `${action.label} ${action.sub || ""} ${action.keywords || ""}`.toLowerCase().includes(query);
    });
  }

  function renderPalette() {
    const items = filterPalette(paletteActions());
    state.palette.items = items;
    if (state.palette.index >= items.length) state.palette.index = Math.max(0, items.length - 1);

    const list = $("#paletteList");
    if (!items.length) {
      list.innerHTML = `<div class="empty" style="padding:30px 20px"><strong>没有匹配的结果</strong><p>试试页面名称、插件或知识关键词。</p></div>`;
      return;
    }

    let html = "";
    let group = "";
    items.forEach((item, index) => {
      if (item.sub !== group) {
        group = item.sub || "";
        html += `<div class="palette-group">${esc(group)}</div>`;
      }
      html += `<button type="button" class="palette-item ${index === state.palette.index ? "active" : ""}" data-palette-index="${index}">
        ${icon(item.icon)}
        <span>${esc(item.label)}</span>
        ${item.disabled ? `<span class="pi-sub">只读</span>` : ""}
      </button>`;
    });
    list.innerHTML = html;
  }

  function movePalette(delta) {
    const items = state.palette.items;
    if (!items.length) return;
    state.palette.index = (state.palette.index + delta + items.length) % items.length;
    $$(".palette-item", $("#paletteList")).forEach((button, index) => {
      button.classList.toggle("active", index === state.palette.index);
    });
    const active = $(".palette-item.active", $("#paletteList"));
    if (active) active.scrollIntoView({ block: "nearest" });
  }

  function runPaletteActive() {
    const item = state.palette.items[state.palette.index];
    if (!item) return;
    if (item.disabled) {
      toast("WebUI 当前为只读模式", "info");
      return;
    }
    closePalette();
    try {
      const result = item.run();
      if (result && typeof result.catch === "function") result.catch(handleError);
    } catch (error) {
      handleError(error);
    }
  }

  function openPalette(prefill) {
    if (!$("#login").hidden) return;
    closeSidebar();
    state.palette.open = true;
    state.palette.query = prefill || "";
    state.palette.index = 0;
    $("#palette").hidden = false;
    $("#paletteInput").value = state.palette.query;
    renderPalette();
    window.setTimeout(() => $("#paletteInput").focus(), 0);
  }

  function closePalette() {
    state.palette.open = false;
    $("#palette").hidden = true;
  }

  function openKnowledgeSearch(query) {
    showPage("knowledge", { skipLoad: true });
    state.kb.query = query;
    state.kb.scope = "";
    state.kb.tag = "";
    $("#kbSearch").value = query;
    loadKnowledge({ query, scope: "", tag: "", resetPage: true }).catch(handleError);
  }

  function openPluginSearch(query) {
    showPage("plugins", { skipLoad: true });
    state.pluginManager.query = query;
    $("#pluginSearch").value = query;
    loadPlugins()
      .then(data => {
        const needle = query.trim().toLowerCase();
        const installedMatch = (data.plugins || []).some(plugin => plugin.installed && pluginMatches(plugin, needle));
        if (!installedMatch) state.pluginManager.tab = "available";
        renderPlugins();
      })
      .catch(handleError);
  }

  /* ---------------- 设置（ai.yaml） ---------------- */

  const AI_YAML_VIEWS = {
    "ai-system": {
      title: "设置",
      description: "",
      sections: [
        {
          title: "",
          keys: [
            "enabled", "masterName", "privateChat", "privateWhitelist", "privateBlacklist", "groupChat",
            "triggerAt", "triggerPrefix", "triggerKeyword",
            "triggerKeywords", "triggerFree", "replyQuote", "pokeReply", "masterFree",
            "freeJudgeModel", "freeJudgeMaxTokens", "freeJudgeTimeout", "freeUserCooldown",
            "freeMaxPerMinute", "freeMinLength", "freeIgnorePrefixes", "mergeWindowMs",
          ],
        },
        {
          title: "请求",
          keys: ["timeout", "maxRetries"],
        },
        {
          title: "上下文与压缩",
          keys: [
            "maxContextTokens", "maxHistoryTurns", "enableCompression", "compressionThreshold",
            "compressionKeepRecentTurns", "compressionSummaryMaxLength",
          ],
        },
      ],
      wideKeys: ["masterName"],
    },
  };

  async function loadAiYamlPage(view, force) {
    const main = $(CONFIG_VIEWS[view].main);
    if (!main) return null;
    if (!force && state.aiYaml.detail) {
      renderAiYamlPage(view);
      // ai.yaml 可以缓存，主动聊天是独立接口，每次进页面都重新取，否则改了也看不到新值
      if (view === "ai-system") loadProactiveConfig().then(() => mountProactiveBlock(view)).catch(() => {});
      return state.aiYaml.detail;
    }
    main.innerHTML = configLoadingHtml("正在读取 config/config/ai.yaml…");
    try {
      // 自由判定模型要用模型池下拉，先确保模型列表已加载
      if (view === "ai-system" && !state.aiModels) await loadAIModels().catch(() => {});
      if (view === "ai-system") await loadProactiveConfig().catch(() => {});
      const detail = await api("/config/file/ai");
      const fields = detail.fields || [];
      state.aiYaml.detail = detail;
      for (const [id, meta] of Object.entries(AI_YAML_VIEWS)) {
        const byKey = new Map(fields.map(field => [String((field.path && field.path[0]) || field.key), field]));
        const wideKeys = new Set(meta.wideKeys || []);
        const shape = field =>
          wideKeys.has(String((field.path && field.path[0]) || field.key)) ? { ...field, wide: true } : field;
        const sections = (meta.sections || []).map(section => ({
          title: section.title || "",
          fields: section.keys.map(key => byKey.get(key)).filter(Boolean).map(shape),
        }));
        state.aiYaml[id] = {
          ...detail,
          title: meta.title,
          description: meta.description,
          sections,
          fields: sections.flatMap(section => section.fields),
        };
      }
      renderAiYamlPage(view);
      if (view === "ai-system") {
        loadAiRuntimeStats().catch(() => {});
        renderModelFallbackPanel().catch(() => {});
      }
      return detail;
    } catch (error) {
      main.innerHTML = configErrorHtml(error, view);
      throw error;
    }
  }

  function renderAiYamlPage(view) {
    const detail = configDetail(view);
    const main = $(CONFIG_VIEWS[view].main);
    if (!detail || !main) return;
    if (Array.isArray(detail.sections) && detail.sections.length) {
      renderAiSectionedPanel(view, detail, main);
    } else {
      main.innerHTML = configPanelHtml(detail, view, {
        title: detail.title,
        description: detail.description,
        badge: "ai.yaml",
        note: "",
      });
    }
    syncAiKeywordSwitch(view);
    mountProactiveBlock(view);
    updateConfigDirty(view);
  }

  /** 分区视图：平铺的分区标题，共用一个保存按钮 */
  function renderAiSectionedPanel(view, detail, main) {
    const lockedNote = state.allowWrite ? "" : `<div class="config-readonly">${icon("lock")}WebUI 当前为只读模式，保存操作已禁用。</div>`;
    const sections = detail.sections
      .map(section => {
        const fields = section.fields || [];
        if (!fields.length) return "";
        return `<div class="config-section">
          ${section.title ? `<div class="config-section-title">${esc(section.title)}</div>` : ""}
          <div class="config-fields">${fields.map(field => configFieldHtml(field, {})).join("")}</div>
        </div>`;
      })
      .join("");
    main.innerHTML = `<div class="config-main-head">
      <div><h3>${esc(detail.title || "配置")}</h3></div>
      <div class="config-main-actions">${pill("ai.yaml", "pill-blue")}
        <button class="btn btn-primary" type="button" data-config-save="${view}" ${
          state.allowWrite ? "" : 'disabled title="WebUI 当前为只读模式"'
        }>${icon("save")}保存修改</button>
      </div>
    </div>
    ${lockedNote}
    <div class="config-form ai-sectioned" data-config-form="${view}">${sections}</div>
    <div class="config-foot"><span class="config-dirty" data-config-dirty="${view}">未修改</span></div>`;
  }

  const AI_SHARED_FIELD_GROUPS = {
    knowledge: {
      title: "知识库参数",
      hint: "存储、容量、归档与检索排序；改动写入 config/config/ai.yaml",
      keys: [
        "enableKnowledgeBase", "kbMaxEntries", "kbStoragePath", "kbArchivePath", "kbMaxEntrySize",
        "kbColdAfterDays", "kbRecencyHalfLifeDays", "kbMergeSimilarity",
      ],
      mount: "#kbSharedParams",
    },
  }

  const aiSharedCache = { detail: null, at: 0 }

  /** 把 ai.yaml 的一组参数嵌到其它页面，各自带保存按钮 */
  async function mountAiSharedParams(name) {
    const meta = AI_SHARED_FIELD_GROUPS[name]
    const root = meta ? $(meta.mount) : null
    if (!meta || !root) return
    root.innerHTML = `<div class="config-loading"><span class="spinner"></span>正在读取 ai.yaml…</div>`
    try {
      if (!aiSharedCache.detail || Date.now() - aiSharedCache.at > 15000) {
        aiSharedCache.detail = await api("/config/file/ai")
        aiSharedCache.at = Date.now()
      }
      const byKey = new Map(
        (aiSharedCache.detail.fields || []).map(field => [String((field.path && field.path[0]) || field.key), field]),
      )
      const fields = meta.keys.map(key => byKey.get(key)).filter(Boolean)
      const locked = state.allowWrite ? "" : "disabled"
      root.innerHTML = `<div class="card-head">
          <div><h3>${esc(meta.title)}</h3><p>${esc(meta.hint)}</p></div>
          <button class="btn btn-primary btn-sm" type="button" data-ai-shared-save="${name}" ${locked}>${icon("save")}保存</button>
        </div>
        <div class="card-body"><div class="config-form" data-config-form="ai-shared-${name}">
          ${configFieldsHtml(fields, { sectionKey: `ai-shared:${name}` })}
        </div></div>`
      root.querySelector("[data-ai-shared-save]")?.addEventListener("click", async event => {
        const button = event.currentTarget
        const updates = []
        for (const field of fields) {
          const node = root.querySelector(`[data-config-key="${configPathKey(field)}"]`)
          if (!node) continue
          let value
          try {
            value = collectFieldValue(node, field)
          } catch (error) {
            return toast(`${field.label || configPathKey(field)}：${error.message}`, "error")
          }
          if (field.secret && (value === "" || value === null || value === undefined)) continue
          if (configEqual(value, field.value)) continue
          updates.push({ path: field.path, value })
        }
        if (!updates.length) return toast("没有需要保存的修改", "info")
        setBusy(button, true)
        try {
          const result = await api("/config/file/ai", { method: "POST", body: { updates } })
          aiSharedCache.at = 0
          toast(result.message || "已保存", "success")
          await mountAiSharedParams(name)
        } catch (error) {
          handleError(error)
        } finally {
          setBusy(button, false)
          button.disabled = !state.allowWrite
        }
      })
    } catch (error) {
      root.innerHTML = `<div class="config-loading">${esc(error.message || "读取 ai.yaml 失败")}</div>`
    }
  }

  // 关键词列表非空时自动开启并锁定触发开关，和群设置保持一致
  function syncAiKeywordSwitch(view) {    if (view !== "ai-system") return;
    const main = $(CONFIG_VIEWS[view].main);
    if (!main) return;
    const keywordNode = $('[data-config-key="triggerKeywords"]', main);
    const switchNode = $('[data-config-key="triggerKeyword"]', main);
    const input = switchNode ? $('input[type="checkbox"]', switchNode) : null;
    if (!keywordNode || !input) return;
    const hasKeywords = $$(".config-tag", keywordNode).some(tag => String(tag.dataset.tagValue || "").trim());
    if (hasKeywords) input.checked = true;
    input.disabled = !state.allowWrite || hasKeywords;
    switchNode.classList.toggle("is-locked", hasKeywords);
    const text = switchNode.querySelector(".config-switch-text");
    if (text) text.textContent = input.checked ? "开启" : "关闭";
  }

  async function loadAiRuntimeStats() {
    const data = await api("/ai/runtime");
    state.aiYaml.runtime = data;
    const root = $("#aiSystemStats");
    if (!root) return;
    const mcpConnected = (data.mcp || []).filter(item => item.connected).length;
    root.innerHTML = [
      miniStat("运行状态", data.ready ? "已就绪" : data.enabled ? "等待渠道" : "未启用", "spark", 1),
      miniStat("当前渠道", data.channel?.name || "默认配置", "database", 2),
      miniStat("当前预设", data.preset?.name || "内置", "sliders", 3),
      miniStat("代理 / MCP", `${data.proxyEnabled ? "代理开" : "无代理"} · ${mcpConnected} 个 MCP`, "arrow", 4),
    ].join("");
  }

  /* ---------------- 状态页列表（预设 / 渠道 / 代理 / 技能 / MCP / 绘图） ---------------- */

  const AI_SECTION_PAGES = {
    "ai-presets": { section: "presets", label: "预设", icon: "sliders", addLabel: "新建预设" },
    "ai-channels": { section: "channels", label: "渠道", icon: "database", addLabel: "新建渠道" },
    "ai-proxies": { section: "proxies", label: "代理", icon: "arrow", addLabel: "新建代理" },
    "ai-skills": { section: "skills", label: "技能", icon: "puzzle", addLabel: "新建技能" },
    "ai-mcp": { section: "mcpServers", label: "MCP 服务", icon: "puzzle", addLabel: "添加服务" },
    "ai-image": { section: "imagePresets", label: "绘图预设", icon: "spark", addLabel: "新建预设" },
  };

  const AI_SECTION_ENDPOINTS = {
    presets: "/ai/presets",
    channels: "/ai/channels",
    proxies: "/ai/proxies",
    skills: "/ai/skills",
    mcpServers: "/ai/mcp",
    imagePresets: "/ai/image-presets",
  };

  const AI_SECTION_ELEMENT = {
    presets: "Presets",
    channels: "Channels",
    proxies: "Proxies",
    skills: "Skills",
    mcpServers: "McpServers",
    imagePresets: "ImagePresets",
  };

  const AI_SECTION_META = {};
  for (const [page, meta] of Object.entries(AI_SECTION_PAGES)) AI_SECTION_META[meta.section] = { page, ...meta };

  const AI_MODE_LABELS = { auto: "自动匹配", always: "常驻注入", manual: "手动引用" };
  const AI_QUALITY_LABELS = { standard: "标准", hd: "高清", low: "低", medium: "中", high: "高", auto: "自动" };
  const AI_STYLE_LABELS = { vivid: "生动", natural: "自然" };
  const AI_KEY_STRATEGIES = [
    { value: "roundRobin", label: "轮询" },
    { value: "random", label: "随机" },
    { value: "weighted", label: "按权重" },
    { value: "leastUsed", label: "最少使用" },
    { value: "failover", label: "故障转移" },
  ];

  const AI_THINKING_LABELS = {
    minimal: "极低",
    low: "低",
    medium: "中",
    high: "高",
    xhigh: "极高",
    auto: "自动",
  };
  const AI_THINKING_OPTIONS = [
    { value: "minimal", label: "极低" },
    { value: "low", label: "低" },
    { value: "medium", label: "中" },
    { value: "high", label: "高" },
    { value: "xhigh", label: "极高" },
    { value: "auto", label: "自动" },
  ];
  const AI_DANGER_LABELS = { low: "低风险", medium: "中风险", high: "高风险" };
  const AI_DANGER_PILLS = { low: "pill-green", medium: "pill-amber", high: "pill-red" };
  const AI_TOOL_PERMISSION_LABELS = {
    inherit: "跟随全局",
    public: "仅公开",
    admin: "公开 + 管理员",
    owner: "公开 + 群主",
    master: "全部（含主人）",
  };

  const AI_CHANNEL_PROVIDER_GROUPS = [
    { value: "international", label: "国际厂商" },
    { value: "domestic", label: "国内厂商" },
    { value: "relay", label: "中转服务" },
    { value: "custom", label: "自定义" },
  ];

  const AI_CHANNEL_PROVIDERS = [
    {
      value: "openai",
      name: "OpenAI",
      label: "OpenAI",
      group: "international",
      description: "OpenAI 官方 API（Chat Completions）",
      baseURL: "https://api.openai.com/v1",
      adapterType: "openai",
      apiFormat: "chat",
      models: ["gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4o", "o3", "o4-mini"],
    },
    {
      value: "gemini",
      name: "Gemini",
      label: "Google Gemini（原生）",
      group: "international",
      description: "Google Gemini 原生 generateContent 接口",
      baseURL: "https://generativelanguage.googleapis.com",
      adapterType: "gemini",
      models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
    },
    {
      value: "gemini-openai",
      name: "Gemini（兼容）",
      label: "Google Gemini（OpenAI 兼容）",
      group: "international",
      description: "Google Gemini 的 OpenAI 兼容接口",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
      adapterType: "openai",
      apiFormat: "chat",
      models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
    },
    {
      value: "claude",
      name: "Claude",
      label: "Anthropic Claude（原生）",
      group: "international",
      description: "Anthropic Claude 原生 Messages API",
      baseURL: "https://api.anthropic.com",
      adapterType: "claude",
      models: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5", "claude-3-7-sonnet-latest"],
    },
    {
      value: "groq",
      name: "Groq",
      label: "Groq",
      group: "international",
      description: "Groq 高速推理",
      baseURL: "https://api.groq.com/openai/v1",
      models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "qwen/qwen3-32b"],
    },
    {
      value: "mistral",
      name: "Mistral",
      label: "Mistral AI",
      group: "international",
      description: "Mistral 官方 API",
      baseURL: "https://api.mistral.ai/v1",
      models: ["mistral-large-latest", "mistral-small-latest", "codestral-latest"],
    },
    {
      value: "xai",
      name: "Grok",
      label: "xAI Grok",
      group: "international",
      description: "xAI Grok 官方 API",
      baseURL: "https://api.x.ai/v1",
      models: ["grok-4", "grok-3", "grok-3-mini"],
    },
    {
      value: "deepseek",
      name: "DeepSeek",
      label: "DeepSeek",
      group: "domestic",
      description: "DeepSeek 官方 API",
      baseURL: "https://api.deepseek.com/v1",
      models: ["deepseek-chat", "deepseek-reasoner"],
    },
    {
      value: "siliconflow",
      name: "硅基流动",
      label: "硅基流动 SiliconFlow",
      group: "domestic",
      description: "硅基流动模型聚合（国内中转）",
      baseURL: "https://api.siliconflow.cn/v1",
      models: [
        "deepseek-ai/DeepSeek-V3",
        "deepseek-ai/DeepSeek-V3.1",
        "deepseek-ai/DeepSeek-R1",
        "Qwen/Qwen3-235B-A22B",
        "Qwen/Qwen3-32B",
        "Qwen/Qwen2.5-72B-Instruct",
        "moonshotai/Kimi-K2-Instruct",
        "zai-org/GLM-4.5",
      ],
    },
    {
      value: "dashscope",
      name: "通义千问",
      label: "通义千问 DashScope",
      group: "domestic",
      description: "阿里云百炼 / DashScope 兼容接口",
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      models: ["qwen-max", "qwen-plus", "qwen-turbo", "qwen3-235b-a22b"],
    },
    {
      value: "zhipu",
      name: "智谱GLM",
      label: "智谱 GLM",
      group: "domestic",
      description: "智谱开放平台",
      baseURL: "https://open.bigmodel.cn/api/paas/v4",
      models: ["glm-4.5", "glm-4.5-air", "glm-4-plus", "glm-4-flash", "glm-4v-plus"],
    },
    {
      value: "moonshot",
      name: "Kimi",
      label: "Moonshot Kimi",
      group: "domestic",
      description: "月之暗面 Kimi 开放平台",
      baseURL: "https://api.moonshot.cn/v1",
      models: ["kimi-k2-0711-preview", "kimi-latest", "moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    },
    {
      value: "baichuan",
      name: "百川智能",
      label: "百川智能",
      group: "domestic",
      description: "百川大模型开放平台",
      baseURL: "https://api.baichuan-ai.com/v1",
      models: ["Baichuan4", "Baichuan3-Turbo"],
    },
    {
      value: "yi",
      name: "零一万物",
      label: "零一万物 Yi",
      group: "domestic",
      description: "零一万物开放平台",
      baseURL: "https://api.lingyiwanwu.com/v1",
      models: ["yi-lightning", "yi-large"],
    },
    {
      value: "hunyuan",
      name: "腾讯混元",
      label: "腾讯混元",
      group: "domestic",
      description: "腾讯混元 OpenAI 兼容接口",
      baseURL: "https://api.hunyuan.cloud.tencent.com/v1",
      models: ["hunyuan-turbos-latest", "hunyuan-large"],
    },
    {
      value: "volcengine",
      name: "火山方舟",
      label: "火山方舟（豆包）",
      group: "domestic",
      description: "火山方舟需要填写推理接入点 ID 或模型名",
      baseURL: "https://ark.cn-beijing.volces.com/api/v3",
      models: [],
    },
    {
      value: "openrouter",
      name: "OpenRouter",
      label: "OpenRouter",
      group: "relay",
      description: "OpenRouter 多模型聚合",
      baseURL: "https://openrouter.ai/api/v1",
      models: [
        "openai/gpt-4o",
        "anthropic/claude-sonnet-4",
        "google/gemini-2.5-pro",
        "deepseek/deepseek-chat-v3-0324",
      ],
    },
    {
      value: "together",
      name: "Together",
      label: "Together AI",
      group: "relay",
      description: "Together AI 开源模型托管",
      baseURL: "https://api.together.xyz/v1",
      models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "Qwen/Qwen2.5-72B-Instruct-Turbo"],
    },
    {
      value: "fireworks",
      name: "Fireworks",
      label: "Fireworks AI",
      group: "relay",
      description: "Fireworks AI 推理服务",
      baseURL: "https://api.fireworks.ai/inference/v1",
      models: ["accounts/fireworks/models/llama-v3p1-70b-instruct"],
    },
    {
      value: "novita",
      name: "Novita",
      label: "Novita AI",
      group: "relay",
      description: "Novita AI 模型服务",
      baseURL: "https://api.novita.ai/v3/openai",
      models: ["meta-llama/llama-3.3-70b-instruct", "deepseek/deepseek-r1"],
    },
    {
      value: "custom",
      name: "自定义",
      label: "自定义 / 其他 OpenAI 兼容",
      group: "custom",
      description: "手动填写任意 OpenAI 兼容接口地址",
      baseURL: "",
      models: [],
    },
  ];

  function aiProviderPreset(value) {
    return (
      AI_CHANNEL_PROVIDERS.find(item => item.value === value) ||
      AI_CHANNEL_PROVIDERS[AI_CHANNEL_PROVIDERS.length - 1]
    );
  }

  function aiProviderLabel(value) {
    return AI_CHANNEL_PROVIDERS.find(item => item.value === value)?.label || value || "OpenAI";
  }

  function aiProviderName(value) {
    return AI_CHANNEL_PROVIDERS.find(item => item.value === value)?.name || value || "OpenAI";
  }

  const AI_CHANNEL_ADAPTERS = [
    { value: "openai", label: "OpenAI" },
    { value: "gemini", label: "Gemini" },
    { value: "claude", label: "Claude" },
  ];

  const AI_CHANNEL_API_FORMATS = [
    { value: "chat", label: "Chat Completions" },
    { value: "responses", label: "Responses API" },
  ];

  const AI_CHANNEL_PATH_DEFAULTS = {
    openai: {
      baseURL: "https://api.openai.com/v1",
      chatPath: "/chat/completions",
      modelsPath: "/models",
      responsePath: "/responses",
    },
    gemini: {
      baseURL: "https://generativelanguage.googleapis.com",
      chatPath: "/v1beta/models/{model}:generateContent",
      modelsPath: "/v1beta/models",
      responsePath: "",
    },
    claude: {
      baseURL: "https://api.anthropic.com",
      chatPath: "/v1/messages",
      modelsPath: "/v1/models",
      responsePath: "",
    },
  };

  function channelAdapterLabel(item) {
    const adapter = item?.adapterType || "openai";
    if (adapter === "gemini") return "Gemini 原生";
    if (adapter === "claude") return "Claude 原生";
    return item?.apiFormat === "responses" ? "OpenAI · Responses" : "OpenAI · Chat";
  }

  const AI_CHANNEL_TEST_FILTERS = [
    { value: "all", label: "全部" },
    { value: "success", label: "成功" },
    { value: "failed", label: "失败" },
    { value: "pending", label: "待测试" },
  ];

  function channelTestStatus(item) {
    const status = item?.testStatus;
    return status === "success" || status === "failed" ? status : "pending";
  }

  function channelTestPill(item) {
    const status = channelTestStatus(item);
    if (status === "success") return pill("测试成功", "pill-green");
    if (status === "failed") return pill("测试失败", "pill-red");
    return pill("待测试", "pill-outline");
  }

  function channelModelList(item) {
    return [
      ...new Set([
        ...(Array.isArray(item?.models) ? item.models : []),
        ...(item?.model ? [item.model] : []),
        ...Object.keys(item?.modelTests || {}),
      ]),
    ].filter(Boolean);
  }

  function normalizeChannelBaseURL(value) {
    return String(value || "")
      .trim()
      .replace(/\/+$/, "")
      .replace(/\/(?:chat\/completions|completions|responses|messages)$/i, "");
  }

  function aiProviderOptionsHtml(selected) {
    const options = [];
    for (const group of AI_CHANNEL_PROVIDER_GROUPS) {
      const items = AI_CHANNEL_PROVIDERS.filter(item => item.group === group.value);
      if (!items.length) continue;
      options.push(
        `<optgroup label="${esc(group.label)}">${items
          .map(item => `<option value="${esc(item.value)}" ${item.value === selected ? "selected" : ""}>${esc(item.label)}</option>`)
          .join("")}</optgroup>`,
      );
    }
    if (selected && !AI_CHANNEL_PROVIDERS.some(item => item.value === selected))
      options.unshift(`<option value="${esc(selected)}" selected>${esc(selected)}（原值）</option>`);
    return options.join("");
  }

  function dangerLabel(level) {
    return AI_DANGER_LABELS[level] || "低风险";
  }

  function dangerPill(level) {
    const key = AI_DANGER_LABELS[level] ? level : "low";
    return pill(dangerLabel(key), AI_DANGER_PILLS[key]);
  }

  const AI_FIELD_DEFS = {
    presets: [
      { key: "name", label: "名称", required: true, placeholder: "例如：日常闲聊" },
      { key: "roleName", label: "角色名称", placeholder: "AI 扮演的角色名", hint: "留空则使用机器人名称" },
      { key: "description", label: "描述", placeholder: "用途说明" },
      { key: "personality", label: "性格", type: "textarea", wide: true, rows: 3, placeholder: "例如：冷静、毒舌但心软，重视承诺" },
      { key: "likes", label: "喜欢", type: "textarea", rows: 2, placeholder: "例如：薄荷茶、夜跑、机械键盘" },
      { key: "dislikes", label: "讨厌", type: "textarea", rows: 2, placeholder: "例如：撒谎、争吵、浪费" },
      { key: "speakingStyle", label: "说话风格", type: "textarea", wide: true, rows: 3, placeholder: "例如：句子简短，偶尔毒舌，不说客套话" },
      { key: "prefixes", label: "触发前缀", type: "list", wide: true, hint: "该预设专属的触发词，命中即唤醒并自动剥离；与群设置里的别名并存，留空表示不用前缀" },
      { key: "thinkingLevel", label: "思考级别", type: "select", default: "auto", options: AI_THINKING_OPTIONS, hint: "影响提示词；推理模型会同时发送 reasoning_effort，自动表示交给服务商决定" },
      { key: "toolPermission", label: "工具权限上限", type: "select", options: [{ value: "inherit", label: "跟随全局" }, { value: "public", label: "仅公开工具" }, { value: "admin", label: "公开 + 管理员" }, { value: "owner", label: "公开 + 群主" }, { value: "master", label: "全部（含主人）" }] },
      { key: "maxDangerLevel", label: "危险等级上限", type: "select", options: [{ value: "inherit", label: "跟随全局" }, { value: "low", label: "仅低风险" }, { value: "medium", label: "低 + 中风险" }, { value: "high", label: "全部（含高风险）" }], hint: "高风险工具通常涉及删除、安装、禁言等操作" },
      { key: "turnLimit", label: "轮数限制", type: "number", min: "0", hint: "窗口内最多回复多少轮，0 或留空不限制" },
      { key: "turnWindowMinutes", label: "恢复时长（分钟）", type: "number", min: "1", hint: "超过该时长后轮数重新计数" },
      { key: "extraTokenBudget", label: "额外额度（tokens）", type: "number", min: "0", hint: "轮数用尽后可继续消耗的 token 数，0 表示不追加" },
      { key: "budgetNotice", label: "额度耗尽提示语", type: "textarea", wide: true, rows: 2, placeholder: "留空使用默认提示", hint: "支持 {turns}（轮数）、{hours}（小时）、{extra}（额外额度）、{group}（群名）" },
      { key: "model", label: "模型", type: "model-pool", hint: "跟随当前模型，或为该预设固定一个模型；固定后会覆盖渠道模型" },
      { key: "temperature", label: "温度", type: "number", step: "0.1", min: "0", max: "2", hint: "0-2，越高越随机" },
      { key: "topP", label: "Top P", type: "number", step: "0.05", min: "0", max: "1" },
      { key: "maxTokens", label: "最大输出", type: "number", min: "1", hint: "tokens" },
      { key: "maxContextTokens", label: "上下文上限", type: "number", min: "1000", hint: "tokens，留空沿用系统" },
      { key: "maxHistoryTurns", label: "历史轮数", type: "number", min: "0", hint: "留空沿用全局；0 表示不保留历史" },
      { key: "maxReplyChars", label: "回复字数上限", type: "number", min: "0", hint: "单条回复最多多少字，0 表示不限制；群聊建议 100-200" },
      { key: "stickerTags", label: "角色表情标签", type: "list", hint: "角色名或作品名，如「今汐」；开启只发自己的表情后，只使用带这些标签的表情" },
      { key: "stickersOwnOnly", label: "只发自己的表情", type: "switch", default: false, hint: "按上面的角色标签筛选：只发这个角色/作品的表情，上传时标签也要带上它" },
      { key: "systemPrompt", label: "系统提示词", type: "textarea", wide: true, rows: 8, hint: "留空使用内置提示词；支持 {bot_name}、{master_name}、{role_name}、{personality}、{likes}、{dislikes}、{speaking_style}" },
    ],
    channels: [
      { key: "name", label: "渠道名称", required: true, placeholder: "例如：OpenAI 主渠道" },
      {
        key: "provider",
        label: "服务商预设",
        type: "select",
        default: "openai",
        options: AI_CHANNEL_PROVIDERS.map(item => ({ value: item.value, label: item.label })),
        hint: "选择后自动填入适配器、接口地址与常用模型，仍可手动调整",
      },
      {
        key: "adapterType",
        label: "适配器",
        type: "select",
        default: "openai",
        options: AI_CHANNEL_ADAPTERS,
      },
      {
        key: "apiFormat",
        label: "接口格式",
        type: "select",
        default: "chat",
        options: AI_CHANNEL_API_FORMATS,
        adapterScope: "openai",
        hint: "Chat Completions 兼容性最好；Responses API 适用于支持新接口的服务",
      },
      { key: "baseURL", label: "接口地址", placeholder: "https://api.openai.com/v1", wide: true },
      { key: "apiKey", label: "API Key", type: "password", wide: true, hint: "单个 Key 时填这里；多个 Key 请用下面的「多 Key」" },
      { key: "apiKeys", label: "多 Key", type: "api-keys", wide: true, hint: "同一渠道可配多个 Key，按下方策略轮换" },
      {
        key: "keyStrategy",
        label: "Key 使用策略",
        type: "select",
        default: "roundRobin",
        options: AI_KEY_STRATEGIES,
        hint: "轮询最均衡；权重适合按额度分配；最少使用会自动避开高频 Key；故障转移只在失败时切换",
      },
      { key: "stream", label: "流式输出", type: "switch", default: false, hint: "边生成边分段发送；仅 OpenAI Chat 格式生效" },
      { key: "models", label: "模型列表", type: "models", wide: true },
      { key: "model", label: "默认模型", type: "channel-default" },
      { key: "priority", label: "优先级", type: "number", hint: "数字越大越优先" },
      { key: "enabled", label: "启用渠道", type: "switch", default: true },
      { key: "chatPath", label: "对话路径", advanced: true, pathRole: "chatPath", hint: "留空使用适配器默认路径；支持 {model} 占位符" },
      { key: "responsePath", label: "Responses 路径", advanced: true, adapterScope: "openai", pathRole: "responsePath", hint: "仅 OpenAI Responses 格式使用；留空使用默认路径" },
      { key: "modelsPath", label: "模型列表路径", advanced: true, pathRole: "modelsPath", hint: "留空使用适配器默认路径；获取模型时使用" },
      { key: "temperature", label: "温度", type: "number", step: "0.1", min: "0", max: "2", advanced: true },
      { key: "topP", label: "Top P", type: "number", step: "0.05", min: "0", max: "1", advanced: true },
      { key: "maxTokens", label: "最大输出", type: "number", min: "1", advanced: true },
      { key: "timeout", label: "超时 (ms)", type: "number", min: "1000", advanced: true },
    ],
    proxies: [
      { key: "name", label: "名称", required: true, placeholder: "例如：本地代理" },
      { key: "url", label: "代理地址", placeholder: "http://127.0.0.1:7890", wide: true, hint: "支持 http / https / socks 代理 URL，凭据会掩码显示" },
      { key: "scope", label: "作用范围", type: "select", options: [{ value: "api", label: "仅 AI 接口" }, { value: "all", label: "全部请求" }] },
      { key: "enabled", label: "启用代理", type: "switch", default: true },
      { key: "clearUrl", label: "清除代理地址", type: "switch", onlyExisting: true },
    ],
    skills: [
      { key: "name", label: "名称", required: true, placeholder: "例如：代码审查" },
      { key: "description", label: "描述", placeholder: "技能用途" },
      { key: "mode", label: "触发模式", type: "select", options: [{ value: "auto", label: "自动匹配关键词" }, { value: "always", label: "每次对话常驻" }, { value: "manual", label: "仅手动引用" }] },
      { key: "enabled", label: "启用技能", type: "switch", default: true },
      { key: "keywords", label: "关键词", type: "list", wide: true, hint: "逗号或换行分隔，命中后注入技能指令" },
      { key: "tools", label: "建议工具", type: "list", wide: true, hint: "提示 AI 优先使用这些工具，不强制绑定" },
      { key: "instructions", label: "技能指令", type: "textarea", wide: true, rows: 8, hint: "会追加到系统提示词中" },
    ],
    mcpServers: [
      { key: "name", label: "名称", required: true, placeholder: "例如：filesystem" },
      { key: "transport", label: "传输方式", type: "select", options: [{ value: "stdio", label: "stdio（本地进程）" }, { value: "http", label: "Streamable HTTP" }] },
      { key: "permission", label: "调用权限", type: "select", options: [{ value: "all", label: "所有人" }, { value: "master", label: "仅主人" }, { value: "owner", label: "群主" }, { value: "admin", label: "管理员" }] },
      { key: "command", label: "启动命令", placeholder: "npx", hint: "stdio 模式必填，例如 npx / node / uvx" },
      { key: "args", label: "命令参数", type: "lines", wide: true, rows: 4, hint: "每行一个参数" },
      { key: "env", label: "环境变量（JSON）", type: "json", wide: true, rows: 4, hint: "敏感值会掩码显示；保留掩码不会覆盖原值" },
      { key: "url", label: "服务地址", placeholder: "http://127.0.0.1:3000/mcp", wide: true, hint: "HTTP 模式必填" },
      { key: "headers", label: "请求头（JSON）", type: "json", wide: true, rows: 4 },
      { key: "timeout", label: "超时 (ms)", type: "number", min: "1000" },
      { key: "enabled", label: "启用并自动连接", type: "switch", default: true },
    ],
    imagePresets: [
      { key: "name", label: "名称", required: true, placeholder: "例如：横版插画" },
      { key: "model", label: "模型", placeholder: "dall-e-3" },
      { key: "size", label: "尺寸", placeholder: "1024x1024" },
      { key: "quality", label: "质量", type: "select", options: [{ value: "standard", label: "标准" }, { value: "hd", label: "高清" }, { value: "low", label: "低" }, { value: "medium", label: "中" }, { value: "high", label: "高" }, { value: "auto", label: "自动" }] },
      { key: "style", label: "风格", type: "select", options: [{ value: "vivid", label: "生动" }, { value: "natural", label: "自然" }] },
      { key: "promptPrefix", label: "提示词前缀", type: "textarea", wide: true, rows: 4, hint: "会自动拼接到每次绘图提示词前" },
      { key: "enabled", label: "启用预设", type: "switch", default: true },
    ],
  };

  /* ---------------- 备选模型轮询（并入驻 AI 状态页） ---------------- */

  /** 备选模型池面板：按渠道分组多选，保存为「渠道ID::模型名」 */
  async function renderModelFallbackPanel() {
    const panel = $("#aiModelFallbackPanel");
    if (!panel) return;
    panel.innerHTML = '<div class="muted">正在加载…</div>';
    try {
      // 模型池已由页面加载时拉过，这里不重复请求
      const [data, models] = await Promise.all([
        api("/ai/model-fallback"),
        state.aiModels ? Promise.resolve(state.aiModels) : loadAIModels().catch(() => null),
      ]);
      const cfg = data.config || {};
      const pool = models || state.aiModels || {};
      const channels = pool.channels || [];
      const activeChannelId = pool.activeChannelId || pool.effectiveChannelId || "";
      const selected = new Set(cfg.models || []);
      const selectedLegacy = new Set([...selected].filter(item => !item.includes("::")));
      const locked = state.allowWrite ? "" : "disabled";
      const isChecked = (channel, model) =>
        selected.has(`${channel.id}::${model}`) || (channel.id === activeChannelId && selectedLegacy.has(model));
      // 测试灯：成功绿、成功但延迟 >10 秒黄、失败红、没测过灰
      const testLight = (channel, model) => {
        const info = channel.modelTests?.[model];
        if (!info || !info.status || info.status === "pending")
          return { tone: "idle", tip: "未测试" }
        if (info.status === "failed") return { tone: "bad", tip: "测试失败" }
        const latency = Number(info.latency)
        const slow = Number.isFinite(latency) && latency > 10000
        const label = Number.isFinite(latency) ? `${latency}ms` : "已通过"
        return { tone: slow ? "slow" : "ok", tip: slow ? `可用但较慢 · ${label}` : `测试通过 · ${label}` }
      }
      const groups = channels
        .map(channel => {
          const list = aiChannelModels(channel);
          const note = channel.enabled === false ? "已停用" : "";
          const rows = list.length
            ? list
                .map(model => {
                  const value = `${channel.id}::${model}`;
                  const disabled = channel.enabled === false ? "disabled" : locked;
                  const light = testLight(channel, model);
                  return `<label class="check-row"><input type="checkbox" data-fallback-model value="${esc(value)}" ${isChecked(channel, model) ? "checked" : ""} ${disabled} /><span class="fallback-light ${light.tone}" title="${esc(light.tip)}" aria-label="${esc(light.tip)}"></span><span class="mono">${esc(model)}</span></label>`;
                })
                .join("")
            : '<div class="muted">未配置模型</div>';
          return `<div class="fallback-group">
            <div class="fallback-group-title"><strong>${esc(channel.name)}</strong>${note ? `<small>${esc(note)}</small>` : ""}</div>
            <div class="check-list">${rows}</div>
          </div>`;
        })
        .join("");
      panel.innerHTML = `<div class="ai-form-grid">
        <div class="field"><span>启用备选轮询</span>
          <label class="switch"><input type="checkbox" id="fallbackEnabled" ${cfg.enabled ? "checked" : ""} ${locked} /><span class="track"></span><span>${cfg.enabled ? "开启" : "关闭"}</span></label>
        </div>
        <div class="field"><span>切换策略</span>
          <select id="fallbackStrategy" ${locked}>
            <option value="roundRobin" ${cfg.strategy === "roundRobin" ? "selected" : ""}>轮询备选</option>
            <option value="random" ${cfg.strategy === "random" ? "selected" : ""}>随机备选</option>
            <option value="failover" ${cfg.strategy === "failover" ? "selected" : ""}>按顺序尝试</option>
          </select>
          <div class="hint">主模型正常时不会动它；只有主模型这次请求失败，才按此顺序依次尝试下面的备选，下一次请求仍从主模型开始。</div>
        </div>
        <div class="field wide"><span>备选模型</span>
          ${groups || '<div class="muted">还没有渠道，请先在渠道管理里添加。</div>'}
        </div>
      </div>
      <div class="ai-fallback-actions">
        <button type="button" class="btn btn-primary btn-sm" id="fallbackSave" ${locked}>${icon("save")}保存备选设置</button>
      </div>`;
      const enabledBox = $("#fallbackEnabled", panel);
      enabledBox?.addEventListener("change", () => {
        const text = enabledBox.closest(".switch")?.querySelector("span:last-child");
        if (text) text.textContent = enabledBox.checked ? "开启" : "关闭";
      });
      $("#fallbackSave", panel)?.addEventListener("click", async () => {
        const button = $("#fallbackSave", panel);
        setBusy(button, true);
        try {
          const result = await api("/ai/model-fallback", {
            method: "POST",
            body: {
              enabled: $("#fallbackEnabled", panel).checked,
              strategy: $("#fallbackStrategy", panel).value,
              models: $$("[data-fallback-model]:checked", panel).map(input => input.value),
            },
          });
          toast(result.message || "已保存", "success", "备选模型");
        } catch (error) {
          handleError(error);
        } finally {
          setBusy(button, false);
        }
      });
    } catch (error) {
      panel.innerHTML = `<div class="muted">${esc(error.message || "加载失败")}</div>`;
    }
  }

  function aiSectionEls(section) {
    const prefix = AI_SECTION_ELEMENT[section];
    return {
      stats: $(`#aiSec${prefix}Stats`),
      count: $(`#aiSec${prefix}Count`),
      head: $(`#aiSec${prefix}Head`),
      rows: $(`#aiSec${prefix}Rows`),
      cards: $(`#aiSec${prefix}Cards`),
    };
  }

  function aiSectionItem(section, id) {
    const bucket = state.aiSections[section];
    return bucket ? (bucket.items || []).find(item => item.id === id) || null : null;
  }

  async function loadAiSection(section, force) {
    const meta = AI_SECTION_META[section];
    if (!meta) return null;
    if (!force && state.aiSections[section]) {
      renderAiSection(section);
      return state.aiSections[section];
    }
    const data = await api(AI_SECTION_ENDPOINTS[section]);
    state.aiSections[section] = {
      data,
      items: data.items || [],
      activeId: data.activeId || "",
      status: data.status || [],
      config: data.config || null,
      loadedAt: Date.now(),
    };
    renderAiSection(section);
    return state.aiSections[section];
  }

  function channelFilterItems(items) {
    if (state.channelTestFilter === "all") return items;
    return items.filter(item => channelTestStatus(item) === state.channelTestFilter);
  }

  function renderChannelToolbar(items) {
    const counts = { all: items.length, success: 0, failed: 0, pending: 0 };
    for (const item of items) counts[channelTestStatus(item)]++;
    const bar = $("#aiChannelStatusFilter");
    if (bar) {
      $$("[data-ai-channel-filter]", bar).forEach(button => {
        const value = button.dataset.aiChannelFilter || "all";
        button.classList.toggle("active", value === state.channelTestFilter);
        const count = $("[data-ai-channel-filter-count]", button);
        if (count) count.textContent = fmtNum(counts[value] ?? 0);
      });
    }
    const batch = $("[data-ai-test-all]");
    if (batch) batch.disabled = !state.allowWrite;
  }

  function renderAiSection(section) {
    const bucket = state.aiSections[section];
    const els = aiSectionEls(section);
    if (!bucket || (!els.rows && !els.cards)) return;
    const items = bucket.items || [];
    const activeId = bucket.activeId || "";
    const statusMap = new Map((bucket.status || []).map(item => [item.id, item]));

    els.stats.innerHTML = aiSectionStatsHtml(section, items, activeId, statusMap);
    if (els.head) els.head.innerHTML = aiSectionHeadHtml(section);
    if (els.count) els.count.textContent = aiSectionCountText(section, items, activeId, statusMap);
    if (section === "channels") {
      renderChannelToolbar(items);
      if (els.cards) {
        const visible = channelFilterItems(items);
        els.cards.innerHTML = visible.length
          ? visible.map(item => aiChannelCardHtml(item, item.id === activeId)).join("")
          : items.length
            ? `<div class="channel-empty">${icon("database")}<strong>当前筛选下没有渠道</strong><span>试试切换测试状态，或查看全部渠道。</span><button type="button" class="btn btn-outline btn-sm" data-ai-channel-filter="all">查看全部</button></div>`
            : `<div class="channel-empty">${icon("database")}<strong>还没有渠道</strong><span>点击右上角“新建渠道”，选择服务商预设并获取模型列表。</span></div>`;
      }
      return;
    }
    if (els.rows)
      els.rows.innerHTML = items.length
        ? items.map(item => aiSectionRowHtml(section, item, activeId, statusMap.get(item.id))).join("")
        : tableEmpty(aiSectionColumnCount(section), `还没有${AI_SECTION_META[section].label}，点击右上角新建。`);
    if (section === "imagePresets") renderImageConfig();
    if (section === "mcpServers") {
      const sync = $("#mcpSync");
      if (sync) sync.disabled = !state.allowWrite;
    }
  }

  function aiSectionStatsHtml(section, items, activeId, statusMap) {
    if (section === "presets") {
      const active = items.find(item => item.id === activeId);
      const latest = items.reduce((max, item) => Math.max(max, toDate(item.updatedAt)?.getTime() || 0), 0);
      return [
        miniStat("预设数量", fmtNum(items.length), "book", 1),
        miniStat("当前启用", active ? active.name : "未启用", "check", 2),
        miniStat("上下文覆盖", fmtNum(items.filter(item => item.maxContextTokens || item.maxHistoryTurns).length), "sliders", 3),
        miniStat("最后更新", latest ? fmtRelative(latest) : "—", "clock", 4),
      ].join("");
    }
    if (section === "channels") {
      const success = items.filter(item => channelTestStatus(item) === "success").length;
      const failed = items.filter(item => channelTestStatus(item) === "failed").length;
      return [
        miniStat("渠道数量", fmtNum(items.length), "database", 1),
        miniStat("已启用", fmtNum(items.filter(item => item.enabled !== false).length), "check", 2),
        miniStat("测试通过", fmtNum(success), "spark", 3),
        miniStat("测试失败 / 待测试", `${fmtNum(failed)} / ${fmtNum(items.length - success - failed)}`, "sliders", 4),
      ].join("");
    }
    if (section === "proxies") {
      const active = items.find(item => item.id === activeId);
      return [
        miniStat("代理数量", fmtNum(items.length), "arrow", 1),
        miniStat("已启用", fmtNum(items.filter(item => item.enabled !== false).length), "check", 2),
        miniStat("当前代理", active ? active.name : "直连", "spark", 3),
        miniStat("全部请求", fmtNum(items.filter(item => item.scope === "all").length), "database", 4),
      ].join("");
    }
    if (section === "skills") {
      const tools = items.reduce((sum, item) => sum + (item.tools || []).length, 0);
      return [
        miniStat("技能数量", fmtNum(items.length), "puzzle", 1),
        miniStat("已启用", fmtNum(items.filter(item => item.enabled !== false).length), "check", 2),
        miniStat("常驻技能", fmtNum(items.filter(item => item.mode === "always").length), "pin", 3),
        miniStat("建议工具", fmtNum(tools), "tool", 4),
      ].join("");
    }
    if (section === "mcpServers") {
      const statuses = [...statusMap.values()];
      return [
        miniStat("服务数量", fmtNum(items.length), "puzzle", 1),
        miniStat("已启用", fmtNum(items.filter(item => item.enabled !== false).length), "check", 2),
        miniStat("已连接", fmtNum(statuses.filter(item => item.connected).length), "spark", 3),
        miniStat("远端工具", fmtNum(statuses.reduce((sum, item) => sum + (item.tools || 0), 0)), "tool", 4),
      ].join("");
    }
    const active = items.find(item => item.id === activeId);
    return [
      miniStat("预设数量", fmtNum(items.length), "spark", 1),
      miniStat("已启用", fmtNum(items.filter(item => item.enabled !== false).length), "check", 2),
      miniStat("当前预设", active ? active.name : "未启用", "sliders", 3),
      miniStat("使用模型", fmtNum(new Set(items.map(item => item.model).filter(Boolean)).size), "database", 4),
    ].join("");
  }

  function aiSectionHeadHtml(section) {
    const heads = {
      presets: ["预设", "人设", "采样", "工具 / 思考", "上下文 / 预算", "状态", "操作"],
      channels: ["渠道", "模型", "接口地址", "密钥", "优先级", "状态", "操作"],
      proxies: ["代理", "地址", "作用范围", "状态", "更新时间", "操作"],
      skills: ["技能", "模式", "关键词", "工具", "状态", "更新时间", "操作"],
      mcpServers: ["服务", "目标", "权限", "连接", "工具", "操作"],
      imagePresets: ["预设", "模型", "尺寸", "质量 / 风格", "提示词前缀", "状态", "操作"],
    };
    const columns = heads[section] || [];
    return `<tr>${columns.map((label, index) => `<th${index === columns.length - 1 ? ' style="text-align:right"' : ""}>${esc(label)}</th>`).join("")}</tr>`;
  }

  function aiSectionColumnCount(section) {
    return {
      presets: 7,
      channels: 7,
      proxies: 6,
      skills: 7,
      mcpServers: 6,
      imagePresets: 7,
    }[section] || 6;
  }

  function aiSectionCountText(section, items, activeId, statusMap) {
    const meta = AI_SECTION_META[section];
    if (section === "channels") return "";
    if (section === "mcpServers") {
      const connected = [...statusMap.values()].filter(item => item.connected).length;
      return `共 ${fmtNum(items.length)} 个服务 · ${fmtNum(connected)} 个已连接`;
    }
    if (section === "imagePresets") {
      const active = items.find(item => item.id === activeId);
      return `共 ${fmtNum(items.length)} 个绘图预设 · 当前 ${active ? active.name : "未启用"}`;
    }
    return `共 ${fmtNum(items.length)} 个${meta.label}`;
  }

  function aiSectionRowHtml(section, item, activeId, status) {
    const active = item.id === activeId;
    if (section === "presets") {
      const role = item.roleName ? `角色：${item.roleName}` : "";
      const persona = [role, item.personality, item.speakingStyle].filter(Boolean).join(" · ");
      const safety = `${AI_TOOL_PERMISSION_LABELS[item.toolPermission] || "跟随全局"} / ${item.maxDangerLevel === "inherit" ? "危险跟随全局" : `≤${dangerLabel(item.maxDangerLevel)}`}`;
      const budget = item.turnLimit
        ? ` · 每 ${fmtNum(item.turnWindowMinutes || 180)} 分钟 ${fmtNum(item.turnLimit)} 轮${item.extraTokenBudget ? ` + ${fmtNum(item.extraTokenBudget)} tokens` : ""}`
        : "";
      const prefixTags = (item.prefixes || []).slice(0, 3).map(tag => `<span class="chip">${esc(tag)}</span>`).join(" ");
      return `<tr>
        <td><div class="cell-main">${aiModelIconHtml(item.model || item.description || item.id, null)}<strong>${esc(item.name)}</strong><small>${esc(item.model || item.description || item.id)}</small>${prefixTags ? `<div class="chips" style="margin:4px 0 0">${prefixTags}</div>` : ""}</div></td>
        <td><div class="cell-desc" title="${esc(persona || "未设置人设")}">${esc(persona || "—")}</div></td>
        <td class="cell-num">${item.temperature === null ? "—" : esc(item.temperature)} / ${item.topP === null ? "—" : esc(item.topP)}</td>
        <td><div class="cell-desc">${esc(safety)}<br><small>${esc(AI_THINKING_LABELS[item.thinkingLevel] || "关闭")}思考</small></div></td>
        <td>${item.maxContextTokens ? `${fmtNum(item.maxContextTokens)} tokens` : "—"}${item.maxHistoryTurns ? ` · ${fmtNum(item.maxHistoryTurns)} 轮` : ""}${budget}</td>
        <td>${active ? pill("当前", "pill-green") : pill("未启用", "")}</td>
        ${aiActionsCell(section, item, active)}
      </tr>`;
    }
    if (section === "channels") {
      const statePill = !item.enabled ? pill("停用", "") : active ? pill("当前", "pill-green") : pill("启用", "pill-outline");
      return `<tr>
        <td><div class="cell-main"><strong>${esc(item.name)}</strong><small>${esc(channelAdapterLabel(item))} · ${esc(item.id)}</small></div></td>
        <td><span class="model-inline">${item.model ? aiModelIconHtml(item.model, item) : ""}<span class="mono">${esc(item.model || "继承预设")}</span></span></td>
        <td><div class="cell-desc" title="${esc(item.baseURL || "")}">${esc(item.baseURL || "—")}</div></td>
        <td>${item.apiKey ? pill("已配置", "pill-green") : pill("未配置", "pill-amber")}</td>
        <td class="cell-num">${fmtNum(item.priority || 0)}</td>
        <td>${statePill} ${channelTestPill(item)}</td>
        ${aiActionsCell(section, item, active)}
      </tr>`;
    }
    if (section === "proxies") {
      const statePill = !item.enabled ? pill("停用", "") : active ? pill("当前", "pill-green") : pill("启用", "pill-outline");
      return `<tr>
        <td><div class="cell-main"><strong>${esc(item.name)}</strong><small>${esc(item.id)}</small></div></td>
        <td><div class="cell-desc mono" title="${esc(item.url || "")}">${esc(item.url || "—")}</div></td>
        <td>${pill(item.scope === "all" ? "全部请求" : "仅 AI 接口", item.scope === "all" ? "pill-blue" : "pill-outline")}</td>
        <td>${statePill}</td>
        <td>${esc(fmtRelative(item.updatedAt))}</td>
        ${aiActionsCell(section, item, active)}
      </tr>`;
    }
    if (section === "skills") {
      const keywords = (item.keywords || []).slice(0, 3).map(tag => `<span class="chip">${esc(tag)}</span>`).join(" ");
      const extra = (item.keywords || []).length > 3 ? `<span class="muted">+${(item.keywords || []).length - 3}</span>` : "";
      return `<tr>
        <td><div class="cell-main"><strong>${esc(item.name)}</strong><small>${esc(item.description || item.id)}</small></div></td>
        <td>${pill(AI_MODE_LABELS[item.mode] || item.mode, item.mode === "always" ? "pill-amber" : "pill-blue")}</td>
        <td><div class="chips" style="margin:0">${keywords || '<span class="muted">未设置</span>'}${extra}</div></td>
        <td class="cell-num">${fmtNum((item.tools || []).length)}</td>
        <td>${boolPill(item.enabled !== false, "启用", "停用")}</td>
        <td>${esc(fmtRelative(item.updatedAt))}</td>
        ${aiActionsCell(section, item, active)}
      </tr>`;
    }
    if (section === "mcpServers") {
      const target =
        item.transport === "builtin"
          ? "进程内 MCP · 统一提供全部 AI 工具"
          : item.transport === "http"
            ? item.url
            : [item.command, ...(item.args || [])].join(" ");
      const connected = !!status?.connected;
      const statePill = !item.enabled ? pill("已停用", "") : connected ? pill("已连接", "pill-green") : pill("未连接", "pill-amber");
      const error = status?.error ? `<div class="cell-desc" title="${esc(status.error)}">${esc(status.error)}</div>` : "";
      const transportLabel = item.builtin ? "内置" : item.transport === "http" ? "Streamable HTTP" : "stdio";
      return `<tr>
        <td><div class="cell-main"><strong>${esc(item.name)}</strong><small>${esc(transportLabel)} · ${esc(item.id)}</small></div></td>
        <td><div class="cell-desc mono" title="${esc(target || "")}">${esc(target || "—")}</div></td>
        <td>${permissionPill(item.permission)}</td>
        <td>${statePill}${error}</td>
        <td class="cell-num">${fmtNum(status?.tools || 0)}</td>
        ${aiActionsCell(section, item, active)}
      </tr>`;
    }
    return `<tr>
      <td><div class="cell-main"><strong>${esc(item.name)}</strong><small>${esc(item.id)}</small></div></td>
      <td><span class="mono">${esc(item.model || "dall-e-3")}</span></td>
      <td><span class="mono">${esc(item.size || "1024x1024")}</span></td>
      <td>${esc(AI_QUALITY_LABELS[item.quality] || item.quality)} / ${esc(AI_STYLE_LABELS[item.style] || item.style)}</td>
      <td><div class="cell-desc" title="${esc(item.promptPrefix || "")}">${esc(item.promptPrefix || "—")}</div></td>
      <td>${active ? pill("当前", "pill-green") : !item.enabled ? pill("停用", "") : pill("启用", "pill-outline")}</td>
      ${aiActionsCell(section, item, active)}
    </tr>`;
  }

  function aiChannelCardHtml(item, active) {
    const models =
      Array.isArray(item.models) && item.models.length ? item.models : item.model ? [item.model] : [];
    const defaultModel = item.model || models[0] || "";
    const shown = models.slice(0, 8);
    const chips = [
      ...shown.map(
        model => `<span class="chip channel-card-model" title="${esc(model)}">${aiModelIconHtml(model, item)}<span>${esc(model)}</span></span>`,
      ),
      models.length > shown.length ? `<span class="chip">+${fmtNum(models.length - shown.length)}</span>` : "",
    ].join("");
    const statePill = !item.enabled ? pill("停用", "") : active ? pill("当前", "pill-green") : pill("启用", "pill-outline");
    const testStatus = channelTestStatus(item);
    const testDetail = item.testMessage || (testStatus === "pending" ? "尚未测试" : "");
    const testText = [
      testDetail,
      item.testLatency !== null && item.testLatency !== undefined ? `${fmtNum(item.testLatency)} ms` : "",
      item.testedAt ? fmtRelative(item.testedAt) : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const locked = state.allowWrite ? "" : "disabled";
    const id = esc(item.id);
    const keyCount = Number(item.keyCount || (Array.isArray(item.apiKeys) ? item.apiKeys.length : 0)) || 0;
    const keyStrategyLabel = (AI_KEY_STRATEGIES.find(entry => entry.value === item.keyStrategy) || AI_KEY_STRATEGIES[0]).label;
    const keyPill =
      keyCount > 0 || item.apiKey
        ? pill("密钥已配置", "pill-green")
        : pill("未配置密钥", "pill-amber");
    return `<article class="channel-card${active ? " is-active" : ""}">
      <div class="channel-card-head">
        <div class="channel-card-title">
          <strong>${esc(item.name)}</strong>
          <small class="mono" title="${esc(item.baseURL || "")}">${esc(item.baseURL || "未填写接口地址")}</small>
        </div>
        <div class="channel-card-badges">${pill(channelAdapterLabel(item), "pill-blue")}${statePill}</div>
      </div>
      <div class="channel-card-meta">
        <span>${keyPill}</span>
        ${keyCount > 0 ? `<span>${pill(`${keyCount} 个 Key · ${keyStrategyLabel}`, "pill-blue")}</span>` : ""}
        ${item.stream ? `<span>${pill("流式", "pill-green")}</span>` : ""}
        <span>优先级 ${fmtNum(item.priority || 0)}</span>
        <span>${fmtNum(models.length)} 个模型</span>
        ${defaultModel ? `<span class="channel-card-default" title="${esc(defaultModel)}">默认 ${esc(defaultModel)}</span>` : ""}
      </div>
      <div class="channel-card-test" title="${esc(testText)}">
        ${channelTestPill(item)}
        <span class="channel-card-test-text">${esc(testText || "尚未测试")}</span>
      </div>
      <div class="channel-card-models">${chips || '<span class="muted">未配置模型，编辑后可获取或手动添加</span>'}</div>
      <div class="channel-card-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-ai-active="${id}" ${locked}>${active ? "停用" : "设为当前"}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-ai-test-channel="${id}" ${locked}>测试</button>
        <button type="button" class="btn btn-ghost btn-sm" data-ai-edit="${id}" ${locked}>编辑</button>
        <button type="button" class="btn btn-ghost btn-sm channel-danger" data-ai-delete="${id}" ${locked}>删除</button>
      </div>
    </article>`;
  }

  function aiActionsCell(section, item, active) {
    const id = esc(item.id);
    const locked = state.allowWrite ? "" : "disabled";
    const buttons = [];
    if (item.builtin) return `<td class="cell-actions"><span class="muted">内置服务</span></td>`;
    if (["presets", "channels", "proxies", "imagePresets"].includes(section))
      buttons.push(`<button type="button" class="btn btn-ghost btn-sm" data-ai-active="${id}" ${locked}>${active ? "停用" : "启用"}</button>`);
    if (section === "channels")
      buttons.push(`<button type="button" class="btn btn-ghost btn-sm" data-ai-test-channel="${id}" ${locked}>测试</button>`);
    // 预设可单独导出成一份可再导入的 JSON
    if (section === "presets")
      buttons.push(`<button type="button" class="btn btn-ghost btn-sm" data-ai-export="${id}">导出</button>`);
    if (section === "mcpServers") {
      const connected = !!state.aiSections.mcpServers?.status?.find(status => status.id === item.id)?.connected;
      buttons.push(
        connected
          ? `<button type="button" class="btn btn-ghost btn-sm" data-ai-disconnect="${id}" ${locked}>断开</button>`
          : `<button type="button" class="btn btn-ghost btn-sm" data-ai-connect="${id}" ${locked}>连接</button>`,
      );
    }
    buttons.push(`<button type="button" class="btn btn-ghost btn-sm" data-ai-edit="${id}" ${locked}>编辑</button>`);
    buttons.push(`<button type="button" class="btn btn-ghost btn-sm" data-ai-delete="${id}" ${locked}>删除</button>`);
    return `<td class="cell-actions">${buttons.join("")}</td>`;
  }

  function aiFieldValue(def, item) {
    if (!item)
      return def.type === "switch" ? def.default === true : def.default !== undefined ? def.default : "";
    if (def.key === "apiKey") return item.apiKey || "";
    if (def.type === "switch") return item[def.key] === true;
    const value = item[def.key];
    if (def.type === "json") return value && typeof value === "object" && Object.keys(value).length ? JSON.stringify(value, null, 2) : "";
    if (def.type === "list" || def.type === "models") return Array.isArray(value) ? value.join(", ") : "";
    if (def.type === "lines") return Array.isArray(value) ? value.join("\n") : "";
    return value === null || value === undefined ? "" : value;
  }

  /** 密码框 + 眼睛按钮：默认掩码，点眼睛切换显示 */
  function secretInputHtml(key, value, placeholder, attrs = "") {
    return `<div class="secret-field" data-secret-field>
      <input type="password" data-ai-field="${esc(key)}" data-secret-input="1" value="${esc(
        value,
      )}" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false" ${attrs} />
      <button type="button" class="secret-eye" data-secret-toggle aria-label="显示或隐藏" title="显示 / 隐藏">
        <span data-secret-visible>${icon("eye")}</span><span data-secret-hidden hidden>${icon("eye-off")}</span>
      </button>
    </div>`;
  }

  function aiModelsFieldHtml(item) {
    const models = Array.isArray(item?.models) ? item.models : [];
    return `<div class="ai-models-field" data-ai-models-field>
      <div class="ai-model-chips" data-ai-model-chips></div>
      <input type="hidden" data-ai-field="models" value="${esc(models.join(", "))}" />
      <div class="ai-model-tools">
        <button type="button" class="btn btn-outline btn-sm" data-ai-fetch-models>${icon("refresh")}获取模型</button>
        <button type="button" class="btn btn-outline btn-sm" data-ai-pick-models>${icon("check")}选择模型</button>
      </div>
      <div class="ai-model-add">
        <input type="text" data-ai-model-input placeholder="输入模型名称，多个用逗号分隔" autocomplete="off" />
        <button type="button" class="btn btn-outline btn-sm" data-ai-model-add>${icon("plus")}添加</button>
      </div>
    </div>`;
  }

  function aiKeyStrategyHint(strategy) {
    return {
      roundRobin: "按顺序轮流使用每个 Key，负载最平均",
      random: "每次请求随机挑一个 Key",
      weighted: "按每个 Key 的权重随机，权重越大被选中越多",
      leastUsed: "优先使用累计调用次数最少的 Key",
      failover: "固定用第一个 Key，失败才切下一个",
    }[strategy] || "";
  }

  /** 多 Key 编辑器：掩码显示，点眼睛看明文；前端只提交改动，掩码串代表沿用旧值 */
  const aiKeyRowHtml = row => `<div class="ai-key-row" data-ai-key-row data-ai-key-id="${esc(row.id || "")}">
      <div class="secret-field" data-secret-field>
        <input type="password" data-ai-key-value value="${esc(row.key || "")}" placeholder="粘贴 API Key" autocomplete="off" spellcheck="false" />
        <button type="button" class="secret-eye" data-secret-toggle aria-label="显示或隐藏" title="显示 / 隐藏">
          <span data-secret-visible>${icon("eye")}</span><span data-secret-hidden hidden>${icon("eye-off")}</span>
        </button>
      </div>
      <input type="number" data-ai-key-weight value="${esc(row.weight ?? 1)}" min="1" max="100" step="1" title="权重：越大被选中越多（仅按权重策略生效）" />
      <input type="text" data-ai-key-note value="${esc(row.note || "")}" placeholder="备注（可选）" autocomplete="off" />
      <button type="button" class="btn btn-ghost btn-sm" data-ai-key-remove title="移除">${icon("close")}</button>
    </div>`

  function aiApiKeysFieldHtml(item) {
    const keys = Array.isArray(item?.apiKeys) ? item.apiKeys : [];
    const hasLegacy = !!item?.apiKey && !keys.length;
    const rows = keys.length
      ? keys
      : hasLegacy
        ? [{ key: item.apiKey, weight: 1, note: "" }]
        : [{ key: "", weight: 1, note: "" }];
    return `<div class="ai-keys-field" data-ai-keys-field>
      <div class="ai-key-list" data-ai-key-list>${rows.map(aiKeyRowHtml).join("")}</div>
      <button type="button" class="btn btn-outline btn-sm" data-ai-key-add>${icon("plus")}添加 Key</button>
      <div class="hint">留空则使用上面的单个 API Key；同一渠道可配多个 Key</div>
    </div>`;
  }

  function collectApiKeys(root) {
    const list = $("[data-ai-key-list]", root);
    if (!list) return undefined;
    return $$("[data-ai-key-row]", list)
      .map(row => {
        const key = $("[data-ai-key-value]", row)?.value.trim() || "";
        const id = row.dataset.aiKeyId || "";
        return { id, key, weight: Number($("[data-ai-key-weight]", row)?.value) || 1, note: $("[data-ai-key-note]", row)?.value.trim() || "" };
      })
      .filter(entry => entry.key);
  }

  function wireApiKeysField(root) {
    const list = $("[data-ai-key-list]", root);
    const addButton = $("[data-ai-key-add]", root);
    if (!list || !addButton) return;
    addButton.addEventListener("click", () => {
      list.insertAdjacentHTML("beforeend", aiKeyRowHtml({ weight: 1, note: "" }));
    });
    list.addEventListener("click", event => {
      const remove = event.target.closest("[data-ai-key-remove]");
      if (!remove) return;
      const rows = $$("[data-ai-key-row]", list);
      if (rows.length <= 1) {
        const inputs = $$("input", rows[0]);
        inputs.forEach(input => (input.value = input.type === "number" ? "1" : ""));
        return;
      }
      remove.closest("[data-ai-key-row]")?.remove();
    });
  }

  /** 渠道下拉：选项来自已加载的渠道分节数据 */
  function aiDynamicSelectHtml(key, value) {
    const current = String(value ?? "");
    const channels = state.aiSections.channels?.items || [];
    const options = channels.length
      ? channels.map(channel => `<option value="${esc(channel.id)}" ${channel.id === current ? "selected" : ""}>${esc(channel.name)}</option>`)
      : '<option value="">（暂无渠道，请先创建）</option>';
    return `<select data-ai-field="${esc(key)}"><option value="" ${current ? "" : "selected"}>— 未指定渠道 —</option>${options.join("")}</select>`;
  }

  function aiChannelDefaultModelHtml(item) {
    const current = String(item?.model || "");
    const models = [...new Set([...(Array.isArray(item?.models) ? item.models : []), ...(current ? [current] : [])])];
    const options = [
      '<option value="">跟随列表首个模型</option>',
      ...models.map(
        model => `<option value="${esc(model)}" ${model === current ? "selected" : ""}>${esc(model)}</option>`,
      ),
    ];
    return `<select data-ai-field="model">${options.join("")}</select>`;
  }

  function aiModelPoolSelectHtml(item) {
    const current = String(item?.model || "");
    const seen = new Set();
    const groups = [];
    for (const channel of aiSelectableChannels(state.aiModels).filter(channel => channel.enabled)) {
      const models = aiChannelModels(channel).filter(model => !seen.has(model));
      if (!models.length) continue;
      for (const model of models) seen.add(model);
      groups.push(
        `<optgroup label="${esc(channel.name)}">${models
          .map(model => `<option value="${esc(model)}" ${model === current ? "selected" : ""}>${esc(model)}</option>`)
          .join("")}</optgroup>`,
      );
    }
    const unknown =
      current && !seen.has(current)
        ? `<optgroup label="当前值（不在模型池）"><option value="${esc(current)}" selected>${esc(current)}</option></optgroup>`
        : "";
    return `<select data-ai-field="model">
      <option value="" ${current ? "" : "selected"}>跟随当前模型</option>
      ${groups.join("")}${unknown}
    </select>`;
  }

  function aiFieldHtml(def, item) {
    const value = aiFieldValue(def, item);
    const placeholder = def.placeholder || "";
    const label = `<span>${esc(def.label)}${def.required ? ' <em class="req">*</em>' : ""}</span>`;
    let control;
    if (def.type === "switch") {
      const checked = value === true;
      control = `<label class="switch"><input type="checkbox" data-ai-field="${def.key}" ${checked ? "checked" : ""} /><span class="track"></span><span>${checked ? "开启" : "关闭"}</span></label>`;
    } else if (def.type === "models") {
      control = aiModelsFieldHtml(item);
    } else if (def.type === "api-keys") {
      control = aiApiKeysFieldHtml(item);
    } else if (def.type === "channel-default") {
      control = aiChannelDefaultModelHtml(item);
    } else if (def.type === "model-pool") {
      control = state.aiModels
        ? aiModelPoolSelectHtml(item)
        : `<input type="text" data-ai-field="model" value="${esc(value)}" placeholder="留空跟随当前模型" autocomplete="off" />`;
    } else if (def.type === "select") {
      if (def.key === "provider") {
        control = `<select data-ai-field="${def.key}">${aiProviderOptionsHtml(value)}</select>`;
      } else if (def.key === "channelId") {
        control = aiDynamicSelectHtml(def.key, value);
      } else {
        const options = [...(def.options || [])];
        control = `<select data-ai-field="${def.key}">${options
          .map(option => `<option value="${esc(option.value)}" ${String(option.value) === String(value ?? "") ? "selected" : ""}>${esc(option.label)}</option>`)
          .join("")}</select>`;
      }
    } else if (def.type === "textarea" || def.type === "json" || def.type === "lines") {
      control = `<textarea data-ai-field="${def.key}" rows="${def.rows || 4}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`;
    } else if (def.type === "password") {
      control = secretInputHtml(def.key, value, placeholder);
    } else {
      const type = def.type === "number" ? "number" : "text";
      const attrs = [
        def.step ? `step="${esc(def.step)}"` : "",
        def.min !== undefined ? `min="${esc(def.min)}"` : "",
        def.max !== undefined ? `max="${esc(def.max)}"` : "",
      ]
        .filter(Boolean)
        .join(" ");
      control = `<input type="${type}" data-ai-field="${def.key}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" ${attrs} />`;
    }
    const wrapAttrs = [
      `data-ai-field-wrap="${def.key}"`,
      def.adapterScope ? `data-ai-adapter-scope="${esc(def.adapterScope)}"` : "",
      def.pathRole ? `data-ai-path-role="${def.pathRole}"` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return `<div class="field${def.wide ? " wide" : ""}" ${wrapAttrs}>${label}${control}${def.hint ? `<div class="hint">${esc(def.hint)}</div>` : ""}</div>`;
  }

  function collectAiForm(root, defs) {
    const out = {};
    for (const def of defs) {
      if (def.type === "api-keys") {
        const keys = collectApiKeys(root);
        if (keys !== undefined) out[def.key] = keys;
        continue;
      }
      const input = $(`[data-ai-field="${def.key}"]`, root);
      if (!input) continue;
      if (def.type === "switch") {
        out[def.key] = input.checked;
      } else if (def.type === "number") {
        const raw = input.value.trim();
        if (raw === "") out[def.key] = null;
        else {
          const value = Number(raw);
          if (!Number.isFinite(value)) throw new Error(`「${def.label}」必须是数字`);
          out[def.key] = value;
        }
      } else if (def.type === "list" || def.type === "models") {
        out[def.key] = input.value.split(/[,，\n]/).map(value => value.trim()).filter(Boolean);
      } else if (def.type === "lines") {
        out[def.key] = input.value.split("\n").map(value => value.trim()).filter(Boolean);
      } else if (def.type === "json") {
        const text = input.value.trim();
        if (!text) out[def.key] = {};
        else {
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch {
            throw new Error(`「${def.label}」不是有效的 JSON`);
          }
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            throw new Error(`「${def.label}」必须是 JSON 对象`);
          out[def.key] = parsed;
        }
      } else {
        out[def.key] = input.value.trim();
      }
    }
    for (const def of defs) {
      if (!def.required) continue;
      if (out[def.key] === "" || out[def.key] === null || out[def.key] === undefined)
        throw new Error(`「${def.label}」不能为空`);
    }
    return out;
  }

  /** 眼睛按钮：点击时才按需取真实密钥，避免列表接口把明文带出来 */
  function wireSecretToggles(root, { loadSecrets, channelId } = {}) {
    let pending = null;
    let secrets = null;
    const ensureSecrets = async () => {
      if (secrets) return secrets;
      if (!loadSecrets) return null;
      if (!pending) pending = loadSecrets();
      secrets = await pending;
      return secrets;
    };
    root.addEventListener("click", async event => {
      const toggle = event.target.closest("[data-secret-toggle]");
      if (!toggle) return;
      const wrap = toggle.closest("[data-secret-field]");
      const input = $("input", wrap);
      if (!input) return;
      if (input.type === "text") {
        input.type = "password";
        const visible = $("[data-secret-visible]", toggle);
        const hidden = $("[data-secret-hidden]", toggle);
        if (visible) visible.hidden = false;
        if (hidden) hidden.hidden = true;
        return;
      }
      // 首次显示前把真实值取回来
      if (String(input.value || "").includes("***")) {
        toggle.disabled = true;
        try {
          const data = await ensureSecrets();
          if (data) {
            if (input.dataset.aiKeyValue !== undefined) {
              const row = input.closest("[data-ai-key-row]");
              const id = row?.dataset.aiKeyId || "";
              const hit = (data.apiKeys || []).find(entry => entry.id === id);
              if (hit?.key) input.value = hit.key;
            } else if (data.apiKey) {
              input.value = data.apiKey;
            }
          }
        } catch (error) {
          handleError(error);
          return;
        } finally {
          toggle.disabled = false;
        }
      }
      input.type = "text";
      const visible = $("[data-secret-visible]", toggle);
      const hidden = $("[data-secret-hidden]", toggle);
      if (visible) visible.hidden = true;
      if (hidden) hidden.hidden = false;
    });
  }

  function wireChannelFields(root, item, channelId) {
    wireSecretToggles(root, {
      channelId,
      loadSecrets: channelId ? () => api(`/ai/channels/${encodeURIComponent(channelId)}/secrets`) : null,
    });
    const providerSelect = $('[data-ai-field="provider"]', root);
    const adapterSelect = $('[data-ai-field="adapterType"]', root);
    const apiFormatSelect = $('[data-ai-field="apiFormat"]', root);
    const chatPathInput = $('[data-ai-field="chatPath"]', root);
    const modelsPathInput = $('[data-ai-field="modelsPath"]', root);
    const responsePathInput = $('[data-ai-field="responsePath"]', root);
    const baseInput = $('[data-ai-field="baseURL"]', root);
    const apiKeyInput = $('[data-ai-field="apiKey"]', root);
    const nameInput = $('[data-ai-field="name"]', root);
    const modelsInput = $('[data-ai-field="models"]', root);
    const chipsBox = $("[data-ai-model-chips]", root);
    const modelInput = $("[data-ai-model-input]", root);
    const addButton = $("[data-ai-model-add]", root);
    const fetchButton = $("[data-ai-fetch-models]", root);
    const pickButton = $("[data-ai-pick-models]", root);
    const defaultSelect = $('[data-ai-field="model"]', root);
    if (!providerSelect || !modelsInput || !chipsBox) return;

    const knownBaseURLs = new Set(
      [
        ...AI_CHANNEL_PROVIDERS.map(provider => normalizeChannelBaseURL(provider.baseURL)),
        ...Object.values(AI_CHANNEL_PATH_DEFAULTS).map(defaults => normalizeChannelBaseURL(defaults.baseURL)),
      ].filter(Boolean),
    );
    let models = [
      ...new Set([...(Array.isArray(item?.models) ? item.models : []), ...(item?.model ? [item.model] : [])]),
    ];
    let fetchedModels = [];
    let previousAdapter = adapterSelect?.value || "openai";

    const syncModelsInput = () => {
      modelsInput.value = models.join(", ");
      if (!defaultSelect) return;
      const selected = models.includes(defaultSelect.value) ? defaultSelect.value : "";
      defaultSelect.innerHTML = [
        '<option value="">跟随列表首个模型</option>',
        ...models.map(
          model => `<option value="${esc(model)}" ${model === selected ? "selected" : ""}>${esc(model)}</option>`,
        ),
      ].join("");
    };

    const renderChips = () => {
      chipsBox.innerHTML = models.length
        ? models
            .map(
              (model, index) => `<span class="chip channel-model-chip">${aiModelIconHtml(model, null)}<span class="mono">${esc(model)}</span><button type="button" class="chip-x" data-ai-model-remove="${index}" aria-label="移除模型">${icon("close")}</button></span>`,
            )
            .join("")
        : '<span class="muted">尚未添加模型，可获取模型或手动输入</span>';
      syncModelsInput();
    };

    const addModels = incoming => {
      const before = models.length;
      const next = incoming.map(model => String(model || "").trim()).filter(Boolean);
      models = [...new Set([...models, ...next])];
      renderChips();
      return models.length - before;
    };

    const applyBaseURL = (value, force) => {
      if (!baseInput) return;
      const current = normalizeChannelBaseURL(baseInput.value);
      if (force || !current || knownBaseURLs.has(current)) baseInput.value = normalizeChannelBaseURL(value);
    };

    const currentAdapter = () => {
      const value = adapterSelect?.value || "openai";
      return AI_CHANNEL_PATH_DEFAULTS[value] ? value : "openai";
    };

    const syncAdapterForm = () => {
      const adapter = currentAdapter();
      const defaults = AI_CHANNEL_PATH_DEFAULTS[adapter];
      $$("[data-ai-adapter-scope]", root).forEach(field => {
        field.hidden = field.dataset.aiAdapterScope !== adapter;
      });
      if (adapter !== "openai" && apiFormatSelect) apiFormatSelect.value = "chat";
      if (baseInput) baseInput.placeholder = defaults.baseURL;
      if (chatPathInput) chatPathInput.placeholder = `留空使用默认：${defaults.chatPath}`;
      if (modelsPathInput)
        modelsPathInput.placeholder = defaults.modelsPath ? `留空使用默认：${defaults.modelsPath}` : "留空使用默认路径";
      if (responsePathInput)
        responsePathInput.placeholder =
          adapter === "openai" ? `留空使用默认：${defaults.responsePath}` : "仅 OpenAI Responses 格式使用";
    };

    const applyPreset = (preset, forceBase) => {
      if (!preset) return;
      if (preset.adapterType && adapterSelect) adapterSelect.value = preset.adapterType;
      if (apiFormatSelect) apiFormatSelect.value = preset.apiFormat === "responses" ? "responses" : "chat";
      if (preset.baseURL) applyBaseURL(preset.baseURL, forceBase === true);
      previousAdapter = currentAdapter();
      syncAdapterForm();
    };

    const openModelPicker = (source, title) => {
      const list = [...new Set([...models, ...source])];
      if (!list.length) return toast("暂无模型，请先获取模型或手动添加", "info");
      const overlay = document.createElement("div");
      overlay.className = "model-picker-layer";
      overlay.innerHTML = `<div class="model-picker" role="dialog" aria-modal="true" aria-label="选择模型">
        <div class="model-picker-head">
          <div><h4>${esc(title || "选择模型")}</h4><p>勾选要加入渠道的模型，确认后替换当前列表</p></div>
          <button type="button" class="modal-close" data-model-picker-close aria-label="关闭">${icon("close")}</button>
        </div>
        <div class="model-picker-tools">
          <input type="search" data-model-picker-search placeholder="搜索模型…" autocomplete="off" />
          <button type="button" class="btn btn-outline btn-sm" data-model-picker-all>全选</button>
          <button type="button" class="btn btn-outline btn-sm" data-model-picker-none>清空</button>
          <span class="muted" data-model-picker-count></span>
        </div>
        <div class="model-picker-list">${list
          .map(
            model => `<label class="model-picker-item" data-model-picker-item data-name="${esc(model.toLowerCase())}"><input type="checkbox" value="${esc(model)}" ${models.includes(model) ? "checked" : ""} />${aiModelIconHtml(model, null)}<span class="mono">${esc(model)}</span></label>`,
          )
          .join("")}</div>
        <div class="model-picker-foot">
          <button type="button" class="btn btn-outline" data-model-picker-cancel>取消</button>
          <button type="button" class="btn btn-primary" data-model-picker-confirm>${icon("check")}确认选择</button>
        </div>
      </div>`;
      document.body.appendChild(overlay);
      document.body.classList.add("modal-open");
      const search = $("[data-model-picker-search]", overlay);
      const items = $$("[data-model-picker-item]", overlay);
      const countEl = $("[data-model-picker-count]", overlay);
      const syncCount = () => {
        const checked = $$('input[type="checkbox"]', overlay).filter(input => input.checked).length;
        countEl.textContent = `已选 ${checked} / ${list.length}`;
      };
      const close = () => {
        overlay.remove();
        document.removeEventListener("keydown", onKey, true);
        if (!$(".modal-layer:not([hidden])")) document.body.classList.remove("modal-open");
      };
      const onKey = event => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        close();
      };
      document.addEventListener("keydown", onKey, true);
      overlay.addEventListener("click", event => {
        if (event.target === overlay || event.target.closest("[data-model-picker-close], [data-model-picker-cancel]")) {
          close();
          return;
        }
        if (event.target.closest("[data-model-picker-all]")) {
          items.forEach(row => {
            if (!row.hidden) $('input[type="checkbox"]', row).checked = true;
          });
          syncCount();
          return;
        }
        if (event.target.closest("[data-model-picker-none]")) {
          $$('input[type="checkbox"]', overlay).forEach(input => {
            input.checked = false;
          });
          syncCount();
          return;
        }
        if (event.target.closest("[data-model-picker-confirm]")) {
          models = $$('input[type="checkbox"]', overlay)
            .filter(input => input.checked)
            .map(input => input.value);
          renderChips();
          close();
        }
      });
      overlay.addEventListener("input", event => {
        if (event.target !== search) return;
        const term = search.value.trim().toLowerCase();
        items.forEach(row => {
          row.hidden = !!term && !row.dataset.name.includes(term);
        });
      });
      overlay.addEventListener("change", event => {
        if (event.target.matches('input[type="checkbox"]')) syncCount();
      });
      syncCount();
      search.focus();
    };

    const requestModels = async () => {
      const baseURL = normalizeChannelBaseURL(baseInput?.value || "");
      if (baseInput) baseInput.value = baseURL;
      const apiKey = apiKeyInput?.value.trim() || "";
      if (!baseURL) throw new Error("请先填写接口地址");
      const adapter = currentAdapter();
      const body = {
        provider: providerSelect.value,
        adapterType: adapter,
        apiFormat: adapter === "openai" ? apiFormatSelect?.value || "chat" : "chat",
        baseURL,
        chatPath: chatPathInput?.value.trim() || "",
        modelsPath: modelsPathInput?.value.trim() || "",
        responsePath: responsePathInput?.value.trim() || "",
        id: item?.id || "",
      };
      if (apiKey) body.apiKey = apiKey;
      const result = await api("/ai/channels/models", { method: "POST", body });
      return Array.isArray(result.models) ? result.models : [];
    };

    const commitManualModels = () => {
      if (!modelInput) return;
      const values = modelInput.value.split(/[,，\n]/).map(model => model.trim()).filter(Boolean);
      if (!values.length) return;
      const added = addModels(values);
      modelInput.value = "";
      if (!added) toast("这些模型已在列表中", "info");
    };

    providerSelect.addEventListener("change", () => {
      applyPreset(aiProviderPreset(providerSelect.value), false);
    });
    adapterSelect?.addEventListener("change", () => {
      const adapter = currentAdapter();
      if (adapter !== previousAdapter) {
        if (chatPathInput) chatPathInput.value = "";
        if (modelsPathInput) modelsPathInput.value = "";
        if (responsePathInput) responsePathInput.value = "";
        const defaults = AI_CHANNEL_PATH_DEFAULTS[adapter];
        const current = normalizeChannelBaseURL(baseInput?.value || "");
        if (!current || knownBaseURLs.has(current)) applyBaseURL(defaults.baseURL, true);
        previousAdapter = adapter;
      }
      syncAdapterForm();
    });
    apiFormatSelect?.addEventListener("change", syncAdapterForm);
    baseInput?.addEventListener("blur", () => {
      baseInput.value = normalizeChannelBaseURL(baseInput.value);
    });
    modelsInput.value = models.join(", ");

    chipsBox.addEventListener("click", event => {
      const button = event.target.closest("[data-ai-model-remove]");
      if (!button) return;
      models.splice(Number(button.dataset.aiModelRemove), 1);
      renderChips();
    });

    addButton?.addEventListener("click", commitManualModels);
    modelInput?.addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      commitManualModels();
    });

    fetchButton?.addEventListener("click", async () => {
      setBusy(fetchButton, true);
      try {
        const list = await requestModels();
        if (!list.length) return toast("接口没有返回可用模型", "info");
        fetchedModels = [...new Set(list)];
        openModelPicker(fetchedModels, `接口返回 ${fetchedModels.length} 个模型`);
      } catch (error) {
        toast(error.message || String(error), "error");
      } finally {
        setBusy(fetchButton, false);
      }
    });

    pickButton?.addEventListener("click", () => {
      openModelPicker(fetchedModels, fetchedModels.length ? "选择模型" : "整理模型列表");
    });

    if (!item) applyPreset(aiProviderPreset(providerSelect.value), true);
    else syncAdapterForm();
    previousAdapter = currentAdapter();
    renderChips();
  }

  /* ---------------- 预设 JSON 导入 ---------------- */

  const THINKING_LEVEL_VALUES = new Set(["minimal", "low", "medium", "high", "xhigh", "auto"])

  /** 把层级对象压成「标题：内容」的文本块，供提示词使用 */
  function presetJsonToText(value, depth = 0) {
    const indent = "  ".repeat(depth)
    if (value === null || value === undefined) return ""
    if (Array.isArray(value))
      return value
        .map(item =>
          typeof item === "object" && item !== null
            ? `${indent}- ${presetJsonToText(item, depth + 1).trim().replace(/\n\s*/g, "；")}`
            : `${indent}- ${String(item).trim()}`,
        )
        .filter(line => line.trim() !== "-")
        .join("\n")
    if (typeof value === "object")
      return Object.entries(value)
        .map(([key, item]) => {
          const body = presetJsonToText(item, depth + 1)
          if (!String(body).trim()) return ""
          return typeof item === "object" && item !== null
            ? `${indent}${key}：\n${body}`
            : `${indent}${key}：${String(item).trim()}`
        })
        .filter(Boolean)
        .join("\n")
    return `${indent}${String(value).trim()}`
  }

  /** 从任意结构里按关键词找一段 */
  function presetJsonPick(source, patterns, depth = 0) {
    if (!source || typeof source !== "object" || depth > 3) return null
    for (const [key, value] of Object.entries(source))
      if (patterns.some(re => re.test(key))) return value
    for (const value of Object.values(source))
      if (value && typeof value === "object") {
        const found = presetJsonPick(value, patterns, depth + 1)
        if (found !== null && found !== undefined) return found
      }
    return null
  }

  /** 把用户粘贴的 JSON 映射为预设字段；支持单个对象或数组 */
  function presetFromJson(raw) {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw
    if (Array.isArray(data)) {
      if (!data.length) throw new Error("JSON 数组是空的")
      return data.map((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item))
          throw new Error(`第 ${index + 1} 项不是对象`)
        return presetOneFromJson(item)
      })
    }
    if (!data || typeof data !== "object") throw new Error("顶层必须是 JSON 对象或对象数组")
    return [presetOneFromJson(data)]
  }

  function presetOneFromJson(data) {
    // 同时兼容三种来源：自定义人格 JSON、本系统导出的预设、chatai 风格预设
    const persona = data.persona && typeof data.persona === "object" ? data.persona : null
    const params =
      presetJsonPick(data, [/请求参数|采样参数|modelParams|params?|request/i]) || {}
    const numOf = (...keys) => {
      for (const key of keys) {
        const value = Number(params?.[key] ?? data?.[key])
        const raw = params?.[key] ?? data?.[key]
        if (raw !== null && raw !== undefined && raw !== "" && Number.isFinite(value)) return value
      }
      return null
    }
    const asText = value => {
      if (value === null || value === undefined) return ""
      if (typeof value === "string") return value.trim()
      return presetJsonToText(value)
    }
    // 预设名优先用外层的 name/title，persona.name 是角色本名，容易撞名
    const name =
      String(
        data.name ||
          presetJsonPick(data, [/角色标题|角色名|人物名|^title$/i]) ||
          persona?.name ||
          "",
      ).trim() || "导入的预设"

    // 人格/语气：优先显式字段，其次按关键词从任意结构里找
    const personality = persona?.personality
      ? asText(persona.personality)
      : asText(presetJsonPick(data, [/基础身份|人物设定|性格|personality/i]) ?? {})
    const speakingStyle = persona?.speakingStyle
      ? asText(persona.speakingStyle)
      : asText(presetJsonPick(data, [/语言风格|说话风格|语气|speaking/i]) ?? {})
    const likes = persona?.likes
      ? asText(persona.likes)
      : asText(presetJsonPick(data, [/喜好|喜欢|偏好|likes/i]) ?? {})
    const dislikes = persona?.dislikes
      ? asText(persona.dislikes)
      : asText(presetJsonPick(data, [/厌恶|讨厌|不喜欢|dislikes/i]) ?? {})

    // 系统提示词：有就用原文，否则把整份结构转成文本，保证不丢信息
    const explicitPrompt = String(data.systemPrompt || "").trim()
    const background = String(persona?.background || "").trim()
    const traits = Array.isArray(persona?.traits) ? persona.traits : []
    const systemPrompt = explicitPrompt
      ? explicitPrompt.slice(0, 20000)
      : [persona ? `${name}：\n${presetJsonToText(persona)}` : presetJsonToText(data)]
          .join("\n\n")
          .slice(0, 20000)

    const contextRaw = data.context && typeof data.context === "object" ? data.context : {}
    const thinking = THINKING_LEVEL_VALUES.has(String(data.reasoningEffort || "").toLowerCase())
      ? String(data.reasoningEffort).toLowerCase()
      : "auto"

    return {
      name,
      description: String(data.description || name).slice(0, 400),
      // 导出的预设带外层 roleName（可与预设名不同），要优先保留
      roleName: String(data.roleName || persona?.name || name).slice(0, 60),
      personality: [
        personality,
        traits.length ? `核心标签：${traits.join("、")}` : "",
        background ? `经历：${background}` : "",
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, 1000),
      speakingStyle: speakingStyle.slice(0, 1000),
      likes: likes.slice(0, 1000),
      dislikes: dislikes.slice(0, 1000),
      temperature: numOf("temperature"),
      topP: numOf("top_p", "topP"),
      maxTokens: numOf("max_tokens", "maxTokens"),
      maxContextTokens: Number(contextRaw.maxTokens) > 0 ? Number(contextRaw.maxTokens) : null,
      maxHistoryTurns: Number(contextRaw.maxMessages) > 0 ? Number(contextRaw.maxMessages) : null,
      thinkingLevel: thinking,
      systemPrompt,
      // 本系统导出的预设带有这些附加项，原样回填；外部 JSON 没有就用默认值
      prefixes: Array.isArray(data.prefixes) ? data.prefixes.filter(Boolean).slice(0, 10) : [],
      stickerTags: Array.isArray(data.stickerTags) ? data.stickerTags.filter(Boolean).slice(0, 12) : [],
      stickersOwnOnly: data.stickersOwnOnly === true,
      toolPermission: ["inherit", "public", "admin", "owner", "master"].includes(data.toolPermission)
        ? data.toolPermission
        : "inherit",
      maxDangerLevel: ["inherit", "low", "medium", "high"].includes(data.maxDangerLevel)
        ? data.maxDangerLevel
        : "inherit",
      turnLimit: Number(data.turnLimit) > 0 ? Number(data.turnLimit) : 0,
      turnWindowMinutes: Number(data.turnWindowMinutes) > 0 ? Number(data.turnWindowMinutes) : 180,
      extraTokenBudget: Number(data.extraTokenBudget) > 0 ? Number(data.extraTokenBudget) : 0,
      budgetNotice: String(data.budgetNotice || "").slice(0, 500),
      maxReplyChars: Number(data.maxReplyChars) > 0 ? Number(data.maxReplyChars) : 0,
    }
  }

  /**
   * 导出预设：只导出人格本身（设定、语气、前缀、能力范围），
   * 不带模型 ID、采样参数与上下文额度——那些属于渠道与本机资源，换环境就失效。
   * 内容从服务端现取（页面快照可能落后于实际保存），保存交给浏览器原生下载。
   */
  async function exportPresets(items) {
    const ids = Array.isArray(items) ? items.map(item => item.id) : [];
    try {
      const result = await api("/ai/presets/export", { method: "POST", body: { ids, dry: true } });
      const blob = new Blob([result.content], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`已导出 ${result.count} 个预设`, "success", result.name);
    } catch (error) {
      handleError(error);
    }
  }

  function openPresetImport() {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    const modal = openModal({
      title: "导入预设",
      subtitle: "支持上传 .json 文件或粘贴 JSON，单个对象或对象数组均可",
      width: "wide",
      body: `<div class="modal-body">
        <div class="field"><span>选择文件</span>
          <input type="file" id="presetImportFile" accept=".json,application/json" />
        </div>
        <div class="field"><span>或粘贴 JSON</span>
          <textarea id="presetImportText" rows="14" spellcheck="false" placeholder='{"角色标题":"今汐","请求参数":{...}}'></textarea>
        </div>
        <div class="preset-import-result" id="presetImportPreview"></div>
      </div>`,
      footer: `<button type="button" class="btn btn-outline" data-close>取消</button>
        <button type="button" class="btn btn-primary" id="presetImportSubmit">导入</button>`,
    });
    const fileInput = $("#presetImportFile", modal.root);
    const textArea = $("#presetImportText", modal.root);
    const preview = $("#presetImportPreview", modal.root);
    const submit = $("#presetImportSubmit", modal.root);

    // 同名预设视为同一个：重新导入导出文件是「同步」而不是「再来一份」
    let existing = null;
    const loadExisting = async () => {
      if (existing) return existing;
      existing = (await api(AI_SECTION_ENDPOINTS.presets)).items || [];
      return existing;
    };

    const renderPreview = () => {
      const raw = textArea.value.trim();
      if (!raw) {
        preview.innerHTML = "";
        return null;
      }
      try {
        const presets = presetFromJson(raw);
        const rows = presets
          .map((preset, index) => {
            const hit = (existing || []).find(item => item.name === preset.name);
            return `<div class="hint">${presets.length > 1 ? `${index + 1}. ` : ""}「${esc(preset.name)}」${
              hit ? "（更新现有预设）" : "（新建）"
            }：人格 ${fmtNum(preset.personality.length)} 字 · 语气 ${fmtNum(preset.speakingStyle.length)} 字 · 提示词 ${fmtNum(preset.systemPrompt.length)} 字</div>`;
          })
          .join("");
        preview.innerHTML =
          (presets.length > 1 ? `<div class="hint">共 ${presets.length} 个预设</div>` : "") + rows;
        return presets;
      } catch (error) {
        preview.innerHTML = `<div class="hint" style="color:var(--red)">${esc(error.message || "JSON 解析失败")}</div>`;
        return null;
      }
    };

    loadExisting()
      .then(() => renderPreview())
      .catch(() => {});

    fileInput?.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        textArea.value = await file.text();
        renderPreview();
      } catch (error) {
        toast(error.message || "读取文件失败", "error");
      }
    });
    textArea.addEventListener("input", renderPreview);

    submit.addEventListener("click", async () => {
      const presets = renderPreview();
      if (!presets?.length) return toast("请先粘贴或选择有效的 JSON", "error");
      setBusy(submit, true);
      const failed = [];
      const PERSONA_KEYS = [
        "name",
        "description",
        "roleName",
        "personality",
        "likes",
        "dislikes",
        "speakingStyle",
        "systemPrompt",
        "thinkingLevel",
        "prefixes",
        "stickerTags",
        "stickersOwnOnly",
        "toolPermission",
        "maxDangerLevel",
        "budgetNotice",
      ];
      let saved = 0;
      try {
        const current = await loadExisting().catch(() => []);
        for (const preset of presets) {
          try {
            // 同名预设沿用原 id 覆盖，避免导入出重复人格；
            // 只覆盖人格相关字段，模型与采样参数属于本机渠道配置，不能被导入清空
            const hit = current.find(item => item.name === preset.name);
            if (hit) {
              const merged = { ...hit, id: hit.id };
              for (const key of PERSONA_KEYS) if (key in preset) merged[key] = preset[key];
              await api("/ai/presets", { method: "POST", body: merged });
            } else {
              await api("/ai/presets", { method: "POST", body: preset });
            }
            saved++;
          } catch (error) {
            failed.push(`${preset.name}：${error.message || "导入失败"}`);
          }
        }
      } finally {
        setBusy(submit, false);
      }
      if (saved) {
        state.ai = null;
        await loadAiSection("presets", true);
      }
      if (!failed.length) {
        modal.close();
        return toast(
          presets.length > 1 ? `已导入 ${saved} 个预设` : `已导入预设「${presets[0].name}」`,
          "success",
          "导入预设",
        );
      }
      preview.innerHTML = `<div class="hint" style="color:var(--red)">${esc(failed.join("；"))}</div>`;
      toast(saved ? `已导入 ${saved} 个，${failed.length} 个失败` : "导入失败", "error", "导入预设");
    });
  }

  async function openAiSectionModal(section, item) {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    if (section === "presets" && !state.aiModels) await loadAIModels().catch(() => null);
    const meta = AI_SECTION_META[section];
    const defs = (AI_FIELD_DEFS[section] || []).filter(def => !def.onlyExisting || item);
    const primary = section === "channels" ? defs.filter(def => !def.advanced) : defs;
    const advanced = section === "channels" ? defs.filter(def => def.advanced) : [];
    const formBody =
      section === "channels"
        ? `<div class="ai-form-grid">${primary.map(def => aiFieldHtml(def, item)).join("")}</div>${
            advanced.length
              ? `<details class="ai-advanced"><summary>高级设置<span>采样参数与请求超时</span></summary><div class="ai-form-grid">${advanced.map(def => aiFieldHtml(def, item)).join("")}</div></details>`
              : ""
          }`
        : `<div class="ai-form-grid">${defs.map(def => aiFieldHtml(def, item)).join("")}</div>`;
    const subtitle =
      section === "channels"
        ? item
          ? `ID ${item.id}`
          : "选择服务商预设后自动填入适配器与接口地址，可批量获取并勾选模型"
        : item?.id
          ? `ID ${item.id}`
          : "保存后立即写入 data/webui/ai-admin.json";
    const modal = openModal({
      title: `${item ? "编辑" : "新建"}${meta.label}`,
      subtitle,
      width: "wide",
      body: `<div class="modal-body">${formBody}<div class="form-error" data-ai-form-error></div></div>`,
      footer: `<button type="button" class="btn btn-outline" data-close>取消</button><button type="button" class="btn btn-primary" data-ai-save>${icon("save")}保存</button>`,
    });
    if (section === "channels") {
      wireChannelFields(modal.root, item, item?.id || "");
      wireApiKeysField(modal.root);
      const strategySelect = $('[data-ai-field="keyStrategy"]', modal.root);
      const strategyHint = strategySelect?.closest(".field")?.querySelector(".hint");
      if (strategySelect && strategyHint) {
        const syncHint = () => {
          const base = AI_KEY_STRATEGIES.find(entry => entry.value === strategySelect.value);
          strategyHint.textContent = aiKeyStrategyHint(strategySelect.value) || base?.label || "";
        };
        strategySelect.addEventListener("change", syncHint);
        syncHint();
      }
    }
    const errorBox = $("[data-ai-form-error]", modal.root);
    modal.root.addEventListener("change", event => {
      const input = event.target.closest("[data-ai-field]");
      if (!input || input.type !== "checkbox") return;
      const text = input.closest(".switch")?.querySelector("span:last-child");
      if (text) text.textContent = input.checked ? "开启" : "关闭";
    });
    const save = $("[data-ai-save]", modal.root);
    save.addEventListener("click", async () => {
      let values;
      try {
        values = collectAiForm(modal.root, defs);
        if (section === "channels") {
          values.adapterType = ["openai", "gemini", "claude"].includes(values.adapterType) ? values.adapterType : "openai";
          values.apiFormat =
            values.adapterType === "openai" && values.apiFormat === "responses" ? "responses" : "chat";
          values.baseURL = normalizeChannelBaseURL(values.baseURL);
          values.chatPath = String(values.chatPath || "").trim();
          values.modelsPath = String(values.modelsPath || "").trim();
          values.responsePath =
            values.adapterType === "openai" ? String(values.responsePath || "").trim() : "";
          values.models = [...new Set(values.models || [])];
        }
      } catch (error) {
        errorBox.textContent = error.message;
        errorBox.classList.add("show");
        return;
      }
      errorBox.classList.remove("show");
      setBusy(save, true);
      try {
        let path = AI_SECTION_ENDPOINTS[section];
        let method = "POST";
        if (section === "mcpServers" && item) {
          path = `${path}/${encodeURIComponent(item.id)}`;
          method = "PUT";
        } else if (item) {
          values.id = item.id;
        }
        const result = await api(path, { method, body: values });
        modal.close();
        toast(result.message || "已保存", result.error ? "info" : "success");
        await loadAiSection(section, true);
        if (section === "presets" || section === "channels" || section === "proxies") {
          state.ai = null;
          if (section === "channels") {
            state.aiModels = null;
            state.aiSections.channels = null;
          }
          invalidateOverview();
        }
      } catch (error) {
        errorBox.textContent = error.message || String(error);
        errorBox.classList.add("show");
      } finally {
        setBusy(save, false);
      }
    });
  }

  async function deleteAiSectionItem(section, item) {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    const meta = AI_SECTION_META[section];
    const confirmed = await confirmDialog({
      title: `删除${meta.label}`,
      message: `确定删除「${item.name || item.id}」吗？此操作不可撤销。`,
      confirmText: "删除",
      danger: true,
    });
    if (!confirmed) return;
    try {
      const result = await api(`${AI_SECTION_ENDPOINTS[section]}/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      toast(result.message || "已删除");
      await loadAiSection(section, true);
      state.ai = null;
      if (section === "channels") state.aiModels = null;
      invalidateOverview();
    } catch (error) {
      handleError(error);
    }
  }

  async function toggleAiSectionActive(section, item, active) {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    try {
      const target = active ? "none" : item.id;
      const result = await api(`${AI_SECTION_ENDPOINTS[section]}/${encodeURIComponent(target)}/active`, { method: "POST" });
      toast(result.message || (active ? "已停用" : "已启用"));
      await loadAiSection(section, true);
      state.ai = null;
      if (section === "channels") state.aiModels = null;
    } catch (error) {
      handleError(error);
    }
  }

  function applyChannelUpdate(channel) {
    if (!channel) return null;
    const bucket = state.aiSections.channels;
    if (!bucket) return channel;
    const items = bucket.items || (bucket.items = []);
    const index = items.findIndex(item => item.id === channel.id);
    if (index >= 0) items[index] = channel;
    else items.push(channel);
    renderAiSection("channels");
    return channel;
  }

  function openChannelTestDialog(item) {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    const channelId = item.id;
    let channelState = aiSectionItem("channels", channelId) || item;
    const models = channelModelList(channelState);
    const entries = new Map();
    const syncEntries = channel => {
      for (const model of models) {
        const saved = channel?.modelTests?.[model];
        if (!saved) continue;
        entries.set(model, {
          status: saved.status || "pending",
          message: saved.message || "",
          latency: saved.latency ?? null,
          testedAt: saved.testedAt || "",
        });
      }
    };
    for (const model of models) {
      const saved = channelState.modelTests?.[model];
      entries.set(model, {
        status: saved?.status || "pending",
        message: saved?.message || "",
        latency: saved?.latency ?? null,
        testedAt: saved?.testedAt || "",
      });
    }

    let filter = "all";
    let running = false;
    let runningTestId = "";
    let controller = null;
    let disposed = false;
    const testing = new Set();

    const modal = openModal({
      title: `渠道测试 · ${channelState.name}`,
      subtitle: `${channelAdapterLabel(channelState)} · ${channelState.baseURL || "未填写接口地址"}`,
      width: "wide",
      body: `<div class="modal-body channel-test-dialog">
        <div class="channel-test-summary" data-channel-test-summary></div>
        <div class="channel-test-toolbar">
          <div class="segmented small" data-channel-test-filter role="group" aria-label="按测试状态筛选"></div>
          <label class="channel-test-concurrency">并发
            <select data-channel-test-concurrency>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3" selected>3</option>
              <option value="5">5</option>
              <option value="8">8</option>
            </select>
          </label>
          <span class="channel-test-progress" data-channel-test-progress>准备就绪</span>
        </div>
        <div class="channel-test-list" data-channel-test-list></div>
      </div>`,
      footer: `<button type="button" class="btn btn-outline" data-close>关闭</button>
        <button type="button" class="btn btn-outline" data-channel-test-connection>${icon("refresh")}测试连接</button>
        <button type="button" class="btn btn-outline" data-channel-test-stop disabled>停止</button>
        <button type="button" class="btn btn-primary" data-channel-test-all>${icon("spark")}全部测试</button>`,
      onClose: () => {
        disposed = true;
        if (running)
          api("/ai/channels/test-batch-stop", {
            method: "POST",
            body: runningTestId ? { testId: runningTestId } : {},
          }).catch(() => {});
      },
    });

    const root = modal.root;
    const summaryBox = $("[data-channel-test-summary]", root);
    const filterBox = $("[data-channel-test-filter]", root);
    const listBox = $("[data-channel-test-list]", root);
    const progressBox = $("[data-channel-test-progress]", root);
    const concurrencySelect = $("[data-channel-test-concurrency]", root);
    const allButton = $("[data-channel-test-all]", root);
    const stopButton = $("[data-channel-test-stop]", root);
    const connectionButton = $("[data-channel-test-connection]", root);

    const counts = () => {
      const result = { all: entries.size, success: 0, failed: 0, pending: 0 };
      for (const entry of entries.values()) {
        if (entry.status === "success") result.success++;
        else if (entry.status === "failed") result.failed++;
        else result.pending++;
      }
      return result;
    };

    const setProgress = text => {
      if (progressBox) progressBox.textContent = text;
    };

    const renderSummary = () => {
      if (!summaryBox) return;
      const stat = counts();
      const detail = [
        channelState.testMessage,
        channelState.testLatency !== null && channelState.testLatency !== undefined
          ? `${fmtNum(channelState.testLatency)} ms`
          : "",
        channelState.testedAt ? fmtRelative(channelState.testedAt) : "",
      ]
        .filter(Boolean)
        .join(" · ");
      summaryBox.innerHTML = `<span>${channelTestPill(channelState)}</span>
        <span class="mono">${esc(channelAdapterLabel(channelState))}</span>
        <span>${fmtNum(stat.all)} 个模型</span>
        <span class="channel-test-count ok">成功 ${fmtNum(stat.success)}</span>
        <span class="channel-test-count bad">失败 ${fmtNum(stat.failed)}</span>
        <span class="channel-test-count">待测试 ${fmtNum(stat.pending)}</span>
        ${detail ? `<span class="channel-test-detail" title="${esc(detail)}">${esc(detail)}</span>` : ""}`;
    };

    const renderFilter = () => {
      if (!filterBox) return;
      const stat = counts();
      filterBox.innerHTML = AI_CHANNEL_TEST_FILTERS.map(option => {
        const count = option.value === "all" ? stat.all : stat[option.value];
        return `<button type="button" data-channel-test-filter-value="${option.value}" class="${filter === option.value ? "active" : ""}">${esc(option.label)} <span>${fmtNum(count)}</span></button>`;
      }).join("");
    };

    const renderList = () => {
      if (!listBox) return;
      const visible = models.filter(model => {
        if (filter === "all") return true;
        return (entries.get(model)?.status || "pending") === filter;
      });
      if (!visible.length) {
        listBox.innerHTML = `<div class="channel-test-empty">${
          models.length
            ? "当前筛选下没有模型，换个状态看看。"
            : "该渠道还没有模型，请先编辑渠道获取或手动添加；也可以直接测试连接。"
        }</div>`;
      } else {
        listBox.innerHTML = visible
          .map(model => {
            const entry = entries.get(model) || { status: "pending" };
            const isTesting = testing.has(model);
            const statusPill = isTesting
              ? pill("测试中", "pill-blue")
              : entry.status === "success"
                ? pill("成功", "pill-green")
                : entry.status === "failed"
                  ? pill("失败", "pill-red")
                  : pill("待测试", "pill-outline");
            const latency =
              entry.latency !== null && entry.latency !== undefined ? `${fmtNum(entry.latency)} ms` : "—";
            const message = entry.message || (entry.status === "pending" ? "尚未测试" : "");
            return `<div class="channel-test-row${isTesting ? " is-testing" : ""}">
              <div class="channel-test-model"><strong class="mono" title="${esc(model)}">${esc(model)}</strong><small>${esc(entry.testedAt ? fmtRelative(entry.testedAt) : "尚未测试")}</small></div>
              <span>${statusPill}</span>
              <span class="channel-test-latency">${esc(latency)}</span>
              <span class="channel-test-message" title="${esc(message)}">${esc(message || "—")}</span>
              <button type="button" class="btn btn-ghost btn-sm" data-channel-test-model="${esc(model)}" ${running || isTesting ? "disabled" : ""}>测试</button>
            </div>`;
          })
          .join("");
      }
    };

    const render = () => {
      if (disposed) return;
      renderSummary();
      renderFilter();
      renderList();
      if (allButton) allButton.disabled = running || !models.length;
      if (stopButton) stopButton.disabled = !running;
      if (connectionButton) connectionButton.disabled = running;
      if (concurrencySelect) concurrencySelect.disabled = running;
    };

    const testOne = async (model, button) => {
      if (running || testing.has(model)) return;
      testing.add(model);
      setBusy(button, true);
      renderList();
      try {
        const result = await api("/ai/channels/test", { method: "POST", body: { id: channelId, model } });
        entries.set(model, {
          status: result.ok ? "success" : "failed",
          message: result.ok ? result.message || "模型可用" : result.error || "接口不可用",
          latency: result.latency ?? null,
          testedAt: new Date().toISOString(),
        });
        if (result.channel) channelState = applyChannelUpdate(result.channel) || channelState;
        toast(
          result.ok
            ? `${fmtNum(result.latency)} ms · ${result.message || "模型可用"}`
            : result.error || "接口不可用",
          result.ok ? "success" : "error",
          `模型测试 · ${model}`,
        );
      } catch (error) {
        entries.set(model, {
          status: "failed",
          message: error.message || String(error),
          latency: null,
          testedAt: new Date().toISOString(),
        });
        handleError(error);
      } finally {
        testing.delete(model);
        render();
      }
    };

    const testConnection = async () => {
      if (running) return;
      setBusy(connectionButton, true);
      setProgress("正在测试连接…");
      try {
        const result = await api("/ai/channels/test", { method: "POST", body: { id: channelId } });
        if (result.channel) {
          channelState = applyChannelUpdate(result.channel) || channelState;
          syncEntries(result.channel);
        }
        toast(
          result.ok
            ? `${fmtNum(result.latency)} ms${result.models?.length ? ` · ${fmtNum(result.models.length)} 个模型` : ""}`
            : result.error || "接口不可用",
          result.ok ? "success" : "error",
          `连接测试 · ${channelState.name}`,
        );
      } catch (error) {
        handleError(error);
      } finally {
        setBusy(connectionButton, false);
        setProgress("准备就绪");
        render();
      }
    };

    const stopBatch = async () => {
      if (!running) return;
      setProgress("正在停止…");
      try {
        await api("/ai/channels/test-batch-stop", {
          method: "POST",
          body: runningTestId ? { testId: runningTestId } : {},
        });
      } catch (error) {
        handleError(error);
      }
    };

    const runBatch = async () => {
      if (running) return;
      if (!models.length) return toast("该渠道没有可测试的模型", "info");
      running = true;
      runningTestId = "";
      testing.clear();
      for (const model of models)
        entries.set(model, { status: "pending", message: "", latency: null, testedAt: "" });
      channelState = { ...channelState, testStatus: "pending", testMessage: "", testLatency: null, testedAt: "" };
      controller = new AbortController();
      const total = models.length;
      setProgress(`0 / ${fmtNum(total)}`);
      render();
      let finalSuccess = 0;
      let finalFailed = 0;
      try {
        await apiSSE(
          "/ai/channels/test-batch",
          { id: channelId, models, concurrency: Number(concurrencySelect?.value) || 3 },
          {
            start: data => {
              runningTestId = data.testId || "";
              setProgress(`0 / ${fmtNum(data.total || total)}`);
            },
            testing: data => {
              testing.add(data.model);
              renderList();
            },
            result: data => {
              testing.delete(data.model);
              entries.set(data.model, {
                status: data.ok ? "success" : "failed",
                message: data.ok ? data.message || "模型可用" : data.error || data.message || "接口不可用",
                latency: data.latency ?? null,
                testedAt: new Date().toISOString(),
              });
              renderList();
            },
            progress: data => {
              setProgress(
                `${fmtNum(data.completed)} / ${fmtNum(data.total || total)} · 成功 ${fmtNum(data.success)} · 失败 ${fmtNum(data.failed)}`,
              );
              renderSummary();
            },
            complete: data => {
              finalSuccess = data.success || 0;
              finalFailed = data.failed || 0;
              if (data.channel) {
                channelState = data.channel;
                syncEntries(data.channel);
                applyChannelUpdate(data.channel);
              }
              setProgress(data.aborted ? "已停止" : "测试完成");
            },
          },
          controller.signal,
        );
        if (finalSuccess + finalFailed > 0)
          toast(
            `${fmtNum(finalSuccess)} 成功 · ${fmtNum(finalFailed)} 失败`,
            finalFailed ? "info" : "success",
            "批量测试完成",
          );
      } catch (error) {
        if (error?.name !== "AbortError") {
          handleError(error);
          try {
            await api("/ai/channels/test-batch-stop", {
              method: "POST",
              body: runningTestId ? { testId: runningTestId } : {},
            });
          } catch (stopError) {
            /* 批次可能已结束 */
          }
        }
        setProgress("已停止");
      } finally {
        running = false;
        runningTestId = "";
        controller = null;
        testing.clear();
        render();
      }
    };

    root.addEventListener("click", event => {
      const modelButton = event.target.closest("[data-channel-test-model]");
      if (modelButton) {
        testOne(modelButton.dataset.channelTestModel, modelButton);
        return;
      }
      if (event.target.closest("[data-channel-test-all]")) {
        runBatch();
        return;
      }
      if (event.target.closest("[data-channel-test-stop]")) {
        stopBatch();
        return;
      }
      if (event.target.closest("[data-channel-test-connection]")) {
        testConnection();
        return;
      }
      const filterButton = event.target.closest("[data-channel-test-filter-value]");
      if (filterButton) {
        filter = filterButton.dataset.channelTestFilterValue || "all";
        render();
      }
    });

    render();
  }

  let channelBatchRunning = false;
  let terminalPage = null;

  async function testAllChannels(button) {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    if (channelBatchRunning) return toast("批量测试正在进行中", "info");
    const items = (state.aiSections.channels?.items || []).filter(item => item.enabled !== false);
    if (!items.length) return toast("没有已启用的渠道可测试", "info");
    channelBatchRunning = true;
    const original = button ? button.innerHTML : "";
    if (button) button.disabled = true;
    let cursor = 0;
    let success = 0;
    let failed = 0;
    const failures = [];
    const syncProgress = () => {
      if (button)
        button.innerHTML = `${icon("refresh")}测试中 ${fmtNum(success + failed)}/${fmtNum(items.length)}`;
    };
    syncProgress();
    const worker = async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        try {
          const result = await api("/ai/channels/test", { method: "POST", body: { id: item.id } });
          if (result.channel) applyChannelUpdate(result.channel);
          if (result.ok) success++;
          else {
            failed++;
            failures.push(`${item.name}：${result.error || "接口不可用"}`);
          }
        } catch (error) {
          failed++;
          failures.push(`${item.name}：${error.message || error}`);
        }
        syncProgress();
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(3, items.length) }, () => worker()));
      const summary = failures.length
        ? `${fmtNum(success)} 成功 · ${fmtNum(failed)} 失败 · ${failures.slice(0, 2).join("；")}`
        : `${fmtNum(success)} 个渠道全部可用`;
      toast(summary, failed ? "info" : "success", "批量测试完成");
      state.ai = null;
      invalidateOverview();
    } finally {
      channelBatchRunning = false;
      if (button) {
        button.disabled = !state.allowWrite;
        button.innerHTML = original;
      }
    }
  }

  function testAiChannel(item) {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    openChannelTestDialog(item);
  }

  async function connectMcpItem(item, action) {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    try {
      const result = await api(`/ai/mcp/${encodeURIComponent(item.id)}/${action}`, { method: "POST" });
      toast(result.message || (action === "connect" ? "已连接" : "已断开"));
      await loadAiSection("mcpServers", true);
      state.ai = null;
    } catch (error) {
      handleError(error);
      await loadAiSection("mcpServers", true).catch(() => {});
    }
  }

  async function syncMcpServers(button) {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    setBusy(button, true);
    try {
      const result = await api("/ai/mcp/sync", { method: "POST" });
      const connected = (result.status || []).filter(item => item.connected).length;
      toast(`${connected} / ${(result.status || []).length} 个服务已连接`, "success", "同步完成");
      await loadAiSection("mcpServers", true);
      state.ai = null;
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(button, false);
    }
  }

  function handleAiSectionClick(event) {
    const pageRoot = event.currentTarget;
    const section = pageRoot.dataset.aiSectionPage;
    if (!section) return;

    if (event.target.closest("#mcpSync")) {
      syncMcpServers($("#mcpSync"));
      return;
    }
    if (event.target.closest("#imageTestRun")) {
      runImageTest();
      return;
    }
    if (event.target.closest("#aiPresetExport")) {
      exportPresets().catch(handleError);
      return;
    }
    if (event.target.closest("#aiPresetImport")) {
      openPresetImport();
      return;
    }
    const presetExport = event.target.closest("[data-ai-export]");
    if (presetExport) {
      const item = aiSectionItem("presets", presetExport.dataset.aiExport);
      if (item) exportPresets([item]).catch(handleError);
      return;
    }
    if (event.target.closest("[data-ai-add]")) {
      openAiSectionModal(section, null);
      return;
    }
    const channelFilter = event.target.closest("[data-ai-channel-filter]");
    if (channelFilter) {
      state.channelTestFilter = channelFilter.dataset.aiChannelFilter || "all";
      renderAiSection("channels");
      return;
    }
    const testAll = event.target.closest("[data-ai-test-all]");
    if (testAll) {
      testAllChannels(testAll);
      return;
    }
    const edit = event.target.closest("[data-ai-edit]");
    if (edit) {
      const item = aiSectionItem(section, edit.dataset.aiEdit);
      if (item) openAiSectionModal(section, item);
      return;
    }
    const del = event.target.closest("[data-ai-delete]");
    if (del) {
      const item = aiSectionItem(section, del.dataset.aiDelete);
      if (item) deleteAiSectionItem(section, item);
      return;
    }
    const active = event.target.closest("[data-ai-active]");
    if (active) {
      const item = aiSectionItem(section, active.dataset.aiActive);
      if (item) toggleAiSectionActive(section, item, state.aiSections[section]?.activeId === item.id);
      return;
    }
    const test = event.target.closest("[data-ai-test-channel]");
    if (test) {
      const item = aiSectionItem(section, test.dataset.aiTestChannel);
      if (item) testAiChannel(item);
      return;
    }
    const connect = event.target.closest("[data-ai-connect]");
    if (connect) {
      const item = aiSectionItem(section, connect.dataset.aiConnect);
      if (item) connectMcpItem(item, "connect");
      return;
    }
    const disconnect = event.target.closest("[data-ai-disconnect]");
    if (disconnect) {
      const item = aiSectionItem(section, disconnect.dataset.aiDisconnect);
      if (item) connectMcpItem(item, "disconnect");
    }
  }

  function handleAiSectionChange(event) {
    const pageRoot = event.currentTarget;
    if (pageRoot.dataset.aiSectionPage !== "imagePresets") return;
    if (event.target.id !== "imageCfgEnabled") return;
    saveImageConfig(event.target.checked).catch(handleError);
  }

  /* ---------------- 绘图配置 / 测试 ---------------- */

  function renderImageConfig() {
    const bucket = state.aiSections.imagePresets;
    if (!bucket) return;
    const config = bucket.config || {};
    const enabled = config.enabled !== false;
    const toggle = $("#imageCfgEnabled");
    if (toggle) {
      toggle.checked = enabled;
      toggle.disabled = !state.allowWrite;
    }
    const statePill = $("#imageCfgPill");
    if (statePill) {
      statePill.className = `pill ${enabled ? "pill-green" : ""}`;
      statePill.textContent = enabled ? "已启用" : "已停用";
    }
    const active = (bucket.items || []).find(item => item.id === bucket.activeId);
    const note = $("#imageCfgNote");
    if (note)
      note.textContent = enabled
        ? `当前预设：${active ? active.name : "未选择（使用默认参数）"}。AI 可通过绘图工具生成图片。`
        : "绘图能力已关闭，AI 不会获得图片生成工具。";
    const select = $("#imageTestPreset");
    if (select) {
      const current = select.value;
      select.innerHTML = [
        `<option value="">跟随当前启用预设</option>`,
        ...(bucket.items || []).map(
          item => `<option value="${esc(item.id)}">${esc(item.name)}${item.id === bucket.activeId ? "（当前）" : ""}</option>`,
        ),
      ].join("");
      select.value = (bucket.items || []).some(item => item.id === current) ? current : "";
    }
    ["#imageTestPreset", "#imageTestSize", "#imageTestPrompt", "#imageTestRun"].forEach(selector => {
      const el = $(selector);
      if (el) el.disabled = !state.allowWrite;
    });
  }

  async function saveImageConfig(enabled) {
    if (!state.allowWrite) {
      renderImageConfig();
      return toast("WebUI 当前为只读模式", "info");
    }
    const toggle = $("#imageCfgEnabled");
    setBusy(toggle, true);
    try {
      const result = await api("/ai/image-config", { method: "POST", body: { enabled: enabled === true } });
      if (state.aiSections.imagePresets) state.aiSections.imagePresets.config = result.config || { enabled };
      state.ai = null;
      renderImageConfig();
      toast(result.message || "绘图配置已保存");
    } catch (error) {
      renderImageConfig();
      handleError(error);
    } finally {
      setBusy(toggle, false);
      if (toggle) toggle.disabled = !state.allowWrite;
    }
  }

  async function runImageTest() {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    const prompt = $("#imageTestPrompt").value.trim();
    if (!prompt) return toast("请先填写绘图提示词", "info");
    const size = $("#imageTestSize").value.trim();
    if (size && !/^\d{2,5}x\d{2,5}$/.test(size)) return toast("尺寸格式应为 1024x1024", "error");
    const presetId = $("#imageTestPreset").value;
    const button = $("#imageTestRun");
    const result = $("#imageTestResult");
    result.hidden = false;
    result.innerHTML = `<div class="ai-test-loading"><span class="spinner"></span>正在请求绘图接口，可能需要几十秒…</div>`;
    setBusy(button, true);
    try {
      const data = await api("/ai/image-presets/test", { method: "POST", body: { prompt, presetId, size } });
      let media = `<span class="muted">接口未返回可预览的图片</span>`;
      if (data.dataUrl && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(data.dataUrl))
        media = `<img src="${esc(data.dataUrl)}" alt="生成结果" />`;
      else if (/^https?:\/\//i.test(data.url || ""))
        media = `<a class="btn btn-outline btn-sm" href="${esc(data.url)}" target="_blank" rel="noopener noreferrer">打开生成图片</a>`;
      result.innerHTML = `<div class="ai-test-media">${media}</div>
        <div class="ai-test-meta">
          ${data.preset ? `<span>预设：${esc(data.preset.name)}</span>` : ""}
          <span class="mono">${esc(data.prompt || prompt)}</span>
          ${data.revisedPrompt ? `<span class="muted">修订提示词：${esc(data.revisedPrompt)}</span>` : ""}
        </div>`;
      toast("绘图接口返回成功", "success", "测试生图");
    } catch (error) {
      result.innerHTML = `<div class="form-error show">${esc(error.message || String(error))}</div>`;
    } finally {
      setBusy(button, false);
      if (button) button.disabled = !state.allowWrite;
    }
  }

  /* ---------------- 工具配置 ---------------- */

  function toolNumField(key, label, value, placeholder, hint) {
    return `<div class="field">
      <span>${esc(label)}</span>
      <input type="number" min="0" step="1" data-tool-field="${key}" value="${value === null || value === undefined ? "" : esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" />
      <div class="hint">${esc(hint)}</div>
    </div>`;
  }

  function toolSwitchField(key, label, checked, hint) {
    return `<div class="field">
      <span>${esc(label)}</span>
      <label class="switch"><input type="checkbox" data-tool-field="${key}" ${checked ? "checked" : ""} /><span class="track"></span><span data-switch-text>${checked ? "开启" : "关闭"}</span></label>
      <div class="hint">${esc(hint)}</div>
    </div>`;
  }

  function toolYamlTagsHtml(values) {
    const list = Array.isArray(values) ? values : [];
    if (!list.length) return `<span class="config-tags-empty">未配置</span>`;
    return list
      .map(
        name =>
          `<span class="config-tag" data-yaml-value="${esc(name)}">${esc(name)}${
            state.allowWrite ? `<button type="button" data-yaml-remove="${esc(name)}" aria-label="移除">×</button>` : ""
          }</span>`,
      )
      .join("");
  }

  function toolYamlListField(key, label, values, candidates, hint) {
    const options = [...new Set((candidates || []).map(String).filter(Boolean))]
      .map(name => `<option value="${esc(name)}"></option>`)
      .join("");
    return `<div class="field wide">
      <span>${esc(label)}</span>
      <div class="config-list-editor">
        <div class="config-tags" data-yaml-list="${key}">${toolYamlTagsHtml(values)}</div>
        ${
          state.allowWrite
            ? `<div class="config-list-add">
          <input class="config-input" type="text" list="toolYamlOptions-${key}" data-yaml-input="${key}" placeholder="输入或选择名称" autocomplete="off" />
          <button type="button" class="btn btn-outline btn-sm" data-yaml-add="${key}">${icon("plus")}添加</button>
        </div>`
            : ""
        }
      </div>
      <div class="hint">${esc(hint)}</div>
      <datalist id="toolYamlOptions-${key}">${options}</datalist>
    </div>`;
  }

  async function loadToolConfigPage(force) {
    const data = await api("/ai/tools");
    state.aiTools.data = data;
    renderToolConfigPage();
    return data;
  }

  function renderToolConfigPage() {
    const data = state.aiTools.data;
    if (!data) return;
    const cfg = data.config || {};
    const yaml = data.yaml || {};
    const stats = data.stats || {};
    $("#toolCfgStats").innerHTML = [
      miniStat("工具总数", fmtNum(stats.totalTools), "tool", 1),
      miniStat("插件来源", fmtNum(stats.plugins), "puzzle", 2),
      miniStat("重名冲突", fmtNum(stats.collisions), "alert", 3),
      miniStat("已跳过", fmtNum(stats.skipped), "info", 4),
    ].join("");
    $("#toolCfgForm").innerHTML = `<div class="ai-form-grid">
      ${toolSwitchField(
        "autoRegisterTools",
        "注册插件工具",
        yaml.autoRegisterTools === true,
        "开启后把 plugins 里的插件规则注册为 AI 工具；关闭则不注册，改动即写入 config/config/ai.yaml 并立即生效",
      )}
      ${toolSwitchField(
        "lazyTools",
        "按需加载工具",
        yaml.lazyTools !== false,
        "开启后模型先检索再调用工具，省上下文；关闭则每轮直接给出全部可用工具",
      )}
      ${toolNumField("maxToolsPerRequest", "每次最多发送工具数", cfg.maxToolsPerRequest, `沿用 ai.yaml：${fmtNum(yaml.maxToolsPerRequest ?? 0)}`, `0 = 不限制；留空沿用 ai.yaml（当前 ${fmtNum(yaml.maxToolsPerRequest ?? 0)}）`)}
      ${toolNumField("maxToolRounds", "最大工具回合", cfg.maxToolRounds, `沿用 ai.yaml：${fmtNum(yaml.maxToolRounds ?? 5)}`, `一次对话最多连续调用工具的轮数，留空沿用 ai.yaml（当前 ${fmtNum(yaml.maxToolRounds ?? 5)}）`)}
      ${toolNumField("toolResultMaxLength", "工具结果截断长度", cfg.toolResultMaxLength, `沿用 ai.yaml：${fmtNum(yaml.toolResultMaxLength ?? 4000)}`, `返回给模型的工具结果最大字符数，0 不截断；留空沿用 ai.yaml（当前 ${fmtNum(yaml.toolResultMaxLength ?? 4000)}）`)}
      ${toolYamlListField(
        "disabledTools",
        "ai.yaml 禁用工具",
        yaml.disabledTools,
        (data.tools || []).flatMap(tool => [tool.name, tool.mcpName]),
        "文件级兜底，与下方开关叠加；改动即写入 config/config/ai.yaml。",
      )}
      ${toolYamlListField(
        "disabledToolPlugins",
        "ai.yaml 禁用插件",
        yaml.disabledToolPlugins,
        (data.plugins || []).map(plugin => plugin.name),
        "文件级兜底，与下方开关叠加；改动即写入 config/config/ai.yaml。",
      )}
      ${toolSwitchField("allowMasterTools", "允许主人使用受限工具", cfg.allowMasterTools !== false, "关闭后，即使主人调用也会被权限过滤")}
      ${toolSwitchField("freeToolsOnly", "仅允许免权限工具", cfg.freeToolsOnly === true, "开启后所有非主人用户只能调用无需权限的工具")}
    </div>`;
    $$("#toolCfgForm input, #toolCfgForm select, #toolCfgForm textarea, #toolCfgForm button").forEach(input => {
      input.disabled = !state.allowWrite;
    });
    const save = $("#toolCfgSave");
    if (save) save.disabled = !state.allowWrite;
    renderToolConfigTable();
  }

  function renderToolConfigTable() {
    const data = state.aiTools.data;
    if (!data) return;
    const cfg = data.config || {};
    const yaml = data.yaml || {};
    const disabled = new Set(cfg.disabledTools || []);
    const disabledPlugins = new Set(cfg.disabledToolPlugins || []);
    const yamlDisabled = new Set(yaml.disabledTools || []);
    const yamlDisabledPlugins = new Set(yaml.disabledToolPlugins || []);
    const isToolDisabled = tool => {
      const names = [tool.name, tool.mcpName].filter(Boolean);
      return names.some(name => disabled.has(name) || yamlDisabled.has(name));
    };
    const isPluginDisabled = name => disabledPlugins.has(name) || yamlDisabledPlugins.has(name);
    const query = state.aiTools.query.trim().toLowerCase();
    const tools = (data.tools || []).filter(tool => {
      if (!query) return true;
      return `${tool.name} ${tool.description || ""} ${tool.plugin || ""}`.toLowerCase().includes(query);
    });
    const offCount = new Set([...disabled, ...yamlDisabled]).size;
    const pluginOffCount = new Set([...disabledPlugins, ...yamlDisabledPlugins]).size;
    $("#toolCfgCount").textContent = `共 ${fmtNum((data.tools || []).length)} 个工具 · ${fmtNum(offCount)} 个已禁用 · ${fmtNum(pluginOffCount)} 个插件受限${query ? ` · 匹配 ${fmtNum(tools.length)} 个` : ""}`;
    $("#toolCfgPlugins").innerHTML = (data.plugins || []).length
      ? data.plugins
          .map(plugin => {
            const blocked = isPluginDisabled(plugin.name);
            const fromYaml = yamlDisabledPlugins.has(plugin.name);
            return `<button type="button" class="chip ${blocked ? "active" : ""}" data-tool-plugin="${esc(plugin.name)}" title="${blocked ? "点击恢复该插件" : "点击禁用该插件的全部工具"}${fromYaml ? "（含 ai.yaml 限制）" : ""}">${esc(plugin.name)}<span class="count">${fmtNum(plugin.count)}</span></button>`;
          })
          .join("")
      : `<span class="muted">暂无已注册插件</span>`;
    $("#toolCfgRows").innerHTML = tools.length
      ? tools
          .map(tool => {
            const enabled = !isToolDisabled(tool);
            const fromYaml = yamlDisabled.has(tool.name) || (tool.mcpName && yamlDisabled.has(tool.mcpName));
            return `<tr>
              <td><div class="cell-main"><strong class="mono">${esc(tool.name)}</strong><small class="mono">${esc(tool.mcpName || "")}</small></div></td>
              <td><div class="cell-desc" title="${esc(tool.description || "")}">${esc(tool.description || "—")}</div></td>
              <td>${esc(tool.plugin || "—")}</td>
              <td>${permissionPill(tool.permission)}</td>
              <td>${dangerPill(tool.danger)}</td>
              <td style="text-align:right">${fromYaml ? '<span class="muted" style="font-size:10px;margin-right:6px">YAML</span>' : ""}<label class="switch"><input type="checkbox" data-tool-toggle="${esc(tool.name)}" data-tool-exposed="${esc(tool.mcpName || "")}" ${enabled ? "checked" : ""} ${state.allowWrite ? "" : "disabled"} /><span class="track"></span></label></td>
            </tr>`;
          })
          .join("")
      : tableEmpty(6, query ? "没有匹配的工具" : "暂无已注册工具");
  }

  function collectToolConfigForm() {
    const current = state.aiTools.data?.config || {};
    const yaml = state.aiTools.data?.yaml || {};
    const readNumber = (key, label) => {
      const input = $(`[data-tool-field="${key}"]`, $("#toolCfgForm"));
      if (!input) return null;
      const raw = input.value.trim();
      if (raw === "") return null;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) throw new Error(`「${label}」必须是不小于 0 的数字`);
      return Math.floor(value);
    };
    return {
      config: {
        disabledTools: current.disabledTools || [],
        disabledToolPlugins: current.disabledToolPlugins || [],
        maxToolsPerRequest: readNumber("maxToolsPerRequest", "每次最多发送工具数"),
        maxToolRounds: readNumber("maxToolRounds", "最大工具回合"),
        toolResultMaxLength: readNumber("toolResultMaxLength", "工具结果截断长度"),
        allowMasterTools: $('[data-tool-field="allowMasterTools"]', $("#toolCfgForm")).checked,
        freeToolsOnly: $('[data-tool-field="freeToolsOnly"]', $("#toolCfgForm")).checked,
      },
      yaml: {
        disabledTools: yaml.disabledTools || [],
        disabledToolPlugins: yaml.disabledToolPlugins || [],
        autoRegisterTools: $('[data-tool-field="autoRegisterTools"]', $("#toolCfgForm"))?.checked === true,
        lazyTools: $('[data-tool-field="lazyTools"]', $("#toolCfgForm"))?.checked === true,
      },
    };
  }

  async function saveToolConfig(notify) {
    if (!state.allowWrite) {
      toast("WebUI 当前为只读模式", "info");
      if (notify) renderToolConfigPage();
      return;
    }
    let body;
    try {
      body = collectToolConfigForm();
    } catch (error) {
      if (notify) toast(error.message, "error");
      throw error;
    }
    const switchedFrom = state.aiTools.data.yaml?.autoRegisterTools === true;
    const result = await api("/ai/tools/config", { method: "POST", body });
    state.aiTools.data.config = result.config;
    if (result.yaml) state.aiTools.data.yaml = result.yaml;
    state.ai = null;
    // 插件工具开关会改变工具总数，保存后重新拉一次列表
    const nextAuto = result.yaml?.autoRegisterTools;
    if (nextAuto !== undefined && nextAuto !== switchedFrom) await loadToolConfigPage(true);
    if (notify) {
      renderToolConfigPage();
      toast(result.message || "工具配置已保存");
    } else {
      renderToolConfigTable();
      renderToolYamlLists();
    }
  }

  function renderToolYamlLists() {
    const yaml = state.aiTools.data?.yaml || {};
    for (const key of ["disabledTools", "disabledToolPlugins"]) {
      const box = $(`[data-yaml-list="${key}"]`, $("#toolCfgForm"));
      if (box) box.innerHTML = toolYamlTagsHtml(yaml[key]);
    }
  }

  function snapshotToolYamlLists() {
    const yaml = state.aiTools.data?.yaml || {};
    return {
      disabledTools: [...(yaml.disabledTools || [])],
      disabledToolPlugins: [...(yaml.disabledToolPlugins || [])],
    };
  }

  function setToolYamlList(key, values) {
    if (!state.aiTools.data) return;
    state.aiTools.data.yaml = state.aiTools.data.yaml || {};
    state.aiTools.data.yaml[key] = values;
  }

  async function saveToolYamlList(key, mutate) {
    if (!state.allowWrite) {
      toast("WebUI 当前为只读模式", "info");
      return;
    }
    const before = snapshotToolYamlLists();
    setToolYamlList(key, mutate([...(state.aiTools.data?.yaml?.[key] || [])]));
    renderToolYamlLists();
    try {
      await saveToolConfig(false);
    } catch (error) {
      state.aiTools.data.yaml = before;
      renderToolYamlLists();
      throw error;
    }
  }

  function toggleToolDisabled(name, enabled, exposedName) {
    if (!state.aiTools.data) return;
    const cfg = state.aiTools.data.config;
    const yaml = state.aiTools.data.yaml || {};
    const set = new Set(cfg.disabledTools || []);
    const yamlSet = new Set(yaml.disabledTools || []);
    if (enabled) {
      for (const item of [name, exposedName].filter(Boolean)) {
        set.delete(item);
        yamlSet.delete(item);
      }
    } else set.add(name);
    cfg.disabledTools = [...set];
    setToolYamlList("disabledTools", [...yamlSet]);
    renderToolYamlLists();
  }

  function toggleToolPlugin(plugin) {
    if (!state.aiTools.data) return;
    const cfg = state.aiTools.data.config;
    const yaml = state.aiTools.data.yaml || {};
    const set = new Set(cfg.disabledToolPlugins || []);
    const yamlSet = new Set(yaml.disabledToolPlugins || []);
    const blocked = set.has(plugin) || yamlSet.has(plugin);
    if (blocked) {
      set.delete(plugin);
      yamlSet.delete(plugin);
    } else set.add(plugin);
    cfg.disabledToolPlugins = [...set];
    setToolYamlList("disabledToolPlugins", [...yamlSet]);
    renderToolYamlLists();
  }

  /* ---------------- 通用下载 / 分页 ---------------- */

  async function downloadJson(path, filename) {
    const response = await fetch(apiUrl(path), { headers: authHeaders(), cache: "no-store" });
    if (!response.ok) {
      let message = `导出失败（HTTP ${response.status}）`;
      try {
        const data = await response.json();
        if (data.message) message = data.message;
      } catch {}
      throw new Error(message);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`已开始下载 ${filename}`, "info");
  }

  function renderListPager(selector, data, unit) {
    const pager = typeof selector === "string" ? $(selector) : selector;
    if (!pager) return;
    const total = Number(data?.total) || 0;
    if (!total) {
      pager.innerHTML = `<span>暂无记录</span>`;
      return;
    }
    const page = Number(data.page) || 1;
    const pageSize = Number(data.pageSize) || 20;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    pager.innerHTML = `<span>共 ${fmtNum(total)} ${esc(unit || "条记录")} · 第 ${fmtNum(page)} / ${fmtNum(totalPages)} 页</span>
      <div class="pager-btns">
        <button type="button" class="btn btn-outline btn-sm" data-page-step="-1" ${page <= 1 ? "disabled" : ""}>上一页</button>
        <button type="button" class="btn btn-outline btn-sm" data-page-step="1" ${page >= totalPages ? "disabled" : ""}>下一页</button>
      </div>`;
  }

  function stepPager(event, bucket, reload) {
    const button = event.target.closest("[data-page-step]");
    if (!button || button.disabled) return;
    const step = Number(button.dataset.pageStep);
    bucket.page = Math.max(1, (Number(bucket.page) || 1) + step);
    reload().catch(handleError);
  }

  /* ---------------- 回忆管理 ---------------- */

  function memoryScopeLabel(scope) {
    if (!scope || scope === "global") return "全局";
    return scopeLabel(scope);
  }

  function memoryScopeVariant(scope) {
    if (!scope || scope === "global") return "pill-blue";
    return scopeVariant(scope);
  }

  function memoryKindLabel(kind) {
    return kind === "episode" ? "经历" : "事实";
  }

  const MEMORY_EMOTIONS = [
    ["joy", "乐"],
    ["sadness", "悲"],
    ["anger", "怒"],
    ["fear", "惧"],
    ["surprise", "惊"],
    ["disgust", "厌"],
  ];

  function memoryEmotionLabel(emotion) {
    if (!emotion || !emotion.primary) return "";
    const words = [emotion.primary, ...(emotion.secondary || [])]
      .map(key => MEMORY_EMOTIONS.find(item => item[0] === key)?.[1] || key)
      .join("/");
    return emotion.intensity >= 3 ? `${words}·强` : emotion.intensity === 1 ? `${words}·弱` : words;
  }

  function memoryKindVariant(kind) {
    return kind === "episode" ? "pill-pink" : "pill-blue";
  }

  function memoryClip(value, max = 160) {
    const content = String(value || "").replace(/\s+/g, " ").trim();
    return content.length > max ? `${content.slice(0, max)}…` : content;
  }

  async function loadMemories(force) {
    const bucket = state.aiMemories;
    const params = new URLSearchParams();
    params.set("page", String(bucket.page));
    params.set("pageSize", String(bucket.pageSize));
    if (bucket.query) params.set("query", bucket.query);
    if (bucket.scope) params.set("scope", bucket.scope);
    if (bucket.kind) params.set("kind", bucket.kind);
    if (bucket.archived) params.set("archived", bucket.archived);
    const data = await api(`/ai/memories?${params.toString()}`);
    bucket.data = data;
    if (!bucket.configRendered || force) {
      renderMemoryConfig(data.config || {});
      bucket.configRendered = true;
    }
    renderMemories(data);
    return data;
  }

  function renderMemoryConfig(config) {
    const form = $("#memConfigForm");
    if (!form) return;
    const cfg = config || {};
    const switchField = (key, label, checked, hint) => `<div class="field">
      <span>${esc(label)}</span>
      <label class="switch"><input type="checkbox" data-mem-field="${key}" ${checked ? "checked" : ""} /><span class="track"></span><span data-switch-text>${checked ? "开启" : "关闭"}</span></label>
      <div class="hint">${esc(hint)}</div>
    </div>`;
    const numberField = (key, label, value, min, max, hint) => `<div class="field">
      <span>${esc(label)}</span>
      <input type="number" data-mem-field="${key}" value="${esc(value ?? "")}" min="${min}" max="${max}" step="1" />
      <div class="hint">${esc(hint)}</div>
    </div>`;
    form.innerHTML = `<div class="ai-form-grid">
      ${switchField("enabled", "启用回忆", cfg.enabled !== false, "关闭后不会向提示词注入回忆，也不会自动整理")}
      ${switchField("autoExtract", "自动整理回忆", cfg.autoExtract === true, "每 N 轮对话后把值得保留的内容整理成结构化经历或事实")}
      ${switchField("autoExtractKnowledge", "自动写入知识", cfg.autoExtractKnowledge === true, "对话中出现有用的规则、设定或做法时，自动存进知识库")}
      ${switchField("allowSelfPersonaEdit", "允许 AI 修改自己的人格", cfg.allowSelfPersonaEdit === true, "开启后 AI 可在主人要求时改写当前人格提示词；只影响它自己正在用的人格")}
      ${switchField("autoCompress", "自动合并重复回忆", cfg.autoCompress === true, "回忆达到下面的阈值后自动把重复条目合并成一条，旧条目留档不再注入")}
      ${numberField("injectLimit", "每次注入条数", cfg.injectLimit ?? 8, 0, 50, "按重要度、深度与新鲜度选出；关联回忆会一起注入，0 表示不注入")}
      ${numberField("maxMemories", "回忆容量", cfg.maxMemories ?? 300, 10, 5000, "超过容量后优先淘汰最久未更新且未固定的回忆")}
      ${numberField("extractEvery", "自动整理间隔", cfg.extractEvery ?? 8, 1, 100, "每隔多少轮用户消息触发一次自动整理；知识自动写入也用这个间隔")}
      ${numberField("compressThreshold", "合并阈值", cfg.compressThreshold ?? 60, 10, 5000, "活跃回忆达到这个条数才自动合并；合并后旧条目留档，不会删除")}
    </div>`;
    $$("input, select, textarea", form).forEach(input => {
      input.disabled = !state.allowWrite;
    });
    const save = $("#memConfigSave");
    if (save) save.disabled = !state.allowWrite;
  }

  async function saveMemoryConfig() {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    const form = $("#memConfigForm");
    const value = key => $(`[data-mem-field="${key}"]`, form);
    const readNumber = (key, label, min, max) => {
      const raw = value(key).value.trim();
      const number = Number(raw);
      if (raw === "" || !Number.isFinite(number) || number < min || number > max)
        throw new Error(`「${label}」应在 ${min} - ${max} 之间`);
      return Math.floor(number);
    };
    let body;
    try {
      body = {
        enabled: value("enabled").checked,
        autoExtract: value("autoExtract").checked,
        autoExtractKnowledge: value("autoExtractKnowledge").checked,
        allowSelfPersonaEdit: value("allowSelfPersonaEdit").checked,
        autoCompress: value("autoCompress").checked,
        injectLimit: readNumber("injectLimit", "每次注入条数", 0, 50),
        maxMemories: readNumber("maxMemories", "记忆容量", 10, 5000),
        extractEvery: readNumber("extractEvery", "自动提取间隔", 1, 100),
        compressThreshold: readNumber("compressThreshold", "合并阈值", 10, 5000),
      };
    } catch (error) {
      return toast(error.message, "error");
    }
    const button = $("#memConfigSave");
    setBusy(button, true);
    try {
      const result = await api("/ai/memory-config", { method: "POST", body });
      if (state.aiMemories.data) state.aiMemories.data.config = result.config;
      state.ai = null;
      renderMemoryConfig(result.config || body);
      toast(result.message || "记忆配置已保存");
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(button, false);
      if (button) button.disabled = !state.allowWrite;
    }
  }

  function renderMemories(data) {
    const bucket = state.aiMemories;
    const results = data.results || [];
    const stats = data.stats || {};
    $("#memStats").innerHTML = [
      miniStat("回忆条目", fmtNum(stats.total), "database", 1),
      miniStat("经历 / 事实", `${fmtNum(stats.episodes || 0)} / ${fmtNum(stats.facts || 0)}`, "book", 2),
      miniStat("平均深度", `${fmtNum(stats.avgDepth || 0)}/100`, "spark", 3),
      miniStat("长时关系", fmtNum(stats.relations || 0), "users", 4),
    ].join("");

    const search = $("#memSearch");
    if (document.activeElement !== search && search.value !== bucket.query) search.value = bucket.query;

    const scopes = Object.keys(stats.scopes || {}).sort();
    if (!scopes.includes("global")) scopes.unshift("global");
    const select = $("#memScope");
    select.innerHTML = [
      `<option value="">全部作用域</option>`,
      ...scopes.map(scope => `<option value="${esc(scope)}">${esc(memoryScopeLabel(scope))}（${fmtNum(stats.scopes?.[scope] || 0)}）</option>`),
      ...(bucket.scope && !scopes.includes(bucket.scope)
        ? [`<option value="${esc(bucket.scope)}">${esc(memoryScopeLabel(bucket.scope))}</option>`]
        : []),
    ].join("");
    select.value = bucket.scope || "";
    const kindSelect = $("#memKind");
    if (kindSelect) kindSelect.value = bucket.kind || "";

    $("#memCount").textContent = `${fmtNum(data.total)} 条回忆${bucket.kind ? ` · ${memoryKindLabel(bucket.kind)}` : ""}${bucket.query ? ` · 搜索「${bucket.query}」` : ""}${bucket.scope ? ` · ${memoryScopeLabel(bucket.scope)}` : ""}`;
    const canWrite = state.allowWrite;
    $("#memRows").innerHTML = results.length
      ? results
          .map(entry => {
            const title = memoryClip(entry.title || entry.content || entry.event, 90) || "（无标题）";
            const detailSource = entry.kind === "episode" ? entry.event || entry.content : entry.content;
            const detail = detailSource && detailSource !== title ? memoryClip(detailSource, 180) : "";
            const tags = (entry.tags || []).map(tag => `<span class="chip" data-fulltext="#${esc(tag)}" title="#${esc(tag)}">#${esc(tag)}</span>`).join(" ");
            const feelings = (entry.feelings || [])
              .slice(0, 2)
              .map(feel => `<span class="chip" data-fulltext="${esc(feel)}" title="${esc(feel)}">${esc(feel)}</span>`)
              .join(" ");
            const emotionText = memoryEmotionLabel(entry.emotion);
            const moodEnergy = [emotionText ? `情绪 ${emotionText}` : "", entry.mood ? `心情 ${entry.mood}` : "", entry.energy ? `精力 ${entry.energy}` : ""].filter(Boolean).join(" · ");
            const relation = entry.relationship || {};
            const relationText = [
              relation.trust !== null && relation.trust !== undefined ? `信任 ${fmtNum(relation.trust)}` : "",
              relation.affinity !== null && relation.affinity !== undefined ? `好感 ${fmtNum(relation.affinity)}` : "",
            ].filter(Boolean).join(" · ");
            const status = [
              moodEnergy ? `<div class="mem-sub" data-fulltext="${esc(moodEnergy)}" title="${esc(moodEnergy)}"><span>${esc(moodEnergy)}</span></div>` : "",
              feelings ? `<div class="chips" style="margin:0 0 3px">${feelings}</div>` : "",
              relationText
                ? `<div class="mem-sub" data-fulltext="${esc(relationText + (relation.note ? ` · ${memoryClip(relation.note, 40)}` : ""))}" title="${esc(relationText + (relation.note ? ` · ${memoryClip(relation.note, 40)}` : ""))}"><span>${esc(relationText)}${relation.note ? ` · ${esc(memoryClip(relation.note, 40))}` : ""}</span></div>`
                : "",
            ].filter(Boolean).join("") || '<span class="muted">—</span>';
            const linkCount = (entry.links || []).length;
            const depth = Math.max(0, Math.min(100, Number(entry.depth) || 0));
            const occurred = String(entry.occurredAt || entry.createdAt || "").slice(0, 10);
            // 这条回忆是哪个同人格记下的，方便区分「我」和「另一个我」
            const byPersona = entry.presetName
              ? `<span class="chip" data-fulltext="${esc(entry.presetName)}" title="${esc(entry.presetName)}">${esc(entry.presetName)}</span>`
              : "";
            const actions = canWrite
              ? `${entry.archivedAt ? `<button type="button" class="icon-btn" data-mem-action="restore" title="恢复">${icon("refresh")}</button>` : ""}
                 <button type="button" class="icon-btn" data-mem-action="pin" title="${entry.pinned ? "取消固定" : "固定回忆"}">${icon("pin")}</button>
                 <button type="button" class="icon-btn" data-mem-action="edit" title="编辑">${icon("edit")}</button>
                 <button type="button" class="icon-btn danger" data-mem-action="delete" title="删除">${icon("trash")}</button>`
              : "";
            return `<tr data-mem-id="${esc(entry.id)}">
              <td><div class="mem-title" data-fulltext="${esc(entry.title || entry.content || entry.event)}" title="${esc(entry.title || entry.content || entry.event)}">${esc(title)}</div>
                ${detail ? `<div class="mem-content" title="${esc(detailSource)}">${esc(detail)}</div>` : ""}
                <div class="mem-sub">${entry.pinned ? pill("固定", "pill-amber") : ""}${entry.archivedAt ? pill("已遗忘", "pill-gray") : ""}${byPersona}<span class="mono">${esc(entry.id)}</span><span>${esc(occurred)}</span>${tags ? `<span class="chips" style="margin:0">${tags}</span>` : ""}</div></td>
              <td>${pill(memoryKindLabel(entry.kind), memoryKindVariant(entry.kind))}</td>
              <td>${pill(memoryScopeLabel(entry.scope), memoryScopeVariant(entry.scope))}</td>
              <td>${status}</td>
              <td class="cell-num">${linkCount ? `${fmtNum(linkCount)} 条` : '<span class="muted">—</span>'}</td>
              <td><div class="depth-cell"><div class="depth-bar"><i style="width:${depth}%"></i></div><span class="depth-num">${depth}</span></div>
                <div class="mem-sub" data-fulltext="重要 ${fmtNum(entry.importance || 1)}/5 · 使用 ${fmtNum(entry.useCount || 0)}" title="重要 ${fmtNum(entry.importance || 1)}/5 · 使用 ${fmtNum(entry.useCount || 0)}"><span>重要 ${fmtNum(entry.importance || 1)}/5 · 使用 ${fmtNum(entry.useCount || 0)}</span></div></td>
              <td>${esc(fmtRelative(entry.updatedAt))}</td>
              <td class="cell-actions">${actions || "—"}</td>
            </tr>`;
          })
          .join("")
      : tableEmpty(8, bucket.query || bucket.scope || bucket.kind ? "没有匹配的回忆" : "还没有回忆，点击右上角添加。");
    renderListPager("#memPager", data, "条回忆");
  }

  function openMemoryModal(entry) {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    const scopes = Object.keys(state.aiMemories.data?.stats?.scopes || {});
    if (!scopes.includes("global")) scopes.unshift("global");
    const field = (key, label, value, options = {}) => {
      const { hint = "", placeholder = "", type = "text", wide = false, min, max, step = "", list = "" } = options;
      const attrs = [
        `type="${type}"`,
        `data-mem-form="${key}"`,
        `value="${esc(value ?? "")}"`,
        placeholder ? `placeholder="${esc(placeholder)}"` : "",
        list ? `list="${list}"` : "",
        min !== undefined ? `min="${min}"` : "",
        max !== undefined ? `max="${max}"` : "",
        step ? `step="${step}"` : "",
        `autocomplete="off"`,
      ].filter(Boolean).join(" ");
      return `<div class="field${wide ? " wide" : ""}"><span>${esc(label)}</span><input ${attrs} />${hint ? `<div class="hint">${esc(hint)}</div>` : ""}</div>`;
    };
    const area = (key, label, value, options = {}) => {
      const { hint = "", placeholder = "", rows = 3, wide = false } = options;
      return `<div class="field${wide ? " wide" : ""}"><span>${esc(label)}</span><textarea data-mem-form="${key}" rows="${rows}" placeholder="${esc(placeholder)}">${esc(value ?? "")}</textarea>${hint ? `<div class="hint">${esc(hint)}</div>` : ""}</div>`;
    };
    const pinned = entry?.pinned === true;
    const kind = entry?.kind === "episode" ? "episode" : "fact";
    const occurredAt = String(entry?.occurredAt || "").slice(0, 10);
    const relationship = entry?.relationship || {};
    const modal = openModal({
      title: entry ? "编辑回忆" : "添加回忆",
      subtitle: entry
        ? `ID ${entry.id} · 深度 ${entry.depth || 0}/100 · 关联 ${(entry.links || []).length} 条`
        : "一件事记成经历，稳定的偏好用事实；没有证据的维度留空。",
      width: "wide",
      body: `<div class="modal-body">
        <div class="ai-form-grid">
          <div class="field">
            <span>类型</span>
            <select data-mem-form="kind">
              <option value="fact" ${kind === "fact" ? "selected" : ""}>事实</option>
              <option value="episode" ${kind === "episode" ? "selected" : ""}>经历</option>
            </select>
            <div class="hint">经历记录一件事的全貌；事实只记简短的偏好与约定。</div>
          </div>
          <div class="field">
            <span>作用域</span>
            <input type="text" data-mem-form="scope" list="memScopeOptions" value="${esc(entry?.scope || "global")}" placeholder="global / group:123456 / user:10001" autocomplete="off" />
            <datalist id="memScopeOptions">${scopes.map(scope => `<option value="${esc(scope)}"></option>`).join("")}</datalist>
            <div class="hint">全局回忆对所有会话可见；群聊 / 用户作用域只注入对应会话。</div>
          </div>
          ${field("title", "标题", entry?.title || "", { wide: true, placeholder: "这件事的一句话标题", hint: "标题作为回忆索引，留空时用摘要代替。" })}
          ${area("content", "摘要", entry?.content || "", { wide: true, rows: 3, placeholder: "一句话概括；事实记忆必须简明明确", hint: "简短明确的摘要更适合注入提示词。" })}
          ${field("tags", "标签", (entry?.tags || []).join(", "), { placeholder: "偏好, 称呼, 项目", hint: "逗号分隔，最多 10 个。" })}
          ${field("occurredAt", "发生日期", occurredAt, { type: "date", hint: "回忆发生的日期，默认今天。" })}
          ${field("importance", "重要度", entry?.importance ?? 3, { type: "number", min: 1, max: 5, step: 1, hint: "1 - 5，越高越容易被优先注入。" })}
          <div class="field">
            <span>固定回忆</span>
            <label class="switch"><input type="checkbox" data-mem-form="pinned" ${pinned ? "checked" : ""} /><span class="track"></span><span data-switch-text>${pinned ? "开启" : "关闭"}</span></label>
            <div class="hint">固定回忆优先注入，且不会被容量淘汰。</div>
          </div>
        </div>
        <div class="mem-form-section" data-mem-episode style="display:none">
          <h4>经历细节</h4>
          <div class="ai-form-grid">
            ${area("event", "发生了什么", entry?.event || "", { wide: true, rows: 3, placeholder: "时间、地点、人物、经过…" })}
            ${field("feelings", "感受", (entry?.feelings || []).join(", "), { placeholder: "平静, 好奇, 有点担心", hint: "逗号分隔，当时真实的感受。" })}
            ${field("desire", "想不想做", entry?.desire || "", { placeholder: "想做 / 不想做，以及原因" })}
            ${field("intentions", "要做的事", (entry?.intentions || []).join(", "), { wide: true, placeholder: "接下来打算做的事，逗号分隔" })}
            ${area("reasoning", "思考与选择", entry?.reasoning || "", { wide: true, rows: 2, placeholder: "在几个选项之间怎么权衡、为什么这样选…" })}
            ${field("learning", "缺什么学什么", entry?.learning || "", { placeholder: "发现的不足与要补的知识" })}
            ${field("actions", "行动", (entry?.actions || []).join(", "), { wide: true, placeholder: "实际做了什么，逗号分隔" })}
            ${area("verification", "说前核对", entry?.verification || "", { wide: true, rows: 2, placeholder: "说过的话核对了哪些事实？有没有不确定或编造风险？" })}
            ${area("lessons", "经历沉淀", entry?.lessons || "", { wide: true, rows: 2, placeholder: "这段经历留下的经验…" })}
            ${area("corrections", "哪里错了，下次怎么做", entry?.corrections || "", { wide: true, rows: 2, placeholder: "错误、原因与下次的改法…" })}
            ${area("masterOpinion", "主人意见", entry?.masterOpinion || "", { wide: true, rows: 2, placeholder: "主人明确说过的话，不要替主人表态" })}
            ${area("delivery", "交付", entry?.delivery || "", { rows: 2, placeholder: "交付了什么结果" })}
            ${area("acceptance", "验收", entry?.acceptance || "", { rows: 2, placeholder: "对照原话逐条核实的结果" })}
            ${field("mood", "心情", entry?.mood || "", { placeholder: "平静 / 开心 / 烦…" })}
            ${field("energy", "精力", entry?.energy || "", { placeholder: "充足 / 一般 / 疲惫…" })}
            <div class="field">
              <span>情绪标签</span>
              <select data-mem-form="emotionPrimary">
                <option value="">不标注</option>
                ${MEMORY_EMOTIONS.map(([key, label]) => `<option value="${key}" ${entry?.emotion?.primary === key ? "selected" : ""}>${label}</option>`).join("")}
              </select>
              <div class="hint">用于按情绪检索；没有明确证据就留空。</div>
            </div>
            ${field("emotionSecondary", "次要情绪", (entry?.emotion?.secondary || []).join(", "), { placeholder: "surprise, fear", hint: "英文键，逗号分隔，最多两个。" })}
            ${field("emotionIntensity", "情绪强度", entry?.emotion?.intensity || "", { type: "number", min: 1, max: 3, step: 1, hint: "1 弱 / 2 一般 / 3 强。" })}
            ${field("trust", "信任（0-100）", relationship.trust ?? "", { type: "number", min: 0, max: 100, step: 1, hint: "这次经历后对这段关系的观察值。" })}
            ${field("affinity", "好感（0-100）", relationship.affinity ?? "", { type: "number", min: 0, max: 100, step: 1, hint: "好感度的观察值，会随时间累积。" })}
            ${area("relationshipNote", "关系备注", relationship.note || "", { wide: true, rows: 2, placeholder: "信任或好感变化的原因…" })}
            ${field("interests", "兴趣", (entry?.interests || []).join(", "), { placeholder: "关注的话题，逗号分隔" })}
            ${field("taste", "品味", (entry?.taste || []).join(", "), { placeholder: "喜欢什么，逗号分隔" })}
            ${area("opinions", "看法", (entry?.opinions || []).join("；"), { wide: true, rows: 2, placeholder: "形成的观点与判断…" })}
            ${field("people", "涉及的人", (entry?.people || []).join(", "), { placeholder: "人物名，逗号分隔", hint: "共同人物会形成隐式关联。" })}
            ${field("links", "关联回忆 ID", (entry?.links || []).join(", "), { wide: true, placeholder: "m_xxx, m_yyy", hint: "逗号分隔；关联的回忆会被一起想起并注入。" })}
          </div>
        </div>
        <div class="form-error" data-mem-error></div>
      </div>`,
      footer: `<button type="button" class="btn btn-outline" data-close>取消</button><button type="button" class="btn btn-primary" data-mem-save>${icon("save")}保存</button>`,
    });
    const errorBox = $("[data-mem-error]", modal.root);
    const save = $("[data-mem-save]", modal.root);
    const kindSelect = $('[data-mem-form="kind"]', modal.root);
    const episodeBox = $("[data-mem-episode]", modal.root);
    const syncKind = () => {
      episodeBox.style.display = kindSelect.value === "episode" ? "" : "none";
    };
    kindSelect.addEventListener("change", syncKind);
    syncKind();

    const readField = key => $(`[data-mem-form="${key}"]`, modal.root)?.value.trim() || "";
    const readList = key => readField(key).split(/[,，、;\n]/).map(item => item.trim()).filter(Boolean);
    const readNumber = key => {
      const raw = readField(key);
      if (!raw) return null;
      const number = Number(raw);
      return Number.isFinite(number) ? number : null;
    };
    save.addEventListener("click", async () => {
      const kindValue = readField("kind") === "episode" ? "episode" : "fact";
      const content = readField("content");
      const title = readField("title");
      const event = readField("event");
      const scope = readField("scope") || "global";
      if (!content && !title && !event) {
        errorBox.textContent = "请至少填写摘要、标题或发生了什么";
        errorBox.classList.add("show");
        return;
      }
      if (!/^(global|group:[\dA-Za-z_:\uF03A\uFF1A-]{3,80}|user:\d{3,20})$/.test(scope)) {
        errorBox.textContent = "作用域格式无效：可选 global / group:<群号> / user:<QQ号>";
        errorBox.classList.add("show");
        return;
      }
      const importance = readNumber("importance");
      if (importance !== null && (importance < 1 || importance > 5)) {
        errorBox.textContent = "重要度应在 1 - 5 之间";
        errorBox.classList.add("show");
        return;
      }
      const trust = readNumber("trust");
      const affinity = readNumber("affinity");
      if ((trust !== null && (trust < 0 || trust > 100)) || (affinity !== null && (affinity < 0 || affinity > 100))) {
        errorBox.textContent = "信任与好感应在 0 - 100 之间";
        errorBox.classList.add("show");
        return;
      }
      const body = {
        kind: kindValue,
        content: content || title || memoryClip(event, 120),
        title,
        scope,
        event,
        tags: readList("tags"),
        occurredAt: readField("occurredAt") || undefined,
        importance,
        pinned: $('[data-mem-form="pinned"]', modal.root).checked,
        feelings: readList("feelings"),
        desire: readField("desire"),
        intentions: readList("intentions"),
        reasoning: readField("reasoning"),
        learning: readField("learning"),
        actions: readList("actions"),
        verification: readField("verification"),
        lessons: readField("lessons"),
        corrections: readField("corrections"),
        masterOpinion: readField("masterOpinion"),
        delivery: readField("delivery"),
        acceptance: readField("acceptance"),
        mood: readField("mood"),
        energy: readField("energy"),
        emotion: {
          primary: readField("emotionPrimary"),
          secondary: readList("emotionSecondary"),
          intensity: readNumber("emotionIntensity"),
        },
        relationship: { trust, affinity, note: readField("relationshipNote") },
        interests: readList("interests"),
        taste: readList("taste"),
        opinions: readList("opinions"),
        people: readList("people"),
        links: readList("links"),
      };
      errorBox.classList.remove("show");
      setBusy(save, true);
      try {
        const result = entry
          ? await api(`/ai/memories/${encodeURIComponent(entry.id)}`, { method: "PATCH", body })
          : await api("/ai/memories", { method: "POST", body: { ...body, source: "webui" } });
        modal.close();
        toast(result.message || "回忆已保存");
        await loadMemories(true);
      } catch (error) {
        errorBox.textContent = error.message || String(error);
        errorBox.classList.add("show");
      } finally {
        setBusy(save, false);
      }
    });
  }

  async function toggleMemoryPin(entry) {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    try {
      const result = await api(`/ai/memories/${encodeURIComponent(entry.id)}/pin`, {
        method: "POST",
        body: { pinned: !entry.pinned },
      });
      toast(result.message || "已更新");
      await loadMemories();
    } catch (error) {
      handleError(error);
    }
  }

  async function restoreMemory(entry) {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    try {
      const result = await api(`/ai/memories/${encodeURIComponent(entry.id)}/restore`, { method: "POST" });
      toast(result.message || "已恢复");
      await loadMemories();
    } catch (error) {
      handleError(error);
    }
  }

  async function deleteMemory(entry) {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    const preview = entry.title || entry.content || entry.event || entry.id;
    const confirmed = await confirmDialog({
      title: "删除回忆",
      message: `确定删除这条回忆吗？\n\n${preview.slice(0, 120)}${preview.length > 120 ? "…" : ""}`,
      confirmText: "删除",
      danger: true,
    });
    if (!confirmed) return;
    try {
      const result = await api(`/ai/memories/${encodeURIComponent(entry.id)}`, { method: "DELETE" });
      toast(result.message || "回忆已删除");
      await loadMemories();
    } catch (error) {
      handleError(error);
    }
  }

  /** 整理记忆：先预览，确认后再合并 */
  async function compressMemories() {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info")
    let preview
    try {
      preview = await api("/ai/memories/compress", {
        method: "POST",
        body: { dryRun: true, maxBuckets: 20 },
      })
    } catch (error) {
      return handleError(error)
    }
    if (!preview.buckets) return toast(preview.message || "没有可整理的记忆", "info")
    const mergeable = (preview.results || []).filter(item => item.ok)
    if (!mergeable.length) {
      const reason = (preview.results || []).find(item => item.reason)?.reason
      return toast(reason || "这批记忆没有值得合并的", "info")
    }
    const total = mergeable.reduce((sum, item) => sum + item.before, 0)
    const after = mergeable.reduce((sum, item) => sum + item.after, 0)
    const confirmed = await confirmDialog({
      title: "整理记忆",
      message: `${mergeable.length} 组记忆会从 ${total} 条合并为 ${after} 条，原条目被替换且无法撤销。确定继续吗？`,
      confirmText: "开始整理",
    })
    if (!confirmed) return
    try {
      const result = await api("/ai/memories/compress", {
        method: "POST",
        body: { dryRun: false, maxBuckets: 20 },
      })
      toast(result.message || "整理完成", "success")
      await loadMemories(true)
    } catch (error) {
      handleError(error)
    }
  }

  async function clearMemories() {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    const confirmed = await confirmDialog({
      title: "清空回忆",
      message: "将删除全部回忆、经历与关系状态，且无法恢复。确定继续吗？",
      confirmText: "清空",
      danger: true,
    });
    if (!confirmed) return;
    try {
      const result = await api("/ai/memories/clear", { method: "POST" });
      toast(result.message || "回忆已清空");
      state.aiMemories.page = 1;
      await loadMemories(true);
    } catch (error) {
      handleError(error);
    }
  }

  async function exportMemories() {
    try {
      await downloadJson("/ai/memories/export", `ai_memories_${new Date().toISOString().slice(0, 10)}.json`);
    } catch (error) {
      handleError(error);
    }
  }

  /* ---------------- 调用记录（挂在数据记录页） ---------------- */

  async function loadRecords(force) {
    const bucket = state.aiRecords;
    const params = new URLSearchParams();
    params.set("page", String(bucket.page));
    params.set("pageSize", String(bucket.pageSize));
    if (bucket.type) params.set("type", bucket.type);
    if (bucket.days !== "") params.set("days", bucket.days);
    if (bucket.success) params.set("success", bucket.success);
    if (bucket.query) params.set("query", bucket.query);
    const data = await api(`/ai/records?${params.toString()}`);
    bucket.data = data;
    renderRecords(data);
    return data;
  }

  function renderRecords(data) {
    const bucket = state.aiRecords;
    const results = data.results || [];
    const search = $("#recSearch");
    if (document.activeElement !== search && search.value !== bucket.query) search.value = bucket.query;
    $("#recType").value = bucket.type;
    $("#recDays").value = bucket.days;
    $("#recStatus").value = bucket.success;
    $("#recCount").textContent = `${fmtNum(data.total)} 条记录${bucket.query ? ` · 搜索「${bucket.query}」` : ""}`;
    $("#recRows").innerHTML = results.length
      ? results
          .map(record => {
            const isTool = record.type === "tool";
            const who = record.groupId ? `群 ${record.groupId}` : record.userId ? `用户 ${record.userId}` : record.conversationId || "—";
            const subject = isTool ? record.toolName : record.model;
            const sub = isTool ? record.plugin : record.channelName || record.channelId;
            const tokens = isTool ? "—" : fmtToken(record.totalTokens || 0);
            const latency = isTool ? record.durationMs : record.latencyMs;
            const summary = isTool ? record.result || record.error : record.content || record.error;
            return `<tr>
              <td><span title="${esc(fmtDateTime(record.ts))}">${esc(fmtClock(record.ts))}</span></td>
              <td>${isTool ? pill("工具", "pill-green") : pill("对话", "pill-blue")}</td>
              <td><div class="cell-main"><strong>${esc(who)}</strong><small>${esc(record.conversationId || record.botId || "")}</small></div></td>
              <td><div class="cell-main"><strong class="mono">${esc(subject || "—")}</strong><small>${esc(sub || "")}</small></div></td>
              <td class="cell-num">${tokens}</td>
              <td class="cell-num">${latency ? `${fmtNum(latency)} ms` : "—"}</td>
              <td>${record.success === false ? pill("失败", "pill-red") : pill("成功", "pill-green")}</td>
              <td><div class="cell-desc" title="${esc(summary || record.error || "")}">${esc(summary || record.error || "—")}</div></td>
            </tr>`;
          })
          .join("")
      : tableEmpty(8, "没有匹配的记录");
    renderListPager("#recPager", data, "条记录");
  }

  async function exportRecords() {
    const bucket = state.aiRecords;
    const params = new URLSearchParams();
    if (bucket.type) params.set("type", bucket.type);
    params.set("days", bucket.days === "" ? "0" : bucket.days);
    if (bucket.query) params.set("query", bucket.query);
    if (bucket.success) params.set("success", bucket.success);
    try {
      await downloadJson(`/ai/records/export?${params.toString()}`, `ai_records_${new Date().toISOString().slice(0, 10)}.json`);
    } catch (error) {
      handleError(error);
    }
  }

  async function clearRecords() {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    const confirmed = await confirmDialog({
      title: "清空调用记录",
      message: "将删除全部对话与工具调用记录（仅统计数据，不影响会话与记忆）。确定继续吗？",
      confirmText: "清空",
      danger: true,
    });
    if (!confirmed) return;
    try {
      const result = await api("/ai/records/clear", { method: "POST" });
      toast(result.message || "调用记录已清空");
      state.aiRecords.page = 1;
      await loadRecords(true);
      state.aiStats.data = null;
    } catch (error) {
      handleError(error);
    }
  }

  /* ---------------- 调用统计 ---------------- */

  function aiStatCard(label, value, foot, iconName, tile, small) {
    return `<article class="stat-card">
      <span class="stat-label">${esc(label)}</span>
      <div class="stat-value${small ? " small" : ""}">${esc(value)}</div>
      <div class="stat-foot">${esc(foot)}</div>
      <span class="stat-icon tile-${tile}">${icon(iconName)}</span>
    </article>`;
  }

  async function loadStats(force) {
    const days = state.aiStats.days;
    const data = await api(`/ai/stats?days=${encodeURIComponent(days)}`);
    state.aiStats.data = data;
    $("#statsDays").value = String(days);
    renderStats(data);
    return data;
  }

  function renderStats(data) {
    const totals = data.totals || {};
    const byDay = data.byDay || [];
    const allCalls = (totals.requests || 0) + (totals.toolCalls || 0);
    const successRate = allCalls ? ((allCalls - (totals.errors || 0)) / allCalls) * 100 : 100;
    const today = byDay[byDay.length - 1] || {};
    const todayTotal = Number(today.tokens) || 0;
    const avgDaily = byDay.length ? Math.round(byDay.reduce((sum, day) => sum + (Number(day.tokens) || 0), 0) / byDay.length) : 0;
    const cacheRate = totals.promptTokens ? (totals.cachedTokens / totals.promptTokens) * 100 : 0;
    $("#statsCards").innerHTML = [
      aiStatCard("对话请求", fmtNum(totals.requests), `工具调用 ${fmtNum(totals.toolCalls)} 次`, "message", 1),
      aiStatCard("Token 消耗", fmtToken(totals.totalTokens), `输入 ${fmtToken(totals.promptTokens)} · 输出 ${fmtToken(totals.completionTokens)}`, "database", 2, true),
      aiStatCard("今日 Token", fmtToken(todayTotal), `日均 ${fmtToken(avgDaily)} · 输入 ${fmtToken(today.promptTokens || 0)} · 输出 ${fmtToken(today.completionTokens || 0)}`, "spark", 3, true),
      aiStatCard(
        "缓存命中",
        fmtToken(totals.cachedTokens || 0),
        totals.cachedTokens ? `占输入 ${cacheRate.toFixed(1)}%` : "服务商未上报缓存用量",
        "check",
        4,
        true,
      ),
      aiStatCard("错误 / 成功率", `${fmtNum(totals.errors)} · ${successRate.toFixed(1)}%`, `平均延迟 ${fmtNum(totals.avgLatency)} ms`, "alert", 5),
    ].join("");

    const since = toDate(data.range?.since);
    $("#statsRange").textContent = data.range
      ? `近 ${fmtNum(data.range.days)} 天${since ? ` · 自 ${since.getMonth() + 1}-${pad(since.getDate())}` : ""}`
      : "—";

    renderStatsChart(byDay);

    $("#statsModels").innerHTML = (data.byModel || []).length
      ? data.byModel
          .map(item => `<tr><td><span class="mono">${esc(item.model)}</span></td><td class="cell-num">${fmtNum(item.chats)}</td><td class="cell-num" title="${fmtNum(item.tokens)}">${fmtToken(item.tokens)}</td><td class="cell-num" title="${fmtNum(item.cachedTokens || 0)}">${item.cachedTokens ? fmtToken(item.cachedTokens) : "—"}</td><td class="cell-num">${fmtNum(item.errors)}</td></tr>`)
          .join("")
      : tableEmpty(5, "暂无对话数据");

    $("#statsChannels").innerHTML = (data.byChannel || []).length
      ? data.byChannel
          .map(item => `<tr><td>${esc(item.channel)}</td><td class="cell-num">${fmtNum(item.chats)}</td><td class="cell-num" title="${fmtNum(item.tokens)}">${fmtToken(item.tokens)}</td><td class="cell-num" title="${fmtNum(item.cachedTokens || 0)}">${item.cachedTokens ? fmtToken(item.cachedTokens) : "—"}</td><td class="cell-num">${fmtNum(item.errors)}</td></tr>`)
          .join("")
      : tableEmpty(5, "暂无渠道数据");

    $("#statsTools").innerHTML = (data.byTool || []).length
      ? data.byTool
          .map(item => `<tr><td><span class="mono">${esc(item.tool)}</span></td><td class="cell-num">${fmtNum(item.calls)}</td><td class="cell-num">${fmtNum(item.success)}</td><td class="cell-num">${fmtNum(item.avgDuration)} ms</td></tr>`)
          .join("")
      : tableEmpty(4, "暂无工具调用");

    const errors = data.recentErrors || [];
    $("#statsErrors").innerHTML = errors.length
      ? errors
          .map(error => `<div class="ai-error-item">
              <div class="ai-error-head"><span>${esc(fmtClock(error.ts))}</span>${pill(error.type === "tool" ? "工具" : "对话", error.type === "tool" ? "pill-green" : "pill-blue")}<span class="mono">${esc(error.toolName || error.model || "—")}</span></div>
              <p>${esc(error.error || error.content || "未知错误")}</p>
            </div>`)
          .join("")
      : emptyState("没有错误记录", "当前统计范围内所有请求均成功。", "check", true);
  }

  function renderStatsChart(byDay) {
    const chart = $("#statsChart");
    hideStatsDayDetail();
    if (!byDay.length) {
      chart.innerHTML = `<div class="ai-chart-empty">暂无趋势数据</div>`;
      return;
    }
    const max = Math.max(1, ...byDay.map(day => Math.max(day.chats || 0, day.toolCalls || 0, day.errors || 0)));
    const step = Math.max(1, Math.ceil(byDay.length / 12));
    const height = value => (value > 0 ? Math.max(3, Math.round((value / max) * 100)) : 0);
    chart.innerHTML = byDay
      .map((day, index) => {
        const label = day.date ? day.date.slice(5) : "";
        const showLabel = index % step === 0 || index === byDay.length - 1;
        return `<div class="ai-chart-col" data-chart-date="${esc(day.date || "")}" title="${esc(day.date)} · 对话 ${fmtNum(day.chats)} · 工具 ${fmtNum(day.toolCalls)} · 错误 ${fmtNum(day.errors)} · Token ${fmtToken(day.tokens)}">
          <div class="ai-chart-bars">
            <span class="ai-chart-bar c1" style="height:${height(day.chats)}%"></span>
            <span class="ai-chart-bar c2" style="height:${height(day.toolCalls)}%"></span>
            <span class="ai-chart-bar c3" style="height:${height(day.errors)}%"></span>
          </div>
          <span class="ai-chart-label">${showLabel ? esc(label) : ""}</span>
        </div>`;
      })
      .join("");
    chart.querySelectorAll("[data-chart-date]").forEach(node => {
      node.addEventListener("click", () => {
        // 再点同一根柱子收起，移动端也能取消
        if (node.classList.contains("active")) {
          hideStatsDayDetail();
          return;
        }
        showStatsDayDetail(byDay.find(day => day.date === node.dataset.chartDate), node);
      });
    });
  }

  function hideStatsDayDetail() {
    const detail = $("#statsChartDetail");
    if (detail) {
      detail.hidden = true;
      detail.innerHTML = "";
    }
    $$("#statsChart .ai-chart-col").forEach(col => col.classList.remove("active"));
  }

  function showStatsDayDetail(day, node) {
    const detail = $("#statsChartDetail");
    if (!detail || !day) return;
    $$("#statsChart .ai-chart-col").forEach(col => col.classList.toggle("active", col === node));
    const dayCached = Number(day.cachedTokens) || 0;
    const dayPrompt = Number(day.promptTokens) || 0;
    const rows = [
      ["对话请求", fmtNum(day.chats)],
      ["工具调用", fmtNum(day.toolCalls)],
      ["Token 合计", `${fmtToken(day.tokens)}（${fmtNum(day.tokens)}）`],
      ["输入 / 输出", `${fmtToken(dayPrompt)} / ${fmtToken(day.completionTokens || 0)}`],
      ["缓存命中", dayCached ? `${fmtToken(dayCached)}（占输入 ${((dayCached / dayPrompt) * 100).toFixed(1)}%）` : "—"],
      ["错误", fmtNum(day.errors)],
    ];
    detail.innerHTML = `<div class="ai-chart-detail-head"><strong>${esc(day.date)}</strong><span>再点同一柱子收起</span></div>
      <div class="ai-chart-detail-grid">${rows
        .map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`)
        .join("")}</div>`;
    detail.hidden = false;
  }

  /* ---------------- 对话历史 ---------------- */

  function sessionSource(record) {
    const meta = record.meta || {};
    if (meta.groupName) return `群 ${meta.groupName}`;
    if (meta.groupId) return `群 ${meta.groupId}`;
    if (meta.userId) return `用户 ${meta.userId}`;
    return meta.type === "group" ? "群聊" : meta.type === "private" ? "私聊" : "接口";
  }

  async function loadSessions(force) {
    const bucket = state.aiSessions;
    const params = new URLSearchParams();
    params.set("page", String(bucket.page));
    params.set("pageSize", String(bucket.pageSize));
    if (bucket.query) params.set("query", bucket.query);
    const data = await api(`/ai/sessions?${params.toString()}`);
    bucket.data = data;
    renderSessions(data);
    return data;
  }

  function renderSessions(data) {
    const bucket = state.aiSessions;
    const results = data.results || [];
    const search = $("#sessSearch");
    if (document.activeElement !== search && search.value !== bucket.query) search.value = bucket.query;
    $("#sessCount").textContent = `${fmtNum(data.total)} 个会话 · 内存活跃 ${fmtNum(data.active || 0)} 个 · 磁盘 ${fmtNum(data.disk || 0)} 个`;
    const canWrite = state.allowWrite;
    $("#sessRows").innerHTML = results.length
      ? results
          .map(record => {
            const actions = [
              `<button type="button" class="btn btn-ghost btn-sm" data-session-action="view" data-session-id="${esc(record.id)}">查看</button>`,
              `<button type="button" class="btn btn-ghost btn-sm" data-session-action="export" data-session-id="${esc(record.id)}">导出</button>`,
              canWrite ? `<button type="button" class="btn btn-ghost btn-sm" data-session-action="compress" data-session-id="${esc(record.id)}">压缩</button>` : "",
              canWrite ? `<button type="button" class="btn btn-ghost btn-sm" data-session-action="delete" data-session-id="${esc(record.id)}">删除</button>` : "",
            ]
              .filter(Boolean)
              .join("");
            return `<tr>
              <td><div class="cell-main"><strong>${esc(record.title || "未命名会话")}</strong><small>${esc(record.id)}</small></div></td>
              <td>${esc(sessionSource(record))}</td>
              <td class="cell-num">${fmtNum(record.messageCount)}</td>
              <td class="cell-num">${fmtNum(record.turnCount)}</td>
              <td>${record.compressed ? pill("已压缩", "pill-blue") : pill("原始", "")}</td>
              <td>${esc(fmtRelative(record.lastActivity || record.updatedAt))}</td>
              <td class="cell-actions">${actions}</td>
            </tr>`;
          })
          .join("")
      : tableEmpty(7, bucket.query ? "没有匹配的会话" : "还没有持久化会话");
    renderListPager("#sessPager", data, "个会话");
  }

  function sessionMessageHtml(message) {
    const role = String(message.role || "assistant");
    const label = { system: "系统", user: "用户", assistant: "AI", tool: "工具" }[role] || role;
    const variant = role === "user" ? "pill-blue" : role === "assistant" ? "pill-green" : role === "tool" ? "pill-amber" : "";
    return `<div class="ai-msg ${esc(role)}">
      <div class="ai-msg-head"><span class="pill ${variant}">${esc(label)}</span><span>${esc(message.time ? fmtDateTime(message.time) : "")}</span></div>
      <pre class="ai-msg-text">${esc(message.content || "")}</pre>
    </div>`;
  }

  async function openSessionDetail(id) {
    let data;
    try {
      data = await api(`/ai/sessions/${encodeURIComponent(id)}`);
    } catch (error) {
      handleError(error);
      return;
    }
    const record = data.record || {};
    const messages = record.messages || [];
    const modal = openModal({
      title: record.title || "会话详情",
      subtitle: `${record.id} · ${sessionSource(record)} · ${messages.length} 条消息`,
      width: "wide",
      body: `<div class="modal-body">
        <div class="ai-session-meta">
          <span>创建 ${esc(fmtDateTime(record.createdAt))}</span>
          <span>更新 ${esc(fmtDateTime(record.lastActivity || record.updatedAt))}</span>
          <span>${data.inMemory ? "内存中活跃" : "仅磁盘"}</span>
          ${Number(record.tokenSpent) > 0 ? `<span title="${fmtNum(record.tokenSpent)} tokens">Token 已用 ${fmtToken(record.tokenSpent)}</span>` : ""}
          ${Number(record.turnLimit) > 0 ? `<span>${fmtNum(record.turnUsed || 0)} / ${fmtNum(record.turnLimit)} 轮（${fmtNum(record.turnWindowMinutes || 180)} 分钟窗口）</span>` : ""}
          ${record.compressed ? `<span>${pill("上下文已压缩", "pill-blue")}</span>` : ""}
        </div>
        ${record.systemPrompt ? `<details class="ai-system-prompt"><summary>系统提示词（${fmtNum(record.systemPrompt.length)} 字符）</summary><pre class="ai-msg-text">${esc(record.systemPrompt)}</pre></details>` : ""}
        ${record.compressedSummary ? `<details class="ai-system-prompt"><summary>压缩摘要</summary><pre class="ai-msg-text">${esc(record.compressedSummary)}</pre></details>` : ""}
        <div class="ai-msg-list">${messages.length ? messages.map(sessionMessageHtml).join("") : emptyState("会话没有消息", "可能已被清空上下文。", "message", true)}</div>
      </div>`,
      footer: `<button type="button" class="btn btn-outline" data-close>关闭</button>${state.allowWrite ? `<button type="button" class="btn btn-outline" data-session-detail="clear">清空上下文</button><button type="button" class="btn btn-outline" data-session-detail="compress">压缩</button><button type="button" class="btn btn-danger" data-session-detail="delete">删除会话</button>` : ""}`,
    });
    const action = async type => {
      if (type === "compress") {
        const button = $(`[data-session-detail="compress"]`, modal.root);
        setBusy(button, true);
        try {
          const result = await api(`/ai/sessions/${encodeURIComponent(id)}/compress`, { method: "POST" });
          toast(result.message || (result.ok ? "压缩完成" : "无需压缩"));
          modal.close();
          await loadSessions();
        } catch (error) {
          handleError(error);
        } finally {
          setBusy(button, false);
        }
        return;
      }
      modal.close();
      if (type === "clear") {
        const confirmed = await confirmDialog({ title: "清空会话上下文", message: "将清空该会话的消息与压缩摘要，是否继续？", confirmText: "清空", danger: true });
        if (!confirmed) return;
        try {
          const result = await api(`/ai/sessions/${encodeURIComponent(id)}/clear`, { method: "POST" });
          toast(result.message || "上下文已清空");
          await loadSessions();
        } catch (error) {
          handleError(error);
        }
        return;
      }
      if (type === "delete") {
        const confirmed = await confirmDialog({ title: "删除会话", message: "将同时删除内存与磁盘中的会话记录，是否继续？", confirmText: "删除", danger: true });
        if (!confirmed) return;
        try {
          const result = await api(`/ai/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
          toast(result.message || "会话已删除");
          await loadSessions();
        } catch (error) {
          handleError(error);
        }
      }
    };
    modal.root.addEventListener("click", event => {
      const button = event.target.closest("[data-session-detail]");
      if (button) action(button.dataset.sessionDetail);
    });
  }

  async function exportSessions(id) {
    const suffix = id ? `_${String(id).replace(/[^\w.-]+/g, "_")}` : "";
    try {
      await downloadJson(`/ai/sessions/export${id ? `?id=${encodeURIComponent(id)}` : ""}`, `ai_sessions${suffix}_${new Date().toISOString().slice(0, 10)}.json`);
    } catch (error) {
      handleError(error);
    }
  }

  async function compressSession(id) {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    try {
      const result = await api(`/ai/sessions/${encodeURIComponent(id)}/compress`, { method: "POST" });
      toast(result.message || (result.ok ? "压缩完成" : "无需压缩"));
      await loadSessions();
    } catch (error) {
      handleError(error);
    }
  }

  async function deleteSession(id) {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    const confirmed = await confirmDialog({ title: "删除会话", message: "将同时删除内存与磁盘中的会话记录，是否继续？", confirmText: "删除", danger: true });
    if (!confirmed) return;
    try {
      const result = await api(`/ai/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      toast(result.message || "会话已删除");
      await loadSessions();
    } catch (error) {
      handleError(error);
    }
  }

  async function clearSessions() {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    const confirmed = await confirmDialog({
      title: "清空对话历史",
      message: "将清空全部内存会话与磁盘会话记录，且无法恢复。确定继续吗？",
      confirmText: "清空",
      danger: true,
    });
    if (!confirmed) return;
    try {
      const result = await api("/ai/sessions/clear", { method: "POST" });
      toast(result.message || "对话历史已清空");
      state.aiSessions.page = 1;
      await loadSessions();
    } catch (error) {
      handleError(error);
    }
  }

  /* ---------------- 工具调用 ---------------- */

  async function loadToolCalls(force) {
    const bucket = state.aiToolCalls;
    const params = new URLSearchParams();
    params.set("page", String(bucket.page));
    params.set("pageSize", String(bucket.pageSize));
    params.set("days", bucket.days === "" ? "0" : bucket.days);
    if (bucket.success) params.set("success", bucket.success);
    if (bucket.query) params.set("query", bucket.query);
    const data = await api(`/ai/tool-calls?${params.toString()}`);
    bucket.data = data;
    renderToolCalls(data);
    return data;
  }

  function renderToolCalls(data) {
    const bucket = state.aiToolCalls;
    const results = data.results || [];
    const byTool = data.byTool || [];
    const totals = data.totals || {};
    const calls = byTool.reduce((sum, item) => sum + (item.calls || 0), 0);
    const duration = byTool.reduce((sum, item) => sum + (item.avgDuration || 0) * (item.calls || 0), 0);
    const avgDuration = calls ? Math.round(duration / calls) : 0;
    const success = byTool.reduce((sum, item) => sum + (item.success || 0), 0);
    const rate = calls ? (success / calls) * 100 : 100;
    $("#tcStats").innerHTML = [
      miniStat("调用次数", fmtNum(totals.toolCalls ?? calls), "tool", 1),
      miniStat("错误次数", fmtNum(totals.errors || 0), "alert", 2),
      miniStat("成功率", `${rate.toFixed(1)}%`, "check", 3),
      miniStat("平均耗时", `${fmtNum(avgDuration)} ms`, "clock", 4),
    ].join("");
    const search = $("#tcSearch");
    if (document.activeElement !== search && search.value !== bucket.query) search.value = bucket.query;
    $("#tcDays").value = bucket.days;
    $("#tcStatus").value = bucket.success;
    $("#tcCount").textContent = `${fmtNum(data.total)} 条工具调用${bucket.query ? ` · 搜索「${bucket.query}」` : ""}`;
    $("#tcRows").innerHTML = results.length
      ? results
          .map(record => `<tr>
            <td><span title="${esc(fmtDateTime(record.ts))}">${esc(fmtClock(record.ts))}</span></td>
            <td><span class="mono">${esc(record.toolName || "—")}</span></td>
            <td>${esc(record.plugin || "—")}</td>
            <td class="cell-num">${record.durationMs ? `${fmtNum(record.durationMs)} ms` : "—"}</td>
            <td>${record.success === false ? pill("失败", "pill-red") : pill("成功", "pill-green")}</td>
            <td><div class="cell-desc mono" title="${esc(record.args || "")}">${esc(record.args || "—")}</div></td>
            <td><div class="cell-desc" title="${esc(record.error || record.result || "")}">${esc(record.error || record.result || "—")}</div></td>
          </tr>`)
          .join("")
      : tableEmpty(7, "没有匹配的工具调用");
    $("#tcByTool").innerHTML = byTool.length
      ? byTool
          .map(item => `<tr><td><span class="mono">${esc(item.tool)}</span></td><td class="cell-num">${fmtNum(item.calls)}</td><td class="cell-num">${fmtNum(item.success)}</td><td class="cell-num">${fmtNum(item.errors)}</td><td class="cell-num">${fmtNum(item.avgDuration)} ms</td></tr>`)
          .join("")
      : tableEmpty(5, "暂无工具调用");
    renderListPager("#tcPager", data, "条调用");
  }

  async function exportToolCalls() {
    const bucket = state.aiToolCalls;
    const params = new URLSearchParams();
    params.set("type", "tool");
    params.set("days", bucket.days === "" ? "0" : bucket.days);
    if (bucket.query) params.set("query", bucket.query);
    if (bucket.success) params.set("success", bucket.success);
    try {
      await downloadJson(`/ai/records/export?${params.toString()}`, `ai_tool_calls_${new Date().toISOString().slice(0, 10)}.json`);
    } catch (error) {
      handleError(error);
    }
  }

  /* ---------------- 群设置 ---------------- */

  async function loadAiGroups(force) {
    const data = await api("/ai/groups");
    state.aiGroups.data = data;
    renderAiGroups(data);
    return data;
  }

  function renderAiGroups(data) {
    const groups = data.groups || [];
    const overrides = groups.filter(group => group.ai);
    const enabled = overrides.filter(group => group.ai.enabled === true).length;
    const disabled = overrides.filter(group => group.ai.enabled === false).length;
    $("#aiGroupStats").innerHTML = [
      miniStat("群聊总数", fmtNum(groups.length), "users", 1),
      miniStat("覆盖配置", fmtNum(overrides.length), "sliders", 2),
      miniStat("强制开启", fmtNum(enabled), "check", 3),
      miniStat("强制关闭", fmtNum(disabled), "lock", 4),
    ].join("");
    const query = state.aiGroups.query.trim().toLowerCase();
    const list = groups.filter(group => !query || `${group.name || ""} ${group.group_id}`.toLowerCase().includes(query));
    $("#aiGroupCount").textContent = `共 ${fmtNum(groups.length)} 个群聊 · ${fmtNum(overrides.length)} 个自定义配置${query ? ` · 匹配 ${fmtNum(list.length)} 个` : ""}`;
    const presetMap = new Map((data.presets || []).map(item => [item.id, item.name]));
    const canWrite = state.allowWrite;
    $("#aiGroupRows").innerHTML = list.length
      ? list
          .map(group => {
            const ai = group.ai;
            const statePill = ai && ai.enabled === true
              ? pill("强制开启", "pill-green")
              : ai && ai.enabled === false
                ? pill("强制关闭", "pill-red")
                : pill("跟随全局", "pill-outline");
            const trigger = triggerLightsHtml(ai, data.defaultTriggerSwitches);
            const preset = ai?.presetId ? presetMap.get(ai.presetId) || `未知预设 ${ai.presetId}` : "跟随全局";
            const limits = [];
            if ((ai?.disabledTools || []).length) limits.push(`禁用工具 ${fmtNum(ai.disabledTools.length)}`);
            if ((ai?.disabledToolPlugins || []).length) limits.push(`禁用插件 ${fmtNum(ai.disabledToolPlugins.length)}`);
            if (ai?.memoryEnabled === false) limits.push("关闭记忆");
            if (ai?.proactiveChat === false) limits.push("关闭主动聊天");
            if (ai?.allowAdminPersona) limits.push("群管可切人格");
            if (ai?.prompt) limits.push("自定义提示词");
            return `<tr data-group-id="${esc(group.group_id)}">
              <td><div class="cell-main"><strong>${esc(group.name || "未命名群聊")}</strong><small>${esc(group.group_id)}</small></div></td>
              <td class="cell-num">${group.memberCount ? `${fmtNum(group.memberCount)}${group.maxMemberCount ? ` / ${fmtNum(group.maxMemberCount)}` : ""}` : "—"}</td>
              <td>${statePill}</td>
              <td>${trigger}</td>
              <td>${esc(preset)}</td>
              <td><div class="cell-desc" title="${esc(limits.join(" · "))}">${esc(limits.join(" · ") || "—")}</div></td>
              <td class="cell-actions">
                <button type="button" class="btn btn-ghost btn-sm" data-group-config="${esc(group.group_id)}">配置</button>
                ${canWrite && ai ? `<button type="button" class="btn btn-ghost btn-sm" data-group-reset="${esc(group.group_id)}">恢复默认</button>` : ""}
              </td>
            </tr>`;
          })
          .join("")
      : tableEmpty(7, query ? "没有匹配的群聊" : "机器人尚未同步到群聊");
  }

  async function openAiGroupModal(group) {
    const data = state.aiGroups.data;
    if (!data) return;
    // 多账号人格需要当前账号列表；每次打开都刷新，避免账号增减后判断过期
    try {
      state.accounts = await api("/accounts")
    } catch {}
    const ai = group.ai || {};
    const defaults = {
      enabled: ai.enabled === true ? "true" : ai.enabled === false ? "false" : "",
      presetId: ai.presetId || "",
      allowAdminPersona: ai.allowAdminPersona === true,
      memoryEnabled: ai.memoryEnabled === true ? "true" : ai.memoryEnabled === false ? "false" : "",
      proactiveChat: ai.proactiveChat === true ? "true" : ai.proactiveChat === false ? "false" : "",
    };
    // 触发开关：群未设置时显示全局默认，设置过就按群自己的值
    const globalTrigger = data.defaultTriggerSwitches || {};
    const hasOwnTrigger =
      ai.triggerAt !== undefined ||
      ai.triggerPrefix !== undefined ||
      ai.triggerKeyword !== undefined ||
      ai.triggerFree !== undefined;
    const switchState = key => {
      if (ai[key] !== undefined && ai[key] !== null) return ai[key] === true;
      if (hasOwnTrigger) return false;
      return globalTrigger[key === "triggerAt" ? "at" : key === "triggerPrefix" ? "prefix" : key === "triggerKeyword" ? "keyword" : "free"] === true;
    };
    const triggerSwitch = (field, label, hint) => {
      const on = switchState(field);
      return `<div class="field"><span>${label}</span>
        <label class="switch"><input type="checkbox" data-group-field="${field}" ${on ? "checked" : ""} /><span class="track"></span><span data-switch-text>${on ? "开启" : "关闭"}</span></label>
        ${hint ? `<div class="hint">${hint}</div>` : ""}
      </div>`;
    };
    const keywordsValue = (hasOwnTrigger ? ai.keywords || [] : globalTrigger.keywords || []).join(", ");
    const selectOf = (field, options, value) => `<select data-group-field="${field}">${options
      .map(([optionValue, label]) => `<option value="${esc(optionValue)}" ${optionValue === value ? "selected" : ""}>${esc(label)}</option>`)
      .join("")}</select>`;
    // 按账号指定人格：行可自由增删；账号从已登录列表选，未登录的号选「手动输入」再填
    const MANUAL_BOT = "__manual__"
    const botPresetOptions = [["", "跟随对话预设"], ...(data.presets || []).map(item => [item.id, item.name])]
    // 只排除 stdin 这种本地调试适配器，其它协议端（含非数字 self_id）都算账号
    const knownBots = () => {
      const list = []
      for (const bot of state.accounts?.bots || state.overview?.bots || []) {
        const id = String(bot.self_id || bot.uin || bot.id || "")
        if (!id || id === "stdin") continue
        const protocol = String(bot.loginProtocol || bot.adapterName || "").toLowerCase()
        if (protocol.includes("标准输入") || protocol.includes("stdin")) continue
        list.push({ id, name: bot.nickname || bot.name || id })
      }
      return list
    }
    // 未登录第二个 QQ 账号时整块隐藏，单号用上面的对话预设就够了；
    // 但已经配过按账号人格时仍显示，否则配置会在看不见的地方覆盖群预设
    const multiAccount = knownBots().length > 1
    const hasOwnBotConfig =
      Object.keys(ai.botPresets || {}).length > 0 || Object.keys(ai.botKeywords || {}).length > 0
    const showBotPreset = multiAccount || hasOwnBotConfig
    const botPresetRowHtml = (botId, presetId, keywords) => {
      const known = knownBots()
      const knownIds = new Set(known.map(bot => bot.id))
      const manual = !!botId && !knownIds.has(botId)
      const selected = manual ? MANUAL_BOT : botId || ""
      const options = [
        ["", "选择账号"],
        ...known.map(bot => [bot.id, `${bot.name} · ${bot.id}`]),
        [MANUAL_BOT, "手动输入 QQ 号…"],
      ]
      return `<div class="bot-preset-row" data-bot-preset-row>
        <div class="bot-preset-bot${manual ? "" : " is-picked"}">
          <select data-bot-preset-id>${options
            .map(([value, text]) => `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(text)}</option>`)
            .join("")}</select>
          <input type="text" data-bot-preset-manual value="${esc(manual ? botId : "")}" placeholder="QQ 号" inputmode="numeric" autocomplete="off"${manual ? "" : " hidden"} />
        </div>
        <select data-bot-preset-value>${botPresetOptions
          .map(([value, text]) => `<option value="${esc(value)}" ${value === (presetId || "") ? "selected" : ""}>${esc(text)}</option>`)
          .join("")}</select>
        <input type="text" data-bot-preset-keywords value="${esc(keywords || "")}" placeholder="本账号触发词" autocomplete="off" />
        <button type="button" class="btn btn-ghost btn-sm" data-bot-preset-remove aria-label="删除这一行">
          <svg class="icon"><use href="#i-trash"></use></svg>
        </button>
      </div>`
    }
    const botPresetField = () => {
      const current = ai.botPresets || {}
      const keywordsMap = ai.botKeywords || {}
      const rows = Object.entries(current).map(([botId, presetId]) =>
        botPresetRowHtml(botId, presetId, keywordsMap[botId] || ""),
      )
      return `<div data-bot-preset-list>${rows.join("")}</div>
        <button type="button" class="btn btn-outline btn-sm bot-preset-add" data-bot-preset-add>
          <svg class="icon"><use href="#i-plus"></use></svg>添加账号
        </button>`
    }
    const tools = data.tools || [];
    const plugins = data.plugins || [];
    const disabledTools = new Set(ai.disabledTools || []);
    const disabledPlugins = new Set(ai.disabledToolPlugins || []);
    const toolPicker = `<div class="group-picker" data-picker="tools">
      <div class="group-picker-head">
        <input type="search" data-picker-search="tools" placeholder="搜索工具名或来源插件" autocomplete="off" />
        <span class="muted" data-picker-count="tools"></span>
      </div>
      <div class="group-picker-list" data-picker-list="tools">
        ${tools
          .map(
            tool => `<label class="group-picker-item" data-picker-key="${esc(`${tool.name} ${tool.plugin}`.toLowerCase())}">
              <input type="checkbox" data-group-tool value="${esc(tool.name)}" ${disabledTools.has(tool.name) ? "checked" : ""} />
              <span class="group-picker-name">${esc(tool.name)}</span>
              <span class="group-picker-meta">${esc(tool.plugin || "")}${tool.danger && tool.danger !== "low" ? ` · ${esc(tool.danger)}` : ""}</span>
            </label>`,
          )
          .join("") || '<span class="muted">暂无工具</span>'}
      </div>
    </div>`;
    const pluginPicker = `<div class="group-picker" data-picker="plugins">
      <div class="group-picker-head">
        <input type="search" data-picker-search="plugins" placeholder="搜索插件名" autocomplete="off" />
        <span class="muted" data-picker-count="plugins"></span>
      </div>
      <div class="group-picker-list" data-picker-list="plugins">
        ${plugins
          .map(
            name => `<label class="group-picker-item" data-picker-key="${esc(name.toLowerCase())}">
              <input type="checkbox" data-group-plugin value="${esc(name)}" ${disabledPlugins.has(name) ? "checked" : ""} />
              <span class="group-picker-name">${esc(name)}</span>
            </label>`,
          )
          .join("") || '<span class="muted">暂无插件</span>'}
      </div>
    </div>`;
    const modal = openModal({
      title: `群设置 · ${group.name || group.group_id}`,
      subtitle: `群号 ${group.group_id} · 未设置的项目跟随全局`,
      width: "wide",
      body: `<div class="modal-body"><div class="ai-form-grid">
        <div class="field"><span>AI 开关</span>${selectOf("enabled", [["", "跟随全局"], ["true", "强制开启"], ["false", "强制关闭"]], defaults.enabled)}</div>
        <div class="field"><span>对话预设</span>${selectOf("presetId", [["", "跟随全局"], ...(data.presets || []).map(item => [item.id, item.name])], defaults.presetId)}</div>
        <div class="field wide"><span>触发关键词</span>
          <input type="text" data-group-field="keywords" value="${esc(keywordsValue)}" placeholder="逗号分隔，如：小助手, 机器人" autocomplete="off" />
          <div class="hint">填写即自动开启，清空后可关闭；触发词会剥离。${
            showBotPreset ? "所有账号通用，单账号的词在下面按账号填。" : ""
          }</div>
        </div>
        <div class="field wide"${showBotPreset ? "" : " hidden"}><span>按账号指定人格</span>
          <div data-bot-preset-field>${botPresetField()}</div>
          <div class="hint">配了人格的账号优先于上面的对话预设，对话预设只给没配的账号用。不需要按账号区分时删掉即可。</div>
        </div>
        <div class="field"><span>人格切换权限</span><label class="switch"><input type="checkbox" data-group-field="allowAdminPersona" ${defaults.allowAdminPersona ? "checked" : ""} /><span class="track"></span><span data-switch-text>${defaults.allowAdminPersona ? "开启" : "关闭"}</span></label><div class="hint">开启后群主/管理员也能切换人格。</div></div>
        <div class="field"><span>记忆</span>${selectOf("memoryEnabled", [["", "跟随全局"], ["true", "开启"], ["false", "关闭"]], defaults.memoryEnabled)}</div>
        <div class="field"><span>主动聊天</span>${selectOf("proactiveChat", [["", "跟随全局"], ["true", "开启"], ["false", "关闭"]], defaults.proactiveChat)}</div>
        <div class="field wide"><span>触发方式</span><div class="group-trigger-grid">
          ${triggerSwitch("triggerAt", "被 @ 时回复", "")}
          ${triggerSwitch("triggerPrefix", "带群别名前缀时回复", "")}
          ${triggerSwitch("triggerKeyword", "命中关键词时回复", "由关键词列表控制")}
          ${triggerSwitch("triggerFree", "自由判断插话", "交给小模型决定要不要回复")}
        </div><div class="hint">多个开关可同时开启，任一命中即回复；全关表示本群不主动回复。</div></div>
        <div class="field wide"><span>禁用工具</span>${toolPicker}<div class="hint">勾选的禁用仅影响 AI 调用。</div></div>
        <div class="field wide"><span>禁用插件工具</span>${pluginPicker}</div>
      </div><div class="form-error" data-group-error></div></div>`,
      footer: `<button type="button" class="btn btn-outline" data-close>取消</button><button type="button" class="btn btn-primary" data-group-save ${state.allowWrite ? "" : "disabled"}>${icon("save")}保存</button>`,
    });
    if (!state.allowWrite) {
      $$("input, select, textarea, button[data-group-save]", modal.root).forEach(input => {
        input.disabled = true;
      });
    }
    // 关键词列表直接决定关键词触发：有内容就自动开启并锁定
    const keywordToggle = $('[data-group-field="triggerKeyword"]', modal.root);
    const keywordInput = $('[data-group-field="keywords"]', modal.root);
    let keywordAutoOn = false;
    const applyKeywordToggle = () => {
      const hasKeywords = keywordInput.value.split(/[,，\n]/).some(word => word.trim());
      if (hasKeywords) {
        if (!keywordToggle.checked) keywordAutoOn = true;
        keywordToggle.checked = true;
      } else if (keywordAutoOn) {
        keywordToggle.checked = false;
        keywordAutoOn = false;
      }
      keywordToggle.disabled = !state.allowWrite || hasKeywords;
      const text = keywordToggle.closest(".switch")?.querySelector("[data-switch-text]");
      if (text) text.textContent = keywordToggle.checked ? "开启" : "关闭";
    };
    applyKeywordToggle();
    if (state.allowWrite) keywordInput.addEventListener("input", applyKeywordToggle);
    const errorBox = $("[data-group-error]", modal.root);
    const save = $("[data-group-save]", modal.root);
    const updatePickerCount = kind => {
      const items = $$(`[data-picker-list="${kind}"] .group-picker-item`, modal.root);
      const checked = items.filter(item => item.querySelector("input")?.checked).length
      const count = $(`[data-picker-count="${kind}"]`, modal.root)
      if (count) count.textContent = `已禁用 ${checked} / 共 ${items.length}`
    }
    updatePickerCount("tools")
    updatePickerCount("plugins")
    $$("[data-picker-search]", modal.root).forEach(input => {
      input.addEventListener("input", () => {
        const kind = input.dataset.pickerSearch
        const query = input.value.trim().toLowerCase()
        $$(`[data-picker-list="${kind}"] .group-picker-item`, modal.root).forEach(item => {
          const checked = item.querySelector("input")?.checked
          item.hidden = !!query && !item.dataset.pickerKey.includes(query) && !checked
        })
      })
    })
    modal.root.addEventListener("change", event => {
      if (event.target.matches("[data-group-tool]")) updatePickerCount("tools")
      if (event.target.matches("[data-group-plugin]")) updatePickerCount("plugins")
      // 选中下拉账号时隐藏手填框；选「手动输入」才显示
      if (event.target.matches("[data-bot-preset-id]")) {
        const row = event.target.closest("[data-bot-preset-row]")
        const box = event.target.closest(".bot-preset-bot")
        const manual = $("[data-bot-preset-manual]", row)
        if (manual) {
          const isManual = event.target.value === MANUAL_BOT
          manual.hidden = !isManual
          if (box) box.classList.toggle("is-picked", !isManual)
          if (!isManual) manual.value = ""
          if (isManual) manual.focus()
        }
      }
    })
    modal.root.addEventListener("click", event => {
      const list = $("[data-bot-preset-list]", modal.root)
      if (!list) return
      if (event.target.closest("[data-bot-preset-add]")) {
        list.insertAdjacentHTML("beforeend", botPresetRowHtml("", "", ""))
        return
      }
      const removeBtn = event.target.closest("[data-bot-preset-remove]")
      if (removeBtn) removeBtn.closest("[data-bot-preset-row]")?.remove()
    })
    save.addEventListener("click", async () => {
      if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
      const pick = field => $(`[data-group-field="${field}"]`, modal.root).value;
      const collectChecked = selector =>
        $$(selector, modal.root)
          .filter(input => input.checked)
          .map(input => input.value)
      // 按账号的人格与触发词：下拉选中直接用；选「手动输入」才读手填框
      const botPresetRows = $$("[data-bot-preset-row]", modal.root);
      const botPresets = {};
      const botKeywords = {};
      botPresetRows.forEach(row => {
        const presetId = $("[data-bot-preset-value]", row)?.value || "";
        const picked = $("[data-bot-preset-id]", row)?.value || "";
        const botId =
          picked === MANUAL_BOT
            ? String($("[data-bot-preset-manual]", row)?.value || "").trim()
            : picked;
        if (!botId || botId === "stdin") return;
        if (presetId) botPresets[botId] = presetId;
        const words = String($("[data-bot-preset-keywords]", row)?.value || "").trim();
        if (words) botKeywords[botId] = words;
      });
      const body = {
        enabled: pick("enabled") === "" ? null : pick("enabled") === "true",
        triggerAt: $('[data-group-field="triggerAt"]', modal.root).checked,
        triggerPrefix: $('[data-group-field="triggerPrefix"]', modal.root).checked,
        triggerKeyword: $('[data-group-field="triggerKeyword"]', modal.root).checked,
        triggerFree: $('[data-group-field="triggerFree"]', modal.root).checked,
        keywords: pick("keywords").split(/[,，\n]/).map(word => word.trim()).filter(Boolean),
        presetId: pick("presetId"),
        botPresets,
        botKeywords,
        allowAdminPersona: $('[data-group-field="allowAdminPersona"]', modal.root).checked,
        memoryEnabled: pick("memoryEnabled") === "" ? null : pick("memoryEnabled") === "true",
        proactiveChat: pick("proactiveChat") === "" ? null : pick("proactiveChat") === "true",
        // 群专属提示词已移除：改用预设，留空跟随全局
        prompt: "",
        disabledTools: collectChecked("[data-group-tool]"),
        disabledToolPlugins: collectChecked("[data-group-plugin]"),
      };
      errorBox.classList.remove("show");
      setBusy(save, true);
      try {
        const result = await api(`/ai/groups/${encodeURIComponent(group.group_id)}`, { method: "POST", body });
        modal.close();
        toast(result.message || "群组 AI 配置已保存");
        state.ai = null;
        await loadAiGroups(true);
      } catch (error) {
        errorBox.textContent = error.message || String(error);
        errorBox.classList.add("show");
      } finally {
        setBusy(save, false);
      }
    });
  }

  async function resetAiGroup(group) {
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    const confirmed = await confirmDialog({
      title: "恢复群默认配置",
      message: `将删除「${group.name || group.group_id}」的全部 AI 覆盖配置，恢复为跟随全局。`,
      confirmText: "恢复默认",
      danger: true,
    });
    if (!confirmed) return;
    try {
      const result = await api(`/ai/groups/${encodeURIComponent(group.group_id)}`, { method: "DELETE" });
      toast(result.message || "已恢复默认");
      await loadAiGroups(true);
    } catch (error) {
      handleError(error);
    }
  }

  /* ---------------- 状态页初始化 ---------------- */

  function initAiManagement() {
    $$("[data-ai-section-page]").forEach(root => {
      root.addEventListener("click", handleAiSectionClick);
      root.addEventListener("change", handleAiSectionChange);
    });

    document.addEventListener("change", event => {
      const input = event.target.closest(".switch input");
      if (!input) return;
      const text = input.closest(".switch")?.querySelector("[data-switch-text]");
      if (text) text.textContent = input.checked ? "开启" : "关闭";
    });

    $("#toolCfgSave").addEventListener("click", async event => {
      const button = event.currentTarget;
      setBusy(button, true);
      try {
        await saveToolConfig(true);
      } catch (error) {
        handleError(error);
      } finally {
        setBusy(button, false);
        button.disabled = !state.allowWrite;
      }
    });
    let toolTimer = null;
    $("#toolCfgSearch").addEventListener("input", event => {
      state.aiTools.query = event.target.value;
      if (toolTimer) window.clearTimeout(toolTimer);
      toolTimer = window.setTimeout(renderToolConfigTable, 180);
    });
    $("#toolCfgForm").addEventListener("click", event => {
      const remove = event.target.closest("[data-yaml-remove]");
      if (remove) {
        const key = remove.closest("[data-yaml-list]")?.dataset.yamlList;
        if (!key) return;
        saveToolYamlList(key, list => list.filter(name => name !== remove.dataset.yamlRemove)).catch(handleError);
        return;
      }
      const add = event.target.closest("[data-yaml-add]");
      if (!add) return;
      const key = add.dataset.yamlAdd;
      const input = $(`[data-yaml-input="${key}"]`, $("#toolCfgForm"));
      const name = input?.value.trim() || "";
      if (!name) return;
      input.value = "";
      saveToolYamlList(key, list => (list.includes(name) ? list : [...list, name])).catch(handleError);
    });
    $("#toolCfgForm").addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      const input = event.target.closest("[data-yaml-input]");
      if (!input) return;
      event.preventDefault();
      $(`[data-yaml-add="${input.dataset.yamlInput}"]`, $("#toolCfgForm"))?.click();
    });
    $("#toolCfgPlugins").addEventListener("click", async event => {
      const chip = event.target.closest("[data-tool-plugin]");
      if (!chip) return;
      if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
      const before = snapshotToolYamlLists();
      const beforeConfig = {
        disabledTools: [...(state.aiTools.data?.config?.disabledTools || [])],
        disabledToolPlugins: [...(state.aiTools.data?.config?.disabledToolPlugins || [])],
      };
      toggleToolPlugin(chip.dataset.toolPlugin);
      try {
        await saveToolConfig(false);
      } catch (error) {
        state.aiTools.data.config.disabledTools = beforeConfig.disabledTools;
        state.aiTools.data.config.disabledToolPlugins = beforeConfig.disabledToolPlugins;
        state.aiTools.data.yaml = before;
        renderToolConfigTable();
        renderToolYamlLists();
        handleError(error);
      }
    });
    $("#toolCfgRows").addEventListener("change", async event => {
      const input = event.target.closest("[data-tool-toggle]");
      if (!input) return;
      if (!state.allowWrite) {
        input.checked = !input.checked;
        return toast("WebUI 当前为只读模式", "info");
      }
      const before = snapshotToolYamlLists();
      const beforeConfig = [...(state.aiTools.data?.config?.disabledTools || [])];
      toggleToolDisabled(input.dataset.toolToggle, input.checked, input.dataset.toolExposed);
      try {
        await saveToolConfig(false);
      } catch (error) {
        state.aiTools.data.config.disabledTools = beforeConfig;
        state.aiTools.data.yaml = before;
        input.checked = !input.checked;
        renderToolConfigTable();
        renderToolYamlLists();
        handleError(error);
      }
    });

    $("#memAdd").addEventListener("click", () => openMemoryModal(null));
    $("#memCompress").addEventListener("click", () => compressMemories().catch(handleError));
    $("#memClear").addEventListener("click", clearMemories);
    $("#memExport").addEventListener("click", exportMemories);
    $("#memConfigSave").addEventListener("click", saveMemoryConfig);
    let memTimer = null;
    $("#memSearch").addEventListener("input", event => {
      state.aiMemories.query = event.target.value;
      state.aiMemories.page = 1;
      if (memTimer) window.clearTimeout(memTimer);
      memTimer = window.setTimeout(() => loadMemories().catch(handleError), 300);
    });
    $("#memScope").addEventListener("change", event => {
      state.aiMemories.scope = event.target.value;
      state.aiMemories.page = 1;
      loadMemories().catch(handleError);
    });
    $("#memKind").addEventListener("change", event => {
      state.aiMemories.kind = event.target.value;
      state.aiMemories.page = 1;
      loadMemories().catch(handleError);
    });
    $("#memArchived").addEventListener("change", event => {
      state.aiMemories.archived = event.target.value;
      state.aiMemories.page = 1;
      loadMemories().catch(handleError);
    });
    $("#memFilterClear").addEventListener("click", () => {
      state.aiMemories.query = "";
      state.aiMemories.scope = "";
      state.aiMemories.kind = "";
      state.aiMemories.archived = "";
      state.aiMemories.page = 1;
      $("#memSearch").value = "";
      $("#memArchived").value = "";
      loadMemories().catch(handleError);
    });
    $("#memRows").addEventListener("click", event => {
      // 任何被截断的文字：点一下看完整内容
      const clampTarget = event.target.closest("[data-fulltext]");
      if (clampTarget) {
        const inner = clampTarget.querySelector("span:not(.dot)") || clampTarget;
        const truncated =
          inner.scrollWidth > inner.clientWidth + 1 ||
          clampTarget.scrollWidth > clampTarget.clientWidth + 1;
        if (truncated) {
          showFullText(clampTarget.dataset.fulltext);
          return;
        }
      }
      const row = event.target.closest("[data-mem-id]");
      const button = event.target.closest("[data-mem-action]");
      if (!row || !button) return;
      const entry = (state.aiMemories.data?.results || []).find(item => item.id === row.dataset.memId);
      if (!entry) return;
      const action = button.dataset.memAction;
      if (action === "pin") toggleMemoryPin(entry);
      else if (action === "edit") openMemoryModal(entry);
      else if (action === "delete") deleteMemory(entry);
      else if (action === "restore") restoreMemory(entry);
    });
    $("#memPager").addEventListener("click", event => stepPager(event, state.aiMemories, () => loadMemories()));

    $("#recExport").addEventListener("click", exportRecords);
    $("#recClear").addEventListener("click", clearRecords);
    ["recType", "recDays", "recStatus"].forEach(id => {
      $(`#${id}`).addEventListener("change", event => {
        const key = { recType: "type", recDays: "days", recStatus: "success" }[id];
        state.aiRecords[key] = event.target.value;
        state.aiRecords.page = 1;
        loadRecords().catch(handleError);
      });
    });
    let recTimer = null;
    $("#recSearch").addEventListener("input", event => {
      state.aiRecords.query = event.target.value;
      state.aiRecords.page = 1;
      if (recTimer) window.clearTimeout(recTimer);
      recTimer = window.setTimeout(() => loadRecords().catch(handleError), 300);
    });
    $("#recPager").addEventListener("click", event => stepPager(event, state.aiRecords, () => loadRecords()));

    $("#statsDays").addEventListener("change", event => {
      state.aiStats.days = Number(event.target.value) || 7;
      loadStats(true).catch(handleError);
    });

    $("#sessExport").addEventListener("click", () => exportSessions());
    $("#sessClear").addEventListener("click", clearSessions);
    let sessTimer = null;
    $("#sessSearch").addEventListener("input", event => {
      state.aiSessions.query = event.target.value;
      state.aiSessions.page = 1;
      if (sessTimer) window.clearTimeout(sessTimer);
      sessTimer = window.setTimeout(() => loadSessions().catch(handleError), 300);
    });
    $("#sessPager").addEventListener("click", event => stepPager(event, state.aiSessions, () => loadSessions()));
    $("#sessRows").addEventListener("click", event => {
      const button = event.target.closest("[data-session-action]");
      if (!button) return;
      const id = button.dataset.sessionId;
      const action = button.dataset.sessionAction;
      if (action === "view") openSessionDetail(id);
      else if (action === "export") exportSessions(id);
      else if (action === "compress") compressSession(id);
      else if (action === "delete") deleteSession(id);
    });

    $("#tcExport").addEventListener("click", exportToolCalls);
    ["tcDays", "tcStatus"].forEach(id => {
      $(`#${id}`).addEventListener("change", event => {
        const key = id === "tcDays" ? "days" : "success";
        state.aiToolCalls[key] = event.target.value;
        state.aiToolCalls.page = 1;
        loadToolCalls().catch(handleError);
      });
    });
    let tcTimer = null;
    $("#tcSearch").addEventListener("input", event => {
      state.aiToolCalls.query = event.target.value;
      state.aiToolCalls.page = 1;
      if (tcTimer) window.clearTimeout(tcTimer);
      tcTimer = window.setTimeout(() => loadToolCalls().catch(handleError), 300);
    });
    $("#tcPager").addEventListener("click", event => stepPager(event, state.aiToolCalls, () => loadToolCalls()));

    let groupTimer = null;
    $("#aiGroupSearch").addEventListener("input", event => {
      state.aiGroups.query = event.target.value;
      if (groupTimer) window.clearTimeout(groupTimer);
      groupTimer = window.setTimeout(() => {
        if (state.aiGroups.data) renderAiGroups(state.aiGroups.data);
      }, 160);
    });
    $("#aiGroupRows").addEventListener("click", event => {
      const configButton = event.target.closest("[data-group-config]");
      const resetButton = event.target.closest("[data-group-reset]");
      const groups = state.aiGroups.data?.groups || [];
      if (configButton) {
        const group = groups.find(item => item.group_id === configButton.dataset.groupConfig);
        if (group) openAiGroupModal(group).catch(handleError);
        return;
      }
      if (resetButton) {
        const group = groups.find(item => item.group_id === resetButton.dataset.groupReset);
        if (group) resetAiGroup(group);
      }
    });
  }

  /* ---------------- 页面导航 ---------------- */

  const pageLoaders = {
    dashboard: () => loadOverview(),
    ai: () => loadAI(),
    tools: () => loadAI(),
    knowledge: () => loadKnowledge(),
    "ai-system": () => loadAiYamlPage("ai-system"),
    "ai-presets": () => loadAiSection("presets", true),
    "ai-channels": () => loadAiSection("channels", true),
    "ai-proxies": () => loadAiSection("proxies", true),
    "ai-skills": () => loadAiSection("skills", true),
    "ai-mcp": () => loadAiSection("mcpServers", true),
    "ai-image": () => loadAiSection("imagePresets", true),
    "ai-stickers": () => loadStickers(),
    "ai-voice": () => loadVoicePage(),
    "ai-tool-config": () => loadToolConfigPage(),
    "ai-memories": () => loadMemories(),
    "ai-stats": () => loadStats(),
    "ai-sessions": () => Promise.all([loadSessions(), loadRecords(), loadToolCalls()]),
    "ai-groups": () => loadAiGroups(),
    "config-basic": () => loadCoreConfigPage("basic"),
    "config-group": () => loadGroupConfigPage(),
    "help-panel": () => loadHelpPanel(),
    "config-other": () => Promise.all([loadCoreConfigPage("other"), loadStatusImageSetting()]),
    "config-plugin": () => loadPluginConfigPage(),
    plugins: () => loadPlugins(),
    accounts: () => loadAccounts(),
    groups: () => loadGroups(),
    logs: () => loadLogs(),
    terminal: () => terminalPage?.open(),
    backend: () => loadBackendPage(),
  };

  function showPage(id, options) {
    const opts = options || {};
    const target = NAV_ITEMS.some(item => item.id === id) ? id : "dashboard";
    state.page = target;

    $$(".page").forEach(page => page.classList.toggle("active", page.dataset.page === target));
    $$(".nav-item[data-nav]").forEach(button => button.classList.toggle("active", button.dataset.nav === target));
    $$("#pluginCfgNav [data-plugin-cfg]").forEach(button => {
      button.classList.toggle(
        "active",
        target === "config-plugin" && button.dataset.pluginCfg === state.configPlugin.plugin,
      );
    });

    closeSidebar();
    if (target !== "help-panel") setHelpDrawer(false);
    window.scrollTo({ top: 0, behavior: "auto" });

    if (!opts.skipLoad && pageLoaders[target]) {
      Promise.resolve()
        .then(pageLoaders[target])
        .catch(handleError);
    }
    syncLogAuto();
  }

  function openSidebar() {
    $("#sidebar").classList.add("open");
    document.body.classList.add("sidebar-open");
  }

  function closeSidebar() {
    $("#sidebar").classList.remove("open");
    document.body.classList.remove("sidebar-open");
  }

  async function refreshCurrent() {
    const loaders = {
      dashboard: () => loadOverview(true),
      ai: () => loadAI(true),
      tools: () => loadAI(true),
      knowledge: () => loadKnowledge(),
      "ai-system": () => loadAiYamlPage("ai-system", true),
      "ai-presets": () => loadAiSection("presets", true),
      "ai-channels": () => loadAiSection("channels", true),
      "ai-proxies": () => loadAiSection("proxies", true),
      "ai-skills": () => loadAiSection("skills", true),
      "ai-mcp": () => loadAiSection("mcpServers", true),
      "ai-image": () => loadAiSection("imagePresets", true),
      "ai-stickers": () => loadStickers(true),
      "ai-voice": () => loadVoicePage(true),
      "ai-tool-config": () => loadToolConfigPage(true),
      "ai-memories": () => loadMemories(true),
      "ai-stats": () => loadStats(true),
      "ai-sessions": () => Promise.all([loadSessions(true), loadRecords(true), loadToolCalls(true)]),
      "ai-groups": () => loadAiGroups(true),
      "config-basic": () => loadCoreConfigPage("basic", true),
      "config-group": () => loadGroupConfigPage(true),
      "help-panel": () => loadHelpPanel(true),
      "config-other": () => Promise.all([loadCoreConfigPage("other", true), loadStatusImageSetting()]),
      "config-plugin": () => loadPluginConfigPage(true),
      plugins: () => loadPlugins(true),
      accounts: () => loadAccounts(true),
      groups: () => loadGroups(true),
      logs: () => loadLogs(),
    };
    const loader = loaders[state.page];
    if (!loader) return;
    await loader();
    toast("当前页面已刷新", "info", "刷新完成");
  }

  /* ---------------- 登录 ---------------- */

  function showLogin(session, message) {
    const login = $("#login");
    login.hidden = false;
    $("#loginLoading").hidden = true;
    $("#loginError").classList.remove("show");
    $("#loginErrorPlain").classList.remove("show");

    if (!session) {
      $("#loginTitle").textContent = "无法连接控制台";
      $("#loginForm").hidden = true;
      $("#loginRetry").hidden = false;
      if (message) {
        const box = $("#loginErrorPlain");
        box.textContent = message;
        box.classList.add("show");
      }
      return;
    }

    state.tokenRequired = !!session.tokenRequired;

    if (state.tokenRequired) {
      $("#loginTitle").textContent = "需要访问令牌";
      $("#loginForm").hidden = false;
      $("#loginRetry").hidden = true;
      const prefs = readLoginPrefs();
      const rememberBox = $("#loginRemember");
      const autoBox = $("#loginAuto");
      if (rememberBox) rememberBox.checked = prefs.remember;
      if (autoBox) {
        autoBox.checked = prefs.auto;
        autoBox.disabled = !prefs.remember;
      }
      const tokenInput = $("#loginToken");
      if (tokenInput && prefs.remember && prefs.token) tokenInput.value = prefs.token;
      if (message) showLoginError(message);
    } else {
      $("#loginTitle").textContent = "仅限本机访问";
      $("#loginForm").hidden = true;
      $("#loginRetry").hidden = false;
      if (message) {
        const box = $("#loginErrorPlain");
        box.textContent = message;
        box.classList.add("show");
      }
    }
  }

  function hideLogin() {
    $("#login").hidden = true;
  }

  function showLoginError(message) {
    const box = $("#loginError");
    box.textContent = message;
    box.classList.add("show");
  }

  function showLoginLoading() {
    const login = $("#login");
    login.hidden = false;
    $("#loginTitle").textContent = "正在连接控制台";
    $("#loginLoading").hidden = false;
    $("#loginForm").hidden = true;
    $("#loginRetry").hidden = true;
    $("#loginError").classList.remove("show");
    $("#loginErrorPlain").classList.remove("show");
  }

  async function submitLogin(event) {
    event.preventDefault();
    const input = $("#loginToken");
    const value = input.value.trim();
    if (!value) {
      showLoginError("请输入访问令牌");
      return;
    }

    const remember = $("#loginRemember")?.checked === true;
    const auto = remember && $("#loginAuto")?.checked === true;
    const button = $("#loginSubmit");
    setBusy(button, true);
    state.token = value;
    try {
      const session = await fetchSession();
      if (!session.authorized) {
        clearStoredToken();
        input.value = "";
        showLoginError("访问令牌无效，请检查 config/config/webui.yaml");
        return;
      }
      if (remember) writeLoginPrefs({ remember, auto, token: value });
      else clearLoginPrefs();
      hideLogin();
      startApp();
    } catch (error) {
      clearStoredToken();
      showLoginError(error.message || "连接失败");
    } finally {
      setBusy(button, false);
    }
  }

  /** 从 #/login/<code> 取一次性登录码，成功后就地换成访问令牌 */
  function readLoginCodeFromHash() {
    const match = String(window.location.hash || "").match(/#\/login\/(\d{4,12})/)
    return match ? match[1] : "";
  }

  async function redeemLoginCode(code) {
    const response = await fetch(apiUrl("/login/quick"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-WebUI-Request": "1" },
      body: JSON.stringify({ code }),
    });
    let data = {}
    try {
      data = await response.json();
    } catch (error) {
      data = {}
    }
    if (!response.ok) throw new Error(data.message || "登录码无效或已过期");
    return data;
  }

  async function bootstrap() {
    dropLegacyToken();
    // 带登录码来的：先换令牌，换完把码从地址栏抹掉，避免被复制转发
    const loginCode = readLoginCodeFromHash();
    if (loginCode) {
      try {
        const result = await redeemLoginCode(loginCode);
        state.token = result.token || "";
        writeLoginPrefs({ remember: true, auto: true, token: state.token });
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      } catch (error) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        try {
          const session = await fetchSession();
          showLogin(session, error.message || "登录码无效或已过期");
        } catch (inner) {
          showLogin(null, error.message || "登录码无效或已过期");
        }
        return;
      }
    }
    // 自动登录：仅在勾选「记住令牌」且开启「自动登录」时用保存的令牌试一次
    const prefs = readLoginPrefs();
    if (prefs.remember && prefs.auto && prefs.token) {
      state.token = prefs.token;
      try {
        const session = await fetchSession();
        applyWritePermission();
        if (session.authorized) {
          hideLogin();
          startApp();
          return;
        }
        clearStoredToken();
      } catch (error) {
        clearStoredToken();
      }
    }
    try {
      const session = await fetchSession();
      applyWritePermission();
      if (!session.authorized) {
        showLogin(session, "");
        return;
      }
      hideLogin();
      startApp();
    } catch (error) {
      showLogin(null, error.message || "无法连接 WebUI");
    }
  }

  function applyWritePermission() {
    $$('[data-action="kb-add"]').forEach(button => {
      button.hidden = !state.allowWrite;
    });
    $$(
      "[data-ai-add], #toolCfgSave, #memAdd, #memClear, #memConfigSave, #recClear, #sessClear, #mcpSync",
    ).forEach(button => {
      button.disabled = !state.allowWrite;
    });
    terminalPage?.setWriteAllowed(state.allowWrite);
  }

  /* ---------------- 初始化 ---------------- */

  function openPluginCfgNavGroup() {
    const group = $('.nav-group[data-nav-group="plugin-config"]');
    if (!group) return;
    group.classList.remove("collapsed");
    const next = $$(".nav-group.collapsed").map(item => item.dataset.navGroup);
    safeSet(NAV_KEY, JSON.stringify(next));
    loadPluginConfigList().catch(handleError);
  }

  function initNavGroups() {
    let collapsed = [];
    try {
      collapsed = JSON.parse(safeGet(NAV_KEY) || "[]");
    } catch (error) {
      collapsed = [];
    }
    if (!Array.isArray(collapsed)) collapsed = [];

    $$(".nav-group").forEach(group => {
      const key = group.dataset.navGroup;
      if (collapsed.includes(key)) group.classList.add("collapsed");
      const head = $(".nav-head", group);
      if (!head) return;
      head.addEventListener("click", () => {
        group.classList.toggle("collapsed");
        const next = $$(".nav-group.collapsed").map(item => item.dataset.navGroup);
        safeSet(NAV_KEY, JSON.stringify(next));
        if (key === "plugin-config" && !group.classList.contains("collapsed"))
          loadPluginConfigList().catch(handleError);
      });
    });

    const pluginCfgGroup = $('.nav-group[data-nav-group="plugin-config"]');
    if (pluginCfgGroup && !pluginCfgGroup.classList.contains("collapsed"))
      loadPluginConfigList().catch(handleError);
  }

  function initUserMenu() {
    const wrap = $("#avatarWrap");
    const avatar = $("#avatar");
    const menu = $("#userMenu");
    const setOpen = open => {
      menu.hidden = !open;
      avatar.setAttribute("aria-expanded", open ? "true" : "false");
    };
    avatar.addEventListener("click", () => setOpen(menu.hidden));
    $("#logoutBtn").addEventListener("click", logout);
    document.addEventListener("click", event => {
      if (!menu.hidden && !wrap.contains(event.target)) setOpen(false);
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !menu.hidden) setOpen(false);
    });
  }

  /** 清掉访问令牌并重载：断开轮询与 SSE，回到登录页 */
  function logout() {
    clearStoredToken();
    invalidateSavedToken();
    window.location.reload();
  }

  function initShell() {
    applyTheme(state.theme);
    $("#themeBtn").addEventListener("click", toggleTheme);
    $("#menuBtn").addEventListener("click", openSidebar);
    $("#sidebarOverlay").addEventListener("click", closeSidebar);
    $("#searchTrigger").addEventListener("click", () => openPalette());
    initNavGroups();
    initUserMenu();

    document.addEventListener("click", event => {
      const nav = event.target.closest("[data-nav]");
      if (nav) {
        event.preventDefault();
        showPage(nav.dataset.nav);
        return;
      }
      const action = event.target.closest("[data-action]");
      if (action) {
        event.preventDefault();
        if (action.dataset.action === "kb-add") {
          if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
          openKbModal();
        } else if (action.dataset.action === "kb-export") {
          exportKnowledge();
        }
      }
    });

    window.addEventListener("keydown", event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        if (!$("#login").hidden) return;
        event.preventDefault();
        if (state.palette.open) closePalette();
        else openPalette();
        return;
      }
      if (event.key === "Escape") {
        closeSidebar();
        if (state.palette.open) closePalette();
      }
    });
  }

  async function loadStatusImageSetting() {
    const select = $("#statusImageScale");
    if (!select) return;
    try {
      const data = await api("/status-image");
      state.statusImage.scale = Number(data.scale) || 1;
      select.value = String(state.statusImage.scale);
      state.statusImage.proForAll = data.proForAll === true;
      const proAll = $("#statusProForAll");
      if (proAll) proAll.checked = state.statusImage.proForAll;
    } catch {}
  }

  async function saveStatusImageSetting() {
    const select = $("#statusImageScale");
    const button = $("#statusImageSave");
    if (!select || !button) return;
    if (!state.allowWrite) return toast("WebUI 当前为只读模式", "info");
    const proAll = $("#statusProForAll");
    setBusy(button, true);
    try {
      const result = await api("/status-image", {
        method: "POST",
        body: {
          scale: Number(select.value),
          proForAll: proAll ? proAll.checked : false,
        },
      });
      state.statusImage.scale = Number(select.value);
      state.statusImage.proForAll = result.proForAll === true;
      if (proAll) proAll.checked = state.statusImage.proForAll;
      toast(result.message || "状态图设置已保存");
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(button, false);
    }
  }

  function initStatusImage() {
    $("#statusImageSave")?.addEventListener("click", saveStatusImageSetting);
  }

  function initAI() {
    initAIModelPicker();
  }

  function initTools() {
    $("#toolSearch").addEventListener("input", event => {
      state.toolQuery = event.target.value;
      state.toolLimit = 60;
      renderTools();
    });

    $("#toolPermFilter").addEventListener("click", event => {
      const button = event.target.closest("[data-perm]");
      if (!button) return;
      state.toolPerm = button.dataset.perm || "";
      state.toolLimit = 60;
      renderTools();
    });

    $("#toolRows").addEventListener("click", event => {
      if (!event.target.closest('[data-more="tool"]')) return;
      state.toolLimit += 60;
      renderTools();
    });
  }

  function initKnowledge() {
    let timer = null;
    const search = $("#kbSearch");
    search.addEventListener("input", () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        loadKnowledge({ query: search.value.trim(), resetPage: true }).catch(handleError);
      }, 320);
    });

    $("#kbScope").addEventListener("change", event => {
      loadKnowledge({ scope: event.target.value, resetPage: true }).catch(handleError);
    });

    $("#kbClear").addEventListener("click", () => {
      search.value = "";
      $("#kbScope").value = "";
      loadKnowledge({ query: "", scope: "", tag: "", resetPage: true }).catch(handleError);
    });

    $("#kbTagChips").addEventListener("click", event => {
      const chip = event.target.closest("[data-tag]");
      if (!chip) return;
      const next = state.kb.tag === chip.dataset.tag ? "" : chip.dataset.tag;
      loadKnowledge({ tag: next, resetPage: true }).catch(handleError);
    });

    $("#kbPager").addEventListener("click", event => {
      const button = event.target.closest("[data-page-step]");
      if (!button || button.disabled) return;
      const step = Number(button.dataset.pageStep);
      loadKnowledge({ page: Math.max(1, state.kb.page + step) }).catch(handleError);
    });

    $("#kbList").addEventListener("click", event => {
      const item = event.target.closest(".kb-item");
      if (!item) return;
      const entry = (state.kbData && state.kbData.results ? state.kbData.results : []).find(result => result.id === item.dataset.id);
      if (!entry) return;
      const actionButton = event.target.closest("[data-kb-action]");
      const action = actionButton ? actionButton.dataset.kbAction : "edit";
      if (action === "pin") {
        toggleKbPin(entry);
        return;
      }
      if (action === "delete") {
        deleteKbEntry(entry);
        return;
      }
      openKbModal(entry);
    });
  }

  function initPlugins() {
    const button = $("#pluginsRefresh");
    button.addEventListener("click", async () => {
      setBusy(button, true);
      try {
        toast("正在同步 Gitee 与 GitHub 插件索引…", "info", "插件库");
        await loadPlugins(true);
        toast("插件库已同步", "success");
      } catch (error) {
        handleError(error);
      } finally {
        setBusy(button, false);
      }
    });

    const installCustom = $("#pluginInstallCustom");
    if (installCustom) installCustom.addEventListener("click", openInstallPluginModal);

    $("#pluginTabs").addEventListener("click", event => {
      const button = event.target.closest("[data-plugin-tab]");
      if (!button) return;
      state.pluginManager.tab = button.dataset.pluginTab;
      state.pluginManager.limit = 60;
      renderPlugins();
    });

    $("#pluginSearch").addEventListener("input", event => {
      state.pluginManager.query = event.target.value;
      state.pluginManager.limit = 60;
      renderPlugins();
    });

    $("#pluginRows").addEventListener("click", event => {
      if (event.target.closest('[data-more="pluginstore"]')) {
        state.pluginManager.limit += 60;
        renderPlugins();
        return;
      }
      const install = event.target.closest("[data-plugin-install]");
      if (install) {
        installIndexPlugin(install.dataset.pluginInstall);
        return;
      }
      const config = event.target.closest("[data-plugin-config]");
      if (config) {
        openPluginConfig(config.dataset.pluginConfig);
        return;
      }
      const update = event.target.closest("[data-plugin-update]");
      if (update) {
        updateManagedPlugin(update.dataset.pluginUpdate);
        return;
      }
      const uninstall = event.target.closest("[data-plugin-uninstall]");
      if (uninstall) {
        const plugin = pluginByName(uninstall.dataset.pluginUninstall);
        if (plugin) openUninstallPluginModal(plugin);
        return;
      }
    });

    $("#singlePluginRows").addEventListener("click", event => {
      const toggle = event.target.closest("[data-plugin-toggle]");
      if (toggle) {
        toggleSinglePlugin(toggle.dataset.pluginToggle, toggle.dataset.pluginEnabled === "1");
        return;
      }
      const removeFile = event.target.closest("[data-plugin-remove-file]");
      if (removeFile) {
        const plugin = pluginByName(removeFile.dataset.pluginRemoveFile);
        if (plugin) openRemoveSinglePluginModal(plugin);
        return;
      }
      const install = event.target.closest("[data-single-install]");
      if (install) {
        installSinglePlugin(install.dataset.singleInstall);
        return;
      }
      const edit = event.target.closest("[data-single-edit]");
      if (edit) openSinglePluginEditor(edit.dataset.singleEdit);
    });

    const createButton = $("#singlePluginCreate");
    if (createButton) createButton.addEventListener("click", () => openSinglePluginEditor(""));
    const cloneButton = $("#singlePluginClone");
    if (cloneButton) cloneButton.addEventListener("click", openCloneSinglePluginModal);

    $("#singlePluginTabs").addEventListener("click", event => {
      const button = event.target.closest("[data-single-tab]");
      if (!button) return;
      state.pluginManager.singleTab = button.dataset.singleTab;
      renderPlugins();
    });

    $("#singlePluginSearch").addEventListener("input", event => {
      state.pluginManager.singleQuery = event.target.value;
      renderPlugins();
    });
  }

  function initGroups() {
    $("#groupTabs").addEventListener("click", event => {
      const button = event.target.closest("[data-group-tab]");
      if (!button) return;
      state.groupTab = button.dataset.groupTab;
      renderGroups();
    });

    $("#groupSearch").addEventListener("input", event => {
      state.groupQuery = event.target.value;
      renderGroups();
    });
  }

  function initLogs() {
    $("#logTypeBtns").addEventListener("click", event => {
      const button = event.target.closest("[data-log-type]");
      if (!button) return;
      state.logs.type = button.dataset.logType;
      updateLogTypeButtons();
      loadLogs().catch(handleError);
    });

    $("#logAuto").addEventListener("change", event => {
      state.logs.auto = event.target.checked;
      syncLogAuto();
      if (state.logs.auto) loadLogs().catch(handleError);
    });

    updateLogTypeButtons();
    const autoBox = $("#logAuto");
    if (autoBox) autoBox.checked = state.logs.auto;
  }

  function initPalette() {
    $("#paletteInput").addEventListener("input", event => {
      state.palette.query = event.target.value;
      state.palette.index = 0;
      renderPalette();
    });

    $("#paletteInput").addEventListener("keydown", event => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        movePalette(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        movePalette(-1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        runPaletteActive();
      } else if (event.key === "Escape") {
        event.preventDefault();
        closePalette();
      }
    });

    $("#paletteList").addEventListener("click", event => {
      const button = event.target.closest("[data-palette-index]");
      if (!button) return;
      state.palette.index = Number(button.dataset.paletteIndex);
      runPaletteActive();
    });

    $("#palette").addEventListener("click", event => {
      if (event.target === $("#palette")) closePalette();
    });
  }

  function initLogin() {
    $("#loginForm").addEventListener("submit", submitLogin);
    // 自动登录依赖已保存的令牌，未勾选「记住令牌」时不可单独启用
    $("#loginRemember").addEventListener("change", event => {
      const autoBox = $("#loginAuto");
      if (!autoBox) return;
      if (!event.target.checked) autoBox.checked = false;
      autoBox.disabled = !event.target.checked;
    });
    $("#loginRetry").addEventListener("click", () => {
      showLoginLoading();
      bootstrap();
    });
  }

  /** 首屏完成后空闲预取账号与帮助面板数据，后续切页直接渲染 */
  function preloadSecondaryData() {
    const run = () => {
      if (!state.started) return;
      if (!state.accounts) loadAccounts().catch(() => {});
      prefetchHelpPanel().catch(() => {});
    };
    if (typeof window.requestIdleCallback === "function")
      window.requestIdleCallback(run, { timeout: 2500 });
    else window.setTimeout(run, 900);
  }

  function startApp() {
    if (!state.started) {
      state.started = true;
      initShell();
      initStatusImage();
      initAI();
      initTools();
      initKnowledge();
      initConfigPages();
      initPlugins();
      initGroups();
      initLogs();
      initAiManagement();
      initPalette();
      initUptimeTicker();
      startBotStatusPoll();
      startGaugePoll();
      if (window.YunzaiTerminal) {
        terminalPage = window.YunzaiTerminal.create({
          api,
          apiSSE,
          toast,
          handleError,
          getAllowWrite: () => state.allowWrite,
        });
      }
    }
    applyWritePermission();
    showPage(state.page || "dashboard", { skipLoad: true });
    const loader = pageLoaders[state.page] || pageLoaders.dashboard;
    Promise.resolve()
      .then(loader)
      .then(preloadSecondaryData)
      .catch(handleError);
  }

  function initUptimeTicker() {
    window.setInterval(() => {
      if (state.startTime) {
        const uptime = $("#statUptime");
        if (uptime) uptime.textContent = fmtDuration(Date.now() - state.startTime);
      }
      $$("[data-account-start]").forEach(node => {
        const start = Number(node.dataset.accountStart);
        if (start > 0) node.textContent = `已运行 ${fmtDuration(Date.now() - start)}`;
      });
    }, 1000);
  }

  initLogin();
  bootstrap();
})();
