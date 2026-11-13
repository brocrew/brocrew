import type { LibraryChild } from '../conversation-listing-contracts'
import type { LibraryArchived, LibraryKind, LibraryOrigin } from './library-vocabulary'
import type { Provider, TurnEnding } from '@brobot2/shared'

/**
 * What an export produced (089). `native` is a copy of the provider's own file; `bundle` is one
 * self-contained document that needs no provider home and no
 * database.
 *
 * ## 🔴 633 · a THIRD kind, and it is the only one a person reads
 *
 * `native` preserves the provider file for resuming and `bundle` is JSON. `reading` is Markdown composed from the UI fold for a person to read.
 *
 * 🔴 **And it is the one kind whose BODY the renderer supplies**, which is the whole of `633` §2's
 * question. ⛔ *"The same as what the UI shows"* is `TranscriptItem[]`, and that fold lives in the
 * renderer; a second fold in main would be `HO-095` §4's *never two sources of truth*. ⚠️ So the
 * host writes bytes for this kind rather than composing them — see `RuntimeCommand`'s own
 * `exportSession`, where the payload says which.
 */
export type ExportKind = 'native' | 'bundle' | 'reading'

/**
 * 🔴 **What a caller asks an export for** (633) — declared ONCE, so the wire, the bridge and the
 * preload cannot disagree about which kind carries a body.
 *
 * ⚑ `MemoryAmendmentAsked`'s shape one door over, and for its reason: a payload with one
 * declaration has one answer to *who BUILT this*.
 */
export type ExportAsked =
  | { readonly sessionId: string; readonly exportKind: 'native' | 'bundle' }
  | { readonly sessionId: string; readonly exportKind: 'reading'; readonly body: string }

export interface ExportedSession {
  kind: ExportKind
  /** Where it was written. */
  path: string
  /** How many provider frames it carries. */
  frames: number
  /** How many ledger entries — bundles only; a native file is the provider's, not ours. */
  ledgerEntries: number
  /**
   * Whether dropping this file into a provider home gives that provider a session it can resume.
   * False is a real answer, not a failure: a Codex rollout is the conversation, but Codex finds
   * its threads through its own state database.
   */
  resumable: boolean
  /** One line saying what this file is, so "exported" never has to be read as "restored". */
  note: string
}

/**
 * ⛔ **What bringing a bundle back produced, or why it was refused** (214 §1).
 *
 * `213`'s blocker, in one sentence: *"reliable session recovery/transfer is the blocker to trusting
 * it as a durable workbench."* Export has said *"a self-contained copy"* since `089`; nothing read
 * one back. This is the answer the return path gives.
 *
 * ⚠️ **A refusal is a VALUE with a sentence in it, not a rejected command.** Picking the wrong file
 * is an ordinary thing to do and it is not an error the app should throw about — `118`: a control
 * that appears to do nothing is worse than one that is disabled, and a red toast with a stack in it
 * is a third thing worse than both. Every `ok: false` below carries a sentence a person can act on.
 */
export type ImportedBundle =
  | {
      ok: true
      /** Our row for the restored conversation — what a surface opens. */
      sessionId: string
      /**
       * ⚠️ **We already had this conversation, so nothing was written.**
       *
       * Not a failure and not silence. `importBundle` de-duplicates by the provider's own ref, so
       * re-importing the same file is a no-op that returns the id you already have. Surfaced as a
       * distinct outcome so the sentence a person reads is *"you already have this"* rather than
       * *"restored"*.
       */
      already: boolean
      /**
       * 🔴 **Set when we already had it AND the file is further on than what we hold** (236 §1,
       * from `194` H4 / `214` / `231` #7) — the case the old sentence was confidently wrong about.
       *
       * ⛔ **The dedup is by provider ref and compared nothing else**, so a bundle exported after a
       * SECOND life came back as a duplicate, was told *"you already have this"*, and its newer
       * half was discarded in silence. The comparison is cheap and was simply never made.
       *
       * ⚠️ **This is a report, not a repair, and that is the ruling** (see `importBundleFile`).
       * Absent whenever the file is not ahead — including when it is BEHIND, which is the ordinary
       * re-import of an older export and needs no sentence of its own beyond *"already here"*.
       */
      behind?: {
        /** Ledger entries in the row we hold. */
        held: number
        /** Ledger entries in the file. Always greater than {@link held} when this is present. */
        inFile: number
        /** When our row last moved, or null when the row is gone by the time we ask. */
        heldAt: number | null
        /** When the file says the conversation last moved. */
        fileAt: number
      }
      provider: Provider
      /** The directory it ran in, wherever that was — a bundle carries it and cannot recreate it. */
      cwd: string
      /** How many ledger entries came back, so "restored" is a count rather than a claim. */
      events: number
    }
  | { ok: false; reason: string }

