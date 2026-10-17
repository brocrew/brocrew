import { createHash } from 'node:crypto'
import type { Protocol } from 'electron'
import type { AssetFacts, AssetType } from '../../shared/themes/assets'
import { assetPathProblem } from '../../shared/themes/assets'
import { THEME_SCHEME } from '../../shared/themes/css'
import { readThemeFile } from './files'

export const THEME_SCHEME_PRIVILEGES = {
  scheme: THEME_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: false },
} as const

const MIME: Readonly<Partial<Record<AssetType, string>>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  woff2: 'font/woff2',
}

export interface AdmittedThemeAsset {
  readonly root: string
  readonly path: string
  readonly digest: string
  readonly version: string
  readonly facts: AssetFacts
}

export interface ThemeAssetRegistry {
  asset(id: string, path: string): AdmittedThemeAsset | null
}

export function themeRequest(url: string): { id: string; path: string; version?: string } | null {
  const match = new RegExp(
    `^${THEME_SCHEME}://([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)/([^?#]+)(?:\\?v=([a-f0-9]{64}))?$`,
  ).exec(url)
  if (!match) return null
  try {
    const path = decodeURIComponent(match[2]!)
    if (assetPathProblem(path) !== null) return null
    return { id: match[1]!, path, ...(match[3] ? { version: match[3] } : {}) }
  } catch {
    return null
  }
}

export async function themeAssetResponse(
  url: string,
  registry: ThemeAssetRegistry,
  read = readThemeFile,
): Promise<{ readonly bytes: Buffer; readonly contentType: string } | null> {
  const request = themeRequest(url)
  if (!request) return null
  const admitted = registry.asset(request.id, request.path)
  if (!admitted || (request.version && request.version !== admitted.version)) return null
  if (
    admitted.facts.type !== 'png' &&
    admitted.facts.type !== 'jpeg' &&
    admitted.facts.type !== 'woff2'
  )
    return null
  const contentType = MIME[admitted.facts.type]
  if (!contentType) return null
  const file = await read(admitted.root, admitted.path, admitted.facts.bytes)
  if (!file.ok || file.bytes.length !== admitted.facts.bytes) return null
  if (createHash('sha256').update(file.bytes).digest('hex') !== admitted.digest) return null
  return { bytes: file.bytes, contentType }
}

export function installThemeProtocol(
  protocol: Pick<Protocol, 'handle'>,
  registry: ThemeAssetRegistry,
): void {
  protocol.handle(THEME_SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return new Response(null, { status: 405 })
    const asset = await themeAssetResponse(request.url, registry)
    if (!asset) return new Response(null, { status: 404 })
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(asset.bytes), {
      headers: {
        'Content-Type': asset.contentType,
        'Content-Length': String(asset.bytes.length),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    })
  })
}
