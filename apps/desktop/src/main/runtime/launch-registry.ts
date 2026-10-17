/**
 * **Nothing this app can spawn is unowned — from before it exists until it is confirmed gone**
 * (070, from 068 findings 1, 2, 3 and 7).
 *
 * ## The one shape behind four findings
 *
 * 062 gave sessions a reservation taken before the spawn, and that was the right idea in the wrong
 * scope. The independent review broke it at both ends and found the same defect four times:
 *
 *  - a launch that timed out could not be TERMINATED, only stopped being waited for — the host had
 *    no handle for a provider whose handshake never answered, and Codex creates its detached child
 *    before that handshake;
 *  - hand-back released the reservation and *then* closed the handle, so a resume of the same
 *    record could start a second provider while the first was still closing;
 *  - a stop that timed out released ownership anyway, and the archive that followed was recorded as
 *    if the file it copied were final;
 *  - the model probe was outside all of it, for the single reason that every mechanism was about
 *    sessions and a probe is not one — while spending up to 15 seconds with a real provider child.
 *
 * One sentence covers all four: **ownership was recorded after an asynchronous external spawn, and
 * released before termination was confirmed.** This module is the other answer to that sentence, and
 * the reason it is one module rather than four patches is that the fourth case had no session id to
 * hang a fix on. A launch is not a session. It is *"we asked a provider for something, and a process
 * may now exist"* — which is exactly as true of a model-list probe as it is of `resumeSession`.
 *
 * ## What it does NOT do
 *
 * It does not replace 062's `SessionSlot` and does not touch 062's `ArchiveCoordinator`, which 068
 * called sound. A slot owns an ID (so two resumes of one record cannot both proceed); a launch owns
 * a PROCESS (so nothing spawned is unreachable, and nothing unterminated is forgotten). A session
 * start is both, and the slot holds its launch — see `RuntimeHost.reserve`.
 */

/** One thing the host has asked a provider for that can become — or still be — a process. */
export interface Launch {
  /** What to call it in a warning. Not an identity; two launches may read the same. */
  readonly what: string
  /**
   * The session id this launch belongs to, or null for one that belongs to none (a model probe).
   *
   * It is what {@link LaunchRegistry.refuse} answers about, and the reason a probe carries `null`
   * rather than a synthetic id: a probe genuinely has no session, and giving it a fake one would
   * make `refuse` able to reject a real session because a probe had not finished.
   */
  readonly subject: string | null
  /**
   * Handed to the adapter as `ProviderRuntimeContext.signal`. Aborting it reaches a provider whose
   * handle we never received — the case 068 named as unreachable.
   */
  readonly signal: AbortSignal
  /**
   * Settles when this launch is over AND everything it created is confirmed down.
   *
   * ⚠️ **Never rejects**, whatever the launch or its teardown did. It is awaited by shutdown, and a
   * rejection there would be an unhandled one — there is nobody above a quit.
   */
  readonly settled: Promise<void>
}

/**
 * How a launch ended, in the only two shapes that differ.
 *
 * `terminated` is the promise that settles when the process is REALLY gone — unbounded, because the
 * bound belongs to whoever is waiting, not to the fact. Omitted means there is nothing left running:
 * the launch produced no process, or it produced a handle that is now somebody else's to close.
 */