/** Something that looks like a session in a provider home but could not be adopted, and why. */
export interface SkippedSessionInfo {
  provider: Provider
  path: string
  reason: string
}

/**
 * What a scan of the provider homes did (087). Counts rather than rows, because the list
 * re-reads itself afterwards — but the skipped ones are carried, since nothing else will ever
 * mention them and silently finding-then-dropping a session is the failure this feature exists
 * to prevent.
 */
export interface AdoptionReport {
  /** Conversations found in the homes, whether or not they were already known. */
  found: number
  /** Newly recorded, and now offered in the reopen list. */
  adopted: number
  /** Found, but already recorded — running the scan again changes nothing. */
  alreadyKnown: number
  /** Sessions whose prior conversation was read from their provider's file into a transcript. */
  imported: number
  /**
   * **Adopted rows whose recorded descent this pass actually changed** (121, from 119).
   *
   * ⚠️ **It exists because a sentence was about to name a number nothing produced.** `120`'s mock
   * draws the scan's freshness note as *"4 new, 153 descents back-filled"*, and this report carried
   * no such field — so the note would have had to invent one, print a different number under a
   * descent-shaped label, or drop the phrase. `106` is the rule: a control that looks like it does
   * something and does not. A caption is the same lie told quieter.
   *
   * Count descents learned, not merely filled: {@link mergeDescent} can fill a null value or upgrade a thinner stored answer with richer live data.
   */
  descentsLearned: number
  /**
   * 🔴 **727 · R87 — conversations of THIS app's that the scan gave back their ref**: a launch the
   * app was killed, errored or timed out closing before Claude named it, whose transcript the scan
   * found under the id the launch recorded. Each has moved from the list a reopen cannot reach to
   * the one it can — the thing a person pressing the scan would want to be told.
   */
  named: number
  skipped: SkippedSessionInfo[]
}

/**
 * How a DERIVED ledger stands against the provider's file it was read from (065, from 061
 * finding 6).
 *
 *  - **`current`** — the importer that read it is the one shipping now.
 *  - **`stale`** — an older importer read it. What is on screen is real, and reading it again is a
 *    button.
 *  - **`rebuilding`** — a replacement projection is being built beside it right now. The active one
 *    is still what you are reading.
 *  - **`failed`** — the last rebuild did not land. ⚠️ **The previous projection is still active and
 *    intact**; this says an attempt failed, never that the conversation did.
 *
 * There is deliberately no `absent`: "we have not derived anything" is {@link LedgerStatus.present},
 * a different question, and folding the two together is how `hasEvents` came to be doing this job.
 */
export type DerivedState = 'current' | 'stale' | 'rebuilding' | 'failed'

/**
 * What one session's ledger claims about itself — the completeness contract 061 finding 6 asked
 * for, and the replacement for `hasEvents` at every site that was using existence as completeness.
 */
