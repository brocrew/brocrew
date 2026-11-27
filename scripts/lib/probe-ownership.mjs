import { tearDownAndRemove } from './owned-teardown.mjs'
import { listenersOn } from './renderer-cdp.mjs'

/** What a probe throws when it could not take ownership of the app it launched; its userData stays. */
export function ownershipNotTaken(child, userDataDir, error) {
  return new Error(
    `could not take ownership of the app this probe launched (pid ${String(child.pid)}): ` +
      `${error.message}\n   ⚠️ ${userDataDir} is left in place.`,
    { cause: error },
  )
}

/** A probe's stop: the owned teardown reaps what it launched and removes `userDataDir`. */
export function stopWhatItOwns(lifecycle, child, userDataDir) {
  return () => {
    const outcome = tearDownAndRemove({ lifecycle, directory: userDataDir })
    child.stdout.destroy()
    child.stderr.destroy()
    return outcome
  }
}

/**
 * 🔒 The listener really is ours: every pid on the debugging port is one this probe owns.
 *
 * ⚑ `identities` is the launcher plus every descendant `refreshDescendants` has remembered — the
 * same set the teardown holds authority over. Asking anything else would let a probe approve a
 * listener it has no right to signal.
 */
export function refuseAListenerNotOwned(port, lifecycle) {
  const owned = new Set(lifecycle.identities.map((identity) => identity.pid))
  const listeners = listenersOn(port)
  if (!listeners.asked) {
    throw new Error(
      `could not establish who is listening on 127.0.0.1:${String(port)} — ${listeners.why}. ` +
        `A probe that cannot say the app it is driving is its own must not drive it.`,
    )
  }
  if (listeners.pids.length === 0 || !listeners.pids.every((pid) => owned.has(pid))) {
    throw new Error(
      `the debugging port ${String(port)} is held by pid(s) ${listeners.pids.join(', ') || '<none>'}, ` +
        `which this probe does not own (${[...owned].join(', ')}). ⛔ Refusing to drive an app ` +
        `this process did not start — :9444 and the default userData are the PM's.`,
    )
  }
}
