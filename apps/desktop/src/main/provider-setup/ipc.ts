import { SUPPORTED_PROVIDERS, type Provider } from '@brobot2/shared'
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import { PROVIDER_SETUP_CHANNELS, type ProviderSetupAction } from '../../shared/provider-setup'
import { installSessionRelease } from '../window-navigation'
import { unsupportedSetup, type SetupServices, type SetupService } from './service'

/** Only app main frames may admit a fixed operation; its initiating document owns cancellation. */
export function registerProviderSetup(
  ipc: Pick<IpcMain, 'handle' | 'removeHandler'>,
  services: SetupServices,
  authorized: (event: IpcMainInvokeEvent) => boolean,
): () => Promise<void> {
  let closed = false
  const watchers = new Map<WebContents, Set<Provider>>()
  const releases = new Map<WebContents, () => void>()
  const owners = new Map<SetupService, WebContents>()
  const valid = (event: IpcMainInvokeEvent, args: unknown[]): args is [Provider] =>
    !closed &&
    authorized(event) &&
    args.length === 1 &&
    SUPPORTED_PROVIDERS.some((provider) => provider === args[0])
  const forget = (contents: WebContents): void => {
    watchers.delete(contents)
    for (const [service, owner] of owners)
      if (owner === contents) {
        service.cancel()
        owners.delete(service)
      }
    const release = releases.get(contents)
    if (release) {
      contents.removeListener('did-navigate', release)
      contents.removeListener('render-process-gone', release)
      contents.removeListener('destroyed', release)
    }
    releases.delete(contents)
  }
  const watch = (contents: WebContents, provider: Provider): void => {
    let providers = watchers.get(contents)
    if (!providers) {
      providers = new Set()
      watchers.set(contents, providers)
      const release = (): void => forget(contents)
      releases.set(contents, release)
      installSessionRelease(contents, release)
    }
    providers.add(provider)
  }
  const off = Object.values(services).map((service) =>
    service.onState((state) => {
      if (!service.busy) owners.delete(service)
      for (const [contents, providers] of watchers) {
        if (contents.isDestroyed()) {
          forget(contents)
          continue
        }
        if (!providers.has(state.provider)) continue
        try {
          contents.send(PROVIDER_SETUP_CHANNELS.changed, state)
        } catch {
          forget(contents)
        }
      }
    }),
  )
  ipc.handle(PROVIDER_SETUP_CHANNELS.state, (event, ...args: unknown[]) => {
    if (!valid(event, args)) throw new Error('Provider setup is not authorized.')
    const provider = args[0]
    watch(event.sender, provider)
    return services[provider]?.state() ?? unsupportedSetup(provider)
  })
  for (const action of ['install', 'signIn', 'cancel'] as const) {
    ipc.handle(
      PROVIDER_SETUP_CHANNELS[action],
      (event, ...args: unknown[]): ProviderSetupAction => {
        if (!valid(event, args)) return { ok: false, reason: 'not-authorized' }
        const provider = args[0]
        const service = services[provider]
        if (!service) return { ok: false, reason: 'unsupported-provider' }
        const owner = owners.get(service)
        if (service.busy && owner !== event.sender) return { ok: false, reason: 'busy' }
        watch(event.sender, provider)
        owners.set(service, event.sender)
        const answer = service[action]()
        if (!service.busy) owners.delete(service)
        return answer
      },
    )
  }
  let closing: Promise<void> | undefined
  return () => {
    closing ??= (async () => {
      closed = true
      for (const channel of [
        PROVIDER_SETUP_CHANNELS.state,
        PROVIDER_SETUP_CHANNELS.install,
        PROVIDER_SETUP_CHANNELS.signIn,
        PROVIDER_SETUP_CHANNELS.cancel,
      ])
        ipc.removeHandler(channel)
      for (const stop of off) stop()
      for (const contents of [...watchers.keys()]) forget(contents)
      await Promise.all(Object.values(services).map((service) => service.close()))
    })()
    return closing
  }
}