export interface LedgerStatus {
  /**
   * Whether there is any conversation at all in the active generation.
   *
   * This is what `hasEvents` answered, and it is kept because "is there anything to show" is a real
   * question the reading pane and the library both ask. What changed is that it is no longer the
   * ONLY answer available, so nothing has to read it as "and it is complete".
   */
  present: boolean
  /**
   * The projection's state, or **null when this ledger was not projected from anything** — a session
   * this app ran, whose ledger is the recording itself. Claiming `current` for a recording would be
   * asserting a reading nobody made. `stale` is a projection an older version of the app read.
   */
  derived: DerivedState | null
  /** How many of the provider's lines the projection was read from. 0 when nothing has been. */
  derivedThrough: number
  /** The importer version this projection is current for. 0 predates the contract entirely. */
  normalizerVersion: number
  /** Why the last rebuild failed, or null. Never populated by a cancellation. */
  failure: string | null
}

/**
 * What asking for one session's transcript to be rebuilt did (065).
 *
 * Every ending is named rather than collapsed into success/failure, the same rule
 * {@link ImportedFromHome} follows — and for the same reason: the two most interesting endings here
 * are neither. `refused` means the app is quitting and the work will be there next time; `stopped`
 * means a quit overtook a rebuild that had already started, and **the previous transcript is still
 * the active one**, whole.
 */
export interface RebuiltLedger {
  outcome:
    | 'imported'
    | 'nothing-readable'
    /** Its final record is unfinished; no new projection was published. */
    | 'still-writing'
    | 'skipped'
    | 'stopped'
    | 'failed'
    /** No such session. */
    | 'unknown-session'
    /** It is open right now: its ledger is being recorded, and its provider is still writing its file. */
    | 'in-use'
    /** Its provider's file is gone, so there is nothing to read it again from. */
    | 'gone'
    /**
     * Its transcript is the RECORDING this app made while it ran, not a projection of anything.
     *
     * A refusal in the user's favour: the recording holds the session machine's own lifecycle events,
     * which the provider's file does not, so re-deriving it would replace a richer record with a
     * poorer one and call it a repair.
     */
    | 'recorded'
    /** The app is shutting down and started nothing. */
    | 'refused'
    /**
     * 🔴 **Built, and the flip lost** (293 §4) — another writer had replaced the `building` marker.
     * The projection the reader sees is that writer's, from the same file. See
     * {@link ImportedRecording}'s member of the same name.
     */
    | 'superseded'
  /** What the contract says after the attempt, or null when there was no session to ask about. */
  status: LedgerStatus | null
}

/**
 * One conversation as the library knows it (047) — our own sessions and the user's, merged.
 *
 * "Do we hold it" and "does the provider still have it" are separate fields rather than one status
 * word, because they are independent and the interesting rows are the ones where they differ: a file
 * still on disk that we have never imported is the one worth importing, and one we hold whose file
 * the provider has since deleted can be read here and never read again.
 */
