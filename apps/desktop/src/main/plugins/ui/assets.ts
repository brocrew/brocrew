import type { CustomScheme } from 'electron'
import type { VerifiedPluginPackage } from '../package-verifier'
import { verifyPluginDigest } from '../package-digests'

export const PLUGIN_SCHEME: CustomScheme = {
  scheme: 'brocrew-plugin',
  privileges: {
    standard: true,
    secure: true,
    bypassCSP: false,
    allowServiceWorkers: false,
    supportFetchAPI: false,
    corsEnabled: false,
    stream: false,
  },
}
export const PLUGIN_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
export class PluginUiAssets {
  readonly origin: string
  readonly entry: string
  private readonly files = new Map<string, { bytes: Uint8Array; mime: string }>()
  constructor(verified: VerifiedPluginPackage, viewId: string) {
    if (
      !/^[a-f0-9-]{36}$/.test(viewId) ||
      !verified.compatibility.host ||
      !verified.compatibility.ui ||
      !verified.manifest.ui
    )
      throw new Error('Plugin unavailable. Try again.')
    this.origin = `brocrew-plugin://${viewId}`
    this.entry = `${this.origin}/${verified.manifest.ui.entry}`
    for (const asset of verified.manifest.ui.assets) {
      const file = verified.manifest.files.find((file) => file.path === asset.path),
        bytes = verified.readFile(asset.path)
      if (!file || !bytes) throw new Error('Plugin unavailable. Try again.')
      verifyPluginDigest(bytes, file, 256 * 1024 * 1024)
      this.files.set(`${this.origin}/${asset.path}`, {
        bytes: Uint8Array.from(bytes),
        mime: asset.mime,
      })
    }
  }
  permits(url: string, method: string): boolean {
    return (method === 'GET' || method === 'HEAD') && this.files.has(url)
  }
  response(request: Pick<Request, 'url' | 'method'>): Response {
    const file = this.files.get(request.url)
    if (!file || !this.permits(request.url, request.method))
      return new Response(null, { status: 404 })
    return new Response(request.method === 'HEAD' ? null : Uint8Array.from(file.bytes), {
      headers: {
        'Content-Type': file.mime,
        'Content-Security-Policy': PLUGIN_CSP,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    })
  }
}
