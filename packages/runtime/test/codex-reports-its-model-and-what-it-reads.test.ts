import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type RuntimeEvent } from '../src/index'
import { CodexRuntime } from '../src/codex'
import { expectSilentProbeToGiveUp } from './helpers/silent-probe'
import {
  completedTurn,
  threadStartResponse,
  turnCompletedNotification,
} from './fixtures/codex-protocol'
import {
  FakeTransport,
  adopt,
  collect,
  firstOfType,
  has,
  okThread,
  startCodex,
} from './helpers/fake-codex-transport'

describe('the effective model + reasoning come from the PROVIDER (081)', () => {
  it('the handshake response reports the model — not the option we passed', async () => {
    // We usually passed NO model and let the provider choose, so echoing our own input would be a
    // guess dressed as a fact. Started with no model, the descriptor still shows what Codex says.
    // ⚑ D-042 · R1: the desktop host no longer sends an absent model — every start and resume names
    // one, the provider's default among them by name. The adapter contract still allows an absent
    // model, so this case stands; and even a NAMED model is a request, never the report (081).
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({ ...okThread('th_1'), model: 'gpt-5.1-codex' }))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    expect(handle.agentInfo?.model).toBe('gpt-5.1-codex')
    await handle.close()
  })

  it('the handshake ALSO reports the reasoning effort — a config.toml effort shows immediately (082)', async () => {
    // The 081 bug: only `ThreadSettings.effort` was read, so an effort set in `config.toml` was live
    // on the server from the first message yet the panel showed `…` until some later
    // `settings/updated` happened to arrive. `ThreadStartResponse.reasoningEffort` is the field.
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({
      ...okThread('th_1'),
      model: 'gpt-5.1-codex',
      reasoningEffort: 'high',
    }))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    expect(handle.agentInfo?.reasoningEffort, 'available at start, not only later').toBe('high')
    expect(handle.agentInfo?.model).toBe('gpt-5.1-codex')
    await handle.close()
  })

  it('what we ASKED for reaches the wire — turn/start carries the effort (024)', async () => {
    // The 024 bug: `TurnStartParams.effort` is settable and was never set, so the server had
    // nothing to report and the panel said `…` forever. This is the write half of the fix, and
    // per-turn was the ONLY lever we used — `ThreadStartParams` has no effort field of its own.
    // ⚑ D-042: turn/start still carries the effort on every turn, and thread/start and
    // thread/resume now carry it too, through the config overlay (`config.model_reasoning_effort`,
    // `CodexSessionHandle.openTheThread`), so the handshake runs at it before the first turn.
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    const started: unknown[] = []
    transport.onRequest('turn/start', (params) => {
      started.push(params)
      return {}
    })
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
      reasoningEffort: 'high',
    })
    await handle.send('think hard about this')
    expect(started).toHaveLength(1)
    expect((started[0] as { effort?: string }).effort).toBe('high')
    await handle.close()
  })

  it('asking for nothing sends nothing — the server keeps its own default (024)', async () => {
    // Omitted must not become 'medium' on the wire: a value we never chose would override an
    // effort the user configured in config.toml, and would then be reported back as if it were
    // theirs.
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    const started: unknown[] = []
    transport.onRequest('turn/start', (params) => {
      started.push(params)
      return {}
    })
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    await handle.send('anything')
    expect((started[0] as { effort?: string }).effort).toBeUndefined()
    await handle.close()
  })

  it('a REPORTED effort is flagged as reported — Codex confirms, so it is fact (024)', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({
      ...okThread('th_1'),
      model: 'gpt-5.1-codex',
      reasoningEffort: 'high',
    }))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    expect(handle.agentInfo?.reasoningEffortReported).toBe(true)
    await handle.close()
  })

  it('a handshake WITHOUT an effort still reports none — absent, never invented', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({ ...okThread('th_1'), model: 'gpt-5.1-codex' }))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    expect(handle.agentInfo?.reasoningEffort).toBeUndefined()
    await handle.close()
  })

  it('a later model/rerouted preserves the handshake effort (082 + 081 no-erase)', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({
      ...okThread('th_1'),
      model: 'gpt-5.1-codex',
      reasoningEffort: 'high',
    }))
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    transport.notification('model/rerouted', {
      threadId: 'th_1',
      turnId: 'tn_1',
      fromModel: 'gpt-5.1-codex',
      toModel: 'gpt-5.1-codex-mini',
      reason: 'overloaded',
    })
    await vi.waitFor(() => expect(handle.agentInfo?.model).toBe('gpt-5.1-codex-mini'))
    expect(handle.agentInfo?.reasoningEffort, 'a reroute reports no effort').toBe('high')
    await handle.close()
    await consumer
  })

  it('thread/settings/updated supplies the reasoning effort and keeps the model current', async () => {
    const { transport, handle, consumer } = await startCodex()
    transport.notification('thread/settings/updated', {
      threadId: 'th_1',
      threadSettings: {
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
        // ⚑ 736 · R96 — the prompting profile's sandbox (was `readOnly`, which now fails closed).
        sandboxPolicy: { type: 'workspaceWrite' },
        model: 'gpt-5.1-codex-max',
        effort: 'high', // the REAL field name — there is no `reasoning_effort` in the protocol
      },
    })
    await vi.waitFor(() => expect(handle.agentInfo?.reasoningEffort).toBe('high'))
    expect(handle.agentInfo?.model).toBe('gpt-5.1-codex-max')
    await handle.close()
    await consumer
  })

  it('a model/rerouted updates the model — the panel must not show a stale one', async () => {
    const { transport, handle, consumer } = await startCodex()
    transport.notification('thread/settings/updated', {
      threadId: 'th_1',
      threadSettings: {
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
        // ⚑ 736 · R96 — the prompting profile's sandbox (was `readOnly`, which now fails closed).
        sandboxPolicy: { type: 'workspaceWrite' },
        model: 'gpt-5.1-codex',
        effort: 'medium',
      },
    })
    await vi.waitFor(() => expect(handle.agentInfo?.model).toBe('gpt-5.1-codex'))

    transport.notification('model/rerouted', {
      threadId: 'th_1',
      turnId: 'tn_1',
      fromModel: 'gpt-5.1-codex',
      toModel: 'gpt-5.1-codex-mini',
      reason: 'overloaded',
    })
    await vi.waitFor(() => expect(handle.agentInfo?.model).toBe('gpt-5.1-codex-mini'))
    // A reroute reports no effort — the known one must survive rather than being erased.
    expect(handle.agentInfo?.reasoningEffort).toBe('medium')

    await handle.close()
    await consumer
  })
})

