import {
  type AdoptionReport,
  type SkippedSessionInfo,
  type ImportedRecording,
  providerName,
  type ImportedFromHome,
  type RebuiltLedger,
  type RunningState,
  type RuntimeChangeMessage,
  type LedgerStatus,
} from '../../../shared/runtime-ipc'
import { errorMessage } from '../session-disclosures'
import type { ResumableSession, SessionStore } from '../../db/session-store'
import { type DeriveOutcome, deriveLedger } from '../../archive/derive-ledger'
import { DEFAULT_PROFILE_ID } from '../../connections/homes'
import type { Provider } from '@brobot2/shared'
import { readLines } from '../../archive/native-file'
import {
  COPY_SLICE_BYTES,
  COPY_SLICE_ROWS,
  COPY_SLICE_TARGET_MS,
  COPY_BUSY_WAIT_MS,
  SAY_COPY_PROGRESS_EVERY_MS,
} from './answer-reads'
import { type LibraryQuery, type LibraryPage, readLibrary } from '../../library/session-library'
import {
  importFromHome,
  describeOutcome,
  type HomeConversation,
} from '../../archive/import-from-home'
import type { ResolveImagePath } from '../../archive/transcript-types'
import { providerDefinitions } from '../../providers/index'
import { resolveAssetRequest } from '../../asset-protocol'
import { assetUrl } from '../../../shared/asset-url'
import { createArchiveCoordinator } from '../../archive/archive-coordinator'
import type { UserHomeDiscovery } from '../../adopt/user-homes'
import type { SessionSlot } from './session-slot'
import type { ArchivedConversations } from '../../archived-file'
import type { RuntimeHostDeps } from '../host-dependencies'

/** What LibraryImport reaches in RuntimeHost, each read only when called. */
interface LibraryImportHost {
  slots(): ReadonlyMap<string, SessionSlot>
  startupRepairs(): ReadonlySet<string>
  archived(): ArchivedConversations
  workRunningElsewhere(): ReadonlySet<string>
  runningStateOf(sessionId: string): RunningState
  theWorldMoved(what: RuntimeChangeMessage['what']): void
  whileBuilding<T>(sessionId: string, run: () => Promise<T>): Promise<T>
  howAFailureReads(error: unknown, readsTranscripts: boolean): string
  settleBeforeUse(owner: string): Promise<void>
  status(sessionId: string): LedgerStatus
  providerHomeFor(session: Pick<ResumableSession, 'adoptedAt' | 'profileId' | 'provider'>): string
  now(): number
}

/** Conversations brought into the Library and their records kept whole, on the one archive lane. */
export class LibraryImport {
  /** The two archive lanes and the drain, in one object (062). See `archive-coordinator.ts`. */
  private readonly archives = createArchiveCoordinator()
  /** The row bound of the next slice filling question copies, adapted to its time target. */
  private copySliceRows: number = COPY_SLICE_ROWS.first
  /** The pause before a slice that found the write lock taken is tried again. */
  private copyBusyWait: number = COPY_BUSY_WAIT_MS.least
  private readonly copiesFilled = { visited: 0, matched: 0, saidAt: Number.NEGATIVE_INFINITY }

  constructor(
    private readonly deps: { readonly store: SessionStore } & Pick<
      RuntimeHostDeps,
      | 'discoverSessions'
      | 'indexedDescriptions'
      | 'nativeTranscriptPath'
      | 'newSessionId'
      | 'providerHomePath'
      | 'userHomeSessions'
    >,
    private readonly host: LibraryImportHost,
  ) {}

