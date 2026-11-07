import crypto from "node:crypto"
import os from "node:os"
import AIToolRegistry from "../AIToolRegistry.js"
import { synthesize } from "../AIVoice.js"
import { collectEventImages, loadImageBuffer, mimeOfBuffer } from "./sticker.js"

const FETCH_TIMEOUT = 15000

const CN_CITY_HINTS = [
  "北京", "上海", "天津", "重庆", "广州", "深圳", "杭州", "南京", "苏州", "成都",
  "武汉", "西安", "长沙", "郑州", "青岛", "沈阳", "大连", "厦门", "福州", "济南",
  "哈尔滨", "长春", "昆明", "贵阳", "南宁", "海口", "兰州", "西宁", "银川", "乌鲁木齐",
  "呼和浩特", "石家庄", "太原", "合肥", "南昌", "宁波", "无锡", "佛山", "东莞", "珠海",
  "香港", "澳门", "台北",
]

const WEATHER_CODE = {
  0: "晴", 1: "晴间多云", 2: "多云", 3: "阴",
  45: "雾", 48: "雾凇",
  51: "小毛毛雨", 53: "毛毛雨", 55: "大毛毛雨",
  56: "冻毛毛雨", 57: "强冻毛毛雨",
  61: "小雨", 63: "中雨", 65: "大雨",
  66: "冻雨", 67: "强冻雨",
  71: "小雪", 73: "中雪", 75: "大雪", 77: "米雪",
  80: "阵雨", 81: "强阵雨", 82: "暴雨",
  85: "阵雪", 86: "强阵雪",
  95: "雷阵雨", 96: "雷阵雨伴冰雹", 99: "强雷阵雨伴冰雹",
}

async function fetchText(url, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { "User-Agent": "Yunzai-WebUI/1.0", ...(options.headers || {}) },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, options)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error("接口返回了非 JSON 内容")
  }
}

function isChineseCity(name) {
  const value = String(name || "")
  if (/[\u4e00-\u9fff]/.test(value)) return true
  return CN_CITY_HINTS.some(city => value.includes(city))
}

async function weatherByOpenMeteo(city, days) {
  const geo = await fetchJson(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`,
  )
  const place = geo?.results?.[0]
  if (!place) throw new Error(`找不到城市「${city}」`)
  const data = await fetchJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
      "&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m" +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=${days}&timezone=auto`,
  )
  const current = data.current || {}
  const daily = data.daily || {}
  const label = [place.name, place.admin1, place.country].filter(Boolean).join(", ")
  const lines = [
    `${label} 当前天气：${WEATHER_CODE[current.weather_code] || "未知"}，${current.temperature_2m}°C（体感 ${current.apparent_temperature}°C）`,
    `湿度 ${current.relative_humidity_2m}%，风速 ${current.wind_speed_10m} km/h`,
  ]
  for (let i = 0; i < (daily.time || []).length; i++) {
    lines.push(
      `${daily.time[i]}：${WEATHER_CODE[daily.weather_code?.[i]] || "未知"}，` +
        `${daily.temperature_2m_min?.[i]}~${daily.temperature_2m_max?.[i]}°C，` +
        `降水概率 ${daily.precipitation_probability_max?.[i] ?? 0}%`,
    )
  }
  return lines.join("\n")
}

const WWO_CODE = {
  113: "晴", 116: "晴间多云", 119: "多云", 122: "阴",
  143: "薄雾", 248: "雾", 260: "冻雾",
  176: "零星小雨", 263: "小毛毛雨", 266: "毛毛雨", 293: "小雨", 296: "小雨",
  299: "中雨", 302: "中雨", 305: "大雨", 308: "暴雨", 353: "小阵雨", 356: "阵雨", 359: "强阵雨",
  179: "零星小雪", 182: "零星雨夹雪", 185: "冻毛毛雨", 281: "冻毛毛雨", 284: "强冻毛毛雨",
  311: "冻雨", 314: "强冻雨", 317: "雨夹雪", 320: "雨夹雪", 323: "小雪", 326: "小雪",
  329: "中雪", 332: "中雪", 335: "大雪", 338: "暴雪", 350: "冰粒",
  362: "小阵雪", 365: "阵雪", 368: "小阵雪", 371: "强阵雪",
  374: "小冰粒", 377: "冰粒",
  386: "雷阵雨", 389: "强雷阵雨", 392: "雷阵雪", 395: "强雷阵雪",
}