describe('the model list, asked of the app-server rather than written down (058)', () => {
  /**
   * Probed against the bundled 0.146.0 binary before any of this was written: `model/list` answers
   * straight after `initialize`, with **no thread, no turn and no tokens**, and returned seven rows.
   * Three facts from that probe are what these tests hold the adapter to.
   */
  const row = (over: Record<string, unknown>): Record<string, unknown> => ({
    id: 'gpt-5.6-sol',
    model: 'gpt-5.6-sol',
    displayName: 'GPT-5.6-Sol',
    description: 'Latest frontier agentic coding model.',
    hidden: false,
    upgrade: null,
    upgradeInfo: null,
    isDefault: true,
    ...over,
  })

  /** A runtime whose transport answers `model/list` from a script of pages. */
  function listing(pages: { data: unknown[]; nextCursor: string | null }[]): {
    runtime: CodexRuntime
    transport: FakeTransport
  } {
    const transport = new FakeTransport()
    let page = 0
    transport.onRequest('model/list', () => pages[Math.min(page++, pages.length - 1)])
    return { runtime: new CodexRuntime(adopt(transport)), transport }
  }

  it("maps a row, and carries the provider's own upgrade note instead of dropping it", async () => {
    const { runtime, transport } = listing([
      {
        data: [
          row({}),
          // The measured deprecation row: `gpt-5.4` carries an `upgrade` to `gpt-5.6-terra` and a
          // sentence explaining it. 058's dispatch guessed this field meant "needs a plan you do
          // not have"; the probe said deprecation. Either way it must not be swallowed.
          // ⚑ D-042: it names itself as its `model`, as a row whose id is its own model does — so
          // it carries no `resolvesTo` (the A to the next row's B).
          row({
            id: 'gpt-5.4',
            model: 'gpt-5.4',
            displayName: 'GPT-5.4',
            description: 'Previous frontier model.',
            isDefault: false,
            upgrade: 'gpt-5.6-terra',
            upgradeInfo: {
              model: 'gpt-5.6-terra',
              upgradeCopy: null,
              modelLink: null,
              migrationMarkdown: 'GPT-5.4 will be deprecated soon\n\nSwitch to GPT-5.6 Terra.\n',
            },
          }),
          // `upgrade` with no `upgradeInfo` — the provider says there is a successor and nothing
          // more. The fallback states exactly that and does not embroider it.
          // ⚑ D-042: its `model` is the helper's `gpt-5.6-sol`, not its id — the shape whose id
          // points at another model, which the row now says as `resolvesTo`.
          row({ id: 'gpt-5.4-mini', displayName: '', isDefault: false, upgrade: 'gpt-5.6-luna' }),
        ],
        nextCursor: null,
      },
    ])

    const models = await runtime.listModels({ providerHome: '/tmp/x/home' })
    expect(models).toEqual([
      {
        id: 'gpt-5.6-sol',
        label: 'GPT-5.6-Sol',
        description: 'Latest frontier agentic coding model.',
        // ⚑ **D-042 · R1 — Codex's default, by name**: the row the server marks `isDefault`, kept
        // instead of dropped. Its `model` is its id, so no `resolvesTo`.
        isDefault: true,
      },
      {
        id: 'gpt-5.4',
        label: 'GPT-5.4',
        description: 'Previous frontier model.',
        note: 'GPT-5.4 will be deprecated soon\n\nSwitch to GPT-5.6 Terra.',
      },
      {
        id: 'gpt-5.4-mini',
        label: 'gpt-5.4-mini', // no displayName → the id, never a blank menu row
        description: 'Latest frontier agentic coding model.',
        note: 'Superseded by gpt-5.6-luna.',
        // ⚑ D-042: `Model.model` where it differs from the id. `isDefault: false` leaves no key.
        resolvesTo: 'gpt-5.6-sol',
      },
    ])
    // No thread, no turn — the probe is `initialize` + the list and nothing else, which is what
    // makes it free. A `thread/start` creeping in here would cost a conversation per app launch.
    expect(transport.requests.map((r) => r.method)).toEqual(['initialize', 'model/list'])
    expect(transport.closeCount, 'a probe may never leak an app-server').toBe(1)
  })

  it('never asks for HIDDEN rows, and drops one anyway if the server sends it', async () => {
    // ⚠️ The mechanism is the ABSENCE of a flag. `ModelListParams.includeHidden` is documented
    // "when true, include models that are hidden from the default picker list", and the probe
    // proved it: the plain call returned 7 rows, `includeHidden:true` returned 8, the extra one
    // being `codex-auto-review` — the only row with `hidden:true`. So respecting `hidden` means
    // not passing the flag, and this asserts the flag is absent rather than merely false.
    const { runtime, transport } = listing([
      { data: [row({}), row({ id: 'codex-auto-review', hidden: true })], nextCursor: null },
    ])
    const models = await runtime.listModels({ providerHome: '/tmp/x/home' })

    expect(models.map((m) => m.id)).toEqual(['gpt-5.6-sol'])
    const params = transport.requests.find((r) => r.method === 'model/list')?.params
    expect(params).not.toHaveProperty('includeHidden')
  })

  it('follows the cursor, because taking page one would ship a truncated catalogue', async () => {
    // `limit:3` came back with `nextCursor:"3"` on the real server. Today the unpaged call answers
    // everything at once, but that is a fact about a catalogue of seven, not a guarantee.
    const { runtime, transport } = listing([
      { data: [row({ id: 'a' })], nextCursor: 'c1' },
      { data: [row({ id: 'b' })], nextCursor: 'c2' },
      { data: [row({ id: 'c' })], nextCursor: null },
    ])
    const models = await runtime.listModels({ providerHome: '/tmp/x/home' })

    expect(models.map((m) => m.id)).toEqual(['a', 'b', 'c'])
    // The cursor is echoed back, and the FIRST call sends none — a cursor invented for page one
    // would ask the server to resume from a position nobody established.
    expect(
      transport.requests.filter((r) => r.method === 'model/list').map((r) => r.params),
    ).toEqual([{}, { cursor: 'c1' }, { cursor: 'c2' }])
  })

  it('stops on a cursor that never ends, rather than looping forever', async () => {
    // The loop is driven by a value the SERVER chooses. A server that returned a cursor pointing at
    // itself would otherwise spin until the app died, and this probe runs at launcher-open.
    const { runtime, transport } = listing([{ data: [row({})], nextCursor: 'always' }])
    const models = await runtime.listModels({ providerHome: '/tmp/x/home' })

    const calls = transport.requests.filter((r) => r.method === 'model/list').length
    expect(calls).toBe(20)
    expect(models).toHaveLength(20)
    expect(transport.closeCount).toBe(1)
  })

  it('gives up on an app-server that is alive but silent, and still reaps it', async () => {
    // ⚠️ The same defect the Claude probe had, found by 058's review. `transport.request` settles
    // when the child answers, when it EXITS, or when the transport is closed — so an app-server
    // that is running and simply not replying settles nothing. The `finally` holding `close()` was
    // then unreachable: the child outlived the app AND `listModels` never settled, which the host's
    // cache turned into a permanently pending promise for every later caller.
    const transport = new FakeTransport()
    transport.onRequest('model/list', () => new Promise(() => {})) // alive, and never answering
    const runtime = new CodexRuntime(adopt(transport))

    await expectSilentProbeToGiveUp(
      () => runtime.listModels({ providerHome: '/tmp/x/home' }),
      61_000,
    )
    expect(transport.closeCount, 'the stalled app-server must still be reaped').toBe(1)
  })

  it('closes the app-server when the list FAILS, not only when it succeeds', async () => {
    const transport = new FakeTransport()
    transport.failRequest('model/list')
    const runtime = new CodexRuntime(adopt(transport))
    await expect(runtime.listModels({ providerHome: '/tmp/x/home' })).rejects.toThrow(/model\/list/)
    expect(transport.closeCount, 'a rejected probe still tears its child down').toBe(1)
  })

  it("reports NO wholesale grants, because Codex's live inside the app-server (058)", async () => {
    // Not a stub and not "nothing was granted": this adapter answers `acceptForSession` on the wire
    // and the SERVER remembers whatever that covers, so a non-empty list here could only be a guess
    // at provider-side state. `[]` is the honest report, and the gap it implies is written down.
    const { handle, consumer } = await startCodex()
    expect(handle.blanketGrants).toEqual([])
    await handle.close()
    await consumer
  })
})