  /**
   * Record a pointer to every conversation found in the provider homes that we have never seen
   * before, so it can be reopened like any other (087).
   *
   * It records a POINTER and nothing more: the provider still holds the conversation, and its
   * messages are not imported. What we write is what the provider's own files say — id, cwd,
   * profile, when it was last touched — and the approval mode stays unrecorded, because we did
   * not run it and inventing `ask` or `auto` would be a claim about what that agent was allowed
   * to do.
   *
   * Idempotent by asking the store first: scanning twice offers one session, not two.
   */
  async adoptSessions(): Promise<AdoptionReport> {
    const { found, skipped } = this.deps.discoverSessions()
    let adopted = 0
    let alreadyKnown = 0
    /**
     * ⚑ **What the scan's own freshness note says it did** (121). `120`'s design draws the button's
     * result as *"N new, M descents back-filled"*, and until this line the report had no such
     * number — so the caption would have had to invent one. It counts the store's answer, not this
     * loop's: only the store can see the value the merge ran against, so only the store can say
     * whether anything actually changed.
     */
    let descentsLearned = 0
    /** ⚑ 727 · rows of ours this pass gave back their ref — see `nameItsLaunch`. */
    let named = 0

    // A session this host is running right now is not an orphan, even if its row has no ref
    // yet: Claude names a session only on its first turn, so a scan in that window would find
    // the transcript being written and adopt a second pointer to the live conversation.
    //
    // ⚠️ REGISTERED sessions only, and by decision rather than oversight (062): a slot that is
    // still starting has no handle to read a ref from and no cwd of its own, so there is nothing it
    // could contribute here. What covers that interval is that this pass adopts a transcript the
    // provider has already written, and a provider that has not finished starting has not written
    // one.
    const live = new Set(
      [...this.host.slots().values()]
        .flatMap((slot) => (slot.session === null ? [] : [slot.session]))
        .flatMap((session) => [
          `${session.provider}\u0000${session.handle.ref?.sessionId ?? ''}`,
          `${session.provider}\u0000cwd:${session.cwd}`,
          // ⚑ **727 · no launch-id key any more, and R87 is why.** `722` keyed this set on the id
          // a live launch asked for, because a launch before init matched neither key above when the
          // CLI recorded its folder by another spelling. Since R87 that id is in the ROW, written
          // before the CLI can write, so `findByProviderRef` answers it first, live or not.
        ]),
    )

    for (const session of found) {
      const known = this.deps.store.findByProviderRef(session.provider, session.sessionId)
      if (known !== null) {
        // 🔴 **727 · R87 — a launch of ours that never got its ref is given the one read here**:
        // killed between the CLI's first write and `system/init`, errored before init, or closed
        // past its exit receipt. ⛔ Only a row with NO ref, and only by the id it launched with —
        // see `nameItsLaunch`. Without this the conversation would be known and unreachable: not
        // adopted as a second row, and not reopenable as its own.
        // ⛔ **Not a LIVE one** (the `727` review, round 2): a launch still running before its init
        // is named by its own init or close, and a scan that named it would tell a person a running
        // conversation *"can be reopened again"*. ⚑ `runningStateOf`, so a slot on its way out —
        // R87's close-receipt timeout — is not live here.
        if (
          this.host.runningStateOf(known) === 'not-running' &&
          this.deps.store.nameItsLaunch(known, {
            provider: session.provider,
            sessionId: session.sessionId,
            cwd: session.cwd,
            rotation: 0,
          })
        )
          named++
        // Already ours. Carry the provider's newer timestamp over so the list stays in the
        // order the conversations were actually last used.
        //
        // ⚑ **…and the descent, which was right here and was being thrown away** (119). `111`
        // recorded it on INSERT and only on INSERT, so every row adopted before that migration
        // stayed NULL — and `118` hangs the Resume refusal on that column, which made it a rule
        // that held only for rows recorded after a certain date. This branch is the one place the
        // live home and our row are both in scope. What the store does with the two answers, and
        // in particular what it refuses to erase, is `mergeDescent`.
        if (this.deps.store.refreshAdopted(known, session.updatedAt, session.child))
          descentsLearned++
        alreadyKnown++
        continue
      }
      if (
        live.has(`${session.provider}\u0000${session.sessionId}`) ||
        live.has(`${session.provider}\u0000cwd:${session.cwd}`)
      ) {
        alreadyKnown++
        continue
      }
      const id = this.deps.newSessionId()
      this.deps.store.adopt({
        id,
        provider: session.provider,
        sessionId: session.sessionId,
        cwd: session.cwd,
        profileId: session.profileId,
        updatedAt: session.updatedAt,
        createdAt: session.createdAt,
        // 111 — recorded HERE or nowhere. Discovery can read the descent only while the provider
        // still holds the thread; the row outlives the file.
        ...(session.child ? { child: session.child } : {}),
      })
      // ⚑ **This branch counts too, and the first version did not** (review). A descent written on
      // INSERT is as recorded as one merged into an existing row — so the first scan of a home
      // holding twenty children would have reported "20 adopted" and no descents, about twenty
      // descents it had just written and which the Kind facet was already showing.
      if (session.child) descentsLearned++
      adopted++
    }

    // 🔴 **534 · the scan's own rows, announced before the slow half below.**
    //
    // ⛔ **The fourth writer of a session row** — and the only one that can write many at once. ⚠️
    // It is a person's button today, and the window that pressed it re-reads its own list; the
    // announcement is here for {@link RuntimeHost.createAgent}'s reason, which is that the category
    // is *a row was written* and not *a row was written by a caller nobody can tell*.
    //
    // ⚑ **Before the import pass**, which walks every recorded session and can take seconds: the rows are already in the database, so making the rail wait for a sweep it does not
    // read would be an announcement timed to the wrong fact.
    // ⚑ **727 · …and a row this pass NAMED is written too**: it moves from the half a reopen cannot
    // reach to the half it can, and a rail that did not press the scan would keep saying otherwise.
    if (adopted > 0 || named > 0) this.host.theWorldMoved('conversations')

    // Importing runs over EVERY recorded session, not just the ones adopted just now: a session
    // recorded before any of this existed has a provider file too, and this is the pass that
    // catches up with it.
    const imported = await this.importAll(skipped)
    return {
      found: found.length,
      adopted,
      alreadyKnown,
      imported,
      descentsLearned,
      named,
      skipped,
    }
  }

