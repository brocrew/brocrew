import { existsSync, readFileSync } from 'node:fs'
import { load } from 'js-yaml'

export type ReleaseFeed =
  | {
      readonly provider: 'github'
      readonly owner: string
      readonly repo: string
      readonly private?: true
    }
  | { readonly provider: 'generic'; readonly url: string }

export function readFeed(text: string): ReleaseFeed | null {
  const read: unknown = load(text)
  if (typeof read !== 'object' || read === null) return null
  const { provider, owner, repo, url, private: isPrivate } = read as Record<string, unknown>
  if (provider === 'github' && typeof owner === 'string' && typeof repo === 'string') {
    if (owner === '' || repo === '') return null
    return isPrivate === true ? { provider, owner, repo, private: true } : { provider, owner, repo }
  }
  if (provider === 'generic' && typeof url === 'string' && url !== '') return { provider, url }
  return null
}

export function feedOfTheApp(appUpdateYml: string): ReleaseFeed | null {
  if (!existsSync(appUpdateYml)) return null
  return readFeed(readFileSync(appUpdateYml, 'utf8'))
}

export function downloadUrlOf(feed: ReleaseFeed, version: string, file: string): string {
  if (feed.provider === 'github') {
    return `https://github.com/${feed.owner}/${feed.repo}/releases/download/v${encodeURIComponent(version)}/${encodeURIComponent(file)}`
  }
  return new URL(encodeURIComponent(file), feed.url.endsWith('/') ? feed.url : `${feed.url}/`).href
}
