import os from "node:os"
import crypto from "node:crypto"

export const LOGIN_CODE_TTL = 180

const REMOTE_CACHE_TTL = 86400
const REMOTE_FETCH_TIMEOUT = 6000
const REDIS_PREFIX = "Yz:WebUI:loginCode:"

function newLoginCode() {
  return String(crypto.randomInt(100000, 1000000))
}

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

          if (!address || address === "::1" || address === "::") continue
          if (/^fe80:/i.test(address)) continue
          if (!v6.includes(address)) v6.push(address)
        }
      }
    }
  } catch {}
  return { v4, v6 }
}

export async function getRemoteIps() {
  const cacheKey = "Yz:WebUI:remoteIps"
  try {
    const cached = await globalThis.redis?.get?.(cacheKey)
    if (cached) {
      const parsed = JSON.parse(cached)

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

function joinAddress(host, port, path) {
  let base = String(host || "").trim()
  if (!base) return ""

  if (!/^https?:\/\//i.test(base) && base.includes(":") && !base.startsWith("[")) base = `[${base}]`
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`
  const prefix = String(path || "").replace(/\/+$/, "")
  try {
    const url = new URL(base)
    const isHttps = url.protocol === "https:"
    const numericPort = Number(port) || 0
    if (!url.port && numericPort) {
      const sameScheme = (isHttps && numericPort === 443) || (!isHttps && numericPort === 80)

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

export async function buildPanelAddresses({ basePath = "/webui", port = 0, customHosts = [], onlyCustom = false } = {}) {
  const custom = []
  for (const host of customHosts) {
    const address = joinAddress(host, port, basePath)

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

export async function createLoginPanel(e, opts = {}) {
  const userId = String(e?.user_id || "")
  const code = await issueLoginCode(userId)
  const addresses = await buildPanelAddresses({
    basePath: opts.basePath,
    port: opts.port,
    customHosts: opts.customHosts,
    onlyCustom: opts.onlyCustom,
  })

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
