import type { AppUpdater } from 'electron-updater'
import type { OutgoingHttpHeaders, RequestOptions } from 'node:http'
import { CancellationToken } from 'electron-updater/out/types'
import { GenericProvider } from 'electron-updater/out/providers/GenericProvider'
import { GitHubProvider } from 'electron-updater/out/providers/GitHubProvider'
import { resolveFiles } from 'electron-updater/out/providers/Provider'
import { downloadUrlOf, type ReleaseFeed } from './guided-update'
import type { UpdateSettings } from './update-settings'

const RESPONSE_STATUS = Symbol('update metadata response')
type MetadataRequest = RequestOptions & { [RESPONSE_STATUS]?: { code?: number } }

const WEBSITE = 'https://brocrew.app/update/'
export const UPDATE_REQUEST_HEADERS = { 'User-Agent': 'BroCrew' }
type UpdateInfo = Awaited<ReturnType<GenericProvider['getLatestVersion']>>
type RuntimeOptions = ConstructorParameters<typeof GenericProvider>[2]
type ProviderOptions = Extract<Parameters<AppUpdater['setFeedURL']>[0], { provider: 'custom' }>

/** The website currently serves only stable manifests. Manual checks with the switch off use GitHub. */
export function websiteUpdatesEnabled(settings: UpdateSettings): boolean {
  return settings.checkAutomatically && settings.channel === 'stable'
}

/** Availability failures can use GitHub; an answer that cannot be trusted must remain a refusal. */
function unavailable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { statusCode, code, message } = error as {
    statusCode?: unknown
    code?: unknown
    message?: unknown
  }
  if (typeof statusCode === 'number') return statusCode >= 500 && statusCode <= 599
  if (
    typeof code === 'string' &&
    /^(?:ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EPIPE|ERR_NETWORK_CHANGED|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_[A-Z_]+|ERR_TIMED_OUT|ERR_HTTP2_PROTOCOL_ERROR|ERR_PROXY_CONNECTION_FAILED|ERR_TUNNEL_CONNECTION_FAILED|ERR_SSL_[A-Z_]+|ERR_CERT_[A-Z_]+)$/.test(
      code,
    )
  )
    return true
  return (
    message === 'Request timed out' ||
    message === 'Request has been aborted by the server' ||
    (typeof message === 'string' && /^net::ERR_[A-Z0-9_]+(?:\s|$)/.test(message))
  )
}

const REFUSED = 'the update information is invalid; nothing was downloaded'
class WebsiteDisabled extends Error {}

/** The public release only ships these named files; a proxy cannot choose another app or path. */
function validate(info: UpdateInfo, platform: RuntimeOptions['platform']): void {
  if (
    !info ||
    typeof info.version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(info.version)
  )
    throw Error(REFUSED)
  const version = info.version
  const names =
    platform === 'darwin'
      ? [`BroCrew-${version}-arm64-mac.zip`, `BroCrew-${version}-arm64.dmg`]
      : platform === 'win32'
        ? [`BroCrew-Setup-${version}-x64.exe`]
        : []
  if (
    !Array.isArray(info.files) ||
    info.files.length === 0 ||
    ('packages' in info && info.packages)
  )
    throw Error(REFUSED)
  const seen = new Set<string>()
  for (const file of info.files) {
    if (!file || !names.includes(file.url) || typeof file.sha512 !== 'string') throw Error(REFUSED)
    if (seen.has(file.url)) throw Error(REFUSED)
    seen.add(file.url)
    const digest = Buffer.from(file.sha512, 'base64')
    if (digest.length !== 64 || digest.toString('base64') !== file.sha512) throw Error(REFUSED)
    if (file.size !== undefined && (!Number.isSafeInteger(file.size) || file.size <= 0))
      throw Error(REFUSED)
  }
  if (info.path !== undefined) {
    const file = info.files.find((file) => file.url === info.path)
    if (!file || (info.sha512 !== undefined && info.sha512 !== file.sha512)) throw Error(REFUSED)
  }
}

export interface UpdateFeedRoute {
  readonly provider: ProviderOptions
  downloadUrl(version: string, file: string): string
}