  /**
   * Read each recorded session's own provider file into a ledger, for any session that has a file
   * but no conversation of its own yet.
   *
   * Catch-up work, so idempotent: a session that already has any ledger — a live one, or one
   * imported by an earlier pass — is left alone. Two producers writing the same ledger would show
   * the conversation twice, which is worse than not importing at all.
   *
   * Admitted through the coordinator's background lane, so it queues behind any other import and
   * the shutdown waits for it.
   */
  private async importAll(skipped: SkippedSessionInfo[]): Promise<number> {
    // Refused rather than queued once the gate is shut, and reported as the nothing that it is —
    // the adopt pass has already recorded what it found, and that half stands.
    if (this.archives.backgroundClosed) return 0
    return this.archives.background((cancelled) => this.runImportAll(skipped, cancelled))
  }

  private async runImportAll(
    skipped: SkippedSessionInfo[],
    cancelled: () => boolean,
  ): Promise<number> {
    let imported = 0

    for (const session of this.deps.store.resumable()) {
      // Between sessions as well as between batches: the shutdown is about to close the database.
      if (cancelled()) break
      // A session that is open right now is still being written to, and its ledger is the
      // recording itself. Slots, not registered sessions: one still starting counts too.
      if (this.host.slots().has(session.sessionId)) continue
      // One session that cannot be read must not end the pass for all the ones after it — and
      // it is reported rather than swallowed, so "nothing happened" never hides a failure.
      try {
        const outcome = await this.importOne(session, cancelled)
        if (outcome === 'imported') imported++
        // Said in the same words the Library uses for the same outcome, and the loop ends: the
        // answer to "may I continue" does not change on the next one.
        if (outcome === 'stopped') {
          skipped.push({
            provider: session.provider,
            path: session.sessionId,
            reason: 'its transcript was not read: the app is shutting down',
          })
          break
        }
        if (outcome === 'nothing-readable') {
          skipped.push({
            provider: session.provider,
            path: session.sessionId,
            reason: 'its provider file holds no readable conversation',
          })
        }
      } catch (error) {
        console.warn(
          `runtime session ${session.sessionId} could not be imported: ${errorMessage(error)}`,
        )
        skipped.push({
          provider: session.provider,
          path: session.sessionId,
          // 🔴 **710 · second review** — a shortage in words (see {@link howAFailureReads}).
          reason: `could not be imported: ${this.host.howAFailureReads(error, true)}`,
        })
      }
    }

    return imported
  }

  /**
   * **Read one recorded session's own provider file into a ledger**, if it has none.
   *
   * ⚑ The body of the catch-up loop above, and also what a single row's Import runs — see
   * {@link importRecordedSession} — so the two cannot disagree about what "already imported" means.
   *
   * `skipped` when there is no file to read, or a ledger is already here.
   */
  private async importOne(
    session: ResumableSession,
    cancelled: () => boolean,
  ): Promise<DeriveOutcome> {
    // ⛔ **The PATH, never the launch call** ({@link RuntimeHostDeps.providerHomePath}). Reading a
    // transcript file this app already holds needs no credential: `prepareProviderHome` probes
    // Claude's login or key and throws without one. A home that was never made holds no transcript.
    const providerHome = this.deps.providerHomePath(
      session.provider,
      session.profileId ?? DEFAULT_PROFILE_ID,
    )
    const path = this.deps.nativeTranscriptPath(session.provider, providerHome, session.ref)
    if (path === null) return 'skipped'
    return await this.importTranscript(session.sessionId, session.provider, path, cancelled)
  }

