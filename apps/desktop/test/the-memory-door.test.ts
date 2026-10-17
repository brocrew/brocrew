import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FakeRuntime, claudeAutoMemoryDir } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import type { AccessLists } from '../src/main/recovery/windows-privacy'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import {
  RuntimeHost,
  THE_APP_ITSELF,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import { WINDOW_CALLER_PREFIX } from '../src/main/runtime/window-caller'
import { A_PERSON_DID_THIS, REFUSAL_MEANS } from '../src/shared/agent-memory'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * # 🔴 The memory door, through a real host (625, `EXT-015` §1 · §3)
 *
 * ⛔ **`memory-without-a-conversation.test.ts` proves the READER and proves nothing about the
 * wiring** — which is `318`'s own lesson, quoted by `memory-loaded-host.test.ts` one door over:
 * *"with only the unit file in the suite, deleting the host's publish left every assertion green
 * while the conversation showed nothing."* ⚠️ So every assertion here goes through a real
 * `RuntimeHost`, a real store and a real database.
 *
 * ## ⛔ The four facts this file holds
 *
 *  1. **The read needs no conversation** — the whole of `EXT-015` §1's Team-page door.
 *  2. **The act and its RECORD land together**, and the record survives the file.
 *  3. **A refusal answers a READING**, not a throw — `425`'s rule that a refusal carries its
 *     remedy, and `HO-029` §3's that a surface may not report an act it cannot confirm.
 *  4. **Criterion 12**: a slug with no identity row writes nothing and says so.
 */

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  // ⛔ **A WINDOW's owner id, not `owner:1`.** `aPersonTypedIt` is `aWindowIsAsking(ownerId)`, so
  // a sink with an arbitrary id records every act as *a caller this app cannot name* — which would
  // make §2's `{ who: 'a-person' }` assertions pass for the wrong reason, or not at all.
  readonly ownerId = `${WINDOW_CALLER_PREFIX}1`
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
  events(): TranscriptEvent[] {
    return this.messages.map((message) => message.event)
  }
}

const THE_FALSE_NOTE =
  'a deliberately parked agent is indistinguishable from a broken one in this app\n'

let userData: string
let db: AppDatabase
let host: RuntimeHost
let sink: RecordingSink

const homeOf = (provider: Provider, profileId: string): string =>
  join(userData, 'provider-homes', 'default', profileId, provider)

/**
 * ⚑ **The composition this file's hosts are built from, as a FACTORY** — so the refusing-store
 * host in §2 differs from the ordinary one in exactly one dep and in nothing else.
 *
 * ⛔ **A second literal would be a second answer to *what is this host*** — and the assertion
 * that turns on the difference would then be measuring whichever field drifted.
 */
/** ⚠️ **Reset per test**, so a session id never depends on how many tests ran before it. */
let counter = 0
const hostDeps = (): ConstructorParameters<typeof RuntimeHost>[0] => ({
  store: createSessionStore(db),
  discoverSessions: NO_DISCOVERY,
  nativeTranscriptPath: () => null,
  exportDirectory: () => join(userData, 'exports'),
  createRuntime: (provider: Provider) => new FakeRuntime(provider),
  prepareProviderHome: (provider, profileId) => {
    const home = homeOf(provider, profileId)
    mkdirSync(home, { recursive: true })
    return home
  },
  providerHomePath: (provider, profileId) => homeOf(provider, profileId),
  // ⛔ **The seam the containment check hangs off.** A host wired without it makes NOTHING
  // amendable — see §2's last case, which is the fail-closed direction stated as a test.
  providerHomesRoot: () => join(userData, 'provider-homes'),
  resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
  newSessionId: () => `sess_${String(++counter)}`,
  readProviderConfig: (provider, home) => ({
    home,
    homeEnv: 'CLAUDE_CONFIG_DIR',
    model: 'm',
    authNote: null,
    files: [],
  }),
  // ⛔ **The REAL launch reader, not a stub** — §3 is about what a conversation was GIVEN, and a
  // stubbed reader would make that assertion about the fixture instead of about the app.
  // ⚑ The composition root wraps it in a bundle publish; nothing here needs one, and the reader's
  // own contract is that an absent bundle is every host test that is not about instructions.
  readInstructions: (provider, cwd, providerHome) => {
    const read = readSessionInstructions({ provider, cwd, providerHome })
    // ⚑ **The composition root's own three fields**, and `systemHint` comes from the reader's
    // `composed` for its stated reason: one composition, handed to the adapter from the same
    // field the panel draws.
    return {
      instructions: read.instructions,
      systemHint: read.instructions.composed ?? undefined,
      memoryLoaded: read.memoryLoaded,
    }
  },
})

