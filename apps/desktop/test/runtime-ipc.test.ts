import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { allProviderCapabilities, FakeRuntime, SUPPORTED_PROVIDERS } from '@brobot2/runtime'
import {
  executeRuntimeCommand,
  registerRuntimeIpc,
  runtimeCommandSchema,
  webContentsSink,
} from '../src/main/runtime/ipc'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import { NULL_SESSION_STORE } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import {
  DEFAULT_PROFILE_ID,
  RUNTIME_COMMAND_CHANNEL,
  RUNTIME_EVENT_CHANNEL,
  type CreatedSession,
  type RuntimeEventMessage,
  type SessionLiveness,
  type SessionLivenessMessage,
} from '../src/shared/runtime-ipc'

/** The renderer→main boundary: what it accepts, what it refuses, and where it routes. */

class RecordingSink implements RuntimeEventSink {
  // 349 · this double stands in for a WINDOW — the tests below answer for a person through it.
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  readonly liveness: SessionLiveness[] = []
  readonly alive = true

  constructor(readonly ownerId = 'owner:1') {}

  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }

  sendLiveness(message: SessionLivenessMessage): void {
    this.liveness.push(message.liveness)
  }
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('runtime IPC boundary', () => {
  let userData: string
  let host: RuntimeHost
  let sink: RecordingSink
  /**
   * Every `StartOptions` the host handed an adapter — the proof a field crossed the wire, and the
   * only place a field dropped at this boundary shows up.
   *
   * Widened in 106 for `ultracode` — deliberately typed as the fields under test rather than as
   * `StartOptions`, so that `not.toHaveProperty` is asserting about a real object and adding a
   * field here is a conscious act.
   */
  let startOptions: { model?: string; reasoningEffort?: string; ultracode?: boolean }[]

  /**
   * The deps the host under test is built from, kept so a test can build a SECOND host that differs
   * in one seam (167) instead of restating the whole wiring and drifting from it.
   */
  let deps: ConstructorParameters<typeof RuntimeHost>[0]

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-ipc-'))
    let counter = 0
    startOptions = []
    deps = {
      store: NULL_SESSION_STORE,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider) => {
        const runtime = new FakeRuntime(provider)
        const start = runtime.start.bind(runtime)
        runtime.start = async (options) => {
          startOptions.push(options)
          return await start(options)
        }
        return runtime
      },
      prepareProviderHome: (provider, profileId) =>
        join(userData, 'provider-homes', profileId, provider),
      providerHomePath: (provider, profileId) =>
        join(userData, 'provider-homes', profileId, provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME',
        model: `${provider} config model`,
        authNote: null,
        files: [{ name: 'auth.json', path: join(home, 'auth.json'), exists: false, note: 'x' }],
      }),
    }
    host = new RuntimeHost(deps)
    sink = new RecordingSink()
  })

  afterEach(async () => {
    await host.closeAll()
    rmSync(userData, { recursive: true, force: true })
  })

  it('carries every field of a create through to the host, not just the ones it remembers', async () => {
    // The boundary rebuilds the input field by field, so a new field is silently dropped
    // unless something checks. That is exactly how the profile first reached the host as
    // `default` while the launcher said otherwise — caught by the live smoke, pinned here.
    const created = (await executeRuntimeCommand(host, sink, {
      kind: 'createSession',
      provider: 'codex',
      cwd: join(userData, 'work'),
      approvalMode: 'auto',
      profileId: 'work',
    })) as CreatedSession

    expect(created.profileId).toBe('work')
    expect(created.providerHome).toBe(join(userData, 'provider-homes', 'work', 'codex'))
    expect(created.cwd).toBe(join(userData, 'work'))
    expect(created.approvalMode).toBe('auto')
  })

  it('the chosen reasoning effort reaches the ADAPTER, not just the schema (024)', async () => {
    // Same failure mode as the profile above, and the reason this test exists at all: the zod
    // schema STRIPS unknown keys and the boundary rebuilds the input field by field, so a new
    // field is dropped twice over — silently, with a green suite. Asserted where it lands.
    startOptions.length = 0
    await executeRuntimeCommand(host, sink, {
      kind: 'createSession',
      provider: 'codex',
      reasoningEffort: 'high',
    })
    expect(startOptions.at(-1)?.reasoningEffort).toBe('high')
  })

  it('an effort nobody chose is not invented on the way through (024)', async () => {
    // ⚑ **D-042 reversed the half that read `undefined`, by ruling** (R1: every launch names its
    // model and effort). A launch that names none is named by the HOST, once, as the provider's own
    // default by name — on Codex the row its `model/list` marks `isDefault` (the Fake's `-a`), at
    // that row's own default effort, `medium`. ⛔ What still holds is the title: nothing on the way
    // through INVENTS one — the command carries no effort, and what reaches the adapter is the
    // provider's own answer.
    startOptions.length = 0
    await executeRuntimeCommand(host, sink, { kind: 'createSession', provider: 'codex' })
    expect(startOptions.at(-1)).toMatchObject({ model: 'fake-codex-a', reasoningEffort: 'medium' })

    // ⛔ …and `medium` is that ANSWER, not a middle rung a boundary picked that happens to agree
    // with the Fake: the same launch on a host whose provider marks its default row `low` reaches
    // the adapter at `low`. Only the list-driven answer produces it — the paired negative the old
    // `toBeUndefined()` was, now that an absence no longer crosses.
    const lowByDefault = new RuntimeHost({
      ...deps,
      createRuntime: (provider) => {
        const runtime = deps.createRuntime(provider)
        const list = runtime.listModels.bind(runtime)
        runtime.listModels = async (context) =>
          (await list(context)).map((row) =>
            row.isDefault === true ? { ...row, defaultEffort: 'low' } : row,
          )
        return runtime
      },
    })
    try {
      startOptions.length = 0
      await executeRuntimeCommand(lowByDefault, sink, { kind: 'createSession', provider: 'codex' })
      expect(startOptions.at(-1)).toMatchObject({ model: 'fake-codex-a', reasoningEffort: 'low' })
    } finally {
      await lowByDefault.closeAll()
    }
  })

  it('the max-effort MODE reaches the adapter too, on its own field (106)', async () => {
    // The third crossing of the same boundary, and the reason the two above exist: zod STRIPS
    // unknown keys and the boundary rebuilds the input field by field, so a new field is dropped
    // twice over, silently, with a green suite. `ultracode` is the field most likely to be lost
    // that way, because it is the only launch setting with no session row to check afterwards.
    startOptions.length = 0
    await executeRuntimeCommand(host, sink, {
      kind: 'createSession',
      provider: 'codex',
      ultracode: true,
    })
    expect(startOptions.at(-1)?.ultracode).toBe(true)

    // ⚠️ And absent stays absent — the paired negative, because a boundary that defaulted this to
    // `false` would be the app telling the provider something it was never asked to say, into the
    // highest-precedence settings layer there is.
    await executeRuntimeCommand(host, sink, { kind: 'createSession', provider: 'codex' })
    expect(startOptions.at(-1)).not.toHaveProperty('ultracode')
  })

  it('the mode is a boolean at the boundary, never a reasoning level (106)', () => {
    // The schema is where "it is not an effort value" stops being a design note. A string here is
    // refused rather than coerced, so the confusion that started this task — asking for it as a
    // rung of the effort menu — cannot cross the wire even if a surface tried.
    for (const bad of ['true', 'ultracode', 1, null]) {
      expect(
        runtimeCommandSchema.safeParse({
          kind: 'createSession',
          provider: 'claude',
          ultracode: bad,
        }).success,
        JSON.stringify(bad),
      ).toBe(false)
    }
    // The positive that stops the sweep above passing over a key the schema simply ignores.
    expect(
      runtimeCommandSchema.safeParse({
        kind: 'createSession',
        provider: 'claude',
        ultracode: true,
      }).success,
    ).toBe(true)
    // …and it is genuinely optional, not merely allowed.
    expect(
      runtimeCommandSchema.safeParse({ kind: 'createSession', provider: 'claude' }).success,
    ).toBe(true)
  })

  it('refuses an export id that would become a path rather than a filename', () => {
    // The id lands in a filename, so the boundary states what it may be instead of relying on
    // the row lookup happening to fail first.
    for (const sessionId of ['../escape', 'a/b', '.']) {
      expect(
        runtimeCommandSchema.safeParse({ kind: 'exportSession', sessionId, exportKind: 'bundle' })
          .success,
        sessionId,
      ).toBe(false)
    }
    expect(
      runtimeCommandSchema.safeParse({
        kind: 'exportSession',
        sessionId: 'sess_9f1c1f0e-1a1a-4b4b-9c9c-0d0d0d0d0d0d',
        exportKind: 'native',
      }).success,
    ).toBe(true)
  })

  it('validates and runs the whole command set against a live session', async () => {
    const created = (await executeRuntimeCommand(host, sink, {
      kind: 'createSession',
      provider: 'claude',
    })) as CreatedSession
    expect(created.sessionId).toBe('sess_1')

    await executeRuntimeCommand(host, sink, {
      kind: 'send',
      sessionId: created.sessionId,
      text: 'hello',
    })
    await waitFor(
      () => sink.messages.some((message) => message.event.type === 'permission_request'),
      'the permission card',
    )

    await executeRuntimeCommand(host, sink, {
      kind: 'respondPermission',
      sessionId: created.sessionId,
      requestId: 'turn_1_perm',
      decision: { outcome: 'allow' },
    })
    await waitFor(
      () => sink.messages.some((message) => message.event.type === 'turn'),
      'the terminal turn',
    )

    const config = await executeRuntimeCommand(host, sink, {
      kind: 'refreshConfig',
      sessionId: created.sessionId,
    })
    expect(config).toMatchObject({ home: created.providerHome, files: expect.any(Array) })

    await executeRuntimeCommand(host, sink, { kind: 'interrupt', sessionId: created.sessionId })
    await executeRuntimeCommand(host, sink, { kind: 'close', sessionId: created.sessionId })
    expect(host.sessionIds).toEqual([])
  })

  it('answers a user-input request through the bridge', async () => {
    const created = (await executeRuntimeCommand(host, sink, {
      kind: 'createSession',
      provider: 'codex',
    })) as CreatedSession

    // `reject` is the protocol-safe response the UI can always send.
    //
    // The IPC refusal is written as a sentence for the person rather than the adapter
    // diagnostic `not pending` or request key `number:0`. It remains a refusal; the host’s
    // `refuseAnswer` still logs the diagnostic.
    //
    // ⛔ **And it comes back as a VALUE now, carrying whether the card survived** (146). It used to
    // be a thrown `Error`, which `ipcMain.handle` flattens to its message — so the renderer could
    // not tell a refusal that consumed the request from one that did not, sent both through
    // `markRequestFailed`, and killed cards the provider was still waiting on (145 HIGH 1). This
    // one is `not-pending`: the request really is gone, so `stillOpen` is false and settling the
    // card is correct.
    const refusal = await executeRuntimeCommand(host, sink, {
      kind: 'respondUserInput',
      sessionId: created.sessionId,
      requestId: 'ui_1',
      response: { kind: 'reject' },
    }).catch((error: unknown) => `THREW — ${(error as Error).message}`)

    expect(refusal).toEqual({
      outcome: 'refused',
      reason: 'the agent is no longer waiting for an answer to this',
      stillOpen: false,
    })
    // The negatives, paired with that positive so they cannot pass over an empty string or a
    // rejected promise: none of the three things that leak implementation may be in it.
    const failure = JSON.stringify(refusal)
    expect(failure).not.toContain('ui_1')
    expect(failure).not.toContain('not pending')
    expect(failure).not.toContain('settled, or unknown')
  })

  it('carries SEVERAL answers to one question across the boundary, and one answer unchanged (139)', () => {
    // ⚠️ **The answer direction of the same hop the event crosses the other way.** 128 measured that
    // this boundary strips what it does not declare, so a card that emits `['a','b']` is only
    // multi-select if the command schema says an answer may be a list. It has said so since 033 —
    // `string | string[]` — and nothing could reach that half until the question could ask for it,
    // which is why this is a *regression* assertion on a contract 139 relies on rather than changes.
    const many = runtimeCommandSchema.safeParse({
      kind: 'respondUserInput',
      sessionId: 'sess_1',
      requestId: 'toolu_1',
      response: { kind: 'answer', answers: { q0: ['rendering', 'agents'], q1: 'a subfolder' } },
    })
    expect(many.success).toBe(true)
    // Parsed, not merely accepted: the values have to arrive as they left, or the card's list would
    // reach the adapter as something else.
    expect(many.success && many.data).toMatchObject({
      response: { kind: 'answer', answers: { q0: ['rendering', 'agents'], q1: 'a subfolder' } },
    })
  })

  it('accepts leaving plan mode with no message, and the go-ahead with one (085)', () => {
    // Both outcomes of the one gesture have to survive the boundary, because the whole design is
    // that they are the same command. Asserted as a pair so neither can pass alone.
    const leave = runtimeCommandSchema.safeParse({ kind: 'endPlanMode', sessionId: 'sess_1' })
    expect(leave.success).toBe(true)
    expect(leave.success && 'text' in leave.data, 'absent, not an explicit undefined').toBe(false)
    expect(
      runtimeCommandSchema.safeParse({
        kind: 'endPlanMode',
        sessionId: 'sess_1',
        text: 'Go ahead with this plan.',
      }).success,
    ).toBe(true)
  })

  it.each([
    ['a non-object payload', 'nope'],
    ['an unknown command kind', { kind: 'selfDestruct', sessionId: 'sess_1' }],
    ['a missing session id', { kind: 'send', text: 'hi' }],
    ['an empty prompt', { kind: 'send', sessionId: 'sess_1', text: '' }],
    ['an unsupported provider', { kind: 'createSession', provider: 'gemini' }],
    // ⚠️ Leaving planning sends NO text and is accepted below; an EMPTY text is still refused here
    // (085). "Send nothing" and "send the empty string" are different requests, and only one of
    // them means anything — so `.optional()` had to be added without loosening the content rule.
    ['an empty go-ahead', { kind: 'endPlanMode', sessionId: 'sess_1', text: '' }],
    // ⛔ **And a WHITESPACE one** (234 §3, from `228` M3). This verb kept `min(1)` — the rule 221
    // removed from the other three — so a go-ahead of nothing but spaces was an accepted command:
    // the host left plan mode durably and then recorded a turn made of spaces.
    ['a whitespace go-ahead', { kind: 'endPlanMode', sessionId: 'sess_1', text: '   ' }],
    ['a newline-only go-ahead', { kind: 'endPlanMode', sessionId: 'sess_1', text: '\n\t' }],
    [
      'a decision outside the contract',
      {
        kind: 'respondPermission',
        sessionId: 'sess_1',
        requestId: 'r',
        decision: { outcome: 'always' },
      },
    ],
    [
      'a user-input answer of the wrong shape',
      {
        kind: 'respondUserInput',
        sessionId: 'sess_1',
        requestId: 'r',
        response: { kind: 'answer', answers: 'yes' },
      },
    ],
    // The library commands (047). Each of these crosses the process boundary and is then used —
    // as a substring match over every entry, as a lookup key against the homes — so the wire is
    // where the shape is settled, not the host.
    [
      'a library query longer than the boundary allows',
      { kind: 'listLibrary', query: 'x'.repeat(201) },
    ],
    ['a library page bigger than the boundary allows', { kind: 'listLibrary', limit: 501 }],
    ['a fractional page size', { kind: 'listLibrary', limit: 1.5 }],
    ['a negative page offset', { kind: 'listLibrary', offset: -1 }],
    // 118 — `recordId` names one row exactly, so an empty one names nothing and is not a filter
    // that matches everything. It answers to the same `sessionId` rule as every other command.
    ['a library read naming an empty record', { kind: 'listLibrary', recordId: '' }],
    [
      'a library read naming an unbounded record',
      { kind: 'listLibrary', recordId: 'x'.repeat(201) },
    ],
    [
      'an import for a provider that does not exist',
      { kind: 'importUserHomeSession', provider: 'gemini', providerSessionId: 't1' },
    ],
    [
      'an import naming no conversation',
      { kind: 'importUserHomeSession', provider: 'claude', providerSessionId: '' },
    ],
    // ⚑ **D-017b** — `readArchived` is gone; `latestHistory` is the same read of the ledger.
    ['a read of no session', { kind: 'latestHistory' }],
    // 102 — the cancel names the launch it means. Optional on the commands that start something
    // (`createSession`, `resume`, and since 735 `startAndSend`), because a
    // window that never intends to take one back need not invent a name; required here, because a
    // cancel with nothing to name is a cancel of whatever happens to be starting, and one window
    // can have two.
    ['a cancel that names no launch', { kind: 'cancelLaunch' }],
    ['a cancel naming an empty launch', { kind: 'cancelLaunch', launchKey: '' }],
    ['a cancel naming an unbounded launch', { kind: 'cancelLaunch', launchKey: 'x'.repeat(201) }],
  ])('refuses %s with a readable message', async (_label, payload) => {
    await expect(executeRuntimeCommand(host, sink, payload)).rejects.toThrow(
      /^invalid runtime command: /,
    )
    expect(host.sessionIds).toEqual([])
  })

  it('accepts a library read with nothing specified, and one with everything', async () => {
    // A bare `listLibrary` is the first thing the surface sends, so it must be a valid command
    // rather than one that needs defaults filled in renderer-side.
    await expect(executeRuntimeCommand(host, sink, { kind: 'listLibrary' })).resolves.toMatchObject(
      {
        entries: [],
        matched: 0,
      },
    )
    await expect(
      executeRuntimeCommand(host, sink, {
        kind: 'listLibrary',
        query: 'parser',
        recordId: 'sess_1',
        limit: 10,
        offset: 0,
      }),
    ).resolves.toMatchObject({ entries: [] })
  })

  it('⛔ `recordId` reaches the host, and is not dropped in the switch (118)', async () => {
    // ⚠️ **The hop nothing crossed.** `session-library.test.ts` calls `readLibrary` directly and the
    // renderer test stubs `window.api`, so both sides of this wire were covered and the wire was
    // not: delete `recordId: command.recordId` from `executeRuntimeCommand` and `listLibrary`
    // returns the WHOLE library, whose first row is whatever was updated most recently. The reopen
    // list's Read button would then open somebody else's transcript, with every test still green.
    const asked: unknown[] = []
    const real = host.listLibrary.bind(host)
    host.listLibrary = (query) => {
      asked.push(query)
      return real(query)
    }
    await executeRuntimeCommand(host, sink, { kind: 'listLibrary', recordId: 'sess_9' })
    expect(asked).toEqual([
      { query: undefined, recordId: 'sess_9', limit: undefined, offset: undefined },
    ])
  })

  it('a cancel for a launch nobody is running is a no-op, not a refusal (102)', async () => {
    // ⚠️ **The paired positive for the three rejections above**, and the property that matters at
    // this boundary: a well-formed cancel is ACCEPTED and answers `false`. The race it exists to
    // survive is the launch finishing between the press and the command — and a boundary that threw
    // there would turn an ordinary race into an error on a surface the user has already left.
    await expect(
      executeRuntimeCommand(host, sink, { kind: 'cancelLaunch', launchKey: 'launch-1' }),
    ).resolves.toBe(false)
    expect(host.sessionIds).toEqual([])
  })

  it('reads an archived conversation without opening anything', async () => {
    // No sink is passed to `latestHistory` by design: it is a reading, not a session. If this ever
    // starts opening a handle, `sessionIds` will say so. ⚑ **D-017b** — `readArchived`, which asked
    // the same query, is gone; this is the read that remains.
    // A WINDOW since 054, and an empty one for a session with no ledger — which is a state the
    // reading pane renders, not an error it handles. `hasOlder` is the part worth pinning: a cursor
    // claiming there was more would put a "load earlier" control on a pane that has nothing to load.
    await expect(
      executeRuntimeCommand(host, sink, { kind: 'latestHistory', sessionId: 'sess_missing' }),
    ).resolves.toEqual({ entries: [], from: 0, hasOlder: false, turnAligned: true })
    expect(host.sessionIds).toEqual([])
  })

  it('answers what every provider can do, and takes no argument to get it wrong with (039)', async () => {
    // Parameterless on purpose: a `capabilities(provider)` would require the renderer to name a
    // provider to ask about one, which is the thing 039 exists to remove. It gets every declaration
    // and looks up whichever is selected.
    const declared = await executeRuntimeCommand(host, sink, { kind: 'capabilities' })
    expect(declared).toEqual(allProviderCapabilities())
    for (const provider of SUPPORTED_PROVIDERS) {
      expect(declared).toHaveProperty([provider, 'planMode', 'state'])
    }
    // No session is opened to answer it — this is a fact about the build, not about a conversation.
    expect(host.sessionIds).toEqual([])
    // A caller that tries to narrow it is NOT rejected — and saying so matters, because the first
    // version of this comment claimed it was, directly above an assertion that it parses. This
    // schema strips unknown keys rather than refusing them, which is a deliberate property of the
    // whole boundary (`createSession` relies on it too). So the guarantee is not "you cannot ask
    // for one provider"; it is that asking leaves nothing behind for anything downstream to read.
    expect(
      runtimeCommandSchema.safeParse({ kind: 'capabilities', provider: 'claude' }).success,
    ).toBe(true)
    expect(
      runtimeCommandSchema.parse({ kind: 'capabilities', provider: 'claude' }),
      'the unknown key is STRIPPED, so nothing downstream can read a provider off it',
    ).toEqual({ kind: 'capabilities' })
  })

  it('answers which profiles exist, and opens nothing to do it (167)', async () => {
    // The launcher's menu, over the same parameterless channel `capabilities` uses and for the same
    // reason: the asker does not know what profiles there are, so there is nothing to narrow with.
    await expect(executeRuntimeCommand(host, sink, { kind: 'profiles' })).resolves.toEqual([
      DEFAULT_PROFILE_ID,
    ])
    // A directory listing, not a launch: nothing is provisioned and no session appears.
    expect(host.sessionIds).toEqual([])

    // …and the answer really is the host's, rather than a constant this boundary made up. A host
    // wired to a real `listProfileIds` answers with what is on disk, and the command hands it over.
    const wired = new RuntimeHost({ ...deps, listProfiles: () => ['default', 'developer'] })
    await expect(executeRuntimeCommand(wired, sink, { kind: 'profiles' })).resolves.toEqual([
      'default',
      'developer',
    ])
  })

  it('accepts a permission decision only in the contract shapes', () => {
    for (const outcome of ['allow', 'allow_for_session', 'deny', 'cancel']) {
      expect(
        runtimeCommandSchema.safeParse({
          kind: 'respondPermission',
          sessionId: 's',
          requestId: 'r',
          decision: { outcome },
        }).success,
      ).toBe(true)
    }
  })

  it('registers one channel and routes each invoke through the sender’s sink', async () => {
    const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
    const seen: string[] = []

    registerRuntimeIpc({
      ipc: { handle: (channel, listener) => void handlers.set(channel, listener) },
      host,
      sinkFor: (event) => {
        seen.push(String((event as unknown as { id: number }).id))
        return sink
      },
    })

    expect([...handlers.keys()]).toEqual([RUNTIME_COMMAND_CHANNEL])
    const handler = handlers.get(RUNTIME_COMMAND_CHANNEL)
    const created = (await handler?.({ id: 7 } as unknown as IpcMainInvokeEvent, {
      kind: 'createSession',
      provider: 'claude',
    })) as CreatedSession

    expect(created.sessionId).toBe('sess_1')
    expect(seen).toEqual(['7'])
  })

  /**
   * ⛔ **119's commands, over the real boundary** (review). The schema member and the `switch`
   * case are two separate edits, and nothing else in the suite executes either: the DOM tests stub
   * `window.api` outright and the renderer-side guard only greps a `.vue` file. Delete either half
   * and every other test stays green while the button throws *"unrecognized command"* in the app.
   *
   * The host here has {@link NULL_SESSION_STORE}, so the command answers an `unknown-session`
   * object — which is what makes a mis-routed `case` visible rather than merely a shape that happens
   * to typecheck. ⚑ **D-017b** — `libraryEntry`, the other of the two, is gone with the Read press
   * it served.
   */
  describe('the two commands 119 added reach the host they name', () => {
    it('routes `importRecordedSession`, and refuses one with no id', async () => {
      expect(
        runtimeCommandSchema.safeParse({ kind: 'importRecordedSession', sessionId: 'sess_1' })
          .success,
      ).toBe(true)
      expect(runtimeCommandSchema.safeParse({ kind: 'importRecordedSession' }).success).toBe(false)

      const answer = await executeRuntimeCommand(host, sink, {
        kind: 'importRecordedSession',
        sessionId: 'sess_1',
      })
      expect(answer).toMatchObject({ outcome: 'unknown-session', readable: false })
    })
  })
})