const DESC_ZH = [
  [/smoky haze|smoke/i, "烟霾"],
  [/haze/i, "霾"],
  [/mist/i, "薄雾"],
  [/fog/i, "雾"],
  [/freezing fog/i, "冻雾"],
  [/patchy rain nearby|patchy rain/i, "零星小雨"],
  [/light drizzle|drizzle/i, "毛毛雨"],
  [/light rain|patchy light rain/i, "小雨"],
  [/moderate rain/i, "中雨"],
  [/heavy rain/i, "大雨"],
  [/torrential rain/i, "暴雨"],
  [/thundery|thunder/i, "雷阵雨"],
  [/sleet/i, "雨夹雪"],
  [/blizzard/i, "暴雪"],
  [/heavy snow/i, "大雪"],
  [/moderate snow/i, "中雪"],
  [/light snow|patchy snow/i, "小雪"],
  [/overcast/i, "阴"],
  [/cloudy/i, "多云"],
  [/sunny/i, "晴"],
  [/clear/i, "晴"],
]

function wwoLabel(current) {
  const code = Number(current?.weatherCode)
  if (WWO_CODE[code]) return WWO_CODE[code]
  const raw = current?.lang_zh?.[0]?.value || current?.weatherDesc?.[0]?.value || ""
  for (const [pattern, label] of DESC_ZH) if (pattern.test(raw)) return label
  return raw || "未知"
}

async function weatherByWttr(city, days) {
  const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=zh-cn`
  const data = await fetchJson(url)
  const current = data.current_condition?.[0]
  if (!current) throw new Error(`找不到城市「${city}」的天气`)
  const lines = [
    `${city} 当前天气：${wwoLabel(current)}，${current.temp_C}°C（体感 ${current.FeelsLikeC}°C）`,
    `湿度 ${current.humidity}%，风速 ${current.windspeedKmph} km/h，气压 ${current.pressure} hPa`,
  ]
  const daily = (data.weather || []).slice(0, days)
  for (const day of daily) {
    const hourly = day.hourly || []
    const noon = hourly[Math.min(4, hourly.length - 1)] || {}
    lines.push(`${day.date}：${wwoLabel(noon)}，${day.mintempC}~${day.maxtempC}°C`)
  }
  return lines.join("\n")
}

async function weatherTool(args) {
  const city = String(args.city || args.location || "").trim()
  if (!city) return { success: false, error: "请提供城市名，例如「北京」或「Tokyo」" }
  const days = Math.min(7, Math.max(1, Number(args.days) || 3))

  const order = isChineseCity(city)
    ? [() => weatherByWttr(city, days), () => weatherByOpenMeteo(city, days)]
    : [() => weatherByOpenMeteo(city, days), () => weatherByWttr(city, days)]
  let lastError = ""
  for (const attempt of order) {
    try {
      const text = await attempt()
      return { success: true, result: text }
    } catch (error) {
      lastError = error.message || String(error)
    }
  }
  return { success: false, error: `天气查询失败：${lastError}` }
}

function timeTool(args) {
  const zone = String(args.timezone || "Asia/Shanghai").trim()
  let date
  try {
    date = new Date(new Date().toLocaleString("en-US", { timeZone: zone }))
  } catch {
    return { success: false, error: `时区无效：${zone}` }
  }
  if (Number.isNaN(date.getTime())) return { success: false, error: `时区无效：${zone}` }
  const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"]
  const pad = n => String(n).padStart(2, "0")
  return {
    success: true,
    result:
      `当前时间（${zone}）：${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${weekdays[date.getDay()]}`,
  }
}

async function translateByMyMemory(text, target) {
  const source = /[\u4e00-\u9fff]/.test(text) ? "zh-CN" : "en"
  const langpair = `${source}|${target}`
  const data = await fetchJson(
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=${encodeURIComponent(langpair)}`,
  )
  const translated = data?.responseData?.translatedText
  if (!translated || /INVALID SOURCE LANGUAGE|QUERY LENGTH LIMIT/i.test(translated))
    throw new Error(data?.responseDetails || "翻译接口没有返回有效内容")
  return { translated, detected: source }
}

