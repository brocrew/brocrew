import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { clockTime } from '../src/shared/clock'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'

/**
 * # D-024 · R2 and R3 — a profile reads across its own conversations
 *
 * One profile can hold several conversations at once (two Alis, one under a person and one under
 * the PM). Since D-024 they know of each other at launch, and this file pins what each one may
 * then READ of the others, over a real `RuntimeHost`, a real ledger and the real toolsets, on the
 * Fake provider only:
 *
 *  - **§1 · `read_transcript`** reaches the caller's own profile's other conversations, by an id or
 *    by the label of a piece one of them owns — and not another profile's, a stranger's, or its own;
 *    every refusal keeps the one answer, whose last clause now says the reach it has.
 *  - **§2 · `list_tasks` naming a piece** reads the record of a piece another conversation of the
 *    profile HOLDS (the owner half) or GAVE (the giver half), and says whose a root is.
 *  - **§3 · `list_tasks` with `made`** lists the files the profile's conversations MADE — scoped by
 *    the piece's OWNER, by the role `made` and by nothing else, newest first, each with the piece it
 *    was kept on — and each listed id reads with `read_document`.
 *  - **§4 · the bound** — the newest ten, the rest counted and said, and the older ones still on
 *    their own piece's record.
 *  - **§5 · the shapes refused** — `made` beside a piece, `made` that is not a boolean, `made:
 *    false` as the board, and a conversation this app can name no profile for.
 *
 * ⚑ Two rules of the file: **the bounds are literals** (10, 11, 12), so a changed constant is read
 * as a change and not followed; and **a negative is paired with a positive from the same reader**,
 * every presence asserted before an order or a text. Every file is kept by ONE `update_work` call so
 * each resource takes its own `tick` timestamp (resource ids are random: a shared timestamp would
 * tie-break at random).
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

const shaOf = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex')

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

/** The last clause of `read_transcript`'s one refusal, as a model reads it since D-024. */
const THE_REACH_IT_NOW_SAYS = 'your profile’s other conversations are read here'

type Answered = { structured: Record<string, unknown>; text: string }