describe('webContentsSink', () => {
  function fakeContents(): WebContents & { sent: [string, unknown][]; destroyed: boolean } {
    const contents = {
      id: 12,
      destroyed: false,
      sent: [] as [string, unknown][],
      isDestroyed(): boolean {
        return contents.destroyed
      },
      send(channel: string, payload: unknown): void {
        contents.sent.push([channel, payload])
      },
    }
    return contents as unknown as WebContents & { sent: [string, unknown][]; destroyed: boolean }
  }

  const message: RuntimeEventMessage = {
    sessionId: 'sess_1',
    ordinal: 0,
    at: 1_700_000_000_000,
    event: { type: 'status', state: 'idle' },
  }

  it('sends on the event channel and identifies its owner', () => {
    const contents = fakeContents()
    const sink = webContentsSink(contents)

    expect(sink.ownerId).toBe(sinkOwnerId(contents))
    expect(sink.alive).toBe(true)
    sink.send(message)
    expect(contents.sent).toEqual([[RUNTIME_EVENT_CHANNEL, message]])
  })

  it('goes quiet once the window is gone instead of throwing into teardown', () => {
    const contents = fakeContents()
    const sink = webContentsSink(contents)

    contents.destroyed = true
    expect(sink.alive).toBe(false)
    sink.send(message)
    expect(contents.sent).toEqual([])
  })
})