describe('CodexRuntime — the image path is CHECKED, not believed (067)', () => {
  /**
   * The seam between a pure normalizer and a filesystem.
   *
   * `normalizeNotification` produces the provider's own `savedPath` string, unexamined, because it
   * has no home to examine it against. The adapter is where that string is replaced by a real path
   * or by nothing at all — and this is the test that the substitution actually happens on the way
   * out rather than being described in a comment.
   *
   * Real directories and a real file: the subject is what the filesystem says.
   */
  let home: string
  let images: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'brobot-067-rt-'))
    images = join(home, 'generated_images', 'th_1')
    mkdirSync(images, { recursive: true })
  })

  afterEach(() => rmSync(home, { recursive: true, force: true }))

  async function startIn(providerHome: string): Promise<{
    transport: FakeTransport
    handle: Awaited<ReturnType<CodexRuntime['start']>>
    events: RuntimeEvent[]
    consumer: Promise<void>
  }> {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    // A turn, because `item/completed` is turn-scoped and a notification outside the bound turn is
    // dropped before it ever reaches the normalizer — see TURN_SCOPED_METHODS.
    await handle.send('draw a fox')
    return { transport, handle, events, consumer }
  }

  const imageItem = (savedPath?: string): Record<string, unknown> => ({
    type: 'imageGeneration',
    id: 'exec-1',
    status: 'completed',
    revisedPrompt: 'a curled-up red fox',
    // The field that must never travel. Present in the notification, absent from every event.
    result: 'A'.repeat(200_000),
    ...(savedPath ? { savedPath } : {}),
  })

  it('substitutes the REAL path when the provider named a file inside its own home', async () => {
    const file = join(images, 'exec-1.png')
    writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const { transport, handle, events, consumer } = await startIn(home)
    transport.notification('item/completed', {
      threadId: 'th_1',
      turnId: 'tn_1',
      item: imageItem(file),
    })
    await vi.waitFor(has(events, (e) => e.type === 'image'))
    const image = firstOfType(events, 'image')
    expect(image.path).toContain('exec-1.png')
    expect(image.prompt).toBe('a curled-up red fox')
    // ⚠️ The 200 KB blob went nowhere. Asserted over EVERY event, not just the image one.
    expect(JSON.stringify(events)).not.toContain('AAAA')
    await handle.close()
    await consumer
  })

  it('finds the file by convention when the provider named no path at all', async () => {
    writeFileSync(join(images, 'exec-1.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const { transport, handle, events, consumer } = await startIn(home)
    transport.notification('item/completed', {
      threadId: 'th_1',
      turnId: 'tn_1',
      item: imageItem(),
    })
    await vi.waitFor(has(events, (e) => e.type === 'image'))
    expect(firstOfType(events, 'image').path).toContain('exec-1.png')
    await handle.close()
    await consumer
  })

  it('🔴 726 · R92 — KEEPS a real image the provider named outside its home', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'brobot-067-out-'))
    try {
      const escape = join(elsewhere, 'exec-1.png')
      writeFileSync(escape, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      const { transport, handle, events, consumer } = await startIn(home)
      transport.notification('item/completed', {
        threadId: 'th_1',
        turnId: 'tn_1',
        item: imageItem(escape),
      })
      await vi.waitFor(has(events, (e) => e.type === 'image'))
      const image = firstOfType(events, 'image')
      // ⛔ **On `main` the path was dropped** — it had to be inside `<home>/generated_images`. Since
      // `726` (R92) a real image the provider names is shown wherever it is.
      expect(image.path).toBe(realpathSync.native(escape))
      expect(image.imageId).toBe('exec-1')
      await handle.close()
      await consumer
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })

  it('emits an image with no path when the file simply is not there', async () => {
    const { transport, handle, events, consumer } = await startIn(home)
    transport.notification('item/completed', {
      threadId: 'th_1',
      turnId: 'tn_1',
      item: imageItem(join(images, 'exec-1.png')),
    })
    await vi.waitFor(has(events, (e) => e.type === 'image'))
    expect(firstOfType(events, 'image').path).toBeUndefined()
    await handle.close()
    await consumer
  })
})

