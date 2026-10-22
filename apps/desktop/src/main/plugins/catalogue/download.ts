import { pluginSha256 } from '../package-digests'
/** No URL/credential is ever logged. Integrity/policy failures must not masquerade as offline. */
export class PluginDownloadError extends Error {
  constructor(
    readonly kind: 'transport' | 'integrity',
    readonly status?: number,
  ) {
    super('Plugin unavailable. Try again.')
  }
}
export const PLUGIN_LIST_URL =
  'https://raw.githubusercontent.com/brocrew/brocrew/main/plugins/catalogue.json'
export const PLUGIN_LIST_V2_URL = PLUGIN_LIST_URL.replace('catalogue.json', 'catalogue-v2.json')
const catalogueUrl = (url: string) => url === PLUGIN_LIST_URL || url === PLUGIN_LIST_V2_URL
const releasePath = /^\/brocrew\/[A-Za-z0-9_.-]+\/releases\/download\/[^/]+\/[^/]+$/
export function assertPluginArchiveUrl(value: string): void {
  const url = allowed(value, true)
  if (url.hostname !== 'github.com' || !releasePath.test(url.pathname) || url.search) invalid()
}
const invalid = (): never => {
  throw new PluginDownloadError('integrity')
}
function allowed(value: string, initial: boolean): URL {
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== '443') ||
    ![
      'github.com',
      'release-assets.githubusercontent.com',
      'objects.githubusercontent.com',
      'raw.githubusercontent.com',
    ].includes(url.hostname)
  )
    return invalid()
  if (url.hostname === 'raw.githubusercontent.com' && !catalogueUrl(url.href)) return invalid()
  if (url.hostname === 'github.com' && (!releasePath.test(url.pathname) || url.search))
    return invalid()
  if (initial && url.hostname !== 'github.com' && !catalogueUrl(url.href)) return invalid()
  return url
}
/** Shared catalogue/archive transport. Three redirects, credential-free HTTPS:443, exact hosts,
 * one deadline across all headers/bodies/hops, no implicit fetch redirects or decompression.
 */
export async function downloadPluginBytes(options: {
  url: string
  maximum: number
  size?: number
  sha256?: string
  signal?: AbortSignal
  milliseconds?: number
  fetch?: typeof fetch
}): Promise<Buffer> {
  const abort = new AbortController(),
    signal = options.signal ? AbortSignal.any([options.signal, abort.signal]) : abort.signal
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort.abort()
      reject(new PluginDownloadError('transport'))
    }, options.milliseconds ?? 30000)
  })
  const work = async () => {
    let url = allowed(options.url, true)
    const releaseChain = url.hostname === 'github.com'
    for (let hops = 0; hops <= 3; hops++) {
      if (signal.aborted) throw new PluginDownloadError('transport')
      const response = await (options.fetch ?? fetch)(url, {
        redirect: 'manual',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: { 'Accept-Encoding': 'identity' },
        signal,
      })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        void response.body?.cancel().catch(() => undefined)
        if (hops === 3) return invalid()
        const location = response.headers.get('location')
        if (!location) return invalid()
        const next = allowed(new URL(location, url).href, false)
        if (
          releaseChain ? next.hostname === 'raw.githubusercontent.com' : next.href !== options.url
        )
          return invalid()
        url = next
        continue
      }
      if (response.status !== 200 || !response.body)
        throw new PluginDownloadError('transport', response.status)
      if (![null, 'identity'].includes(response.headers.get('content-encoding'))) return invalid()
      const length = response.headers.get('content-length')
      if (
        length !== null &&
        (!/^\d+$/.test(length) ||
          Number(length) > options.maximum ||
          (options.size !== undefined && Number(length) !== options.size))
      )
        return invalid()
      const reader = response.body.getReader(),
        chunks: Uint8Array[] = []
      let bytes = 0
      try {
        for (;;) {
          const part = await reader.read()
          if (part.done) break
          bytes += part.value.byteLength
          if (bytes > options.maximum || (options.size !== undefined && bytes > options.size))
            return invalid()
          chunks.push(part.value)
        }
        if (
          !bytes ||
          (options.size !== undefined && bytes !== options.size) ||
          (length !== null && bytes !== Number(length))
        )
          return invalid()
        const result = Buffer.concat(chunks)
        if (options.sha256 !== undefined && pluginSha256(result) !== options.sha256)
          return invalid()
        return result
      } finally {
        void reader.cancel().catch(() => undefined)
      }
    }
    return invalid()
  }
  try {
    return await Promise.race([work(), deadline])
  } catch (error) {
    if (error instanceof PluginDownloadError) throw error
    throw new PluginDownloadError('transport')
  } finally {
    clearTimeout(timer)
    abort.abort()
  }
}
