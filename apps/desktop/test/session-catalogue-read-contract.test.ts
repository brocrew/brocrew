import { describe, expect, it } from 'vitest'
import type { AppStatement } from '../src/main/db/connection'
import {
  createSessionCatalogueRead,
  derivedStateOf,
  parseChildDescent,
  resolveEndReason,
} from '../src/main/db/session-catalogue-read'
import { NORMALIZER_VERSION } from '../src/main/archive/normalizer'

type Row = {
  id: string
  provider: string
  external_ref: string | null
  cwd: string
  status: string
  approval_mode: string | null
  profile_id: string | null
  reasoning_effort: string | null
  model: string | null
  plan_mode: number | null
  plan_ended_at: number | null
  model_or_effort_set_by_a_person_at: number | null
  reported_model: string | null
  reported_effort: string | null
  adopted_at: number | null
  restored_at: number | null
  child_descent: string | null
  has_events: number
  last_end_reason: string | null
  normalizer_version: number | null
  building: number | null
  failure: string | null
  created_at: number
  updated_at: number
}

const ref = {
  provider: 'claude',
  sessionId: 'provider-thread',
  cwd: '/catalogue-fixture',
  rotation: 0,
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: 'session-one',
    provider: 'claude',
    external_ref: JSON.stringify(ref),
    cwd: '/catalogue-fixture',
    status: 'idle',
    approval_mode: 'ask',
    profile_id: 'fixture-profile',
    reasoning_effort: 'high',
    model: 'fixture-model',
    plan_mode: null,
    plan_ended_at: null,
    model_or_effort_set_by_a_person_at: null,
    reported_model: null,
    reported_effort: null,
    adopted_at: null,
    restored_at: null,
    child_descent: null,
    has_events: 1,
    last_end_reason: 'completed',
    normalizer_version: null,
    building: null,
    failure: null,
    created_at: 10,
    updated_at: 20,
    ...overrides,
  }
}

type Call = {
  statement: 'all-rows' | 'one-row'
  method: 'all' | 'get'
  receiver: unknown
  args: unknown[]
}

function suppliedStatements() {
  const calls: Call[] = []
  let single: Row | undefined
  let rows: Row[] = []
  let getFailure: Error | undefined
  let allFailure: Error | undefined
  const statement = (name: Call['statement']) => ({
    get(this: unknown, ...args: unknown[]) {
      calls.push({ statement: name, method: 'get', receiver: this, args })
      if (getFailure !== undefined) throw getFailure
      return single
    },
    all(this: unknown, ...args: unknown[]) {
      calls.push({ statement: name, method: 'all', receiver: this, args })
      if (allFailure !== undefined) throw allFailure
      return rows
    },
  })
  const all = statement('all-rows')
  const one = statement('one-row')
  const read = createSessionCatalogueRead(
    all as unknown as AppStatement,
    one as unknown as AppStatement,
  )
  return {
    read,
    calls,
    all,
    one,
    setOne(value: Row | undefined) {
      single = value
    },
    setRows(value: Row[]) {
      rows = value
    },
    failGet(error: Error) {
      getFailure = error
    },
    failAll(error: Error) {
      allFailure = error
    },
  }
}

function existingRow<T>(value: T | null | undefined): T {
  expect(value).toBeDefined()
  expect(value).not.toBeNull()
  if (value === null || value === undefined) throw new Error('expected a catalogue row')
  return value
}

