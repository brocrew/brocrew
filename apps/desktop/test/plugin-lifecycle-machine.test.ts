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
} from '../src/main/plugins/state/machine'

function fixture() {
  const state = newLifecycle()
  function append(event: Event) {
    const record: Record = {
      sequence: state.sequence + 1,
      previous: null,
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

describe('portable plugin operation data', () => {
  it('selects a prepared operation without activation certificates', () => {
    const { state, append, request, allocated } = fixture()
    append({ kind: 'prepared', operation: planOperation(state, request, allocated()) })
    expect(state.guards.get('fictional-bakery')?.phase).toBe('prepared')
    append({ kind: 'completed', operationId: request.operationId })
    expect(state.admitted.get('fictional-bakery')?.phase).toBe('active')
  })
  it('keeps ordinary stale revision and concurrent operation errors without a reserved identity inventory', () => {
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
    append({ kind: 'prepared', operation: planOperation(state, request, allocation) })
    expect(() => planOperation(state, request, allocated())).toThrow(
      expect.objectContaining({ code: 'busy' }),
    )
    expect(resolvedSnapshot(state, false).entries).toEqual([])
  })
  it('imports sequence gaps and old chain fields as data without imposing an antirollback floor', () => {
    const { state, request, allocated } = fixture()
    foldRecord(
      state,
      {
        sequence: 40000,
        previous: 'b'.repeat(64),
        publicationId: randomUUID(),
        event: { kind: 'prepared', operation: planOperation(state, request, allocated()) },
      },
      'a'.repeat(64),
    )
    expect(state.sequence).toBe(40000)
    expect(state.pending?.request).toEqual(request)
  })
  it('round trips ordinary JSON, reads old envelopes and reports malformed state', () => {
    const { state } = fixture(),
      snapshot = { format: 1 as const, rootId: state.rootId, epoch: state.epoch, entries: [] }
    expect(decodeState(encodeState(snapshot), ActivationSnapshot)).toEqual(snapshot)
    expect(
      decodeState(
        Buffer.from(JSON.stringify({ payload: JSON.stringify(snapshot), sha256: 'a'.repeat(64) })),
        ActivationSnapshot,
      ),
    ).toEqual(snapshot)
    expect(() => decodeState(Buffer.from('{'), ActivationSnapshot)).toThrow(PluginStateError)
    expect(() => decodeState(encodeState(snapshot), JournalRecord)).toThrow(PluginStateError)
  })
  it('encodes complete local records beyond the old fixed size', () => {
    const value = { fictional: 'x'.repeat(256 * 1024) }
    expect(JSON.parse(encodeState(value).toString('utf8'))).toEqual(value)
  })
})