  /**
   * **Import ONE recorded conversation's prior messages, from the home this app provisioned** (119,
   * from `118` §8.3 — PM ruling: *"put it on the row"*).
   *
   * ## The defect it answers
   *
   * An adopted row whose transcript we do not hold says so, in its own meta line: *"prior messages
   * not imported yet"*. It offered export, and nothing that imports. ⛔ That is `106`'s unwired
   * control wearing the other face — `106` forbade a control that looks like it does something and
   * does not; **a sentence naming an action with no control anywhere is the same lie told by
   * omission.**
   *
   * ## ⚠️ Why the Library's Import could not simply be widened, and was not
   *
   * `canImport` requires `recordId === null`, and that condition is **right where it is**. The
   * Library's Import is `importUserHomeSession`: it looks the conversation up in
   * `userHomeSessions()`, and it exists to give a file in `~/.claude` or `~/.codex` a row here. This
   * row already HAS a row — it is ours — and its provider file is in a home under `userData` that
   * the user-home reader cannot see, so that command would answer `missing` for a file sitting right
   * there. Two different operations that share a verb. Weakening the condition would have made the
   * Library's Import able to run against a row it would then import a second copy of.
   *
   * ## What it actually is
   *
   * The catch-up pass, pointed at one row — {@link importOne}, the same function the scan
   * runs over every session. Through the background lane for the reasons that lane exists: it queues
   * behind a pass already running, so two importers cannot derive one session's ledger at once, and
   * it is refused rather than started once a quit has begun.
   *
   * `readable` is read back off the ledger, never inferred from the outcome — `importUserHomeSession`
   * learned that the hard way, and an outcome word is not proof.
   */
  async importRecordedSession(sessionId: string): Promise<ImportedRecording> {
    if (this.host.startupRepairs().has(sessionId)) await this.host.settleBeforeUse(sessionId)
    const session = this.deps.store.find(sessionId)
    if (session === null)
      return { outcome: 'unknown-session', readable: false, note: 'There is no such conversation.' }
    // ⚠️ **Asked, never inferred, on every ending — and asked through ONE call site.** Whether
    // there is a conversation to read is the completeness contract's answer (065), and the refusals
    // below owe it as much as the attempt does: a row that already had its messages must not read
    // as having none because the app happened to be shutting down.
    const readable = (): boolean => this.deps.store.ledgerStatus(sessionId).present
    // ⛔ **A row from the user's OWN home is refused here** (119 review). `find()` deliberately
    // keeps returning rows the reopen list drops, so this command — which takes any id — can reach
    // one. `importOne` would then fall back to `DEFAULT_PROFILE_ID`, look in a home that
    // has never held this conversation, find nothing, and answer "there is nothing to import" about
    // a file sitting in `~/.codex`. Naming the control that really can is the honest answer, and it
    // is the Library's.
    if (session.adoptedAt !== null && session.profileId === null)
      return {
        outcome: 'user-home',
        readable: readable(),
        note:
          `This conversation is in ${providerName(session.provider)}'s own folder. ` +
          'Import it from the Library, which is the surface that reads those.',
      }
    if (this.archives.backgroundClosed)
      return {
        outcome: 'refused',
        readable: readable(),
        note: 'The app is shutting down, so nothing was started. The provider file is not going anywhere.',
      }

    // Carried to the row rather than swallowed or logged: the catch-up pass reports the same
    // failure into its `skipped` list, and this one was asked for by a person who is looking at it.
    let failure: string | null = null
    const outcome: ImportedRecording['outcome'] = await this.archives.background(
      async (cancelled) => {
        // ⛔ **Being written to right now — asked HERE, inside the job, and nowhere else** (review).
        //
        // The background lane is a queue: this closure can start long after the command was
        // submitted, behind another import. An answer taken before submitting would be stale by
        // then, and the window is real — the row's other button reopens the conversation, whose
        // recording would then be written beside a projection of the same file.
        //
        // ⚠️ **One check rather than two**, and that is the point: a cheaper pre-check outside would
        // save queuing work that will be refused, and would also be a second answer free to differ
        // from this one. The catch-up loop asks the same question the same way — per session, with
        // no await between asking and acting.
        //
        // 🔴 **…and it asks about the OTHER hosts too** (293 §4, from 289 rank 3). This was the
        // asymmetry: `rebuildLedger` consults {@link workRunningElsewhere} and this did not, so two
        // hosts over one ledger both passed a check that only ever looked at their own map. Both
        // opened a generation, the second replaced the first's `building` marker, and the first's
        // guarded promotion then changed zero rows and still called itself an import. ⚠️ **The same
        // missing question also let a targeted import replace the generation beneath a quiet session
        // another host was resuming.**
        if (this.host.slots().has(sessionId) || this.host.workRunningElsewhere().has(sessionId))
          return 'in-use'
        try {
          // ⛔ **The claim, taken in the same synchronous breath as the check** (293 §4).
          // {@link whileBuilding} is what puts this session into {@link workInFlight}, which is the
          // only thing a peer host can see.
          return await this.host.whileBuilding(sessionId, () => this.importOne(session, cancelled))
        } catch (error) {
          // 🔴 **710 · second review** — a shortage in words (see {@link howAFailureReads}); the
          // errno is logged here, since the row's note no longer carries it.
          console.warn(`runtime session ${sessionId} could not be imported: ${errorMessage(error)}`)
          failure = `it could not be imported: ${this.host.howAFailureReads(error, true)}`
          return 'failed'
        }
      },
    )
    const present = readable()
    // A derive that ran also records a failure, or clears one, which the listing draws.
    if (outcome !== 'in-use' && outcome !== 'skipped') this.host.theWorldMoved('conversations')
    return { outcome, readable: present, note: failure ?? recordingNote(outcome, present) }
  }

