import type { Provider } from '@brobot2/shared'

/** App services only; each provider chooses how to bind its program and credentials. */
export interface DesktopProviderContext {
  readonly isPackaged: boolean
  readonly resourcesPath: string
  readonly platform: NodeJS.Platform
  readonly arch: string
  readonly managedRoot: string
  readonly signal: AbortSignal
  readonly commandLine: {
    hasSwitch(name: string): boolean
    getSwitchValue(name: string): string
  }
  readonly keys: {
    read(provider: Provider): Promise<string | null>
    current(provider: Provider): Promise<{ readonly key: string; readonly setAt: number } | null>
    status(provider: Provider): { readonly set: boolean; readonly unreadableReason?: string }
  }
}
