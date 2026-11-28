import cfg from "../config/config.js"

const CN_DIGITS = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}

export function timezone() {
  return cfg.ai?.timezone || "Asia/Shanghai"
}

function normalizeDigits(value) {
  return String(value ?? "")
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ":")
    .replace(/\u3000/g, " ")
}

function zoneFormatter(zone) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: zone || timezone(),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
  }
}

export function zoneParts(epoch, zone = timezone()) {
  const parts = Object.fromEntries(
    zoneFormatter(zone)
      .formatToParts(new Date(Number(epoch) || Date.now()))
      .filter(item => item.type !== "literal")
      .map(item => [item.type, item.value]),
  )
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === "24" ? 0 : parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  }
}

function sameParts(a, b) {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.second === b.second
  )
}

export function zonedEpoch(year, month, day, hour = 0, minute = 0, second = 0, zone = timezone()) {
  const desired = Date.UTC(year, month - 1, day, hour, minute, second)
  let guess = desired
  for (let i = 0; i < 4; i++) {
    const parts = zoneParts(guess, zone)
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    if (sameParts(parts, { year, month, day, hour, minute, second })) break
    const diff = asUtc - guess
    if (!diff) break
    guess -= diff
  }
  return guess
}

export function formatInZone(epoch, zone = timezone()) {
  const parts = zoneParts(epoch, zone)
  const pad = value => String(value).padStart(2, "0")
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}`
}

export function dateKeyInZone(epoch, zone = timezone()) {
  const parts = zoneParts(epoch, zone)
  const pad = value => String(value).padStart(2, "0")
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
}

export function dayLabelInZone(epoch, now = Date.now(), zone = timezone()) {
  const target = zoneParts(epoch, zone)
  const base = zoneParts(now, zone)
  const targetUtc = Date.UTC(target.year, target.month - 1, target.day)
  const baseUtc = Date.UTC(base.year, base.month - 1, base.day)
  const diff = Math.round((targetUtc - baseUtc) / 86400000)
  if (diff === 0) return "今天"
  if (diff === 1) return "明天"
  if (diff === 2) return "后天"
  if (diff === -1) return "昨天"
  return `${target.month} 月 ${target.day} 日`
}

function parseChineseNumber(value) {
  const raw = String(value || "").trim()
  if (!raw) return null
  if (/^\d+$/.test(raw)) return Number(raw)
  if (raw === "十") return 10
  if (raw.startsWith("十")) {
    const rest = CN_DIGITS[raw[1]]
    return 10 + (rest ?? 0)
  }
  if (raw.includes("十")) {
    const [tens, ones] = raw.split("十")
    return (CN_DIGITS[tens] ?? 0) * 10 + (ones ? CN_DIGITS[ones] ?? 0 : 0)
  }
  if (raw.length === 1 && raw in CN_DIGITS) return CN_DIGITS[raw]
  return null
}

function minuteOf(value) {
  const raw = String(value || "").replace(/\s|分/g, "")
  if (!raw) return 0
  if (raw === "半") return 30
  if (raw === "多") return 30
  const parsed = parseChineseNumber(raw)
  return parsed === null ? 0 : Math.min(59, parsed)
}

function periodOf(text, matchIndex, prefix = "") {
  const head = String(prefix || "") + normalizeDigits(text).slice(Math.max(0, matchIndex - 6), matchIndex)
  if (/(下午|傍晚|晚上|夜里|夜晚|今晚|明晚|每天晚|每晚)/.test(head)) return "evening"
  if (/(凌晨|半夜)/.test(head)) return "midnight"
  if (/(早上|早晨|上午|今早|明早)/.test(head)) return "morning"
  if (/中午/.test(head)) return "noon"
  return ""
}

export function parseClockInText(value) {
  const text = normalizeDigits(value)
  const pattern =
    /(?:(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里|夜晚|半夜|今早|明早|今晚|明晚)\s*)?([0-9]{1,2}|[零〇一二三四五六七八九十两]{1,3})\s*(?:点|时|:)\s*(半|多|[0-9]{1,2}\s*分?|[零〇一二三四五六七八九十]{1,3}\s*分?)?/
  const match = pattern.exec(text)
  if (!match) return null
  let hour = parseChineseNumber(match[2])
  if (hour === null || hour > 23) return null
  let minute = minuteOf(match[3])
  const period = periodOf(text, match.index, match[1] || "")
  if (period === "evening") {
    if (hour === 12) hour = 0
    else if (hour < 12) hour += 12
  } else if (period === "midnight" && hour === 12) {
    hour = 0
  }
  return { hour, minute, period, index: match.index, raw: match[0] }
}

function shiftDate(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
}

function weekdayIndex(value) {
  if (/日|天/.test(value)) return 0
  return { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }[value] ?? null
}

function explicitDate(value, baseParts, baseEpoch) {
  const text = normalizeDigits(value)
  let match = text.match(/(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})[日号]?/)
  if (match) {
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hasTime: true,
    }
  }
  match = text.match(/(?<![\d:])(\d{1,2})[-/](\d{1,2})(?![\d:])/)
  if (match) {
    const year = baseParts.year
    let target = { year, month: Number(match[1]), day: Number(match[2]) }
    let epoch = zonedEpoch(target.year, target.month, target.day, 12, 0)
    if (epoch < baseEpoch - 86400000) {
      target = { year: year + 1, month: target.month, day: target.day }
    }
    return { ...target, hasTime: true }
  }
  match = text.match(/(\d{1,2})月(\d{1,2})[日号]?/)
  if (match) {
    let month = Number(match[1])
    let day = Number(match[2])
    let year = baseParts.year
    let epoch = zonedEpoch(year, month, day, 12, 0)
    if (epoch < baseEpoch - 86400000) {
      year++
      epoch = zonedEpoch(year, month, day, 12, 0)
    }
    return { year, month, day, hasTime: true }
  }
  match = text.match(/(下周|下星期|下礼拜)([一二三四五六日天])?/)
  if (match) {
    const baseWeek = new Date(Date.UTC(baseParts.year, baseParts.month - 1, baseParts.day)).getUTCDay()
    const targetWeek = match[2] ? weekdayIndex(match[2]) : 1
    let offset = targetWeek - baseWeek
    if (match[2]) {
      if (offset <= 0) offset += 7
      offset += 7
    } else {
      offset = 7
    }
    return { ...shiftDate(baseParts, offset), hasTime: false }
  }
  match = text.match(/(?:下个?月)/)
  if (match) {
    const month = baseParts.month === 12 ? 1 : baseParts.month + 1
    const year = baseParts.month === 12 ? baseParts.year + 1 : baseParts.year
    return { year, month, day: Math.min(baseParts.day, 28), hasTime: false }
  }
  match = text.match(/月底/)
  if (match) {
    const last = new Date(Date.UTC(baseParts.year, baseParts.month, 0))
    return { year: last.getUTCFullYear(), month: last.getUTCMonth() + 1, day: last.getUTCDate(), hasTime: false }
  }
  match = text.match(/(本周|这周|周|星期|礼拜)([一二三四五六日天])/)
  if (match) {
    const baseWeek = new Date(Date.UTC(baseParts.year, baseParts.month - 1, baseParts.day)).getUTCDay()
    const targetWeek = weekdayIndex(match[2])
    let offset = targetWeek === null ? 0 : (targetWeek - baseWeek + 7) % 7
    return { ...shiftDate(baseParts, offset), hasTime: false }
  }
  if (/大后天/.test(text)) return { ...shiftDate(baseParts, 3), hasTime: false }
  if (/后天/.test(text)) return { ...shiftDate(baseParts, 2), hasTime: false }
  if (/明早|明天|明日|明儿|明晚|次日/.test(text)) return { ...shiftDate(baseParts, 1), hasTime: false }
  if (/今早|今天|今晚|今夜|今日/.test(text)) return { ...baseParts, hasTime: false }
  return null
}

function defaultClockFor(value, dateInfo) {
  const text = normalizeDigits(value)
  if (/明早|今早|早上|早晨|上午/.test(text)) return { hour: 8, minute: 0 }
  if (/明晚|今晚|今夜|晚上|夜里|夜晚/.test(text)) return { hour: 22, minute: 0 }
  if (/中午/.test(text)) return { hour: 12, minute: 0 }
  if (/下午/.test(text)) return { hour: 15, minute: 0 }
  if (/凌晨|半夜/.test(text)) return { hour: 0, minute: 0 }
  if (dateInfo) return { hour: 12, minute: 0 }
  return null
}

function nextClockAfter(baseEpoch, hour, minute, zone) {
  const base = zoneParts(baseEpoch, zone)
  let target = zonedEpoch(base.year, base.month, base.day, hour, minute, 0, zone)
  if (target <= baseEpoch + 1000) {
    const next = shiftDate(base, 1)
    target = zonedEpoch(next.year, next.month, next.day, hour, minute, 0, zone)
  }
  return target
}

export function parseDueTime(value, baseEpoch = Date.now(), zone = timezone()) {
  const text = normalizeDigits(value).trim()
  if (!text) return null
  const clock = parseClockInText(text)
  const baseParts = zoneParts(baseEpoch, zone)
  const dateInfo = explicitDate(text, baseParts, baseEpoch)
  let hour = clock?.hour
  let minute = clock?.minute
  if (hour === undefined) {
    const fallback = defaultClockFor(text, dateInfo)
    if (!fallback) {
      if (/一会儿|待会儿|等会儿|稍后|马上|立刻/.test(text)) return baseEpoch + 30 * 60000
      return null
    }
    hour = fallback.hour
    minute = fallback.minute
  }
  if (hour > 23 || minute > 59) return null
  if (dateInfo) {
    let target = zonedEpoch(dateInfo.year, dateInfo.month, dateInfo.day, hour, minute, 0, zone)
    if (target <= baseEpoch + 1000) {
      if (/明早|明天|今晚|今天|今夜|今早|今日|后天|大后天|周|星期|礼拜|下个月|月底/.test(text)) {
        const shifted = shiftDate(dateInfo, 1)
        target = zonedEpoch(shifted.year, shifted.month, shifted.day, hour, minute, 0, zone)
      }
    }
    return target
  }
  return nextClockAfter(baseEpoch, hour, minute, zone)
}

export function nextDailyEpoch(hour, minute, afterEpoch = Date.now(), zone = timezone()) {
  return nextClockAfter(afterEpoch, hour, minute, zone)
}

export function detectCommitment(value, baseEpoch = Date.now(), zone = timezone()) {
  const text = normalizeDigits(value).trim()
  if (!text || /[?？]\s*$/.test(text)) return null
  if (/(昨天|前天|上次|那次|之前|刚才|刚刚|已经|早就|过去).{0,16}(点|时|:)/.test(text)) return null
  if (/(点|时|:).{0,6}(了|过了|早就)/.test(text)) return null

  if (/(点|时|[:：])\s*(?:半|多|\d{1,2}\s*分?)?\s*(不|别|没|没法)/.test(text)) return null
  if (/(起不来|去不了|来不了|做不到|弄不了|喊不了|开不了口|说不出口|起不来|见不了)/.test(text)) return null
  const clock = parseClockInText(text)
  if (!clock) return null
  const repeat = /每天|每晚|天天/.test(text) ? "daily" : "none"
  const futureMarker = /(明早|明天|明日|明晚|今晚|今夜|今早|等会|等会儿|待会|待会儿|回头|到时候|到点|下午|晚上|凌晨|早上|每天|每晚|天天|一会儿|稍后|过会|后天)/.test(text)
  const firstPerson = /我|咱|俺/.test(text)

  const action = "(?:叫|喊|起来|起床|起|开口|提醒|说|讲|发|找|见)"
  const timeThenAction = new RegExp(`(?:点|时|:).{0,24}${action}`).test(text)
  const actionThenTime = new RegExp(`${action}.{0,24}(?:点|时|:)`).test(text)
  if (!(timeThenAction || actionThenTime)) return null
  const commitmentWord = /(会|要|一定|肯定|保证|准时|说好|答应|约好)/.test(text)
  const selfWake = firstPerson && /(起来|起床|起)/.test(text) && clock.hour >= 0 && clock.hour <= 6
  const directed = new RegExp(`${action}.{0,6}(你|你们|大家|群里|群友)`).test(text)
  if (!(futureMarker || commitmentWord || selfWake || directed)) return null
  const dueAt = parseDueTime(text, baseEpoch, zone)
  if (!dueAt || dueAt <= baseEpoch - 1000) return null
  return { dueAt, repeat, clock, text }
}

export function describeAlarm(epoch, repeat = "none", now = Date.now(), zone = timezone()) {
  const label = dayLabelInZone(epoch, now, zone)
  const time = formatInZone(epoch, zone).slice(11)
  return `${label} ${time}${repeat === "daily" ? "（每天）" : ""}`
}
