/**
 * WebUI 快捷登录 — 生成带一次性登录码的面板地址。
 *
 * 思路来自锅巴：主人在 QQ 里要一条面板地址，带上 6 位临时码。
 * 码只能换一次访问令牌，3 分钟不用就作废，避免地址被转发后长期可用。
 *
 * 地址分三类：
 *   内网  本机网卡上的局域网地址，同一个 WiFi / 内网可直接访问
 *   外网  公网 IP，需要端口已做映射
 *   自定义 手填的域名或反代地址，优先级最高
 */
import os from "node:os"
import crypto from "node:crypto"

/** 临时码有效期（秒） */
export const LOGIN_CODE_TTL = 180
/** 公网 IP 缓存时长（秒）：查询接口有频率限制，不能每次登录都问一遍 */
const REMOTE_CACHE_TTL = 86400
const REMOTE_FETCH_TIMEOUT = 6000
const REDIS_PREFIX = "Yz:WebUI:loginCode:"

/** 6 位数字码，去掉容易念错的 0/O、1/l 之外仍用纯数字，方便手输 */
function newLoginCode() {
  return String(crypto.randomInt(100000, 1000000))
}

/**
 * 本机局域网地址：IPv4 与 IPv6 都收。
 * IPv6 只保留能在局域网内直接访问的全局/ULA 地址，
 * fe80 链路本地需要带 scope id 才能用，浏览器里几乎没法用，跳过。
 */
export function getLocalIps() {
  const v4 = []
  const v6 = []
  try {
    for (const [name, list] of Object.entries(os.networkInterfaces() || {})) {
      if (/^(lo|docker|veth|br-|virbr|vmnet|vEthernet)/i.test(name)) continue
      for (const item of list || []) {
        if (item.internal) continue
        const raw = String(item.address || "")
        if (!raw) continue
        const family = String(item.family)
        if (family === "IPv4" || family === "4") {
          if (raw === "127.0.0.1" || raw.startsWith("169.254.")) continue
          if (!v4.includes(raw)) v4.push(raw)
          continue
        }
        if (family === "IPv6" || family === "6") {
          const address = raw.split("%")[0]
          // 链路本地(fe80)、未指定(::)、回环(::1) 对用户没用
          if (!address || address === "::1" || address === "::") continue
          if (/^fe80:/i.test(address)) continue
          if (!v6.includes(address)) v6.push(address)
        }
      }
    }
  } catch {}
  return { v4, v6 }
}

/** 公网地址：IPv4 与 IPv6 分别查，各带 Redis 缓存；取不到就返回空，不影响其他地址 */
export async function getRemoteIps() {
  const cacheKey = "Yz:WebUI:remoteIps"
  try {
    const cached = await globalThis.redis?.get?.(cacheKey)
    if (cached) {
      const parsed = JSON.parse(cached)
      // 兼容旧缓存：之前只存了 IPv4 数组
      return Array.isArray(parsed) ? { v4: parsed, v6: [] } : { v4: parsed.v4 || [], v6: parsed.v6 || [] }
    }
  } catch {}
  const query = async (sources, pattern) => {
    for (const source of sources) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT)
      try {
        const response = await fetch(source.url, { signal: controller.signal })
        if (!response.ok) continue
        const value = String(source.pick(await response.json()) || "").trim()
        if (!pattern.test(value)) continue
        return [value]
      } catch {}
      finally {
        clearTimeout(timer)
      }
    }
    return []
  }
  const v4 = await query(
    [
      { url: "https://api.ipify.org?format=json", pick: data => data?.ip },
      { url: "https://myip.ipip.net/json", pick: data => data?.data?.ip },
    ],
    /^\d{1,3}(\.\d{1,3}){3}$/,
  )
  const v6 = await query(
    [
      { url: "https://api6.ipify.org?format=json", pick: data => data?.ip },
      { url: "https://v6.ident.me/.json", pick: data => data?.address },
    ],
    /^[0-9a-f]{1,4}(:[0-9a-f]{0,4}){2,7}$/i,
  )
  if (v4.length || v6.length) {
    try {
      await globalThis.redis?.set?.(cacheKey, JSON.stringify({ v4, v6 }), { EX: REMOTE_CACHE_TTL })
    } catch {}
  }
  return { v4, v6 }
}

/**
 * 拼成 http://host:port/path。
 * 用户手填的地址自带端口时以用户为准；否则补 server 端口，
 * 但只在协议匹配时才补（http 配 80、https 配 443 才省略），
 * 避免出现 https://域名:80 这种打不开的组合。
 */