beforeEach(() => {
  counter = 0
  userData = mkdtempSync(join(tmpdir(), 'brobot2-memory-door-'))
  db = openDatabase(join(userData, 'brobot2.sqlite'))
  applyMigrations(db, migrationsFolder)
  host = new RuntimeHost(hostDeps())
  sink = new RecordingSink()
})

afterEach(async () => {
  await host.closeAll()
  db.close()
  rmSync(userData, { recursive: true, force: true })
})

/** The night `EXT-015` §0 is about: an index with a pointer, and the false note beside it. */
const plantTheNight = (profileId: string): { note: string; index: string } => {
  const dir = claudeAutoMemoryDir(homeOf('claude', profileId))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'MEMORY.md'), '- [A parked agent](parked.md)\n')
  writeFileSync(join(dir, 'parked.md'), THE_FALSE_NOTE)
  return { note: join(dir, 'parked.md'), index: join(dir, 'MEMORY.md') }
}

const identity = (slug: string): void => {
  const made = createSessionStore(db).createAgentIdentity(
    { slug, displayName: null, provider: 'claude' },
    { by: 'a-person' },
  )
  expect(made, `no identity row for ${slug}`).not.toBeNull()
}

describe('§1 · ⛔ the read reaches the store with NO conversation open', () => {
  it('🔴 the Team page’s door answers both providers, the amendments and a moment', () => {
    identity('brobot')
    plantTheNight('brobot')

    const reading = host.agentMemory('BroBot')
    // ⚑ **Folded**, like every other slug argument on this host.
    expect(reading.profileId).toBe('brobot')
    expect(reading.stores.map((store) => store.provider)).toEqual(['claude', 'codex'])
    expect(reading.stores[0]?.entries.map((entry) => entry.text)).toContain(THE_FALSE_NOTE)
    // ⛔ **The OTHER provider is `no-home`, not an empty list** — `EXT-015` §3.4 answered by name.
    expect(reading.stores[1]?.state).toBe('no-home')
    expect(reading.amendments).toEqual([])
    expect(reading.readAt).toBeGreaterThan(0)
    // 🔴 **No conversation was created in this test at all.** That is the assertion, and it is the
    // whole of `EXT-015` §1: today's only memory reading is a conversation's.
    expect(sink.messages).toEqual([])
  })

  it('⚑ an identity with no row answers stores rather than a refusal — criterion 12 is on the WRITE', () => {
    const reading = host.agentMemory('nobody')
    expect(reading.stores.every((store) => store.state === 'no-home')).toBe(true)
    expect(reading.amendments).toEqual([])
  })
})

