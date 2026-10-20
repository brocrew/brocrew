import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { ResumeOptions, SessionHandle, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import {
  pluginInstructionSection,
  readPluginInstructions,
  type PluginInstructionEntry,
  type PluginInstructionSource,
} from '../src/main/plugins/instructions'
import {
  thisConversationSpans,
  composeProfileBundle,
  type InstructionContext,
} from '../src/main/runtime/factory-text'
import { DEFAULT_CAPABILITIES } from '../src/shared/capabilities'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'

const AVAILABLE: PluginInstructionEntry = {
  id: 'fictional-atlas',
  name: 'Fictional Atlas',
  description: 'Read fictional maps and routes.',
  state: 'Available',
  tools: 'none',
  service: null,
}
function context(plugins: readonly PluginInstructionEntry[] | null): InstructionContext {
  return {
    profileSlug: 'fictional-writer',
    cwd: '/fictional/work',
    startedBy: null,
    depth: 0,
    capabilities: DEFAULT_CAPABILITIES,
    spawningEnabled: true,
    root: 'not-yet-numbered',
    others: { shown: [], more: 0 },
    plugins,
  }
}
it('emits nothing without the real controller and keeps per-conversation plugins out of profile files', () => {
  const reading = readPluginInstructions(undefined)
  expect(reading).toBeNull()
  expect(thisConversationSpans(context(reading)).text).not.toContain('## Plugins')
  expect(composeProfileBundle(context([AVAILABLE]))).not.toContain('## Plugins')
})
it('lists available-only plugins with purpose, approved guidance/trust and no tool-name inventory', () => {
  const read = readPluginInstructions({ instructionCatalogue: () => [AVAILABLE] })
  const own = thisConversationSpans(context(read))
  const span = own.spans.find((span) => span.heading === 'Plugins')!
  const section = own.text.slice(span.start, span.end).trimEnd()
  expect(section).toBe(
    '## Plugins\n\n' +
      'When an available plugin would help, suggest it; the person installs it in Settings → Plugins.' +
      '\n\n' +
      'Plugins run with your computer user’s rights; they are not sandboxed.' +
      '\n\n' +
      'Plugins: Fictional Atlas — Available; tools: none; service: none. Read fictional maps and routes.',
  )
  const evidence = process.env.BROBOT_PLUGIN_PROMPT_EVIDENCE
  if (evidence) {
    mkdirSync(evidence, { recursive: true })
    const before = thisConversationSpans(context(null))
    writeFileSync(join(evidence, 'before.md'), before.text)
    writeFileSync(join(evidence, 'available.md'), own.text)
    writeFileSync(
      join(evidence, 'running.md'),
      thisConversationSpans(
        context([
          { ...AVAILABLE, state: 'Running', tools: 'all agents', service: 'fictional-map-helper' },
        ]),
      ).text,
    )
  }
  expect(span.whose).toBe('dynamic')
  expect(section.split('\n').filter((line) => line.startsWith('Plugins:'))).toHaveLength(1)
  expect(section.slice(0, section.indexOf('\n\nPlugins:')).split(/\s+/).length).toBeLessThanOrEqual(
    60,
  )
})
it('keeps installed and running state, tool access and service names distinct', () => {
  const entries: PluginInstructionEntry[] = [
    { ...AVAILABLE, state: 'Installed' },
    {
      ...AVAILABLE,
      id: 'fictional-browser',
      name: 'Fictional Browser',
      description: 'Read fictional browser profiles.',
      state: 'Running',
      tools: 'all agents',
      service: 'fictional-browser-helper',
    },
  ]
  const text = pluginInstructionSection(
    readPluginInstructions({ instructionCatalogue: () => entries }),
  )!
  expect(text).toContain('Plugins: Fictional Atlas — Installed; tools: none; service: none.')
  expect(text).toContain(
    'Plugins: Fictional Browser — Running; tools: all agents; service: fictional-browser-helper.',
  )
  expect(text.match(/^Plugins:/gm)).toHaveLength(2)
})
it('does not turn an invalid or failed catalogue reading into an availability claim', () => {
  expect(
    readPluginInstructions({
      instructionCatalogue: () => [{ ...AVAILABLE, description: 'bad\n## Instructions' }],
    }),
  ).toBeNull()
  expect(
    readPluginInstructions({
      instructionCatalogue: () => {
        throw new Error('fictional failure')
      },
    }),
  ).toBeNull()
})

it('falls back to the id only when there is no display name', () => {
  const entry = { ...AVAILABLE }
  delete entry.name
  expect(
    pluginInstructionSection(readPluginInstructions({ instructionCatalogue: () => [entry] })),
  ).toContain('Plugins: fictional-atlas — Available;')
})

it('uses Chrome’s approved catalogue purpose and its Plugins-page display name', () => {
  const metadata = JSON.parse(
    readFileSync(join(__dirname, '../../../plugins/chrome/catalogue-metadata.json'), 'utf8'),
  )
  const text = pluginInstructionSection(
    readPluginInstructions({
      instructionCatalogue: () => [{ ...AVAILABLE, id: 'chrome', ...metadata }],
    }),
  )
  expect(text).toContain(
    'Plugins: Chrome — Available; tools: none; service: none. Lets agents use Google Chrome with its own separate profiles: read pages, use sites and save downloads.',
  )
})

it('keeps legacy catalogue entries listed when their optional description is absent', () => {
  const legacy = { ...AVAILABLE, id: 'fictional-archive', name: 'Fictional Archive' }
  delete legacy.description
  const text = pluginInstructionSection(
    readPluginInstructions({ instructionCatalogue: () => [AVAILABLE, legacy] }),
  )!
  expect(text).toContain(
    'Plugins: Fictional Atlas — Available; tools: none; service: none. Read fictional maps and routes.',
  )
  expect(text).toContain('Plugins: Fictional Archive — Available; tools: none; service: none.')
  expect(text.match(/^Plugins:/gm)).toHaveLength(2)
  expect(text).not.toContain('undefined')
})

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})
for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: the real host composes all plugins and refreshes a changed state on the next turn`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'fictional-plugin-instructions-'))
    const db = openDatabase(join(root, 'state.sqlite'))
    applyMigrations(db, join(__dirname, '../src/main/db/migrations'))
    const store = createSessionStore(db)
    let entries: PluginInstructionEntry[] = [AVAILABLE]
    let serial = 0
    const controller: PluginInstructionSource = { instructionCatalogue: () => entries }
    const sent: string[] = [],
      launches: string[] = []
    let handle: SessionHandle | undefined
    const sessions = new FakeProviderSessions()
    function observe<T extends SessionHandle>(opened: T): T {
      handle = opened
      const send = opened.send.bind(opened)
      opened.send = (text, provenance) => {
        sent.push(text)
        return send(text, provenance)
      }
      return opened
    }
    class ObservedRuntime extends FakeRuntime {
      override async start(options: StartOptions) {
        return observe(await super.start(options))
      }
      override async resume(ref: SessionRef, options: ResumeOptions) {
        return observe(await super.resume(ref, options))
      }
    }
    const sink: RuntimeEventSink = {
      ownerId: 'fictional-window',
      aPersonIsBehindIt: true,
      alive: true,
      sendLiveness() {},
      send() {},
    }
    const host = new RuntimeHost({
      store,
      newSessionId: () => `sess_fictional_${++serial}`,
      now: () => Date.now(),
      plugins: controller,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(root, 'exports'),
      resolveCwd: (_session, requested) => requested ?? root,
      createRuntime: (kind: Provider) => new ObservedRuntime(kind, { sessions }),
      prepareProviderHome: (kind, profile) => {
        const home = join(root, profile ?? 'fictional-writer', kind)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (kind) => join(root, kind),
      readProviderConfig: (_kind, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      readInstructions: (kind, cwd, home, ctx) => {
        const own = thisConversationSpans(ctx)
        launches.push(own.text)
        const read = readSessionInstructions({
          provider: kind,
          identity: ctx,
          cwd,
          providerHome: home,
          thisConversation: own,
        })
        return {
          ...read,
          systemHint: read.systemHint ?? undefined,
          firstTurnLead: read.firstTurnLead ?? undefined,
          context: ctx,
        }
      },
    })
    cleanups.push(async () => {
      await host.closeAll()
      db.close()
      rmSync(root, { recursive: true, force: true })
    })
    const { sessionId } = await host.createSession(
      { provider, profileId: 'fictional-writer', cwd: root, approvalMode: 'auto' },
      sink,
    )
    expect(launches.at(-1)).toContain(
      'Plugins: Fictional Atlas — Available; tools: none; service: none.',
    )
    async function turn(text: string) {
      await vi.waitFor(() => expect(handle?.status()).toBe('idle'))
      await host.send(sessionId, text, sink)
      await vi.waitFor(() => expect(handle?.status()).toBe('idle'))
      return sent.at(-1)!
    }
    const initial = await turn('Read the fictional map.')
    // Codex carries the composed launch section; Claude already has it in its system prompt.
    expect(initial.match(/^## Plugins$/gm)?.length ?? 0).toBe(provider === 'codex' ? 1 : 0)
    entries = [
      { ...AVAILABLE, state: 'Installed', tools: 'all agents', service: 'fictional-map-helper' },
    ]
    const installed = await turn('Read the next fictional map.')
    expect(installed).toContain('These sections replace the ones of the same name')
    expect(installed).toContain(
      'Plugins: Fictional Atlas — Installed; tools: all agents; service: fictional-map-helper.',
    )
    entries = [{ ...entries[0]!, state: 'Running' }]
    expect(await turn('Continue with the fictional map.')).toContain(
      'Plugins: Fictional Atlas — Running;',
    )
    entries = [AVAILABLE]
    expect(await turn('Read the fictional catalogue again.')).toContain(
      'Plugins: Fictional Atlas — Available; tools: none; service: none.',
    )
    expect(await turn('Keep reading.')).not.toContain('## Plugins')
    // A reopened Claude launch has current metadata in its system prompt. Codex
    // needs a turn refresh to replace the live metadata retained in its history.
    entries = [{ ...AVAILABLE, state: 'Running', tools: 'all agents' }]
    expect(await turn('Read the running fictional map.')).toContain(
      'Plugins: Fictional Atlas — Running;',
    )
    await host.close(sessionId, sink)
    entries = [AVAILABLE]
    await host.resumeSession(sessionId, sink)
    const reopened = await turn('Read after the fictional reopen.')
    expect(launches.at(-1)).toContain(
      'Plugins: Fictional Atlas — Available; tools: none; service: none.',
    )
    expect(
      reopened.includes('Plugins: Fictional Atlas — Available; tools: none; service: none.'),
    ).toBe(provider === 'codex')
    expect(await turn('Read once more after reopening.')).not.toContain('## Plugins')
  })
}