/**
 * **What Codex says it read, retained at last** (158).
 *
 * ⚑ `instructionSources` has been on the wire since before this app existed — `ThreadStartResponse`,
 * `ThreadResumeResponse` and `ThreadForkResponse` all declare it, and the fixture above has carried
 * the field the whole time. 156 §4 went looking for a runtime consumer and found none: *"production
 * searches find only generated protocol types and fixtures."*
 *
 * Display an agent’s instructions in the UI. Codex reads its own files, so surface the list
 * the provider reports as the provider’s list rather than injecting text.
 */
describe('the instruction files Codex reports (158)', () => {
  const sources = ['/homes/codex/AGENTS.md', '/work/AGENTS.md', '/work/repo/AGENTS.md']

  it('⛔ start: the reported sources are retained, in the provider’s own order', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({
      ...threadStartResponse('th_1'),
      instructionSources: sources,
    }))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })

    // Order is meaning: global first, then project root-to-cwd, which is the composition order.
    expect(handle.instructionSources).toEqual(sources)
    await handle.close()
  })

  it('⛔ resume: a fresh read REPLACES the old list, never merges with it', async () => {
    // A cold resume re-reads (156), so a file the resumed thread no longer loads must disappear
    // from the list rather than linger because it was true once.
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => ({
      ...threadStartResponse('th_1'),
      instructionSources: ['/homes/codex/AGENTS.md'],
    }))
    const handle = await new CodexRuntime(adopt(transport)).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home' },
    )

    expect(handle.instructionSources).toEqual(['/homes/codex/AGENTS.md'])
    await handle.close()
  })

  it('⚠️ an EMPTY list reads as nothing reported — not as an empty section', async () => {
    // The fixture's default. "Reported none" and "reported nothing" are the same to a reader, and
    // a heading over an empty list is the absence 086 rules out in the other direction.
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })

    expect(handle.instructionSources).toBeUndefined()
    await handle.close()
  })

  it('🔒 non-string entries are dropped — wire data reaching a surface is filtered', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({
      ...threadStartResponse('th_1'),
      instructionSources: ['/work/AGENTS.md', 42, null, { path: '/evil' }, ''],
    }))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })

    expect(handle.instructionSources).toEqual(['/work/AGENTS.md'])
    await handle.close()
  })
})