function joinAddress(host, port, path) {
  let base = String(host || "").trim()
  if (!base) return ""
  // 裸 IPv6 必须加方括号，否则 URL 解析会把地址里的冒号当成端口分隔
  if (!/^https?:\/\//i.test(base) && base.includes(":") && !base.startsWith("[")) base = `[${base}]`
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`
  const prefix = String(path || "").replace(/\/+$/, "")
  try {
    const url = new URL(base)
    const isHttps = url.protocol === "https:"
    const numericPort = Number(port) || 0
    if (!url.port && numericPort) {
      const sameScheme = (isHttps && numericPort === 443) || (!isHttps && numericPort === 80)
      // 用户没写协议时是我们补的 http，端口照补；用户写了 https 又给 80，说明不匹配，不拼端口
      const mismatched = isHttps && numericPort === 80
      if (!sameScheme && !mismatched) url.port = String(numericPort)
    }
    const currentPath = url.pathname.replace(/\/+$/, "")
    if (prefix && prefix !== "/" && !currentPath.endsWith(prefix))
      url.pathname = `${currentPath}${prefix}`
    return url.toString().replace(/\/$/, "")
  } catch {
    return ""
  }
}

/**
 * 生成三类面板地址。
 * @param {Object} options
 * @param {string} options.basePath WebUI 挂载路径，如 /webui
 * @param {number} options.port HTTP 端口
 * @param {string[]} options.customHosts 手填的自定义地址（域名或反代地址）
 * @param {boolean} options.onlyCustom 只返回自定义地址
 */
export async function buildPanelAddresses({ basePath = "/webui", port = 0, customHosts = [], onlyCustom = false } = {}) {
  const custom = []
  for (const host of customHosts) {
    const address = joinAddress(host, port, basePath)
    // 手填地址可能自带端口与路径，别重复拼接
    if (address && !custom.includes(address)) custom.push(address)
  }
  if (onlyCustom) return { custom, local: [], localV6: [], remote: [], remoteV6: [] }

  const locals = getLocalIps()
  const remotes = await getRemoteIps()
  const local = locals.v4.map(ip => joinAddress(ip, port, basePath)).filter(Boolean)
  const localV6 = locals.v6.map(ip => joinAddress(ip, port, basePath)).filter(Boolean)
  const remote = remotes.v4.map(ip => joinAddress(ip, port, basePath)).filter(Boolean)
  const remoteV6 = remotes.v6.map(ip => joinAddress(ip, port, basePath)).filter(Boolean)
  return { custom, local, localV6, remote, remoteV6 }
}

/** 发一个临时码，返回码本身；Redis 不可用时返回空串 */
export async function issueLoginCode(userId = "", ttl = LOGIN_CODE_TTL) {
  const redis = globalThis.redis
  if (!redis || typeof redis.set !== "function") return ""
  const code = newLoginCode()
  try {
    await redis.set(`${REDIS_PREFIX}${code}`, String(userId || ""), { EX: ttl })
    return code
  } catch {
    return ""
  }
}

/** 校验并消费临时码：一次性，取出来就删 */
export async function consumeLoginCode(code) {
  const redis = globalThis.redis
  const key = `${REDIS_PREFIX}${String(code || "").trim()}`
  if (!redis || typeof redis.get !== "function") return null
  try {
    const owner = await redis.get(key)
    if (owner === null || owner === undefined) return null
    await redis.del?.(key)
    return { userId: String(owner || "") }
  } catch {
    return null
  }
}

/** 面板地址 + 登录码，供指令回复使用 */
export async function createLoginPanel(e, opts = {}) {
  const userId = String(e?.user_id || "")
  const code = await issueLoginCode(userId)
  const addresses = await buildPanelAddresses({
    basePath: opts.basePath,
    port: opts.port,
    customHosts: opts.customHosts,
    onlyCustom: opts.onlyCustom,
  })
  // 没拿到码（Redis 不可用）时退回裸地址，用户仍可手动填静态令牌
  const suffix = code ? `/#/login/${code}` : ""
  const attach = list => list.map(address => address + suffix)
  return {
    code,
    ttl: LOGIN_CODE_TTL,
    custom: attach(addresses.custom),
    local: attach(addresses.local),
    localV6: attach(addresses.localV6 || []),
    remote: attach(addresses.remote),
    remoteV6: attach(addresses.remoteV6 || []),
  }
}