describe('§2 · 🔴 the act and its record land together', () => {
  it('Windows corrections and a removal keep request order and record the actual previous text', async () => {
    identity('brobot')
    const { note } = plantTheNight('brobot')
    let release = (): void => {}
    let entered = (): void => {}
    const paused = new Promise<void>((resolve) => {
      release = resolve
    })
    const waiting = new Promise<void>((resolve) => {
      entered = resolve
    })
    let first = true
    const me = 'S-1-5-21-111-222-333-1001'
    const lists: AccessLists = {
      userSid: async () => me,
      machineSid: async () => null,
      restrict: async () => {
        throw new Error('The fictional folder is already private')
      },
      read: async () => {
        if (first) {
          first = false
          entered()
          await paused
        }
        return `D:PAI(A;OICI;FA;;;${me})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)`
      },
    }
    const ordered = new RuntimeHost({ ...hostDeps(), memoryWrites: { platform: 'win32', lists } })
    try {
      const ask = (act: 'corrected' | 'removed', text: string) =>
        ordered.amendAgentMemory(
          { profileId: 'brobot', provider: 'claude', entry: note, act, text },
          sink,
        )
      const a = ask('corrected', 'FIRST\n')
      await waiting
      const b = ask('corrected', 'SECOND\n')
      const removed = ask('removed', '')
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(readFileSync(note, 'utf8')).toBe(THE_FALSE_NOTE)
      expect(ordered.agentMemory('brobot').amendments).toEqual([])
      release()
      const answers = await Promise.all([a, b, removed])
      expect(answers.map((answer) => answer?.done)).toEqual([true, true, true])
      expect(
        answers.map((answer) =>
          answer?.done ? [answer.amendment.textBefore, answer.amendment.textAfter] : null,
        ),
      ).toEqual([
        [THE_FALSE_NOTE, 'FIRST\n'],
        ['FIRST\n', 'SECOND\n'],
        ['SECOND\n', null],
      ])
      expect(existsSync(note)).toBe(false)
      expect(
        ordered.agentMemory('brobot').amendments.map((row) => [row.textBefore, row.textAfter]),
      ).toEqual([
        ['SECOND\n', null],
        ['FIRST\n', 'SECOND\n'],
        [THE_FALSE_NOTE, 'FIRST\n'],
      ])
    } finally {
      release()
      await ordered.closeAll()
    }
  })

  it('⛔ a person removes the false note — the file goes, the row stays, and the reading comes back', async () => {
    identity('brobot')
    const { note } = plantTheNight('brobot')

    const answered = await host.amendAgentMemory(
      { profileId: 'brobot', provider: 'claude', entry: note, act: 'removed', text: '' },
      sink,
    )

    expect(answered?.done).toBe(true)
    expect(existsSync(note)).toBe(false)
    // 🔴 **The record carries the bytes the file no longer has.**
    expect(answered?.done === true && answered.amendment.textBefore).toBe(THE_FALSE_NOTE)
    expect(answered?.done === true && answered.amendment.act).toBe('removed')
    expect(answered?.done === true && answered.amendment.by).toEqual({ who: 'a-person' })
    expect(answered?.done === true && answered.amendment.textAfter).toBeNull()
    // ⚑ **Read BACK rather than echoed** — the reading on the answer is taken after the act, and
    // the amendment is on it.
    expect(answered?.reading.amendments.map((one) => one.entry)).toEqual([note])
    expect(JSON.stringify(answered?.reading.stores)).not.toContain(THE_FALSE_NOTE.trim())
    // ⚠️ **And a second, independent read agrees** — so the answer is not a value this method built.
    expect(host.agentMemory('brobot').amendments).toHaveLength(1)
  })

  it('⛔ a correction records what it replaced AND what it put there', async () => {
    identity('brobot')
    const { note } = plantTheNight('brobot')

    const answered = await host.amendAgentMemory(
      {
        profileId: 'brobot',
        provider: 'claude',
        entry: note,
        act: 'corrected',
        text: 'BROBOT-625-A-PARKED-AGENT-IS-DISTINGUISHABLE\n',
      },
      sink,
    )

    expect(answered?.done).toBe(true)
    expect(readFileSync(note, 'utf8')).toBe('BROBOT-625-A-PARKED-AGENT-IS-DISTINGUISHABLE\n')
    const row = host.agentMemory('brobot').amendments[0]
    expect(row?.act).toBe('corrected')
    expect(row?.textBefore).toBe(THE_FALSE_NOTE)
    expect(row?.textAfter).toBe('BROBOT-625-A-PARKED-AGENT-IS-DISTINGUISHABLE\n')
  })

  it('🔴 a REFUSAL answers a reading and records NOTHING — it does not throw', async () => {
    identity('brobot')
    plantTheNight('brobot')

    const answered = await host.amendAgentMemory(
      {
        profileId: 'brobot',
        provider: 'claude',
        entry: join(userData, 'provider-homes', 'default', 'brobot', 'claude', 'memory', 'gone.md'),
        act: 'removed',
        text: '',
      },
      sink,
    )

    expect(answered?.done).toBe(false)
    expect(answered?.done === false && answered.refused).toBe('no-such-entry')
    // ⛔ **The store comes back either way**, so a person sees what is actually there — `425`.
    expect(JSON.stringify(answered?.reading.stores)).toContain(THE_FALSE_NOTE.trim())
    // 🔴 **And nothing was recorded**, which is `HO-029` §3: a surface may not report an act as
    // done until the act is recorded, and there was no act.
    expect(answered?.reading.amendments).toEqual([])
    expect(host.agentMemory('brobot').amendments).toEqual([])
  })

  it('🔴 an act that LANDS whose record does not is `not-recorded` — never `write-failed`', async () => {
    // ⛔ **Found reviewing this dispatch's own diff.** The branch answered `write-failed`, whose
    // sentence is *"Nothing changed and nothing was recorded"* — and in this state the file is
    // gone. ⚠️ **Two questions about one address**: one word was carrying *the filesystem refused*
    // and *the record refused*, and only the first of those sentences is ever true of both.
    //
    // ⚑ **Produced with a store whose write refuses**, which is the state an identity row going
    // away between the existence check and the write would really cause — `put-the-hazard-on-the-path-the-code-walks`
    // applied to a race a single-threaded fixture cannot run.
    identity('brobot')
    const { note } = plantTheNight('brobot')
    const store = createSessionStore(db)
    const refusing = new RuntimeHost({
      ...hostDeps(),
      store: { ...store, writeMemoryAmendment: () => null },
    })
    try {
      const answered = await refusing.amendAgentMemory(
        { profileId: 'brobot', provider: 'claude', entry: note, act: 'removed', text: '' },
        sink,
      )
      expect(answered?.done).toBe(false)
      expect(answered?.done === false && answered.refused).toBe('not-recorded')
      // 🔴 **The file really is gone**, which is what makes `write-failed`'s sentence false here
      // and this word necessary.
      expect(existsSync(note)).toBe(false)
      expect(answered?.reading.amendments).toEqual([])
      expect(REFUSAL_MEANS['not-recorded']).toContain('not in the history')
      // ⚑ **The control**: the word it is NOT still promises the thing that would be false.
      expect(REFUSAL_MEANS['write-failed']).toContain('Nothing changed')
    } finally {
      void refusing.closeAll()
    }
  })

  it('⛔ a slug with no identity row writes nothing and says so — criterion 12', async () => {
    const { note } = plantTheNight('ghost')

    const answered = await host.amendAgentMemory(
      { profileId: 'ghost', provider: 'claude', entry: note, act: 'removed', text: '' },
      sink,
    )

    expect(answered).toBeNull()
    // 🔴 **The FILE is untouched**, which is the half a null return does not state: the existence
    // check runs before anything reaches the filesystem, so a probe for an identity cannot be
    // performed by watching a store get walked.
    expect(existsSync(note)).toBe(true)
  })
})

