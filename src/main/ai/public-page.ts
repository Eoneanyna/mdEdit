import { lookup } from 'node:dns/promises'
import { request as httpRequest, type RequestOptions } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP } from 'node:net'

const blocked = new BlockList()
const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')
for (const [network, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked.addSubnet(network, prefix, 'ipv4')
for (const [network, prefix] of [['::', 96], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32], ['2002::', 16], ['64:ff9b::', 96]] as const) blocked.addSubnet(network, prefix, 'ipv6')

export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (!family) return false
  if (family === 4) return !blocked.check(address, 'ipv4')
  if (address.toLowerCase().startsWith('::ffff:')) {
    const tail = address.slice(7)
    if (isIP(tail) === 4) return isPublicAddress(tail)
    const parts = tail.split(':').map(value => parseInt(value, 16))
    return parts.length === 2 && isPublicAddress([parts[0] >> 8, parts[0] & 255, parts[1] >> 8, parts[1] & 255].join('.'))
  }
  return globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6') && !address.toLowerCase().startsWith('2001:0:')
}
export function publicUrl(input: string): URL {
  const url = new URL(input)
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
    url.port && !['80', '443'].includes(url.port) || /(^|\.)(localhost|local|internal)$/.test(host) ||
    isIP(host) && !isPublicAddress(host)) throw new Error('只允许读取公共网页')
  url.hash = ''
  return url
}

/** 逐跳校验 DNS 与重定向，并将连接固定到已校验 IP，避免网页读取访问本机服务。 */
export async function downloadPublicPage(input: string, signal?: AbortSignal): Promise<{ url: string; body: string; contentType: string }> {
  const timeout = AbortSignal.timeout(8000)
  const abort = signal ? AbortSignal.any([signal, timeout]) : timeout
  let url = publicUrl(input)
  for (let redirect = 0; redirect <= 3; redirect++) {
    abort.throwIfAborted()
    const host = url.hostname.replace(/^\[|\]$/g, '')
    const addresses = await new Promise<Array<{ address: string; family: number }>>((resolve, reject) => {
      const cancel = (): void => reject(new Error('网页读取已取消或超时'))
      abort.addEventListener('abort', cancel, { once: true })
      const pending = isIP(host) ? Promise.resolve([{ address: host, family: isIP(host) }]) : lookup(host, { all: true, verbatim: true })
      pending.then(resolve, reject).finally(() => abort.removeEventListener('abort', cancel))
    })
    if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('网页地址不是公共网络地址')
    const first = addresses[0]
    const pinned: RequestOptions['lookup'] = (_hostname, options, callback) => {
      if (options.all) callback(null, [first])
      else callback(null, first.address, first.family)
    }
    const result = await new Promise<{ status: number; location?: string; body: string; contentType: string }>((resolve, reject) => {
      const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
        method: 'GET', signal: abort, lookup: pinned,
        headers: { 'User-Agent': 'mdEdit/0.1 (personal knowledge assistant)', Accept: 'text/html,application/xhtml+xml,text/plain', 'Accept-Encoding': 'identity' }
      }, response => {
        const status = response.statusCode || 0
        const contentType = String(response.headers['content-type'] || '')
        if ([301, 302, 303, 307, 308].includes(status)) {
          response.resume(); resolve({ status, location: response.headers.location, body: '', contentType }); return
        }
        if (status !== 200 || !/text\/(html|plain|xml)|application\/(xhtml\+xml|rss\+xml|xml)/.test(contentType) ||
          response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
          response.resume(); reject(new Error('网页正文不可读取')); return
        }
        const chunks: Buffer[] = []
        let size = 0
        response.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > 2_000_000) { req.destroy(new Error('网页过大')); return }
          chunks.push(chunk)
        })
        response.on('error', reject)
        response.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8'), contentType }))
      })
      req.on('error', reject); req.end()
    })
    if ([301, 302, 303, 307, 308].includes(result.status)) {
      if (!result.location || redirect === 3) throw new Error('网页重定向过多')
      url = publicUrl(new URL(result.location, url).href)
      continue
    }
    return { url: url.href, body: result.body, contentType: result.contentType }
  }
  throw new Error('网页重定向过多')
}
