/** Which releases a BroBot is offered: full releases, or betas too. */
export type UpdateChannel = 'stable' | 'beta'

/** One conversation a restart would stop, and why — what the person is told before it happens. */
export interface WhatARestartWouldStopIn {
  readonly conversation: string
  /** What the window calls it. */
  readonly name: string
  /** A turn is running (or the conversation is still starting). */
  readonly turnRunning: boolean
  /** It is waiting on a person: a question or a permission card is open. */
  readonly waitingOnAPerson: boolean
  /** Messages held for it, not yet delivered. */
  readonly heldMessages: number
  /** Commands it left running in the background — they end with the app. */
  readonly inTheBackground: number
}

/** Everything a restart would stop now: empty means it can restart. */
export interface WhatARestartWouldStop {
  readonly conversations: readonly WhatARestartWouldStopIn[]
  /**
   * Other BroBot workspaces running on this computer — never closed by BroBot. `null`: not known,
   * because a conversation here is still busy (they are looked for once none is) or the computer's
   * process list could not be read; it waits as if one were running.
   */
  readonly otherWorkspaces: number | null
}

/** Where an update stands. */
export type UpdateState =
  /** This build never checks: a development build, or one built with no release to read. */
  | { readonly kind: 'not-here'; readonly why: 'a-development-build' | 'no-release-feed' }
  /** Nothing in progress. `checkedAt` is the last check that answered, or null. */
  | { readonly kind: 'idle'; readonly checkedAt: number | null; readonly upToDate: boolean }
  | { readonly kind: 'checking' }
  /** A newer version is published. */
  | { readonly kind: 'available'; readonly version: string }
  | { readonly kind: 'downloading'; readonly version: string; readonly percent: number }
  /** Downloaded and ready to install on restart. */
  | {
      readonly kind: 'ready'
      readonly version: string
      readonly how: 'restart'
      readonly path: null
    }
  /** The person chose to restart; it waits for these to be done. */
  | {
      readonly kind: 'waiting-to-restart'
      readonly version: string
      readonly stops: WhatARestartWouldStop
    }
  | { readonly kind: 'error'; readonly message: string; readonly at: number }

/** What `updates:read` answers, and `updates:changed` carries. */
export interface UpdatesSnapshot {
  /** This BroBot's version. */
  readonly version: string
  /** Whether it checks by itself, at launch and once a day. A person can always check now. */
  readonly checkAutomatically: boolean
  readonly channel: UpdateChannel
  readonly state: UpdateState
}

/** The window's updates wire: `ipcRenderer.invoke` channels, and the one the main process sends. */
export const UPDATES_CHANNELS = {
  read: 'updates:read',
  checkNow: 'updates:check-now',
  set: 'updates:set',
  download: 'updates:download',
  restartWhenQuiet: 'updates:restart-when-quiet',
  cancelRestart: 'updates:cancel-restart',
  changed: 'updates:changed',
} as const

/** What `updates:set` takes: either switch, or both. */
export interface UpdatesSettingsChange {
  readonly checkAutomatically?: boolean
  readonly channel?: UpdateChannel
}
