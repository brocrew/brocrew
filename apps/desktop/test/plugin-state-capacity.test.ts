import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  mkdtempSync,
  cpSync,
  chmodSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PluginStateDisk } from '../src/main/plugins/state/disk'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import {
  STATE_LIMITS,
  encodeState,
  type Event,
  type JournalRecord,
  type OperationRequest,
} from '../src/main/plugins/state/format'
import {
  foldRecord,
  newLifecycle,
  planOperation,
  resolvedSnapshot,
  snapshotReference,
} from '../src/main/plugins/state/machine'
import { pluginSha256 } from '../src/main/plugins/package-digests'

const roots: string[] = [],
  stores: GlobalPluginState[] = []
afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const release = {
  version: '1.0.0',
  archiveSha256: 'a'.repeat(64),
  manifestSha256: 'b'.repeat(64),
  dataSchema: 1,
}
function fixture(fault?: (point: 'staged' | 'published' | 'durable') => void) {
  const parent = mkdtempSync(join(realpathSync(tmpdir()), 'fictional-plugin-capacity-'))
  roots.push(parent)
  const root = join(parent, 'plugins'),
    options = { root, workspaceRoots: [], fault }
  const store = GlobalPluginState.create(options)
  stores.push(store)
  return {
    root,
    store,
    options,
    reopen() {
      const next = GlobalPluginState.open(options)
      stores.push(next)
      return next
    },
  }
}
function request(store: GlobalPluginState): OperationRequest {
  const state = store.inspect(),
    before = state.guards[0]
  return {
    operationId: randomUUID(),
    consent: {
      action: before?.phase === 'active' ? 'update' : 'install',
      pluginId: 'fictional-bakery',
      at: 1000,
      expectedSequence: state.sequence,
      expectedInstallId: before?.installId ?? null,
      release,
    },
    snapshot: null,
  }
}
function install(store: GlobalPluginState) {
  const input = request(store)
  store.prepare(input)
  store.complete(input.operationId)
}
const count = (root: string, folder: string) => readdirSync(join(root, folder)).length
const journalBytes = (root: string) =>
  readdirSync(join(root, 'lifecycle-guard'))
    .filter((name) => name.endsWith('.json'))
    .reduce((sum, name) => sum + readFileSync(join(root, 'lifecycle-guard', name)).length, 0)
function withByteLimit<T>(value: number, run: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(STATE_LIMITS, 'journalBytes')!
  expect(value).toBeLessThanOrEqual(descriptor.value)
  Object.defineProperty(STATE_LIMITS, 'journalBytes', { ...descriptor, value })
  try {
    return run()
  } finally {
    Object.defineProperty(STATE_LIMITS, 'journalBytes', descriptor)
  }
}

// Historical completed format-1 records, built in memory instead of fsyncing thousands of API calls.
function history(completed: number) {
  const state = newLifecycle(),
    records: { name: string; bytes: Buffer; seal: string }[] = []
  function append(event: Event) {
    const record: JournalRecord = {
      sequence: state.sequence + 1,
      previous: state.head,
      publicationId: randomUUID(),
      event,
    }
    const bytes = encodeState(record),
      sha = pluginSha256(bytes),
      stem = String(record.sequence).padStart(8, '0')
    records.push({ name: `${stem}.json`, bytes, seal: `${stem}-${sha}.seal` })
    foldRecord(state, record, sha)
  }
  append({ kind: 'created', rootId: randomUUID(), epoch: randomUUID() })
  for (let index = 0; index < completed; index++) {
    const before = state.guards.get('fictional-bakery')
    const input: OperationRequest = {
      operationId: randomUUID(),
      consent: {
        action: before ? 'update' : 'install',
        pluginId: 'fictional-bakery',
        at: 1000,
        expectedSequence: state.sequence,
        expectedInstallId: before?.installId ?? null,
        release,
      },
      snapshot: null,
    }
    const operation = planOperation(state, input, {
      installId: randomUUID(),
      incarnation: randomUUID(),
      epoch: randomUUID(),
    })
    append({ kind: 'prepared', operation })
    append({
      kind: 'completed',
      operationId: input.operationId,
      activation: snapshotReference(resolvedSnapshot(state, true), state.sequence + 1),
    })
  }
  return {
    records,
    state,
    snapshot: {
      format: 1 as const,
      rootId: state.rootId,
      epoch: state.epoch,
      entries: [...state.admitted.values()],
    },
  }
}
let nearLimit: ReturnType<typeof history> | undefined

