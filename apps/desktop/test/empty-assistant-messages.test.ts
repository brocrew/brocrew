import { describe, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeRuntime } from '@brobot2/runtime'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { transcripts as codexTranscripts } from '../src/main/providers/codex/transcripts'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import { visibleItems } from '../src/renderer/src/lib/transcript-mode'
import { panelWords } from '../src/renderer/src/lib/latest-words'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

function fold(events: TranscriptEvent[]) {
  const state = createTranscript()
  events.forEach((event, ordinal) => applyEvent(state, event, 1000 + ordinal, ordinal))
  return state
}
const empty: TranscriptEvent = { type: 'assistant_message', text: '', phase: 'final' }
const legacy: Extract<TranscriptEvent, { type: 'unknown' }> = {
  type: 'unknown',
  provider: 'codex',
  category: 'unrecognized',
  label: 'agentMessage',
  raw: {
    type: 'agentMessage',
    id: 'fictional',
    text: '',
    phase: 'final_answer',
    memoryCitation: null,
    delivery: null,
    questions: null,
  },
}

describe('empty authoritative assistant messages', () => {
  it.each(['normal', 'debug'] as const)(
    'settles streamed text without a blank answer or final pair in %s',
    (mode) => {
      const state = fold([
        { type: 'user_turn', text: 'Fictional question', humanInitiated: true },
        { type: 'assistant_delta', text: 'Unconfirmed progress' },
        empty,
        { type: 'turn', state: 'completed' },
      ])
      expect(visibleItems(mode, state.items).filter((item) => item.kind === 'assistant')).toEqual(
        [],
      )
      expect(state.streamingId).toBeNull()
      expect(state.humanAnswers.latest?.final).toBeNull()
      expect(panelWords(state)).toBeNull()
    },
  )

  it('keeps the genuine final exactly once after another empty or whitespace final', () => {
    const state = fold([
      { type: 'user_turn', text: 'Fictional question', humanInitiated: true },
      { type: 'assistant_message', text: 'Actual answer', phase: 'final' },
      empty,
      { type: 'assistant_message', text: '\n\t ', phase: 'final' },
      { type: 'turn', state: 'completed' },
    ])
    expect(
      visibleItems('normal', state.items)
        .filter((item) => item.kind === 'assistant')
        .map((item) => item.text),
    ).toEqual(['Actual answer'])
    expect(state.items.filter((item) => item.kind === 'assistant' && item.humanFinal)).toHaveLength(
      1,
    )
    expect(panelWords(state)?.text).toBe('Actual answer')
  })

  it('drops provisional delta prose after a tool boundary when the authoritative message is empty', () => {
    const state = fold([
      { type: 'user_turn', text: 'Question', humanInitiated: true },
      { type: 'assistant_delta', text: 'Unconfirmed progress' },
      { type: 'tool_call', id: 'fictional-tool', name: 'fictional', summary: 'Fictional work' },
      empty,
      { type: 'turn', state: 'completed' },
    ])
    expect(visibleItems('normal', state.items).filter((item) => item.kind === 'assistant')).toEqual(
      [],
    )
    expect(state.items.some((item) => item.kind === 'tool')).toBe(true)
    expect(state.provisionalId).toBeNull()
    expect(state.humanAnswers.latest?.final).toBeNull()
  })

  it('keeps latestWords fallback after a newer human empty final without selecting the older pair', () => {
    const state = fold([
      { type: 'user_turn', text: 'Earlier question', humanInitiated: true },
      { type: 'assistant_message', text: 'Earlier answer', phase: 'final' },
      { type: 'turn', state: 'completed' },
      { type: 'user_turn', text: 'New question', humanInitiated: true },
      empty,
      { type: 'turn', state: 'completed' },
    ])
    expect(state.humanAnswers.latest).toMatchObject({ prompt: 'New question', final: null })
    expect(panelWords(state)?.text).toBe('Earlier answer')
    expect(
      visibleItems('normal', state.items).filter((item) => item.kind === 'assistant'),
    ).toHaveLength(1)
  })

  it('retains structured-only questions and memory recall without creating a human final', () => {
    const state = fold([
      { type: 'user_turn', text: 'Question', humanInitiated: true },
      {
        type: 'assistant_message',
        text: '',
        questions: [{ title: 'Bread or cake?' }],
        phase: 'final',
      },
      { type: 'memory_recall', entries: [{ path: 'fictional.md' }], source: 'memoryCitation' },
    ])
    expect(
      visibleItems('normal', state.items).some(
        (item) => item.kind === 'assistant' && item.questions?.[0]?.title === 'Bread or cake?',
      ),
    ).toBe(true)
    expect(state.humanAnswers.latest?.final).toBeNull()
    expect(state.items.some((item) => item.kind === 'memoryRecall')).toBe(true)
  })

  it('projects legacy diagnostics in bounded history windows without rewriting stored events', () => {
    const db = openDatabase(':memory:')
    try {
      applyMigrations(db, fileURLToPath(new URL('../src/main/db/migrations', import.meta.url)))
      const store = createSessionStore(db)
      store.create({
        id: 'fictional-history',
        provider: 'codex',
        cwd: '/fictional',
        profileId: 'default',
        approvalMode: 'ask',
      })
      store.append(
        'fictional-history',
        0,
        { type: 'user_turn', text: 'A fictional question' },
        1000,
      )
      store.append('fictional-history', 1, legacy, 1001)
      const future = { ...legacy, provider: 'fictional-future-provider' }
      store.append('fictional-history', 2, future, 1002)
      const before = store.events('fictional-history')
      const host = new RuntimeHost({
        store,
        discoverSessions: NO_DISCOVERY,
        nativeTranscriptPath: () => null,
        exportDirectory: () => '/fictional/exports',
        createRuntime: (provider) => new FakeRuntime(provider),
        prepareProviderHome: () => '/fictional/provider',
        providerHomePath: () => '/fictional/provider',
        resolveCwd: () => '/fictional',
        newSessionId: () => 'fictional-unused',
        readProviderConfig: (_provider, home) => ({
          home,
          homeEnv: 'FICTIONAL',
          model: 'fictional',
          authNote: null,
          files: [],
        }),
      })
      for (const page of [
        host.latestHistory('fictional-history'),
        host.earlierHistory('fictional-history', 3),
      ]) {
        expect(page.entries.find((entry) => entry.event.type === 'unknown')?.event).toEqual({
          ...legacy,
          category: 'activity',
        })
        expect(page.entries).toHaveLength(3)
        expect(page.entries[2]!.event).toEqual(future)
      }
      expect(store.events('fictional-history')).toEqual(before)
      expect(before.find((entry) => entry.event.type === 'unknown')?.event).toEqual(legacy)
    } finally {
      db.close()
    }
  })

  it('quiets only the old plain-empty Codex diagnostic and preserves its original raw data', () => {
    const before = JSON.stringify(legacy)
    const projected = codexTranscripts.eventForDisplay?.(legacy) ?? legacy
    expect(projected).toEqual({ ...legacy, category: 'activity' })
    const state = fold([projected])
    expect(state.items.find((item) => item.kind === 'unknown')).toMatchObject({
      category: 'activity',
      raw: legacy.raw,
    })
    expect(visibleItems('normal', state.items)).toEqual([])
    expect(visibleItems('debug', state.items)).toEqual([])
    expect(JSON.stringify(legacy)).toBe(before)
    expect(state.humanAnswers.latest).toBeNull()
  })

  it.each([
    { ...legacy, provider: 'claude' as const },
    { ...legacy, provider: 'fictional-future-provider' },
    { ...legacy, raw: { type: 'agentMessage' } },
    { ...legacy, raw: { type: 'agentMessage', text: null } },
    { ...legacy, raw: { type: 'agentMessage', text: 'Actual words' } },
    { ...legacy, raw: { type: 'futureMessage', text: '' } },
    {
      ...legacy,
      raw: { type: 'agentMessage', text: '', questions: [{ title: 'Unparsed old question' }] },
    },
    {
      ...legacy,
      raw: { type: 'agentMessage', text: '', memoryCitation: { entries: [{ path: 'old.md' }] } },
    },
  ])('keeps other unknown payloads inspectable and prominent: %j', (event) => {
    const projected = codexTranscripts.eventForDisplay?.(event) ?? event
    expect(projected).toEqual(event)
    const state = fold([projected])
    expect(visibleItems('normal', state.items)).toHaveLength(1)
    expect(state.items[0]).toMatchObject({
      kind: 'unknown',
      category: 'unrecognized',
      raw: event.raw,
    })
  })
})