describe('catalogue reader supplied-statement contracts', () => {
  it('does no constructor reads and uses each supplied receiver once per reader call', () => {
    const h = suppliedStatements()
    expect(h.calls).toEqual([])
    h.setOne(row())
    h.setRows([row()])

    expect(existingRow(h.read.find('session-one'))).toMatchObject({
      sessionId: 'session-one',
      ref,
      hasTranscript: true,
    })
    expect(existingRow(h.read.findLive('session-one'))).toEqual({
      sessionId: 'session-one',
      profileId: 'fixture-profile',
      approvalMode: 'ask',
      ref,
      model: 'fixture-model',
      reasoningEffort: 'high',
    })
    expect(h.read.resumable()).toEqual([
      expect.objectContaining({ sessionId: 'session-one', hasTranscript: true }),
    ])
    expect(h.read.unresumable()).toEqual([])
    expect(h.read.recorded()).toEqual([
      expect.objectContaining({ sessionId: 'session-one', hasTranscript: true }),
    ])
    expect(existingRow(h.read.recordedOne('session-one'))).toMatchObject({
      sessionId: 'session-one',
      providerSessionId: 'provider-thread',
    })

    expect(h.calls.map(({ statement, method, args }) => ({ statement, method, args }))).toEqual([
      { statement: 'one-row', method: 'get', args: ['session-one'] },
      { statement: 'one-row', method: 'get', args: ['session-one'] },
      { statement: 'all-rows', method: 'all', args: [] },
      { statement: 'all-rows', method: 'all', args: [] },
      { statement: 'all-rows', method: 'all', args: [] },
      { statement: 'one-row', method: 'get', args: ['session-one'] },
    ])
    for (const call of h.calls) {
      expect(call.receiver).toBe(call.statement === 'one-row' ? h.one : h.all)
    }
  })

  it('returns null for missing single rows and empty lists for no rows', () => {
    const h = suppliedStatements()
    expect(h.read.find('missing')).toBeNull()
    expect(h.read.findLive('missing')).toBeNull()
    expect(h.read.recordedOne('missing')).toBeNull()
    expect(h.read.resumable()).toEqual([])
    expect(h.read.unresumable()).toEqual([])
    expect(h.read.recorded()).toEqual([])
  })

  it('keeps an unnamed live row and recording while resume lookup has no row to offer', () => {
    const h = suppliedStatements()
    const unnamed = row({ external_ref: null, approval_mode: null })
    h.setOne(unnamed)
    h.setRows([unnamed])
    expect(h.read.find('session-one')).toBeNull()
    expect(existingRow(h.read.findLive('session-one'))).toEqual({
      sessionId: 'session-one',
      profileId: 'fixture-profile',
      approvalMode: null,
      ref: null,
      model: 'fixture-model',
      reasoningEffort: 'high',
    })
    expect(existingRow(h.read.recordedOne('session-one'))).toMatchObject({
      sessionId: 'session-one',
      providerSessionId: null,
      neverStarted: true,
    })
    expect(h.read.resumable()).toEqual([])
    expect(h.read.unresumable()).toEqual([
      expect.objectContaining({ sessionId: 'session-one', hasTranscript: true }),
    ])
  })

  it('returns the six live fields with explicit null settings and auto approval', () => {
    const h = suppliedStatements()
    h.setOne(row({ profile_id: null, approval_mode: 'auto', model: null, reasoning_effort: null }))
    expect(existingRow(h.read.findLive('session-one'))).toEqual({
      sessionId: 'session-one',
      profileId: null,
      approvalMode: 'auto',
      ref,
      model: null,
      reasoningEffort: null,
    })
  })

  it.each(['{', '{}'])(
    'keeps a malformed ref as a recording, not a resumable handle: %s',
    (bad) => {
      const h = suppliedStatements()
      const damaged = row({ external_ref: bad, approval_mode: 'unexpected' })
      h.setOne(damaged)
      h.setRows([damaged])
      expect(h.read.find('session-one')).toBeNull()
      expect(existingRow(h.read.findLive('session-one'))).toEqual({
        sessionId: 'session-one',
        profileId: 'fixture-profile',
        approvalMode: null,
        ref: null,
        model: 'fixture-model',
        reasoningEffort: 'high',
      })
      expect(existingRow(h.read.recordedOne('session-one'))).toMatchObject({
        sessionId: 'session-one',
        providerSessionId: null,
        neverStarted: false,
        unresumableReason: expect.stringContaining('can no longer read'),
      })
      expect(h.read.resumable()).toEqual([])
      expect(h.read.unresumable()).toEqual([
        expect.objectContaining({
          sessionId: 'session-one',
          reason: expect.stringContaining('can no longer read'),
        }),
      ])
      expect(h.read.recorded()).toEqual([
        expect.objectContaining({ sessionId: 'session-one', providerSessionId: null }),
      ])
    },
  )

  it('keeps list order while own-home and restored rows retain different explanations', () => {
    const h = suppliedStatements()
    h.setRows([
      row({ id: 'restored', restored_at: 5, adopted_at: 4, profile_id: null }),
      row({ id: 'parent' }),
      row({ id: 'own-home', adopted_at: 4, profile_id: null }),
      row({ id: 'child', child_descent: '{"parentSessionId":"provider-parent"}' }),
    ])
    expect(h.read.recorded().map((entry) => entry.sessionId)).toEqual([
      'restored',
      'parent',
      'own-home',
      'child',
    ])
    expect(h.read.resumable()).toEqual([
      expect.objectContaining({ sessionId: 'parent', child: null, resumeRefusal: null }),
      expect.objectContaining({
        sessionId: 'child',
        child: { parentSessionId: 'provider-parent' },
        resumeRefusal: expect.stringContaining('sub-agent conversation'),
      }),
    ])
    expect(h.read.unresumable()).toEqual([
      expect.objectContaining({
        sessionId: 'restored',
        reason: expect.stringContaining('restored from a bundle'),
      }),
      expect.objectContaining({
        sessionId: 'own-home',
        reason: expect.stringContaining('own folder'),
      }),
    ])
  })

  it('reads changed supplied rows on each call and isolates two factories', () => {
    const left = suppliedStatements()
    const right = suppliedStatements()
    expect(left.calls).toEqual([])
    expect(right.calls).toEqual([])
    left.setOne(row({ model: 'left' }))
    right.setOne(row({ model: 'right' }))
    expect(existingRow(left.read.findLive('left-id'))).toMatchObject({ model: 'left' })
    expect(right.calls).toEqual([])
    expect(existingRow(right.read.findLive('right-id'))).toMatchObject({ model: 'right' })
    left.setOne(row({ model: 'left-new' }))
    expect(existingRow(left.read.findLive('again'))).toMatchObject({ model: 'left-new' })
    expect(existingRow(right.read.findLive('still-right'))).toMatchObject({ model: 'right' })
    expect(left.calls.map((call) => call.args)).toEqual([['left-id'], ['again']])
    expect(right.calls.map((call) => call.args)).toEqual([['right-id'], ['still-right']])
    for (const call of left.calls) expect(call.receiver).toBe(left.one)
    for (const call of right.calls) expect(call.receiver).toBe(right.one)
    left.calls.length = 0
    right.calls.length = 0
    left.setRows([row({ id: 'left-list' })])
    right.setRows([row({ id: 'right-list' })])
    expect(left.read.recorded().map((entry) => entry.sessionId)).toEqual(['left-list'])
    expect(right.calls).toEqual([])
    expect(right.read.recorded().map((entry) => entry.sessionId)).toEqual(['right-list'])
    left.setRows([])
    expect(left.read.recorded()).toEqual([])
    expect(right.read.recorded().map((entry) => entry.sessionId)).toEqual(['right-list'])
    expect(left.calls).toHaveLength(2)
    expect(right.calls).toHaveLength(2)
    for (const call of left.calls) {
      expect(call.receiver).toBe(left.all)
      expect(call.method).toBe('all')
      expect(call.args).toEqual([])
    }
    for (const call of right.calls) {
      expect(call.receiver).toBe(right.all)
      expect(call.method).toBe('all')
      expect(call.args).toEqual([])
    }
  })

  it('catches mapping faults inside resume conversion without swallowing native read faults', () => {
    const h = suppliedStatements()
    const fault = new Error('fixture profile getter')
    const damaged = row()
    Object.defineProperty(damaged, 'profile_id', {
      get() {
        throw fault
      },
    })
    h.setOne(damaged)
    h.setRows([damaged])
    expect(h.read.find('session-one')).toBeNull()
    expect(h.read.resumable()).toEqual([])
    expect(() => h.read.findLive('session-one')).toThrow(fault)
    expect(() => h.read.recordedOne('session-one')).toThrow(fault)
    expect(() => h.read.recorded()).toThrow(fault)

    const native = suppliedStatements()
    const readFault = new Error('fixture native get')
    native.failGet(readFault)
    expect(() => native.read.find('session-one')).toThrow(readFault)
    expect(() => native.read.findLive('session-one')).toThrow(readFault)
    expect(() => native.read.recordedOne('session-one')).toThrow(readFault)
    native.failAll(readFault)
    expect(() => native.read.resumable()).toThrow(readFault)
    expect(() => native.read.unresumable()).toThrow(readFault)
    expect(() => native.read.recorded()).toThrow(readFault)
  })

  it('leaves a ref-property fault outside the resume conversion catch', () => {
    const h = suppliedStatements()
    const fault = new Error('fixture ref getter')
    const damaged = row()
    Object.defineProperty(damaged, 'external_ref', {
      get() {
        throw fault
      },
    })
    h.setOne(damaged)
    h.setRows([damaged])
    expect(() => h.read.find('session-one')).toThrow(fault)
    expect(() => h.read.resumable()).toThrow(fault)
  })

  it('preserves the distinct exact-one and nonzero transcript indicators', () => {
    const h = suppliedStatements()
    h.setOne(row({ has_events: 2 }))
    h.setRows([row({ has_events: 2 })])
    expect(existingRow(h.read.find('session-one'))).toMatchObject({
      sessionId: 'session-one',
      hasTranscript: false,
    })
    expect(h.read.resumable()).toEqual([
      expect.objectContaining({ sessionId: 'session-one', hasTranscript: false }),
    ])
    expect(existingRow(h.read.recordedOne('session-one'))).toMatchObject({
      sessionId: 'session-one',
      hasTranscript: true,
    })
    expect(h.read.recorded()).toEqual([
      expect.objectContaining({ sessionId: 'session-one', hasTranscript: true }),
    ])
    h.setRows([row({ has_events: 2, external_ref: null })])
    expect(h.read.unresumable()).toEqual([
      expect.objectContaining({ sessionId: 'session-one', hasTranscript: true }),
    ])
    h.setOne(row({ has_events: 0 }))
    h.setRows([row({ has_events: 0, external_ref: null })])
    expect(existingRow(h.read.find('session-one'))).toMatchObject({
      sessionId: 'session-one',
      hasTranscript: false,
    })
    expect(existingRow(h.read.recordedOne('session-one'))).toMatchObject({
      sessionId: 'session-one',
      hasTranscript: false,
    })
    expect(h.read.recorded()).toEqual([
      expect.objectContaining({ sessionId: 'session-one', hasTranscript: false }),
    ])
    expect(h.read.unresumable()).toEqual([
      expect.objectContaining({ sessionId: 'session-one', hasTranscript: false }),
    ])
  })
})