describe('shared skills at a Codex turn boundary', () => {
  let home: string
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), 'fictional-shared-codex-')))
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })
  it.each([
    ['start', false],
    ['resume', false],
    ['start', true],
    ['resume', true],
  ] as const)(
    'registers both roots on %s and reloads before each turn (managed plugin: %s)',
    async (opening, withPlugin) => {
      const transport = new FakeTransport()
      transport.onRequest('thread/start', () => okThread('th_1', home))
      transport.onRequest('thread/resume', () => okThread('th_1', home))
      transport.onRequest('skills/list', () => ({
        data: [{ cwd: home, errors: [], skills: [] }],
      }))
      transport.onRequest('mcpServerStatus/list', () => ({
        data: [{ name: 'plugin-fern', runtimeStatus: 'connected', toolsError: null, tools: {} }],
      }))
      const runtime = new CodexRuntime(adopt(transport))
      const context = {
        providerHome: home,
        builtInSkills: { root: join(home, 'built-in-skills'), skills: [] },
        sharedSkillsRoot: join(home, 'shared-skills'),
        ...(withPlugin
          ? {
              managedPluginMcp: [
                {
                  name: 'plugin-fern',
                  url: 'http://127.0.0.1:8123/mcp',
                  capability: 'a'.repeat(64),
                },
              ],
            }
          : {}),
      }
      const handle =
        opening === 'start'
          ? await runtime.start({ ...context, cwd: home })
          : await runtime.resume(
              { provider: 'codex', sessionId: 'th_1', cwd: home, rotation: 0 },
              context,
            )
      expect(
        transport.requests.find((one) => one.method === 'skills/extraRoots/set')?.params,
      ).toEqual({ extraRoots: [context.builtInSkills.root, context.sharedSkillsRoot] })
      expect(transport.requests.filter((one) => one.method === 'skills/config/write')).toEqual([])
      const first = transport.requests.length
      await handle.send('Check the recipe.')
      await vi.waitFor(() =>
        expect(transport.requests.slice(first).some((one) => one.method === 'turn/start')).toBe(
          true,
        ),
      )
      expect(
        transport.requests
          .slice(first)
          .filter((one) =>
            ['mcpServerStatus/list', 'skills/list', 'turn/start'].includes(one.method),
          )
          .map((one) => one.method),
      ).toEqual(
        withPlugin
          ? ['mcpServerStatus/list', 'skills/list', 'turn/start']
          : ['skills/list', 'turn/start'],
      )
      expect(
        transport.requests.slice(first).find((one) => one.method === 'skills/list')?.params,
      ).toEqual({ cwds: [home], forceReload: true })
      await expect(handle.send('A concurrent turn.')).rejects.toThrow()
      transport.notification(
        'turn/completed',
        turnCompletedNotification('th_1', completedTurn(transport.lastTurnId)),
      )
      await vi.waitFor(() => expect(handle.status()).toBe('idle'))
      const second = transport.requests.length
      await handle.send('Check the edited recipe.')
      await vi.waitFor(() =>
        expect(transport.requests.slice(second).some((one) => one.method === 'turn/start')).toBe(
          true,
        ),
      )
      expect(
        transport.requests
          .slice(second)
          .filter((one) => ['skills/list', 'turn/start'].includes(one.method))
          .map((one) => one.method),
      ).toEqual(['skills/list', 'turn/start'])
      transport.notification(
        'turn/completed',
        turnCompletedNotification('th_1', completedTurn(transport.lastTurnId)),
      )
      await vi.waitFor(() => expect(handle.status()).toBe('idle'))
      transport.onRequest('skills/list', () =>
        Promise.reject(new Error('fictional reload failure')),
      )
      await handle.send('An unread refresh.')
      await vi.waitFor(() => expect(handle.status()).toBe('idle'))
      const afterFailure = transport.requests.filter((one) => one.method === 'turn/start').length
      expect(afterFailure).toBe(2)
      let release!: () => void
      transport.onRequest(
        'skills/list',
        () =>
          new Promise((done) => {
            release = () => done({ data: [] })
          }),
      )
      await handle.send('A turn stopped during refresh.')
      await vi.waitFor(() => expect(release).toBeDefined())
      await handle.close()
      release()
      await new Promise((done) => setTimeout(done, 10))
      expect(transport.requests.filter((one) => one.method === 'turn/start')).toHaveLength(
        afterFailure,
      )
    },
  )
})
