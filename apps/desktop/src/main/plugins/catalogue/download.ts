import { pluginSha256 } from '../package-digests'
export class PluginDownloadError extends Error {
  constructor(
    readonly kind: 'transport' | 'integrity',
    readonly status?: number,
  ) {
    super(
      kind === 'integrity'
        ? 'The plugin download did not match the selected bytes.'
        : status
          ? `Plugin download failed (HTTP ${status}).`
          : 'Could not download the plugin.',
    )
  }
}
export const PLUGIN_LIST_URL =
  'https://raw.githubusercontent.com/brocrew/brocrew/main/plugins/catalogue.json'
export const PLUGIN_LIST_V2_URL = PLUGIN_LIST_URL.replace('catalogue.json', 'catalogue-v2.json')
/** URL parsing is decoding only; fetch reports unsupported sources normally. */
export function assertPluginArchiveUrl(value: string): void {
  new URL(value)
}
export async function downloadPluginBytes(options: {
  url: string
  maximum: number
  size?: number
  sha256?: string
  signal?: AbortSignal
  milliseconds?: number
  fetch?: typeof fetch
}): Promise<Buffer> {
  const timeout = options.milliseconds ? AbortSignal.timeout(options.milliseconds) : undefined
  const signal =
    timeout && options.signal
      ? AbortSignal.any([timeout, options.signal])
      : (timeout ?? options.signal)
  let response: Response
  try {
    response = await (options.fetch ?? fetch)(options.url, { signal })
  } catch (error) {
    throw new Error('Could not download the plugin.', { cause: error })
  }
  if (!response.ok) throw new PluginDownloadError('transport', response.status)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (
    bytes.length > options.maximum ||
    (options.size !== undefined && bytes.length !== options.size) ||
    (options.sha256 !== undefined && pluginSha256(bytes) !== options.sha256)
  )
    throw new PluginDownloadError('integrity')
  return bytes
}