describe('catalogue interpretation helper contracts', () => {
  it.each([
    { raw: null, expected: null },
    { raw: '', expected: null },
    { raw: '{', expected: null },
    { raw: 'null', expected: null },
    { raw: '42', expected: null },
    { raw: 'true', expected: null },
    { raw: '"child"', expected: null },
    { raw: '{}', expected: {} },
    { raw: '[]', expected: [] },
    {
      raw: '{"parentSessionId":"parent","extra":true}',
      expected: { parentSessionId: 'parent', extra: true },
    },
  ])('retains permissive child JSON interpretation for $raw', ({ raw, expected }) => {
    expect(parseChildDescent(raw)).toEqual(expected)
  })

  it.each([
    { stored: null, expected: null },
    { stored: 'completed', expected: 'completed' },
    { stored: 'failed', expected: 'failed' },
    { stored: 'interrupted', expected: 'interrupted' },
    { stored: 'ended', expected: 'ended' },
    { stored: 'unknown', expected: 'unknown' },
    { stored: 'future-ending', expected: 'unknown' },
    { stored: '', expected: 'unknown' },
  ])('interprets stored ending $stored as $expected', ({ stored, expected }) => {
    expect(resolveEndReason(stored)).toBe(expected)
  })

  it('keeps no projection distinct from a projection with no published events', () => {
    expect(derivedStateOf(null, true)).toBeNull()
    expect(derivedStateOf(null, false)).toBeNull()
    expect(
      derivedStateOf(
        { normalizerVersion: NORMALIZER_VERSION - 1, building: null, failure: null },
        false,
      ),
    ).toBeNull()
  })

  it.each([
    {
      building: 0,
      failure: 'failed too',
      present: false,
      version: NORMALIZER_VERSION - 1,
      expected: 'rebuilding',
    },
    {
      building: 7,
      failure: null,
      present: true,
      version: NORMALIZER_VERSION,
      expected: 'rebuilding',
    },
    {
      building: null,
      failure: '',
      present: false,
      version: NORMALIZER_VERSION - 1,
      expected: 'failed',
    },
    {
      building: null,
      failure: 'disk failed',
      present: true,
      version: NORMALIZER_VERSION,
      expected: 'failed',
    },
    { building: null, failure: null, present: false, version: NORMALIZER_VERSION, expected: null },
    {
      building: null,
      failure: null,
      present: true,
      version: NORMALIZER_VERSION - 1,
      expected: 'stale',
    },
    {
      building: null,
      failure: null,
      present: true,
      version: NORMALIZER_VERSION,
      expected: 'current',
    },
    {
      building: null,
      failure: null,
      present: true,
      version: NORMALIZER_VERSION + 1,
      expected: 'current',
    },
  ])(
    'keeps projection precedence $building/$failure/$present/$version',
    ({ building, failure, present, version, expected }) => {
      expect(derivedStateOf({ normalizerVersion: version, building, failure }, present)).toBe(
        expected,
      )
    },
  )
})
