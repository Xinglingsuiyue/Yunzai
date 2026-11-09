(function () {
  "use strict";

  const CLIENT_KEY = "yunzai-webui-terminal-client";
  const MAX_LINES = 2500;
  const FLUSH_DELAY = 0;
  const INPUT_CHUNK_BYTES = 12 * 1024;
  const MAX_PENDING = 256 * 1024;
  const RAW_TAIL = 256 * 1024;
  const RESIZE_DEBOUNCE = 180;
  const PING_TIMEOUT = 55 * 1000;

  const NAV_KEYS = [
    { key: "esc", label: "Esc", data: "\x1b", title: "Esc" },
    { key: "ctrl", label: "Ctrl", modifier: "ctrl", title: "粘滞 Ctrl：下一次按键生效" },
    { key: "alt", label: "Alt", modifier: "alt", title: "粘滞 Alt：下一次按键生效" },
    { key: "tab", label: "Tab", data: "\t", title: "Tab" },
    { key: "home", label: "Home", data: "\x1b[H", title: "Home" },
    { key: "end", label: "End", data: "\x1b[F", title: "End" },
    { key: "pgup", label: "PgUp", data: "\x1b[5~", title: "PageUp" },
    { key: "left", label: "←", data: "\x1b[D", title: "左" },
    { key: "up", label: "↑", data: "\x1b[A", title: "上" },
    { key: "down", label: "↓", data: "\x1b[B", title: "下" },
    { key: "right", label: "→", data: "\x1b[C", title: "右" },
    { key: "ins", label: "Ins", data: "\x1b[2~", title: "Insert" },
    { key: "del", label: "Del", data: "\x1b[3~", title: "Delete" },
    { key: "pgdn", label: "PgDn", data: "\x1b[6~", title: "PageDown" },
  ];

  const PALETTE = [
    "#3b4048", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#d7dae0",
    "#5c6370", "#ff7b86", "#b5e890", "#ffd68a", "#7cc4ff", "#e09bff", "#73e0e0", "#ffffff",
  ];

  const svgIcon = name =>
    `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

  function color256(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return null;
    if (n < 16) return PALETTE[n] || null;
    if (n >= 232) {
      const gray = 8 + (n - 232) * 10;
      return `rgb(${gray},${gray},${gray})`;
    }
    const index = n - 16;
    const conv = v => (v === 0 ? 0 : 55 + v * 40);
    return `rgb(${conv(Math.floor(index / 36))},${conv(Math.floor((index % 36) / 6))},${conv(index % 6)})`;
  }

  function rgbColor(r, g, b) {
    const clamp = v => Math.max(0, Math.min(255, Number(v) || 0));
    return `rgb(${clamp(r)},${clamp(g)},${clamp(b)})`;
  }

  function defaultStyle() {
    return { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, inverse: false };
  }

  function styleKey(style) {
    return `${style.fg || ""}|${style.bg || ""}|${style.bold ? 1 : 0}${style.dim ? 1 : 0}${style.italic ? 1 : 0}${style.underline ? 1 : 0}${style.inverse ? 1 : 0}`;
  }

  function createScreen(view) {
    let lines = [];
    let lineEl = null;
    let lineText = "";
    let spanEl = null;
    let spanKey = "";
    let carry = "";
    let style = defaultStyle();
    let follow = true;
    let scrollFrame = 0;

    view.addEventListener("scroll", () => {
      follow = view.scrollHeight - view.scrollTop - view.clientHeight < 48;
      if (!follow && scrollFrame) {
        window.cancelAnimationFrame(scrollFrame);
        scrollFrame = 0;
      }
    });

    function scheduleScroll() {
      if (!follow || scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = 0;
        if (follow) view.scrollTop = view.scrollHeight;
      });
    }

    function scrollToBottom() {
      follow = true;
      if (scrollFrame) {
        window.cancelAnimationFrame(scrollFrame);
        scrollFrame = 0;
      }
      view.scrollTop = view.scrollHeight;
    }

    function ensureLine() {
      if (lineEl) return lineEl;
      lineEl = document.createElement("div");
      lineEl.className = "term-line";
      view.appendChild(lineEl);
      lines.push(lineEl);
      if (lines.length > MAX_LINES) {
        const removed = lines.shift();
        removed.remove();
      }
      lineText = "";
      spanEl = null;
      spanKey = "";
      return lineEl;
    }

    function resetLine() {
      lineEl = null;
      lineText = "";
      spanEl = null;
      spanKey = "";
      ensureLine();
    }

    function applyStyle(el) {
      if (style.inverse) {
        el.style.color = style.bg || "#0e1117";
        el.style.background = style.fg || "#d7dae0";
      } else {
        el.style.color = style.fg || "";
        el.style.background = style.bg || "";
      }
      el.style.fontWeight = style.bold ? "600" : "";
      el.style.fontStyle = style.italic ? "italic" : "";
      el.style.textDecoration = style.underline ? "underline" : "";
      el.style.opacity = style.dim ? "0.62" : "";
    }

    function appendText(text) {
      if (!text) return;
      ensureLine();
      const key = styleKey(style);
      if (!spanEl || spanKey !== key) {
        spanEl = document.createElement("span");
        spanKey = key;
        applyStyle(spanEl);
        lineEl.appendChild(spanEl);
      }
      spanEl.appendChild(document.createTextNode(text));
      lineText += text;
    }

    function newline() {
      resetLine();
    }

    function clearCurrentLine() {
      if (!lineEl) return;
      lineEl.textContent = "";
      lineText = "";
      spanEl = null;
      spanKey = "";
    }

    function backspace() {
      if (!lineEl || !lineText) return;
      lineText = lineText.slice(0, -1);
      if (!spanEl) spanEl = lineEl.lastChild;
      if (spanEl) {
        spanEl.textContent = spanEl.textContent.slice(0, -1);
        if (!spanEl.textContent) {
          spanEl.remove();
          spanEl = null;
          spanKey = "";
        }
      }
    }

    function clearAll() {
      view.textContent = "";
      lines = [];
      lineEl = null;
      lineText = "";
      spanEl = null;
      spanKey = "";
      ensureLine();
      scrollToBottom();
    }

    function reset() {
      clearAll();
      carry = "";
      style = defaultStyle();
    }

    function applySgr(raw) {
      const parts = String(raw || "")
        .split(";")
        .map(value => (value === "" ? 0 : Number(value)));
      let i = 0;
      while (i < parts.length) {
        const code = parts[i];
        if (code === 0) style = defaultStyle();
        else if (code === 1) style.bold = true;
        else if (code === 2) style.dim = true;
        else if (code === 3) style.italic = true;
        else if (code === 4) style.underline = true;
        else if (code === 7) style.inverse = true;
        else if (code === 22) {
          style.bold = false;
          style.dim = false;
        } else if (code === 23) style.italic = false;
        else if (code === 24) style.underline = false;
        else if (code === 27) style.inverse = false;
        else if (code >= 30 && code <= 37) style.fg = PALETTE[code - 30];
        else if (code === 39) style.fg = null;
        else if (code >= 40 && code <= 47) style.bg = PALETTE[code - 40];
        else if (code === 49) style.bg = null;
        else if (code >= 90 && code <= 97) style.fg = PALETTE[code - 90 + 8];
        else if (code >= 100 && code <= 107) style.bg = PALETTE[code - 100 + 8];
        else if (code === 38 || code === 48) {
          const target = code === 38 ? "fg" : "bg";
          const mode = parts[i + 1];
          if (mode === 5) {
            style[target] = color256(parts[i + 2]);
            i += 2;
          } else if (mode === 2) {
            style[target] = rgbColor(parts[i + 2], parts[i + 3], parts[i + 4]);
            i += 4;
          } else {
            i += 1;
          }
        }
        i += 1;
      }
      spanEl = null;
      spanKey = "";
    }

    function handleCsi(params, final) {
      if (final === "m") return applySgr(params);
      if (final === "K") {
        if (params === "1" || params === "2") return clearCurrentLine();
        return;
      }
      if (final === "J") {
        if (params === "2" || params === "3") return clearAll();
        return clearCurrentLine();
      }
    }

    function write(chunk) {
      if (!chunk) return;
      const input = carry + chunk;
      carry = "";
      let i = 0;
      while (i < input.length) {
        const code = input.charCodeAt(i);
        if (code === 0x1b) {
          if (i + 1 >= input.length) {
            carry = input.slice(i);
            break;
          }
          const next = input.charCodeAt(i + 1);
          if (next === 0x5b) {
            const slice = input.slice(i, i + 256);
            const match = /^\x1b\[([0-9;?<=>! ]*)([@-~])/.exec(slice);
            if (!match) {
              if (input.length - i < 256) {
                carry = input.slice(i);
                break;
              }
              i += 2;
              continue;
            }
            handleCsi(match[1], match[2]);
            i += match[0].length;
            continue;
          }
          if (next === 0x5d) {
            const rest = input.slice(i + 2);
            const bel = rest.indexOf("\x07");
            const st = rest.indexOf("\x1b\\");
            let end = -1;
            if (bel !== -1 && (st === -1 || bel < st)) end = i + 2 + bel + 1;
            else if (st !== -1) end = i + 2 + st + 2;
            if (end === -1) {
              if (input.length - i < 2048) {
                carry = input.slice(i);
                break;
              }
              i += 2;
              continue;
            }
            i = end;
            continue;
          }
          i += 2;
          continue;
        }
        if (code === 0x0a) {
          newline();
          i += 1;
          continue;
        }
        if (code === 0x0d) {
          if (i + 1 >= input.length) {
            carry = "\r";
            break;
          }
          const next = input.charCodeAt(i + 1);
          if (next === 0x0a) {
            newline();
            i += 2;
            continue;
          }
          if (next === 0x0d && input.charCodeAt(i + 2) === 0x0a) {
            newline();
            i += 3;
            continue;
          }
          clearCurrentLine();
          i += 1;
          continue;
        }
        if (code === 0x08) {
          backspace();
          i += 1;
          continue;
        }
        if (code === 0x09) {
          appendText(" ".repeat(8 - (lineText.length % 8)));
          i += 1;
          continue;
        }
        if (code === 0x07 || code === 0x7f || code < 0x20) {
          i += 1;
          continue;
        }
        let j = i + 1;
        while (j < input.length) {
          const next = input.charCodeAt(j);
          if (next === 0x1b || next < 0x20 || next === 0x7f) break;
          j += 1;
        }
        appendText(input.slice(i, j));
        i = j;
      }
      if (carry.length > 4096) carry = "";
      if (follow) scheduleScroll();
    }

    reset();
    return { write, reset, clear: clearAll, scrollToBottom, isFollowing: () => follow };
  }

  function getClientId() {
    let id = "";
    try {
      id = window.sessionStorage.getItem(CLIENT_KEY) || "";
    } catch (error) {
      id = "";
    }
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      const random =
        window.crypto && typeof window.crypto.randomUUID === "function"
          ? window.crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      id = random.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
      try {
        window.sessionStorage.setItem(CLIENT_KEY, id);
      } catch (error) {
      }
    }
    return id;
  }

  const sleep = ms => new Promise(resolve => window.setTimeout(resolve, ms));

  function create(deps) {
    const api = deps.api;
    const apiSSE = deps.apiSSE;
    const toast = deps.toast || (() => {});
    const handleError = deps.handleError || (() => {});
    const getAllowWrite = deps.getAllowWrite || (() => true);
    const clientId = getClientId();
    const sessions = new Map();
    const els = {};
    let started = false;
    let allowWrite = true;
    let activeId = "";
    let stopped = true;
    let controller = null;
    let loopPromise = null;
    let connected = false;
    let visibilityBound = false;
    let measureCanvas = null;

    function init() {
      els.shell = document.querySelector("#termShell");
      els.tabs = document.querySelector("#termTabs");
      els.panes = document.querySelector("#termPanes");
      els.empty = document.querySelector("#termEmpty");
      els.newBtn = document.querySelector("#termNewBtn");
      els.conn = document.querySelector("#termConn");
      els.connText = document.querySelector("#termConnText");
      if (!els.tabs || !els.panes) return false;

      els.newBtn?.addEventListener("click", () => createSession());

      els.tabs.addEventListener("click", event => {
        const close = event.target.closest("[data-term-close]");
        if (close) {
          event.stopPropagation();
          closeSession(close.dataset.termClose);
          return;
        }
        const tab = event.target.closest(".term-tab");
        if (tab) activate(tab.dataset.session, { focus: true });
      });

      els.panes.addEventListener("click", event => {
        const navKey = event.target.closest("[data-term-key]");
        if (navKey) {
          const pane = navKey.closest(".term-pane");
          const record = pane ? sessions.get(pane.dataset.session) : null;
          if (record) sendNavKey(record, navKey.dataset.termKey);
          return;
        }
        const action = event.target.closest("[data-term-action]");
        const pane = event.target.closest(".term-pane");
        if (action && pane) {
          doAction(pane.dataset.session, action.dataset.termAction);
          return;
        }
        if (!pane) return;
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) return;
        activate(pane.dataset.session, { focus: true });
      });

      els.panes.addEventListener("mousedown", event => {
        if (event.target.closest("[data-term-key]")) event.preventDefault();
      });

      els.panes.addEventListener("keydown", event => {
        const pane = event.target.closest(".term-pane");
        if (!pane) return;
        const record = sessions.get(pane.dataset.session);
        if (!record || event.target !== record.input) return;
        onKeyDown(record, event);
      });
      els.panes.addEventListener("compositionstart", event => {
        const record = findRecord(event.target);
        if (record) record.composing = true;
      });
      els.panes.addEventListener("compositionend", event => {
        const record = findRecord(event.target);
        if (!record) return;
        record.composing = false;
        if (record.input !== event.target) return;
        const text = event.data || "";
        record.input.value = "";
        record.skipInput = true;
        record.compositionEndAt = Date.now();
        window.setTimeout(() => {
          record.skipInput = false;
        }, 0);
        if (text) queueInput(record, text, true);
      });
      els.panes.addEventListener("input", event => {
        const record = findRecord(event.target);
        if (!record || record.input !== event.target) return;
        const value = record.input.value;
        record.input.value = "";
        if (record.composing || record.skipInput) return;
        if (value) queueInput(record, value, true);
      });
      els.panes.addEventListener("paste", event => {
        const record = findRecord(event.target);
        if (!record || record.input !== event.target) return;
        const data = event.clipboardData || window.clipboardData;
        const text = data ? data.getData("text") : "";
        event.preventDefault();
        record.input.value = "";
        if (!text) return;
        queueInput(record, text.replace(/\r\n/g, "\r"), true);
      });

      if (!visibilityBound) {
        visibilityBound = true;
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "hidden") return;
          for (const record of sessions.values()) flushSessionOutput(record);
        });
      }
      return true;
    }

    function findRecord(target) {
      const pane = target.closest?.(".term-pane");
      if (!pane) return null;
      return sessions.get(pane.dataset.session) || null;
    }

    function setWriteAllowed(value) {
      allowWrite = !!value;
      if (!started) return;
      if (els.newBtn) els.newBtn.hidden = !allowWrite;
      els.empty?.classList.toggle("readonly", !allowWrite);
      const hint = els.empty?.querySelector("span");
      if (hint) hint.textContent = allowWrite ? "新建后即可直接执行命令" : "当前为只读模式，无法使用终端";
      for (const record of sessions.values()) {
        if (record.input) record.input.disabled = !allowWrite || isExited(record);
      }
      if (!allowWrite) {
        stopStream();
        setConn("off", "只读模式");
      }
    }

    function isExited(record) {
      return ["exited", "error", "closed"].includes(record.info.status);
    }

    function setConn(kind, text) {
      if (!els.conn) return;
      connected = kind === "on";
      els.conn.classList.remove("on", "warn", "off");
      els.conn.classList.add(kind === "on" ? "on" : kind === "connecting" || kind === "lost" ? "warn" : "off");
      const label =
        text ||
        {
          on: "已连接",
          connecting: "正在连接…",
          lost: "连接已断开，正在重连…",
          off: "未连接",
        }[kind] ||
        "";
      if (els.connText) els.connText.textContent = label;
    }

    function syncView() {
      const has = sessions.size > 0;
      if (els.shell) els.shell.hidden = !has;
      if (els.empty) els.empty.hidden = has;
      if (els.panes) els.panes.hidden = !has;
      for (const record of sessions.values()) {
        if (!record.pane) continue;
        record.pane.hidden = record.info.id !== activeId;
        record.pane.classList.toggle("active", record.info.id === activeId);
      }
      renderTabs();
    }

    function renderTabs() {
      if (!els.tabs) return;
      els.tabs.textContent = "";
      for (const record of sessions.values()) {
        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = "term-tab";
        tab.dataset.session = record.info.id;
        if (record.info.id === activeId) tab.classList.add("active");
        if (isExited(record)) tab.classList.add("exited");

        const dot = document.createElement("span");
        dot.className = "term-tab-dot";
        const name = document.createElement("span");
        name.className = "term-tab-name";
        name.textContent = record.info.name;
        const close = document.createElement("span");
        close.className = "term-tab-close";
        close.dataset.termClose = record.info.id;
        close.title = "关闭终端";
        close.innerHTML = svgIcon("close");
        tab.append(dot, name, close);
        els.tabs.appendChild(tab);
      }
    }

    function flushSessionOutput(record) {
      if (!record) return;
      if (record.frame) {
        window.cancelAnimationFrame(record.frame);
        record.frame = 0;
      }
      const text = record.pending;
      record.pending = "";
      if (text && record.screen) record.screen.write(text);
    }

    function appendRaw(record, text) {
      record.raw += text;
      if (record.raw.length <= RAW_TAIL) return;
      let cut = record.raw.length - RAW_TAIL;
      const code = record.raw.charCodeAt(cut);
      if (code >= 0xdc00 && code <= 0xdfff) cut += 1;
      record.raw = record.raw.slice(cut);
    }

    function queueOutput(record, text) {
      if (!record || !record.screen || !text) return;
      appendRaw(record, text);
      record.pending += text;
      if (record.pending.length >= MAX_PENDING) {
        flushSessionOutput(record);
        return;
      }
      if (record.frame) return;
      if (document.visibilityState === "hidden") return;
      record.frame = window.requestAnimationFrame(() => {
        record.frame = 0;
        flushSessionOutput(record);
      });
    }

    function suffixPrefixOverlap(prev, next) {
      const max = Math.min(prev.length, next.length);
      if (!max) return 0;
      const pattern = next.length > max ? next.slice(0, max) : next;
      const text = prev.length > max ? prev.slice(-max) : prev;
      const table = new Uint32Array(pattern.length);
      for (let i = 1, k = 0; i < pattern.length; i++) {
        while (k && pattern[i] !== pattern[k]) k = table[k - 1];
        if (pattern[i] === pattern[k]) k += 1;
        table[i] = k;
      }
      let k = 0;
      for (let i = 0; i < text.length; i++) {
        while (k && text[i] !== pattern[k]) k = table[k - 1];
        if (text[i] === pattern[k]) k += 1;
        if (k === pattern.length) {
          if (i === text.length - 1) return k;
          k = table[k - 1];
        }
      }
      return k;
    }

    function syncHistory(record, history) {
      const text = history || "";
      if (!record.historyReady) {
        playHistory(record, text);
        return;
      }
      if (!text) return;
      const overlap = suffixPrefixOverlap(record.raw, text);
      if (overlap >= text.length) return;
      if (overlap >= 64 || (overlap > 0 && overlap === record.raw.length)) {
        queueOutput(record, text.slice(overlap));
        return;
      }
      playHistory(record, text);
    }

    function playHistory(record, history) {
      const text = history || "";
      const following = record.screen.isFollowing();
      record.pending = "";
      if (record.frame) {
        window.cancelAnimationFrame(record.frame);
        record.frame = 0;
      }
      record.screen.reset();
      if (text) record.screen.write(text);
      if (following) record.screen.scrollToBottom();
      record.raw = text.length > RAW_TAIL ? text.slice(-RAW_TAIL) : text;
      record.historyReady = true;
      record.pipeNotice = false;
      applyRecordState(record);
    }

    function applyRecordState(record) {
      record.pane.classList.toggle("exited", isExited(record));
      if (record.input) record.input.disabled = isExited(record) || !allowWrite;
      if (!record.info.pty && !record.pipeNotice) {
        record.pipeNotice = true;
        record.screen.write("\x1b[38;5;245m[管道模式] 当前未启用伪终端，Ctrl+C 可能无效\x1b[0m\r\n");
      }
    }

    function ensurePane(record) {
      if (record.pane) return record;
      const pane = document.createElement("div");
      pane.className = "term-pane";
      pane.dataset.session = record.info.id;
      pane.hidden = true;
      const toolbar = document.createElement("div");
      toolbar.className = "term-toolbar";
      toolbar.innerHTML = `
        <button type="button" class="term-tool" data-term-action="interrupt" title="向当前命令发送 Ctrl+C">中断</button>
        <button type="button" class="term-tool" data-term-action="clear" title="清空屏幕内容">清屏</button>
        <button type="button" class="term-tool danger" data-term-action="close" title="结束进程并关闭该终端">关闭</button>
      `;
      const view = document.createElement("div");
      view.className = "term-view";
      const keys = document.createElement("div");
      keys.className = "term-keys";
      for (const item of NAV_KEYS) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "term-key";
        btn.dataset.termKey = item.key;
        btn.textContent = item.label;
        btn.title = item.title;
        keys.appendChild(btn);
      }
      const input = document.createElement("textarea");
      input.className = "term-input";
      input.autocomplete = "off";
      input.autocapitalize = "off";
      input.spellcheck = false;
      input.setAttribute("aria-label", "终端输入");
      pane.append(toolbar, view, keys, input);
      els.panes.appendChild(pane);
      record.pane = pane;
      record.view = view;
      record.keys = keys;
      record.input = input;
      record.screen = createScreen(view);
      record.inputSeq = 0;
      record.inputBlockedUntil = 0;
      record.buffer = "";
      record.timer = null;
      record.composing = false;
      record.skipInput = false;
      record.compositionEndAt = 0;
      record.pipeNotice = false;
      record.sticky = { ctrl: false, alt: false };
      record.pending = "";
      record.frame = 0;
      record.raw = "";
      record.historyReady = false;
      record.sizeKey = "";
      record.resizeTimer = 0;
      record.resizeObserver = null;
      if (typeof window.ResizeObserver === "function") {
        record.resizeObserver = new window.ResizeObserver(() => scheduleResize(record));
        record.resizeObserver.observe(view);
      }
      applyRecordState(record);
      return record;
    }

    function measureTerminalSize(record) {
      const view = record.view;
      if (!view || !view.clientWidth || !view.clientHeight) return null;
      const style = window.getComputedStyle(view);
      const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
      const fontSize = parseFloat(style.fontSize) || 12.5;
      const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.62;
      if (!measureCanvas) measureCanvas = document.createElement("canvas");
      const ctx = measureCanvas.getContext("2d");
      if (!ctx) return null;
      ctx.font = `${style.fontStyle || "normal"} ${style.fontWeight || "400"} ${fontSize}px ${style.fontFamily || "monospace"}`;
      const charWidth = ctx.measureText("MMMMMMMMMM").width / 10 || fontSize * 0.6;
      const cols = Math.max(20, Math.min(400, Math.floor((view.clientWidth - padX) / charWidth)));
      const rows = Math.max(6, Math.min(200, Math.floor((view.clientHeight - padY) / lineHeight)));
      return { cols, rows };
    }

    function scheduleResize(record) {
      if (record.resizeTimer) window.clearTimeout(record.resizeTimer);
      record.resizeTimer = window.setTimeout(() => {
        record.resizeTimer = 0;
        sendResize(record);
      }, RESIZE_DEBOUNCE);
    }

    function sendResize(record) {
      if (!record || !sessions.has(record.info.id) || isExited(record)) return;
      const size = measureTerminalSize(record);
      if (!size) return;
      const key = `${size.cols}x${size.rows}`;
      if (key === record.sizeKey) return;
      record.sizeKey = key;
      api(`/terminal/sessions/${record.info.id}/resize`, {
        method: "POST",
        body: { clientId, cols: size.cols, rows: size.rows },
      }).catch(() => {
        record.sizeKey = "";
      });
    }

    function upsertSession(info, options) {
      const opts = options || {};
      let record = sessions.get(info.id);
      if (!record) {
        record = { info: Object.assign({}, info) };
        sessions.set(info.id, record);
        ensurePane(record);
        record.inputSeq = Number.isInteger(info.inputSeq) ? info.inputSeq : 0;
        applyRecordState(record);
        if (opts.history !== undefined) syncHistory(record, opts.history);
        else record.historyReady = true;
        if (!activeId) activate(info.id);
        syncView();
        return record;
      }
      const previousName = record.info.name;
      record.info = Object.assign({}, record.info, info);
      if (previousName !== record.info.name) renderTabs();
      applyRecordState(record);
      if (opts.history !== undefined) syncHistory(record, opts.history);
      return record;
    }

    function removeRecord(id, reason) {
      const record = sessions.get(id);
      if (!record) return;
      if (record.timer) window.clearTimeout(record.timer);
      if (record.resizeTimer) window.clearTimeout(record.resizeTimer);
      if (record.frame) window.cancelAnimationFrame(record.frame);
      record.resizeObserver?.disconnect();
      record.pending = "";
      record.screen = null;
      if (record.pane) record.pane.remove();
      sessions.delete(id);
      if (activeId === id) {
        activeId = sessions.keys().next().value || "";
        const next = sessions.get(activeId);
        if (next?.input) next.input.focus({ preventScroll: true });
      }
      syncView();
      if (reason === "idle") toast("终端因长时间无操作已自动关闭", "info");
      else if (reason === "detached") toast("终端已随页面断开自动关闭", "info");
    }

    function activate(id, options) {
      if (!sessions.has(id)) return;
      activeId = id;
      for (const record of sessions.values()) {
        if (record.pane) record.pane.hidden = record.info.id !== id;
        if (record.info.id === id) record.pane?.classList.add("active");
        else record.pane?.classList.remove("active");
      }
      renderTabs();
      const record = sessions.get(id);
      if (options?.focus && record && !isExited(record) && allowWrite) {
        record.input?.focus({ preventScroll: true });
      }
    }

    function queueInput(record, data, immediate) {
      if (!data || !record || isExited(record)) return;
      if (record.info.echo) {
        const printable = String(data)
          .replace(/\x1b\[[0-9;?]*[@-~]/g, "")
          .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
          .replace(/\r/g, "\r\n");
        if (printable) record.screen.write(printable);
      }
      record.buffer += data;
      if (immediate) return flushInput(record);
      if (!record.timer) {
        record.timer = window.setTimeout(() => {
          record.timer = null;
          flushInput(record);
        }, FLUSH_DELAY);
      }
    }

    function splitInput(data, limit) {
      if (data.length * 3 <= limit) return [data];
      const encoder = new TextEncoder();
      const chunks = [];
      let current = "";
      let bytes = 0;
      for (const ch of data) {
        const size = encoder.encode(ch).length;
        if (bytes + size > limit && current) {
          chunks.push(current);
          current = "";
          bytes = 0;
        }
        current += ch;
        bytes += size;
      }
      if (current) chunks.push(current);
      return chunks;
    }

    function flushInput(record) {
      if (record.timer) {
        window.clearTimeout(record.timer);
        record.timer = null;
      }
      const data = record.buffer;
      record.buffer = "";
      if (!data) return;
      if (record.inputBlockedUntil > Date.now()) return;
      let failed = false;
      for (const chunk of splitInput(data, INPUT_CHUNK_BYTES)) {
        const seq = ++record.inputSeq;
        api(`/terminal/sessions/${record.info.id}/input`, {
          method: "POST",
          body: { clientId, data: chunk, seq },
        }).catch(error => {
          if (isExited(record) || failed) return;
          failed = true;
          record.inputBlockedUntil = Date.now() + 1500;
          handleError(error);
        });
      }
    }

    function sendControl(record, data) {
      queueInput(record, data, true);
    }

    const CSI_MOD = { left: "D", right: "C", up: "A", down: "B", home: "H", end: "F" };
    const TILDE_MOD = { ins: 2, del: 3, pgup: 5, pgdn: 6 };

    function navData(item, ctrl, alt) {
      if (!ctrl && !alt) return item.data;
      if (item.key === "esc") return alt ? "\x1b\x1b" : item.data;
      if (item.key === "tab") return alt ? "\x1b\t" : item.data;
      const n = ctrl && alt ? 7 : ctrl ? 5 : 3;
      if (CSI_MOD[item.key]) return `\x1b[1;${n}${CSI_MOD[item.key]}`;
      if (TILDE_MOD[item.key]) return `\x1b[${TILDE_MOD[item.key]};${n}~`;
      return item.data;
    }

    function renderKeyState(record) {
      if (!record.keys) return;
      const sticky = record.sticky || {};
      for (const btn of record.keys.querySelectorAll("[data-term-key]")) {
        const key = btn.dataset.termKey;
        btn.classList.toggle("active", !!(key === "ctrl" && sticky.ctrl) || !!(key === "alt" && sticky.alt));
      }
    }

    function sendNavKey(record, name) {
      const item = NAV_KEYS.find(entry => entry.key === name);
      if (!item) return;
      record.sticky = record.sticky || { ctrl: false, alt: false };
      if (item.modifier) {
        record.sticky[item.modifier] = !record.sticky[item.modifier];
        renderKeyState(record);
        record.input?.focus({ preventScroll: true });
        return;
      }
      const data = navData(item, record.sticky.ctrl, record.sticky.alt);
      record.sticky.ctrl = false;
      record.sticky.alt = false;
      renderKeyState(record);
      if (isExited(record)) return;
      queueInput(record, data, data.length > 1 || data.charCodeAt(0) < 0x20);
      record.input?.focus({ preventScroll: true });
    }

    function onKeyDown(record, event) {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Process" || isExited(record)) return;
      if (record.compositionEndAt && event.key === "Enter" && Date.now() - record.compositionEndAt < 80) {
        event.preventDefault();
        return;
      }
      if (event.metaKey) return;
      const key = event.key;
      const lower = key.toLowerCase();
      const hasSelection = (() => {
        const selection = window.getSelection();
        return !!selection && !selection.isCollapsed;
      })();

      if (event.ctrlKey && event.shiftKey && ["c", "v", "x", "a"].includes(lower)) return;
      if (event.ctrlKey && !event.shiftKey && !event.altKey) {
        if (lower === "c" && hasSelection) return;
        if (lower === "v") return;
      }
      if (event.shiftKey && key === "Insert") return;

      let data = null;
      const map = {
        Enter: "\r",
        Backspace: "\x7f",
        Delete: "\x1b[3~",
        Tab: "\t",
        Escape: "\x1b",
        ArrowUp: "\x1b[A",
        ArrowDown: "\x1b[B",
        ArrowRight: "\x1b[C",
        ArrowLeft: "\x1b[D",
        Home: "\x1b[H",
        End: "\x1b[F",
        PageUp: "\x1b[5~",
        PageDown: "\x1b[6~",
        Insert: "\x1b[2~",
      };

      if (event.ctrlKey && !event.altKey && !event.shiftKey) {
        if (/^[a-z]$/.test(lower)) data = String.fromCharCode(lower.charCodeAt(0) - 96);
        else if (key === "[") data = "\x1b";
        else if (key === "\\") data = "\x1c";
        else if (key === "]") data = "\x1d";
        else if (key === " " || key === "@") data = "\x00";
      }
      if (data === null) {
        if (event.altKey && key.length === 1) data = `\x1b${key}`;
        else if (map[key] !== undefined) data = map[key];
        else if (!event.ctrlKey && !event.altKey && key.length === 1) data = key;
      }
      if (data === null) return;
      event.preventDefault();
      const immediate = !(data.length === 1 && data.charCodeAt(0) >= 0x20);
      queueInput(record, data, immediate);
    }

    function doAction(id, action) {
      const record = sessions.get(id);
      if (!record) return;
      if (action === "interrupt") {
        sendControl(record, "\x03");
        record.input?.focus({ preventScroll: true });
        return;
      }
      if (action === "clear") {
        flushSessionOutput(record);
        record.screen.clear();
        record.input?.focus({ preventScroll: true });
        return;
      }
      if (action === "close") closeSession(id);
    }

    async function createSession() {
      if (!allowWrite) {
        toast("当前为只读模式，无法新建终端", "info");
        return;
      }
      if (!started) {
        started = true;
        init();
        setWriteAllowed(getAllowWrite());
      }
      if (els.newBtn) els.newBtn.disabled = true;
      if (els.tabAdd) els.tabAdd.disabled = true;
      try {
        const data = await api("/terminal/sessions", { method: "POST", body: { clientId } });
        const record = upsertSession(data.session);
        activate(record.info.id, { focus: true });
      } catch (error) {
        handleError(error);
      } finally {
        if (els.newBtn) els.newBtn.disabled = !allowWrite;
        if (els.tabAdd) els.tabAdd.disabled = !allowWrite;
      }
    }

    async function closeSession(id) {
      const record = sessions.get(id);
      if (!record) return;
      try {
        await api(`/terminal/sessions/${id}/close`, { method: "POST", body: { clientId } });
      } catch (error) {
        if (sessions.has(id) && error.status !== 404) {
          handleError(error);
          return;
        }
      }
      removeRecord(id, "user");
    }

    function handleExit(data) {
      const record = sessions.get(data.sessionId);
      if (!record) return;
      flushSessionOutput(record);
      record.info.status = "exited";
      record.info.exitCode = data.code;
      record.info.signal = data.signal;
      const detail = data.message
        ? `：${data.message}`
        : data.code === null || data.code === undefined
          ? ""
          : `，退出码 ${data.code}`;
      const suffix = data.signal ? `（${data.signal}）` : "";
      record.screen.write(`\r\n\x1b[38;5;245m[进程已退出${detail}${suffix}]\x1b[0m\r\n`);
      applyRecordState(record);
      renderTabs();
    }

    function handleClosed(data) {
      removeRecord(data.sessionId, data.reason);
    }

    function applyHello(data) {
      setConn("on");
      const incoming = Array.isArray(data.sessions) ? data.sessions : [];
      const seen = new Set();
      for (const snapshot of incoming) {
        seen.add(snapshot.id);
        upsertSession(snapshot, { history: snapshot.history || "" });
      }
      for (const id of [...sessions.keys()]) if (!seen.has(id)) removeRecord(id, "lost");
      if (!activeId && sessions.size) {
        const first = sessions.keys().next().value;
        activate(first);
      } else if (activeId && !sessions.has(activeId)) {
        activeId = sessions.keys().next().value || "";
        syncView();
      }
      syncView();
      const record = sessions.get(activeId);
      if (record?.input && document.visibilityState !== "hidden" && record.pane?.offsetParent !== null) {
        record.input.focus({ preventScroll: true });
      }
    }

    function stopStream() {
      stopped = true;
      connected = false;
      if (controller) {
        try {
          controller.abort();
        } catch (error) {
        }
        controller = null;
      }
    }

    function connect() {
      if (loopPromise || !allowWrite) return loopPromise;
      stopped = false;
      let first = true;
      const loop = async () => {
        let delay = 1000;
        while (!stopped) {
          if (!allowWrite) {
            setConn("off", "只读模式");
            return;
          }
          setConn(connected ? "lost" : "connecting");
          controller = new AbortController();
          const signal = controller.signal;
          let aliveAt = Date.now();
          let watchdog = 0;
          const touch = handler => data => {
            aliveAt = Date.now();
            handler(data);
          };
          try {
            watchdog = window.setInterval(() => {
              if (Date.now() - aliveAt <= PING_TIMEOUT) return;
              try {
                controller?.abort();
              } catch (error) {
              }
            }, 10000);
            await apiSSE(
              "/terminal/stream",
              { clientId },
              {
                hello: touch(applyHello),
                created: touch(data => {
                  if (data.session) upsertSession(data.session);
                }),
                output: touch(data => {
                  const record = sessions.get(data.sessionId);
                  if (record) queueOutput(record, data.data);
                }),
                update: touch(data => {
                  const record = sessions.get(data.sessionId);
                  if (!record) return;
                  record.info = Object.assign({}, record.info, data);
                  applyRecordState(record);
                }),
                exit: touch(handleExit),
                closed: touch(handleClosed),
                ping: touch(() => {}),
                replaced: () => {
                  stopped = true;
                  setConn("off", "已在其他标签页接管");
                },
              },
              signal,
            );
          } catch (error) {
            if (stopped) return;
            setConn("lost");
            if (first) console.warn("终端连接失败", error);
          } finally {
            if (watchdog) window.clearInterval(watchdog);
          }
          controller = null;
          first = false;
          if (stopped) return;
          await sleep(delay);
          delay = Math.min(Math.round(delay * 1.6), 8000);
        }
      };
      loopPromise = loop().finally(() => {
        loopPromise = null;
      });
      return loopPromise;
    }

    function open() {
      if (!started) {
        started = true;
        if (!init()) return;
      }
      setWriteAllowed(getAllowWrite());
      if (!allowWrite) {
        setConn("off", "只读模式");
        return;
      }
      connect();
      const record = sessions.get(activeId);
      if (record?.input && !isExited(record)) record.input.focus({ preventScroll: true });
    }

    return {
      open,
      setWriteAllowed,
    };
  }

  window.YunzaiTerminal = { create };
})();