describe('D-024 · a profile reads across its own conversations', () => {
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
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-d024-reads-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-d024-reads-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_160_000
    store = createSessionStore(db, tick)
    counter = 0
    handles = []
    issued = new FakeProviderSessions()
    gate = anOpenGate()
    window = new RecordingSink('webContents:1')
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued, gate),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      resourcesRoot: () => resourcesRoot(userData),
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
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // The rig
  // ───────────────────────────────────────────────────────────────────────────────────────────

  const events = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /**
   * A conversation a person opened. ⚑ Every one is opened `auto`, so a given child's brief turn ends
   * instead of parking on a card, and a conversation is idle when the test reads it.
   */
  const personOpens = async (
    profileId: string,
    approvalMode: 'ask' | 'auto' = 'auto',
  ): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode, cwd: root },
      window,
    )
    return sessionId
  }

  /** An identity a give can name: opened by a person, then closed. */
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

  /** A person says something to a conversation, and the provider has been handed it. */
  const aPersonSays = async (id: string, words: string): Promise<void> => {
    await host.send(id, words, window)
    await waitFor(
      () => saidToProvider(id).some((said) => said.includes(words)),
      `the provider to be handed ${JSON.stringify(words)}`,
    )
    await waitFor(() => isIdle(id), `${id} to go idle`)
  }

  /** A give, answered `ok`, and the child it started idle. */
  const aGive = async (
    giver: string,
    profile: string,
    title: string,
    brief: string,
  ): Promise<{ agent: string; piece: string; label: string }> => {
    const answer = await callOn(giver, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title,
      brief,
    })
    expect(answer.outcome, JSON.stringify(answer)).toBe('ok')
    const agent = answer.agent as string
    // ⚑ The brief reached the provider AND the turn ended: an `idle` the Fake publishes when the
    // conversation starts is not the end of the first turn.
    await waitFor(
      () => saidToProvider(agent).some((said) => said.includes(brief)),
      `${agent} to be handed its brief`,
    )
    await waitFor(() => isIdle(agent), `${agent} to go idle on its first piece`)
    return { agent, piece: answer.piece as string, label: answer.label as string }
  }

  const rootLabelOf = (conversation: string): string => {
    const found = store.rootOf(conversation)
    if (found === null) throw new Error(`${conversation} owns no root`)
    return found.label
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
  ): Promise<string> => {
    const kept = await callOn(caller, 'update_work', {
      piece,
      resources: [wrote(name, content)],
      ...extra,
    })
    expect(kept.outcome, JSON.stringify(kept)).toBe('ok')
    const files = kept.resources as { resource: string; name: string }[]
    expect(files.map((one) => one.name)).toEqual([name])
    return files[0]?.resource as string
  }

  /** What a refusal says as a model reads it: its structure beside its words, nothing else. */
  const reasonOf = (answer: Record<string, unknown>): string => String(answer.reason)

  const withoutTheEchoedSpelling = (refusal: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(refusal).filter(([key]) => key !== 'detail'))

  const namesOf = (made: unknown): string[] => (made as { name: string }[]).map((one) => one.name)

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · read_transcript
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('a conversation reads another conversation of its own profile — by its id, or by the label of a piece it owns — and not another profile’s, a stranger’s, or its own', async () => {
    const ali1 = await personOpens('ali')
    const ali2 = await personOpens('ali')
    const bob = await personOpens('bob')
    const pm = await personOpens('pm')
    await aPersonSays(ali1, 'draft the release note')
    await aPersonSays(ali2, 'check the invoices')
    await aPersonSays(bob, 'plan the offsite')
    // ⚑ The third Ali is a CHILD of the PM: it holds a piece the PM gave it.
    const given = await aGive(pm, 'ali', 'the index', 'index it')
    const ali3 = given.agent
    const strayA = aStranger('sess_stray_a')
    const strayB = aStranger('sess_stray_b')

    // ⚠️ The premise, read off the ledger: Ali's three conversations are of one identity, and no
    // spawn chain links the two a person opened.
    expect([ali1, ali2, ali3].map((one) => store.identityOf(one)?.profileSlug)).toEqual([
      'ali',
      'ali',
      'ali',
    ])
    expect(store.ancestorsOf(ali1)).toEqual([])
    expect(store.ancestorsOf(ali2)).toEqual([])
    expect(store.ancestorsOf(ali3)).toEqual([pm])
    expect(store.identityOf(strayA)).toBeNull()
    expect(store.identityOf(strayB)).toBeNull()

    // (a) ⚑ By id: ali2 reads ali1, in full, and nothing of its own words leaks in.
    const byId = await callFull(ali2, 'read_transcript', { agent: ali1 })
    expect(byId.structured, byId.text).toMatchObject({
      outcome: 'ok',
      agent: ali1,
      name: host.whatToCallTheConversation(ali1),
    })
    expect(byId.text).toContain('draft the release note')
    expect(byId.text).not.toContain('check the invoices')

    // (b) ⚑ By the label of the piece the conversation owns: ali1's ROOT, and the PM's piece owned
    // by ali3 — each reads as the same conversation read by its id.
    const byRootLabel = await callFull(ali2, 'read_transcript', { agent: rootLabelOf(ali1) })
    expect(byRootLabel.structured, byRootLabel.text).toEqual(byId.structured)
    expect(byRootLabel.text).toBe(byId.text)
    const byGivenLabel = await callFull(ali2, 'read_transcript', { agent: given.label })
    expect(byGivenLabel.structured, byGivenLabel.text).toMatchObject({ outcome: 'ok', agent: ali3 })

    // (c) ⚑ Symmetry: ali1 reads ali2, and its words are ali2's.
    const symmetric = await callFull(ali1, 'read_transcript', { agent: ali2 })
    expect(symmetric.structured, symmetric.text).toMatchObject({ outcome: 'ok', agent: ali2 })
    expect(symmetric.text).toContain('check the invoices')
    expect(symmetric.text).not.toContain('draft the release note')

    // ⚑ The chain arm survives the widening: the PM still reads the child it gave work to.
    const chain = await callFull(pm, 'read_transcript', { agent: ali3 })
    expect(chain.structured, chain.text).toMatchObject({ outcome: 'ok', agent: ali3 })

    // (d) ⛔ The same call, from the same reader, on what is NOT its profile's — each the one answer.
    const refusals: { what: string; answered: Answered }[] = [
      {
        what: 'another profile’s id',
        answered: await callFull(ali2, 'read_transcript', { agent: bob }),
      },
      {
        what: 'another profile’s root label',
        answered: await callFull(ali2, 'read_transcript', { agent: rootLabelOf(bob) }),
      },
      {
        what: 'its own id',
        answered: await callFull(ali2, 'read_transcript', { agent: ali2 }),
      },
      {
        what: 'two conversations with no identity',
        answered: await callFull(strayA, 'read_transcript', { agent: strayB }),
      },
      {
        what: 'a stranger reading an identity’s conversation',
        answered: await callFull(strayA, 'read_transcript', { agent: ali1 }),
      },
    ]
    for (const { what, answered } of refusals) {
      expect(answered.structured, what).toMatchObject({
        outcome: 'refused',
        rail: 'not-a-conversation-below-you',
        permanence: 'permanent',
      })
      // (e) ⚑ …and each says the reach it now has, whoever asked.
      expect(reasonOf(answered.structured), what).toContain(THE_REACH_IT_NOW_SAYS)
    }

    // ⚑ Opacity, for a caller that may message anybody: Bob's root label is read as a label no piece
    // carries, and as an id that names nothing, in the same words. (Its `detail` echoes the spelling
    // the door resolved, which a caller that may message could name anyway: the narrowed arm below
    // is where the echo is measured.)
    const unknownLabel = await callFull(ali2, 'read_transcript', { agent: 'W999' })
    const unknownId = await callFull(ali2, 'read_transcript', { agent: 'sess_nobody' })
    const bobsLabel = refusals[1]?.answered as Answered
    for (const same of [unknownLabel, unknownId]) {
      expect(same.structured).toMatchObject({
        outcome: 'refused',
        rail: 'not-a-conversation-below-you',
      })
      expect(withoutTheEchoedSpelling(bobsLabel.structured)).toEqual(
        withoutTheEchoedSpelling(same.structured),
      )
      expect(bobsLabel.text).toBe(same.text)
    }
    expect(bobsLabel.text).not.toContain(bob)
    expect(bobsLabel.text).not.toContain(host.whatToCallTheConversation(bob))

    // ⚑ And for a caller that may NOT message — Ali's grant narrowed to `none` — a label opens no
    // door of its own: Ali's sibling is still read by its label and by its id (the profile reach, not
    // the messaging reach), and Bob's label is a label no piece carries, down to the echo.
    expect(store.setCapabilities('ali', { canMessage: 'none' })).toBe(true)
    const premise = await callOn(ali2, 'get_agent_status', { agent: bob })
    expect(premise.rail, JSON.stringify(premise)).toBe('may-not-message')
    for (const agent of [ali1, rootLabelOf(ali1)]) {
      const read = await callFull(ali2, 'read_transcript', { agent })
      expect(read.structured, read.text).toMatchObject({ outcome: 'ok', agent: ali1 })
      expect(read.text).toContain('draft the release note')
    }
    const narrowed = await callFull(ali2, 'read_transcript', { agent: rootLabelOf(bob) })
    const narrowedUnknown = await callFull(ali2, 'read_transcript', { agent: 'W999' })
    expect(narrowed.structured, narrowed.text).toMatchObject({
      outcome: 'refused',
      rail: 'not-a-conversation-below-you',
      detail: { agent: rootLabelOf(bob) },
    })
    expect(withoutTheEchoedSpelling(narrowed.structured)).toEqual(
      withoutTheEchoedSpelling(narrowedUnknown.structured),
    )
    expect(narrowed.text).toBe(narrowedUnknown.text)
    for (const said of [JSON.stringify(narrowed.structured), narrowed.text]) {
      expect(said).not.toContain(bob)
      expect(said).not.toContain(host.whatToCallTheConversation(bob))
    }
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · list_tasks naming a piece
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('a conversation reads the record of a piece its profile’s other conversation holds or gave, and a root says whose work it is', async () => {
    const ali1 = await personOpens('ali')
    const ali2 = await personOpens('ali')
    const carol = await personOpens('carol')
    await bringIdentityIntoBeing('bob')
    const pm = await personOpens('pm')
    // ⚑ P1: owned by ali3, given by the PM — ali2 passes ONLY through the owner half.
    const p1 = await aGive(pm, 'ali', 'the index', 'index it')
    const ali3 = p1.agent
    // ⚑ P2: owned by a Bob conversation, given by ali1 — ali2 passes ONLY through the giver half.
    const p2 = await aGive(ali1, 'bob', 'the offsite', 'plan it')
    const bobKid = p2.agent
    expect(store.identityOf(bobKid)?.profileSlug).toBe('bob')
    const aliRoot = rootLabelOf(ali1)

    const recordOf = (caller: string, piece: string): Promise<Answered> =>
      callFull(caller, 'list_tasks', { piece })

    /**
     * ⚠️ A piece's record carries the PIECE's own `outcome` (null while it is open), so `outcome:
     * 'ok'` is a root's word and not a piece's: a piece's record is read as the piece and its brief,
     * and as not refused.
     */
    const aRecordOf = (
      answered: Answered,
      piece: { piece: string; label: string },
      brief: string,
    ) => {
      const said = JSON.stringify(answered.structured)
      expect(answered.structured, said).not.toHaveProperty('rail')
      expect(answered.structured.outcome, said).not.toBe('refused')
      expect(answered.structured, said).toMatchObject({
        piece: piece.piece,
        label: piece.label,
        brief,
      })
      expect(answered.text).toContain(piece.label)
    }

    // ⚑ The owner half: by label and by id, the same record.
    const p1ByLabel = await recordOf(ali2, p1.label)
    aRecordOf(p1ByLabel, p1, 'index it')
    expect(p1ByLabel.structured).toMatchObject({ title: 'the index', owner: ali3 })
    const p1ById = await recordOf(ali2, p1.piece)
    expect(p1ById.structured, p1ById.text).toEqual(p1ByLabel.structured)
    expect(p1ByLabel.text).toContain('the index')

    // ⚑ The giver half.
    const p2ByLabel = await recordOf(ali2, p2.label)
    aRecordOf(p2ByLabel, p2, 'plan it')
    expect(p2ByLabel.structured).toMatchObject({ title: 'the offsite', owner: bobKid })
    expect(p2ByLabel.text).toContain('the offsite')

    // ⚑ The paired positives, from the entitled readers themselves.
    for (const [caller, piece, brief] of [
      [pm, p1, 'index it'],
      [bobKid, p2, 'plan it'],
      [ali1, p2, 'plan it'],
    ] as const) {
      aRecordOf(await recordOf(caller, piece.label), piece, brief)
    }

    // ⚑ A root says whose work it is, to the reader: another Ali's, or its own.
    const sibling = await recordOf(ali2, aliRoot)
    expect(sibling.structured, sibling.text).toMatchObject({
      outcome: 'ok',
      root: true,
      owner: ali1,
      label: aliRoot,
    })
    expect(sibling.text).toContain('work a person gave another conversation of your profile')
    expect(sibling.text).not.toContain('your own work, from a person')
    for (const caller of [ali1, ali2]) {
      const own = await recordOf(caller, rootLabelOf(caller))
      expect(own.structured, own.text).toMatchObject({ outcome: 'ok', root: true, owner: caller })
      expect(own.text).toContain('your own work, from a person')
      expect(own.text).not.toContain('work a person gave another conversation of your profile')
    }

    // ⛔ The same calls from readers of ANOTHER profile: one answer, the one a label no piece carries
    // gets, and none of the piece's words in it. ⚑ Each of those readers reads its OWN root, so the
    // refusal below is the profile and not the reader.
    const carolsOwn = await recordOf(carol, rootLabelOf(carol))
    expect(carolsOwn.structured, carolsOwn.text).toMatchObject({
      outcome: 'ok',
      root: true,
      owner: carol,
    })
    const unknown = await recordOf(ali2, 'W999')
    expect(unknown.structured).toMatchObject({ outcome: 'refused', rail: 'no-piece-by-that-name' })
    for (const [caller, piece] of [
      [carol, p1.label],
      [carol, p2.label],
      [carol, aliRoot],
      [bobKid, p1.label],
    ] as const) {
      const refused = await recordOf(caller, piece)
      expect(refused.structured, `${caller} on ${piece}`).toMatchObject({
        outcome: 'refused',
        rail: 'no-piece-by-that-name',
      })
      expect(withoutTheEchoedSpelling(refused.structured)).toEqual(
        withoutTheEchoedSpelling(unknown.structured),
      )
      expect(refused.text).toBe(unknown.text)
      for (const said of [JSON.stringify(refused.structured), refused.text]) {
        expect(said).not.toContain('the index')
        expect(said).not.toContain('index it')
        expect(said).not.toContain('the offsite')
        expect(said).not.toContain('plan it')
      }
    }
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · list_tasks with made
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('list_tasks with made lists the files its profile’s conversations made — only those, newest first, each with the piece it was kept on — and each can be read', async () => {
    const ali1 = await personOpens('ali')
    const ali2 = await personOpens('ali')
    const carol = await personOpens('carol')
    const dave = await personOpens('dave')
    await bringIdentityIntoBeing('bob')
    const pm = await personOpens('pm')
    const p1 = await aGive(pm, 'ali', 'the index', 'index it')
    const ali3 = p1.agent
    const p2 = await aGive(ali1, 'bob', 'the offsite', 'plan it')
    const bobKid = p2.agent
    const aliRoot = store.rootOf(ali1)
    if (aliRoot === null) throw new Error('ali1 owns no root')

    // ⚑ Kept in THIS order, one call each, so each takes its own `tick`: a made file on a root, an
    // INPUT the giver handed a piece an Ali owns, a made file on that piece, a made file on a piece
    // an Ali GAVE (owned elsewhere), and another profile's file on its own root.
    const rootMd = await keeps(ali1, aliRoot.label, 'root.md', 'release notes\n', {
      title: 'Release notes',
    })
    const inMd = await keeps(pm, p1.label, 'in.md', 'the giver’s table\n')
    const outMd = await keeps(ali3, p1.label, 'out.md', 'the owner’s table\n')
    const bobsMd = await keeps(bobKid, p2.label, 'bobs.md', 'bob’s notes\n')
    const carolsMd = await keeps(carol, rootLabelOf(carol), 'carols.md', 'carol’s notes\n')

    // ⚠️ The premise, off the ledger: the roles are what the fixture says they are.
    expect(store.resource(inMd)?.role).toBe('input')
    for (const made of [rootMd, outMd, bobsMd, carolsMd]) {
      expect(store.resource(made)?.role).toBe('made')
    }
    const outKept = store.resource(outMd)
    const rootKept = store.resource(rootMd)
    if (outKept === null || rootKept === null) throw new Error('a kept file is not in the store')

    // ali2 made nothing, and lists what its profile made.
    const listed = await callFull(ali2, 'list_tasks', { made: true })
    expect(listed.structured, listed.text).toMatchObject({ outcome: 'ok', more: 0 })
    expect(namesOf(listed.structured.made)).toEqual(['out.md', 'root.md'])
    expect((listed.structured.made as unknown[])[0]).toEqual({
      resource: outMd,
      name: 'out.md',
      // ⚑ D-026 titles every file as it is kept: with no `# ` heading, the title is its name.
      title: 'out.md',
      piece: p1.piece,
      label: p1.label,
      piece_title: 'the index',
      kept_at: outKept.createdAt,
    })
    expect((listed.structured.made as unknown[])[1]).toEqual({
      resource: rootMd,
      name: 'root.md',
      title: 'root.md',
      piece: aliRoot.piece,
      label: aliRoot.label,
      piece_title: 'Release notes',
      kept_at: rootKept.createdAt,
    })
    // ⚑ The words: the lead, the line a model reads, the door that reads one, and no older ones.
    expect(listed.text.startsWith('files your profile made, newest first:')).toBe(true)
    expect(listed.text).toContain(
      `${outMd} (out.md) — on ${p1.label} · the index, ${clockTime(outKept.createdAt)}`,
    )
    expect(listed.text).toContain(`${rootMd} (root.md)`)
    expect(listed.text.trimEnd().endsWith('Read one with read_document.')).toBe(true)
    expect(listed.text).not.toContain('older')
    // ⛔ …and what is not the profile's made files appears in neither the structure nor the words.
    for (const [what, id, name] of [
      ['an input', inMd, 'in.md'],
      ['a file made on a piece the profile gave', bobsMd, 'bobs.md'],
      ['another profile’s file', carolsMd, 'carols.md'],
    ] as const) {
      for (const said of [JSON.stringify(listed.structured), listed.text]) {
        expect(said, what).not.toContain(id)
        expect(said, what).not.toContain(name)
      }
    }

    // ⚑ Each listed id is read by ali2 with read_document, whole and as what it is.
    for (const [id, content] of [
      [outMd, 'the owner’s table\n'],
      [rootMd, 'release notes\n'],
    ] as const) {
      const read = await callFull(ali2, 'read_document', { resource: id })
      expect(read.structured, read.text).toMatchObject({
        outcome: 'ok',
        resource: id,
        role: 'made',
        sha256: shaOf(content),
      })
      expect(read.text).toContain(content.trim())
    }

    // ⚑ The paired positive: the list is the PROFILE's, not the caller's — the makers list the same
    // two files in the same order as the conversation that made none.
    for (const maker of [ali1, ali3]) {
      const theirs = await callFull(maker, 'list_tasks', { made: true })
      expect(namesOf(theirs.structured.made), maker).toEqual(['out.md', 'root.md'])
      expect(theirs.structured.more).toBe(0)
    }
    // …and the scope cuts both ways: another profile lists its own files and not these.
    const carols = await callFull(carol, 'list_tasks', { made: true })
    expect(namesOf(carols.structured.made)).toEqual(['carols.md'])
    expect(carols.text).not.toContain('out.md')
    const bobs = await callFull(bobKid, 'list_tasks', { made: true })
    expect(namesOf(bobs.structured.made)).toEqual(['bobs.md'])
    expect(bobs.text).not.toContain('root.md')

    // A profile that made nothing lists nothing, and says so.
    const none = await callFull(dave, 'list_tasks', { made: true })
    expect(none.structured, none.text).toMatchObject({ outcome: 'ok', made: [], more: 0 })
    expect(none.text).toBe('your profile has made no files')
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the bound
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('the made list holds the newest ten and says how many older ones it leaves out, and the older ones are still on their piece’s record', async () => {
    const ali1 = await personOpens('ali')
    const ali2 = await personOpens('ali')
    const ali3 = await personOpens('ali')
    const aliRoot1 = rootLabelOf(ali1)
    const aliRoot2 = rootLabelOf(ali2)
    const names = Array.from({ length: 12 }, (_, i) => `f${String(i + 1).padStart(2, '0')}.md`)

    // ⚑ Alternating makers, each on its own root, each its own call: file n is newer than file n-1.
    const keepNth = async (n: number): Promise<void> => {
      const name = names[n - 1] as string
      const odd = n % 2 === 1
      await keeps(odd ? ali1 : ali2, odd ? aliRoot1 : aliRoot2, name, `content of ${name}\n`)
    }
    const listedBy = async (): Promise<Answered> => callFull(ali3, 'list_tasks', { made: true })

    for (let n = 1; n <= 10; n++) await keepNth(n)
    const at10 = await listedBy()
    expect(namesOf(at10.structured.made), at10.text).toEqual(
      ['f10', 'f09', 'f08', 'f07', 'f06', 'f05', 'f04', 'f03', 'f02', 'f01'].map((n) => `${n}.md`),
    )
    expect(at10.structured.more).toBe(0)
    expect(at10.text).not.toContain('older')

    await keepNth(11)
    const at11 = await listedBy()
    expect(namesOf(at11.structured.made), at11.text).toEqual(
      ['f11', 'f10', 'f09', 'f08', 'f07', 'f06', 'f05', 'f04', 'f03', 'f02'].map((n) => `${n}.md`),
    )
    expect(at11.structured.more).toBe(1)
    expect(at11.text).toContain('1 older one is not listed')
    expect(at11.text).not.toContain('f01.md')

    await keepNth(12)
    const at12 = await listedBy()
    expect(namesOf(at12.structured.made), at12.text).toEqual(
      ['f12', 'f11', 'f10', 'f09', 'f08', 'f07', 'f06', 'f05', 'f04', 'f03'].map((n) => `${n}.md`),
    )
    expect(at12.structured.more).toBe(2)
    expect(at12.text).toContain('2 older ones are not listed')
    // ⚑ D-037 · the older ones are reached through find_files, or the record of their piece.
    expect(at12.text).toContain(
      'find_files finds them, or list_tasks naming the piece one was kept on',
    )
    for (const left of ['f01.md', 'f02.md']) expect(at12.text).not.toContain(left)

    // ⚑ The older ones are still on their piece's record, which the sentence promises: f01 is on
    // ali1's root, read here by ali3, a conversation that kept none of them.
    const record = await callFull(ali3, 'list_tasks', { piece: aliRoot1 })
    expect(record.structured, record.text).toMatchObject({ outcome: 'ok', root: true })
    const recorded = namesOf(record.structured.resources)
    expect(recorded).toContain('f01.md')
    expect(recorded).toEqual(['f01.md', 'f03.md', 'f05.md', 'f07.md', 'f09.md', 'f11.md'])
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the shapes
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('made is refused beside a piece and as anything but true or false, false is the board, and a conversation this app can name no profile for lists no files', async () => {
    const ali1 = await personOpens('ali')
    const stray = aStranger('sess_stray_a')
    const aliRoot = rootLabelOf(ali1)
    await keeps(ali1, aliRoot, 'kept.md', 'one file\n')

    const problemsOf = (answer: Record<string, unknown>): string =>
      ((answer.detail as { problems?: string[] } | undefined)?.problems ?? []).join(' | ')

    // ⛔ Each refused shape differs from an accepted one by exactly one argument.
    const beside = await callOn(ali1, 'list_tasks', { made: true, piece: aliRoot })
    expect(beside, JSON.stringify(beside)).toMatchObject({
      outcome: 'refused',
      rail: 'malformed-request',
    })
    expect(problemsOf(beside)).toContain('made and piece cannot be given together')
    for (const made of ['yes', 1]) {
      const refused = await callOn(ali1, 'list_tasks', { made })
      expect(refused, JSON.stringify(made)).toMatchObject({
        outcome: 'refused',
        rail: 'malformed-request',
      })
      expect(problemsOf(refused)).toContain('made, when given, must be true or false')
    }

    // ⚑ The paired positives: `made` alone is a list, `piece` alone is a record, `false` is the board.
    const list = await callOn(ali1, 'list_tasks', { made: true })
    expect(list, JSON.stringify(list)).toMatchObject({ outcome: 'ok', more: 0 })
    expect(namesOf(list.made)).toEqual(['kept.md'])
    const record = await callOn(ali1, 'list_tasks', { piece: aliRoot })
    expect(record, JSON.stringify(record)).toMatchObject({ outcome: 'ok', root: true })
    const board = await callOn(ali1, 'list_tasks', { made: false })
    expect(board, JSON.stringify(board)).toMatchObject({ outcome: 'ok' })
    expect(Array.isArray(board.you_hold)).toBe(true)
    expect(board).not.toHaveProperty('made')

    // ⚠️ A conversation no identity runs under is of no profile, and lists no files — said so, and
    // not as an empty list of a profile that made nothing.
    const strays = await callFull(stray, 'list_tasks', { made: true })
    expect(strays.structured, strays.text).toEqual({ outcome: 'ok', made: [], more: 0 })
    expect(strays.text).toBe(
      'this app cannot name the profile this conversation runs as, so it lists no files',
    )
  })
})
