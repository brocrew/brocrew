import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import {
  ActivationSnapshot,
  JournalRecord,
  PluginStateError,
  decodeState,
  encodeState,
  type Event,
  type JournalRecord as Record,
  type OperationRequest,
  type Operation,
} from '../src/main/plugins/state/format'
import {
  foldRecord,
  newLifecycle,
  planOperation,
  resolvedSnapshot,
  snapshotReference,
} from '../src/main/plugins/state/machine'

function fixture() {
  const state = newLifecycle()
  function append(event: Event) {
    const record: Record = {
      sequence: state.sequence + 1,
      previous: state.head,
      publicationId: randomUUID(),
      event,
    }
    foldRecord(state, record, pluginSha256(encodeState(record)))
    return record
  }
  append({ kind: 'created', rootId: randomUUID(), epoch: randomUUID() })
  const request: OperationRequest = {
    operationId: randomUUID(),
    consent: {
      action: 'install',
      pluginId: 'fictional-bakery',
      at: 1000,
      expectedSequence: 0,
      expectedInstallId: null,
      release: {
        version: '1.0.0',
        archiveSha256: 'a'.repeat(64),
        manifestSha256: 'b'.repeat(64),
        dataSchema: 1,
      },
    },
    snapshot: null,
  }
  const allocated = (): Operation['allocated'] => ({
    installId: randomUUID(),
    incarnation: randomUUID(),
    epoch: randomUUID(),
  })
  return { state, append, request, allocated }
}

describe('portable plugin lifecycle and receipt data', () => {
  it('cannot activate a prepared record without the exact matching activation reference', () => {
    const { state, append, request, allocated } = fixture()
    append({ kind: 'prepared', operation: planOperation(state, request, allocated()) })
    expect(state.guards.get('fictional-bakery')?.phase).toBe('prepared')
    const activation = snapshotReference(resolvedSnapshot(state, true), state.sequence + 1)
    expect(() =>
      append({
        kind: 'completed',
        operationId: request.operationId,
        activation: { ...activation, sha256: 'c'.repeat(64) },
      }),
    ).toThrow(PluginStateError)
    append({ kind: 'completed', operationId: request.operationId, activation })
    expect(state.guards.get('fictional-bakery')?.phase).toBe('active')
  })
  it('refuses identity reuse, stale consent, and interleaved operations', () => {
    const { state, append, request, allocated } = fixture()
    expect(() =>
      planOperation(
        state,
        { ...request, consent: { ...request.consent, expectedSequence: 99 } },
        allocated(),
      ),
    ).toThrow(PluginStateError)
    const allocation = allocated()
    allocation.installId = state.rootId
    expect(() =>
      append({ kind: 'prepared', operation: planOperation(state, request, allocation) }),
    ).toThrow(PluginStateError)
    append({ kind: 'prepared', operation: planOperation(state, request, allocated()) })
    expect(() => planOperation(state, request, allocated())).toThrow(
      expect.objectContaining({ code: 'busy' }),
    )
  })
  it('refuses missing/reordered history instead of inventing a fresh lifecycle floor', () => {
    const { state, request, allocated } = fixture()
    const record: Record = {
      sequence: 2,
      previous: state.head,
      publicationId: randomUUID(),
      event: { kind: 'prepared', operation: planOperation(state, request, allocated()) },
    }
    expect(() => foldRecord(state, record, 'a'.repeat(64))).toThrow(PluginStateError)
    record.sequence = 1
    record.previous = 'b'.repeat(64)
    expect(() => foldRecord(state, record, 'a'.repeat(64))).toThrow(PluginStateError)
  })
  it('checksum envelopes reject corruption, unknown fields and duplicate JSON keys', () => {
    const { state } = fixture()
    const snapshot = { format: 1 as const, rootId: state.rootId, epoch: state.epoch, entries: [] }
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
  })
  it('bounds journal records without truncating or forgetting a tombstone', () => {
    expect(() => encodeState({ fictional: 'x'.repeat(128 * 1024) })).toThrow(
      expect.objectContaining({ code: 'limit' }),
    )
  })
})