  /**
   * Read a session's provider file into its conversation, once, for a session that has none.
   *
   * BOTH providers: Claude's records are the SDK messages the live path already normalizes, and
   * Codex's rollouts have their own importer. This stayed a method because the fallback time is the
   * HOST's to decide — the session row's own start, or its clock.
   *
   * ⚠️ **`cancelled` is REQUIRED**: there is no such thing as an uncancellable background derive,
   * and an optional parameter would leave the next caller free to forget it.
   */
  private async importTranscript(
    sessionId: string,
    provider: Provider,
    path: string,
    cancelled: () => boolean,
  ): Promise<DeriveOutcome> {
    const row = this.deps.store.find(sessionId)
    const resolveImage =
      row === null ? undefined : this.imageResolver(provider, row.ref.sessionId, homeProfileOf(row))
    return this.host.whileBuilding(sessionId, () =>
      deriveLedger(
        this.deps.store,
        sessionId,
        provider,
        (from, maxLines) => readLines(path, from, maxLines),
        {
          // Only if the file names no time at all does the session's own recorded time stand in.
          fallbackAt: row?.createdAt ?? this.host.now(),
          cancelled,
          // The adopt pass derives what has no projection. A stale one is left stale — see
          // {@link rebuildLedger} for the only thing that rebuilds.
          rebuild: false,
          ...(resolveImage ? { resolveImage } : {}),
        },
      ),
    )
  }

  /**
   * **Step one of the shutdown: stop making catch-up work** — imports and rebuilds are refused, and
   * the ones in flight stop at their next batch.
   *
   * Sticky, and safe because the only caller is the real shutdown in `app-lifetime.ts`, never
   * `window-all-closed`.
   */
  /**
   * Fills the copies of older questions, one bounded slice per job of the archive lane, so other
   * archive work runs between slices. A slice that finds the write lock taken is tried again after a
   * pause that doubles, and a slice that commits starts the next on the following turn. Progress is
   * said at most once a minute until the fill is done.
   */
  fillQuestionCopies(): void {
    if (this.archives.backgroundClosed) return
    void this.archives
      .background(async (cancelled) => {
        if (cancelled()) return
        const began = performance.now()
        const slice = this.deps.store.fillQuestionCopies(this.copySliceRows, COPY_SLICE_BYTES)
        const took = performance.now() - began
        this.copiesFilled.visited += slice.visited
        this.copiesFilled.matched += slice.matched
        if (slice.state === 'filled') {
          this.copySliceRows = Math.max(
            COPY_SLICE_ROWS.least,
            Math.min(
              COPY_SLICE_ROWS.most,
              took > COPY_SLICE_TARGET_MS
                ? Math.floor(this.copySliceRows / 2)
                : this.copySliceRows * 2,
            ),
          )
          this.copyBusyWait = COPY_BUSY_WAIT_MS.least
          this.sayHowTheCopiesStand()
          this.nextCopySlice(0)
        } else if (slice.state === 'busy') {
          this.nextCopySlice(this.copyBusyWait)
          this.copyBusyWait = Math.min(COPY_BUSY_WAIT_MS.most, this.copyBusyWait * 2)
        }
      })
      .catch((error: unknown) => {
        console.warn(`runtime host could not fill question copies: ${errorMessage(error)}`)
      })
  }

  /** The next slice, as a new job: this one never waits on it. */
  private nextCopySlice(afterMs: number): void {
    const timer = setTimeout(() => this.fillQuestionCopies(), afterMs)
    if (typeof timer.unref === 'function') timer.unref()
  }

  private sayHowTheCopiesStand(): void {
    const at = this.host.now()
    if (at - this.copiesFilled.saidAt < SAY_COPY_PROGRESS_EVERY_MS) return
    this.copiesFilled.saidAt = at
    console.warn(
      `question copies still filling: ${String(this.copiesFilled.visited)} rows visited, ${String(this.copiesFilled.matched)} copies written`,
    )
  }

  stopSweeping(): void {
    this.archives.rejectNewBackgroundWork()
  }

  /**
   * **Step three: wait for everything that was already admitted, so the database can close.**
   *
   * Without it, SQLite would close while an import admitted before the gate shut was still between
   * batches with a `sessionId` in hand.
   */
  drainArchiveWork(): Promise<void> {
    return this.archives.drain()
  }

  /**
   * The library (047): every conversation this app knows about, from all three sources, as one list.
   *
   * The merge itself is pure and lives in `session-library.ts`; this is only the wiring. Reading it
   * touches the user's homes but changes nothing in them — the Codex index is read through a copy,
   * and the Claude one through the SDK's own read.
   */
  async listLibrary(query: LibraryQuery = {}): Promise<LibraryPage> {
    return readLibrary(
      {
        recorded: () => this.deps.store.recorded(),
        userHomeSessions: this.deps.userHomeSessions ?? (() => ({ found: [], skipped: [] })),
        indexedDescriptions: this.deps.indexedDescriptions ?? (() => Promise.resolve(new Map())),
        // All conversations lists the archived ones too, each with when, so a person can restore it.
        archivedAt: (recordId) => this.host.archived().archivedAt(recordId),
      },
      query,
    )
  }

