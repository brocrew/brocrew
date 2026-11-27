import { personOpener } from './helpers/person-opens-session'
import { waitFor } from './lib/f093-host'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { seedHistoricalSuccessor } from './lib/historical-replacement'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import type { AppDatabase } from '../src/main/db/connection'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { executeRuntimeCommand, runtimeCommandSchema } from '../src/main/runtime/ipc'
import { AN_AGENT_THIS_APP_CANNOT_NAME } from '../src/main/runtime/reply-rails'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { type FilesKept, type KeptFile, type RuntimeStatesMessage } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'
import {
  fixtureProviderConfig,
  RecordingSink,
  syntheticProviderHome,
  neutralHostDeps,
  fixtureDatabase,
  closeHostFixture,
  settleFixtureTurns,
} from './lib/host-fixture'

/**
 * # D-026 · a kept file is titled by its bytes, and one door lists the files a window draws
 *
 * D-026 gave a window one door to list the files this app keeps (`filesKept`: a conversation's
 * tree, one conversation, one piece), titled every file once as it is kept, and pushed each kept
 * file to every window on `runtime:states`. This file measures the listing and the push; the rule
 * that does the titling and the doors that write it are pinned in
 * `a-kept-file-is-titled-by-what-its-own-bytes-say.test.ts`.
 *
 *  - **§1 · the door a window lists by** — one forest of four conversations and seven files, read
 *    by piece (a label or an id), by tree and by conversation: the rows, their order (a tenth
 *    sibling after a second), a conversation standing in for a replaced one, the words for a scope
 *    that names nothing, a piece's title as it stands now, the rows an old build left, and the wire
 *    that carries the command.
 *  - **§2 · the push** — every kept file reaches every window on `runtime:states` as the row the
 *    door answers, once its row is down: a reply's, `update_work`'s and a give's, never a call that
 *    kept nothing, and never costing the states, nor one piece's files another's.
 *
 * ⚑ A rule of the file: **a negative is paired with a positive from the same reader**, every
 * presence asserted before an order or a text.
 *
 * ⚑ Every file is kept by ONE `update_work` call so each takes its own `tick` timestamp (resource
 * ids are random: a shared timestamp would tie-break at random).
 */
const shaOf = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex')

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The rig: a real host, a real ledger, the real toolsets, the Fake provider only
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A stretch of the event loop long enough for everything a provider row starts to have run: five
 * turns of `setImmediate` (each pump, and the flush a mark arms, run there) and a short timer.
 */
const settle = (): Promise<void> => settleFixtureTurns(2, 30)

type Answered = { structured: Record<string, unknown>; text: string }

/** One kept file as the tests know it: what was written, and the row the store gave it. */
interface Kept {
  readonly id: string
  readonly name: string
  readonly content: string
}

/** The forest every §1 test reads: who holds what, and the seven files kept on it. */
interface Forest {
  readonly carol: string
  readonly pm: string
  readonly aliKid: string
  readonly bobKid: string
  /** The PM's root label, read off the ledger — never hard-coded: every opened conversation takes a number. */
  readonly R: string
  /** Labels. */
  readonly label: { root: string; p1: string; p11: string; p2: string; p10: string }
  /** `work_…` ids. */
  readonly piece: { root: string; p1: string; p11: string; p2: string; p10: string }
  readonly file: {
    plan: Kept
    in1: Kept
    out1: Kept
    leaf: Kept
    out2: Kept
    out10: Kept
    carols: Kept
  }
}

