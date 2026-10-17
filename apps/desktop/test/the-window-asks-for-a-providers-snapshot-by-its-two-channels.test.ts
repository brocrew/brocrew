import { beforeAll, describe, expect, it, vi } from 'vitest'
// ⚑ `vi.mock` is hoisted above these, so the module reads the stand-in `ipcMain`.
import {
  SNAPSHOT_FILES,
  snapshotCatalogue,
  snapshotFor,
  startProviderSnapshots,
} from '../src/main/provider-snapshots'
import { PROVIDER_SNAPSHOTS_CHANNELS } from '../src/shared/provider-snapshots'

/**
 * # 🔴 F093 · R3 — the window asks for a provider's snapshot by two channels, and what it may send
 *
 * ⚑ `startProviderSnapshots` registers `provider-snapshots:list` and `provider-snapshots:for-model` on
 * `ipcMain`. ⚑ **Electron's `ipcMain` is stood in for here** (the handlers it is given are kept), so
 * each channel is called as the window's `invoke` would call it — with whatever a page sends, typed
 * `unknown` on arrival.
 *
 * ⛔ A refusal is read beside an answer from the same channel.
 */

type Handler = (event: unknown, ...args: unknown[]) => unknown

const handlers = vi.hoisted(() => new Map<string, Handler>())

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler): void => {
      handlers.set(channel, handler)
    },
  },
}))

const ask = (channel: string, ...args: unknown[]): unknown => {
  const handler = handlers.get(channel)
  if (handler === undefined) throw new Error(`no handler on ${channel}`)
  return handler({ sender: null }, ...args)
}

describe('F093 · R3 · the window’s two channels', () => {
  beforeAll(() => {
    startProviderSnapshots()
  })

  it('⚑ exactly the two channels, by their shared names', () => {
    expect([...handlers.keys()].sort()).toEqual(
      [PROVIDER_SNAPSHOTS_CHANNELS.list, PROVIDER_SNAPSHOTS_CHANNELS.forModel].sort(),
    )
    expect(PROVIDER_SNAPSHOTS_CHANNELS).toEqual({
      list: 'provider-snapshots:list',
      forModel: 'provider-snapshots:for-model',
    })
  })

  it('⚑ the list is what this build carries, claude then codex', () => {
    const listed = ask(PROVIDER_SNAPSHOTS_CHANNELS.list)
    expect(listed).toEqual(snapshotCatalogue())
    expect((listed as { provider: string }[]).map((one) => one.provider)).toEqual([
      'claude',
      'codex',
    ])
  })

  it('🔴 a provider and a model: the snapshot `snapshotFor` gives, for both providers', () => {
    expect(ask(PROVIDER_SNAPSHOTS_CHANNELS.forModel, 'claude', 'opus')).toEqual(
      snapshotFor('claude', 'opus'),
    )
    expect(ask(PROVIDER_SNAPSHOTS_CHANNELS.forModel, 'codex', 'gpt-5.5')).toEqual(
      snapshotFor('codex', 'gpt-5.5'),
    )
    const answer = ask(PROVIDER_SNAPSHOTS_CHANNELS.forModel, 'claude', 'opus') as {
      found: boolean
      snapshot?: { model: string }
    }
    expect(answer.found).toBe(true)
    expect(answer.snapshot?.model).toBe('opus')
  })

  it('🔴 no model, an empty one, or one that is not words: the provider’s default', () => {
    for (const model of [undefined, null, '', 42, { model: 'opus' }, ['opus']]) {
      const answer = ask(PROVIDER_SNAPSHOTS_CHANNELS.forModel, 'codex', model) as {
        found: boolean
        snapshot?: { model: string }
      }
      expect(answer.found, JSON.stringify(model)).toBe(true)
      expect(answer.snapshot?.model, JSON.stringify(model)).toBe(SNAPSHOT_FILES.codex.defaultModel)
    }
    // ⚑ The control: a model named in words is that model, not the default.
    const named = ask(PROVIDER_SNAPSHOTS_CHANNELS.forModel, 'codex', 'gpt-5.5') as {
      snapshot?: { model: string }
    }
    expect(named.snapshot?.model).toBe('gpt-5.5')
    expect(named.snapshot?.model).not.toBe(SNAPSHOT_FILES.codex.defaultModel)
  })

  it('⛔ a provider that is neither: refused in plain words, with no models — never one of the two', () => {
    for (const provider of ['gemini', 'Claude', '', undefined, null, 7, { provider: 'claude' }]) {
      expect(
        ask(PROVIDER_SNAPSHOTS_CHANNELS.forModel, provider, 'opus'),
        JSON.stringify(provider),
      ).toEqual({ found: false, why: 'A provider is claude or codex.', models: [] })
    }
  })

  it('⛔ a model of the other provider is said not captured, by that provider’s label', () => {
    expect(ask(PROVIDER_SNAPSHOTS_CHANNELS.forModel, 'codex', 'opus')).toEqual({
      found: false,
      why: `opus was not captured ${SNAPSHOT_FILES.codex.label}.`,
      models: Object.keys(SNAPSHOT_FILES.codex.models),
    })
  })
})