/**
 * **The nine filters, across the wire the app actually validates** (121, review).
 *
 * ⛔ **Nothing else in the suite crosses this schema.** `session-library.test.ts` calls
 * `readLibrary` directly and every renderer test stubs `window.api`, so a key missing from — or
 * misspelled in — the `filters` object in `ipc.ts` would leave `pnpm run ci` entirely green while
 * the app silently dropped that facet: `z.object` STRIPS what it does not declare, so the host
 * would answer an unnarrowed list under a `1,063 match · Kind: Sub-agents` badge. Reported as the
 * gap it was, and closed here.
 */
describe('the library filters survive the wire (121)', () => {
  const ALL = {
    provider: 'codex' as const,
    origin: 'user-home' as const,
    kind: 'sub' as const,
    notImported: true,
    unresumable: true,
    behind: true,
    offDisk: true,
    unreadable: true,
    archived: 'only' as const,
  }

  it('every one of the nine arrives at the host, unchanged', () => {
    const parsed = runtimeCommandSchema.safeParse({ kind: 'listLibrary', filters: ALL })
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
    // ⛔ `toEqual`, not `toMatchObject`: a stripped key is exactly the defect, and `toMatchObject`
    // would pass over one.
    expect(parsed.success && parsed.data.kind === 'listLibrary' && parsed.data.filters).toEqual(ALL)
    // And the nine are nine — a tenth added to `LibraryFilters` without a schema line is caught
    // by this count rather than discovered in the app.
    expect(Object.keys(ALL)).toHaveLength(9)
  })

  it('an absent `filters` is absent, not an empty object invented at the boundary', () => {
    const parsed = runtimeCommandSchema.safeParse({ kind: 'listLibrary' })
    expect(
      parsed.success && parsed.data.kind === 'listLibrary' && parsed.data.filters,
    ).toBeUndefined()
  })

  it('refuses a value outside the closed set, and says which field', () => {
    for (const bad of [
      { provider: 'gemini' },
      { origin: 'somewhere' },
      { kind: 'grandchild' },
      { behind: 'yes' },
      { archived: true },
    ]) {
      const parsed = runtimeCommandSchema.safeParse({ kind: 'listLibrary', filters: bad })
      expect(parsed.success, `${JSON.stringify(bad)} was accepted`).toBe(false)
    }
    // The paired positive: the same shapes with legal values all pass, so the refusals above are
    // about the values and not about the schema rejecting `filters` wholesale.
    for (const good of [
      { provider: 'claude' as const },
      { origin: 'ours' as const },
      { kind: 'top' as const },
      { behind: false },
      { archived: 'left-out' as const },
    ]) {
      expect(runtimeCommandSchema.safeParse({ kind: 'listLibrary', filters: good }).success).toBe(
        true,
      )
    }
  })

  it('routes them to the host rather than dropping them on the floor', async () => {
    const asked: unknown[] = []
    const host = { listLibrary: (query: unknown) => (asked.push(query), Promise.resolve(null)) }
    await executeRuntimeCommand(host as unknown as RuntimeHost, new RecordingSink(), {
      kind: 'listLibrary',
      filters: ALL,
      query: 'refund',
    })
    // The dispatch builds its own object field by field, so a field it forgets to copy is invisible
    // to the schema test above and visible here.
    expect(asked).toEqual([
      { query: 'refund', recordId: undefined, filters: ALL, limit: undefined, offset: undefined },
    ])
  })
})