export interface LaunchRegistry {
  /**
   * Take ownership of a launch BEFORE the spawn.
   *
   * Throws when the registry is closed (a quit has started, so nothing new may spawn) and when
   * `subject` already has an unfinished launch. Both refusals are the point: this is the only door.
   */
  open(what: string, subject?: string | null): Launch
  /**
   * Why `subject` cannot be launched right now, or null.
   *
   * Separate from {@link open} so a caller with its own reservation (a session slot) can ask the
   * question without taking a launch, and phrase the refusal in its own vocabulary.
   */
  refuse(subject: string): string | null
  /**
   * Give a launch back. `terminated`, when given, is what the registry waits for before letting the
   * launch go — so a bounded caller may stop waiting while ownership does not.
   *
   * Idempotent: the first call decides.
   */
  finish(launch: Launch, terminated?: PromiseLike<unknown>): void
  /**
   * Cancel ONE launch — the single-session half of {@link closeAdmission}, for a window that went
   * away or a Close pressed while the provider was still starting.
   */
  cancel(launch: Launch): void
  /**
   * Refuse everything from here on and abort every launch in flight.
   *
   * Called first thing in a shutdown, before anything is awaited — a launch admitted after the
   * registry has been read is a process with nobody left to stop it, which is the whole failure.
   */
  closeAdmission(): void
  /**
   * 🔴 **Every subject this registry would refuse right now** (265 §3, from 259 lens B finding 3).
   *
   * ⛔ **{@link refuse} answers one question and could not be ASKED by another host.** The retained
   * tail below is the whole point of `finish(launch, terminated)`: a bounded stop that gave up keeps
   * owning the subject until the real termination settles. But a registry is private to one
   * `RuntimeHost` while cross-host exclusion runs over the shared ledger — so host B, resuming a
   * session whose slot host A has already deleted, asked B's own registry and was told nothing. Two
   * providers, one native transcript. This is what `RuntimeHost.workInFlight` needs to publish so the
   * question crosses hosts, and it is deliberately the SAME set `refuse` walks rather than a second
   * record of it.
   *
   * ⚠️ Non-null subjects only: a model probe has none, and a synthetic id would let a probe refuse a
   * real session — the reason {@link Launch.subject} is nullable in the first place.
   */
  subjects(): Iterable<string>
  /** Whether {@link closeAdmission} has been called. */
  readonly closed: boolean
  /** Everything still owned, so a shutdown can wait for it. Never rejects; may be empty. */
  pending(): Promise<void>
  /** How many launches are still owned. For tests and diagnostics. */
  readonly size: number
}

interface Entry {
  readonly launch: Launch
  readonly abort: AbortController
  readonly release: () => void
  finished: boolean
}

export function createLaunchRegistry(): LaunchRegistry {
  const entries = new Set<Entry>()
  let closed = false

  const refuse = (subject: string): string | null => {
    if (closed) return 'BroCrew is shutting down'
    for (const entry of entries) {
      if (entry.launch.subject === subject) {
        // The wording matters more than it looks: "already open" would send whoever reads it looking
        // for a session they can close, and this is the opposite state — one we could not confirm
        // is gone. See `RuntimeHost.handBack`, which is what leaves a launch in it.
        return 'its provider has not confirmed it stopped'
      }
    }
    return null
  }

  return {
    open(what, subject = null) {
      const why = subject === null ? (closed ? 'BroCrew is shutting down' : null) : refuse(subject)
      if (why !== null) throw new Error(`${what} was refused: ${why}`)
      const abort = new AbortController()
      let release!: () => void
      const settled = new Promise<void>((resolve) => {
        release = resolve
      })
      const entry: Entry = {
        launch: { what, subject, signal: abort.signal, settled },
        abort,
        release,
        finished: false,
      }
      entries.add(entry)
      return entry.launch
    },

    refuse,

    finish(launch, terminated) {
      for (const entry of entries) {
        if (entry.launch !== launch) continue
        if (entry.finished) return
        entry.finished = true
        if (terminated === undefined) {
          entries.delete(entry)
          entry.release()
          return
        }
        // ⚠️ **The ownership outlives the waiting, and this line is the whole of 068 finding 2's
        // second half.** A caller that bounds its wait (every one of ours does, so a wedged provider
        // cannot hang a quit) must not thereby declare the process gone. The entry stays — so
        // `refuse` keeps refusing and `pending` keeps counting it — until the real termination
        // settles, however long that is and whether it succeeds or throws.
        void Promise.resolve(terminated).then(
          () => {
            entries.delete(entry)
            entry.release()
          },
          () => {
            entries.delete(entry)
            entry.release()
          },
        )
        return
      }
    },

    subjects() {
      const held: string[] = []
      for (const entry of entries) {
        if (entry.launch.subject !== null) held.push(entry.launch.subject)
      }
      return held
    },

    cancel(launch) {
      for (const entry of entries) {
        if (entry.launch === launch) {
          entry.abort.abort()
          return
        }
      }
    },

    closeAdmission() {
      closed = true
      // A copy, because aborting can synchronously finish a launch and delete its entry.
      for (const entry of [...entries]) entry.abort.abort()
    },

    get closed(): boolean {
      return closed
    },

    pending() {
      return Promise.all([...entries].map((entry) => entry.launch.settled)).then(() => undefined)
    },

    get size(): number {
      return entries.size
    },
  }
}