describe('D-026 · one door lists the kept files, and every door that keeps one titles it', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let gate: ResumeGate
  /** Every message the host pushed on `runtime:states`, in order. */
  let pushed: RuntimeStatesMessage[]
  /** A fault the store the host reads through raises on a call, when a test arms one. */
  let fault: ((name: string, args: readonly unknown[]) => void) | null
  let pairs: number
  const tick = (): number => clock++

  /** The store the host is handed: the real one, every member passing through the armed fault. */
  const faultingStore = (real: SessionStore): SessionStore => {
    const wrapped: Record<string, unknown> = {}
    for (const [name, member] of Object.entries(real)) {
      if (typeof member !== 'function') {
        wrapped[name] = member
        continue
      }
      wrapped[name] = (...args: unknown[]): unknown => {
        fault?.(name, args)
        return Reflect.apply(member as (...given: unknown[]) => unknown, real, args)
      }
    }
    return wrapped as unknown as SessionStore
  }

  const buildHost = () =>
    new RuntimeHost({
      store: faultingStore(store),
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued, gate),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      resourcesRoot: () => resourcesRoot(userData),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
      statesMoved: (message) => {
        pushed.push(message)
      },
    })

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-d026-door-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-d026-door-root-'))
    db = fixtureDatabase(userData)
    clock = 9_260_000
    store = createSessionStore(db, tick)
    counter = 0
    pairs = 0
    handles = []
    pushed = []
    fault = null
    issued = new FakeProviderSessions()
    gate = anOpenGate()
    window = new RecordingSink('webContents:1')
    host = buildHost()
  })

  afterEach(() => closeHostFixture(host, db, userData, root))

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // The helpers
  // ───────────────────────────────────────────────────────────────────────────────────────────

  const events = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const personOpens = personOpener(() => ({ host, root, window }), 'auto')

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    await host.close(await personOpens(profileId), window)
  }

  const callFull = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Answered> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const result = await tool.call(args)
    return { structured: result.structured as Record<string, unknown>, text: result.text }
  }

  const callOn = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => (await callFull(caller, name, args)).structured

  const isIdle = (id: string): boolean => {
    const last = events(id)
      .filter((event) => event.type === 'status')
      .at(-1) as { state?: string } | undefined
    return last?.state === 'idle'
  }

  /** What the PROVIDER was handed: the Fake echoes each send as an assistant message. */
  const saidToProvider = (id: string): string[] =>
    events(id)
      .filter((event) => event.type === 'assistant_message')
      .map((event) => (event as { text: string }).text)
      .filter((text) => text.startsWith('echo: '))
      .map((text) => text.slice('echo: '.length))

  /**
   * A give, answered `ok`, and the conversation it reached — idle on its piece, unless `parks`: a
   * child of an `ask` giver parks its brief turn on a card, and is never idle.
   */
  const aGive = async (
    giver: string,
    profile: string,
    title: string,
    brief: string,
    extra: Record<string, unknown> = {},
    parks = false,
  ): Promise<{ agent: string; piece: string; label: string }> => {
    const answer = await callOn(giver, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title,
      brief,
      ...('to' in extra ? {} : { to: 'new', conversation_title: title }),
      ...extra,
    })
    expect(answer.outcome, JSON.stringify(answer)).toBe('ok')
    const agent = (answer.agent ?? answer.owner) as string
    if (!parks) {
      await waitFor(
        () => saidToProvider(agent).some((said) => said.includes(brief)),
        `${agent} to be handed its brief`,
      )
      await waitFor(() => isIdle(agent), `${agent} to go idle on its first piece`)
    }
    return { agent, piece: answer.piece as string, label: answer.label as string }
  }

  const wrote = (name: string, content: Buffer | string): string => {
    const path = join(root, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
    return path
  }

  /** One file kept by ONE `update_work` call, its own timestamp, answered `ok`. */
  const keeps = async (
    caller: string,
    piece: string,
    name: string,
    content: string,
    extra: Record<string, unknown> = {},
  ): Promise<Kept> => {
    const kept = await callOn(caller, 'update_work', {
      piece,
      resources: [wrote(name, content)],
      ...extra,
    })
    expect(kept.outcome, JSON.stringify(kept)).toBe('ok')
    const files = kept.resources as { resource: string; name: string }[]
    expect(files.map((one) => one.name)).toEqual([name])
    return { id: files[0]?.resource as string, name, content }
  }

  const rootOf = (conversation: string): { piece: string; label: string } => {
    const found = store.rootOf(conversation)
    if (found === null) throw new Error(`${conversation} owns no root`)
    return found
  }

  /** A conversation this app can name no profile for: found in the person's own provider home. */
  const aStranger = (id: string): string => {
    store.adopt({
      id,
      provider: 'claude',
      sessionId: `ext_${id}`,
      cwd: root,
      profileId: null,
      createdAt: 9_000_000,
      updatedAt: 9_000_000,
    })
    return id
  }

  /** The stored row of a kept file, or a failure: every `keptAt` below is read off the ledger. */
  const rowOf = (id: string): NonNullable<ReturnType<SessionStore['resource']>> => {
    const row = store.resource(id)
    if (row === null) throw new Error(`${id} is not in the store`)
    return row
  }

  /** The files of an answer that must be `ok`. */
  const filesOf = (answer: FilesKept): readonly KeptFile[] => {
    if (!answer.ok) throw new Error(`the door refused: ${answer.reason}`)
    return answer.files
  }

  const piecesFiles = (piece: string): readonly KeptFile[] =>
    filesOf(host.filesKept({ scope: 'piece', piece }))
  const treeOf = (conversation: string): readonly KeptFile[] =>
    filesOf(host.filesKept({ scope: 'tree', conversation }))
  const addedBy = (conversation: string): readonly KeptFile[] =>
    filesOf(host.filesKept({ scope: 'conversation', conversation }))
  const names = (rows: readonly KeptFile[]): string[] => rows.map((row) => row.name)
  const labels = (rows: readonly KeptFile[]): string[] => rows.map((row) => row.label)

  /** A person-opened conversation of `pm-N` that gave a piece to a fresh `worker-N`. */
  const aPair = async (
    inputs: string[] = [],
  ): Promise<{ pm: string; worker: string; piece: string; label: string }> => {
    const nth = ++pairs
    await bringIdentityIntoBeing(`worker-${String(nth)}`)
    const pm = await personOpens(`pm-${String(nth)}`)
    const given = await aGive(
      pm,
      `worker-${String(nth)}`,
      'the work',
      `do the work ${String(nth)}`,
      {
        ...(inputs.length === 0 ? {} : { inputs }),
      },
    )
    return { pm, worker: given.agent, piece: given.piece, label: given.label }
  }

  /** The kept rows pushed so far, flattened across every message. */
  const pushedFiles = (): KeptFile[] => pushed.flatMap((message) => [...message.kept])

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the door a window lists by
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the door a window lists by', () => {
    let f: Forest

    /**
     * ⚑ **The forest** — built per test, because some tests change it:
     *
     *  - **carol**, person-opened, first, with a root of her own;
     *  - **pm**, person-opened, root `R`; it gives `R.1` ("the index"), `R.2` and, after seven numbers
     *    are burned, `R.10` to one Ali (the second and third reach the conversation the first
     *    started); that Ali, `aliKid`, gives `R.1.1` ("the leaf") to a Bob (`bobKid`);
     *  - **seven files**, each by its own `update_work`, in this order: pm → R `plan.md` (made),
     *    pm → R.1 `in1.md` (an input), aliKid → R.1 `out1.md` (made), bobKid → R.1.1 `leaf.html`
     *    (a page), aliKid → R.2 `out2.md`, aliKid → R.10 `out10.md`, carol → her root `carols.md`.
     */
    const aForest = async (): Promise<Forest> => {
      const carol = await personOpens('carol')
      await bringIdentityIntoBeing('ali')
      await bringIdentityIntoBeing('bob')
      // ⚑ `ask`: a give is refused while the conversation it names still holds a piece of the giver's
      // whose turn ended, so the children park on a card instead — their pieces are never stalled.
      const pm = await personOpens('pm', 'ask')
      const pmRoot = rootOf(pm)
      const p1 = await aGive(pm, 'ali', 'the index', 'index it', {}, true)
      const aliKid = p1.agent
      const p2 = await aGive(
        pm,
        'ali',
        'the second piece',
        'plan the second piece',
        { to: p1.label },
        true,
      )
      // ⚠️ The second give reached the conversation the first started.
      expect(p2.agent).toBe(aliKid)
      for (let burned = 0; burned < 7; burned++) store.numberUnder(pmRoot.piece)
      const p10 = await aGive(
        pm,
        'ali',
        'the tenth',
        'plan the tenth piece',
        { to: p1.label },
        true,
      )
      const p11 = await aGive(aliKid, 'bob', 'the leaf', 'leaf it', { under: p1.label }, true)
      const bobKid = p11.agent
      expect([p1.label, p2.label, p10.label, p11.label]).toEqual([
        `${pmRoot.label}.1`,
        `${pmRoot.label}.2`,
        `${pmRoot.label}.10`,
        `${pmRoot.label}.1.1`,
      ])

      const plan = await keeps(pm, pmRoot.label, 'plan.md', '# The plan\nbody\n')
      const in1 = await keeps(pm, p1.label, 'in1.md', 'a table, no heading\n')
      const out1 = await keeps(aliKid, p1.label, 'out1.md', '# Findings\nbody\n')
      const leaf = await keeps(
        bobKid,
        p11.label,
        'leaf.html',
        '<title>The leaf &amp; more</title><p>x</p>',
      )
      const out2 = await keeps(aliKid, p2.label, 'out2.md', 'no heading\n')
      const out10 = await keeps(aliKid, p10.label, 'out10.md', '# Ten\n')
      const carols = await keeps(carol, rootOf(carol).label, 'carols.md', 'carol\n')
      return {
        carol,
        pm,
        aliKid,
        bobKid,
        R: pmRoot.label,
        label: {
          root: pmRoot.label,
          p1: p1.label,
          p11: p11.label,
          p2: p2.label,
          p10: p10.label,
        },
        piece: {
          root: pmRoot.piece,
          p1: p1.piece,
          p11: p11.piece,
          p2: p2.piece,
          p10: p10.piece,
        },
        file: { plan, in1, out1, leaf, out2, out10, carols },
      }
    }

    beforeEach(async () => {
      f = await aForest()
    })

    it('the door lists one piece’s files by its label or its id, one row each with every field a window draws', () => {
      const byLabel = piecesFiles(f.label.p1)
      const byId = piecesFiles(f.piece.p1)
      // ⚑ Presence first: exactly two rows, oldest first, and not R's or R.1.1's files.
      expect(names(byLabel)).toEqual(['in1.md', 'out1.md'])
      expect(byId).toEqual(byLabel)

      const [inRow, outRow] = byLabel
      expect(inRow).toEqual({
        group: 'brief',
        resourceId: f.file.in1.id,
        title: 'in1.md',
        name: 'in1.md',
        form: 'markdown',
        bytes: Buffer.byteLength(f.file.in1.content),
        role: 'input',
        keptAt: rowOf(f.file.in1.id).createdAt,
        sha256: shaOf(f.file.in1.content),
        addedBy: {
          conversation: f.pm,
          name: host.whatToCallTheConversation(f.pm),
          identity: 'pm',
        },
        piece: f.piece.p1,
        label: f.label.p1,
        pieceTitle: 'the index',
      })
      expect(outRow).toEqual({
        group: 'working',
        resourceId: f.file.out1.id,
        title: 'Findings',
        name: 'out1.md',
        form: 'markdown',
        bytes: Buffer.byteLength(f.file.out1.content),
        role: 'made',
        keptAt: rowOf(f.file.out1.id).createdAt,
        sha256: shaOf(f.file.out1.content),
        addedBy: {
          conversation: f.aliKid,
          name: host.whatToCallTheConversation(f.aliKid),
          identity: 'ali',
        },
        piece: f.piece.p1,
        label: f.label.p1,
        pieceTitle: 'the index',
      })

      // ⚑ The neighbours each answer only their own files: a page on R.1.1, a root nobody titled.
      const leafRows = piecesFiles(f.label.p11)
      expect(names(leafRows)).toEqual(['leaf.html'])
      expect(leafRows[0]).toMatchObject({
        form: 'page',
        title: 'The leaf & more',
        label: f.label.p11,
        pieceTitle: 'the leaf',
        role: 'made',
      })
      const rootRows = piecesFiles(f.label.root)
      expect(names(rootRows)).toEqual(['plan.md'])
      expect(rootRows[0]).toMatchObject({ title: 'The plan', label: f.R, pieceTitle: null })
    })

    it('the tree scope lists the pieces a conversation holds or gave and everything under them in label order, oldest first within a piece', () => {
      // ⚑ The full positive: six rows for the PM, two levels down reached (R.1.1 was given by
      // aliKid and not by pm), R before R.1 before R.1.1 before R.2, R.2 BEFORE R.10 — which a text
      // sort gets backwards — and in1.md before out1.md, being older.
      const pmTree = treeOf(f.pm)
      expect(names(pmTree)).toEqual([
        'plan.md',
        'in1.md',
        'out1.md',
        'leaf.html',
        'out2.md',
        'out10.md',
      ])
      expect(labels(pmTree)).toEqual([
        f.R,
        f.label.p1,
        f.label.p1,
        f.label.p11,
        f.label.p2,
        f.label.p10,
      ])

      // …and each other tree excludes what is not under it.
      expect(names(treeOf(f.aliKid))).toEqual([
        'in1.md',
        'out1.md',
        'leaf.html',
        'out2.md',
        'out10.md',
      ])
      expect(names(treeOf(f.aliKid))).not.toContain('plan.md')
      expect(names(treeOf(f.bobKid))).toEqual(['leaf.html'])
      expect(names(treeOf(f.carol))).toEqual(['carols.md'])
      for (const other of ['plan.md', 'in1.md', 'out1.md', 'leaf.html', 'out2.md', 'out10.md']) {
        expect(names(treeOf(f.carol)), `carol's tree`).not.toContain(other)
      }
    })

    it('the conversation scope is exactly what the conversation added, and nothing another added to the same piece', () => {
      const pmAdded = addedBy(f.pm)
      expect(names(pmAdded)).toEqual(['plan.md', 'in1.md'])
      expect(labels(pmAdded)).toEqual([f.R, f.label.p1])
      const aliAdded = addedBy(f.aliKid)
      expect(names(aliAdded)).toEqual(['out1.md', 'out2.md', 'out10.md'])
      expect(labels(aliAdded)).toEqual([f.label.p1, f.label.p2, f.label.p10])
      expect(names(addedBy(f.bobKid))).toEqual(['leaf.html'])
      // ⚑ R.1 holds two files from two adders, and each scope shows only its own.
      expect(names(piecesFiles(f.label.p1))).toEqual(['in1.md', 'out1.md'])
      for (const [conversation, rows] of [
        [f.pm, pmAdded],
        [f.aliKid, aliAdded],
        [f.bobKid, addedBy(f.bobKid)],
      ] as const) {
        for (const row of rows) expect(row.addedBy?.conversation).toBe(conversation)
      }
    })

    it('a conversation that took another’s place lists what the one it replaced gave in its tree, and none of it in its conversation scope', async () => {
      await host.closeAll()
      const next = seedHistoricalSuccessor(store, f.pm, `sess_${++counter}`, tick())
      host = buildHost()
      // ⚠️ The premise: a replacement stands in its place.
      expect(next).not.toBe(f.pm)

      // ⚑ The replacement's tree is what the replaced one GAVE and everything under it — and not
      // the replaced one's own root, and not carol's.
      const nextTree = treeOf(next)
      expect(names(nextTree)).toEqual(['in1.md', 'out1.md', 'leaf.html', 'out2.md', 'out10.md'])
      expect(names(nextTree)).not.toContain('plan.md')
      expect(names(nextTree)).not.toContain('carols.md')
      // …but a file is added by one conversation: the replacement added none.
      expect(host.filesKept({ scope: 'conversation', conversation: next })).toEqual({
        ok: true,
        files: [],
      })
      // ⚑ The paired positive: the old id's lists are as they were.
      expect(names(addedBy(f.pm))).toEqual(['plan.md', 'in1.md'])
      expect(names(treeOf(f.pm))).toEqual([
        'plan.md',
        'in1.md',
        'out1.md',
        'leaf.html',
        'out2.md',
        'out10.md',
      ])
    })

    it('a scope that names nothing answers its own word, and one that names something holding no files answers an empty list', async () => {
      // ⚑ The empty-but-real answers first: a person-opened conversation with no file, and a piece
      // with no file.
      const quiet = await personOpens('quiet')
      const fresh = await aGive(
        f.aliKid,
        'bob',
        'a fresh piece',
        'a fresh brief',
        { to: f.label.p11, under: f.label.p2 },
        true,
      )
      expect(host.filesKept({ scope: 'tree', conversation: quiet })).toEqual({
        ok: true,
        files: [],
      })
      expect(host.filesKept({ scope: 'conversation', conversation: quiet })).toEqual({
        ok: true,
        files: [],
      })
      expect(host.filesKept({ scope: 'piece', piece: fresh.label })).toEqual({
        ok: true,
        files: [],
      })
      expect(host.filesKept({ scope: 'piece', piece: fresh.piece })).toEqual({
        ok: true,
        files: [],
      })

      // …and a name nothing holds is a refusal in the words its neighbours use.
      for (const scope of ['tree', 'conversation'] as const) {
        expect(host.filesKept({ scope, conversation: 'sess_nobody' }), scope).toEqual({
          ok: false,
          reason: 'no-such-conversation',
        })
      }
      for (const piece of ['W999', 'work_nope']) {
        expect(host.filesKept({ scope: 'piece', piece }), piece).toEqual({
          ok: false,
          reason: 'no-piece-by-that-name',
        })
      }
    })

    it('a file’s piece is titled as it stands now: as given until it is renamed, and a root nobody titled has none', async () => {
      const rowsOn = (piece: string): KeptFile[] => [...piecesFiles(piece)]
      // ⚑ Before.
      expect(rowsOn(f.label.p1).map((row) => row.pieceTitle)).toEqual(['the index', 'the index'])
      expect(rowsOn(f.label.root).map((row) => row.pieceTitle)).toEqual([null])

      // ⚑ After the giver renames R.1: both its rows say it, and the leaf under it is its own.
      const renamed = await callOn(f.pm, 'update_work', {
        piece: f.label.p1,
        title: 'The index, renamed',
      })
      expect(renamed.outcome, JSON.stringify(renamed)).toBe('ok')
      expect(rowsOn(f.label.p1).map((row) => row.pieceTitle)).toEqual([
        'The index, renamed',
        'The index, renamed',
      ])
      expect(rowsOn(f.label.p11).map((row) => row.pieceTitle)).toEqual(['the leaf'])
      // …and `list_tasks {made}` says the same for the file the Ali made there.
      const made = (await callOn(f.aliKid, 'list_tasks', { made: true })).made as {
        resource: string
        piece_title: string
      }[]
      expect(made.find((one) => one.resource === f.file.out1.id)?.piece_title).toBe(
        'The index, renamed',
      )

      // ⚑ A root nobody titled takes the title a person-held conversation gives it.
      const titledRoot = await callOn(f.pm, 'update_work', {
        piece: f.label.root,
        title: 'Release plan',
      })
      expect(titledRoot.outcome, JSON.stringify(titledRoot)).toBe('ok')
      expect(rowsOn(f.label.root).map((row) => row.pieceTitle)).toEqual(['Release plan'])
      // ⚑ A sibling never renamed still says its title as given.
      expect(rowsOn(f.label.p2).map((row) => row.pieceTitle)).toEqual(['the second piece'])
    })

    it('a file kept before titles were taken reads as its name, a person’s file has no adder, and an unknown form is a file', () => {
      // An old row: no door can write a NULL title any more, so the test's own db does.
      db.prepare('UPDATE work_resource SET title = NULL WHERE id = ?').run(f.file.out1.id)
      const persons = store.addResource(
        {
          piece: f.piece.p2,
          role: 'made',
          title: 'x',
          summary: null,
          name: 'notes.txt',
          sha256: '0'.repeat(64),
          bytes: 3,
          addedBy: null,
        },
        clock++,
      )
      const stray = aStranger('sess_stray_adder')
      const strays = store.addResource(
        {
          piece: f.piece.p2,
          role: 'made',
          title: 'stray',
          summary: null,
          name: 'stray.md',
          sha256: '1'.repeat(64),
          bytes: 3,
          addedBy: stray,
        },
        clock++,
      )

      const rows = piecesFiles(f.label.p1)
      const old = rows.find((row) => row.resourceId === f.file.out1.id)
      expect(old?.title).toBe('out1.md')
      expect(old?.title).not.toBe('')

      const onP2 = piecesFiles(f.label.p2)
      const byId = (id: string): KeptFile | undefined => onP2.find((row) => row.resourceId === id)
      expect(byId(persons.resource)).toMatchObject({
        name: 'notes.txt',
        addedBy: null,
        form: 'file',
      })
      expect(byId(strays.resource)?.addedBy).toEqual({
        conversation: stray,
        name: AN_AGENT_THIS_APP_CANNOT_NAME,
        identity: null,
      })
      expect(byId(f.file.out2.id)).toMatchObject({
        title: 'out2.md',
        form: 'markdown',
        addedBy: { conversation: f.aliKid, identity: 'ali' },
      })
      expect(piecesFiles(f.label.p10)[0]).toMatchObject({ title: 'Ten', form: 'markdown' })
    })

    it('the window’s door is strict on every arm, answers any window, and hands its command to the host', async () => {
      const owner = window
      const stranger = new RecordingSink('webContents:2')
      const parses = (raw: unknown): boolean => runtimeCommandSchema.safeParse(raw).success

      // ⚑ The three valid shapes parse — a piece of exactly 200 characters included — so a schema
      // that refused everything is not what passed.
      const piece200 = 'W'.repeat(200)
      expect(parses({ kind: 'filesKept', scope: 'tree', conversation: 'c' })).toBe(true)
      expect(parses({ kind: 'filesKept', scope: 'conversation', conversation: 'c' })).toBe(true)
      expect(parses({ kind: 'filesKept', scope: 'piece', piece: 'W1' })).toBe(true)
      expect(parses({ kind: 'filesKept', scope: 'piece', piece: piece200 })).toBe(true)

      // ⛔ A stray key is a refusal that names it, on every arm.
      for (const raw of [
        { kind: 'filesKept', scope: 'tree', conversation: 'c', stray: 1 },
        { kind: 'filesKept', scope: 'conversation', conversation: 'c', stray: 1 },
        { kind: 'filesKept', scope: 'piece', piece: 'W1', stray: 1 },
      ]) {
        expect(parses(raw), JSON.stringify(raw)).toBe(false)
        await expect(executeRuntimeCommand(host, owner, raw)).rejects.toThrow(
          'Unrecognized key: "stray"',
        )
      }
      // ⛔ …and so is another scope's field, a missing field, an empty or too long one, and a scope
      // nobody declared.
      for (const raw of [
        { kind: 'filesKept', scope: 'piece', piece: 'W1', conversation: 'c' },
        { kind: 'filesKept', scope: 'tree' },
        { kind: 'filesKept', scope: 'piece', piece: '' },
        { kind: 'filesKept', scope: 'piece', piece: 'W'.repeat(201) },
        { kind: 'filesKept', scope: 'tree', conversation: '' },
        { kind: 'filesKept', scope: 'everything', conversation: 'c' },
      ]) {
        expect(parses(raw), JSON.stringify(raw)).toBe(false)
      }

      // ⚑ Answered, to the window that opened the conversation and to any other: the host's own
      // answer, with the two rows of R.1.
      const expected = host.filesKept({ scope: 'piece', piece: f.label.p1 })
      expect(expected.ok).toBe(true)
      expect(filesOf(expected)).toHaveLength(2)
      const command = { kind: 'filesKept', scope: 'piece', piece: f.label.p1 }
      expect(await executeRuntimeCommand(host, owner, command)).toEqual(expected)
      expect(await executeRuntimeCommand(host, stranger, command)).toEqual(expected)
      // …and a 200-character piece is answered with the word for a name nothing holds.
      expect(
        await executeRuntimeCommand(host, owner, {
          kind: 'filesKept',
          scope: 'piece',
          piece: piece200,
        }),
      ).toEqual({ ok: false, reason: 'no-piece-by-that-name' })
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the push
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the push', () => {
    it('a reply’s files are pushed to every window once the reply is down, as the rows the door answers', async () => {
      const { worker, piece } = await aPair()
      await settle()
      pushed.length = 0

      const replied = await callOn(worker, 'reply_to_parent', {
        piece,
        outcome: 'done',
        summary: 'the findings',
        resource_paths: [wrote('findings.md', '# Findings\nbody\n')],
      })
      expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
      const id = (replied.resources as string[])[0] as string
      await waitFor(() => pushedFiles().length > 0, 'the reply’s file to be pushed')
      await settle()

      // ⚑ Exactly one pushed row for the file across every message, and it IS the door's row.
      const sent = pushedFiles().filter((row) => row.resourceId === id)
      expect(sent).toHaveLength(1)
      expect(pushedFiles()).toHaveLength(1)
      const door = piecesFiles(piece).find((row) => row.resourceId === id)
      expect(door).toBeDefined()
      expect(sent[0]).toEqual(door)
      expect(sent[0]).toMatchObject({
        title: 'Findings',
        role: 'made',
        addedBy: { conversation: worker },
        piece,
      })
      // ⚑ Every message carries both halves, and none is empty.
      for (const message of pushed) {
        expect(Array.isArray(message.moved) && Array.isArray(message.kept)).toBe(true)
        expect(message.moved.length + message.kept.length).toBeGreaterThan(0)
      }
    })

    it('update_work’s files are pushed with only that call’s files, even when no state moved', async () => {
      const ali = await personOpens('ali')
      const label = rootOf(ali).label
      await settle()
      pushed.length = 0

      // ⚑ The first keep proves the harness hears a push at all.
      const a = await keeps(ali, label, 'a.md', '# A\n')
      await waitFor(() => pushedFiles().length > 0, 'the first keep to be pushed')
      await settle()
      expect(pushedFiles().map((row) => row.resourceId)).toEqual([a.id])
      pushed.length = 0

      const b = await keeps(ali, label, 'b.md', '# B\n')
      await waitFor(() => pushedFiles().length > 0, 'the second keep to be pushed')
      await settle()
      // ⚑ Only b.md: a.md, already on that piece, is not sent again — and it IS the door's row.
      const sent = pushedFiles()
      expect(sent.map((row) => row.resourceId)).toEqual([b.id])
      const door = piecesFiles(rootOf(ali).piece).find((row) => row.resourceId === b.id)
      expect(sent[0]).toEqual(door)
      expect(piecesFiles(rootOf(ali).piece)).toHaveLength(2)
      // ⚠️ No state moved — an idle conversation kept a file — and the message that carries the
      // file alone is delivered: one message, no state in it.
      expect(pushed).toHaveLength(1)
      expect(pushed[0]?.moved).toEqual([])
    })

    it('a give’s inputs are pushed with the piece they were handed over on', async () => {
      await bringIdentityIntoBeing('ali')
      await bringIdentityIntoBeing('bob')
      const pm = await personOpens('pm')
      await settle()
      pushed.length = 0

      // ⚑ The paired absence first: a give with NO inputs pushes states and no file.
      const bare = await aGive(pm, 'bob', 'a bare give', 'nothing handed over')
      await settle()
      expect(pushed.length, 'the give was heard').toBeGreaterThan(0)
      expect(pushedFiles()).toEqual([])
      expect(piecesFiles(bare.piece)).toEqual([])
      pushed.length = 0

      const given = await aGive(pm, 'ali', 'the index', 'index it', {
        inputs: [wrote('brief.md', '# The brief\n')],
      })
      await waitFor(() => pushedFiles().length > 0, 'the give’s input to be pushed')
      await settle()
      const sent = pushedFiles()
      expect(sent).toHaveLength(1)
      expect(sent[0]).toMatchObject({
        role: 'input',
        title: 'The brief',
        label: given.label,
        piece: given.piece,
        addedBy: { conversation: pm },
      })
      expect(sent[0]).toEqual(piecesFiles(given.piece)[0])
    })

    it('a call that keeps no file, and a call refused before it keeps one, push no file', async () => {
      const ali = await personOpens('ali')
      const label = rootOf(ali).label
      const piece = rootOf(ali).piece
      await settle()
      pushed.length = 0

      // ⚑ A title and a status line keep nothing: states may move, no file is pushed.
      const named = await callOn(ali, 'update_work', { piece: label, title: 'A title' })
      expect(named.outcome, JSON.stringify(named)).toBe('ok')
      const said = await callOn(ali, 'update_work', { piece: label, status: 'a status line' })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      // ⚑ A path that does not exist is refused, and keeps nothing.
      const missing = join(root, 'not-yet.md')
      const refused = await callOn(ali, 'update_work', { piece: label, resources: [missing] })
      expect(refused.outcome, JSON.stringify(refused)).not.toBe('ok')
      await settle()
      expect(pushedFiles()).toEqual([])
      expect(store.resourcesOf(piece)).toEqual([])

      // ⚑ The paired positives: an ordinary keep pushes its file, and the refused path, once it
      // exists, pushes too.
      const ordinary = await keeps(ali, label, 'ordinary.md', '# Ordinary\n')
      await waitFor(() => pushedFiles().length > 0, 'the ordinary keep to be pushed')
      await settle()
      expect(pushedFiles().map((row) => row.resourceId)).toEqual([ordinary.id])
      pushed.length = 0
      writeFileSync(missing, '# Not yet\n')
      const landed = await callOn(ali, 'update_work', { piece: label, resources: [missing] })
      expect(landed.outcome, JSON.stringify(landed)).toBe('ok')
      await waitFor(() => pushedFiles().length > 0, 'the once-refused path to be pushed')
      await settle()
      expect(pushedFiles().map((row) => row.name)).toEqual(['not-yet.md'])
    })

    it('a state that cannot be read never costs the files, nor one piece’s files another’s', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        // (a) A reply writes the replier's row — which marks its state — and keeps its files in one
        // synchronous stretch, so both are asked of ONE flush. The shared card reads throw once.
        const first = await aPair()
        await settle()
        pushed.length = 0
        warn.mockClear()
        let faults = 0
        fault = (name) => {
          if (name === 'instructionAsksWaiting' && faults === 0) {
            faults += 1
            throw new Error('planted')
          }
        }
        const replied = await callOn(first.worker, 'reply_to_parent', {
          piece: first.piece,
          outcome: 'done',
          summary: 'the findings',
          resource_paths: [wrote('first.md', '# First\n')],
        })
        expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
        const firstId = (replied.resources as string[])[0] as string
        await waitFor(
          () => pushedFiles().some((row) => row.resourceId === firstId),
          'the reply’s file to be pushed',
        )
        await settle()
        // ⚑ The fault fired, so the pass is not vacuous; the failure names what could not be said.
        expect(faults).toBe(1)
        expect(
          warn.mock.calls.some(([line]) =>
            String(line).includes('could not say what its agents are doing'),
          ),
        ).toBe(true)
        // ⚑ …and the file was still pushed, once, in a message that says no state.
        expect(pushedFiles().filter((row) => row.resourceId === firstId)).toHaveLength(1)
        const carrying = pushed.filter((message) => message.kept.length > 0)
        expect(carrying.every((message) => message.moved.length === 0)).toBe(true)
        fault = null

        // (b) Two owners keep one file each on two pieces in ONE tick. The unfaulted control
        // first: both files arrive.
        const second = await aPair()
        const pmRoot = rootOf(second.pm)
        await settle()
        pushed.length = 0
        const control = await Promise.all([
          keeps(second.pm, pmRoot.label, 'ctl-a.md', '# Control A\n'),
          keeps(second.worker, second.label, 'ctl-b.md', '# Control B\n'),
        ])
        await waitFor(() => pushedFiles().length >= 2, 'both control files to be pushed')
        await settle()
        expect(
          pushedFiles()
            .map((row) => row.resourceId)
            .sort(),
        ).toEqual(control.map((one) => one.id).sort())

        // The fault run: reading piece A's files throws, and B's still arrive.
        pushed.length = 0
        warn.mockClear()
        let reads = 0
        fault = (name, args) => {
          const asked = args[0] as { scope?: string; piece?: string } | undefined
          if (name === 'filesKept' && asked?.scope === 'piece' && asked.piece === pmRoot.piece) {
            reads += 1
            throw new Error('planted')
          }
        }
        const [onA, onB] = await Promise.all([
          keeps(second.pm, pmRoot.label, 'on-a.md', '# On A\n'),
          keeps(second.worker, second.label, 'on-b.md', '# On B\n'),
        ])
        await waitFor(
          () => pushedFiles().some((row) => row.resourceId === onB.id),
          'B’s file to be pushed',
        )
        await settle()
        expect(reads, 'the fault fired').toBeGreaterThan(0)
        expect(pushedFiles().filter((row) => row.resourceId === onB.id)).toHaveLength(1)
        expect(pushedFiles().some((row) => row.resourceId === onA.id)).toBe(false)
        expect(
          warn.mock.calls.some(([line]) =>
            String(line).includes(`could not say which files were kept on ${pmRoot.piece}`),
          ),
        ).toBe(true)
        // Cleared, the door finds A's file: nothing was lost, only not pushed.
        fault = null
        expect(piecesFiles(pmRoot.piece).some((row) => row.resourceId === onA.id)).toBe(true)
      } finally {
        warn.mockRestore()
      }
    })
  })
})
