import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { UNAVAILABLE_REASONS, describeUnavailable } from '../src/main/runtime/session-unavailable'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **504 · the row he cannot press** — `472` F1, both halves.
 *
 * > ⚑ *"in the project view: I should be able to click on the project manager and open the
 * > conversation where I can actually interact with it?"*
 *
 * ## ⛔ The claim under test, and it was TWO claims
 *
 * `472` F1 said two things and the brief quotes both:
 *
 *  1. ⚑ *"`ProjectConversation` carries no `resumeRefusal` and no `hasTranscript`. Two fields would
 *     give the press back."*
 *  2. 🔴 *"And there is a defect underneath it that is not mine: `SessionUnavailable('not-recorded')`
 *     says* there is no recording of this conversation to reopen *about a row whose transcript this
 *     app holds and displays — the rail only escapes it by never offering the press."*
 *
 * ⛔ **The second is the one that had to be measured**, because a press added on top of a false
 * refusal is a dispatch that ships the defect to a new surface. §1 drives the real store and the
 * real host and answers it in the app's own bytes.
 *
 * ## ⚠️ Why the ordinary instruments could not see it
 *
 * ⛔ **`SessionStore.find` is not *is this recorded*.** Its own docblock — corrected by `172` under
 * `142`'s rule — says *"One session by id, AS RESUME CAN USE IT, which drops a row with no provider
 * ref"*. ⚑ `172` fixed the sentence and left the caller: `reopenSession` read `!row` as *nothing was
 * recorded*, and two OTHER callers in the same file already know the difference and say so in
 * comments. So the file contained both the defect and its own correction.
 *
 * ## ⚑ What each section is for
 *
 *  - **§1** — is `472` F1 right? The population, the false sentence, the repair, and the control
 *    that keeps `not-recorded` meaning something.
 *  - **§2** — the two answers the Library gives about a recording, told apart by the ledger and
 *    by the fork, and equal to the reopen list's own.
 *
 * ⚑ **D-016 deleted the project room**, and with it the roster band this file's `472` F1 was
 * about (`conversationsInProject`, `ProjectConversation` and `lib/project-roster.ts`): the band's
 * two carried fields and its press went with it. §1's host-and-store half and the Library's own
 * answers in §2 are what is left, and both still hold.
 *
 * 🔒 The provider is a double, every directory is temporary, and no live app, port, provider home
 * or `auth.json` is touched.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')
const STORE_SRC = join(here, '../src/main/db/session-store.ts')
const HOST_SRC = join(here, '../src/main/runtime/runtime-host.ts')

const NOW = 1_800_000_000_000

