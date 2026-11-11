import type { AppUpdater } from 'electron-updater'
import type {
  UpdateChannel,
  UpdateState,
  UpdatesSettingsChange,
  UpdatesSnapshot,
  WhatARestartWouldStop,
  WhatARestartWouldStopIn,
} from '../shared/updates'
import type { UpdateSettings } from './update-settings'

/** One file a release names in its update file. */
interface ReleaseFile {
  readonly url: string
  readonly sha512: string
  readonly size?: number
}

/** A newer release the feed offered. */
export interface FoundUpdate {
  readonly version: string
  readonly files: readonly ReleaseFile[]
}

export interface UpdatesDeps {
  /** This BroBot's version. */
  readonly version: string
  /** Why this build never checks, or null when it does. */
  readonly notHere: 'a-development-build' | 'no-release-feed' | null
  readonly settings: { read(): UpdateSettings; write(settings: UpdateSettings): void }
  /** Ask the release feed: the newer release on this channel, or null when this is the newest. */
  check(channel: UpdateChannel): Promise<FoundUpdate | null>
  /** Download the update the feed offered. */
  download(found: FoundUpdate, onPercent: (percent: number) => void): Promise<void>
  /** Quit and install the update, then start BroCrew again. */
  install(): void
  /** The conversations of this app a restart would stop now — read with no `await`. */
  conversationsARestartWouldStop(): readonly WhatARestartWouldStopIn[]
  /** How many other BroBot workspaces run on this computer, or null when that cannot be read. */
  otherWorkspacesRunning(): Promise<number | null>
  now(): number
  /** Run `run` after `ms`; answers how to cancel it. */
  later(run: () => void, ms: number): () => void
  publish(snapshot: UpdatesSnapshot): void
  log(line: string): void
}

/** The first check comes this long after launch, so it never slows a start. */
export const FIRST_CHECK_AFTER_MS = 30_000
/** Then once a day. */
export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000
/** How often a restart that waits looks again. */
export const QUIET_LOOK_EVERY_MS = 10_000
/** The longest reason a failure gives, so a server's whole answer never lands in the window. */
const LONGEST_REASON = 200

/** What the window may ask to change, read at the wire: anything else is refused. */
export function parseSettingsChange(said: unknown): UpdatesSettingsChange {
  if (typeof said !== 'object' || said === null || Array.isArray(said)) {
    throw new Error('an update setting is an object')
  }
  const { checkAutomatically, channel, ...rest } = said as Record<string, unknown>
  if (Object.keys(rest).length > 0)
    throw new Error(`unknown update settings: ${Object.keys(rest).join(', ')}`)
  if (checkAutomatically !== undefined && typeof checkAutomatically !== 'boolean') {
    throw new Error('checkAutomatically is true or false')
  }
  if (channel !== undefined && channel !== 'stable' && channel !== 'beta') {
    throw new Error('channel is stable or beta')
  }
  return {
    ...(checkAutomatically === undefined ? {} : { checkAutomatically }),
    ...(channel === undefined ? {} : { channel }),
  }
}

/** Read electron-updater's singleton from its CommonJS or named export. */
export function theAutoUpdaterOf(exported: unknown): AppUpdater {
  const named = exported as { autoUpdater?: AppUpdater; default?: { autoUpdater?: AppUpdater } }
  const autoUpdater = named.default?.autoUpdater ?? named.autoUpdater
  if (autoUpdater === undefined) throw new Error('electron-updater has no autoUpdater')
  return autoUpdater
}

export function nothingWouldStop(stops: WhatARestartWouldStop): boolean {
  return stops.conversations.length === 0 && stops.otherWorkspaces === 0
}

/** The first line of what a failure said, no longer than {@link LONGEST_REASON}. */
function firstLineOf(error: unknown): string {
  const said = error instanceof Error ? error.message : String(error)
  const line = said.split('\n')[0]!.trim()
  return line.length > LONGEST_REASON ? `${line.slice(0, LONGEST_REASON - 1)}…` : line
}

/**
 * Why a check failed, in plain words — or null when it did not fail at all: the channel has no
 * release yet (electron-updater's `ERR_UPDATER_LATEST_VERSION_NOT_FOUND` for full releases,
 * `ERR_UPDATER_NO_PUBLISHED_VERSIONS` for betas), so this is the newest there is.
 */
export function whyACheckFailed(error: unknown): string | null {
  const code =
    typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
  if (
    code === 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' ||
    code === 'ERR_UPDATER_NO_PUBLISHED_VERSIONS'
  )
    return null
  if (code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND') {
    return 'the newest release has no update file for this computer'
  }
  if (code === 'HTTP_ERROR_404') return 'its releases could not be found (404)'
  const line = firstLineOf(error)
  const unreachable = /net::ERR_[A-Z_]+|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT/.exec(
    line,
  )
  return unreachable === null ? line : `it could not reach its releases (${unreachable[0]})`
}

