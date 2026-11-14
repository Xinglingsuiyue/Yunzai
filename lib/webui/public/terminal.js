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
    { key: "esc", label: "ESC", title: "Esc" },
    { key: "tab", label: "⇥", title: "Tab" },
    { key: "ctrl", label: "CTRL", modifier: "ctrl", title: "粘滞 Ctrl：下一次按键生效" },
    { key: "alt", label: "ALT", modifier: "alt", title: "粘滞 Alt：下一次按键生效" },
    { key: "minus", label: "—", char: "-", title: "减号" },
    { key: "up", label: "↑", title: "上" },
    { key: "enter", label: "↵", title: "回车" },
    { key: "ins", label: "INS", title: "Insert" },
    { key: "end", label: "END", title: "End" },
    { key: "shift", label: "SHIFT", modifier: "shift", title: "粘滞 Shift：下一次按键生效" },
    { key: "colon", label: ":", char: ":", title: "冒号" },
    { key: "left", label: "←", title: "左" },
    { key: "down", label: "↓", title: "下" },
    { key: "right", label: "→", title: "右" },
  ];

  const KEY_DATA = {
    esc: "\x1b", tab: "\t", enter: "\r", backspace: "\x7f",
    left: "\x1b[D", right: "\x1b[C", up: "\x1b[A", down: "\x1b[B",
    home: "\x1b[H", end: "\x1b[F", pgup: "\x1b[5~", pgdn: "\x1b[6~", ins: "\x1b[2~", del: "\x1b[3~",
    f1: "\x1bOP", f2: "\x1bOQ", f3: "\x1bOR", f4: "\x1bOS",
    f5: "\x1b[15~", f6: "\x1b[17~", f7: "\x1b[18~", f8: "\x1b[19~",
    f9: "\x1b[20~", f10: "\x1b[21~", f11: "\x1b[23~", f12: "\x1b[24~",
  };

  const EVENT_KEY = {
    Escape: "esc", Tab: "tab", Enter: "enter", Backspace: "backspace",
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
    Home: "home", End: "end", PageUp: "pgup", PageDown: "pgdn", Insert: "ins", Delete: "del",
    F1: "f1", F2: "f2", F3: "f3", F4: "f4", F5: "f5", F6: "f6",
    F7: "f7", F8: "f8", F9: "f9", F10: "f10", F11: "f11", F12: "f12",
  };

  const KBD_NAV = [
    { key: "home", label: "Home" },
    { key: "end", label: "End" },
    { key: "pgup", label: "PgUp" },
    { key: "pgdn", label: "PgDn" },
    { key: "ins", label: "Ins" },
    { key: "del", label: "Del" },
    { key: "backspace", label: "⌫" },
    { char: " ", label: "Space", wide: true },
  ];

  const charKeys = text => [...text].map(ch => ({ char: ch, label: ch }));
  const fnKeys = Array.from({ length: 12 }, (_, i) => ({ key: `f${i + 1}`, label: `F${i + 1}` }));

  const KBD_ROWS = [
    fnKeys.slice(0, 6),
    fnKeys.slice(6),
    KBD_NAV,
    charKeys("1234567890"),
    charKeys("qwertyuiop"),
    charKeys("asdfghjkl"),
    charKeys("zxcvbnm"),
    charKeys("-=[];',./\\"),
  ];

  const TERM_THEME = {
    background: "#0e1117",
    foreground: "#d7dae0",
    cursor: "#7cc4ff",
    cursorAccent: "#0e1117",
    selectionBackground: "rgba(124, 196, 255, 0.3)",
    black: "#3b4048",
    red: "#e06c75",
    green: "#98c379",
    yellow: "#e5c07b",
    blue: "#61afef",
    magenta: "#c678dd",
    cyan: "#56b6c2",
    white: "#d7dae0",
    brightBlack: "#5c6370",
    brightRed: "#ff7b86",
    brightGreen: "#b5e890",
    brightYellow: "#ffd68a",
    brightBlue: "#7cc4ff",
    brightMagenta: "#e09bff",
    brightCyan: "#73e0e0",
    brightWhite: "#ffffff",
  };

  const svgIcon = name =>
    `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

  function createScreen(view) {
    const style = window.getComputedStyle(view);
    const term = new window.Terminal({
      cols: 120,
      rows: 32,
      scrollback: MAX_LINES,
      disableStdin: true,
      cursorBlink: true,
      convertEol: true,
      fontFamily: style.fontFamily || "monospace",
      fontSize: parseFloat(style.fontSize) || 12.5,
      lineHeight: 1.35,
      theme: TERM_THEME,
    });
    const fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(view);
    view.classList.add("xterm-host");

    function measure() {
      fit.fit();
      const cols = Math.max(20, Math.min(400, term.cols));
      const rows = Math.max(6, Math.min(200, term.rows));
      if (cols !== term.cols || rows !== term.rows) term.resize(cols, rows);
      return { cols, rows };
    }

    return {
      term,
      write: text => term.write(text),
      reset: () => term.reset(),
      clear: () => term.clear(),
      scrollToBottom: () => term.scrollToBottom(),
      refresh: () => term.refresh(0, term.rows - 1),
      dispose: () => term.dispose(),
      measure,
      isFollowing: () => term.buffer.active.viewportY >= term.buffer.active.baseY,
    };
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

    function init() {
      els.shell = document.querySelector("#termShell");
      els.tabs = document.querySelector("#termTabs");
      els.panes = document.querySelector("#termPanes");
      els.empty = document.querySelector("#termEmpty");
      els.newBtn = document.querySelector("#termNewBtn");
      els.kbdBtn = document.querySelector("#termKbdBtn");
      els.conn = document.querySelector("#termConn");
      els.connText = document.querySelector("#termConnText");
      if (!els.tabs || !els.panes) return false;

      els.newBtn?.addEventListener("click", () => createSession());
      els.kbdBtn?.addEventListener("click", () => toggleKbd());

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
        const kbdKey = event.target.closest("[data-term-kbd]");
        if (kbdKey) {
          const pane = kbdKey.closest(".term-pane");
          const record = pane ? sessions.get(pane.dataset.session) : null;
          if (record) sendKbdKey(record, kbdKey.dataset.termKbd);
          return;
        }
        if (event.target.closest("[data-term-kbd-close]")) {
          const pane = event.target.closest(".term-pane");
          const record = pane ? sessions.get(pane.dataset.session) : null;
          if (record) setKbdOpen(record, false);
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
        if (event.target.closest("[data-term-key], [data-term-kbd]")) event.preventDefault();
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
        if (!text) return;
        clearSticky(record);
        queueInput(record, text, true);
      });
      els.panes.addEventListener("input", event => {
        const record = findRecord(event.target);
        if (!record || record.input !== event.target) return;
        const value = record.input.value;
        record.input.value = "";
        if (record.composing || record.skipInput) return;
        if (value) queueInput(record, applySticky(record, value), true);
      });
      els.panes.addEventListener("paste", event => {
        const record = findRecord(event.target);
        if (!record || record.input !== event.target) return;
        const data = event.clipboardData || window.clipboardData;
        const text = data ? data.getData("text") : "";
        event.preventDefault();
        record.input.value = "";
        if (!text) return;
        const body = text.replace(/\r\n/g, "\r");
        const bracketed = record.screen?.term?.modes?.bracketedPasteMode === true;
        queueInput(record, bracketed ? `\x1b[200~${body}\x1b[201~` : body, true);
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
      if (els.kbdBtn) els.kbdBtn.hidden = !allowWrite;
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
      const kbd = document.createElement("div");
      kbd.className = "term-kbd";
      kbd.hidden = true;
      const kbdHead = document.createElement("div");
      kbdHead.className = "term-kbd-head";
      kbdHead.innerHTML = `<span>软键盘</span><button type="button" class="term-kbd-close" data-term-kbd-close title="收起软键盘">×</button>`;
      kbd.appendChild(kbdHead);
      for (const row of KBD_ROWS) {
        const line = document.createElement("div");
        line.className = "term-kbd-row";
        for (const item of row) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "term-kbd-key";
          if (item.wide) btn.classList.add("wide");
          btn.dataset.termKbd = item.key ? `k:${item.key}` : `c:${item.char}`;
          btn.textContent = item.label;
          line.appendChild(btn);
        }
        kbd.appendChild(line);
      }
      const input = document.createElement("textarea");
      input.className = "term-input";
      input.autocomplete = "off";
      input.autocapitalize = "off";
      input.spellcheck = false;
      input.setAttribute("aria-label", "终端输入");
      pane.append(toolbar, view, kbd, keys, input);
      els.panes.appendChild(pane);
      record.pane = pane;
      record.view = view;
      record.kbd = kbd;
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
      record.sticky = { ctrl: false, alt: false, shift: false };
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
      if (!view || !view.clientWidth || !view.clientHeight || !record.screen) return null;
      return record.screen.measure();
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
      record.screen?.dispose();
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
      if (els.kbdBtn) {
        els.kbdBtn.classList.toggle("active", !!record?.kbd && !record.kbd.hidden);
        els.kbdBtn.setAttribute("aria-pressed", record?.kbd && !record.kbd.hidden ? "true" : "false");
      }
      if (record?.screen) {
        window.requestAnimationFrame(() => {
          record.screen.refresh();
          scheduleResize(record);
        });
      }
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
    const SS3_FN = { f1: "P", f2: "Q", f3: "R", f4: "S" };
    const TILDE_FN = { f5: 15, f6: 17, f7: 18, f8: 19, f9: 20, f10: 21, f11: 23, f12: 24 };
    const SHIFT_MAP = {
      "-": "_", "=": "+", "[": "{", "]": "}", "\\": "|", ";": ":", "'": "\"",
      ",": "<", ".": ">", "/": "?", "`": "~",
      "1": "!", "2": "@", "3": "#", "4": "$", "5": "%", "6": "^", "7": "&", "8": "*", "9": "(", "0": ")",
    };
    const CTRL_MAP = { "@": "\x00", "[": "\x1b", "\\": "\x1c", "]": "\x1d", "^": "\x1e", "_": "\x1f", "?": "\x7f", " ": "\x00" };

    function shiftChar(ch) {
      if (/^[a-z]$/.test(ch)) return ch.toUpperCase();
      return SHIFT_MAP[ch] || ch;
    }

    function ctrlChar(ch) {
      if (/^[a-z]$/i.test(ch)) return String.fromCharCode(ch.toLowerCase().charCodeAt(0) - 96);
      return CTRL_MAP[ch] || null;
    }

    function clearSticky(record) {
      record.sticky = { ctrl: false, alt: false, shift: false };
      renderKeyState(record);
    }

    function applySticky(record, text) {
      const sticky = record.sticky || {};
      if (!sticky.ctrl && !sticky.alt && !sticky.shift) return text;
      const chars = [...text];
      if (!chars.length) return text;
      let first = chars[0];
      if (sticky.shift) first = shiftChar(first);
      if (sticky.ctrl) first = ctrlChar(first) || first;
      if (sticky.alt) first = `\x1b${first}`;
      clearSticky(record);
      return first + chars.slice(1).join("");
    }

    function navData(item, mods, appCursor) {
      const sticky = mods || {};
      const ctrl = !!sticky.ctrl;
      const alt = !!sticky.alt;
      const shift = !!sticky.shift;
      if (item.char) {
        let ch = item.char;
        if (shift) ch = shiftChar(ch);
        if (ctrl) ch = ctrlChar(ch) || ch;
        if (alt) ch = `\x1b${ch}`;
        return ch;
      }
      const base = item.data !== undefined ? item.data : KEY_DATA[item.key] || "";
      if (!ctrl && !alt && !shift) {

        if (appCursor && CSI_MOD[item.key]) return `\x1bO${CSI_MOD[item.key]}`;
        return base;
      }
      if (item.key === "esc") return alt ? "\x1b\x1b" : base;
      if (item.key === "tab") return shift ? "\x1b[Z" : alt ? `\x1b${base}` : base;
      if (item.key === "enter") return alt ? "\x1b\r" : base;
      if (item.key === "backspace") return alt ? "\x1b\x7f" : ctrl ? "\x08" : base;
      const n = 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0);
      if (SS3_FN[item.key]) return `\x1b[1;${n}${SS3_FN[item.key]}`;
      if (TILDE_FN[item.key]) return `\x1b[${TILDE_FN[item.key]};${n}~`;
      if (CSI_MOD[item.key]) return `\x1b[1;${n}${CSI_MOD[item.key]}`;
      if (TILDE_MOD[item.key]) return `\x1b[${TILDE_MOD[item.key]};${n}~`;
      return base;
    }

    function renderKeyState(record) {
      if (!record.keys) return;
      const sticky = record.sticky || {};
      for (const btn of record.keys.querySelectorAll("[data-term-key]")) {
        const item = NAV_KEYS.find(entry => entry.key === btn.dataset.termKey);
        btn.classList.toggle("active", !!(item?.modifier && sticky[item.modifier]));
      }
    }

    function sendNavKey(record, name) {
      const item = NAV_KEYS.find(entry => entry.key === name);
      if (!item) return;
      record.sticky = record.sticky || { ctrl: false, alt: false, shift: false };
      if (item.modifier) {
        record.sticky[item.modifier] = !record.sticky[item.modifier];
        renderKeyState(record);
        record.input?.focus({ preventScroll: true });
        return;
      }
      if (isExited(record)) return;
      const data = navData(item, record.sticky, record.screen?.term?.modes?.applicationCursorKeysMode === true);
      clearSticky(record);
      queueInput(record, data, data.length > 1 || data.charCodeAt(0) < 0x20);
      record.input?.focus({ preventScroll: true });
    }

    function sendKbdKey(record, token) {
      if (!record || !token || isExited(record)) return;
      const item = token.startsWith("c:") ? { char: token.slice(2) } : { key: token.slice(2) };
      const data = navData(item, record.sticky, record.screen?.term?.modes?.applicationCursorKeysMode === true);
      if (!data) return;
      clearSticky(record);
      queueInput(record, data, data.length !== 1 || data.charCodeAt(0) < 0x20);
      if (window.matchMedia?.("(pointer: fine)")?.matches) record.input?.focus({ preventScroll: true });
    }

    function setKbdOpen(record, open) {
      if (!record?.kbd) return;
      record.kbd.hidden = !open;
      if (els.kbdBtn && record.info.id === activeId) {
        els.kbdBtn.classList.toggle("active", open);
        els.kbdBtn.setAttribute("aria-pressed", open ? "true" : "false");
      }
      scheduleResize(record);
      if (open && window.matchMedia?.("(pointer: fine)")?.matches) record.input?.focus({ preventScroll: true });
    }

    function toggleKbd() {
      const record = sessions.get(activeId);
      if (record?.kbd) setKbdOpen(record, record.kbd.hidden);
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
      const termSelection = record.screen?.term?.getSelection?.() || "";


      if (event.ctrlKey && lower === "c" && termSelection) {
        copyText(termSelection).then(ok => toast(ok ? "已复制" : "复制失败，请重试", ok ? "success" : "error"));
        event.preventDefault();
        return;
      }

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
        F1: "\x1bOP",
        F2: "\x1bOQ",
        F3: "\x1bOR",
        F4: "\x1bOS",
        F5: "\x1b[15~",
        F6: "\x1b[17~",
        F7: "\x1b[18~",
        F8: "\x1b[19~",
        F9: "\x1b[20~",
        F10: "\x1b[21~",
        F11: "\x1b[23~",
        F12: "\x1b[24~",
      };
      if (record.screen?.term?.modes?.applicationCursorKeysMode === true) {
        map.ArrowUp = "\x1bOA";
        map.ArrowDown = "\x1bOB";
        map.ArrowRight = "\x1bOC";
        map.ArrowLeft = "\x1bOD";
        map.Home = "\x1bOH";
        map.End = "\x1bOF";
      }
      if (key === "Tab" && event.shiftKey) map.Tab = "\x1b[Z";

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
      const sticky = record.sticky || {};
      if (!event.ctrlKey && !event.altKey && !event.shiftKey && (sticky.ctrl || sticky.alt || sticky.shift)) {
        const named = EVENT_KEY[key];
        if (named) {
          data = navData({ key: named }, sticky, record.screen?.term?.modes?.applicationCursorKeysMode === true);
          clearSticky(record);
        } else if (data.length === 1 && data.charCodeAt(0) >= 0x20) {
          data = applySticky(record, data);
        }
      }
      event.preventDefault();
      const immediate = !(data.length === 1 && data.charCodeAt(0) >= 0x20);
      queueInput(record, data, immediate);
    }

    function copyText(text) {
      if (!text) return Promise.resolve(false);
      const fallback = () => {
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.left = "-9999px";
        area.style.top = "0";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        area.setSelectionRange(0, text.length);
        let ok = false;
        try {
          ok = document.execCommand("copy");
        } catch (error) {
          ok = false;
        }
        area.remove();
        return ok;
      };
      if (navigator.clipboard?.writeText) {
        return navigator.clipboard.writeText(text).catch(() => false).then(ok => ok || fallback());
      }
      return Promise.resolve(fallback());
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
