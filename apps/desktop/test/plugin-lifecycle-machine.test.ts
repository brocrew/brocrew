import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  ActivationSnapshot,
  JournalRecord,
  PluginStateError,
  decodeState,
  encodeState,
  type OperationRequest,
  type Operation,
} from '../src/main/plugins/state/format'
import {
  admitOperation,
  decodeStateFile,
  encodeStateFile,
  keepLatestPerPlugin,
  newLifecycle,
  planOperation,
  resolveOperation,
  type LifecycleState,
} from '../src/main/plugins/state/machine'

function fixture() {
  const state = newLifecycle(randomUUID(), randomUUID())
  const release = (version: string, digit = 'a') => ({
    version,
    archiveSha256: digit.repeat(64),
    manifestSha256: 'b'.repeat(64),
    dataSchema: 1,
  })
  const request = (
    action: 'install' | 'update' | 'uninstall',
    version = '1.0.0',
    digit = 'a',
  ): OperationRequest => ({
    operationId: randomUUID(),
    consent: {
      action,
      pluginId: 'fictional-bakery',
      at: 1000,
      expectedSequence: state.sequence,
      expectedInstallId: state.guards.get('fictional-bakery')?.installId ?? null,
      release: action === 'uninstall' ? null : release(version, digit),
    },
    snapshot: null,
  })
  const allocated = (): Operation['allocated'] => ({
    installId: randomUUID(),
    incarnation: randomUUID(),
    epoch: randomUUID(),
  })
  /** One operation, as the store writes it: prepared, then resolved, one sequence each. */
  function run(one: OperationRequest, success = true) {
    admitOperation(state, planOperation(state, one, allocated()))
    keepLatestPerPlugin(state)
    state.sequence++
    resolveOperation(state, success)
    state.sequence++
  }
  return { state, request, allocated, run }
}

describe('portable plugin lifecycle data', () => {
  it('admits a completed install, and an aborted one leaves the plugin removed', () => {
    const { state, request, allocated, run } = fixture()
    admitOperation(state, planOperation(state, request('install'), allocated()))
    expect(state.guards.get('fictional-bakery')?.phase).toBe('prepared')
    expect(state.admitted.size).toBe(0)
    resolveOperation(state, true)
    expect(state.guards.get('fictional-bakery')?.phase).toBe('active')
    expect([...state.admitted.keys()]).toEqual(['fictional-bakery'])
    state.sequence++
    run(request('update', '1.0.1'), false)
    expect(state.guards.get('fictional-bakery')?.phase).toBe('removed')
    expect(state.admitted.size).toBe(0)
  })
  it('refuses stale consent and interleaved operations', () => {
    const { state, request, allocated } = fixture()
    const stale = request('install')
    stale.consent.expectedSequence = 99
    expect(() => planOperation(state, stale, allocated())).toThrow(PluginStateError)
    admitOperation(state, planOperation(state, request('install'), allocated()))
    expect(() => planOperation(state, request('install'), allocated())).toThrow(
      expect.objectContaining({ code: 'busy' }),
    )
  })
  it('keeps only the latest operation of each plugin, and of a global restore', () => {
    const { state, request, run } = fixture()
    const install = request('install')
    run(install)
    const update = request('update', '1.0.1')
    run(update)
    expect([...state.operations.keys()]).toEqual([update.operationId])
    const removal = request('uninstall')
    run(removal)
    expect([...state.operations.keys()]).toEqual([removal.operationId])
    expect(state.guards.get('fictional-bakery')?.phase).toBe('removed')
  })
  it('refuses new bytes for an installed version after its operation is no longer kept', () => {
    const { state, request, allocated, run } = fixture()
    run(request('install', '1.0.0', 'a'))
    run(request('uninstall'))
    // The install's own operation is gone; the removed plugin's entry still pins its release.
    expect(() => planOperation(state, request('install', '1.0.0', 'c'), allocated())).toThrow(
      expect.objectContaining({ code: 'conflict' }),
    )
    expect(() => planOperation(state, request('install', '1.0.0', 'a'), allocated())).not.toThrow()
  })
  it('the state file round-trips and refuses unknown fields, duplicate keys and other formats', () => {
    const { state, request, run } = fixture()
    run(request('install'))
    const bytes = encodeStateFile(state)
    const read: LifecycleState = decodeStateFile(bytes)
    expect(read).toEqual(state)
    const file = JSON.parse(bytes.toString())
    for (const bad of [
      JSON.stringify({ ...file, unexpected: true }),
      JSON.stringify({ ...file, format: 1 }),
      bytes.toString().replace('{', '{"format":2,'),
      bytes.toString().slice(0, -1),
    ])
      expect(() => decodeStateFile(Buffer.from(bad))).toThrow(PluginStateError)
  })
  it('bounds the state file instead of writing past its limit', () => {
    const { state } = fixture()
    state.rootId = 'x'.repeat(4 * 1024 * 1024)
    expect(() => encodeStateFile(state)).toThrow(expect.objectContaining({ code: 'limit' }))
  })
  it('checksum envelopes reject corruption, unknown fields and duplicate JSON keys', () => {
    const snapshot = { format: 1 as const, rootId: randomUUID(), epoch: randomUUID(), entries: [] }
    const bytes = encodeState(snapshot)
    expect(decodeState(bytes, ActivationSnapshot)).toEqual(snapshot)
    expect(() =>
      decodeState(Buffer.from(bytes.toString().replace('entries', 'unknown')), ActivationSnapshot),
    ).toThrow(PluginStateError)
    expect(() =>
      decodeState(encodeState({ ...snapshot, unexpected: true }), ActivationSnapshot),
    ).toThrow(PluginStateError)
    expect(() =>
      decodeState(Buffer.from('{"payload":"a","payload":"b","sha256":"x"}'), ActivationSnapshot),
    ).toThrow(PluginStateError)
    expect(() => decodeState(bytes, JournalRecord)).toThrow(PluginStateError)
    expect(() => encodeState({ fictional: 'x'.repeat(128 * 1024) })).toThrow(
      expect.objectContaining({ code: 'limit' }),
    )
  })
})
