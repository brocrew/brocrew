import { ROW_CONVERSATIONS } from './one-conversation'

/** 🎨 The rail's made-up workspace and conversations ({@link ROW_CONVERSATIONS}). Fake data only. */
export const WORKSPACE = {
  name: 'Default',
  path: '/Users/someone/Library/Application Support/@brobot2/desktop',
  isDefault: true,
}

/** Answers the rail's reads with the three conversations; the one named by `needsYou` needs you. */
export function stubRail(needsYou?: string): void {
  window.api = {
    runtime: {
      listResumable: async () =>
        ROW_CONVERSATIONS.map((one, index) => ({
          sessionId: one.id,
          provider: 'claude',
          cwd: '/Users/someone/BroBot workspaces/Default/brobot-workspace',
          status: 'idle',
          state: { is: one.id === needsYou ? 'needs-you' : 'idle' },
          label: one.label,
          profileId: one.profileId,
          named: { label: one.title.split(' · ')[0], title: one.title.split(' · ')[1] },
          updatedAt: Date.now() - index * 60_000,
          createdAt: Date.now() - 3_600_000,
          running: 'unwatched',
          inAnotherWindow: false,
        })),
      listUnresumable: async () => [],
    },
  } as never
}