export interface LibraryEntry {
  /**
   * A stable key for a list — the PROVIDER's own composite id wherever there is one, falling back
   * to our row id only for a session that never got one.
   *
   * That way round deliberately. Our row id is null until a conversation is imported, so keying on
   * it moved the key at the one moment it must not move: anything the surface had attached to the
   * row — the outcome of the import that just landed — was orphaned by the import succeeding.
   * It is NOT a session id: do not pass it to anything expecting one. Use `recordId`.
   */
  id: string
  provider: Provider
  /** The provider's own id, or null for one of ours that never got one. */
  providerSessionId: string | null
  /** Our row, or null when we have never recorded this conversation. */
  recordId: string | null
  cwd: string
  /** What the provider calls it. Empty when it has never said — never back-filled from a path. */
  title: string
  /** The first user message, as the provider recorded it. Empty when there is none. */
  preview: string
  createdAt: number
  updatedAt: number
  /** Its size in the provider's home right now, or null when the provider no longer has it. */
  bytes: number | null
  origin: LibraryOrigin
  /** Whether the provider still has the file. */
  onDisk: boolean
  /** Whether opening it shows a conversation rather than an empty pane. */
  readable: boolean
  /**
   * Whether that conversation is the WHOLE conversation (065), or null when nothing was projected —
   * a session this app ran, or one still waiting to be imported.
   *
   * A second field rather than a richer `readable`, for the reason this whole task exists: `readable`
   * is about existence and this is about completeness, and 061 finding 6 is what happens when one
   * value is asked to carry both.
   */
  derived: DerivedState | null
  /**
   * How its last turn ended, or null (222) — see {@link ResumableSessionInfo.lastEnding}.
   *
   * ⚠️ **Null for every row the provider holds and we do not**, and that is a statement rather than
   * a gap: a conversation we never ran and never imported has no turns of ours to have an ending.
   * The surface renders nothing there rather than guessing `completed`.
   */
  lastEnding: TurnEnding | null
  /** Why it cannot be reopened, or null when it can. The store's own words, never composed. */
  unresumableReason: string | null
  /**
   * That another conversation spawned this one, and what the provider says about the descent (111).
   * Null means it is not a child — or that it was recorded before we knew to ask.
   *
   * Record descent so discovered provider sub-agent threads are not presented as conversations the person started.
   */
  child: LibraryChild | null
  /**
   * 🔴 **The identity this app RAN it as — present on an `origin: 'ours'` entry and on no other**
   * (671 · `667` G4a).
   *
   * ⚑ **`provider_session.profile_id`, off the row this entry was built from, resolved the way every
   * resume resolves it** (`row.profileId ?? DEFAULT_PROFILE_ID`): a row written before profiles
   * could be chosen ran in the default one, so it names that. ⛔ **The DIRECTORY spelling, exactly
   * what a live pane's `ResumableSessionInfo.profileId` carries** — so a recording and the live
   * conversation it was hand {@link agentName} the same value, and that function folds it.
   *
   * ## ⛔ Absent for every other origin, and absence is the answer rather than a gap
   *
   * ⚠️ **`user-home` has no identity of ours** — the sweep found it in the person's own provider
   * home; naming it would be {@link profileLabel}'s *"invent one"*. ⚠️ **`restored` is not ours
   * either**: another machine ran it, and the profile its bundle names is an identity on THAT
   * machine, which this roster may name differently or not hold at all. ⚑ So *absent* is *this app
   * did not run it as anybody*, and a card says *this conversation*.
   *
   * ⚠️ **Optional in the type rather than a union keyed on {@link origin}**, and that is a cost stated
   * rather than a preference: every renderer and `test/dom` fixture that builds an entry would have
   * to change, while the frontend seat is working in parallel. ⛔ **The correlation is held by a
   * test through `readLibrary`'s own producer** (`what-main-hands-the-cards.test.ts` §3), not by
   * the compiler.
   *
   * ⛔ **Never composed from the rail's list** (`667` §4 says why): a heading a recording draws
   * comes from the recording's own read, or it would name some recordings and not others by how
   * they were opened.
   */
  profileId?: string
  /** When a person archived it, epoch ms; present only for an archived conversation, listed here so it can be restored. */
  archivedAt?: number
}

/** How many of each, over the WHOLE library — a count that moved with the page would be a lie. */
export interface LibraryCounts {
  total: number
  ours: number
  userHome: number
  /**
   * ⛔ **Conversations somebody SENT us** (214 §1) — restored from a bundle.
   *
   * Its own cell rather than a share of {@link userHome}, because none of that group's words are
   * true of it: the provider has no copy of a restored conversation anywhere on this machine, so it
   * is neither `imported` (*"the file is still there and we imported it"*) nor `onlyHere` (*"the
   * provider deleted its file"* — nothing was deleted; it was never here).
   */
  restored: number
  /** Of the user's own, the ones we have imported and can open. */
  imported: number
  /** Of the user's own, the ones we have not — what the import control is for. */
  notImported: number
  /** Sessions we hold whose provider file is gone. Rescued history, counted. */
  onlyHere: number
  /**
   * **How many conversations each provider has in the WHOLE library** (121) — one entry per
   * provider that actually has one, busiest first.
   *
   * ⛔ **This is what the Provider facet is built from, and that is the whole reason it exists.**
   * `039` forbids the renderer deciding anything by recognising a provider's name, and
   * `provider-neutrality.test.ts` enforces it as a census over `renderer/` and `shared/` — so a
   * facet with `['claude', 'codex']` written in it is not a shortcut, it is the architecture the
   * rule was written to stop being lost one reasonable line at a time. The list comes from the
   * backend, like every other per-provider fact, and adding a third provider adds a menu option
   * with no renderer change at all.
   *
   * Counted over the same entries as every other field here — the whole library, before the query
   * and before the filters — so the menu beside a filtered list still offers what is there to
   * switch to, rather than only what survived the current narrowing.
   */
  providers: LibraryProviderCount[]
}