  /**
   * Import ONE conversation out of the user's own provider home (047): give it a row here, and read
   * its file into a ledger. See {@link importFromHome}.
   *
   * Through the background lane, so it queues behind any other import, and is refused once a quit
   * has begun. Every ending is reported as itself; `up-to-date` is "you already have this".
   */
  async importUserHomeSession(
    provider: Provider,
    providerSessionId: string,
  ): Promise<ImportedFromHome> {
    const found = (this.deps.userHomeSessions?.().found ?? []).find(
      (entry) => entry.provider === provider && entry.sessionId === providerSessionId,
    )

    if (!found) {
      // Not a failure of the import: the conversation is simply not in the home any more. Saying
      // "import failed" for a file the provider has deleted would send someone looking for a bug.
      return {
        outcome: 'missing',
        sessionId: this.deps.store.findByProviderRef(provider, providerSessionId),
        readable: false,
        note: `It is no longer in ${providerName(provider)}'s own folder, so there is nothing left to import.`,
      }
    }
    const source = toHomeConversation(found)

    const outcome = this.archives.backgroundClosed
      ? 'stopped'
      : await this.archives.background((cancelled) =>
          importFromHome(
            {
              store: this.deps.store,
              newSessionId: () => this.deps.newSessionId(),
              lines: (path) => (from, maxLines) => readLines(path, from, maxLines),
              // A `saved_path` may only be believed against the home this conversation ran in.
              resolveImage: this.imageResolver(source.provider, source.sessionId, source.profileId),
            },
            source,
            cancelled,
          ).catch((error: unknown) => {
            console.warn(
              `runtime ${provider} conversation ${providerSessionId} could not be imported: ${errorMessage(error)}`,
            )
            return 'unreadable' as const
          }),
        )

    // Read back rather than assumed: the row and its ledger are the only proof the import landed,
    // and an outcome word is not one.
    const sessionId = this.deps.store.findByProviderRef(provider, providerSessionId)
    if (sessionId !== null) this.host.theWorldMoved('conversations')
    return {
      outcome,
      sessionId,
      readable: sessionId !== null && this.deps.store.ledgerStatus(sessionId).present,
      note: describeOutcome(outcome),
    }
  }

