import type { Provider } from '@brobot2/shared'
import type { ProviderSetupAction, ProviderSetupState } from '../../shared/provider-setup'

export interface SetupService {
  readonly busy: boolean
  state(): ProviderSetupState
  onState(listener: (state: ProviderSetupState) => void): () => void
  onCompleted(listener: (provider: Provider) => void): () => void
  install(): ProviderSetupAction
  signIn(): ProviderSetupAction
  cancel(): ProviderSetupAction
  close(): Promise<void>
}
export type SetupServices = Partial<Readonly<Record<Provider, SetupService>>>

export function unsupportedSetup(provider: Provider): ProviderSetupState {
  return {
    provider,
    supported: { install: false, signIn: false },
    phase: 'idle',
    available: false,
    progress: '',
    authUrl: null,
    error: 'unsupported-provider',
    details: null,
    exitCode: null,
  }
}

export interface SetupOutput {
  on(event: 'data' | 'error', listener: (chunk: unknown) => void): void
  removeListener(event: 'data' | 'error', listener: (chunk: unknown) => void): void
  destroy(): void
}
export interface SetupChild {
  readonly pid?: number
  readonly stdout: SetupOutput | null
  readonly stderr: SetupOutput | null
  once(event: 'spawn', listener: () => void): void
  once(event: 'error', listener: (error: Error) => void): void
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void
  once(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void
}
export interface SetupCommand {
  readonly file: string
  readonly args: readonly string[]
}
