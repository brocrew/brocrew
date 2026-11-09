import { CLAUDE_CONFIG_LAYOUT } from '@brobot2/runtime/claude'

export const metadata = {
  signInKey: (profileId: string) => `claude:${profileId}`,
  signInConflict(holder: string, asked: string): Error {
    if (holder === asked) return new Error('a claude sign-in is already in progress for this profile')
    return new Error(`a claude sign-in is already in progress for the profile "${holder}" — only one can run ` +
      'at a time, because claude sends its browser redirect to one fixed port on this machine. ' +
      'Finish or cancel that one, then try again.')
  },
  config: CLAUDE_CONFIG_LAYOUT,
  deletionWords: [
    ["the machine's conventional Claude home", 'Claude’s own folder'],
    ['the CLAUDE_CONFIG_DIR this shell redirects to', 'the folder Claude is set to keep its files in'],
  ],
  launch: { freshTimeoutMs: 15_000, resumeTimeoutMs: 15_000 },
} as const
