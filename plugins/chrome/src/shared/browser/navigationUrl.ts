import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** Navigation only: local paths are encoded as paths, never parsed as URLs (so # and ? remain filename characters). */
export function navigationUrl(raw: string): string {
  if (raw === 'about:blank') return raw
  if (path.isAbsolute(raw)) return pathToFileURL(raw).href
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('the URL is not valid')
  }
  if (!['http:', 'https:', 'file:'].includes(url.protocol))
    throw new Error('only http, https, file URLs, absolute local paths and about:blank are allowed')
  return url.href
}