/** One provider's share of the library. See {@link LibraryCounts.providers}. */
export interface LibraryProviderCount {
  provider: Provider
  total: number
}

export interface LibraryPage {
  entries: LibraryEntry[]
  /** How many matched the query, before paging. */
  matched: number
  counts: LibraryCounts
  /** Anything a home offered that could not be described — bounded, like the entries. */
  skipped: SkippedSessionInfo[]
  /**
   * How many there were in total. Separate from `skipped.length` so a bounded list can never read
   * as the whole story: silently showing 50 of 500 is the kind of truncation this app treats as a
   * lie about coverage.
   */
  skippedTotal: number
}

export interface LibraryQuery {
  /** Case-insensitive substring over the fields we genuinely have. Empty or absent matches all. */
  query?: string
  /**
   * One recorded row, by OUR id — an exact match, not a substring (118).
   *
   * ⚠️ **It is not a faster `query`, and the two are ANDed rather than alternatives.** `query`
   * searches captions a person can read and matches many; this names one row and matches at most
   * one. ⛔ A row we have never recorded has no id to name, so this never matches one.
   *
   * ⛔ **It filters AFTER the merge, so naming one row still costs a whole library read** — a walk
   * of the user's provider homes and a copy-and-query of Codex's state database. That is deliberate
   * and it is why the counts beside it can be trusted: they are a statement about the whole library,
   * not about the query.
   *
   * ⚑ **So this is NOT how you open one conversation** — a recorded one opens in its full view
   * ({@link RuntimeBridge.look}). This field is for a caller that genuinely wants one row *and* the
   * library's shape around it.
   */
  recordId?: string
  /**
   * **The structured narrowing** (121, to `120`'s design) — ANDed with {@link query}, and applied
   * over the whole library BEFORE the page is sliced.
   *
   * ⛔ **A filter is a round trip, and there is no client-side version of it.** `SessionLibrary.vue`
   * says why in its own words: *"filtering here would search the first 200 entries of two thousand
   * and quietly call it a result."* Threading it through here is also what keeps the window note
   * honest for free — {@link LibraryPage.matched} counts `query ∧ filters` pre-slice, so
   * *"200 of 200"* on a library of two thousand cannot be said.
   */
  filters?: LibraryFilters
  limit?: number
  offset?: number
}

/**
 * **Nine dimensions a person can narrow the library by** (121, `120` §1).
 *
 * Every field maps to a field {@link LibraryEntry} already carries. Nothing here invents a row
 * property, and nothing here is a text search — text is {@link LibraryQuery.query}, which reaches
 * `title`, `preview` and `cwd`, so a `cwd` facet would be a second way to ask one question.
 *
 * ## ⛔ The five state predicates are FIVE, and may not become one
 *
 * `readable`, `onDisk` and `derived` are three independent facts and the entry refuses to merge
 * them — see {@link LibraryEntry.derived}, which exists precisely because `readable` was being
 * asked to carry completeness as well as existence. Collapsing these toggles into one "status"
 * chip would re-make `061` finding 6 at the surface that finally shows the difference. A row can be
 * readable and behind; unreadable and rebuildable; off-disk and whole. Hiding the five behind a
 * disclosure hides the CLUTTER, not the distinction.
 *
 * ## Absent, `false` and `true`
 *
 * The five state fields constrain only when `true`. Absent and `false` both mean *"do not narrow by
 * this"* — deliberately, so a renderer holding all five as plain booleans can send its state as it
 * stands without having to strip the off ones. There is no way to ask for the NEGATIVE of one of
 * them ("only rows that are on disk"), because nobody reaches for that and inventing a control for
 * it would be five more toggles nothing presses.
 */
