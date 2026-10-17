import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import {
  FakeProviderSessions,
  FakeRuntime,
  type AgentToolset,
  type ModelChoice,
  type ProviderRuntimeContext,
  type ResumeOptions,
  type SessionRef,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import NoticeEntry from '../src/renderer/src/components/NoticeEntry.vue'
import PersonsQueue from '../src/renderer/src/components/PersonsQueue.vue'
import {
  whatAProviderPressWouldClear,
  whatTheProviderPressCleared,
} from '../src/renderer/src/lib/agent-model-choice'
import { createAgentStore, type AgentStore } from '../src/renderer/src/lib/agent-store'
import {
  instructionAskedSentence,
  type InstructionAsked,
} from '../src/renderer/src/lib/instruction-asked'
import {
  stalledWorkLead,
  usePersonsQueue,
  type PersonsQueueDoors,
} from '../src/renderer/src/lib/persons-queue'
import { absenceUnreadSays } from '../src/renderer/src/lib/rows-unread'
import { readableError } from '../src/renderer/src/lib/session-record'
import { applyEvent, createTranscript, type NoticeItem } from '../src/renderer/src/lib/transcript'
import { HOLDING_SAYS, type AgentRemoved } from '../src/shared/agent-roster'
import { aChoiceInWords, type AgentModelChoice } from '../src/shared/model-choice'
import {
  DEFAULT_PROFILE_ID,
  PROVIDER_NAME,
  type AgentIdentities,
  type AgentIdentity,
  type InstructionProposedEvent,
  type RuntimeBridge,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'
import { stalledWorkKey, type StalledWork } from '../src/shared/stalled-work'
import { everythingOverTheWire } from './lib/the-wire'

/**
 * # 🔴 712 · what the seats handed over, drawn — the node half, over real doors where there are any
 *
 * ⚑ **`712`** (PM, 2026-09-24) — *"Every fact below is already on the wire. Main carried it; nothing
 * on screen says it yet."* This file pins the draws a node process can reach, each through the path
 * the product walks, each with its control one fact over:
 *
 *  - **§1 · draw 7 (`707` GAP-1)** — the work card's heading said the project a report named.
 *    ⚑ **D-016 · gone with its subject**: there are no projects, and every piece reads by its label.
 *  - **§2 · draw 2 (`702` GAP-3)** — the band's lead for a row whose giver was told nothing,
 *    answered by the host and drawn by `PersonsQueue`. ⚑ **D-016c** — R54's first half (the lead
 *    for a giver told *a message would start it*) went with that notice: a stop tells nobody
 *    anything, so no band row carries a telling.
 *  - **§3 · draw 3 (`697` H-a)** — `absenceUnreadSays`, the clause two viewers add to an absence.
 *  - **§4 · draw 4 (R56)** — the sentence said BEFORE the provider press, checked cell by cell
 *    against what the real `setAgentProvider` door then clears: a prediction against the door it
 *    predicts (standing rule 3's rail-diverge shape).
 *  - **§5 · draw 10 (R55)** — the rail's short face for a crash-closed row. ⚑ **D-017b · gone with
 *    its subject**: no closed rows, and the crash flag left the wire.
 *  - **§6 · draw 8 (`707` GAP-5, R41)** — every identity a person reads is NAMED: the instruction
 *    notice (fold + `NoticeEntry`) and `agent-store`'s removal and creation sentences. ⚑ D-016 took
 *    the proposal's speaker with proposals.
 *
 * ⛔ **Not here**: draw 5 (R57 — not built by `712`: the renderer could not know a close was in
 * flight after a reload, a GAP for main; ⚑ since amended by R62, carried by `716` as `closing` and
 * drawn by `725` — `a-row-still-closing-says-so`), draws 6 and 9 (comments only), draw 1 (the Team
 * page — a DOM draw).
 * ⚠️ §3's census — the plural spelled only in `rows-unread.ts` — is `what-main-now-hands-you.test.ts`
 * §3's, and holds by construction: `absenceUnreadSays` spells its count through `rowsOfTheRecord`.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** ⚑ A window a person is behind — every door here is pressed by one. */
class Seat implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

// ── what SSR drew, as a person reads it ───────────────────────────────────────────────────────

function decoded(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/**
 * ⚑ **The text of every element whose `data-cy` is exactly `cy`** — tag-balanced, so an element
 * holding a child of its own tag is read to ITS close, and comments and tags stripped from what it
 * holds. ⛔ Each open tag is found by its own delimiter, never by a fixed window.
 */
function drawnAt(markup: string, cy: string): string[] {
  const out: string[] = []
  const opening = new RegExp(`<([a-zA-Z][a-zA-Z0-9-]*)\\b[^>]*\\sdata-cy="${cy}"[^>]*>`, 'g')
  for (const found of markup.matchAll(opening)) {
    const tag = found[1] ?? ''
    const from = (found.index ?? 0) + found[0].length
    const tags = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g')
    tags.lastIndex = from
    let depth = 1
    let to = -1
    for (let next = tags.exec(markup); next !== null; next = tags.exec(markup)) {
      depth += next[1] === '/' ? -1 : 1
      if (depth === 0) {
        to = next.index
        break
      }
    }
    if (to < 0) throw new Error(`no close for <${tag} data-cy="${cy}">`)
    out.push(
      decoded(
        markup
          .slice(from, to)
          .replace(/<!--[\s\S]*?-->/g, '')
          .replace(/<[^>]+>/g, ''),
      )
        .replace(/\s+/g, ' ')
        .trim(),
    )
  }
  return out
}

/** ⚑ Exactly one element carries `cy` — a render that drew none is a failure, never a pass. */
function theOneAt(markup: string, cy: string): string {
  const all = drawnAt(markup, cy)
  expect(all, `${cy} drawn ${String(all.length)} times`).toHaveLength(1)
  return all[0] ?? ''
}

const render = (component: unknown, props: Record<string, unknown>): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(component as never, props) }))

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · draw 7 — `707` GAP-1: the work card's heading. ⚑ D-016: gone with its subject — there are
// no projects, so a piece reads by its label (*W1.2*) everywhere and no heading says a project.
// ─────────────────────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · draw 2 — `702` GAP-3: the band's lead
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚑ **`692`'s world** (`a-restart-keeps-what-was-open.test.ts` §8): a lead and three agents it
 * gave work to (D-016: a give is what starts a helper), a graceful quit, a relaunch — its own store
 * object — and a person's Close. ⚑ The provider
 * double keeps every toolset the host handed out, so the lead's own doors are the ones pressed.
 */