/** A line for the log: what the state now is. */
function said(state: UpdateState): string {
  switch (state.kind) {
    case 'not-here':
      return `not checked here (${state.why})`
    case 'idle':
      return state.upToDate ? 'up to date' : 'idle'
    case 'checking':
      return 'checking'
    case 'available':
      return `${state.version} is available`
    case 'downloading':
      return `downloading ${state.version} (${String(state.percent)}%)`
    case 'ready':
      return `${state.version} is ready: restart to update`
    case 'waiting-to-restart':
      return `${state.version} waits to restart until ${String(state.stops.conversations.length)} conversation(s) and ${state.stops.otherWorkspaces === null ? 'any' : String(state.stops.otherWorkspaces)} other workspace(s) are done`
    case 'error':
      return `error: ${state.message}`
  }
}

export interface Updates {
  snapshot(): UpdatesSnapshot
  /** Arm the automatic checks. */
  start(): void
  /** The app is quitting: cancel every timer, and a restart that waits never installs. */
  stop(): void
  checkNow(): Promise<UpdatesSnapshot>
  download(): Promise<UpdatesSnapshot>
  restartWhenQuiet(): UpdatesSnapshot
  cancelRestart(): UpdatesSnapshot
  restartFailed(error: unknown): void
  set(change: UpdatesSettingsChange): UpdatesSnapshot
}

