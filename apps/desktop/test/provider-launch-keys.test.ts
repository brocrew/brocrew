import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { LaunchSetting, SessionHandle } from '@brobot2/runtime'
import { CLAUDE_LAUNCH_SETTING_KEYS } from '@brobot2/runtime/claude'
import { CODEX_LAUNCH_SETTING_KEYS } from '@brobot2/runtime/codex'
import { providerKnowledge } from '../src/main/providers'
import { aLaunchRecordIn } from '../src/main/runtime/what-this-agent-was-given'
import { F093World } from './lib/f093-host'

const legacyKeys = [
  'settings-sources',
  'memory-folder',
  'built-in-tools',
  'denied-tools',
  'mode',
  'connectors',
  'attribution',
  'memory',
  'thread-overrides',
  'plan-tool',
  'approval-sandbox',
  'collaboration-mode',
  'approval',
  'tools-off',
  'tools-left-on',
] as const

const originalGiven = providerKnowledge.claude.instructions.given
let world: F093World | undefined

afterEach(async () => {
  await world?.dispose()
  world = undefined
  Object.defineProperty(providerKnowledge.claude.instructions, 'given', {
    value: originalGiven,
    configurable: true,
  })
  vi.restoreAllMocks()
})

function registerFern(): void {
  const given = {
    ...originalGiven,
    planningKey: 'fern-plan',
    keys: ['fern-plan', 'fern-files'],
    launchSettingKeys() {
      return this.keys
    },
  }
  Object.defineProperty(providerKnowledge.claude.instructions, 'given', {
    value: given,
    configurable: true,
  })
}

describe('registered launch keys across live and kept records', () => {
  it('carries fictional provider keys from its handle through the ledger into the real read model', async () => {
    registerFern()
    world = new F093World()
    const take = world.end.take.bind(world.end)
    const settings = [
      { key: 'fern-files', value: ['fern.ini'] },
      { key: 'fern-plan', value: 'default' },
    ]
    vi.spyOn(world.end, 'take').mockImplementation((provider, handle, options) => {
      take(provider, handle, options)
      Object.defineProperty(handle, 'launchSettings', { value: settings })
    })
    const host = world.buildHost()
    const session = await world.open(host, 'claude', 'fern')
    const live = (await host.whatThisAgentWasGiven(session)).launchSettings
    expect(live?.settings).toEqual([
      { key: 'fern-files', atLaunch: ['fern.ini'] },
      { key: 'fern-plan', atLaunch: 'default', now: null },
    ])
    expect(world.launchesOf(session).at(-1)?.given?.settings).toEqual(settings)
    await host.closeAll()
    expect((await world.buildHost().whatThisAgentWasGiven(session)).launchSettings).toEqual(live)
    expect(settings).toEqual([
      { key: 'fern-files', value: ['fern.ini'] },
      { key: 'fern-plan', value: 'default' },
    ])
  })

  it('retains every legacy key under either selected provider and with no declaration', () => {
    const settings = legacyKeys.map((key) => ({ key, value: null }))
    for (const provider of [undefined, 'claude', 'codex'] as const) {
      expect(aLaunchRecordIn({ placement: 'system-prompt', settings }, provider)?.settings).toEqual(
        settings,
      )
    }
    registerFern()
    expect(aLaunchRecordIn({ placement: 'system-prompt', settings }, 'claude')?.settings).toEqual(
      settings,
    )
  })

  it('accepts only selected declarations and preserves bounds, order, nulls and absence', () => {
    registerFern()
    const settings = [
      { key: 'fern-files', value: null },
      { key: 'unregistered', value: true },
      { key: 'fern-files', value: [7] },
      { key: 'fern-plan', value: 'x'.repeat(1024 * 1024 + 1) },
      { key: 'fern-files', value: Array.from({ length: 201 }, () => 'x') },
      { key: 'approval', value: 'ask' },
      { key: 'fern-plan', value: false },
    ]
    const stored = { placement: 'system-prompt', settings }
    expect(aLaunchRecordIn(stored, 'claude')?.settings).toEqual([
      settings[0],
      settings[5],
      settings[6],
    ])
    expect(aLaunchRecordIn(stored, 'codex')?.settings).toEqual([settings[5]])
    expect(aLaunchRecordIn(stored)?.settings).toEqual([settings[5]])
    expect(aLaunchRecordIn({ placement: 'system-prompt' })?.settings).toBeUndefined()
    expect(
      aLaunchRecordIn({ placement: 'system-prompt', settings: null })?.settings,
    ).toBeUndefined()
    expect(
      aLaunchRecordIn(
        {
          placement: 'system-prompt',
          settings: [...settings.slice(0, 1), ...Array.from({ length: 45 }, () => settings[5])],
        },
        'claude',
      )?.settings,
    ).toHaveLength(40)
  })

  it('keeps native key values while default and explicitly supplied key types stay portable', () => {
    expect(CLAUDE_LAUNCH_SETTING_KEYS).toEqual(legacyKeys.slice(0, 7))
    expect(CODEX_LAUNCH_SETTING_KEYS).toEqual(legacyKeys.slice(7, 12))
    expectTypeOf<LaunchSetting['key']>().toEqualTypeOf<string>()
    expectTypeOf<LaunchSetting<'fern-plan' | 'fern-files'>['key']>().toEqualTypeOf<
      'fern-plan' | 'fern-files'
    >()
    expectTypeOf<
      NonNullable<SessionHandle['launchSettings']>[number]['key']
    >().toEqualTypeOf<string>()
  })
})