class ToolsetKeeper extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handed: AgentToolset[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
  override async resume(
    ref: SessionRef,
    options: ResumeOptions,
  ): ReturnType<FakeRuntime['resume']> {
    const handle = await super.resume(ref, options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
}

describe('§2 · draw 2 (`702` GAP-3) — a giver told nothing is named so on the band', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handed: AgentToolset[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let seat: Seat
  const tick = (): number => clock++

  const DOORS: PersonsQueueDoors = {
    travel: () => {},
    settle: () => {},
    takeOver: () => {},
    open: () => {},
  }

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ToolsetKeeper(provider, handed, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-712-band-'))
    root = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-712-band-root-')))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_120_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    issued = new FakeProviderSessions()
    host = buildHost()
    seat = new Seat('webContents:1')
  })

  afterEach(async () => {
    usePersonsQueue().forget()
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  /** ⚑ A person's ⌘Q, then the next launch — its own `SessionStore` over the same database. */
  const quitThenLaunch = async (): Promise<void> => {
    await host.closeAll()
    store = createSessionStore(db, tick)
    host = buildHost()
  }

  const newestToolset = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed out')
    return last
  }

  const pressWith = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  /**
   * ⚑ A lead a person opened, and three agents it gave work to — `692`'s incident. ⚑ D-016 ·
   * `spawn_agent` is gone: each child comes into being holding the piece its give started it with,
   * and its brief is its first turn (which the double parks on a card, in `ask`).
   */
  const aLeadAndItsThree = async (): Promise<{
    lead: string
    child: string
    leadTools: AgentToolset
  }> => {
    const kids = ['mock-dev', 'mock-dev-2', 'platform-runtime-pm']
    for (const kid of kids) {
      const { sessionId } = await host.createSession(
        { provider: 'claude', profileId: kid, approvalMode: 'ask', cwd: root },
        seat,
      )
      await host.close(sessionId, seat)
    }
    const { sessionId: lead } = await host.createSession(
      { provider: 'claude', profileId: 'lead', approvalMode: 'ask', cwd: root },
      seat,
    )
    const leadTools = newestToolset()
    expect(store.setCapabilities('lead', { canMessage: 'any' })).toBe(true)
    const children: string[] = []
    for (const kid of kids) {
      const given = await pressWith(leadTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: kid,
        title: `the ${kid} half of the work`,
        brief: `the ${kid} half of the work`,
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      children.push(given.agent as string)
    }
    const child = children[0]
    if (child === undefined) throw new Error('no child')
    return { lead, child, leadTools }
  }

  /** ⚑ The piece a child holds — the one its give started it with (the work the quit interrupts). */
  const pieceOf = (child: string): { piece: string; label: string } => {
    const held = store.piecesOwnedBy(child)[0]
    if (held === undefined) throw new Error(`${child} holds no work`)
    return { piece: held.piece, label: held.label }
  }

  const theBandRow = (piece: string): StalledWork => {
    const row = host.stalledWorkForAPerson().rows.find((one) => one.piece === piece)
    if (row === undefined) throw new Error(`the person’s band has no ${piece}`)
    return row
  }

  /** ⚑ The band as `PersonsQueue` draws it, supplied the way the screen supplies its fifth read. */
  const drawnLead = async (rows: readonly StalledWork[], key: string): Promise<string> => {
    const queue = usePersonsQueue()
    queue.supply(
      null,
      null,
      {
        held: new Set<string>(),
        answerable: new Map(),
        answeredFromHere: new Set<string>(),
        now: clock,
        lastLookAnswered: { questions: true, decisions: true },
      },
      DOORS,
      undefined,
      {
        walked: { rows, walk: host.stalledWorkForAPerson().walk, ledgers: 1, rowsUnread: 0 },
        lastLookAnswered: true,
      },
    )
    return theOneAt(await render(PersonsQueue, {}), `persons-queue-stall-says-${key}`)
  }

  it('🔴 a band row whose giver was told NOTHING — the host answers it and the lead is the sentence, byte for byte', async () => {
    const { child } = await aLeadAndItsThree()
    const { piece } = pieceOf(child)
    await quitThenLaunch()
    // ⚑ The lead is never started again, so nothing is pushed to it: the band's ordinary row. The
    // person's Close of the child moves nothing (D-016c).
    await host.close(child, seat)

    const row = theBandRow(piece)
    const said = stalledWorkLead(row)
    expect(said.endsWith(' — which gave it out — has not been told.')).toBe(true)
    expect(said).toBe(
      `${row.label} with ${row.ownerName} is not being worked on, and ${row.giverName} — which gave it out — has not been told.`,
    )
    expect(await drawnLead([row], stalledWorkKey(row))).toBe(said)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · draw 3 — `697` H-a: an absence scoped to what was read
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§3 · draw 3 (`697` H-a) — an absence is true of the rows that were read', () => {
  it('🔴 one row and three rows — the clause, pinned by name', () => {
    expect(absenceUnreadSays(1)).toBe(
      'in the rows this app could read; 1 row of this app’s record could not be read',
    )
    expect(absenceUnreadSays(3)).toBe(
      'in the rows this app could read; 3 rows of this app’s record could not be read',
    )
  })

  it('⚑ none is null — nothing unread, a count below one, a count that is not a number, and a renderer’s own fallback that read nothing', () => {
    for (const none of [0, -1, Number.NaN, undefined]) {
      expect(absenceUnreadSays(none), String(none)).toBeNull()
    }
    // ⚑ The control beside them: the smallest real count is not none.
    expect(absenceUnreadSays(1)).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §4 · draw 4 — R56: said before the press, against the door it predicts
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** ⚑ Each provider's catalogue: the choice below is one of its rows, so the save door admits it. */
const CATALOGUE: Record<Provider, ModelChoice[]> = {
  claude: [
    {
      id: 'opus',
      label: 'Opus',
      efforts: ['low', 'high'].map((id) => ({ id, label: id })),
    },
  ],
  codex: [
    {
      id: 'gpt-5.6-luna',
      label: 'luna',
      efforts: ['low', 'high'].map((id) => ({ id, label: id })),
    },
  ],
}

/** ⚑ The choice a person holds on each provider. */
const HELD_ON: Record<Provider, AgentModelChoice> = {
  claude: { provider: 'claude', model: 'opus', effort: 'high' },
  codex: { provider: 'codex', model: 'gpt-5.6-luna', effort: 'high' },
}

/** ⚑ Every provider this app has — `PROVIDER_NAME`'s keys, never a list typed here. */
const PROVIDERS = Object.keys(PROVIDER_NAME) as Provider[]

class CatalogueOnly extends FakeRuntime {
  override async listModels(context: ProviderRuntimeContext): Promise<ModelChoice[]> {
    await super.listModels(context)
    return CATALOGUE[this.provider]
  }
}

/** ⚑ The sentence's own grammar — what it names as keeping the choice, and the choice it names. */
const WOULD_CLEAR =
  /^Moving it to a provider other than (.+?) clears the model and effort chosen for it — (.+): a choice is always for its own provider\. Leaving no provider saved keeps it\.$/

/** ⚑ **The prediction, read out of the WORDS** — whether this sentence says a press on `pick` clears. */
function theSentenceSaysItClears(sentence: string | null, pick: Provider | null): boolean {
  if (sentence === null) return false
  const said = WOULD_CLEAR.exec(sentence)
  if (said === null) throw new Error(`not the R56 sentence: ${sentence}`)
  // ⚑ *Leaving no provider saved keeps it* — the one option that is not a provider.
  if (pick === null) return false
  return PROVIDER_NAME[pick] !== said[1]
}

describe('§4 · draw 4 (R56, `696` L2) — the provider control says what its press will clear, before it', () => {
  let userData: string
  let db: AppDatabase
  let host: RuntimeHost
  let agents: AgentStore
  let folders: Set<string>

  beforeEach(async () => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-712-r56-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    const sessions = createSessionStore(db)
    folders = new Set([DEFAULT_PROFILE_ID])
    host = new RuntimeHost({
      store: sessions,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new CatalogueOnly(provider),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? DEFAULT_PROFILE_ID, provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      listProfiles: () => [...folders],
      newSessionId: () => `sess_${Math.random().toString(36).slice(2)}`,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    const seat = new Seat('webContents:1')
    const run = async <T>(kind: string, input: Record<string, unknown> = {}): Promise<T> =>
      (await executeRuntimeCommand(host, seat, { kind, ...input } as Parameters<
        typeof executeRuntimeCommand
      >[2])) as T
    // ⚑ **The preload's own spellings**, with the real wire's clone in front of every call.
    const bridge: Partial<RuntimeBridge> = {
      agentIdentities: () => run('agentIdentities'),
      profiles: () => run('profiles'),
      agentModelAndEffort: (input) => run('agentModelAndEffort', { ...input }),
      setAgentModelAndEffort: (input) => run('setAgentModelAndEffort', { ...input }),
      setAgentProvider: (input) => run('setAgentProvider', { ...input }),
    }
    agents = createAgentStore(everythingOverTheWire(bridge) as RuntimeBridge)
    expect(
      sessions.createAgentIdentity(
        { slug: 'archivist', displayName: null, provider: null },
        { by: 'a-person' },
      ),
    ).not.toBeNull()
    folders.add('archivist')
    await agents.load()
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  it('⚑ the sentence, pinned by name — and nothing held says nothing', () => {
    expect(whatAProviderPressWouldClear(HELD_ON.claude)).toBe(
      'Moving it to a provider other than Claude clears the model and effort chosen for it — “opus” at high effort on Claude: a choice is always for its own provider. Leaving no provider saved keeps it.',
    )
    expect(whatAProviderPressWouldClear(null)).toBeNull()
  })

  it('🔴 for every held provider, both ways of holding it and every pick, the words said BEFORE the press name exactly what the real `setAgentProvider` then clears', async () => {
    const SLUG = 'archivist'
    const table: {
      held: Provider
      its: Provider | null
      pick: Provider | null
      predicted: boolean
      door: boolean
    }[] = []
    for (const heldOn of PROVIDERS) {
      for (const its of [heldOn, null]) {
        for (const pick of [...PROVIDERS, null]) {
          const cell = `held on ${heldOn}, its provider ${its ?? 'none'}, pick ${pick ?? 'none'}`
          // ⚑ **Reset through the doors**: nobody's provider (which keeps any choice), the choice,
          // then its own provider (the same provider keeps it) — and read back, so the cell stands
          // where it says it does.
          expect((await agents.chooseProviderFor(SLUG, null)).ok, cell).toBe(true)
          expect(await agents.chooseModelFor(SLUG, HELD_ON[heldOn]), cell).toMatchObject({
            ok: true,
          })
          if (its !== null) expect((await agents.chooseProviderFor(SLUG, its)).ok, cell).toBe(true)
          const read = await agents.modelChoiceFor(SLUG)
          // ⚑ **D-042 · the read is the agent's default, whole** — `682`'s `standIn` stamp is gone
          // with the stand-in re-judge, so the held row is the pair exactly as chosen.
          expect(read?.held, cell).toEqual(HELD_ON[heldOn])
          expect(
            agents.identities.value?.identities.find((one) => one.slug === SLUG)?.provider,
            cell,
          ).toBe(its)
          const held = read?.held ?? null

          // 🔴 **The words the control draws BEFORE the press** — from the held choice it read.
          const before = whatAProviderPressWouldClear(held)
          expect(before, cell).not.toBeNull()
          expect(WOULD_CLEAR.exec(before ?? '')?.[2], cell).toBe(aChoiceInWords(HELD_ON[heldOn]))
          const predicted = theSentenceSaysItClears(before, pick)

          // ⚑ **The press** — the sheet's own call, through the real door.
          const pressed = await agents.chooseProviderFor(SLUG, pick)
          if (!pressed.ok) throw new Error(`${cell}: ${pressed.reason}`)
          const door = pressed.cleared !== null
          // ⚑ …and the column agrees with the door's answer.
          expect((await agents.modelChoiceFor(SLUG))?.held === null, cell).toBe(door)
          if (pressed.cleared !== null && pick !== null) {
            expect(pressed.cleared, cell).toEqual(HELD_ON[heldOn])
            // ⚑ **The after-press line names the same choice the before-press line did** (HO-029 §3).
            expect(whatTheProviderPressCleared(pressed.cleared, pick), cell).toContain(
              aChoiceInWords(HELD_ON[heldOn]),
            )
          }
          table.push({ held: heldOn, its, pick, predicted, door })
        }
      }
    }

    // ⛔ **Not vacuous**: every cell ran, and the door both cleared and kept.
    expect(table).toHaveLength(PROVIDERS.length * 2 * (PROVIDERS.length + 1))
    expect(new Set(table.map((row) => row.door))).toEqual(new Set([true, false]))
    // 🔴 **THE RAIL-DIVERGE ASSERTION** — the prediction against the door it predicts, every cell.
    expect(table.filter((row) => row.predicted !== row.door)).toEqual([])
    // ⚑ …and both equal main's stated condition (`setAgentProviderTx`): a provider, not the choice's.
    expect(
      table.filter((row) => row.door !== (row.pick !== null && row.pick !== row.held)),
    ).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §5 · draw 10 — R55: the rail's face for a crash-closed row. ⚑ D-017b: gone with its subject —
// there is no closed row (one list; every conversation opens in its full view), and
// `closedBecauseTheAppDidNotFinishQuitting` left the wire (a process fact, `05` rule 5), so there is
// no crash to put a face on, in the rail or the palette.
// ─────────────────────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §6 · draw 8 — `707` GAP-5, R41: every identity a person reads is NAMED
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** ⚑ A roster row — only the two fields `agentName` reads; the rest is the host's. */
const named = (slug: string, displayName: string | null): AgentIdentity =>
  ({ slug, displayName }) as unknown as AgentIdentity

/**
 * ⚑ **Names that are NOT their slugs and do not start with the slug's letter** — so a surface that
 * printed the slug, or its first letter, cannot pass.
 */
const ROSTER: readonly AgentIdentity[] = [
  named('project-manager', 'Ada'),
  named('bookkeeper', 'Pam'),
  named('archivist', 'Iris'),
]

describe('§6 · draw 8 (`707` GAP-5, R41) — every identity a person reads is named, never by slug', () => {
  describe('(a) an agent’s ask about an identity’s rules — the fold keeps the facts; the notice names both', () => {
    const asked = (over: Partial<InstructionProposedEvent> = {}): InstructionProposedEvent => ({
      type: 'instruction_proposed',
      askId: 'iprop_1',
      ask: 'propose',
      about: 'bookkeeper',
      proposedBy: 'project-manager',
      text: 'Keep every receipt.',
      why: 'the books were short',
      ...over,
    })

    const noticeOf = (event: InstructionProposedEvent): NoticeItem => {
      const state = createTranscript()
      applyEvent(state, event as unknown as TranscriptEvent)
      const notices = state.items.filter((item): item is NoticeItem => item.kind === 'notice')
      expect(notices).toHaveLength(1)
      const notice = notices[0]
      if (notice === undefined) throw new Error('unreachable')
      return notice
    }

    it('🔴 the facts ride the item; its text is the roster-less sentence; with a roster, both identities are named', async () => {
      for (const ask of ['propose', 'relay'] as const) {
        const event = asked({ ask })
        const notice = noticeOf(event)
        const facts: InstructionAsked = {
          proposedBy: 'project-manager',
          about: 'bookkeeper',
          ask,
          characters: event.text.length,
        }
        expect(notice.instructionAsked, ask).toEqual(facts)
        expect(notice.level, ask).toBe('warn')
        expect(notice.text, ask).toBe(instructionAskedSentence(facts, null))

        const withNames = instructionAskedSentence(facts, ROSTER)
        expect(withNames, ask).toContain(
          ask === 'relay' ? 'Ada set rules for Pam' : 'Ada proposed rules for Pam',
        )
        expect(withNames, ask).not.toContain('project-manager')
        expect(withNames, ask).not.toContain('bookkeeper')

        // 🔴 **Drawn** — `NoticeEntry` with the roster names both; without it, the fold's own words.
        const item = { ...notice, at: 0 }
        expect(
          theOneAt(await render(NoticeEntry, { item, identities: ROSTER }), 'what-the-notice-says'),
          ask,
        ).toBe(withNames)
        expect(
          theOneAt(await render(NoticeEntry, { item, identities: null }), 'what-the-notice-says'),
          ask,
        ).toBe(notice.text)
      }
    })

    it('⚑ pinned by name — roster-less, the slugs stand, and BroBot’s slug reads *BroBot*', () => {
      const facts: InstructionAsked = {
        proposedBy: 'project-manager',
        about: 'bookkeeper',
        ask: 'propose',
        characters: 19,
      }
      expect(instructionAskedSentence(facts, null)).toBe(
        'project-manager proposed rules for bookkeeper — 19 characters. Nothing is written until you approve it on that agent.',
      )
      expect(
        instructionAskedSentence({ ...facts, proposedBy: DEFAULT_PROFILE_ID, ask: 'relay' }, null),
      ).toBe(
        'BroBot set rules for bookkeeper — 19 characters. It said you had given it this rule, so it was written.',
      )
      // ⚑ The control: a roster that does NOT name an identity falls back exactly as none does.
      expect(instructionAskedSentence(facts, [named('someone-else', 'Zed')])).toBe(
        instructionAskedSentence(facts, null),
      )
    })
  })

  describe('(c) `agent-store`’s removal and creation sentences', () => {
    const REREAD_FAILED = 'the ledger is locked by another process'

    const rosterOf = (identities: readonly AgentIdentity[]): AgentIdentities =>
      ({
        identities,
        foldersWithoutARow: [],
        use: [],
        spawningEnabled: true,
      }) as unknown as AgentIdentities

    /** ⚑ A store over a double bridge: the first read answers the roster; later reads may fail. */
    const storeOver = async (said: {
      roster: readonly AgentIdentity[]
      removed?: AgentRemoved
      rereadFails: boolean
    }): Promise<AgentStore> => {
      let reads = 0
      const bridge: Partial<RuntimeBridge> = {
        agentIdentities: () => {
          reads += 1
          return reads > 1 && said.rereadFails
            ? Promise.reject(new Error(REREAD_FAILED))
            : Promise.resolve(rosterOf(said.roster))
        },
        removeAgent: () => Promise.resolve(said.removed ?? { ok: true, slug: 'archivist' }),
        createAgent: (input) => Promise.resolve(named(input.slug, input.displayName)),
      }
      const store = createAgentStore(everythingOverTheWire(bridge) as RuntimeBridge)
      await store.load()
      expect(store.loadError.value).toBeNull()
      return store
    }

    const couldNotReread = readableError(new Error(REREAD_FAILED))

    it('🔴 a refusal names the agent it held back — and one fact over, an unnamed agent reads as its slug', async () => {
      const held: AgentRemoved = { ok: false, rail: 'it-is-still-held', held: ['conversations'] }
      const refusal = await (
        await storeOver({ roster: ROSTER, removed: held, rereadFails: false })
      ).remove('archivist')
      expect(refusal).toBe(`Iris cannot be removed yet: ${HOLDING_SAYS.conversations}.`)
      expect(refusal?.startsWith('Iris cannot be removed yet: ')).toBe(true)
      // ⚑ THE CONTROL: the same refusal, the row carrying no name.
      const unnamed = await (
        await storeOver({ roster: [named('archivist', null)], removed: held, rereadFails: false })
      ).remove('archivist')
      expect(unnamed).toBe(`archivist cannot be removed yet: ${HOLDING_SAYS.conversations}.`)
    })

    it('🔴 a removal whose re-read failed names the agent it removed', async () => {
      const said = await (
        await storeOver({ roster: ROSTER, rereadFails: true })
      ).remove('archivist')
      expect(said).toBe(
        `Iris was removed, but this window could not re-read the list: ${couldNotReread}`,
      )
      // ⚑ The control: the same removal with a re-read that answers says nothing.
      expect(
        await (await storeOver({ roster: ROSTER, rereadFails: false })).remove('archivist'),
      ).toBeNull()
    })

    it('⛔ KEY — *no such agent* keeps the slug, even when a roster names one: there is no row to name', async () => {
      const said = await (
        await storeOver({
          roster: ROSTER,
          removed: { ok: false, rail: 'no-such-agent' },
          rereadFails: false,
        })
      ).remove('archivist')
      expect(said).toBe(
        'There is no agent identity called archivist, so there is nothing to remove.',
      )
      expect(said).not.toContain('Iris')
    })

    it('⚑ a creation whose re-read failed names the agent by the name it was just given (a double that echoes the box)', async () => {
      const quill = await (
        await storeOver({ roster: ROSTER, rereadFails: true })
      ).create({
        slug: 'scribe',
        displayName: 'Quill',
        provider: null,
      })
      expect(quill).toBe(
        `Quill was created, but this window could not re-read the list: ${couldNotReread}`,
      )
    })
  })

  /**
   * 🔴 **(d) the creation, through the REAL door — a blank name box is not a nameless agent.**
   * ⛔ `712`'s first version named the new agent `said.displayName ?? slug` — the BOX — and its test's
   * double echoed the box back, so a blank box read *"scribe was created…"*. ⚑ Main gives such an
   * agent a name from the pool (`nameForANewIdentity`, `584`) and hands the row back, and the rail
   * calls it by that name; found in `712`'s review. So this arm asks the real host: the name in the
   * sentence is the row's, and it is NOT the slug.
   */
  describe('(d) a creation through the real door names the agent main named', () => {
    let userData: string
    let db: AppDatabase
    let host: RuntimeHost
    const LOCKED = 'the ledger is locked by another process'
    const rereadFailedSays = readableError(new Error(LOCKED))

    beforeEach(() => {
      userData = mkdtempSync(join(tmpdir(), 'brobot2-712-create-'))
      db = openDatabase(join(userData, 'brobot2.sqlite'))
      applyMigrations(db, migrationsFolder)
      host = new RuntimeHost({
        store: createSessionStore(db),
        discoverSessions: NO_DISCOVERY,
        nativeTranscriptPath: () => null,
        exportDirectory: () => join(userData, 'exports'),
        createRuntime: (provider: Provider) => new CatalogueOnly(provider),
        prepareProviderHome: (provider: Provider, profileId?: string) => {
          const home = join(userData, 'provider-homes', profileId ?? DEFAULT_PROFILE_ID, provider)
          mkdirSync(home, { recursive: true })
          return home
        },
        providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
        resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
        listProfiles: () => [DEFAULT_PROFILE_ID],
        newSessionId: () => `sess_${Math.random().toString(36).slice(2)}`,
        readProviderConfig: (_provider, home) => ({
          home,
          homeEnv: 'CLAUDE_CONFIG_DIR',
          model: 'm',
          authNote: null,
          files: [],
        }),
      })
    })

    afterEach(async () => {
      await host.closeAll()
      db.close()
      rmSync(userData, { recursive: true, force: true })
    })

    /** ⚑ The preload's own spellings over the real host; the roster's re-read fails after the first. */
    const storeOverTheHost = async (): Promise<AgentStore> => {
      const seat = new Seat('webContents:1')
      const run = async <T>(kind: string, input: Record<string, unknown> = {}): Promise<T> =>
        (await executeRuntimeCommand(host, seat, { kind, ...input } as Parameters<
          typeof executeRuntimeCommand
        >[2])) as T
      let reads = 0
      const bridge: Partial<RuntimeBridge> = {
        agentIdentities: () => {
          reads += 1
          return reads > 1 ? Promise.reject(new Error(LOCKED)) : run('agentIdentities')
        },
        createAgent: (input) => run('createAgent', { ...input }),
      }
      const store = createAgentStore(everythingOverTheWire(bridge) as RuntimeBridge)
      await store.load()
      expect(store.loadError.value).toBeNull()
      return store
    }

    it('🔴 a blank name box: the sentence says the name main gave it — never the slug', async () => {
      const said = await (
        await storeOverTheHost()
      ).create({ slug: 'scribe', displayName: null, provider: null })
      const row = host.agentIdentities().identities.find((one) => one.slug === 'scribe')
      // ⚑ The premise, read off the row: main named it, and the name is not the slug.
      expect(row?.displayName).toBeTruthy()
      expect(row?.displayName).not.toBe('scribe')
      expect(said).toBe(
        `${row?.displayName ?? '?'} was created, but this window could not re-read the list: ${rereadFailedSays}`,
      )
      expect(said).not.toMatch(/^scribe /)
    })

    it('⚑ THE CONTROL, one field over — a name typed in the box is the name main kept, and the sentence says it', async () => {
      const said = await (
        await storeOverTheHost()
      ).create({ slug: 'scribe', displayName: 'Quill', provider: null })
      expect(
        host.agentIdentities().identities.find((one) => one.slug === 'scribe')?.displayName,
      ).toBe('Quill')
      expect(said).toBe(
        `Quill was created, but this window could not re-read the list: ${rereadFailedSays}`,
      )
    })
  })
})

/**
 * ⚑ **`RuntimeScreen` is read, not mounted** (`211` §11) — so the one place the queue is projected
 * for the screen is asked of its source. ⛔ Comments stripped first: the line above the argument is a
 * comment that names it.
 */
const withoutComments = (source: string): string =>
  source
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')

describe('§7 · R41 at the screen — the queue is projected with the names the rail uses', () => {
  it('🔴 `RuntimeScreen` hands `attentionQueue` its name function — the roster’s `agentHeadingFor`, as its third argument', () => {
    const screen = withoutComments(
      readFileSync(join(here, '../src/renderer/src/components/RuntimeScreen.vue'), 'utf8'),
    )
    // ⚑ Each call's argument list, read by balancing brackets — the arguments hold arrows and calls.
    const calls = [...screen.matchAll(/\battentionQueue\(/g)].map((match) => {
      const args: string[] = []
      let depth = 0
      let current = ''
      for (const char of screen.slice((match.index ?? 0) + match[0].length)) {
        if (depth === 0 && char === ')') break
        if (char === '(' || char === '[' || char === '{') depth += 1
        if (char === ')' || char === ']' || char === '}') depth -= 1
        if (depth === 0 && char === ',') {
          args.push(current.replace(/\s+/g, ' ').trim())
          current = ''
        } else current += char
      }
      args.push(current.replace(/\s+/g, ' ').trim())
      return args
    })
    // ⚑ One projection for the screen (`099`: two components deriving it is how they disagreed).
    expect(calls).toHaveLength(1)
    const call = calls[0] ?? []
    expect(call.filter((argument) => argument !== '')).toHaveLength(3)
    expect(call[2]).toBe('agentHeadingFor')
    // ⚑ THE CONTROL — the name function is the one every agent heading on the screen is drawn with,
    // `agentName` over the roster, and not a function of its own.
    expect(screen).toMatch(
      /function agentHeadingFor\(profileSlug: string\): string \{\s*return agentName\(profileSlug, agentStore\.identities\.value\?\.identities \?\? null\)/,
    )
  })
})