/** ⛔ **Prose stripped before anything is counted** — this file's subject is a corrected docblock. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

describe('504 · the row he cannot press', () => {
  let userData: string
  let workspace: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let clock: number
  let window: RecordingSink

  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-504-'))
    workspace = mkdtempSync(join(tmpdir(), 'brobot2-504-cwd-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsDir)
    clock = NOW
    store = createSessionStore(db, tick)
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_504_${String(tick())}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new RecordingSink('webContents:504')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
  })

  /**
   * ⛔ **A conversation this app placed and then lost before its provider answered the handshake.**
   *
   * ⚠️ **Built through the store's own doors and nothing else** — `create` writes the row with
   * `external_ref` NULL, and `append` writes the turn that makes `has_events` true. ⛔ The ref
   * arrives with a `session` event and this population never got one, which is exactly
   * `session-store.ts`'s note about smoke step 44: *"kill the app in between and the ledger holds a
   * `user_turn`, a `working` status and an open turn row, while `external_ref` is still NULL."*
   */
  const lostBeforeItsId = (id: string): string => {
    store.create({ id, provider: 'claude', cwd: workspace, approvalMode: 'ask', profileId: 'pm' })
    store.append(id, 0, { type: 'user_turn', text: 'do the thing' } as TranscriptEvent, tick())
    return id
  }

  /** ⚑ The control: the same shape, one event further on, so the provider named it. */
  const named = (id: string): string => {
    lostBeforeItsId(id)
    store.append(
      id,
      1,
      {
        type: 'session',
        state: 'started',
        ref: { provider: 'claude', sessionId: `claude_${id}`, cwd: workspace, rotation: 0 },
      } as TranscriptEvent,
      tick(),
    )
    return id
  }

  /* ------------------------------------------------- §1 · the sentence that was false */

  describe('§1 · `472` F1, asked of the code rather than quoted', () => {
    /**
     * 🔴 **The population exists, and `find` drops it while `recordedOne` holds it.**
     *
     * ⛔ **Both halves in one assertion, on ONE row**, because the finding is about the two answers
     * disagreeing. ⚑ The control is the same conversation one event later: once the provider names
     * it, `find` answers and the two agree — so this measures the gap and not a store that says
     * null to everything.
     */
    it('🔴 a conversation whose ledger this app holds is dropped by `find`', () => {
      const lost = lostBeforeItsId('sess_lost')
      const whole = named('sess_whole')
      expect(store.find(lost), '`find` no longer drops a row with no ref').toBeNull()
      const recorded = store.recordedOne(lost)
      expect(recorded, 'the row this app is holding is not recorded').not.toBeNull()
      // ⛔ **The transcript is really there** — this is the claim `472` F1 makes about the row, and
      // without it the sentence under test would merely be unkind rather than false.
      expect(recorded?.hasTranscript).toBe(true)
      // ⚑ **D-017b** — *"nothing to reopen"* became *"nothing to carry on from"*: a message from its
      // view is what continues a conversation now.
      expect(recorded?.unresumableReason).toBe(
        'this one stopped before Claude gave it an id, so there is nothing to carry on from',
      )
      // ⚑ The control, same store, same shape.
      expect(store.find(whole)).not.toBeNull()
      expect(store.recordedOne(whole)?.unresumableReason).toBeNull()
    })

    /**
     * 🔴 **The sentence a person reads, through the real reopen door.**
     *
     * ⛔ **This is the defect `472` F1 named, and the assertion is that it is GONE** — the refusal
     * no longer claims there is no recording, and it carries the row's own reason instead.
     *
     * ⚠️ **`refusalTranslated` is what a window actually receives**, so the string asserted here is
     * the one that reaches a surface — not the diagnostic, which keeps the id for the log.
     */
    it('⛔ the reopen no longer says there is no recording of a conversation it holds', async () => {
      const lost = lostBeforeItsId('sess_lost')
      const said = await host.resumeSession(lost, window).then(
        () => null,
        (error: unknown) => (error as Error).message,
      )
      expect(said, 'the reopen resolved for a conversation with no ref').not.toBeNull()
      // ⚑ **D-017b** — `not-recorded`'s sentence is *"There is no record of this conversation
      // here."* now (the control below), so the negative is asked of that spelling.
      expect(said, 'the false sentence is still being said').not.toContain(
        'There is no record of this conversation',
      )
      // ⛔ **The ROW's own words, composed nowhere in the host** — the same sentence the Library
      // and the reopen list draw about the same conversation.
      expect(said).toContain('this one stopped before Claude gave it an id')
      // ⚑ **D-017b** — the lead says *continue*, the act that brings a conversation back now.
      expect(said).toContain('BroCrew could not continue this conversation')
      // ⚑ **And no id leaks into it**, which is `100`'s whole subject.
      expect(said).not.toContain(lost)
    })

    /**
     * ⛔ **`not-recorded` still means something, and the control is what proves the repair is a
     * narrowing rather than a removal.**
     *
     * ⚠️ **An id no row spells is the only thing left in that arm** — so the sentence that was false
     * of a held conversation is true of this one, and a repair that had simply retired the code
     * would fail here.
     */
    it('⚑ an id this app has never recorded still gets the sentence that is true of it', async () => {
      const said = await host.resumeSession('sess_never_existed', window).then(
        () => null,
        (error: unknown) => (error as Error).message,
      )
      // ⚑ **D-017b** — no *reopen* in it: there is no reopen to name.
      expect(said).toBe('There is no record of this conversation here.')
    })

    /**
     * ⛔ **Every refusal in the vocabulary still has its own sentence, and the new one is not a
     * second spelling of an old one** — `session-unavailable.ts`'s own distinctness rule, re-asked
     * because `504` added a member whose sentence is composed rather than written.
     */
    it('⛔ the new refusal says something no other refusal says', () => {
      // ⚑ **D-017 · R10 split ONE code off this one for the host's decision, not for its words**:
      // `never-started` is a row its provider never named, which a delivery replaces — and a person
      // reads the ROW's own refusal for it, exactly as that row read as `cannot-be-reopened` before
      // the split. ⛔ So it is the one member that shares this sentence, and it must share it in
      // both arms, or the split changed what a person reads and this exemption is false.
      const theRowsOwn = new Set<string>(['never-started'])
      expect(describeUnavailable('never-started')).toBe(describeUnavailable('cannot-be-reopened'))
      expect(describeUnavailable('never-started', { refusal: 'the row said this' })).toBe(
        describeUnavailable('cannot-be-reopened', { refusal: 'the row said this' }),
      )
      const said = UNAVAILABLE_REASONS.filter((reason) => !theRowsOwn.has(reason)).map((reason) =>
        describeUnavailable(reason),
      )
      expect(said).toHaveLength(UNAVAILABLE_REASONS.length - theRowsOwn.size)
      expect(new Set(said).size, 'two refusals say the same sentence').toBe(said.length)
      // ⚑ **Both arms of the composed one**, so the fallback is reachable and is not a lie either.
      const withReason = describeUnavailable('cannot-be-reopened', { refusal: 'the row said this' })
      expect(withReason).toContain('the row said this')
      expect(describeUnavailable('cannot-be-reopened')).not.toContain('read')
    })

    /**
     * 🔴 **ONE expression decides why a reopen will not work, for all three readers.**
     *
     * ⛔ **`recordedOf`'s own promise** — *"the library can never explain a row differently from the
     * list that refuses to offer it"* — and `504` gave it a third reader, which is the shape `214`
     * §1 measured when three copies of `!foundInUserHome(row)` were written out by hand.
     *
     * ⚠️ **Prose-stripped and with a planted control**: the docblock beside the function quotes the
     * fork it replaced, so a census that read comments would count two and pass for the wrong
     * reason.
     */
    it('🔴 the refusal fork is written once in the store', () => {
      const source = code(readFileSync(STORE_SRC, 'utf8'))
      const fork = /canReopen\(row\) \? whyNoDirectInput\(row\) : whyNotResumable\(row\)/g
      expect(source.match(fork) ?? [], 'the fork is spelled more than once').toHaveLength(1)
      // ⚑ The planted control: the prose really does carry a second copy, so the strip is working.
      expect(readFileSync(STORE_SRC, 'utf8').match(fork) ?? []).toHaveLength(2)
      // ⛔ **And the boundary asks the STORE rather than composing a sentence of its own** — the
      // repair is a call, not a seventh spelling.
      expect(code(readFileSync(HOST_SRC, 'utf8'))).toContain('recordedOne(sessionId)')
    })
  })

  /* ------------------------------------------------- §2 · the Library's two answers */

  describe('§2 · what the Library answers about a recording', () => {
    // ⚑ **D-016** — *the roster row carries the library’s own two answers* went with the roster:
    // `conversationsInProject` and its `ProjectConversation` rows are deleted, and nothing else
    // carries `reopenRefusal`/`hasTranscript` beside the Library's own read.

    /**
     * ⚑ **A conversation with a ledger and one with none differ in `hasTranscript`**, which is the
     * second field and the one that decides whether a refused row is offered a READ (`118`) or
     * nothing at all (`106`).
     */
    it('⚑ `hasTranscript` is the ledger and not the row', () => {
      store.create({
        id: 'sess_empty',
        provider: 'claude',
        cwd: workspace,
        approvalMode: 'ask',
        profileId: 'pm',
      })
      const lost = lostBeforeItsId('sess_lost')
      // ⚑ **D-016 · asked of the Library's own read** (`recordedOne`) — the roster row that
      // carried these two fields is deleted.
      expect(store.recordedOne('sess_empty')?.hasTranscript).toBe(false)
      expect(store.recordedOne(lost)?.hasTranscript).toBe(true)
      // ⛔ **And the two sentences differ too** — `whyNotResumable` tells them apart by name, and a
      // row with nothing in it must not be told BroBot is holding its conversation.
      expect(store.recordedOne('sess_empty')?.unresumableReason).toContain(
        'no turn was ever taken in this one',
      )
      expect(store.recordedOne(lost)?.unresumableReason).toContain(
        'stopped before Claude gave it an id',
      )
    })

    /**
     * 🔴 **The OTHER arm of the fork, and it is the one a boolean would have lost.**
     *
     * ⛔ **A row that CAN be reopened may still refuse direct input** — an app-owned adopted child,
     * `118`'s measured defect: *"the button was there, it looked exactly like every other one, and
     * pressing it reopened a thread the provider will not accept a turn on."* ⚑ `canReopen` is true
     * of it, so `whyNotResumable` has nothing to say and `whyNoDirectInput` is the whole answer.
     *
     * ⚠️ **The paired positive is an adopted PARENT**, which is the same shape one field over and
     * is offered a reopen — so this is a rule and not a blanket over everything adopted.
     */
    it('🔴 a child that CAN be reopened still refuses direct input, and its parent does not', () => {
      for (const [id, child] of [
        ['sess_kid', { parentSessionId: 'parent-thread', nickname: 'Turing' }],
        ['sess_grown', undefined],
      ] as const) {
        store.adopt({
          id,
          provider: 'codex',
          sessionId: `${id}-thread`,
          cwd: workspace,
          profileId: 'pm',
          updatedAt: tick(),
          createdAt: NOW,
          ...(child ? { child } : {}),
        })
      }
      // ⚑ **D-016 · asked of the Library's own read** (`recordedOne`) — the roster row that
      // carried this field is deleted.
      expect(store.recordedOne('sess_kid')?.unresumableReason).toContain('sub-agent conversation')
      expect(store.recordedOne('sess_grown')?.unresumableReason).toBeNull()
      // ⛔ **And it is the same sentence the reopen LIST refuses it with**, word for word — the
      // invariant `recordedOf` states and `118` shipped broken.
      expect(store.recordedOne('sess_kid')?.unresumableReason).toBe(
        store.resumable().find((row) => row.sessionId === 'sess_kid')?.resumeRefusal,
      )
    })
  })
})