class ProjectionRuntime extends FakeRuntime {
  handle: Awaited<ReturnType<FakeRuntime['start']>> | null = null

  override async start(options: Parameters<FakeRuntime['start']>[0]) {
    this.handle = await super.start(options)
    const source = this.handle.events()
    vi.spyOn(this.handle, 'events').mockImplementation(async function* () {
      for await (const event of source) {
        yield event.type === 'unknown' ? { ...event, label: 'agentMessage' } : event
      }
    })
    return this.handle
  }
}

async function projectionHost(
  run: (
    host: RuntimeHost,
    runtime: ProjectionRuntime,
    store: ReturnType<typeof createSessionStore>,
    sink: RuntimeEventSink,
    sent: RuntimeEventMessage[],
  ) => Promise<void>,
) {
  const directory = mkdtempSync(join(tmpdir(), 'fictional-display-rows-'))
  const db = openDatabase(join(directory, 'fictional.sqlite'))
  applyMigrations(db, fileURLToPath(new URL('../src/main/db/migrations', import.meta.url)))
  const store = createSessionStore(db)
  const runtime = new ProjectionRuntime('codex')
  const sent: RuntimeEventMessage[] = []
  const sink: RuntimeEventSink = {
    ownerId: 'fictional-window',
    aPersonIsBehindIt: true,
    alive: true,
    send: (message) => {
      sent.push(message)
    },
    sendLiveness: () => {},
  }
  const host = new RuntimeHost({
    store,
    discoverSessions: NO_DISCOVERY,
    nativeTranscriptPath: () => null,
    exportDirectory: () => directory,
    createRuntime: () => runtime,
    prepareProviderHome: () => directory,
    providerHomePath: () => directory,
    resolveCwd: () => directory,
    newSessionId: () => 'fictional-display',
    readProviderConfig: () => ({
      home: directory,
      homeEnv: 'FICTIONAL',
      model: 'fictional',
      authNote: null,
      files: [],
    }),
  })
  try {
    await run(host, runtime, store, sink, sent)
  } finally {
    await host.closeAll()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

function projectedRowsAreExact(
  stored: ReturnType<ReturnType<typeof createSessionStore>['events']>,
  sent: RuntimeEventMessage[],
) {
  const rows = stored.filter((row) => row.event.type === 'unknown')
  const shown = sent.filter((row) => row.event.type === 'unknown')
  expect(shown).toHaveLength(rows.length)
  for (const row of rows) {
    const display = codexTranscripts.eventForDisplay?.(row.event) ?? row.event
    expect(shown.find((message) => message.ordinal === row.ordinal)).toEqual({
      sessionId: 'fictional-display',
      ...row,
      event: display,
    })
  }
  expect(rows[0]?.event).toMatchObject({ category: 'unrecognized', raw: legacy.raw })
  expect(shown[0]?.event).toMatchObject({ category: 'activity', raw: legacy.raw })
}

describe('provider display projection at the host send doors', () => {
  it('projects every live provider row without changing its stored row or ordinal', async () => {
    await projectionHost(async (host, runtime, store, sink, sent) => {
      await host.createSession({ provider: 'codex' }, sink)
      const handle = runtime.handle
      if (handle === null) throw new Error('the fake provider did not start')
      handle.simulateUnknown(legacy.raw)
      handle.simulateUnknown({ type: 'agentMessage', text: null })
      handle.simulateUnknown({
        type: 'agentMessage',
        text: '',
        questions: [{ title: 'Fictional choice' }],
      })
      handle.simulateUnknown(legacy.raw, 'activity')
      await expect.poll(() => sent.filter((row) => row.event.type === 'unknown').length).toBe(4)
      projectedRowsAreExact(store.events('fictional-display'), sent)
    })
  })

  it('projects every idle ledger row for the real looking window without changing storage or ordinals', async () => {
    await projectionHost(async (host, _runtime, store, sink, sent) => {
      store.create({
        id: 'fictional-display',
        provider: 'codex',
        cwd: '/fictional',
        profileId: 'default',
        approvalMode: 'ask',
      })
      await host.look('fictional-display', sink, false)
      // The generic idle writer is private; exercise its actual production door against the real store and registered sink.
      const write: unknown = Reflect.get(host, 'writeWhileNothingRunsIt')
      if (typeof write !== 'function') throw new Error('the idle ledger writer is missing')
      const events: TranscriptEvent[] = [
        legacy,
        { ...legacy, raw: { type: 'agentMessage', text: null } },
        {
          ...legacy,
          raw: { type: 'agentMessage', text: '', questions: [{ title: 'Fictional choice' }] },
        },
        { ...legacy, category: 'activity' },
        { ...legacy, provider: 'fictional-future-provider' },
      ]
      for (const event of events)
        expect(Reflect.apply(write, host, ['fictional-display', event])).toBe(true)
      projectedRowsAreExact(store.events('fictional-display'), sent)
      expect(sent[3]?.event).toBe(events[3])
      expect(store.events('fictional-display').map((row) => row.event)).toEqual(events)
      expect(sent.map((row) => row.ordinal)).toEqual(
        store.events('fictional-display').map((row) => row.ordinal),
      )
    })
  })

  it('keeps the provider projection idempotent with bounded per-row work', () => {
    const project = codexTranscripts.eventForDisplay
    if (project === undefined) throw new Error('the provider projection is missing')
    const projected = project(legacy)
    expect(project(projected)).toBe(projected)
    expect(projected).toEqual({ ...legacy, category: 'activity' })
    const count = 100_000
    const measurements: Record<string, number> = {}
    for (const [name, event] of [
      ['small', legacy],
      [
        'large-unused-field',
        { ...legacy, raw: { type: 'agentMessage', text: '', unused: 'x'.repeat(1_048_576) } },
      ],
      ['already-projected', projected],
    ] as const) {
      const start = performance.now()
      let observed = 0
      for (let index = 0; index < count; index++) {
        const result = project(event)
        if (result.type === 'unknown' && result.category === 'activity') observed++
      }
      measurements[name] = performance.now() - start
      expect(observed).toBe(count)
    }
    console.log(
      JSON.stringify({
        microcheck: 'provider-display-projection',
        count,
        milliseconds: measurements,
        rawPayloadTraversal: false,
      }),
    )
    expect(legacy.category).toBe('unrecognized')
  })
})
