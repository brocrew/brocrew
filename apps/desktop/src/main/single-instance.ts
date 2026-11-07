import type { HostGateVerdict } from './one-host-gate'

export const SECOND_LAUNCH_NOTICE =
  'BroCrew is already running — this is that window. A second copy would share one database and ' +
  'the same sign-ins with this one, so it was not started.'

export const STOOD_DOWN_NOTICE =
  'BroCrew is already running for this user-data directory; the running window was brought ' +
  'forward instead. This second launch is exiting.'

export interface SoleInstanceDeps {
  requestLock: () => boolean
  onSecondLaunch: (handler: () => void) => void
  focusExisting: () => void
  announce: (message: string) => void
  standDown: () => void
  start: (ownership: HostGateVerdict) => void
  log: (message: string) => void
}

export type InstanceVerdict = 'sole' | 'already-running'

/** Electron's OS lock is the ownership decision for this data folder. */
export async function runAsSoleInstance(deps: SoleInstanceDeps): Promise<InstanceVerdict> {
  if (!deps.requestLock()) {
    deps.log(STOOD_DOWN_NOTICE)
    deps.standDown()
    return 'already-running'
  }
  deps.onSecondLaunch(() => {
    deps.focusExisting()
    deps.announce(SECOND_LAUNCH_NOTICE)
  })
  deps.start('sole')
  return 'sole'
}