describe('§3 · ⚠️ a change reaches the agent from its NEXT conversation', () => {
  it('🔴 the running conversation keeps the entry; a conversation started AFTER does not have it', async () => {
    // ⛔ **`EXT-015` §2.1 and §2's fourth row**, as one measurement rather than two claims: the
    // conversation's copy *"is a record; never; it is this conversation's"*, and *"an edit made now
    // reaches the agent from its NEXT conversation"*. ⚑ Both halves need the same fixture, and a
    // test that asserted only the first could be satisfied by a change that reached nothing at all.
    identity('brobot')
    const { note } = plantTheNight('brobot')

    const first = await host.createSession({ provider: 'claude', profileId: 'brobot' }, sink)
    // ⚠️ **This is the object a window draws** — `CreatedSession.instructions`, whose own docblock
    // is *"nothing here should be refreshed in place"*.
    expect(JSON.stringify(first.instructions.agentMemory)).toContain(THE_FALSE_NOTE.trim())

    expect(
      (
        await host.amendAgentMemory(
          { profileId: 'brobot', provider: 'claude', entry: note, act: 'removed', text: '' },
          sink,
        )
      )?.done,
    ).toBe(true)

    // 🔴 **The running conversation's record is unchanged** — the removal mutated nothing it points
    // at, which is what *never* in that table cell has to mean.
    expect(JSON.stringify(first.instructions.agentMemory)).toContain(THE_FALSE_NOTE.trim())
    // ⛔ **…and the NEXT conversation does not have it**, which is the half that makes the first
    // one a property of the copy rather than of a reader that answers nothing.
    const second = await host.createSession({ provider: 'claude', profileId: 'brobot' }, sink)
    expect(JSON.stringify(second.instructions.agentMemory)).not.toContain(THE_FALSE_NOTE.trim())
  })
})

