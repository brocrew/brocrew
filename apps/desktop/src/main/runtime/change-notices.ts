import type { RuntimeChangeMessage, RuntimeChangeSubject } from '../../shared/runtime-ipc'

/**
 * The windows' change notices, gathered for one turn of the loop: a burst of announcements moves
 * the same lists many times, and each notice makes every window read them again, so one notice per
 * subject is sent once the turn ends.
 */
export function changeNotices(
  send: (message: RuntimeChangeMessage) => void,
  schedule: (flush: () => void) => void,
): { announce(message: RuntimeChangeMessage): void } {
  const moved = new Set<RuntimeChangeSubject>()
  const flush = (): void => {
    const subjects = [...moved]
    moved.clear()
    for (const what of subjects) send({ what })
  }
  return {
    announce(message) {
      if (moved.size === 0) schedule(flush)
      moved.add(message.what)
    },
  }
}