  /**
   * **Rebuild one session's conversation from its provider's file** (065, 061 finding 6).
   *
   * The reachable end of the completeness contract: a projection an older version of the app read,
   * or one whose file has grown since, is read again — and this is deliberately the only thing that
   * does it, because "mark stale, rebuild on request" is the whole policy. Nothing on a timer,
   * nothing in a migration. A conversation whose file is gone keeps what was read and is not
   * offered this.
   *
   * Through the coordinator's **background** lane, which means all three of its properties without a
   * second mechanism (062): it is queued behind any pass already running, so two rebuilds cannot
   * write one session's generation at once; it is cancelled at the next batch boundary once a quit
   * begins; and it is drained before the database closes.
   *
   * A refusal is not a failure. If the gate is already shut, the session is left exactly as it was
   * and the caller is told so — the rebuild is there next time.
   */
  async rebuildLedger(sessionId: string): Promise<RebuiltLedger> {
    if (this.host.startupRepairs().has(sessionId)) await this.host.settleBeforeUse(sessionId)
    // 🔴 **702 · `recordedOne` and NOT `find`** (`697` H-f) — {@link folderOf}'s rule, for its
    // reason. ⛔ `find` *"drops a row with no provider ref"*, so a conversation closed before its
    // provider named it — which the library lists — answered `unknown-session` here (measured on
    // `695`'s run, `sess_9f643857`). ⚑ Such a row is a RECORDING, and the rule below says so.
    const row = this.deps.store.recordedOne(sessionId)
    if (row === null) return { outcome: 'unknown-session', status: null }
    // A session the host is running owns its own ledger — it is being RECORDED, not projected, and
    // replacing it from the file would race the provider still writing it.
    //
    // ⛔ **…and a session ANOTHER live host is running owns it just as much** (198, from 191 H8).
    // `slots` is host-local, so a second host in this process finds the id free, promotes a new
    // active generation underneath the first, and the first's already-written tail becomes
    // unreachable while its next append reuses ordinals in a generation that no longer exists.
    // Same directory, same question, and the same answer as {@link reserve}'s.
    if (this.host.slots().has(sessionId) || this.host.workRunningElsewhere().has(sessionId)) {
      return { outcome: 'in-use', status: this.host.status(sessionId) }
    }
    const before = this.host.status(sessionId)
    // ⚠️ **A recording is not a projection, and rebuilding one would be a DOWNGRADE.** A session
    // this app ran has a ledger written as it happened — `session`, `status` and `turn` events the
    // provider's own file does not contain, because they are our session machine's and not its.
    // Re-deriving that from the file would replace a richer record with a poorer one and call it
    // a repair. Refused by the contract rather than by a flag: `derived === null` IS the statement
    // that this ledger was recorded, and it is the same value the library reads.
    if (before.present && before.derived === null) {
      return { outcome: 'recorded', status: before }
    }
    if (this.archives.backgroundClosed) {
      return { outcome: 'refused', status: this.host.status(sessionId) }
    }
    // ⚑ **The provider's file, wherever this row's home is** — the person's own for a conversation
    // imported from it. ⛔ `find` and not `recordedOne`: a row with no provider id has no file.
    const withRef = this.deps.store.find(sessionId)
    const path =
      withRef === null
        ? null
        : this.deps.nativeTranscriptPath(
            row.provider,
            this.host.providerHomeFor(withRef),
            withRef.ref,
          )
    if (path === null) return { outcome: 'gone', status: before }
    // ONCE, into a local. Calling it inside the spread as well as in the test would build the
    // resolver twice per rebuild — the same shape `importTranscript` already avoids (review, LOW).
    // ⚠️ **702 · no provider id, no folder to name** — the images live under the thread's own id, and
    // a row with none has nothing there to check a claim against.
    const resolveImage =
      row.providerSessionId === null
        ? undefined
        : this.imageResolver(row.provider, row.providerSessionId, homeProfileOf(row))
    // ⛔ **Counted as in flight from before the queue, not from when the lane picks it up** (198).
    // The background lane queues behind any pass already running, so a rebuild can sit here for
    // minutes with a `building` marker about to be written — and a host constructed in that window
    // would be told nothing is building this session.
    const outcome = await this.host.whileBuilding(sessionId, () =>
      this.archives.background((cancelled) =>
        deriveLedger(
          this.deps.store,
          sessionId,
          row.provider,
          (from, maxLines) => readLines(path, from, maxLines),
          {
            fallbackAt: row.createdAt,
            cancelled,
            rebuild: true,
            ...(resolveImage ? { resolveImage } : {}),
          },
        ),
      ),
    )
    // ⚑ What a new generation moves in each state was followed at its promotion
    // ({@link aWholeLedgerChanged}); the work a giver's drawer folds from this ledger may be gone.
    if (outcome === 'imported' || outcome === 'superseded') this.host.theWorldMoved('work')
    // The listing draws the new generation, or the failure or retry a derive records.
    if (outcome !== 'skipped') this.host.theWorldMoved('conversations')
    return { outcome, status: this.host.status(sessionId) }
  }

  /**
   * A checker for one session's generated-image claims, or undefined (065, closing 067's gap).
   *
   * ⚠️ **It is built on the SAME function that serves the image, and that is the point.**
   * `resolveGeneratedImage` in the runtime is deliberately not exported — it resolves against the
   * home an adapter launched with — so the main process asks its own door instead: if
   * {@link resolveAssetRequest} would serve this file, the path may go in the ledger, and otherwise
   * nothing does. One implementation of "may this be shown", so the thing that records a path and
   * the thing that later refuses one cannot disagree.
   *
   * Undefined for Claude (which generates no images — 067 measured that four ways). ⚑ **`726` ·
   * R92 — a session found in the user's OWN home now gets one too**: until `726` its files were
   * outside the served root and so unreachable however the claim was spelled; the door no longer
   * has a root, so the provider's own `savedPath` claim is checked on its merits. With no home of
   * ours there is no naming CONVENTION to try, so a claim is the only candidate.
   *
   * ⛔ **`null` here means "no home of ours", and it is the CALLER's job to have decided that**
   * (188 §1, from 168 M6). This used to take the row's `profile_id` straight through and refuse
   * every null, which is two different rows wearing one value: a row swept out of `~/.claude` /
   * `~/.codex` (`adopted_at` non-null) genuinely has no home of ours, but a **pre-profile row** —
   * `adopted_at` null, written before the column existed — ran in `default` and its images are
   * sitting in that home right now. Those conversations lost every generated image on
   * rebuild, silently, and the app had already settled the question everywhere else: three other
   * places in this file resolve a null profile with `?? DEFAULT_PROFILE_ID`. This was the one that
   * did not, so {@link homeProfileOf} makes the two nulls different values before they arrive.
   *
   * ⚠️ **The sweep's call site is deliberately NOT translated**: there, `profileId` comes from the
   * home being walked, and `user-homes.ts` is the one module that blanks it to null. Null already
   * means user home there, by construction rather than by inference.
   *
   * ## 🔴 It asks for the PATH now, and it should always have done (243)
   *
   * ⚠️ **What stood here was a mitigation for a call that did not belong**: *"The home is resolved
   * LAZILY, inside the closure. `prepareProviderHome` PROVISIONS — it is three `mkdirSync` calls —
   * so naming it here meant that importing any Codex conversation created an empty provider home on
   * disk as a side effect."* Laziness narrowed that to rollouts carrying an image; it did not end
   * it, and the rule was already written down three declarations away, in
   * {@link RuntimeHostDeps.providerHomePath}'s doc: ⛔ ***"`prepareProviderHome` is the LAUNCH call
   * and must not be used to answer a question"***. Rendering an archived image is a question.
   *
   * ⚑ **{@link RuntimeHostDeps.providerHomePath} is `deriveProviderHome` on its own** — pure,
   * containment-checked, no lock, no `mkdir`, no credential — and this closure only ever wanted the
   * string it returns, to build one `join(home, …)` whose every candidate is then re-checked by
   * `resolveAssetRequest`. So the swap removes a write from a read path and
   * loses nothing: an image that exists is still found, and one that does not is still `null`.
   *
   * ⛔ **243's own reason for touching it, said plainly.** When the provisioning lock's wait became
   * asynchronous, `prepareProviderHome` became promise-returning — and `ResolveImagePath` is
   * `(claim) => string | null`, consumed synchronously inside `importCodexRollout`'s frame loop.
   * This was the **only** synchronous wall in the whole call graph. ⚑ **It was not a wall that had
   * to be broken; it was a call that had to be corrected**, and the correction is one the docblock
   * above was already arguing for.
   */
  private imageResolver(
    provider: Provider,
    threadId: string,
    profileId: string | null,
  ): ResolveImagePath | undefined {
    return providerDefinitions[provider].transcripts.imageResolver?.(
      threadId,
      () => (profileId === null ? null : this.deps.providerHomePath(provider, profileId)),
      (candidate) => {
        const asset = resolveAssetRequest(assetUrl(candidate))
        return asset?.path ?? null
      },
    )
  }
}

