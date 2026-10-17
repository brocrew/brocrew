import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { resourcesRoot } from '../src/main/resources/resources'
import { workAnswered, workUndriven } from '../src/main/runtime/reply-rails'
import { derivePieces } from '../src/shared/tasks'
import { theResourcesAReportNames } from '../src/renderer/src/lib/the-document-a-report-names'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import type {
  PersistedEventInfo,
  ResourceReading,
  RuntimeEventMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * # 🔴 510 · the id this app hands a person and cannot open
 *
 * A person reading a work report needs an actionable document reference:
 *
 * > *"The full response is document `doc:default:4:response`. Read it with `read_document`."*
 *
 * ⛔ **He asked where he opens it. There was nowhere.** ⚑ The bytes existed — 2,295 of them, the
 * substance of the answer rather than a header — and the app printed their id into his transcript
 * beside an instruction he cannot follow.
 *
 * ## ⚑ D-016 · the document became a RESOURCE, and the door stayed
 *
 * ⚠️ The document registry is gone: a reply's files are kept byte for byte under
 * `<userData>/resources/<sha256>/<name>` and named by a `res_<32 hex>` id. ⛔ **510's rule is
 * unchanged** — a person's door needs the id as a FACT on the report, because `work-report.ts`
 * forbids recovering it from the prose beside it — so every section below is re-aimed at the
 * resource and none is dropped.
 *
 * ## ⛔ The sections — five until `726`, four since
 *
 *  - **§1 · the field.** On the answered half and never on the stall — and the asymmetry is
 *    STRUCTURAL. Through the fold, both ways.
 *  - **§2 · the person's door.** Its four answers, each reached; the positive; and the boundary put
 *    on the path the code walks by planting a row that spells its way out of the tree.
 *  - **§3 · the plant.** A report whose FIELD and whose SENTENCE name different resources, and the
 *    press carries the field's. ⛔ Without this, nothing distinguishes reading the wire from
 *    parsing the paragraph.
 *  - **§4 · removed by `726` · R92.** It proved a kept file's path was REFUSED to a session's
 *    structured tool call. ⚑ R92 removed that refusal — BroBot adds no folder restriction of its
 *    own — and a resource is still HANDED to an agent by id; the person's door in §2 is unchanged.
 *  - **§5 · the wiring**, so a hop that is deleted is a failure rather than a silent dead control.
 *
 * ⚑ **Real host, real SQLite ledger, real migrations, real filesystem.** The only double is the
 * provider.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** One ledger entry, as `derivePieces` reads them. */
const at = (event: TranscriptEvent, ordinal: number): PersistedEventInfo =>
  ({ sessionId: 'sess_child', ordinal, at: 1_000 + ordinal, event }) as PersistedEventInfo

/**
 * ⚑ **The refusal word, or `'ok'`** — one reader, so every assertion below compares the same
 * shape and a success cannot be mistaken for a reason nobody spelled.
 */
const readReason = (result: ResourceReading): string => (result.ok ? 'ok' : result.reason)

const readSource = (path: string): string => readFileSync(path, 'utf8')

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

describe('510 · the id this app hands a person', () => {
  let userData: string
  let work: string
  let outside: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let sessions: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++
  const kept = (): string => resourcesRoot(userData)

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-510-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-510-work-'))
    outside = mkdtempSync(join(tmpdir(), 'brobot2-510-outside-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = Date.UTC(2030, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    sessions = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions }),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, work, outside]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (cwd = work): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId: 'default', cwd, approvalMode: 'ask' },
      window,
    )
    return sessionId
  }

  /**
   * ⚑ **Resources, kept through the real doors** — a person's conversation gives a piece with
   * `giveWork`, and the conversation it reaches replies with the files, through `replyToParent`.
   * ⛔ Nothing here writes a `work_resource` row by hand: the row, the kept bytes and the id are
   * the ones a reply makes.
   */
  const aReplyKeeps = async (
    files: readonly { readonly name: string; readonly text: string }[],
  ): Promise<readonly string[]> => {
    const giver = await personOpens()
    const given = await host.giveWork(
      {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'default',
        title: 'Write the answer',
        brief: 'write the answer',
      },
      { ownerId: agentCallerId(giver) },
    )
    if (!given.ok) throw new Error(`expected a give, got ${given.refusal.rail}`)
    const folder = store.recordedOne(given.owner)?.cwd
    if (folder === undefined) throw new Error('the conversation the give reached has no folder')
    for (const file of files) writeFileSync(join(folder, file.name), file.text)
    const replied = await host.replyToParent(
      {
        piece: given.label,
        outcome: 'done',
        summary: 'done it',
        resourcePaths: files.map((file) => file.name),
        needsUserAction: false,
      },
      { ownerId: agentCallerId(given.owner) },
    )
    if (!replied.ok) throw new Error(`expected a reply, got ${replied.refusal.rail}`)
    return replied.resources
  }

  /** One kept resource, through the real doors, and the id it was given. */
  const aResource = async (text = 'the whole answer\n', name = 'r.md'): Promise<string> => {
    const [resource] = await aReplyKeeps([{ name, text }])
    if (resource === undefined) throw new Error('the reply kept no resource')
    return resource
  }

  /** Where a kept resource's bytes are — `<root>/<sha256>/<name>`, off its own row. */
  const whereItIs = (resource: string): string => {
    const row = store.resource(resource)
    if (row === null) throw new Error(`no row for ${resource}`)
    return join(kept(), row.sha256, row.name)
  }

  const piece = { piece: 'work_9', label: 'W1.4', owner: 'sess_child' }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the field — one half, and the absence on the other is structural
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the resource is a FACT on the report, not only a word in the sentence', () => {
    it('🔴 the answered half carries the ids it was PASSED, never the row’s own', () => {
      // ⛔ **The row `deliverReply` is handed is the piece as the lookup found it** — open, with
      // whatever resources a row might carry. ⚠️ A `Pick<PieceRow, 'resources'>` would have
      // compiled and put the wrong ids (or none) on every report, which is exactly why the ids are
      // an argument rather than copied off the row.
      const stale = { ...piece, resources: ['res_the-old-one'] }
      const made = workAnswered(stale, { outcome: 'done', needsUserAction: false }, [
        'res_the-new-one',
      ])
      expect(made.resources).toEqual(['res_the-new-one'])
    })

    it('⚑ a reply that kept nothing leaves NO key, rather than a null', () => {
      const made = workAnswered(piece, { outcome: 'done', needsUserAction: false }, [])
      expect(Object.hasOwn(made, 'resources')).toBe(false)
      // ⚠️ **`outcome`'s spelling** — *absent, never null* — for this same fact on the report. A
      // `null` here would make every reader grow a third value-kind for a difference no surface
      // acts on.
      expect(JSON.stringify(made)).not.toContain('null')
    })

    it('⛔ `workUndriven` has no such argument, and could not use one if it had', () => {
      const stalled = workUndriven(piece, 'turn_ended')
      expect(Object.hasOwn(stalled, 'resources')).toBe(false)
      // 🔴 **The structural claim, driven rather than asserted in prose.** A resource reaches a
      // `PieceRow` only through `work_replied`; that settles the row to `answered`; the fold drops
      // an answered row out of `open`; and `stall` returns on a row `open` no longer holds. ⚑ So
      // the two events in this order produce a piece that is `answered` WITH its resources, and the
      // stall that follows changes nothing about it.
      const events: TranscriptEvent[] = [
        {
          type: 'work_given',
          piece: 'work_9',
          label: 'W1.4',
          parent: 'work_root',
          givenBy: 'sess_parent',
          title: 'work',
          brief: 'work',
        },
        {
          type: 'work_replied',
          piece: 'work_9',
          outcome: 'done',
          summary: 'done it',
          resources: ['res_the-answer'],
        },
        { type: 'turn', state: 'completed' },
      ]
      const rows = derivePieces(
        'sess_child',
        events.map((event, index) => at(event, index + 1)),
      )
      expect(rows[0]?.state).toBe('answered')
      expect(rows[0]?.resources).toEqual(['res_the-answer'])
      expect(rows[0]?.stalledBecause).toBe(null)
    })

    it('⚠️ and the fold carries it onto the row a parent reads, through the real transcript', () => {
      const report = workAnswered(piece, { outcome: 'done', needsUserAction: false }, [
        'res_the-answer',
      ])
      const transcript = createTranscript()
      applyEvent(
        transcript,
        {
          type: 'user_turn',
          text: 'W1.4 (work_9) was answered by sess_child: done.',
          work: report,
        },
        1_000,
      )
      const row = transcript.items.find((item) => item.kind === 'workReport')
      expect(row?.kind === 'workReport' && row.report.resources).toEqual(['res_the-answer'])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the person's door
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the door a window knocks on, and what bounds it', () => {
    it('🔴 the positive — a resource id in, the kept bytes out, with the file’s name', async () => {
      const resource = await aResource('# the answer\n\nall of it\n', 'the-answer.md')
      const seen = host.readResourceForAPerson(resource)
      expect(seen.ok).toBe(true)
      if (!seen.ok) return
      expect(seen.text).toBe('# the answer\n\nall of it\n')
      expect(seen.resourceId).toBe(resource)
      // ⛔ **The FILE's name and never its path** — `380`'s rule: the name it was handed in with.
      expect(seen.name).toBe('the-answer.md')
      expect(JSON.stringify(seen)).not.toContain(kept())
    })

    it('⚑ 549 · neither door asks an entitlement now, and what differs is the VOCABULARY', async () => {
      const resource = await aResource()
      // 🔴 **RE-AIMED, not stripped** (standing rule 26). ⚠️ **HO-057 withdrew the entitlement**:
      // any agent may read any resource, so both doors answer the same bytes, and a conversation
      // that kept nothing is no stranger to them.
      const stranger = await personOpens()
      const agent = host.readResource(resource)
      const person = host.readResourceForAPerson(resource)
      expect(stranger).not.toBe('')
      expect(agent.ok).toBe(true)
      expect(person.ok).toBe(true)
      if (!agent.ok || !person.ok) return
      // ⚑ **Same bytes through both**, which is what makes the remaining difference a VOCABULARY
      // difference and not a data one.
      // ⚑ **635 · through the union**, which is the shape that replaced `markdown: string`.
      expect(agent.content.as === 'not-for-a-model' ? null : agent.content.text).toBe(person.text)
      // ⛔ **The paired call one fact over, about an id nothing kept**: the agent gets a
      // `RESOURCE_RAILS` refusal carrying a permanence and a remedy, and the window gets one of
      // four words. **That is the difference the old title claimed for entitlement.**
      const agentMiss = host.readResource('res_nothing-kept-this')
      const personMiss = host.readResourceForAPerson('res_nothing-kept-this')
      if (agentMiss.ok || personMiss.ok) throw new Error('expected two refusals')
      expect(agentMiss.refusal.rail).toBe('no-such-resource')
      expect(agentMiss.refusal.permanence).toBe('permanent')
      expect(personMiss.reason).toBe('no-such-resource')
      expect(Object.keys(personMiss)).toEqual(['ok', 'reason'])
    })

    it('⛔ an id nothing kept is `no-such-resource`, and it never becomes a path', async () => {
      const resource = await aResource()
      for (const id of [
        'res_99',
        // ⚑ **D-016 · an id from before the tree** — a document's — answers the same word.
        'doc:default:4:response',
        '../../../etc/passwd',
        `${resource} `,
      ]) {
        const seen = host.readResourceForAPerson(id)
        expect(seen.ok, id).toBe(false)
        expect(seen.ok || seen.reason, id).toBe('no-such-resource')
      }
    })

    it('⚠️ a host with no resources tree says so, rather than saying there is no such resource', () => {
      // 🔴 **The distinction `readResource` words as a rail.** A person has nothing to enumerate
      // that is not already theirs, and *this app keeps no resources tree* is a different thing to
      // be told than *there is no such resource*.
      const blind = new RuntimeHost({
        store,
        discoverSessions: NO_DISCOVERY,
        nativeTranscriptPath: () => null,
        exportDirectory: () => join(userData, 'exports'),
        createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions }),
        prepareProviderHome: () => join(userData, 'provider-homes', 'default', 'claude'),
        providerHomePath: () => join(userData, 'provider-homes', 'claude'),
        resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
        newSessionId: () => `sess_blind_${++counter}`,
        now: tick,
        readProviderConfig: (provider, home) => ({
          home,
          homeEnv: 'CLAUDE_CONFIG_DIR',
          model: 'm',
          authNote: null,
          files: [],
        }),
      })
      const seen = blind.readResourceForAPerson('res_anything')
      expect(seen.ok || seen.reason).toBe('no-store')
    })

    it('🔴 the hash is re-checked, so `changed` and `unreadable` are two different answers', async () => {
      const [changedId, goneId] = await aReplyKeeps([
        { name: 'original.md', text: 'original\n' },
        { name: 'vanishing.md', text: 'vanishing\n' },
      ])
      if (changedId === undefined || goneId === undefined) throw new Error('expected two resources')
      writeFileSync(whereItIs(changedId), 'somebody edited it\n')
      expect(
        host.readResourceForAPerson(changedId).ok ||
          readReason(host.readResourceForAPerson(changedId)),
      ).toBe('changed')

      rmSync(whereItIs(goneId))
      expect(readReason(host.readResourceForAPerson(goneId))).toBe('unreadable')
    })

    it('⛔ THE HAZARD, on the path the code walks — a row that spells its way OUT of the tree', async () => {
      // 🔴 **Standing §20: a rule is proven by VIOLATING it.** `work_resource.name` carries no
      // `CHECK` that it is one segment, and `join(root, sha256, name)` normalises `..`. ⚠️ Nothing
      // reachable writes such a row today — `keepResource` refuses a name that is not one segment
      // before it writes — which is exactly the state in which *"cannot happen"* becomes a promise a
      // second consumer has to keep. ⛔ So it is planted straight into the row.
      const resource = await aResource('the real one\n')
      const stranger = join(outside, 'secrets.md')
      writeFileSync(stranger, 'not a resource at all\n')
      const row = store.resource(resource)
      if (row === null) throw new Error(`no row for ${resource}`)
      // ⚑ The name is spelled from the resource's OWN folder, so the path the code joins really
      // lands on `stranger` — a name that reached nothing would be refused by any door.
      const outOfTheTree = relative(join(kept(), row.sha256), stranger)
      db.prepare('UPDATE work_resource SET name = ? WHERE id = ?').run(outOfTheTree, resource)
      // ⚑ **The premise, asserted** — the row really says what this test thinks it says.
      expect(store.resource(resource)?.name).toContain('..')
      expect(existsSync(stranger)).toBe(true)
      // ⚑ **The control** — without the guard, `join(root, sha256, name)` reads the stranger's bytes.
      const unguarded = join(kept(), row.sha256, outOfTheTree)
      expect(unguarded).toBe(stranger)
      expect(readFileSync(unguarded, 'utf8')).toBe('not a resource at all\n')

      const seen = host.readResourceForAPerson(resource)
      expect(seen.ok).toBe(false)
      expect(readReason(seen)).toBe('unreadable')
      // ⛔ **And the bytes never left the process.** A refusal that still read the file would be a
      // door that refuses its answer rather than its question.
      expect(JSON.stringify(seen)).not.toContain('not a resource at all')
    })

    it('⚑ …and the SAME row one fact over is answered — the control for the refusal above', async () => {
      const resource = await aResource('the real one\n')
      // ⚠️ The paired positive `an-untested-refusal-is-a-guess` asks for: same id, same door, same
      // disk, and the only difference is a name that stays inside the tree.
      expect(readReason(host.readResourceForAPerson(resource))).toBe('ok')
      // ⛔ **And a symlink at the leaf is refused too** — `resourceBytes` asks the path on its real
      // spelling, which is what catches a link pointing out, before a byte is read.
      const leaf = whereItIs(resource)
      rmSync(leaf)
      writeFileSync(join(outside, 'secrets.md'), 'not a resource at all\n')
      symlinkSync(join(outside, 'secrets.md'), leaf)
      expect(readReason(host.readResourceForAPerson(resource))).toBe('unreadable')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the plant — the field, never the paragraph
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the control is derived from the FIELD and never from the words beside it', () => {
    it('🔴 a report whose field and whose sentence name different resources presses the FIELD’s', () => {
      // ⛔ **The one assertion that tells this design apart from the tempting one.** The id is
      // printed in the row's own body — `replyText`'s output, verbatim — so a renderer that
      // scraped it would pass every other test in this file. ⚑ `work-report.ts`: *"a renderer that
      // read the outcome out of the prose would be a second reading of a fold it cannot see."*
      const report = workAnswered(piece, { outcome: 'done', needsUserAction: false }, [
        'res_the-field',
      ])
      const transcript = createTranscript()
      applyEvent(
        transcript,
        {
          type: 'user_turn',
          text: 'It kept the file res_the-sentence. Read it with read_document.',
          work: report,
        },
        1_000,
      )
      const row = transcript.items.find((item) => item.kind === 'workReport')
      expect(row?.kind === 'workReport' && row.text).toContain('res_the-sentence')
      const opens = theResourcesAReportNames(
        row?.kind === 'workReport' ? row.report : { resources: undefined },
        true,
      )
      expect(opens).toEqual(['res_the-field'])
    })

    it('⛔ both absences draw nothing, and so does a surface with no reader behind it', () => {
      const withOne = { resources: ['res_the-answer'] }
      expect(theResourcesAReportNames({ resources: undefined }, true)).toEqual([])
      expect(theResourcesAReportNames({ resources: [''] }, true)).toEqual([])
      expect(theResourcesAReportNames(withOne, false)).toEqual([])
      // ⚑ The paired positive, so none of the three above passes vacuously.
      expect(theResourcesAReportNames(withOne, true)).toEqual(['res_the-answer'])
    })

    it('⚠️ a bundle can carry any bytes at all, and the TYPE is what is guarded', () => {
      // ⛔ **`toPersistedEvents` CASTS and a `.brobot` bundle is `.passthrough()`d**, and
      // `isAWorkReport` is structural by design — `piece`, `label`, `state` and nothing else. So
      // these are bytes on disk rather than hypotheses, and a presence check would hand one of
      // them to the bridge.
      for (const planted of [42, {}, [], true, null, [42, null, {}]]) {
        const report = { resources: planted } as unknown as { resources?: string[] }
        expect(theResourcesAReportNames(report, true), JSON.stringify(planted)).toEqual([])
      }
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the wiring — every hop, so a deleted one is a failure rather than a dead control
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · the press reaches the door', () => {
    const SRC = (path: string): string => readSource(join(here, path))

    it('⛔ four hops, and each one is asked for rather than spelled twice', () => {
      expect(SRC('../src/renderer/src/components/WorkReportEntry.vue')).toContain(
        "emit('openDocument', resource)",
      )
      expect(SRC('../src/renderer/src/components/TranscriptView.vue')).toContain(
        '@open-document="(resourceId) => $emit(\'openDocument\', resourceId)"',
      )
      expect(SRC('../src/renderer/src/components/ConversationPane.vue')).toContain(
        'async function openResource(resourceId: string): Promise<void> {',
      )
      expect(SRC('../src/renderer/src/components/RuntimeScreen.vue')).toContain(
        ':on-read-resource="readResourceForAnySurface"',
      )
    })

    it('🔴 the press draws only where a reader exists, on BOTH panes', () => {
      // ⛔ `106`: a control that does nothing when pressed is worse than no control. ⚑ Both panes
      // gate on the presence of the fetch prop rather than on a boolean somebody remembers.
      //
      // ⚠️ **640 · the needle moved because the RULE moved, and this assertion followed it.** Both
      // panes ask `aSurfaceMayOpenADocument`, which is the one place that decides. ⛔ So this reads
      // the same fact in two hops instead of one, and the second hop — the rule's own body — is
      // pinned below so the pair cannot go quiet by both drifting.
      for (const pane of ['ConversationPane', 'ReadingPane']) {
        const source = SRC(`../src/renderer/src/components/${pane}.vue`)
        expect(source, pane).toContain(':can-open-document="mayOpenADocument"')
        expect(source, pane).toContain(
          'const mayOpenADocument = computed(() => aSurfaceMayOpenADocument(props.onReadResource))',
        )
        // ⛔ …and neither pane kept a second, private answer to the same question.
        expect(source, pane).not.toContain('props.onReadResource !== undefined')
      }
      expect(SRC('../src/renderer/src/lib/opening-a-document.ts')).toContain(
        'return read !== undefined',
      )
    })

    it('⚠️ the id is never taken apart in the renderer', () => {
      // ⛔ **A second reading of `newResourceId`.** Splitting `res_<32 hex>` in a renderer would be
      // free to disagree with `ids.ts` the day the id gains a character.
      const lib = SRC('../src/renderer/src/lib/the-document-a-report-names.ts')
      expect(lib).not.toContain('.split(')
      expect(lib).not.toContain("startsWith('res_')")
    })
  })
})