describe('§4 · 🔒 the door, and who may reach it', () => {
  /**
   * ⛔ **The census behind `A_PERSON_DID_THIS`, and it is what makes the missing `wrote_it` column
   * a DECISION rather than an omission** (`EXT-015` §3.3).
   *
   * ⚠️ **`identity_instruction` carries a provenance vocabulary because FOUR authorities can write
   * a version.** `identity_memory_amendment` carries none because exactly one can reach this door,
   * and that is a claim about the SOURCE rather than about the schema — so it is asserted here.
   * 🔴 **The day an agent may amend another agent's memory, this is what goes red.**
   */
  it('⛔ both verbs are gated on a PERSON, and no toolset names either of them', () => {
    const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '../src')
    const withoutComments = (text: string): string =>
      text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
    const ipcCode = withoutComments(readFileSync(join(srcRoot, 'main/runtime/ipc.ts'), 'utf8'))
    // ⚑ **Non-vacuity first**: a path typo would make every `indexOf` answer -1 and this file
    // silent, which is `34`'s shape — a broken check's silence reads as a clean result.
    expect(ipcCode.length).toBeGreaterThan(1000)

    // ⛔ **Scoped to the case's OWN BODY, and a fixed-width slice is what this started as.**
    // 🔴 **Measured, not imagined**: with `slice(at, at + 200)` both `requireAPerson` rows of the
    // 625 mutation table SURVIVED. Stripping a comment leaves whitespace, so a 200-character
    // window that begins at `case 'agentMemory':` runs past its own `return` and into
    // `case 'amendAgentMemory':` — and found that case's gate instead of the missing one.
    // ⚠️ `an-assertion-can-be-satisfied-by-a-neighbouring-element` and
    // `a-fixed-width-slice-runs-into-the-next-region`, together, in a file whose neighbour
    // happens to be guarded. ⚑ **The body ends at the next `case '`**, which is a boundary the
    // source itself defines rather than a number somebody chose.
    const bodyOf = (kind: string): string => {
      const at = ipcCode.indexOf(`case '${kind}':`)
      expect(at, `${kind} has no case in the command dispatcher`).toBeGreaterThan(0)
      const next = ipcCode.indexOf(`case '`, at + 1)
      expect(
        next,
        `${kind} is the last case — the slice would run to the end of the file`,
      ).toBeGreaterThan(at)
      return ipcCode.slice(at, next)
    }
    for (const kind of ['agentMemory', 'amendAgentMemory']) {
      expect(bodyOf(kind), `${kind} is not gated on a person asking`).toContain(
        'requireAPerson(sink, command.kind)',
      )
    }
    // ⚑ **The control that would have caught the slice**: a case this file knows is NOT gated —
    // `close` takes a session and is answered by the ownership boundary instead — must come back
    // without the gate, so a body that had swallowed its neighbour goes red here.
    expect(bodyOf('close')).not.toContain('requireAPerson(sink, command.kind)')

    // ⛔ **…and the door does not reach an AGENT.** `agent-tools.ts` publishes a closed inventory
    // (347); this is the negative with a search shape — the tools module names neither verb.
    const tools = withoutComments(
      readFileSync(join(srcRoot, 'main/runtime/agent-tools.ts'), 'utf8'),
    )
    // ⚑ **The positive control**: the sweep really is reading the tool inventory.
    expect(tools).toContain('give_work')
    for (const kind of ['agentMemory', 'amendAgentMemory']) {
      expect(tools, `${kind} is reachable from a tool`).not.toContain(kind)
    }
    // 🔴 **And the sentence that states it**, so a reader meets the ruling where the vocabulary
    // would otherwise be (standing rule 5: a safety sentence with no test is a comment).
    expect(A_PERSON_DID_THIS).toContain('Only a person')
  })

  it('⛔ the app itself performing an amendment is recorded as the app, never as a person', async () => {
    // ⚠️ **The window wire refuses a caller that is not a person** — `requireAPerson`, asserted in
    // `the-memory-door-refuses-an-agent.test.ts`'s shape and by `window-authority.test.ts`'s table.
    // ⛔ **This is the half BELOW that gate**: if something ever did reach the host as the app, the
    // record says the app. 🔴 It is `477`'s finding — provenance is not derivable from the act —
    // and it is why the row carries `by` rather than a vocabulary with one member.
    identity('brobot')
    const { note } = plantTheNight('brobot')

    const answered = await host.amendAgentMemory(
      { profileId: 'brobot', provider: 'claude', entry: note, act: 'removed', text: '' },
      THE_APP_ITSELF,
    )

    expect(answered?.done === true && answered.amendment.by).toEqual({ who: 'the-app-itself' })
  })
})