async function translateByGoogle(text, target) {
  const query = new URLSearchParams({ client: "gtx", dt: "t", sl: "auto", tl: target, q: text })
  const data = await fetchJson(`https://translate.googleapis.com/translate_a/single?${query}`)
  const translated = (data?.[0] || []).map(item => item?.[0] || "").join("")
  if (!translated) throw new Error("翻译接口没有返回内容")
  return { translated, detected: data?.[2] || "auto" }
}

async function translateTool(args) {
  const text = String(args.text || "").trim()
  if (!text) return { success: false, error: "请提供要翻译的文本" }
  if (text.length > 2000) return { success: false, error: "文本过长（最多 2000 字）" }
  const target = String(args.target || "zh-CN").trim() || "zh-CN"
  let lastError = ""
  for (const attempt of [() => translateByMyMemory(text, target), () => translateByGoogle(text, target)]) {
    try {
      const { translated, detected } = await attempt()
      return { success: true, result: `源语言: ${detected}\n译文: ${translated}` }
    } catch (error) {
      lastError = error.message || String(error)
    }
  }
  return { success: false, error: `翻译失败：${lastError}` }
}

function decodeHtml(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, "")

    .replace(/&#0?183;/g, " ")
    .replace(/&nbsp;|&ensp;|&emsp;|&thinsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number(dec)
      return code && code <= 0xffff ? String.fromCharCode(code) : " "
    })
    .replace(/\s+/g, " ")
    .trim()
}

async function search360(query, limit, headers) {
  const html = await fetchText(`https://www.so.com/s?q=${encodeURIComponent(query)}`, { headers })
  const blocks = html.match(/<li class="res-list[\s\S]*?(?=<li class="res-list|<\/ul>)/g) || []
  const results = []
  for (const block of blocks) {
    if (results.length >= limit) break
    const link = block.match(/<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    if (!link) continue
    const title = decodeHtml(link[2])
    if (!title) continue

    if (/^大家还在搜|相关搜索|查看更多/.test(title)) continue
    let url = link[1]
    if (url.startsWith("/")) url = `https://www.so.com${url}`
    if (!url.startsWith("http")) continue
    if (/360\.so\.com|so\.com\/s\?q=/.test(url)) continue
    const snippetMatch =
      block.match(/class="res-desc[^"]*"[^>]*>([\s\S]*?)<\/p>/) ||
      block.match(/class="res-rich[^"]*"[^>]*>([\s\S]*?)<\/div>/) ||
      block.match(/<p[^>]*>([\s\S]*?)<\/p>/)
    let snippet = snippetMatch ? decodeHtml(snippetMatch[1]).slice(0, 220) : ""

    if (/浏览器版本过低|下载APP|广告|立即下载/.test(snippet)) snippet = ""
    results.push(snippet ? `- ${title}\n  ${snippet}\n  ${url}` : `- ${title}\n  ${url}`)
  }
  return results
}