describe.skipIf(process.platform === 'win32')('durable operation capacity', () => {
  it('reopen reclaims a pre-prepare crash image and returns its physical capacity', () => {
    let armed = false,
      copied = false,
      source = '',
      crashed = ''
    const f = fixture((point) => {
      if (
        armed &&
        point === 'durable' &&
        readdirSync(join(source, 'activations')).filter((name) => name.endsWith('.json')).length ===
          3
      ) {
        cpSync(source, crashed, { recursive: true })
        // cp creates destination directories using the process umask, unlike the private source.
        chmodSync(crashed, 0o700)
        for (const name of readdirSync(crashed, { recursive: true })) {
          const path = join(crashed, name.toString())
          if (lstatSync(path).isDirectory()) chmodSync(path, 0o700)
        }
        copied = true
        armed = false
        throw new Error('fictional pre-prepare crash')
      }
    })
    source = f.root
    crashed = join(f.root, '..', 'crashed-plugins')
    install(f.store)
    const original = readdirSync(join(f.root, 'activations'))
    armed = true
    expect(() => f.store.prepare(request(f.store))).toThrow()
    expect(copied).toBe(true)
    // Ordinary refusal cleans immediately; the captured disk image bypasses that finally path.
    expect(readdirSync(join(f.root, 'activations'))).toEqual(original)
    expect(readdirSync(join(f.root, 'resolution-reservations'))).toEqual([])
    expect(readdirSync(join(crashed, 'activations')).length).toBeGreaterThan(original.length)
    expect(readdirSync(join(crashed, 'resolution-reservations'))).toHaveLength(1)
    const restored = GlobalPluginState.open({ root: crashed, workspaceRoots: [] })
    stores.push(restored)
    expect(readdirSync(join(crashed, 'activations'))).toEqual(original)
    expect(readdirSync(join(crashed, 'resolution-reservations'))).toEqual([])
    const retry = request(restored)
    restored.prepare(retry)
    restored.complete(retry.operationId)
    expect(restored.inspect().pending).toBeNull()
  })
  it('a stale-head conflict refusal leaves no reservation or activation behind', () => {
    const { root, store, options } = fixture()
    install(store)
    const disk = new PluginStateDisk(options)
    try {
      const before = disk.load(),
        input = request(store)
      const operation = planOperation(before, input, {
        installId: randomUUID(),
        incarnation: randomUUID(),
        epoch: randomUUID(),
      })
      const winner = request(store)
      store.prepare(winner)
      store.complete(winner.operationId)
      const files = readdirSync(root, { recursive: true }).sort()
      expect(() => disk.prepare(before, operation)).toThrow(
        expect.objectContaining({ code: 'conflict' }),
      )
      expect(readdirSync(root, { recursive: true }).sort()).toEqual(files)
      expect(readdirSync(join(root, 'resolution-reservations'))).toEqual([])
    } finally {
      disk.close()
    }
  })
  it('reopen preserves every live reservation file and both outcome snapshots', () => {
    const { root, store, reopen } = fixture()
    install(store)
    const input = request(store)
    store.prepare(input)
    expect(readdirSync(join(root, 'resolution-reservations'))).toEqual([input.operationId])
    const files = readdirSync(root, { recursive: true }).sort(),
      pending = store.inspect().pending
    const second = reopen()
    expect(second.inspect().pending).toEqual(pending)
    expect(readdirSync(root, { recursive: true }).sort()).toEqual(files)
    second.abort(input.operationId)
    expect(readdirSync(join(root, 'resolution-reservations'))).toEqual([])
    expect(store.inspect().pending).toBeNull()
  })
  it.each([true, false])(
    '4093 records admit prepare and %s resolution; 4095 refuse the next prepare before record4096',
    (success) => {
      nearLimit ??= history(2046)
      const { root, store: initial, reopen } = fixture()
      initial.close()
      for (const name of readdirSync(join(root, 'lifecycle-guard')))
        unlinkSync(join(root, 'lifecycle-guard', name))
      for (const record of nearLimit.records) {
        writeFileSync(join(root, 'lifecycle-guard', record.name), record.bytes, { mode: 0o600 })
        writeFileSync(join(root, 'lifecycle-guard', record.seal), '', { mode: 0o600 })
      }
      writeFileSync(
        join(root, 'activations', nearLimit.state.activation!.name),
        encodeState(nearLimit.snapshot),
        { mode: 0o600 },
      )
      const store = reopen()
      expect(store.inspect().sequence + 1).toBe(4093)
      const input = request(store)
      store.prepare(input)
      expect(store.inspect().sequence + 1).toBe(4094)
      const next = reopen()
      if (success) next.complete(input.operationId)
      else next.abort(input.operationId)
      const before = next.inspect()
      expect(before.sequence + 1).toBe(4095)
      expect(before.pending).toBeNull()
      expect(() => next.prepare(request(next))).toThrow(expect.objectContaining({ code: 'limit' }))
      expect(next.inspect()).toEqual(before)
      expect(readdirSync(join(root, 'lifecycle-guard'))).not.toContain('00004095.json')
    },
    60_000,
  )

  it.each([true, false])(
    'journal byte budget survives reopen and %s resolution exactly at its reservation',
    (success) => {
      const probe = fixture()
      install(probe.store)
      const oldBytes = journalBytes(probe.root),
        probeInput = request(probe.store)
      probe.store.prepare(probeInput)
      const cost =
        journalBytes(probe.root) - oldBytes + probe.store.inspect().reservation!.recordBytes
      const { root, store, reopen } = fixture()
      install(store)
      const maximum = journalBytes(root) + cost
      withByteLimit(maximum, () => {
        const input = request(store)
        store.prepare(input)
        expect(journalBytes(root) + store.inspect().reservation!.recordBytes).toBe(maximum)
        const next = reopen()
        if (success) next.complete(input.operationId)
        else next.abort(input.operationId)
        expect(next.inspect().pending).toBeNull()
        expect(journalBytes(root)).toBeLessThanOrEqual(maximum)
      })
      const refused = fixture()
      install(refused.store)
      const before = refused.store.inspect()
      withByteLimit(journalBytes(refused.root) + cost - 1, () => {
        expect(() => refused.store.prepare(request(refused.store))).toThrow(
          expect.objectContaining({ code: 'limit' }),
        )
        expect(refused.store.inspect()).toEqual(before)
      })
    },
  )

  it.each([true, false])(
    'reserved guard/activation names allow %s resolution without any new staging allocation',
    (success) => {
      const { root, store, reopen } = fixture()
      install(store)
      for (const [folder, allowance] of [
        ['lifecycle-guard', 6],
        ['activations', 4],
      ] as const) {
        const missing = STATE_LIMITS.records * 2 - allowance - count(root, folder)
        for (let index = 0; index < missing; index++)
          writeFileSync(join(root, folder, `.stage-${randomUUID()}`), '', { mode: 0o600 })
      }
      const input = request(store)
      store.prepare(input)
      const guard = count(root, 'lifecycle-guard'),
        activations = readdirSync(join(root, 'activations')),
        reservations = readdirSync(join(root, 'resolution-reservations'))
      const next = reopen()
      if (success) next.complete(input.operationId)
      else next.abort(input.operationId)
      expect(next.inspect().pending).toBeNull()
      expect(count(root, 'lifecycle-guard')).toBe(guard + 2)
      expect(
        readdirSync(join(root, 'activations')).every((name) => activations.includes(name)),
      ).toBe(true)
      expect(reservations).toEqual([input.operationId])
      expect(readdirSync(join(root, 'resolution-reservations'))).toEqual([])
      expect(count(root, 'lifecycle-guard')).toBeLessThanOrEqual(STATE_LIMITS.records * 2)
    },
    60_000,
  )

  it.each(['lifecycle-guard'])(
    'refuses prepare before entering a pending state when %s lacks its name budget',
    (folder) => {
      const { root, store } = fixture()
      install(store)
      const allowance = 6
      const missing = STATE_LIMITS.records * 2 - allowance + 1 - count(root, folder)
      for (let index = 0; index < missing; index++)
        writeFileSync(join(root, folder, `.stage-${randomUUID()}`), '', { mode: 0o600 })
      const before = store.inspect()
      expect(() => store.prepare(request(store))).toThrow(
        expect.objectContaining({ code: 'limit' }),
      )
      expect(store.inspect()).toEqual(before)
    },
    60_000,
  )

  it('repeated interrupted resolution and reopen consume no additional byte or name reservation', () => {
    let armed = false
    const { root, store, reopen } = fixture((point) => {
      if (armed && point === 'staged') {
        armed = false
        throw new Error('fictional interruption')
      }
    })
    const input = request(store)
    store.prepare(input)
    const budget = store.inspect().reservation,
      guard = readdirSync(join(root, 'lifecycle-guard')),
      activation = readdirSync(join(root, 'activations'))
    for (let index = 0; index < 3; index++) {
      armed = true
      expect(() => reopen().complete(input.operationId)).toThrow()
      expect(store.inspect().reservation).toEqual(budget)
      expect(readdirSync(join(root, 'lifecycle-guard'))).toEqual(guard)
      expect(readdirSync(join(root, 'activations'))).toEqual(activation)
    }
    reopen().abort(input.operationId)
    expect(store.inspect().pending).toBeNull()
  })
})