/** Keeps other generic/private feeds and feedless test builds on their existing path. */
export function publicUpdateFeed(options: {
  readonly feed: ReleaseFeed | null
  readonly version: string
  readonly mayUseWebsite: () => boolean
}): UpdateFeedRoute | null {
  const { feed, version, mayUseWebsite } = options
  const github = { provider: 'github', owner: 'brocrew', repo: 'brocrew' } as const
  if (
    !(
      feed?.provider === 'github' &&
      feed.owner === github.owner &&
      feed.repo === github.repo &&
      !feed.private
    ) &&
    !(feed?.provider === 'generic' && feed.url === WEBSITE)
  )
    return null
  const websiteUrl = new URL(WEBSITE)
  websiteUrl.searchParams.set('v', version)
  const website = { provider: 'generic', url: websiteUrl.href } as const
  let selected: ReleaseFeed = github

  const routeRequest = (request: RequestOptions): RequestOptions => {
    if (request.hostname !== 'brocrew.app') return request
    const url = new URL(request.path ?? '/', WEBSITE)
    if (url.origin !== new URL(WEBSITE).origin || !url.pathname.startsWith('/update/'))
      throw new WebsiteDisabled()
    const headers = Object.fromEntries(
      Object.entries(request.headers ?? {}).filter(
        ([name]) =>
          !['cookie', 'authorization', 'x-user-staging-id', 'host'].includes(name.toLowerCase()),
      ),
    )
    const result = Object.assign({}, request, {
      headers,
      credentials: 'omit',
      useSessionCookies: false,
    })
    if (mayUseWebsite()) {
      url.search = ''
      url.searchParams.set('v', version)
      return { ...result, path: url.pathname + url.search }
    }
    // The switch can change after URLs were resolved, while a blockmap or download is waiting.
    const name = decodeURIComponent(url.pathname.slice('/update/'.length))
    const release =
      /^BroCrew-Setup-(.+)-x64\.exe(?:\.blockmap)?$/.exec(name)?.[1] ??
      /^BroCrew-(.+)-arm64(?:-mac\.zip|\.dmg)(?:\.blockmap)?$/.exec(name)?.[1]
    if (!release || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(release))
      throw new WebsiteDisabled()
    const direct = new URL(downloadUrlOf(github, release, name))
    delete result.host
    return {
      ...result,
      protocol: direct.protocol,
      hostname: direct.hostname,
      port: '',
      path: direct.pathname,
    }
  }

  class WebsiteProvider extends GenericProvider {
    private readonly github: GitHubProvider
    private readonly fromWebsite = new WeakSet<UpdateInfo>()
    private readonly platform: RuntimeOptions['platform']

    constructor(_configuration: unknown, updater: AppUpdater, runtime: RuntimeOptions) {
      super({ ...website, useMultipleRangeRequest: false }, updater, runtime)
      this.github = new GitHubProvider(github, updater, runtime)
      this.platform = runtime.platform
      // This executor also sends full downloads and blockmaps after their URLs have been resolved.
      const createRequest = runtime.executor.createRequest.bind(runtime.executor)
      runtime.executor.createRequest = (request: MetadataRequest, callback) => {
        const observed = request[RESPONSE_STATUS]
        const native: MetadataRequest = { ...routeRequest(request) }
        delete native[RESPONSE_STATUS]
        return createRequest(native, (response) => {
          if (observed && typeof response.statusCode === 'number')
            observed.code = response.statusCode
          callback(response)
        })
      }
    }

    override get isUseMultipleRangeRequest(): boolean {
      return false
    }

    override setRequestHeaders(): void {
      super.setRequestHeaders(UPDATE_REQUEST_HEADERS)
      this.github.setRequestHeaders(UPDATE_REQUEST_HEADERS)
    }

    protected override async httpRequest(
      url: URL,
      headers?: OutgoingHttpHeaders | null,
      parent?: CancellationToken,
    ): Promise<string | null> {
      const cancellation = new CancellationToken(parent)
      const observed: { code?: number } = {}
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        cancellation.cancel()
      }, 60_000)
      try {
        // The updater copies these options on redirects. Keep status with this request only,
        // before its JSON error-body parser can discard it, and strip the marker before native I/O.
        const request: MetadataRequest = this.createRequestOptions(url, headers)
        request[RESPONSE_STATUS] = observed
        return await this.executor.request(request, cancellation)
      } catch (error) {
        if (observed.code !== undefined && observed.code >= 400) {
          throw Object.assign(
            new Error(`the update service returned an error (HTTP ${observed.code})`, {
              cause: error,
            }),
            {
              statusCode: observed.code,
            },
          )
        }
        if (timedOut) throw Object.assign(new Error('Request timed out'), { code: 'ETIMEDOUT' })
        throw error
      } finally {
        clearTimeout(timer)
        cancellation.dispose()
      }
    }

    protected override createRequestOptions(
      url: URL,
      headers?: OutgoingHttpHeaders | null,
    ): RequestOptions {
      if (!mayUseWebsite()) throw new WebsiteDisabled()
      return Object.assign(super.createRequestOptions(url, headers), {
        credentials: 'omit',
        useSessionCookies: false,
      })
    }

    override async getLatestVersion(): Promise<UpdateInfo> {
      if (mayUseWebsite()) {
        try {
          const info = await super.getLatestVersion()
          validate(info, this.platform)
          this.fromWebsite.add(info)
          selected = website
          return info
        } catch (error) {
          if (!(error instanceof WebsiteDisabled) && !unavailable(error)) throw error
        }
      }
      const info = await this.github.getLatestVersion()
      selected = github
      return info
    }

    override resolveFiles(info: UpdateInfo): ReturnType<GenericProvider['resolveFiles']> {
      if (!this.fromWebsite.has(info))
        return this.github.resolveFiles(info as Parameters<GitHubProvider['resolveFiles']>[0])
      if (mayUseWebsite()) return super.resolveFiles(info)
      return resolveFiles(
        info,
        new URL(
          `https://github.com/brocrew/brocrew/releases/download/v${encodeURIComponent(info.version)}/`,
        ),
      )
    }
  }

  return {
    provider: { provider: 'custom', updateProvider: WebsiteProvider },
    downloadUrl(releaseVersion, file) {
      const source = mayUseWebsite() ? selected : github
      const url = new URL(downloadUrlOf(source, releaseVersion, file))
      if (source.provider === 'generic') url.searchParams.set('v', version)
      return url.href
    },
  }
}