async function searchSogou(query, limit, headers) {
  const html = await fetchText(`https://www.sogou.com/web?query=${encodeURIComponent(query)}`, { headers })
  const blocks = html.match(/<div class="vrwrap[\s\S]*?(?=<div class="vrwrap|$)/g) || []
  const results = []
  for (const block of blocks) {
    if (results.length >= limit) break
    if (!/<h3/.test(block)) continue
    const link = block.match(/<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    if (!link) continue
    const title = decodeHtml(link[2])
    if (!title) continue
    let url = link[1]

    if (url.startsWith("/")) url = `https://www.sogou.com${url}`
    if (!url.startsWith("http")) continue
    const snippetMatch =
      block.match(/class="(?:space-txt|str-text-info|fz-mid|text-layout)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|p|span)>/) ||
      block.match(/<p[^>]*>([\s\S]*?)<\/p>/)
    const snippet = snippetMatch ? decodeHtml(snippetMatch[1]).slice(0, 220) : ""
    results.push(snippet ? `- ${title}\n  ${snippet}\n  ${url}` : `- ${title}\n  ${url}`)
  }
  return results
}

async function searchBing(query, limit, headers) {
  let html = ""
  let lastError = ""
  for (const base of ["https://cn.bing.com/search?q=", "https://www.bing.com/search?q="]) {
    try {
      html = await fetchText(`${base}${encodeURIComponent(query)}`, { headers })
      if (html) break
    } catch (error) {
      lastError = error.message || String(error)
    }
  }
  if (!html) throw new Error(lastError || "无响应")
  const results = []
  const blockRe = /<li class="b_algo"[\s\S]*?(?=<li class="b_algo"|<\/ol>|$)/g
  for (const block of html.match(blockRe) || []) {
    if (results.length >= limit) break
    const link = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    if (!link) continue
    const url = link[1]
    const title = decodeHtml(link[2])
    if (!title || !url.startsWith("http")) continue
    const snippetMatch =
      block.match(/<p class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/) ||
      block.match(/<div class="b_caption"[^>]*>([\s\S]*?)<\/div>/) ||
      block.match(/<p[^>]*>([\s\S]*?)<\/p>/)
    const snippet = snippetMatch ? decodeHtml(snippetMatch[1]).slice(0, 220) : ""
    results.push(snippet ? `- ${title}\n  ${snippet}\n  ${url}` : `- ${title}\n  ${url}`)
  }
  return results
}

async function searchTool(args) {
  const query = String(args.query || "").trim()
  if (!query) return { success: false, error: "请提供搜索关键词" }
  const limit = Math.min(10, Math.max(1, Number(args.limit) || 5))
  const headers = {
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  }

  const engines = [
    { name: "360", run: () => search360(query, limit, headers) },
    { name: "搜狗", run: () => searchSogou(query, limit, headers) },
    { name: "Bing", run: () => searchBing(query, limit, headers) },
  ]
  const errors = []
  for (const engine of engines) {
    try {
      const results = await engine.run()
      if (results.length)
        return { success: true, result: `搜索「${query}」的结果（来源 ${engine.name}）：\n${results.join("\n")}` }
      errors.push(`${engine.name}: 无结果`)
    } catch (error) {
      errors.push(`${engine.name}: ${error.message}`)
    }
  }
  return { success: false, error: `没有搜索到结果（${errors.join("；")}），请换个关键词` }
}

function calculateTool(args) {
  const expression = String(args.expression || "").trim()
  if (!expression) return { success: false, error: "请提供要计算的表达式" }
  if (expression.length > 500) return { success: false, error: "表达式过长（最多 500 字符）" }
  if (!/^[0-9+\-*/%^().\s,eE]+$/.test(expression))
    return { success: false, error: "表达式只支持数字与 + - * / % ^ ( ) 等运算符" }
  const normalized = expression.replace(/\^/g, "**")
  let value
  try {
    value = Function(`"use strict"; return (${normalized})`)()
  } catch (error) {
    return { success: false, error: `无法计算：${error.message}` }
  }
  if (typeof value !== "number" || !Number.isFinite(value))
    return { success: false, error: "计算结果不是有效数字" }
  return { success: true, result: `${expression} = ${value}` }
}

function randomTool(args) {
  const min = Number(args.min)
  const max = Number(args.max)
  const lo = Number.isFinite(min) ? Math.ceil(min) : 1
  const hi = Number.isFinite(max) ? Math.floor(max) : 100
  if (lo > hi) return { success: false, error: "最小值不能大于最大值" }
  const value = lo + Math.floor(Math.random() * (hi - lo + 1))
  return { success: true, result: `${lo}~${hi} 之间的随机整数：${value}` }
}

function uuidTool(args) {
  const count = Math.min(10, Math.max(1, Number(args.count) || 1))
  const list = Array.from({ length: count }, () => crypto.randomUUID())
  return { success: true, result: list.join("\n") }
}

function hashTool(args) {
  const text = String(args.text || "")
  if (!text) return { success: false, error: "请提供要计算的文本" }
  const algorithm = String(args.algorithm || "sha256").toLowerCase()
  if (!["md5", "sha1", "sha256", "sha512"].includes(algorithm))
    return { success: false, error: "支持的算法: md5 / sha1 / sha256 / sha512" }
  const digest = crypto.createHash(algorithm).update(text, "utf8").digest("hex")
  return { success: true, result: `${algorithm}: ${digest}` }
}

function base64Tool(args) {
  const text = String(args.text || "")
  if (!text) return { success: false, error: "请提供要处理的文本" }
  const mode = String(args.mode || "encode").toLowerCase()
  try {
    if (mode === "decode") {
      const decoded = Buffer.from(text, "base64").toString("utf8")
      return { success: true, result: decoded }
    }
    return { success: true, result: Buffer.from(text, "utf8").toString("base64") }
  } catch (error) {
    return { success: false, error: `Base64 处理失败：${error.message}` }
  }
}

function urlCodeTool(args) {
  const text = String(args.text || "")
  if (!text) return { success: false, error: "请提供要处理的文本" }
  const mode = String(args.mode || "encode").toLowerCase()
  try {
    return { success: true, result: mode === "decode" ? decodeURIComponent(text) : encodeURIComponent(text) }
  } catch (error) {
    return { success: false, error: `URL 编解码失败：${error.message}` }
  }
}

function jsonTool(args) {
  const text = String(args.text || "").trim()
  if (!text) return { success: false, error: "请提供 JSON 文本" }
  try {
    const parsed = JSON.parse(text)
    return { success: true, result: JSON.stringify(parsed, null, 2) }
  } catch (error) {
    return { success: false, error: `JSON 解析失败：${error.message}` }
  }
}

const COMPUTE_OPERATIONS = {
  calculate: calculateTool,
  random: randomTool,
  uuid: uuidTool,
  hash: hashTool,
  base64: base64Tool,
  url: urlCodeTool,
  json: jsonTool,
}

function computeTool(args) {
  const operation = String(args.operation || "").trim().toLowerCase()
  const handler = COMPUTE_OPERATIONS[operation]
  if (!handler)
    return {
      success: false,
      error: `operation 必须是 ${Object.keys(COMPUTE_OPERATIONS).join(" / ")} 之一`,
    }
  return handler(args)
}

function environmentTool() {
  const memory = process.memoryUsage()
  return {
    success: true,
    result: [
      `系统: ${os.type()} ${os.release()} (${process.platform} ${process.arch})`,
      `主机: ${os.hostname()}`,
      `Node: ${process.version}`,
      `运行时长: ${Math.floor(process.uptime())} 秒`,
      `内存: 常驻 ${Math.round(memory.rss / 1048576)} MB / 堆 ${Math.round(memory.heapUsed / 1048576)} MB`,
      `CPU: ${os.cpus()?.[0]?.model || "未知"} × ${os.cpus()?.length || 0}`,
    ].join("\n"),
  }
}

function listToolsTool() {
  const names = [...AIToolRegistry.sources.values()]
    .filter(tool => tool.pluginKey === "raw:list_available_tools" || !tool.pluginKey?.startsWith("mcp:"))
    .map(tool => `${tool.name}（${tool.pluginName}）`)
  return {
    success: true,
    result: `当前内置工具共 ${names.length} 个：\n${names.join("\n")}`,
  }
}

export function registerUtilityTools(deps = {}) {
  const disabled = new Set((AIToolRegistry.builtinDisabledTools || []).map(String))
  const voiceConfigOf =
    deps.getVoiceConfig || (() => ({ enabled: true, provider: "free", voice: "zh", speed: 5 }))
  const viewClientOf = deps.getClient || (() => null)
  const resolveImageBuffer = async (imageUrl, e) => {
    if (imageUrl) {
      const buffer = await loadImageBuffer(imageUrl)
      if (buffer) return buffer
    }
    const images = collectEventImages(e)
    for (const source of images) {
      const buffer = await loadImageBuffer(source)
      if (buffer) return buffer
    }
    return null
  }
  const detectImageMime = buffer => mimeOfBuffer(buffer) || ""
  const register = (name, def) => {
    if (disabled.has(name)) return

    AIToolRegistry.sources.delete(name)
    AIToolRegistry.registerRawTool({ ...def, name, pluginName: "内置工具", pluginKey: `builtin:${name}` })
  }

  register("weather_query", {
    description: [
      "【天气查询】查询指定城市当前天气与未来几天预报。",
      "适用场景：用户询问某地天气、气温、是否下雨、要不要带伞。",
      "参数: city(城市名，必填，如 北京 / Tokyo), days(预报天数，1-7，默认3)",
      "国内城市与国外城市会自动选择合适的天气数据源。",
    ].join("\n"),
    permission: "all",
    danger: "low",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string", description: "城市名，如 北京、上海、Tokyo" },
        days: { type: "integer", description: "预报天数 1-7，默认 3" },
      },
      required: ["city"],
    },
    handler: weatherTool,
  })

  register("time_query", {
    description: [
      "【时间查询】获取当前日期、时间与星期。",
      "适用场景：用户问现在几点、今天几号、今天星期几。",
      "参数: timezone(IANA 时区，可选，默认 Asia/Shanghai)",
    ].join("\n"),
    permission: "all",
    danger: "low",
    parameters: {
      type: "object",
      properties: {
        timezone: { type: "string", description: "IANA 时区，如 Asia/Shanghai、America/New_York" },
      },
      required: [],
    },
    handler: timeTool,
  })

  register("translate_text", {
    description: [
      "【翻译】把一段文本翻译成目标语言，自动识别源语言。",
      "适用场景：用户要求翻译、看懂外文内容。",
      "参数: text(待翻译文本，必填，最多2000字), target(目标语言代码，如 zh-CN / en / ja，默认 zh-CN)",
    ].join("\n"),
    permission: "all",
    danger: "low",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "待翻译的文本" },
        target: { type: "string", description: "目标语言代码，默认 zh-CN" },
      },
      required: ["text"],
    },
    handler: translateTool,
  })

  register("web_search", {
    description: [
      "【网页搜索】在互联网上搜索信息，返回标题、摘要与链接（多引擎自动切换）。",
      "适用场景：需要最新资讯、事实核查，或知识库中没有的内容。",
      "参数: query(搜索关键词，必填，只填关键词不要带「搜一下」这类指令词), limit(返回条数 1-10，默认5)",
      "重要：每次要搜索都必须真实调用本工具。不要用对话历史里「以前搜过、搜不到」的结论代替本次搜索，",
      "历史结果可能来自旧版本；用户要求搜索时，本轮就要调用一次。",
    ].join("\n"),
    permission: "all",
    danger: "low",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
        limit: { type: "integer", description: "返回条数 1-10，默认 5" },
      },
      required: ["query"],
    },
    handler: searchTool,
  })

  register("compute", {
    description: [
      "【计算与文本处理】一个工具覆盖多种小能力，用 operation 选择具体操作：",
      "calculate 算式求值（expression）；random 随机整数（min,max）；uuid 生成 UUID（count）；",
      "hash 文本哈希（text,algorithm=md5/sha1/sha256/sha512）；base64 编解码（text,mode=encode/decode）；",
      "url 百分号编解码（text,mode=encode/decode）；json 校验并美化 JSON（text）。",
      "按 operation 传入对应参数即可。",
    ].join("\n"),
    permission: "all",
    danger: "low",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["calculate", "random", "uuid", "hash", "base64", "url", "json"],
          description: "要执行的操作",
        },
        expression: { type: "string", description: "calculate：数学表达式，如 (1+2)*3" },
        min: { type: "integer", description: "random：最小值，默认 1" },
        max: { type: "integer", description: "random：最大值，默认 100" },
        count: { type: "integer", description: "uuid：生成数量 1-10，默认 1" },
        text: { type: "string", description: "hash / base64 / url / json：要处理的文本" },
        algorithm: {
          type: "string",
          enum: ["md5", "sha1", "sha256", "sha512"],
          description: "hash：哈希算法，默认 sha256",
        },
        mode: { type: "string", enum: ["encode", "decode"], description: "base64 / url：编码或解码" },
      },
      required: ["operation"],
    },
    handler: computeTool,
  })

  register("get_environment", {
    description: "【运行环境】获取操作系统、Node 版本、内存与运行时长等信息。无需参数。",
    permission: "all",
    danger: "low",
    parameters: { type: "object", properties: {}, required: [] },
    handler: environmentTool,
  })

  register("list_available_tools", {
    description: "【工具列表】列出当前可用的内置工具名称与来源。无需参数。",
    permission: "all",
    danger: "low",
    parameters: { type: "object", properties: {}, required: [] },
    handler: listToolsTool,
  })

  register("voice_speak", {
    description: [
      "【语音说话】把一段文字合成语音发给用户。",
      "适用场景：用户要求「说给我听」「发个语音」，或你希望用语音回应。",
      "参数: text(要说的话，必填), voice(免费通道可选 zh 中文/en 英文/jp 日文；自定义服务使用后台配置的音色)",
      "不要滥用；文字能说清就别发语音，且单次不宜过长。",
    ].join("\n"),
    permission: "all",
    danger: "low",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "要合成的文本" },
        voice: { type: "string", enum: ["zh", "en", "jp"], description: "音色语言，默认 zh" },
      },
      required: ["text"],
    },
    handler: async (args = {}, e) => {
      const voiceConfig = voiceConfigOf()
      if (voiceConfig.enabled === false) return { success: false, error: "语音功能已在 WebUI 关闭" }
      const text = String(args.text || "").trim()
      if (!text) return { success: false, error: "请提供要合成的文本" }
      let audio
      try {
        const voice =
          voiceConfig.provider === "custom"
            ? voiceConfig.voice
            : ["zh", "en", "jp"].includes(args.voice)
              ? args.voice
              : voiceConfig.voice
        audio = await synthesize(text, { ...voiceConfig, voice })
      } catch (error) {
        return { success: false, error: `语音合成失败：${error.message}。请改用文字回复，不要重复重试语音` }
      }
      if (typeof e?.reply !== "function") {
        return { success: false, error: "当前场景无法发送语音，请改用文字回复" }
      }
      try {
        const record = globalThis.segment?.record?.(audio.file) ?? audio.file
        await e.reply(record)
      } catch (error) {
        return { success: false, error: `语音发送失败：${error.message}。请改用文字回复` }
      }
      return { success: true, result: `已合成并发送语音（${text.length} 字）` }
    },
  })

  register("image_view", {
    description: [
      "【看图】看清一张图片的内容并回答问题。",
      "适用场景：用户发图后问「这是什么」「图里写了什么」「帮我看看这张图」。",
      "参数: question(想问什么，可选，默认描述画面), imageUrl(图片地址，可选，默认取当前消息的图片)",
      "只有支持图片输入的模型能用；看不了就如实说，不要编造画面内容。",
    ].join("\n"),
    permission: "all",
    danger: "low",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "关于图片的问题" },
        imageUrl: { type: "string", description: "图片地址，省略则用当前消息的图片" },
      },
      required: [],
    },
    handler: async (args = {}, e) => {
      const client = viewClientOf()
      if (!client) return { success: false, error: "AI 客户端未初始化" }
      const buffer = await resolveImageBuffer(args.imageUrl, e)
      if (!buffer) return { success: false, error: "没有找到可查看的图片" }
      const mime = detectImageMime(buffer)
      if (!mime) return { success: false, error: "无法识别的图片格式" }
      const question = String(args.question || "").trim() || "描述这张图的内容"
      try {
        const result = await client.chat(
          [
            {
              role: "user",
              content: [
                { type: "text", text: question },
                { type: "image_url", image_url: { url: `data:${mime};base64,${buffer.toString("base64")}` } },
              ],
            },
          ],
          { maxTokens: 600, temperature: 0.3 },
        )
        const text = String(result?.content || "").trim()
        if (!text) return { success: false, error: "模型没有返回内容，可能无法识图" }
        return { success: true, result: text }
      } catch (error) {
        return { success: false, error: `看图失败（当前模型可能不支持图片输入）：${error.message}` }
      }
    },
  })
}

export { weatherTool, timeTool, translateTool, searchTool, isChineseCity }