/**
 * What one row's Import did, in a sentence (119).
 *
 * ⚠️ **Every branch says what happened, and none of them says what the outcome word says.**
 * `skipped` is the one that would be easy to get wrong: the derive refuses a session that already
 * has a ledger, so on this path it means *you already have this*, which is a success and reads as
 * one. `nothing-readable` is the honest empty: the file was read and none of it was conversation —
 * that is a fact about the file, not a failure of the import, and `086`'s rule says to report it
 * rather than dress it as either.
 */
function recordingNote(outcome: ImportedRecording['outcome'], readable: boolean): string {
  switch (outcome) {
    case 'imported':
      return 'Its prior messages are here now.'
    case 'skipped':
      return readable
        ? 'Its messages were already here — nothing more to import.'
        : "There is nothing of this conversation in its profile's folder to import."
    case 'nothing-readable':
      return 'Its provider file holds no readable conversation.'
    case 'still-writing':
      return 'Its file is still being written. Try importing it again when it has finished.'
    case 'stopped':
      return 'The app is shutting down. Its messages will be read from its file next time.'
    case 'failed':
      return 'It could not be imported.'
    // ⛔ **Not a failure, and it must not read as one** (293 §4). Everything was built and another
    // writer got to the flip first — so the conversation the user is looking at IS imported, by
    // somebody else, from the same file.
    case 'superseded':
      return 'Something else imported it at the same moment. Its messages are here — from that pass, not this one.'
    // ⛔ **Named individually rather than left to a `default`, and review is why.** These three are
    // composed at their own return sites, where they can say more than this function knows; a
    // `default` covering them would have quietly absorbed any NEW outcome as "it could not be
    // imported" — a fabricated failure, on a function whose stated rule is that every branch says
    // what happened. The `never` below is what makes adding one a compile error instead.
    case 'in-use':
      return 'It is open right now, and what it is saying is already being recorded.'
    // Composed at their own return sites, where they can say more than this function knows.
    case 'unknown-session':
    case 'refused':
    case 'user-home':
      return 'It could not be imported.'
    default: {
      const unreached: never = outcome
      return unreached
    }
  }
}

function homeProfileOf(row: { profileId: string | null; adoptedAt: number | null }): string | null {
  if (row.adoptedAt !== null && row.profileId === null) return null // the user's own home
  return row.profileId ?? DEFAULT_PROFILE_ID
}

/**
 * A conversation found in a user home, as the Library's import wants it. The captions are dropped:
 * a title is not one of the facts an import needs.
 */
function toHomeConversation(session: UserHomeDiscovery['found'][number]): HomeConversation {
  return {
    provider: session.provider,
    sessionId: session.sessionId,
    cwd: session.cwd,
    path: session.path,
    updatedAt: session.updatedAt,
    createdAt: session.createdAt,
    profileId: session.profileId,
    // ⚠️ **NOT dropped with the captions** (111): the row outlives the provider's file, and the
    // descent has to survive on it.
    ...(session.child ? { child: session.child } : {}),
  }
}
