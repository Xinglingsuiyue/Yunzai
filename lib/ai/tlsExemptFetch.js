/**
 * 针对个别自建服务域名的 TLS 校验例外。
 *
 * 部分第三方签名/验证服务把子域名挂在不匹配的 CDN 证书下（例如
 * GT.928100.xyz 返回 *.cdn.myqcloud.com 证书），Node 内置 fetch（undici）
 * 严格校验证书且不读取 NODE_TLS_REJECT_UNAUTHORIZED，导致这些域名必然失败。
 *
 * 这里只对白名单内的 host 用原生 https 重新发起请求，不做全站降级。
 */
import https from "node:https"
import dns from "node:dns"
import { Readable } from "node:stream"

const TLS_EXEMPT_HOSTS = new Set(["gt.928100.xyz"])

/** 强制走 IPv4：这些自建服务常只配了 IPv4，而系统 DNS 可能优先返回不可达的 IPv6 */
function ipv4Lookup(hostname, options, callback) {
  dns.lookup(hostname, { family: 4 }, (err, address, family) => {
    if (err) return callback(err)
    if (options?.all) return callback(null, [{ address, family }])
    callback(null, address, family)
  })
}

const nativeFetch = globalThis.fetch
if (typeof nativeFetch === "function" && !globalThis.__tlsExemptFetchPatched) {
  globalThis.__tlsExemptFetchPatched = true
  globalThis.fetch = async function tlsExemptFetch(input, init = {}) {
    let url
    try {
      url = new URL(typeof input === "string" ? input : input?.url ?? String(input))
    } catch {
      return nativeFetch(input, init)
    }
    if (!TLS_EXEMPT_HOSTS.has(url.hostname.toLowerCase())) return nativeFetch(input, init)

    const method = String(init.method || input?.method || "GET").toUpperCase()
    const body = init.body ?? undefined
    const headers = { ...(input?.headers || {}), ...(init.headers || {}) }

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          host: url.hostname,
          port: url.port || 443,
          path: `${url.pathname}${url.search}`,
          method,
          timeout: 30000,
          rejectUnauthorized: false,
          lookup: ipv4Lookup,
          headers,
        },
        res => {
          const chunks = []
          res.on("data", chunk => chunks.push(chunk))
          res.on("end", () => {
            const buffer = Buffer.concat(chunks)
            resolve(
              new Response(Readable.toWeb(Readable.from(buffer)), {
                status: res.statusCode,
                statusText: res.statusMessage,
                headers: res.headers,
              }),
            )
          })
          res.on("error", reject)
        },
      )
      req.on("timeout", () => req.destroy(new Error(`请求超时: ${url.href}`)))
      req.on("error", reject)
      if (body !== undefined) req.write(body)
      req.end()
    })
  }
}
