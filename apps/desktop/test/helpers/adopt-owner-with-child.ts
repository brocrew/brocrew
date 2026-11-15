import type { SessionStore } from '../../src/main/db/session-store'

export function adoptOwnerWithChild(store: SessionStore, id: string, cwd: string, title: string) {
  store.adopt({
    id,
    provider: 'codex',
    sessionId: `fictional-${id}`,
    cwd,
    profileId: 'fictional',
    createdAt: 1,
    updatedAt: 1,
  })
  store.append(
    id,
    0,
    {
      type: 'work_given',
      piece: `${id}-child`,
      parent: store.rootOf(id)!.piece,
      label: `${store.rootOf(id)!.label}.1`,
      givenBy: 'alpha',
      title,
      brief: 'Fictional',
    },
    1,
  )
}
