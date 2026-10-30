import type { IpcRenderer, IpcRendererEvent } from 'electron'
import type { Provider } from '@brobot2/shared'
import {
  PROVIDER_SETUP_CHANNELS,
  type ProviderSetupBridge,
  type ProviderSetupState,
} from '../shared/provider-setup'

export function providerSetupBridge(
  ipc: Pick<IpcRenderer, 'invoke' | 'on' | 'off'>,
): ProviderSetupBridge {
  return Object.freeze({
    state: (provider: Provider) =>
      ipc.invoke(PROVIDER_SETUP_CHANNELS.state, provider) as ReturnType<
        ProviderSetupBridge['state']
      >,
    install: (provider: Provider) =>
      ipc.invoke(PROVIDER_SETUP_CHANNELS.install, provider) as ReturnType<
        ProviderSetupBridge['install']
      >,
    signIn: (provider: Provider) =>
      ipc.invoke(PROVIDER_SETUP_CHANNELS.signIn, provider) as ReturnType<
        ProviderSetupBridge['signIn']
      >,
    cancel: (provider: Provider) =>
      ipc.invoke(PROVIDER_SETUP_CHANNELS.cancel, provider) as ReturnType<
        ProviderSetupBridge['cancel']
      >,
    onState: (listener: (state: ProviderSetupState) => void): (() => void) => {
      const forward = (_event: IpcRendererEvent, state: ProviderSetupState): void => listener(state)
      ipc.on(PROVIDER_SETUP_CHANNELS.changed, forward)
      return () => {
        ipc.off(PROVIDER_SETUP_CHANNELS.changed, forward)
      }
    },
  })
}
