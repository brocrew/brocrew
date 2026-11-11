import { CODEX_CONFIG_LAYOUT } from '@brobot2/runtime/codex'
import { usageWindow } from './usage-window'

export const metadata = {
  usageWindow,
  signInKey: () => 'codex',
  signInConflict(holder: string, asked: string): Error {
    if (holder === asked)
      return new Error('a codex sign-in is already in progress for this profile')
    return new Error(
      `a codex sign-in is already in progress for the profile "${holder}" — only one can run ` +
        'at a time, because codex sends its browser redirect to one fixed port on this machine. ' +
        'Finish or cancel that one, then try again.',
    )
  },
  config: CODEX_CONFIG_LAYOUT,
  deletionWords: [
    ["the machine's conventional Codex home", 'Codex’s own folder'],
    ['the CODEX_HOME this shell redirects to', 'the folder Codex is set to keep its files in'],
  ],
  launch: { freshTimeoutMs: 15_000, resumeTimeoutMs: 60_000 },
} as const

export { isNativeAccountTag as isRecordedAccountTag } from '@brobot2/runtime/codex'
