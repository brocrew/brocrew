import type { RuntimeChangeMessage, RuntimeChangeSubject } from '../../shared/runtime-ipc'

/**
 * The windows' change notices, gathered for one turn of the loop: a burst of announcements moves
 * the same lists many times, and each notice makes every window read them again, so one notice per
 * subject is sent once the turn ends: the newest announced for it, with the stamp it carries.
 */
export function changeNotices(
  send: (message: RuntimeChangeMessage) => void,
  schedule: (flush: () => void) => void,
): { announce(message: RuntimeChangeMessage): void } {
  // The newest message announced for each subject, stamp and all, in the order subjects first moved.
  const moved = new Map<RuntimeChangeSubject, RuntimeChangeMessage>()
  const flush = (): void => {
    const messages = [...moved.values()]
    moved.clear()
    for (const message of messages) send(message)
  }
  return {
    announce(message) {
      if (moved.size === 0) schedule(flush)
      moved.set(message.what, message)
    },
  }
}