export interface LibraryFilters {
  /** Only this provider's conversations. Absent means every provider. */
  provider?: Provider
  /** Only rows this app ran, or only rows found in the user's own home. */
  origin?: LibraryOrigin
  /** Only children, or only the conversations a person started. */
  kind?: LibraryKind
  /** Only rows with no record of ours: `recordId === null`. What the Import control is for. */
  notImported?: boolean
  /** Only rows the reopen list refuses: `unresumableReason !== null`. */
  unresumable?: boolean
  /** Only rows whose transcript is not the whole conversation: `derived` is not `current`/null. */
  behind?: boolean
  /** Only rows the provider no longer has a file for: `onDisk === false`. */
  offDisk?: boolean
  /** Only rows that would open to an empty pane: `readable === false`. */
  unreadable?: boolean
  /** Only the archived conversations (`archivedAt` present), or every one but them. */
  archived?: LibraryArchived
}

/**
 * What importing one conversation out of a user's provider home did (047).
 *
 * Every ending is named rather than collapsed into success/failure: `up-to-date` means you already
 * have it, which is the correct thing to have happened, and a UI that showed it as an error would be
 * lying about a working import.
 */
export interface ImportedFromHome {
  /**
   * The import's own outcome word, or `missing` when the conversation is no longer in the home at
   * all — which is not an outcome of importing, but of looking.
   */
  outcome:
    | 'imported'
    | 'up-to-date'
    | 'nothing-readable'
    | 'still-writing'
    | 'stopped'
    | 'unreadable'
    | 'missing'
  /** Our row for it, once there is one — null when the import produced none. */
  sessionId: string | null
  /** Whether it can now be read here. Read back from the ledger, never inferred from the outcome. */
  readable: boolean
  /** One line saying what happened, worded by the host — the same reason as the approval note. */
  note: string
}

/**
 * What importing ONE recorded conversation's prior messages did (119).
 *
 * ⚠️ **A different operation from {@link ImportedFromHome}, and the separate shape is the point.**
 * That one gives a file in the user's own home a row here; this one fills in the messages of a row
 * we already have, out of a home this app provisioned. They share a verb and nothing else — see
 * `RuntimeHost.importRecordedSession` for why widening the first to cover the second would have
 * made it able to import a second copy of a conversation we hold.
 */
export interface ImportedRecording {
  outcome:
    /** A conversation was built from the provider's file and is readable now. */
    | 'imported'
    /** Nothing to do: it already had one — or there is no provider file to read. */
    | 'skipped'
    /** Its file was read, and none of it was a line of conversation. */
    | 'nothing-readable'
    /** Its final record is unfinished; no new projection was published. */
    | 'still-writing'
    /** Asked to stop mid-projection. Nothing was replaced, and the next attempt starts again. */
    | 'stopped'
    | 'failed'
    /**
     * 🔴 **Built, and the flip lost** (293 §4). Another writer had replaced the `building` marker,
     * so this pass's generation was never promoted. The conversation IS readable — from the pass
     * that won — which is why this is not `failed` and not `refused`.
     */
    | 'superseded'
    /** No such row. */
    | 'unknown-session'
    /** It is open right now — its messages are being recorded, not imported. */
    | 'in-use'
    /** The app is shutting down and started nothing. */
    | 'refused'
    /**
     * It was found in the user's own provider home, which this command does not read.
     * {@link ImportedFromHome} is the one that does — the Library's Import.
     */
    | 'user-home'
  /** Whether there is a conversation to read here NOW. Read back from the ledger, never inferred. */
  readable: boolean
  /** One line saying what happened, worded by the host. */
  note: string
}