export function createUpdates(deps: UpdatesDeps): Updates {
  let state: UpdateState =
    deps.notHere === null
      ? { kind: 'idle', checkedAt: null, upToDate: false }
      : { kind: 'not-here', why: deps.notHere }
  let found: FoundUpdate | null = null
  let cancelCheck: (() => void) | null = null
  let cancelLook: (() => void) | null = null
  /** Each choice to restart, and each cancel, starts a new one: a look from an older one stops. */
  let restartChoice = 0
  /** A choice to restart stands — from the click, before its first look has answered. */
  let restartChosen = false
  /** The app is quitting: nothing more is armed, and nothing installs. */
  let stopped = false

  const snapshot = (): UpdatesSnapshot => {
    const settings = deps.settings.read()
    return {
      version: deps.version,
      checkAutomatically: settings.checkAutomatically,
      channel: settings.channel,
      state,
    }
  }
  const become = (next: UpdateState): void => {
    state = next
    deps.log(`updates: ${said(next)}`)
    deps.publish(snapshot())
  }
  const failed = (doing: string, why: string): void => {
    become({ kind: 'error', message: `BroCrew could not ${doing}: ${why}`, at: deps.now() })
  }
  /** The automatic check: only when the switch is on now, only from rest, and never a download. */
  const automatically = (): void => {
    cancelCheck = null
    const atRest = state.kind === 'idle' || state.kind === 'error'
    if (atRest && deps.settings.read().checkAutomatically) void checkNow()
    arm(CHECK_EVERY_MS)
  }
  const arm = (after: number): void => {
    cancelCheck?.()
    cancelCheck = null
    if (deps.notHere !== null || stopped) return
    cancelCheck = deps.later(automatically, after)
  }

  async function checkNow(): Promise<UpdatesSnapshot> {
    if (state.kind !== 'idle' && state.kind !== 'error' && state.kind !== 'available') {
      return snapshot()
    }
    const channel = deps.settings.read().channel
    become({ kind: 'checking' })
    try {
      found = await deps.check(channel)
      become(
        found === null
          ? { kind: 'idle', checkedAt: deps.now(), upToDate: true }
          : { kind: 'available', version: found.version },
      )
    } catch (error) {
      found = null
      const why = whyACheckFailed(error)
      if (why === null) become({ kind: 'idle', checkedAt: deps.now(), upToDate: true })
      else failed('check for updates', why)
    }
    return snapshot()
  }

  async function download(): Promise<UpdatesSnapshot> {
    if (stopped || state.kind !== 'available' || found === null) return snapshot()
    let refreshed: FoundUpdate | null = found
    const channel = deps.settings.read().channel
    become({ kind: 'checking' })
    try {
      refreshed = await deps.check(channel)
    } catch (error) {
      deps.log(`updates: could not refresh before download: ${firstLineOf(error)}`)
    }
    if (stopped) return snapshot()
    if (channel !== deps.settings.read().channel) {
      found = null
      become({ kind: 'idle', checkedAt: null, upToDate: false })
      return snapshot()
    }
    found = refreshed
    if (refreshed === null) {
      become({ kind: 'idle', checkedAt: deps.now(), upToDate: true })
      return snapshot()
    }
    const offered = refreshed
    // Told once per whole percent: a download's chunks are thousands, the window needs a hundred.
    let told = -1
    const progress = (percent: number): void => {
      const now = Math.round(percent)
      if (now === told) return
      told = now
      become({ kind: 'downloading', version: offered.version, percent: now })
    }
    progress(0)
    try {
      await deps.download(offered, progress)
      become({ kind: 'ready', version: offered.version, how: 'restart', path: null })
    } catch (error) {
      failed(`download ${offered.version}`, firstLineOf(error))
    }
    return snapshot()
  }

  function restartWhenQuiet(): UpdatesSnapshot {
    const ready = state
    if (
      stopped ||
      !((ready.kind === 'ready' && ready.how === 'restart') || ready.kind === 'waiting-to-restart')
    ) {
      return snapshot()
    }
    const version = ready.version
    const choice = ++restartChoice
    restartChosen = true
    let otherWorkspaces = ready.kind === 'waiting-to-restart' ? ready.stops.otherWorkspaces : null
    const wait = (stops: WhatARestartWouldStop): void => {
      if (
        state.kind !== 'waiting-to-restart' ||
        JSON.stringify(state.stops) !== JSON.stringify(stops)
      ) {
        become({ kind: 'waiting-to-restart', version, stops })
      }
      cancelLook = deps.later(() => void look(), QUIET_LOOK_EVERY_MS)
    }
    const look = async (): Promise<void> => {
      cancelLook = null
      if (choice !== restartChoice) return
      try {
        // This app's conversations first: while one is busy the computer's process list is not
        // read at all (on Windows that is a PowerShell, every look).
        const busy = deps.conversationsARestartWouldStop()
        if (busy.length > 0) {
          wait({ conversations: busy, otherWorkspaces })
          return
        }
        otherWorkspaces = await deps.otherWorkspacesRunning()
        // Cancelled, chosen again, or quitting, while it looked: the latest word stands.
        if (choice !== restartChoice) return
        // A process list that could not be read is no reason to wait forever: it counts as none.
        if (otherWorkspaces === null) {
          deps.log('updates: other BroCrew windows could not be counted; restarting anyway')
          otherWorkspaces = 0
        }
        // Read again after that wait, and install in the same turn: a turn that started
        // while the process list was read is seen here, and none can start after this read.
        const stops = { conversations: deps.conversationsARestartWouldStop(), otherWorkspaces }
        if (!nothingWouldStop(stops)) {
          wait(stops)
          return
        }
        restartChosen = false
        restartChoice += 1
        deps.log(`updates: restarting to install ${version}`)
        deps.install()
      } catch (error) {
        if (choice !== restartChoice) return
        restartChosen = false
        failed('restart to update', firstLineOf(error))
      }
    }
    cancelLook?.()
    void look()
    return snapshot()
  }

  function cancelRestart(): UpdatesSnapshot {
    if (!restartChosen) return snapshot()
    restartChosen = false
    restartChoice += 1
    cancelLook?.()
    cancelLook = null
    if (state.kind === 'waiting-to-restart') {
      become({ kind: 'ready', version: state.version, how: 'restart', path: null })
    }
    return snapshot()
  }

  function set(change: UpdatesSettingsChange): UpdatesSnapshot {
    const was = deps.settings.read()
    const settings = {
      checkAutomatically: change.checkAutomatically ?? was.checkAutomatically,
      channel: change.channel ?? was.channel,
    }
    deps.settings.write(settings)
    // An offer from the other channel is not this one's: it is asked again.
    if (settings.channel !== was.channel && state.kind === 'available') {
      found = null
      state = { kind: 'idle', checkedAt: null, upToDate: false }
    }
    arm(FIRST_CHECK_AFTER_MS)
    deps.publish(snapshot())
    return snapshot()
  }

  return {
    snapshot,
    start: () => arm(FIRST_CHECK_AFTER_MS),
    stop: () => {
      stopped = true
      restartChosen = false
      restartChoice += 1
      cancelCheck?.()
      cancelLook?.()
      cancelCheck = null
      cancelLook = null
    },
    checkNow,
    download,
    restartWhenQuiet,
    cancelRestart,
    restartFailed: (error) => {
      if (stopped || (state.kind !== 'ready' && state.kind !== 'waiting-to-restart')) return
      cancelRestart()
      failed('restart to update', firstLineOf(error))
    },
    set,
  }
}
